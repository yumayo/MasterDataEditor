using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace App.MasterDataEditor.Terminal;

/// <summary>WebView の要求を順序付けし、ひとつのドキュメントにひとつの端末を所有させる。</summary>
internal sealed class TerminalHost : IDisposable
{
    private readonly Func<object, CancellationToken, Task> _sendAsync;
    private readonly Dictionary<string, ConPtySession> _sessions = new(StringComparer.Ordinal);
    private readonly Dictionary<string, TerminalOutputFlow> _outputs = new(StringComparer.Ordinal);
    private readonly object _sync = new();
    private CancellationTokenSource _documentLifetime = new();
    private Task _requestQueue = Task.CompletedTask;
    private bool _disposed;

    public TerminalHost(Func<object, CancellationToken, Task> sendAsync)
    {
        _sendAsync = sendAsync;
    }

    public void HandleRequest(JsonElement request)
    {
        var copy = request.Clone();
        var trustGeneration = WorkspaceTrust.GetGeneration(AppEnvironment.GetWorkDir());
        lock (_sync)
        {
            if (_disposed) return;
            var token = _documentLifetime.Token;
            // 端末入力の受付順序は CSV 保存や Git の I/O 待ちと独立させる。
            _requestQueue = _requestQueue.ContinueWith(_ => HandleRequestAsync(copy, token, trustGeneration), CancellationToken.None, TaskContinuationOptions.None, TaskScheduler.Default).Unwrap();
        }
    }

    public void ResetDocument()
    {
        lock (_sync)
        {
            if (_disposed) return;
            var previous = _documentLifetime;
            // UI スレッドが端末終了を待つ前に、出力の Dispatcher 待ちを解除する。
            previous.Cancel();
            _documentLifetime = new CancellationTokenSource();
            _requestQueue = _requestQueue.ContinueWith(_ =>
            {
                StopSessions();
                previous.Dispose();
            }, CancellationToken.None, TaskContinuationOptions.None, TaskScheduler.Default);
        }
    }

    public void HandleOutputAcknowledgement(JsonElement message)
    {
        if (message.ValueKind != JsonValueKind.Object || !message.TryGetProperty("sessionId", out var session) || session.ValueKind != JsonValueKind.String || !message.TryGetProperty("outputId", out var output) || output.ValueKind != JsonValueKind.String) return;
        var sessionId = session.GetString()!;
        var outputId = output.GetString()!;
        if (sessionId.Length == 0 || sessionId.Length > 128 || outputId.Length == 0 || outputId.Length > 128) return;
        lock (_sync)
        {
            // close が reader の終了を待っている間も ACK を処理できるよう、要求 FIFO を通さない。
            if (!_disposed && _outputs.TryGetValue(sessionId, out var flow)) flow.Acknowledge(outputId);
        }
    }

