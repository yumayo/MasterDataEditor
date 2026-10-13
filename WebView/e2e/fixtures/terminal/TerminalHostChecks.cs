using System.Text.Json;
using System.Threading.Channels;
using App.MasterDataEditor.Terminal;
using App.MasterDataEditor;

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

        host.HandleRequest(JsonSerializer.SerializeToElement(new { type = "terminal_ai_status_request", requestId = "ai-status", sessionId = "ai", workspace = "C:\\browser-supplied" }));
        var aiStatus = await responses.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
        if (!aiStatus.GetProperty("success").GetBoolean() || aiStatus.GetProperty("data").GetProperty("cwd").GetString() != AppEnvironment.GetWorkDir()) throw new Exception("AI がアプリの作業フォルダーを使用していません。");
        foreach (var type in new[] { "terminal_ai_start_request", "terminal_ai_install_request" })
        {
            foreach (var invalidTool in new object?[] { null, 42, "", "unknown", "Claude", "codex ", "claude; Write-Output injected" })
            {
                var invalidRequest = new { type, requestId = "invalid-tool", sessionId = "ai-invalid", cols = 0, rows = 24, tool = invalidTool };
                host.HandleRequest(JsonSerializer.SerializeToElement(invalidRequest));
                var invalid = await responses.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
                if (invalid.GetProperty("success").GetBoolean() || !invalid.GetProperty("stack").GetString()!.Contains("ArgumentException", StringComparison.Ordinal)) throw new Exception("不正なAI toolが起動処理より先に拒否されませんでした。");
            }
            host.HandleRequest(JsonSerializer.SerializeToElement(new { type, requestId = "missing-tool", sessionId = "ai-invalid", cols = 0, rows = 24 }));
            var missing = await responses.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
            if (missing.GetProperty("success").GetBoolean() || !missing.GetProperty("stack").GetString()!.Contains("ArgumentException", StringComparison.Ordinal)) throw new Exception("AI toolの欠落を拒否しませんでした。");
            foreach (var tool in new[] { "claude", "codex" })
            {
                host.HandleRequest(JsonSerializer.SerializeToElement(new { type, requestId = "valid-tool", sessionId = "ai-invalid", cols = 0, rows = 24, tool }));
                var valid = await responses.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
                if (valid.GetProperty("success").GetBoolean() || !valid.GetProperty("stack").GetString()!.Contains("ArgumentOutOfRangeException", StringComparison.Ordinal)) throw new Exception("有効なAI toolが許可されないか、失敗後にセッションが残っています。");
            }
        }
        WorkspaceTrust.Revoke();
        foreach (var type in new[] { "terminal_ai_status_request", "terminal_ai_start_request", "terminal_ai_install_request" })
        {
            host.HandleRequest(JsonSerializer.SerializeToElement(new { type, requestId = type, sessionId = "untrusted", cols = 80, rows = 24, tool = "claude" }));
            var denied = await responses.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
            if (denied.GetProperty("success").GetBoolean() || !denied.GetProperty("stack").GetString()!.Contains("UnauthorizedAccessException", StringComparison.Ordinal)) throw new Exception("未信頼の AI 操作が拒否されませんでした。");
        }
        WorkspaceTrust.GrantFromNativeUi(AppEnvironment.GetWorkDir());

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
        Console.WriteLine("PASS: Host 要求 FIFO・未起動入力・遅延 close・不正開始からの回復・ACK 分離・ドキュメント取消・AI tool 検証・作業フォルダーと信頼保護");
    }

    public static async Task RunWindowsAsync()
    {
        var repository = Path.Combine(AppEnvironment.GetUserDataDir(), "ai-container");
        Directory.CreateDirectory(Path.Combine(repository, ".git"));
        await File.WriteAllTextAsync(Path.Combine(repository, "start-wsl-containers.ps1"), "param([string]$Workspace, [string]$Tool)\nWrite-Output 'AI_HOST_READY'\nStart-Sleep -Seconds 300");
        try
        {
            var messages = Channel.CreateUnbounded<JsonElement>();
            using var host = new TerminalHost((message, token) => messages.Writer.WriteAsync(JsonSerializer.SerializeToElement(message), token).AsTask());
            host.HandleRequest(JsonSerializer.SerializeToElement(new { type = "terminal_start_request", requestId = "shell-start", sessionId = "shell", cols = 80, rows = 24 }));
            if (!(await ReadResponseAsync(host, messages, "shell-start")).GetProperty("success").GetBoolean()) throw new Exception("通常端末を開始できません。");
            host.HandleRequest(JsonSerializer.SerializeToElement(new { type = "terminal_ai_install_request", requestId = "ai-start", sessionId = "ai", cols = 80, rows = 24, tool = "claude" }));
            var claude = await ReadResponseAsync(host, messages, "ai-start");
            if (!claude.GetProperty("success").GetBoolean() || claude.GetProperty("data").GetProperty("shell").GetString() != "Claude · Windows PowerShell") throw new Exception("通常端末と Claude を同時に開始できません。");
            foreach (var type in new[] { "terminal_start_request", "terminal_ai_start_request", "terminal_ai_install_request" })
            {
                host.HandleRequest(JsonSerializer.SerializeToElement(new { type, requestId = type, sessionId = "duplicate", cols = 80, rows = 24, tool = "claude" }));
                if ((await ReadResponseAsync(host, messages, type)).GetProperty("success").GetBoolean()) throw new Exception("同じ種類の端末を重複起動できました。");
            }
            host.HandleRequest(JsonSerializer.SerializeToElement(new { type = "terminal_close_request", requestId = "ai-close", sessionId = "ai" }));
            if (!(await ReadResponseAsync(host, messages, "ai-close")).GetProperty("success").GetBoolean()) throw new Exception("AI を終了できません。");
            host.HandleRequest(JsonSerializer.SerializeToElement(new { type = "terminal_input_request", requestId = "shell-alive", sessionId = "shell", data = "Write-Output 'SHELL_ALIVE'\r" }));
            if (!(await ReadResponseAsync(host, messages, "shell-alive")).GetProperty("success").GetBoolean()) throw new Exception("AI 終了で通常端末まで終了しました。");
            host.HandleRequest(JsonSerializer.SerializeToElement(new { type = "terminal_ai_start_request", requestId = "ai-restart", sessionId = "ai-new", cols = 80, rows = 24, tool = "codex" }));
            var codex = await ReadResponseAsync(host, messages, "ai-restart");
            if (!codex.GetProperty("success").GetBoolean() || codex.GetProperty("data").GetProperty("shell").GetString() != "Codex · Windows PowerShell") throw new Exception("Claude の終了後に Codex を開始できません。");
            host.ResetDocument();
            foreach (var sessionId in new[] { "shell", "ai-new" })
            {
                host.HandleRequest(JsonSerializer.SerializeToElement(new { type = "terminal_input_request", requestId = sessionId, sessionId, data = "x" }));
                if ((await ReadResponseAsync(host, messages, sessionId)).GetProperty("success").GetBoolean()) throw new Exception("ドキュメント破棄後に端末が残りました。");
            }
            Console.WriteLine("PASS: 通常端末と AI の同時起動・種類ごとの重複拒否・終了の分離・AI 再起動・全セッション回収");
        }
        finally { Directory.Delete(AppEnvironment.GetUserDataDir(), true); }
    }

    private static async Task<JsonElement> ReadResponseAsync(TerminalHost host, Channel<JsonElement> messages, string requestId)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        while (true)
        {
            var message = await messages.Reader.ReadAsync(timeout.Token);
            if (message.GetProperty("type").GetString() == "terminal_output") host.HandleOutputAcknowledgement(message);
            if (message.TryGetProperty("requestId", out var id) && id.GetString() == requestId) return message;
        }
    }
}

// WPF 依存を持つアプリ設定とログだけを置き換え、実際の TerminalHost をオフライン検証する。
namespace App.MasterDataEditor
{
    internal static class AppEnvironment
    {
        private static readonly string UserDataDirectory = Path.Combine(Path.GetTempPath(), "master-data-ai-fixture-" + Guid.NewGuid().ToString("N"));
        public static string GetWorkDir() => Path.GetTempPath();
        public static string GetUserDataDir() => UserDataDirectory;
    }

    internal static class Logger
    {
        public static void Error(Exception error, string message) => Console.Error.WriteLine($"{message} {error}");
    }
}
