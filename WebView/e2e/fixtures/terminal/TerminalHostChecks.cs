using System.Text.Json;
using System.Threading.Channels;
using App.MasterDataEditor.Terminal;

internal static class TerminalHostChecks
{
    public static async Task RunAsync()
    {
        var responses = Channel.CreateUnbounded<JsonElement>();
        using var host = new TerminalHost((message, token) => responses.Writer.WriteAsync(JsonSerializer.SerializeToElement(message), token).AsTask());
        // ACK は応答や要求 FIFO を占有せず、不明なセッションの ACK は破棄する。
        host.HandleOutputAcknowledgement(JsonSerializer.SerializeToElement(new { sessionId = "stale", outputId = "stale" }));
        host.HandleOutputAcknowledgement(JsonSerializer.SerializeToElement(new { sessionId = 42, outputId = false }));
        host.HandleRequest(JsonSerializer.SerializeToElement(new { type = "terminal_input_request", requestId = "first", sessionId = "missing", data = "text" }));
        host.HandleRequest(JsonSerializer.SerializeToElement(new { type = "terminal_close_request", requestId = "second", sessionId = "missing" }));
        var first = await responses.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
        var second = await responses.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
        if (first.GetProperty("requestId").GetString() != "first" || first.GetProperty("success").GetBoolean()) throw new Exception("未起動セッションの入力が成功しました。");
        if (second.GetProperty("requestId").GetString() != "second" || !second.GetProperty("success").GetBoolean()) throw new Exception("遅延 close または要求 FIFO の処理が不正です。");
        for (var index = 0; index < 2; index++)
        {
            host.HandleRequest(JsonSerializer.SerializeToElement(new { type = "terminal_start_request", requestId = "invalid-" + index, sessionId = "invalid-session", cols = 0, rows = 24 }));
            var invalid = await responses.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
            if (invalid.GetProperty("success").GetBoolean() || !invalid.GetProperty("stack").GetString()!.Contains("ArgumentOutOfRangeException", StringComparison.Ordinal)) throw new Exception("開始失敗後にセッションが残るか、サイズ検証が失われました。");
        }

        // ドキュメントを破棄した時点で Dispatcher 待ちと旧要求を解除する。
        var blocked = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var navigatingHost = new TerminalHost(async (message, token) =>
        {
            var json = JsonSerializer.SerializeToElement(message);
            if (json.GetProperty("requestId").GetString() == "blocked")
            {
                blocked.TrySetResult();
                await Task.Delay(Timeout.Infinite, token);
            }
            else await responses.Writer.WriteAsync(json, token);
        });
        navigatingHost.HandleRequest(JsonSerializer.SerializeToElement(new { type = "terminal_close_request", requestId = "blocked", sessionId = "missing" }));
        navigatingHost.HandleRequest(JsonSerializer.SerializeToElement(new { type = "terminal_close_request", requestId = "old-document", sessionId = "missing" }));
        await blocked.Task.WaitAsync(TimeSpan.FromSeconds(2));
        navigatingHost.ResetDocument();
        navigatingHost.HandleRequest(JsonSerializer.SerializeToElement(new { type = "terminal_close_request", requestId = "new-document", sessionId = "missing" }));
        var current = await responses.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
        if (current.GetProperty("requestId").GetString() != "new-document") throw new Exception("旧ドキュメントの要求が新ドキュメントへ混入しました。");
        Console.WriteLine("PASS: Host 要求 FIFO・未起動入力・遅延 close・不正開始からの回復・ACK 分離・ドキュメント取消");
    }
}

// WPF 依存を持つアプリ設定とログだけを置き換え、実際の TerminalHost をオフライン検証する。
namespace App.MasterDataEditor
{
    internal static class AppEnvironment
    {
        public static string GetWorkDir() => Path.GetTempPath();
    }

    internal static class Logger
    {
        public static void Error(Exception error, string message) => Console.Error.WriteLine($"{message} {error}");
    }
}
