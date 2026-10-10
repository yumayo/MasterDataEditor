using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace App.MasterDataEditor.Terminal;

/// <summary>xterm が処理した出力だけを確認し、pipe reader と画面の処理速度を揃える。</summary>
internal sealed class TerminalOutputFlow : IDisposable
{
    private readonly string _sessionId;
    private readonly Func<object, CancellationToken, Task> _sendAsync;
    private readonly CancellationTokenSource _lifetime;
    private readonly CancellationToken _token;
    private readonly Dictionary<string, TaskCompletionSource> _pending = new(StringComparer.Ordinal);
    private readonly object _sync = new();
    private bool _disposed;

    public TerminalOutputFlow(string sessionId, Func<object, CancellationToken, Task> sendAsync, CancellationToken documentToken)
    {
        _sessionId = sessionId;
        _sendAsync = sendAsync;
        _lifetime = CancellationTokenSource.CreateLinkedTokenSource(documentToken);
        _token = _lifetime.Token;
    }

    public async Task SendAsync(string data)
    {
        var outputId = Guid.NewGuid().ToString("N");
        var acknowledgement = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (_sync)
        {
            if (_token.IsCancellationRequested) return;
            // 呼び出し元の reader はこの完了を待ってから次の pipe read へ進む。
            if (_pending.Count != 0) throw new InvalidOperationException("未確認の端末出力があるため次の出力は送信できません。");
            _pending.Add(outputId, acknowledgement);
        }
        try
        {
            // ACK の待機先を先に登録する。送信例外は reader へ伝え、セッションを終了する。
            await _sendAsync(new { type = "terminal_output", sessionId = _sessionId, outputId, data }, _token).ConfigureAwait(false);
            // 背景タブのタイマー抑制で正常な端末を切断しないよう、終了・遷移の取消を使う。
            await acknowledgement.Task.WaitAsync(_token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (_token.IsCancellationRequested) { }
        finally
        {
            lock (_sync) _pending.Remove(outputId);
        }
    }

    public void Acknowledge(string outputId)
    {
        lock (_sync)
        {
            if (_pending.TryGetValue(outputId, out var acknowledgement)) acknowledgement.TrySetResult();
        }
    }

    public void Stop()
    {
        lock (_sync)
        {
            if (!_disposed) _lifetime.Cancel();
        }
    }

    public void Dispose()
    {
        lock (_sync)
        {
            if (_disposed) return;
            _disposed = true;
            _lifetime.Cancel();
            _lifetime.Dispose();
        }
    }
}
