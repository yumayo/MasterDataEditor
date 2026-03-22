using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
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
	private static readonly TimeSpan RetryInterval = TimeSpan.FromSeconds(2);

	/// <summary>
	/// stdioプロキシを起動し、stdinが閉じるまでブロックする。
	/// MCPプロトコルはUTF-8のJSON-RPCであるため、stdin/stdoutのエンコーディングをUTF-8に設定する。
	/// </summary>
	public static async Task RunAsync(CancellationToken cancellationToken)
	{
		Console.InputEncoding = Encoding.UTF8;
		Console.OutputEncoding = Encoding.UTF8;

		using var httpClient = new HttpClient();
		string? sessionId = null;

		await WaitForServerAsync(httpClient, cancellationToken);

		while (!cancellationToken.IsCancellationRequested)
		{
			var line = await Console.In.ReadLineAsync(cancellationToken);
			if (line == null)
			{
				break;
			}

			using var request = new HttpRequestMessage(HttpMethod.Post, McpHttpServerUrl);
			request.Content = new StringContent(line, Encoding.UTF8, "application/json");
			request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
			request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));

			if (sessionId != null)
			{
				request.Headers.Add("Mcp-Session-Id", sessionId);
			}

			HttpResponseMessage response;
			try
			{
				response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
			}
			catch (HttpRequestException ex)
			{
				Console.Error.WriteLine($"[McpStdioProxy] HTTP request failed: {ex.Message}");
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
