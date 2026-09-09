using System.Text.Json;
using App.MasterDataEditor;

var directory = Path.Combine(Path.GetTempPath(), "blame-timing-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(Path.Combine(directory, "data"));
AppEnvironment.WorkDir = directory;
try
{
    GitCommandHelper.RunGitCommand(directory, "init", "-q");
    File.WriteAllText(Path.Combine(directory, "data", "test.csv"), "id,name\n1,one\n2,two\n");
    GitCommandHelper.RunGitCommand(directory, "add", "data/test.csv");
    GitCommandHelper.RunGitCommand(directory, "-c", "user.name=Alice", "-c", "user.email=test@example.com", "commit", "-qm", "initial");
    var timings = new List<JsonElement>();
    var timing = new GitBlameTiming("request-1", "data/test.csv", value => timings.Add(JsonSerializer.SerializeToElement(value)));
    var request = JsonSerializer.SerializeToElement(new {filename = "data/test.csv"});
    var response = JsonSerializer.SerializeToElement(WebView2HandlerGitBlameRequest.Invoke(request, "request-1", timing));
    Assert(response.GetProperty("success").GetBoolean(), "successful response");
    var entries = response.GetProperty("data").EnumerateArray().ToArray();
    Assert(entries.Length == 3, "all lines preserved");
    Assert(entries[2].GetProperty("lineNumber").GetInt32() == 3, "line number preserved");
    Assert(entries.All(entry => entry.GetProperty("author").GetString() == "Alice"), "author preserved");
    Assert(timings.Select(item => item.GetProperty("stage").GetString()).SequenceEqual(new[] {
        "resolve_git_root", "git_command_and_read_stdout", "porcelain_split_lines", "porcelain_parse_entries",
    }), "stage order");
    foreach (var item in timings)
    {
        Assert(item.GetProperty("requestId").GetString() == "request-1", "correlation ID");
        Assert(item.GetProperty("type").GetString() == "git_blame_timing", "wire type");
        var duration = item.GetProperty("durationMs").GetDouble();
        Assert(double.IsFinite(duration) && duration >= 0, "finite non-negative duration");
        Assert(!item.TryGetProperty("data", out _), "timing does not duplicate payload");
    }
    Assert(timings[1].GetProperty("chars").GetInt64() > 0, "stdout size");
    Assert(timings[3].GetProperty("entryCount").GetInt32() == 3, "entry count");
    Assert(Logger.Messages.Count == timings.Count, "host log also receives timings");

    // 範囲取得でも絶対行番号と著者を保持し、隣接チャンクの結合で全データ行を復元できる。
    var ranged = new List<JsonElement>();
    foreach (var line in new[] {2, 3})
    {
        timings.Clear();
        var part = JsonSerializer.SerializeToElement(WebView2HandlerGitBlameRequest.Invoke(
            JsonSerializer.SerializeToElement(new {filename = "data/test.csv", startLine = line, endLine = line}), "request-1", timing));
        Assert(part.GetProperty("success").GetBoolean(), "ranged response");
        var data = part.GetProperty("data").EnumerateArray().ToArray();
        Assert(data.Length == 1 && data[0].GetProperty("lineNumber").GetInt32() == line, "only requested absolute line");
        Assert(timings.All(item => item.GetProperty("startLine").GetInt32() == line), "range on timing entries");
        ranged.AddRange(data);
    }
    Assert(ranged.Select(item => item.GetRawText()).SequenceEqual(entries.Skip(1).Select(item => item.GetRawText())), "chunks reconstruct data blame");
    // GitはendLineがEOFを越えた場合、実際の末尾までを返す。
    var tail = JsonSerializer.SerializeToElement(WebView2HandlerGitBlameRequest.Invoke(
        JsonSerializer.SerializeToElement(new {filename = "data/test.csv", startLine = 3, endLine = 100}), "tail"));
    Assert(tail.GetProperty("success").GetBoolean() && tail.GetProperty("data").GetArrayLength() == 1, "EOF clamp");
    var commit = GitCommandHelper.RunGitCommand(directory, "rev-parse", "HEAD").Trim();
    var historical = JsonSerializer.SerializeToElement(WebView2HandlerGitBlameRequest.Invoke(
        JsonSerializer.SerializeToElement(new {filename = "data/test.csv", startLine = 2, endLine = 3, commit}), "historical"));
    Assert(historical.GetProperty("success").GetBoolean() && historical.GetProperty("data").GetArrayLength() == 2, "revision and range coexist");
    foreach (var invalid in new[] {
        "{\"startLine\":0,\"endLine\":2}", "{\"startLine\":3,\"endLine\":2}",
        "{\"startLine\":2}", "{\"endLine\":2}", "{\"startLine\":\"2\",\"endLine\":3}",
        "{\"startLine\":2.5,\"endLine\":3}", "{\"startLine\":1,\"endLine\":10001}",
        "{\"startLine\":1,\"endLine\":2147483648}",
    })
    {
        using var invalidRequest = JsonDocument.Parse(invalid.Insert(1, "\"filename\":\"data/test.csv\","));
        var rejected = JsonSerializer.SerializeToElement(WebView2HandlerGitBlameRequest.Invoke(invalidRequest.RootElement, "invalid"));
        Assert(!rejected.GetProperty("success").GetBoolean(), "invalid range rejected: " + invalid);
    }

    timings.Clear();
    var missing = JsonSerializer.SerializeToElement(new {filename = "data/missing.csv"});
    var failure = JsonSerializer.SerializeToElement(WebView2HandlerGitBlameRequest.Invoke(missing, "request-1", timing));
    Assert(!failure.GetProperty("success").GetBoolean(), "Git errors remain errors");
    Assert(timings.Last().GetProperty("stage").GetString() == "handler_failed_total", "failed request timing");
    Assert(!timings.Last().GetProperty("success").GetBoolean(), "failed timing status");
    Console.WriteLine("PASS: Git blame timing");
}
finally
{
    Directory.Delete(directory, true);
}

static void Assert(bool condition, string label)
{
    if (!condition) throw new Exception(label);
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
        public static readonly List<string> Messages = new();
        public static void Info(object message) => Messages.Add(message.ToString()!);
        public static void Error(Exception error, string message) { }
    }
}
