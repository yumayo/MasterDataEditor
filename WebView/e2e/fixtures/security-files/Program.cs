using System.Text.Json;
using App.MasterDataEditor;

var sandbox = Path.Combine(Path.GetTempPath(), "mde-security-files-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(sandbox);
var failures = new List<string>();
try
{
    Run("パスの各階層・最終ファイル・作業フォルダー自身のリンクを拒否", CheckLinks);
    foreach (var operation in new[] { "add", "reset", "discard" })
    {
        Run($"Git {operation}: [] を含むファイル名を文字どおり扱う", () => CheckGit(operation, "filename"));
        Run($"Git {operation}: [] を含む作業フォルダーの兄弟を変更しない", () => CheckGit(operation, "workspace"));
        if (!OperatingSystem.IsWindows())
        {
            Run($"Git helper {operation}: * を含むファイル名を文字どおり扱う", () => CheckGit(operation, "glob"));
            Run($"Git helper {operation}: :(glob) を含むパスを文字どおり扱う", () => CheckGit(operation, "magic"));
        }
    }
    if (OperatingSystem.IsWindows())
    {
        Run("Windows: 正常なファイルの作成・読取り・列挙・削除", CheckWindowsFiles);
        Run("Windows: 親ディレクトリの差し替えを拒否し保持中の通常 IO は許可", CheckWindowsParentLock);
        Run("Windows: 最終ファイルのリンク差し替え競合から外部データを保護", CheckWindowsRace);
        Run("Windows: ハードリンク経由の上書き・読取り・削除を拒否", CheckWindowsHardLink);
        Run("Windows: 親ディレクトリごと削除したファイルを stage / unstage / restore", CheckWindowsDeletedParentGit);
    }
    else Console.WriteLine("SKIP: Windows handle locking / native file I/O requires Windows.");
}
finally
{
    Directory.Delete(sandbox, true);
}
foreach (var failure in failures) Console.Error.WriteLine(failure);
return failures.Count == 0 ? 0 : 1;

void Run(string name, Action action)
{
    try { action(); Console.WriteLine("PASS: " + name); }
    catch (Exception error) { failures.Add("FAIL: " + name + Environment.NewLine + error); }
}

void CheckLinks()
{
    var workspace = Path.Combine(sandbox, "workspace");
    var outside = Path.Combine(sandbox, "outside");
    Directory.CreateDirectory(workspace);
    Directory.CreateDirectory(outside);
    File.WriteAllText(Path.Combine(outside, "evidence.txt"), "outside-marker");
    Directory.CreateSymbolicLink(Path.Combine(workspace, "linked"), outside);
    File.CreateSymbolicLink(Path.Combine(workspace, "leaf.txt"), Path.Combine(outside, "evidence.txt"));
    File.CreateSymbolicLink(Path.Combine(workspace, "missing.txt"), Path.Combine(outside, "missing.txt"));
    Directory.CreateSymbolicLink(Path.Combine(sandbox, "root-link"), workspace);
    AppEnvironment.WorkDir = workspace;
    foreach (var filename in new[] { "linked/evidence.txt", "leaf.txt", "missing.txt" })
    {
        Expect(HelperFile.ResolveSafePath(workspace, filename) == null, "ResolveSafePath accepted " + filename);
        Expect(!Invoke(WebView2HandlerReadFileRequest.Invoke, new { filename }).GetProperty("success").GetBoolean(), "Read accepted " + filename);
        Expect(!Invoke(WebView2HandlerWriteFileRequest.Invoke, new { filename, data = "changed" }).GetProperty("success").GetBoolean(), "Write accepted " + filename);
        Expect(!Invoke(WebView2HandlerDeleteFileRequest.Invoke, new { filename }).GetProperty("success").GetBoolean(), "Delete accepted " + filename);
    }
    Expect(!Invoke(WebView2HandlerFindFilesRequest.Invoke, new { directory = "linked" }).GetProperty("success").GetBoolean(), "Find traversed a link");
    Expect(File.ReadAllText(Path.Combine(outside, "evidence.txt")) == "outside-marker", "Outside file changed");
    Expect(!File.Exists(Path.Combine(outside, "missing.txt")), "Dangling symlink created an outside file");
    Expect(HelperFile.ResolveSafePath(Path.Combine(sandbox, "root-link"), "leaf.txt") == null, "Workspace root link accepted");
    Expect(HelperFile.ResolveSafePath(Path.Combine(sandbox, "root-link", "nested"), "data.csv") == null, "Workspace ancestor link accepted");
    foreach (var filename in new[] { "../outside/evidence.txt", "/outside/evidence.txt", "data/file.csv:stream", "data/CON.csv", "data/LPT1.csv", "data/trailing./x.csv", "data/trailing /x.csv", "data/./x.csv", "\\\\server\\share\\x.csv" })
        Expect(HelperFile.ResolveSafePath(workspace, filename) == null, "Invalid path accepted: " + filename);
}

void CheckGit(string operation, string pattern)
{
    var nested = pattern == "workspace";
    var repository = Path.Combine(sandbox, operation + "-" + pattern);
    Directory.CreateDirectory(repository);
    string Git(params string[] args) => GitCommandHelper.RunGitCommand(repository, args);
    Git("init", "-q");
    var names = pattern switch
    {
        "workspace" => new[] { "work[12]/data/table.csv", "work1/data/table.csv", "work2/data/table.csv" },
        "glob" => new[] { "data/table*.csv", "data/table1.csv", "data/table2.csv" },
        "magic" => new[] { ":(glob)data/*.csv", "data/table1.csv", "data/table2.csv" },
        _ => new[] { "data/table[12].csv", "data/table1.csv", "data/table2.csv" },
    };
    foreach (var name in names)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.Combine(repository, name))!);
        File.WriteAllText(Path.Combine(repository, name), "original");
    }
    Git("add", "-A");
    Git("-c", "user.name=SecurityTest", "-c", "user.email=tests@example.invalid", "commit", "-qm", "fixture");
    foreach (var name in names) File.WriteAllText(Path.Combine(repository, name), "edited");
    if (operation == "reset") Git("add", "-A");
    AppEnvironment.WorkDir = nested ? Path.Combine(repository, "work[12]") : repository;
    var handler = operation switch
    {
        "add" => (Func<JsonElement, string, object>)WebView2HandlerGitAddRequest.Invoke,
        "reset" => WebView2HandlerGitResetRequest.Invoke,
        _ => WebView2HandlerGitDiscardRequest.Invoke,
    };
    if (OperatingSystem.IsWindows())
    {
        var response = Invoke(handler, new { path = names[0] });
        Expect(response.GetProperty("success").GetBoolean(), "Handler failed: " + response);
    }
    else
    {
        // WPF の native parent lease は Windows 専用。Linux では本番共通 helper と実 Git を検証する。
        var arguments = operation switch
        {
            "add" => new[] { "add", "--", names[0] },
            "reset" => new[] { "reset", "HEAD", "--", names[0] },
            _ => new[] { "checkout", "--", names[0] },
        };
        GitCommandHelper.RunGitLiteralPathCommand(repository, arguments);
    }
    for (var index = 0; index < names.Length; index++)
    {
        var expected = operation == "discard" ? index == 0 ? "original" : "edited" : "edited";
        Expect(File.ReadAllText(Path.Combine(repository, names[index])) == expected, "Working tree modified unexpected file " + names[index]);
        if (operation == "discard") continue;
        var expectedStaged = operation == "add" ? index == 0 ? "edited" : "original" : index == 0 ? "original" : "edited";
        Expect(Git("show", ":" + names[index]) == expectedStaged, "Index modified unexpected file " + names[index]);
    }
}

