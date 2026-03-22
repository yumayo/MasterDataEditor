using System;
using System.Collections.Concurrent;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace App.MasterDataEditor.Mcp;

/// <summary>
/// MCP ToolからWebView2のEditorAPIを非同期呼び出しするブリッジ。
///
/// MCP Tool → RequestAsync() → editor_api_request (postMessage) → TypeScript EditorApiBridge
///   → editor_api_response (postMessage) → HandleResponse() → MCP Tool に結果返却
///
/// requestIdでリクエスト/レスポンスを対応づけ、TaskCompletionSourceで非同期待機する。
/// WebView2接続前のリクエストはInvalidOperationExceptionをスローする。
/// </summary>
public sealed class EditorApiBridge
{
	private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(30);

	private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> _pendingRequests = new();

	/// <summary>
	/// WebView2へメッセージを送信するデリゲート。
	/// 初期状態ではWebView2未接続を示すエラーをスローする。
	/// ConnectWebView2() で実際の送信デリゲートに差し替える。
	/// </summary>
	private Action<object> _sendMessage = _ =>
		throw new InvalidOperationException("WebView2 is not connected yet. The main application window must be opened first.");

	/// <summary>
	/// WebView2のSendMessageToWebViewデリゲートを接続する。
	/// MainWindow.InitializeWebView2handler完了後に1回だけ呼ばれる。
	/// </summary>
	public void ConnectWebView2(Action<object> sendMessage)
	{
		Volatile.Write(ref _sendMessage, sendMessage);
		Logger.Info("EditorApiBridge connected to WebView2");
	}

	/// <summary>
	/// EditorAPIメソッドを非同期呼び出しし、結果を返す。
	/// Kestrelスレッドから呼ばれ、UIスレッドを経由してWebView2と通信する。
	/// </summary>
	/// <param name="method">APIメソッド名（例: "data.getTableNames", "schema.getColumns"）</param>
	/// <param name="parameters">メソッドパラメータ</param>
	/// <param name="cancellationToken">キャンセルトークン</param>
	/// <returns>EditorAPIからの応答データ</returns>
	public async Task<JsonElement> RequestAsync(string method, object parameters, CancellationToken cancellationToken)
	{
		var requestId = Guid.NewGuid().ToString();
		var tcs = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
		_pendingRequests[requestId] = tcs;

		try
		{
			// editor_api_request をWebView2に送信（SendMessageToWebViewがUIスレッドにマーシャリングする）
			var sender = Volatile.Read(ref _sendMessage);
			sender(new
			{
				type = "editor_api_request",
				requestId,
				method,
				@params = parameters
			});

			// タイムアウト付きで応答を待機
			using var timeoutCts = new CancellationTokenSource(RequestTimeout);
			using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);
			using var registration = linkedCts.Token.Register(() => tcs.TrySetCanceled(linkedCts.Token));

			return await tcs.Task;
		}
		finally
		{
			_pendingRequests.TryRemove(requestId, out _);
		}
	}

	/// <summary>
	/// WebView2からのeditor_api_responseを処理し、待機中のリクエストを完了させる。
	/// WebView2Handler.OnWebMessageReceivedからUIスレッドで呼ばれる。
	/// タイムアウトによるキャンセルと応答到着の競合に備え、TrySet系メソッドを使用する。
	/// </summary>
	public void HandleResponse(string requestId, bool success, JsonElement data, string error)
	{
		if (!_pendingRequests.TryRemove(requestId, out var tcs))
		{
			Logger.Info($"EditorApiBridge: No pending request for requestId={requestId} (already timed out or cancelled)");
			return;
		}

		if (success)
		{
			tcs.TrySetResult(data);
		}
		else
		{
			tcs.TrySetException(new InvalidOperationException(error));
		}
	}
}
