using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using App.MasterDataEditor;

if (!OperatingSystem.IsWindows())
{
    Console.WriteLine("SKIP 実APPDATAへの信頼保存・復元とhandle保護はWindowsで確認してください");
    return;
}

if (args.Length == 3 && args[0] == "--restore-check")
{
    WorkspaceTrust.RestoreFromNativeStore(args[1]);
    if (WorkspaceTrust.IsTrusted(args[1]) != bool.Parse(args[2])) Environment.ExitCode = 1;
    return;
}

var workDir = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.Combine(Path.GetTempPath(), "workspace-trust-files-" + Guid.NewGuid().ToString("N"))));
var filename = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(workDir.ToUpperInvariant()))) + ".json";
var directory = AppEnvironment.GetNativeTrustDirectory();
var recordPath = Path.Combine(directory, filename);
try
{
    WorkspaceTrust.GrantFromNativeUi(workDir);
    using (var record = JsonDocument.Parse(File.ReadAllText(recordPath)))
    {
        if (record.RootElement.GetProperty("version").GetInt32() != 1 || !string.Equals(record.RootElement.GetProperty("path").GetString(), workDir, StringComparison.OrdinalIgnoreCase)) throw new Exception("APPDATAへ正規化パスを保存できません");
    }
    CheckFreshProcess(workDir, true);
    Console.WriteLine("PASS APPDATAへ保存し次回プロセスで信頼を復元");

    WorkspaceTrust.RestoreFromNativeStore(workDir + "-other");
    if (WorkspaceTrust.IsTrusted(workDir + "-other") || WorkspaceTrust.IsTrusted(workDir)) throw new Exception("別フォルダーが信頼済みになりました");
    WorkspaceTrust.RestoreFromNativeStore(workDir.ToUpperInvariant() + Path.DirectorySeparatorChar);
    if (!WorkspaceTrust.IsTrusted(workDir)) throw new Exception("大小文字と末尾区切り違いの同じフォルダーを復元できません");
    Console.WriteLine("PASS 同じフォルダーだけを復元");

    var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
    var relativePath = Path.GetRelativePath(appData, recordPath);
    foreach (var operation in new Action[] { () => WorkspaceFileAccess.ReadAllText(appData, relativePath), () => WorkspaceFileAccess.WriteAllText(appData, relativePath, "forged"), () => WorkspaceFileAccess.DeleteFile(appData, relativePath), () => WorkspaceFileAccess.FindEntries(appData, Path.GetRelativePath(appData, directory)) })
    {
        var rejected = false;
        try { operation(); }
        catch (UnauthorizedAccessException) { rejected = true; }
        if (!rejected || !NativeWorkspaceTrustStore.Read(workDir)) throw new Exception("通常ファイルAPIから信頼保存領域へ到達しました");
    }
    Console.WriteLine("PASS APPDATA祖先からの通常ファイルAPIを拒否");

    WorkspaceTrust.Revoke();
    if (File.Exists(recordPath)) throw new Exception("解除した信頼ファイルが残っています");
    CheckFreshProcess(workDir, false);
    Console.WriteLine("PASS 解除を保存し次回プロセスでも復元しない");

    foreach (var invalid in new[] { "", "{}", "[]", "null", "{\"version\":9999999999999999999999,\"path\":\"wrong\"}", JsonSerializer.Serialize(new {version = 1, path = workDir + "-other"}) })
    {
        File.WriteAllText(recordPath, invalid);
        var rejected = false;
        try { WorkspaceTrust.RestoreFromNativeStore(workDir); }
        catch (InvalidDataException) { rejected = true; }
        if (!rejected || WorkspaceTrust.IsTrusted(workDir)) throw new Exception("不正JSONまたは不一致パスが信頼されました");
    }
    Console.WriteLine("PASS 不正な保存値を信頼しない");
}
finally
{
    // この実行専用のレコードだけを削除し、既存の信頼設定には触れない。
    File.Delete(recordPath);
}

static void CheckFreshProcess(string workDir, bool expected)
{
    var start = new ProcessStartInfo(Environment.ProcessPath ?? throw new InvalidOperationException("実行ファイルを取得できません")) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
    if (string.Equals(Path.GetFileNameWithoutExtension(start.FileName), "dotnet", StringComparison.OrdinalIgnoreCase)) start.ArgumentList.Add(typeof(WorkspaceTrust).Assembly.Location);
    start.ArgumentList.Add("--restore-check");
    start.ArgumentList.Add(workDir);
    start.ArgumentList.Add(expected.ToString());
    using var child = Process.Start(start) ?? throw new InvalidOperationException("復元確認プロセスを開始できません");
    var output = child.StandardOutput.ReadToEnd();
    var error = child.StandardError.ReadToEnd();
    child.WaitForExit();
    if (child.ExitCode != 0) throw new Exception("別プロセスの信頼復元結果が一致しません: " + output + error);
}