void CheckWindowsFiles()
{
    AppEnvironment.WorkDir = Path.Combine(sandbox, "normal");
    Directory.CreateDirectory(AppEnvironment.WorkDir);
    var filename = "data/nested/日本語.csv";
    var content = "id,name\n1,日本語\n";
    Expect(Invoke(WebView2HandlerWriteFileRequest.Invoke, new { filename, data = content }).GetProperty("success").GetBoolean(), "Normal write failed");
    var read = Invoke(WebView2HandlerReadFileRequest.Invoke, new { filename });
    Expect(read.GetProperty("success").GetBoolean() && read.GetProperty("data").GetString() == content, "Normal read failed");
    var list = Invoke(WebView2HandlerFindFilesRequest.Invoke, new { directory = "data/nested" });
    Expect(list.GetProperty("success").GetBoolean() && list.GetProperty("data").GetArrayLength() == 1, "Normal enumeration failed");
    Expect(Invoke(WebView2HandlerDeleteFileRequest.Invoke, new { filename }).GetProperty("success").GetBoolean(), "Normal delete failed");
    Expect(!File.Exists(Path.Combine(AppEnvironment.WorkDir, filename)), "Normal file remains");
    Expect(Invoke(WebView2HandlerReadFileRequest.Invoke, new { filename = "missing/nested.csv" }).GetProperty("data").GetString() == "", "Missing file contract changed");
    var absentDirectory = Invoke(WebView2HandlerFindFilesRequest.Invoke, new { directory = "missing/nested" });
    Expect(absentDirectory.GetProperty("success").GetBoolean() && absentDirectory.GetProperty("data").GetArrayLength() == 0, "Missing directory contract changed");
}

void CheckWindowsDeletedParentGit()
{
    var repository = Path.Combine(sandbox, "deleted-parent-git");
    var parent = Path.Combine(repository, "data", "nested");
    Directory.CreateDirectory(parent);
    File.WriteAllText(Path.Combine(parent, "table.csv"), "original");
    string Git(params string[] arguments) => GitCommandHelper.RunGitCommand(repository, arguments);
    Git("init", "-q");
    Git("add", "-A");
    Git("-c", "user.name=SecurityTest", "-c", "user.email=tests@example.invalid", "commit", "-qm", "fixture");
    Directory.Delete(parent, true);
    AppEnvironment.WorkDir = repository;
    var request = new { path = "data/nested/table.csv" };
    Expect(Invoke(WebView2HandlerGitAddRequest.Invoke, request).GetProperty("success").GetBoolean(), "Cannot stage deletion of missing parent");
    Expect(Git("ls-files", "--", request.path).Length == 0, "Deleted file remains staged");
    Expect(Invoke(WebView2HandlerGitResetRequest.Invoke, request).GetProperty("success").GetBoolean(), "Cannot unstage deletion of missing parent");
    Expect(Git("show", ":" + request.path) == "original", "Unstage did not restore index");
    Expect(!Directory.Exists(parent), "Index-only operation recreated working tree");
    Expect(Invoke(WebView2HandlerGitDiscardRequest.Invoke, request).GetProperty("success").GetBoolean(), "Cannot restore file below missing parent");
    Expect(File.ReadAllText(Path.Combine(repository, request.path)) == "original", "Restore did not recreate working tree file");
}

