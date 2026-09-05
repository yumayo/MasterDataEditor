using System.Text.Json;
using App.MasterDataEditor;

var passed = 0;
Run("independent authors and fixed revisions", repo =>
{
    var original = repo.Save("Alice", "id,name,value\n1,before,10\n");
    var name = repo.Save("Bob", "id,name,value\n1,after,10\n");
    var value = repo.Save("Carol", "id,name,value\n1,after,20\n");
    File.WriteAllText(Path.Combine(repo.Root, "unrelated.txt"), "other change");
    var latest = repo.Commit("Unrelated");
    File.WriteAllText(repo.CsvPath, "id,name,value\n1,working-tree,999\n");
    var entries = repo.Find(latest, ["id"], [(2, "id"), (2, "name"), (2, "value")]);
    Equal(3, entries.Length);
    Author(entries, 2, "id", "Alice", original);
    Author(entries, 2, "name", "Bob", name);
    Author(entries, 2, "value", "Carol", value);
    Author(repo.Find(name, ["id"], [(2, "value")]), 2, "value", "Alice", original);
});
Run("row and column reordering with composite keys and quoted CSV", repo =>
{
    var original = repo.Save("Alice", "id,kind,name,value\r\n1,\"a,b\",\"say \"\"hi\"\"\",10\r\n2,z,other,20\r\n");
    var reordered = repo.Save("Sorter", "value,name,kind,id\r\n20,other,z,2\r\n10,\"say \"\"hi\"\"\",\"a,b\",1\r\n");
    Author(repo.Find(reordered, ["id", "kind"], [(3, "name")]), 3, "name", "Alice", original);
    var changed = repo.Save("Bob", "value,name,kind,id\n20,other,z,2\n10,new,\"a,b\",1\n");
    var entries = repo.Find(changed, ["id", "kind"], [(3, "name"), (3, "value")]);
    Author(entries, 3, "name", "Bob", changed);
    Author(entries, 3, "value", "Alice", original);
});
Run("reverts belong to the reverting commit", repo =>
{
    repo.Save("Alice", "id,name\n1,before\n");
    repo.Save("Bob", "id,name\n1,after\n");
    var reverted = repo.Save("Reverter", "id,name\n1,before\n");
    Author(repo.Find(reverted, ["id"], [(2, "name")]), 2, "name", "Reverter", reverted);
});
foreach (var resolvesConflict in new[] {false, true})
{
    Run(resolvesConflict ? "merge resolution" : "merge inherits each parent cell", repo =>
    {
        repo.Save("Alice", "id,name,value\n1,before,10\n");
        var main = repo.Git("branch", "--show-current").Trim();
        repo.Git("checkout", "-b", "incoming");
        var name = repo.Save("Bob", "id,name,value\n1,after,10\n");
        repo.Git("checkout", main);
        var value = repo.Save("Carol", "id,name,value\n1,before,20\n");
        try { repo.Git("-c", "user.name=Merger", "-c", "user.email=test@example.com", "merge", "--no-commit", "--no-ff", "incoming"); }
        catch (InvalidOperationException) { /* 同じCSV行の競合を次のSaveで解消する。 */ }
        var merged = repo.Save("Merger", resolvesConflict ? "id,name,value\n1,resolved,20\n" : "id,name,value\n1,after,20\n");
        Equal(2, repo.Git("show", "-s", "--format=%P", merged).Trim().Split(' ').Length);
        var entries = repo.Find(merged, ["id"], [(2, "name"), (2, "value")]);
        Author(entries, 2, "name", resolvesConflict ? "Merger" : "Bob", resolvesConflict ? merged : name);
        Author(entries, 2, "value", "Carol", value);
    });
}
Run("primary key changes introduce a new row", repo =>
{
    repo.Save("Alice", "id,name\n1,unchanged\n");
    var changed = repo.Save("KeyEditor", "id,name\n9,unchanged\n");
    Author(repo.Find(changed, ["id"], [(2, "name")]), 2, "name", "KeyEditor", changed);
});
Run("identical merge parents prefer the first parent", repo =>
{
    repo.Save("Alice", "id,name\n1,before\n");
    var main = repo.Git("branch", "--show-current").Trim();
    repo.Git("checkout", "-b", "incoming");
    repo.Save("Bob", "id,name\n1,after\n");
    repo.Git("checkout", main);
    var first = repo.Save("Carol", "id,name\n1,after\n");
    repo.Git("-c", "user.name=Merger", "-c", "user.email=test@example.com", "merge", "--no-ff", "-m", "merge equal values", "incoming");
    Author(repo.Find("HEAD", ["id"], [(2, "name")]), 2, "name", "Carol", first);
});
Run("duplicate primary keys are not guessed", repo =>
{
    repo.Save("Alice", "id,name\n1,one\n1,two\n");
    Equal(0, repo.Find("HEAD", ["id"], [(2, "name"), (3, "name")]).Length);
    var unique = repo.Save("Deleter", "id,name\n1,one\n");
    Equal(0, repo.Find(unique, ["id"], [(2, "name")]).Length);
});
Run("blank added columns and added rows", repo =>
{
    var original = repo.Save("Alice", "id,name\n1,one\n");
    var added = repo.Save("Adder", "id,name,extra\n1,one,\n2,two,\n");
    var entries = repo.Find(added, ["id"], [(2, "name"), (2, "extra"), (3, "name")]);
    Author(entries, 2, "name", "Alice", original);
    Author(entries, 2, "extra", "Adder", added);
    Author(entries, 3, "name", "Adder", added);
});
Run("renamed paths and deleted working files", repo =>
{
    var original = repo.Save("Alice", "id,name\n1,one\n");
    var previousPath = repo.CsvPath;
    repo.RelativePath = "nested/data/renamed [table].csv";
    File.Move(previousPath, repo.CsvPath);
    var renamed = repo.Commit("Renamer");
    File.Delete(repo.CsvPath);
    Author(repo.Find(renamed, ["id"], [(2, "name")]), 2, "name", "Alice", original);
});
Run("physical CSV lines survive blank lines and quoted multiline fields", repo =>
{
    var original = repo.Save("Alice", "id,name\n1,\"line one\nline two\"\n\n2,second\n");
    var entries = repo.Find(original, ["id"], [(2, "name"), (5, "name")]);
    Author(entries, 2, "name", "Alice", original);
    Author(entries, 5, "name", "Alice", original);
});
Run("shallow boundaries remain unknown", repo =>
{
    repo.Save("Alice", "id,name,value\n1,before,10\n");
    repo.Save("Bob", "id,name,value\n1,after,10\n");
    var clone = Path.Combine(Path.GetTempPath(), "cell-history-shallow-" + Guid.NewGuid());
    try
    {
        repo.Git("clone", "--depth", "1", new Uri(repo.Root).AbsoluteUri, clone);
        AppEnvironment.WorkDir = Path.Combine(clone, "nested");
        var sha = GitCommandHelper.RunGitCommand(clone, "rev-parse", "HEAD").Trim();
        var response = Repo.Invoke("data/table.csv", sha, ["id"], [(2, "name"), (2, "value")]);
        Equal(true, response.GetProperty("success").GetBoolean());
        Equal(0, response.GetProperty("data").GetArrayLength());
    }
    finally { if (Directory.Exists(clone)) Directory.Delete(clone, true); }
});
Run("invalid request arguments are rejected", repo =>
{
    var sha = repo.Save("Alice", "id,name\n1,before\n");
    foreach (var invalid in new[] {"--help", "HEAD", "1111111\n"}) Equal(false, Repo.Invoke("data/table.csv", invalid, ["id"], [(2, "name")]).GetProperty("success").GetBoolean());
    Equal(false, Repo.Invoke("../data/table.csv", sha, ["id"], [(2, "name")]).GetProperty("success").GetBoolean());
    Equal(false, Repo.Invoke("data/table.csv", sha, [], [(2, "name")]).GetProperty("success").GetBoolean());
    Equal(false, Repo.Invoke("data/table.csv", sha, ["id"], [(1, "name")]).GetProperty("success").GetBoolean());
});
Console.WriteLine($"PASS: {passed} Git cell history scenarios");

