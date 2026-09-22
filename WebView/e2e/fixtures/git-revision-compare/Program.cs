using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using App.MasterDataEditor;

foreach (var format in new[] {"sha1", "sha256"})
{
    var root = Path.Combine(Path.GetTempPath(), "revision-compare-test-" + Guid.NewGuid());
    var workDir = Path.Combine(root, "nested");
    Directory.CreateDirectory(Path.Combine(workDir, "data"));
    Directory.CreateDirectory(Path.Combine(workDir, ".masterdataeditor"));
    Directory.CreateDirectory(Path.Combine(root, ".masterdataeditor"));
    AppEnvironment.WorkDir = workDir;
    string Git(params string[] args) => GitCommandHelper.RunGitCommand(root, args);
    void Save(string path, string content) => File.WriteAllText(Path.Combine(workDir, path), content);
    string Commit()
    {
        Git("add", "-A");
        Git("-c", "user.name=Tester", "-c", "user.email=test@example.com", "commit", "-qm", "test");
        return Git("rev-parse", "HEAD").Trim();
    }
    try
    {
        Git("init", "-q", "--object-format=" + format, "--initial-branch=main");
        File.WriteAllText(Path.Combine(root, ".masterdataeditor/settings.json"), "{\"exportValidationDateTime\":\"2020-01-01T00:00:00\"}");
        Save(".masterdataeditor/settings.json", "{\"exportValidationDateTime\":\"2026-09-22T12:00:00\"}");
        Save(".masterdataeditor/private.json", "{}");
        Save("data/modified.csv", "id,name\n1,before\n");
        Save("data/deleted.csv", "id,name\n1,removed\n");
        var left = Commit();
        Git("branch", "base");
        Git("update-ref", "refs/remotes/origin/base", left);
        Save("data/modified.csv", "id,name\n1,after\n");
        Save("data/added.csv", "id,name\n1,added\n");
        Save(".masterdataeditor/settings.json", "{\"exportValidationDateTime\":\"2027-06-01T12:00:00\"}");
        File.Delete(Path.Combine(workDir, "data/deleted.csv"));
        var right = Commit();
        Save("data/modified.csv", "id,name\n1,uncommitted\n");
        Save(".masterdataeditor/settings.json", "{\"exportValidationDateTime\":\"2028-01-01T00:00:00\"}");

        // ネストしたワークスペースでも、作業中の設定ではなく指定コミットの設定を読む。
        Equal("{\"exportValidationDateTime\":\"2026-09-22T12:00:00\"}", Show(left, ".masterdataeditor/settings.json").GetProperty("data").GetString());
        Equal("{\"exportValidationDateTime\":\"2027-06-01T12:00:00\"}", Show(right, ".masterdataeditor/settings.json").GetProperty("data").GetString());
        Equal("id,name\n1,before\n", Show(left, "data/modified.csv").GetProperty("data").GetString());
        foreach (var invalidPath in new[] {".masterdataeditor/private.json", "../.masterdataeditor/settings.json", ".masterdataeditor/../settings.json", "/.masterdataeditor/settings.json", "nested/.masterdataeditor/settings.json"})
            Equal(false, Show(left, invalidPath).GetProperty("success").GetBoolean());
        AppEnvironment.WorkDir = root;
        Equal("{\"exportValidationDateTime\":\"2020-01-01T00:00:00\"}", Show(left, ".masterdataeditor/settings.json").GetProperty("data").GetString());
        AppEnvironment.WorkDir = workDir;

        foreach (var (leftRef, rightRef) in new[] {
            (left, right), (left[..4], right[..7]), (left.ToUpperInvariant(), right.ToUpperInvariant()),
            ("refs/heads/base", right), (left, "refs/heads/main"),
            ("refs/remotes/origin/base", "refs/heads/main"),
        })
        {
            var data = Compare(leftRef, rightRef);
            Equal(left, data.GetProperty("leftCommit").GetString());
            Equal(right, data.GetProperty("rightCommit").GetString());
            Equal("data/added.csv:A,data/deleted.csv:D,data/modified.csv:M", Files(data));
        }
        Equal("data/added.csv:D,data/deleted.csv:A,data/modified.csv:M", Files(Compare(right, left)));
        Equal(0, Compare(left[..7], left).GetProperty("files").GetArrayLength());

        var blob = Git("rev-parse", right + ":nested/data/modified.csv").Trim();
        var tree = Git("rev-parse", right + "^{tree}").Trim();
        foreach (var invalid in new[] {"", "abc", "ggggggg", "--help", "HEAD~1", "refs/tags/nope", "1111111\n", new string('f', right.Length), blob, tree})
        {
            Equal(false, Invoke(invalid, right).GetProperty("success").GetBoolean());
            Equal(false, Invoke(left, invalid).GetProperty("success").GetBoolean());
        }
        Equal(false, Invoke(left, left).GetProperty("success").GetBoolean());

        // 実在する2コミットに同じ4桁プレフィックスを持たせ、曖昧な短縮IDを検証する。
        if (format == "sha1")
        {
            var prefixes = new Dictionary<string, string>();
            for (var index = 0; ; index++)
            {
                var content = $"tree {tree}\nparent {right}\nauthor Tester <test@example.com> 1 +0000\ncommitter Tester <test@example.com> 1 +0000\n\n{index}\n";
                var bytes = Encoding.UTF8.GetBytes(content);
                var hash = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes($"commit {bytes.Length}\0").Concat(bytes).ToArray())).ToLowerInvariant();
                var prefix = hash[..4];
                if (!prefixes.TryGetValue(prefix, out var previous)) { prefixes.Add(prefix, content); continue; }
                foreach (var commit in new[] {previous, content})
                {
                    Save("object.txt", commit);
                    Git("hash-object", "-t", "commit", "-w", Path.Combine(workDir, "object.txt"));
                }
                var error = Invoke(prefix, right);
                Equal(false, error.GetProperty("success").GetBoolean());
                if (!error.GetProperty("error").GetString()!.Contains("比較元のコミットを特定できません")) throw new Exception(error.ToString());
                break;
            }
        }

        Git("checkout", "--detach", "-q", right);
        Git("branch", "-D", "main", "base");
        Git("update-ref", "-d", "refs/remotes/origin/base");
        Equal(0, GitCommandHelper.GetBranchReferences(root).Count);
        Equal(3, Compare(left, right).GetProperty("files").GetArrayLength());
        Console.WriteLine("PASS: " + format + " branches, commit IDs, validation and detached HEAD");
    }
    finally { Directory.Delete(root, true); }
}
Console.WriteLine("PASS: Git revision compare scenarios");

static JsonElement Invoke(string leftRef, string rightRef)
{
    var request = JsonSerializer.SerializeToElement(new {leftRef, rightRef});
    return JsonSerializer.SerializeToElement(WebView2HandlerGitBranchCompareRequest.Invoke(request, "test"));
}
static JsonElement Show(string commit, string path)
{
    var request = JsonSerializer.SerializeToElement(new {commit, path});
    return JsonSerializer.SerializeToElement(WebView2HandlerGitShowAtCommitRequest.Invoke(request, "test"));
}
static JsonElement Compare(string leftRef, string rightRef)
{
    var response = Invoke(leftRef, rightRef);
    if (!response.GetProperty("success").GetBoolean()) throw new Exception(response.ToString());
    return response.GetProperty("data");
}
static string Files(JsonElement data) => string.Join(",", data.GetProperty("files").EnumerateArray().Select(file => file.GetProperty("path").GetString() + ":" + file.GetProperty("status").GetString()));
static void Equal<T>(T expected, T actual)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new Exception($"Expected {expected}, got {actual}");
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
