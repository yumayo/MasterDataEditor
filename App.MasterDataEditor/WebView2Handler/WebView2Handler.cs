using App.MasterDataEditor.Mcp;
using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace App.MasterDataEditor;

public class WebView2Handler : IDisposable
{
	private readonly Dispatcher _dispatcher;
	private readonly WebView2 _webView2;
	private readonly string _consoleLogPath;
	private readonly IDisposable _fileWatcherHandle;
	/// <summary>
	/// MCP ToolとWebView2間の非同期ブリッジ。
	/// editor_api_response メッセージをブリッジに転送する。
	/// ConnectEditorApiBridge() で本番のブリッジインスタンスに差し替えられるまで、
	/// 未接続状態の例外スローで初期化する。
	/// </summary>
	private EditorApiBridge _editorApiBridge = new();

	public WebView2Handler(Dispatcher dispatcher, WebView2 webView2, string consoleLogPath)
	{
		_dispatcher = dispatcher;
		_webView2 = webView2;
		_consoleLogPath = consoleLogPath;
		_webView2.CoreWebView2.WebMessageReceived += OnWebMessageReceived;

		// DevToolsProtocolを使ってconsole.logをキャプチャ
		var receiver = _webView2.CoreWebView2.GetDevToolsProtocolEventReceiver("Runtime.consoleAPICalled");
		receiver.DevToolsProtocolEventReceived += OnConsoleAPICalled;

		// data/ ディレクトリのCSVファイル変更を監視し、WebViewに通知する
		// ディレクトリが存在しない場合は NullDisposable で nullable を回避する
		var dataDirectory = Path.Combine(AppEnvironment.GetWorkDir(), "data");
		if (Directory.Exists(dataDirectory))
		{
			_fileWatcherHandle = new FileWatcher(dataDirectory, () =>
			{
				SendMessageToWebView(new { type = "file_changed" });
			});
			Logger.Info($"ファイル監視を開始: {dataDirectory}");
		}
		else
		{
			_fileWatcherHandle = NullDisposable.Instance;
			Logger.Info($"data/ ディレクトリが存在しないためファイル監視をスキップ: {dataDirectory}");
		}
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

			// 外部通信遮断: すべてのリクエストをフィルタリング対象にする
			webView2.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
			webView2.CoreWebView2.WebResourceRequested += (sender, args) =>
			{
				Uri uri;
				try { uri = new Uri(args.Request.Uri); }
				catch (UriFormatException)
				{
					// 解析不能なURIはブロック
					args.Response = webView2.CoreWebView2.Environment.CreateWebResourceResponse(
						null, 403, "Blocked", "Content-Type: text/plain");
					return;
				}

				// WebView2仕様上は data: / blob: は WebResourceRequested で発火しない可能性があるが、安全のため許可しておく
				if (uri.Scheme == "data" || uri.Scheme == "blob" || uri.Scheme == "about") return;

#if DEBUG
				// DEBUGビルド: 開発サーバーのポートのみ許可（HMR用に ws スキームも同条件で許可）
				var allowedPort = AppEnvironment.GetDevPort();
				if ((uri.Scheme == "http" || uri.Scheme == "ws") && uri.Host == "localhost" && uri.Port == allowedPort) return;
#else
				// RELEASEビルド: file:// スキームのリクエストのみ許可
				if (uri.Scheme == "file") return;
#endif

				// 上記以外の外部リクエストはすべてブロック
				args.Response = webView2.CoreWebView2.Environment.CreateWebResourceResponse(
					null, 403, "Blocked", "Content-Type: text/plain");
			};

#if DEBUG
			var devPort = AppEnvironment.GetDevPort();
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

	/// <summary>
	/// EditorApiBridgeを接続し、editor_api_responseの転送とリクエスト送信を有効にする。
	/// </summary>
	public void ConnectEditorApiBridge(EditorApiBridge bridge)
	{
		_editorApiBridge = bridge;
		bridge.ConnectWebView2(SendMessageToWebView);
		Logger.Info("WebView2Handler: EditorApiBridge connected");
	}

	public void Dispose()
	{
		_fileWatcherHandle.Dispose();
	}

	public void SendMessageToWebView(object data)
	{
		_dispatcher.InvokeAsync(() =>
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

						case "delete_file_request":
							SendMessageToWebView(WebView2HandlerDeleteFileRequest.Invoke(root));
							break;

						case "git_status_request":
							SendMessageToWebView(WebView2HandlerGitStatusRequest.Invoke(root));
							break;

						case "git_show_request":
							SendMessageToWebView(WebView2HandlerGitShowRequest.Invoke(root));
							break;

						case "git_add_request":
							SendMessageToWebView(WebView2HandlerGitAddRequest.Invoke(root));
							break;

						case "git_reset_request":
							SendMessageToWebView(WebView2HandlerGitResetRequest.Invoke(root));
							break;

						case "git_discard_request":
							SendMessageToWebView(WebView2HandlerGitDiscardRequest.Invoke(root));
							break;

						case "editor_api_response":
							HandleEditorApiResponse(root);
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

	/// <summary>
	/// TypeScript EditorApiBridgeからのeditor_api_responseを受信し、C# EditorApiBridgeに転送する。
	/// </summary>
	private void HandleEditorApiResponse(JsonElement root)
	{
		var requestId = root.GetProperty("requestId").GetString()!;
		var success = root.GetProperty("success").GetBoolean();

		if (success)
		{
			// データをCloneして独立したJsonElementにする（JsonDocumentのDispose後も安全に使用できるように）
			var data = root.GetProperty("data").Clone();
			_editorApiBridge.HandleResponse(requestId, true, data, "");
		}
		else
		{
			// TypeScript側のEditorApiBridgeはsuccess:false時に必ずerrorプロパティを含む
			var error = root.GetProperty("error").GetString()!;
			_editorApiBridge.HandleResponse(requestId, false, default, error);
		}
	}
}