void CheckWindowsParentLock()
{
    var workspace = Path.Combine(sandbox, "locked");
    var parent = Path.Combine(workspace, "data");
    Directory.CreateDirectory(parent);
    using (WorkspaceFileAccess.LockParent(workspace, "data/test.csv", false))
    {
        var moved = false;
        try { Directory.Move(parent, parent + "-moved"); moved = true; }
        catch (IOException) { }
        Expect(!moved, "Pinned parent was renamed");
        var rootMoved = false;
        try { Directory.Move(workspace, workspace + "-moved"); rootMoved = true; }
        catch (IOException) { }
        Expect(!rootMoved, "Pinned workspace was renamed");
        WorkspaceFileAccess.WriteAllText(workspace, "data/test.csv", "allowed");
        Expect(WorkspaceFileAccess.ReadAllText(workspace, "data/test.csv") == "allowed", "Share denial blocked ordinary child IO");
    }
    Directory.Move(parent, parent + "-moved");
    Expect(Directory.Exists(parent + "-moved"), "Parent handle leaked after dispose");
}

void CheckWindowsRace()
{
    var workspace = Path.Combine(sandbox, "race");
    Directory.CreateDirectory(workspace);
    var target = Path.Combine(workspace, "file.csv");
    var outside = Path.Combine(sandbox, "outside-race.csv");
    File.WriteAllText(outside, "untouched");
    using var cancellation = new CancellationTokenSource();
    var attacker = Task.Run(() =>
    {
        while (!cancellation.IsCancellationRequested)
        {
            try
            {
                File.Delete(target);
                File.CreateSymbolicLink(target, outside);
                File.Delete(target);
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    });
    try
    {
        for (var index = 0; index < 500; index++)
        {
            try { WorkspaceFileAccess.WriteAllText(workspace, "file.csv", "internal"); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            try { Expect(WorkspaceFileAccess.ReadAllText(workspace, "file.csv") != "untouched", "Race read outside contents"); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            try { WorkspaceFileAccess.DeleteFile(workspace, "file.csv"); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }
    finally { cancellation.Cancel(); attacker.GetAwaiter().GetResult(); }
    Expect(File.ReadAllText(outside) == "untouched", "Race modified/deleted outside file");
}

void CheckWindowsHardLink()
{
    var workspace = Path.Combine(sandbox, "hardlink");
    Directory.CreateDirectory(workspace);
    var outside = Path.Combine(sandbox, "outside-hardlink.csv");
    File.WriteAllText(outside, "untouched");
    var target = Path.Combine(workspace, "file.csv");
    Expect(NativeFixture.CreateHardLink(target, outside, IntPtr.Zero), "Cannot create hard link fixture");
    AppEnvironment.WorkDir = workspace;
    foreach (var handler in new Func<JsonElement, string, object>[] { WebView2HandlerReadFileRequest.Invoke, WebView2HandlerWriteFileRequest.Invoke, WebView2HandlerDeleteFileRequest.Invoke })
        Expect(!Invoke(handler, new { filename = "file.csv", data = "changed" }).GetProperty("success").GetBoolean(), "Hard-linked file accepted");
    Expect(File.ReadAllText(outside) == "untouched", "Hard link changed outside contents");
}

JsonElement Invoke(Func<JsonElement, string, object> handler, object request) => JsonSerializer.SerializeToElement(handler(JsonSerializer.SerializeToElement(request), Guid.NewGuid().ToString("N")));
void Expect(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }

namespace App.MasterDataEditor
{
    internal static class AppEnvironment
    {
        public static string WorkDir = "";
        public static string GetWorkDir() => WorkDir;
        public static string GetUserDataDir() => Path.Combine(WorkDir, "user");
        public static string NormalizeUserDataRelativePath(string name) => name;
        public static string GetDirectoryName(string name) => Path.GetDirectoryName(name)!;
    }
    internal static class AfterSaveHookRunner { public static void StartIfExists(string workDir, string filename) { } }
    internal static class Logger
    {
        public static void Warning(string message) => Console.WriteLine("WARNING: " + message);
        public static void Error(Exception error, string message) => Console.WriteLine("EXPECTED REJECTION: " + message + " " + error.Message);
    }
}

internal static class NativeFixture
{
    [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true, EntryPoint = "CreateHardLinkW")]
    [return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
    public static extern bool CreateHardLink(string name, string existing, IntPtr security);
}
