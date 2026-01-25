using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace App.MasterDataEditor;

public class WebView2Handler
{
	private readonly Dispatcher _dispatcher;
	private readonly WebView2 _webView2;
	private readonly string _consoleLogPath;

	public WebView2Handler(Dispatcher dispatcher, WebView2 webView2, string consoleLogPath)
	{
		_dispatcher = dispatcher;
		_webView2 = webView2;
		_consoleLogPath = consoleLogPath;
		_webView2.CoreWebView2.WebMessageReceived += OnWebMessageReceived;

		// DevToolsProtocolを使ってconsole.logをキャプチャ
		var receiver = _webView2.CoreWebView2.GetDevToolsProtocolEventReceiver("Runtime.consoleAPICalled");
		receiver.DevToolsProtocolEventReceived += OnConsoleAPICalled;
	}

	private void OnConsoleAPICalled(object? sender, CoreWebView2DevToolsProtocolEventReceivedEventArgs e)
	{
		using var doc = JsonDocument.Parse(e.ParameterObjectAsJson);
		var root = doc.RootElement;

		var type = root.GetProperty("type").GetString();
		var args = root.GetProperty("args");
		var messageParts = new System.Collections.Generic.List<string>();
		foreach (var arg in args.EnumerateArray())
		{
			if (arg.TryGetProperty("value", out var value))
			{
				messageParts.Add(value.ToString());
			}
		}
		var message = string.Join(" ", messageParts);

		var source = "";
		var line = 0;
		if (root.TryGetProperty("stackTrace", out var stackTrace) &&
		    stackTrace.TryGetProperty("callFrames", out var callFrames))
		{
			var frames = callFrames.EnumerateArray();
			if (frames.Any())
			{
				var firstFrame = frames.First();
				source = firstFrame.GetProperty("url").GetString() ?? "";
				line = firstFrame.GetProperty("lineNumber").GetInt32();
			}
		}

		var logLine = $"[{DateTime.Now:HH:mm:ss}] [{type}] {message} ({source}:{line})";
		File.AppendAllText(_consoleLogPath, logLine + Environment.NewLine);
	}

	public static async Task<WebView2Handler> CreateAsync(Dispatcher dispatcher, WebView2 webView2, string consoleLogPath)
	{
		try
		{
			// WebView2環境を初期化
			await webView2.EnsureCoreWebView2Async(null);

			// DevToolsProtocolのRuntimeを有効化（console.logキャプチャ用）
			await webView2.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.enable", "{}");

#if DEBUG
			var devPort = AppEnvironment.GetRequiredInt("MASTER_DATA_EDITOR_DEV_PORT");
			var devUri = new Uri($"http://localhost:{devPort}");
			webView2.CoreWebView2.Navigate(devUri.ToString());
#else
			// HTMLファイルのパスを取得
			var htmlPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "WebView", "index.html");
			var htmlUri = new Uri($"file:///{htmlPath.Replace('\\', '/')}");
			Logger.Info($"Loading HTML from: {htmlUri}");

			// HTMLファイルを読み込み
			webView2.CoreWebView2.Navigate(htmlUri.ToString());
#endif

			Logger.Info("WebView2初期化完了 - NavigationCompletedイベントを待機中");
		}
		catch (Exception ex)
		{
			Logger.Error(ex, "WebView2初期化時にエラーが発生しました。");
		}

		return new WebView2Handler(dispatcher, webView2, consoleLogPath);
	}

	public void SendMessageToWebView(object data)
	{
		_dispatcher.Invoke(() =>
		{
			try
			{
				var options = new JsonSerializerOptions
				{
					PropertyNamingPolicy = null, // CamelCaseを削除
					WriteIndented = false
				};

				var json = JsonSerializer.Serialize(data, options);

				_webView2.CoreWebView2.PostWebMessageAsString(json);
			}
			catch (Exception e)
			{
				Logger.Error(e, "WebView2へのメッセージの送信に失敗しました。");
			}
		});
	}

	private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
	{
		try
		{
			string? messageJson;
			try
			{
				// WebView2のメッセージを文字列として取得
				messageJson = e.WebMessageAsJson;

				// JSON文字列をパースして実際の文字列メッセージを取得
				if (!string.IsNullOrEmpty(messageJson))
				{
					// JSON形式の場合はパースして文字列部分を取得
					if (messageJson.StartsWith("\"") && messageJson.EndsWith("\""))
					{
						messageJson = JsonSerializer.Deserialize<string>(messageJson);
					}
				}
			}
			catch (Exception ex)
			{
				Logger.Error(ex, "メッセージの取得に失敗しました");
				return;
			}

			if (!string.IsNullOrEmpty(messageJson))
			{
				using var document = JsonDocument.Parse(messageJson);
				var root = document.RootElement;

				if (root.TryGetProperty("type", out var typeElement))
				{
					var messageType = typeElement.GetString();

					switch (messageType)
					{
						case "read_file_request":
							SendMessageToWebView(WebView2HandlerReadFileRequest.Invoke(root));
							break;

						case "write_file_request":
							SendMessageToWebView(WebView2HandlerWriteFileRequest.Invoke(root));
							break;

						case "find_files_request":
							SendMessageToWebView(WebView2HandlerFindFilesRequest.Invoke(root));
							break;

						default:
							Logger.Info($"未知のメッセージタイプ: {messageType}");
							break;
					}
				}
			}
		}
		catch (Exception ex)
		{
			Logger.Error(ex, "WebView2メッセージ処理時にエラーが発生しました。");
		}
	}
}