    private async Task HandleRequestAsync(JsonElement request, CancellationToken token, long trustGeneration)
    {
        if (token.IsCancellationRequested) return;
        var requestType = request.GetProperty("type").GetString()!;
        var responseType = requestType[..^8] + "_response";
        var requestId = request.TryGetProperty("requestId", out var id) && id.ValueKind == JsonValueKind.String ? id.GetString()! : "";
        var sessionId = request.TryGetProperty("sessionId", out var session) && session.ValueKind == JsonValueKind.String ? session.GetString()! : "";
        try
        {
            if (requestId.Length == 0 || requestId.Length > 128) throw new ArgumentException("リクエスト ID が不正です。");
            if (sessionId.Length == 0 || sessionId.Length > 128) throw new ArgumentException("端末セッション ID が不正です。");
            switch (requestType)
            {
                case "terminal_start_request":
                {
                    lock (_sync)
                    {
                        if (_sessions.Count > 0) throw new InvalidOperationException("ターミナルはすでに起動しています。");
                    }
                    var workingDirectory = AppEnvironment.GetWorkDir();
                    var columns = request.GetProperty("cols").GetInt32();
                    var rows = request.GetProperty("rows").GetInt32();
                    var flow = new TerminalOutputFlow(sessionId, _sendAsync, token);
                    // Start 内で reader が動き始めるため、最初の出力より先に ACK の受け先を公開する。
                    lock (_sync) _outputs.Add(sessionId, flow);
                    ConPtySession terminal;
                    try
                    {
                        terminal = WorkspaceTrust.ExecuteTrusted(AppEnvironment.GetWorkDir(), trustGeneration, () => ConPtySession.Start(workingDirectory, columns, rows, flow.SendAsync));
                    }
                    catch
                    {
                        lock (_sync) _outputs.Remove(sessionId);
                        flow.Dispose();
                        throw;
                    }
                    if (token.IsCancellationRequested)
                    {
                        flow.Stop();
                        try { terminal.Dispose(); }
                        finally
                        {
                            lock (_sync) _outputs.Remove(sessionId);
                            flow.Dispose();
                        }
                        return;
                    }
                    lock (_sync) _sessions.Add(sessionId, terminal);
                    // 終了監視は要求キューを占有せず、起動直後に exit した場合も観測する。
                    _ = ObserveExitAsync(sessionId, terminal, flow, token);
                    await SendAsync(new { type = responseType, requestId, sessionId, success = true, data = new { shell = "Windows PowerShell", cwd = workingDirectory } }, token).ConfigureAwait(false);
                    break;
                }
                case "terminal_input_request":
                {
                    var data = request.GetProperty("data").GetString() ?? throw new ArgumentException("端末入力が不正です。");
                    if (data.Length > 16384) throw new ArgumentException("1 回の端末入力は 16384 文字以内にしてください。");
                    FindSession(sessionId).WriteInput(data);
                    await SendAsync(new { type = responseType, requestId, sessionId, success = true }, token).ConfigureAwait(false);
                    break;
                }
                case "terminal_resize_request":
                    FindSession(sessionId).Resize(request.GetProperty("cols").GetInt32(), request.GetProperty("rows").GetInt32());
                    await SendAsync(new { type = responseType, requestId, sessionId, success = true }, token).ConfigureAwait(false);
                    break;
                case "terminal_close_request":
                {
                    ConPtySession? terminal;
                    TerminalOutputFlow? flow;
                    lock (_sync)
                    {
                        _sessions.Remove(sessionId, out terminal);
                        _outputs.Remove(sessionId, out flow);
                    }
                    // ACK と Dispatcher 待ちを先に解除し、ConPTY の flush は reader が読み捨てる。
                    flow?.Stop();
                    try
                    {
                        terminal?.Dispose();
                    }
                    catch (Exception error)
                    {
                        // 入出力エラーは ObserveExitAsync が一度だけ通知する。終了処理自体は完了済み。
                        Logger.Error(error, "ターミナルの入出力エラーを回収しました。");
                    }
                    finally { flow?.Dispose(); }
                    // 起動タイムアウトからの遅延 close と、自然終了後の close も成功させる。
                    await SendAsync(new { type = responseType, requestId, sessionId, success = true }, token).ConfigureAwait(false);
                    break;
                }
                default:
                    throw new InvalidOperationException("未対応の端末操作です。");
            }
        }
        catch (Exception error)
        {
            await SendAsync(new { type = responseType, requestId, sessionId, success = false, error = error.Message, stack = error.ToString() }, token).ConfigureAwait(false);
        }
    }

    private ConPtySession FindSession(string sessionId)
    {
        lock (_sync)
        {
            if (_sessions.TryGetValue(sessionId, out var session)) return session;
        }
        throw new InvalidOperationException("ターミナルは終了しています。再起動してください。");
    }

    private async Task ObserveExitAsync(string sessionId, ConPtySession terminal, TerminalOutputFlow flow, CancellationToken token)
    {
        var exitCode = 1;
        try
        {
            exitCode = await terminal.WaitForExitAsync().ConfigureAwait(false);
        }
        catch (Exception error)
        {
            await SendAsync(new { type = "terminal_error", sessionId, error = error.Message, stack = error.ToString() }, token).ConfigureAwait(false);
        }
        finally
        {
            lock (_sync)
            {
                if (_sessions.TryGetValue(sessionId, out var current) && ReferenceEquals(current, terminal)) _sessions.Remove(sessionId);
                if (_outputs.TryGetValue(sessionId, out var output) && ReferenceEquals(output, flow)) _outputs.Remove(sessionId);
            }
            flow.Dispose();
        }
        await SendAsync(new { type = "terminal_exit", sessionId, exitCode }, token).ConfigureAwait(false);
    }

    private async Task SendAsync(object message, CancellationToken token)
    {
        if (token.IsCancellationRequested) return;
        try
        {
            await _sendAsync(message, token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        catch (Exception error)
        {
            // UI の破棄後の通知失敗で pipe の drain や終了監視を中断しない。
            if (!token.IsCancellationRequested) Logger.Error(error, "ターミナルの通知に失敗しました。");
        }
    }

    private void StopSessions()
    {
        ConPtySession[] sessions;
        TerminalOutputFlow[] outputs;
        lock (_sync)
        {
            sessions = _sessions.Values.ToArray();
            outputs = _outputs.Values.ToArray();
            _sessions.Clear();
            _outputs.Clear();
        }
        foreach (var output in outputs) output.Stop();
        foreach (var session in sessions)
        {
            try { session.Dispose(); }
            catch (Exception error) { Logger.Error(error, "ターミナルの終了処理に失敗しました。"); }
        }
        foreach (var output in outputs) output.Dispose();
    }

    public void Dispose()
    {
        Task shutdown;
        lock (_sync)
        {
            if (_disposed) return;
            _disposed = true;
            _documentLifetime.Cancel();
            shutdown = _requestQueue.ContinueWith(_ => StopSessions(), CancellationToken.None, TaskContinuationOptions.None, TaskScheduler.Default);
            _requestQueue = shutdown;
        }
        shutdown.GetAwaiter().GetResult();
        _documentLifetime.Dispose();
    }
}
