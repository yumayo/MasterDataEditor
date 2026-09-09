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