void Run(string name, Action<Repo> test)
{
    using var repo = new Repo();
    test(repo);
    passed++;
    Console.WriteLine("PASS: " + name);
}
static void Equal<T>(T expected, T actual)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new Exception($"Expected {expected}, got {actual}");
}
static void Author(JsonElement[] entries, int line, string column, string author, string commit)
{
    var entry = entries.Single(entry => entry.GetProperty("lineNumber").GetInt32() == line && entry.GetProperty("columnName").GetString() == column);
    Equal(author, entry.GetProperty("author").GetString());
    Equal(commit, entry.GetProperty("commitHash").GetString());
}

sealed class Repo : IDisposable
{
    public string Root { get; } = Path.Combine(Path.GetTempPath(), "cell-history-test-" + Guid.NewGuid());
    public string RelativePath { get; set; } = "nested/data/table.csv";
    public string CsvPath => Path.Combine(Root, RelativePath);
    public Repo()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(CsvPath)!);
        Git("init", "-q");
        AppEnvironment.WorkDir = Path.Combine(Root, "nested");
    }
    public string Git(params string[] args) => GitCommandHelper.RunGitCommand(Root, args);
    public string Save(string author, string csv) { File.WriteAllText(CsvPath, csv); return Commit(author); }
    public string Commit(string author)
    {
        Git("add", "-A");
        Git("-c", "user.name=" + author, "-c", "user.email=test@example.com", "commit", "-qm", "Change by " + author);
        return Git("rev-parse", "HEAD").Trim();
    }
    public JsonElement[] Find(string sha, string[] keys, (int Line, string Column)[] cells)
    {
        if (sha == "HEAD") sha = Git("rev-parse", "HEAD").Trim();
        var response = Invoke(RelativePath, sha, keys, cells);
        if (!response.GetProperty("success").GetBoolean()) throw new Exception(response.ToString());
        return response.GetProperty("data").EnumerateArray().ToArray();
    }
    public static JsonElement Invoke(string path, string sha, string[] keys, (int Line, string Column)[] cells)
    {
        var request = JsonSerializer.SerializeToElement(new {filename = path, commit = sha, primaryKey = keys, cells = cells.Select(cell => new {lineNumber = cell.Line, columnName = cell.Column}).ToArray()});
        return JsonSerializer.SerializeToElement(WebView2HandlerGitCellBlameRequest.Invoke(request, "test"));
    }
    public void Dispose() => Directory.Delete(Root, true);
}

namespace App.MasterDataEditor
{
    internal static class AppEnvironment
    {
        public static string WorkDir = "";
        public static string GetWorkDir() => WorkDir;
    }
    internal static class Logger
    {
        public static void Error(Exception error, string message) { }
    }
}
