using System.Text.Json;
using System.Threading.Channels;
using App.MasterDataEditor.Terminal;

internal static class TerminalOutputFlowChecks
{
    public static async Task RunAsync()
    {
        var sent = Channel.CreateUnbounded<JsonElement>();
        using var document = new CancellationTokenSource();
        using var flow = new TerminalOutputFlow("first-session", (message, token) => sent.Writer.WriteAsync(JsonSerializer.SerializeToElement(message), token).AsTask(), document.Token);
        var producer = Task.Run(async () =>
        {
            await flow.SendAsync("first");
            await flow.SendAsync("second");
        });
        var first = await sent.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
        if (first.GetProperty("sessionId").GetString() != "first-session" || first.GetProperty("data").GetString() != "first") throw new Exception("出力データが変更されました。");
        if (producer.IsCompleted || sent.Reader.TryRead(out _)) throw new Exception("画面の ACK 前に次の出力が送信されました。");
        var firstId = first.GetProperty("outputId").GetString()!;
        flow.Acknowledge("unknown-output");
        if (producer.IsCompleted || sent.Reader.TryRead(out _)) throw new Exception("異なる ACK で出力待ちが解除されました。");
        flow.Acknowledge(firstId);
        var second = await sent.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
        var secondId = second.GetProperty("outputId").GetString()!;
        if (secondId == firstId || second.GetProperty("data").GetString() != "second") throw new Exception("出力の ID または順序が不正です。");
        flow.Acknowledge(firstId);
        if (producer.IsCompleted) throw new Exception("重複 ACK が次の出力を完了させました。");
        flow.Acknowledge(secondId);
        await producer.WaitAsync(TimeSpan.FromSeconds(2));

        // 明示終了は ACK が来なくても reader を解放し、続く pipe の flush は読み捨てる。
        var closing = flow.SendAsync("close-pending");
        await sent.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
        flow.Stop();
        await closing.WaitAsync(TimeSpan.FromSeconds(2));
        await flow.SendAsync("discard-after-close").WaitAsync(TimeSpan.FromSeconds(2));
        if (sent.Reader.TryRead(out _)) throw new Exception("終了済みセッションが出力を送信しました。");

        using var nextFlow = new TerminalOutputFlow("next-session", (message, token) => sent.Writer.WriteAsync(JsonSerializer.SerializeToElement(message), token).AsTask(), document.Token);
        var navigating = nextFlow.SendAsync("navigation-pending");
        await sent.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
        document.Cancel();
        await navigating.WaitAsync(TimeSpan.FromSeconds(2));

        using var disposedFlow = new TerminalOutputFlow("disposed-session", (message, token) => sent.Writer.WriteAsync(JsonSerializer.SerializeToElement(message), token).AsTask(), CancellationToken.None);
        var disposing = disposedFlow.SendAsync("dispose-pending");
        await sent.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
        disposedFlow.Dispose();
        await disposing.WaitAsync(TimeSpan.FromSeconds(2));
        disposedFlow.Dispose();

        // 送信失敗を握り潰して存在しない ACK を待ち続けてはいけない。
        using var failing = new TerminalOutputFlow("failed-session", (_, _) => Task.FromException(new IOException("SEND_FAILED")), CancellationToken.None);
        try
        {
            await failing.SendAsync("failure").WaitAsync(TimeSpan.FromSeconds(2));
            throw new Exception("WebView への送信失敗が伝播しませんでした。");
        }
        catch (IOException error) when (error.Message == "SEND_FAILED") { }

        // 起動直後に ACK が返っても、送信前に登録された待機先で受け取れる。
        TerminalOutputFlow? immediate = null;
        immediate = new TerminalOutputFlow("immediate-session", (message, _) =>
        {
            immediate!.Acknowledge(JsonSerializer.SerializeToElement(message).GetProperty("outputId").GetString()!);
            return Task.CompletedTask;
        }, CancellationToken.None);
        using (immediate) await immediate.SendAsync("immediate").WaitAsync(TimeSpan.FromSeconds(2));
        Console.WriteLine("PASS: 出力 ACK 待ち・順序・誤 ACK/重複 ACK・終了/遷移/Dispose 取消・送信失敗・即時 ACK");
    }

}
