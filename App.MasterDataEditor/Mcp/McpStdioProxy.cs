using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace App.MasterDataEditor.Mcp;

/// <summary>
/// Claude Desktopからのstdio接続を受け、メインアプリのMCP HTTPサーバーに転送するプロキシ。
/// stdin/stdoutのJSON-RPCメッセージをStreamable HTTP POSTに変換して中継する。
///
/// 構成:
///   Claude Desktop ←(stdio)→ McpStdioProxy ←(HTTP)→ McpHttpServer (localhost:3001)
///
/// Claude DesktopがローカルHTTP MCPに直接接続できるようになれば、このプロキシは不要になる。
/// </summary>
public static class McpStdioProxy
{
	private const string McpHttpServerUrl = "http://localhost:3001/";
	private const string SseDataPrefix = "data: ";
	private const int MaxRetryCount = 10;
	private const int PostRetryCount = 3;
	private static readonly TimeSpan RetryInterval = TimeSpan.FromSeconds(2);
	private static readonly TimeSpan PostRetryInterval = TimeSpan.FromSeconds(1);

	/// <summary>
	/// stdioプロキシを起動し、stdinが閉じるまでブロックする。
	/// MCPプロトコルはUTF-8のJSON-RPCであるため、stdin/stdoutのエンコーディングをUTF-8に設定する。
	/// </summary>
	public static async Task RunAsync(CancellationToken cancellationToken)
	{
		Console.InputEncoding = Encoding.UTF8;
		Console.OutputEncoding = Encoding.UTF8;

		// リクエストあたり3秒タイムアウト × 3回リトライ + wait2秒 ≒ 最大約11秒で応答を返す
		using var httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
		string? sessionId = null;

		await WaitForServerAsync(httpClient, cancellationToken);

		while (!cancellationToken.IsCancellationRequested)
		{
			var line = await Console.In.ReadLineAsync(cancellationToken);
			if (line == null)
			{
				break;
			}

			// HTTP POST をリトライ付きで送信する（一時的な接続不可に対する耐性）
			HttpResponseMessage? response = null;
			for (var retry = 0; retry < PostRetryCount; retry++)
			{
				using var request = new HttpRequestMessage(HttpMethod.Post, McpHttpServerUrl);
				request.Content = new StringContent(line, Encoding.UTF8, "application/json");
				request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
				request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
				if (sessionId != null)
				{
					request.Headers.Add("Mcp-Session-Id", sessionId);
				}
				try
				{
					response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
					break;
				}
				catch (HttpRequestException ex)
				{
					Console.Error.WriteLine($"[McpStdioProxy] HTTP request failed (attempt {retry + 1}/{PostRetryCount}): {ex.Message}");
					if (retry < PostRetryCount - 1)
					{
						await Task.Delay(PostRetryInterval, cancellationToken);
					}
					cancellationToken.ThrowIfCancellationRequested();
				}
				catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
				{
					// HttpClient.Timeout 超過（シャットダウンではなくタイムアウト）
					Console.Error.WriteLine($"[McpStdioProxy] HTTP request timed out (attempt {retry + 1}/{PostRetryCount})");
					if (retry < PostRetryCount - 1)
					{
						await Task.Delay(PostRetryInterval, cancellationToken);
					}
				}
			}

			// 全リトライ失敗: JSON-RPCエラーレスポンスをstdoutに返してClaude Desktopのハングを防ぐ
			if (response == null)
			{
				await SendConnectionErrorAsync(line);
				continue;
			}

			using (response)
			{
				// セッションIDを保存（初回のinitializeレスポンスで返される）
				if (response.Headers.TryGetValues("Mcp-Session-Id", out var sessionValues))
				{
					sessionId = sessionValues.First();
				}

				var statusCode = (int)response.StatusCode;

				// 202 Accepted: 通知の確認応答（レスポンスボディなし）
				if (statusCode == 202)
				{
					continue;
				}

				// エラーレスポンス
				if (statusCode >= 400)
				{
					var errorBody = await response.Content.ReadAsStringAsync(cancellationToken);
					Console.Error.WriteLine($"[McpStdioProxy] Server returned {statusCode}: {errorBody}");
					// 404: セッションが無効化されている。古いIDを送り続けないようリセットする
					if (statusCode == 404)
					{
						sessionId = null;
					}
					// サーバーからJSON-RPCエラーが返された場合はそのまま転送
					if (!string.IsNullOrEmpty(errorBody))
					{
						await Console.Out.WriteLineAsync(errorBody);
						await Console.Out.FlushAsync();
					}
					continue;
				}

				var contentType = response.Content.Headers.ContentType?.MediaType;

				if (contentType == "text/event-stream")
				{
					await ForwardSseResponseAsync(response, cancellationToken);
				}
				else
				{
					await ForwardJsonResponseAsync(response, cancellationToken);
				}
			}
		}
	}

