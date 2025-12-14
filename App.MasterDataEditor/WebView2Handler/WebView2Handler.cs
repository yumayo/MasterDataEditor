using System;
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

	public WebView2Handler(Dispatcher dispatcher, WebView2 webView2)
	{
		_dispatcher = dispatcher;
		_webView2 = webView2;
		_webView2.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
	}

	public static async Task<WebView2Handler> CreateAsync(Dispatcher dispatcher, WebView2 webView2)
	{
		try
		{
			// WebView2環境を初期化
			await webView2.EnsureCoreWebView2Async(null);

#if DEBUG
			webView2.CoreWebView2.Navigate("http://localhost:5173");
#else
			// HTMLファイルのパスを取得
			var htmlPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "WebView", "index.html");
			var htmlUri = new Uri($"file:///{htmlPath.Replace('\\', '/')}");
			Logger.Info($"Loading HTML from: {htmlUri}");

			// HTMLファイルを読み込み
			_webView2.CoreWebView2.Navigate(htmlUri.ToString());
#endif

			Logger.Info("WebView2初期化完了 - NavigationCompletedイベントを待機中");
		}
		catch (Exception ex)
		{
			Logger.Error(ex, "WebView2初期化時にエラーが発生しました。");
		}

		return new WebView2Handler(dispatcher, webView2);
	}

	public void SendMessageToWebView(object data)
	{
		_dispatcher?.Invoke(() =>
		{
			if (_webView2?.CoreWebView2 != null)
			{
				var options = new JsonSerializerOptions
				{
					PropertyNamingPolicy = null, // CamelCaseを削除
					WriteIndented = false
				};

				var json = JsonSerializer.Serialize(data, options);

				_webView2.CoreWebView2.PostWebMessageAsString(json);
			}
			else
			{
				Logger.Error(null, "WebView2が初期化されていません。メッセージ送信をスキップします。");
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
						case "file_read_request":
							SendMessageToWebView(WebView2HandlerFileReadRequest.Invoke(root));
							break;

						case "file_write_request":
							SendMessageToWebView(WebView2HandlerFileWriteRequest.Invoke(root));
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