	/// <summary>
	/// SSE形式のレスポンスをパースし、data行のJSON-RPCメッセージをstdoutに転送する。
	/// </summary>
	private static async Task ForwardSseResponseAsync(HttpResponseMessage response, CancellationToken cancellationToken)
	{
		using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
		using var reader = new StreamReader(stream, Encoding.UTF8);

		while (!reader.EndOfStream)
		{
			var sseLine = await reader.ReadLineAsync(cancellationToken);

			if (sseLine == null)
			{
				break;
			}

			// SSE形式: "data: {json}" の行からJSONを抽出して転送
			if (sseLine.StartsWith(SseDataPrefix, StringComparison.Ordinal))
			{
				var jsonData = sseLine.Substring(SseDataPrefix.Length);
				await Console.Out.WriteLineAsync(jsonData);
				await Console.Out.FlushAsync();
			}
			// "event:" や空行は無視
		}
	}

	/// <summary>
	/// JSON形式のレスポンスをそのままstdoutに転送する。
	/// </summary>
	private static async Task ForwardJsonResponseAsync(HttpResponseMessage response, CancellationToken cancellationToken)
	{
		var body = await response.Content.ReadAsStringAsync(cancellationToken);
		if (!string.IsNullOrEmpty(body))
		{
			await Console.Out.WriteLineAsync(body);
			await Console.Out.FlushAsync();
		}
	}

	/// <summary>
	/// HTTP接続失敗時にJSON-RPCエラーレスポンスをstdoutに返す。
	/// リクエストが通知（idフィールド自体が存在しない）の場合はレスポンス不要なので何もしない。
	/// JSON-RPC 2.0仕様: "id": null は通知ではなくリクエストであり、レスポンスが必要。
	/// </summary>
	private static async Task SendConnectionErrorAsync(string requestLine)
	{
		string idRawText;
		try
		{
			using var doc = JsonDocument.Parse(requestLine);
			// JSON-RPCの id フィールドが存在しない場合は通知（レスポンス不要）
			if (!doc.RootElement.TryGetProperty("id", out var requestId))
			{
				return;
			}
			// JsonDocument が生存中に id の生JSON表現をコピーする（Use-After-Dispose 防止）
			// GetRawText() は数値・文字列・null いずれも元の表現を保持する
			idRawText = requestId.GetRawText();
		}
		catch (JsonException)
		{
			// JSONパース失敗: リクエスト自体が不正なのでエラーレスポンスを返せない
			return;
		}

		// JSON-RPCエラーレスポンスをstdoutに返す
		// id の型（数値・文字列・null）を変換せずそのまま埋め込むため文字列結合で構築する
		// -32000: JSON-RPC 2.0 の Server Error 範囲 (-32000 ～ -32099)
		var errorResponse = "{\"jsonrpc\":\"2.0\",\"id\":" + idRawText
			+ ",\"error\":{\"code\":-32000,\"message\":\"Cannot connect to MasterDataEditor. Please ensure the application is running.\"}}";
		await Console.Out.WriteLineAsync(errorResponse);
		await Console.Out.FlushAsync();
	}

	/// <summary>
	/// メインアプリのHTTP MCPサーバーが起動するまで待機する。
	/// </summary>
	private static async Task WaitForServerAsync(HttpClient httpClient, CancellationToken cancellationToken)
	{
		for (var attempt = 0; attempt < MaxRetryCount; attempt++)
		{
			try
			{
				using var response = await httpClient.GetAsync(McpHttpServerUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
				Console.Error.WriteLine("[McpStdioProxy] Connected to MCP HTTP server");
				return;
			}
			catch (HttpRequestException)
			{
				Console.Error.WriteLine($"[McpStdioProxy] Waiting for MCP HTTP server... (attempt {attempt + 1}/{MaxRetryCount})");
				await Task.Delay(RetryInterval, cancellationToken);
			}
		}

		Console.Error.WriteLine("[McpStdioProxy] Warning: Could not confirm MCP HTTP server availability, proceeding anyway");
	}
}
