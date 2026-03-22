using App.MasterDataEditor.Mcp;
using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;

namespace App.MasterDataEditor;

/// <summary>
/// Interaction logic for App.xaml
/// </summary>
public partial class App : Application
{
	/// <summary>
	/// WebView2とMCPツール間の非同期通信ブリッジ。
	/// アプリケーション起動時に作成し、McpHttpServerとWebView2Handlerの両方に接続する。
	/// </summary>
	private readonly EditorApiBridge _editorApiBridge = new();

	/// <summary>
	/// MCPサーバー起動タスク。OnExitでawaitして確実にDisposeするために保持する。
	/// Task.FromResult(null) で初期化し、OnStartupで実際の起動タスクに差し替える。
	/// </summary>
	private Task<McpHttpServer?> _mcpServerStartup = Task.FromResult<McpHttpServer?>(null);

	[STAThread]
	public static void Main(string[] args)
	{
		// --mcp 引数: stdioプロキシモードとして起動（GUIなし）
		// Claude Desktopが本プロセスを子プロセスとして起動し、
		// stdin/stdoutをメインアプリのHTTP MCPサーバーに中継する
		if (Array.Exists(args, arg => arg == "--mcp"))
		{
			McpStdioProxy.RunAsync(CancellationToken.None).GetAwaiter().GetResult();
			return;
		}

		App app = new App();
		app.InitializeComponent();
		app.Run();
	}

	protected override void OnStartup(StartupEventArgs e)
	{
		ConsoleManager.Setup();
		Logger.Setup();

		Logger.Info("Application startup beginning");

		// グローバル例外ハンドラーを設定
		SetupGlobalExceptionHandlers();
		Logger.Info("Global exception handlers set up");

		// MCPサーバーをバックグラウンドで起動（EditorApiBridgeをDI登録）
		_mcpServerStartup = StartMcpHttpServerAsync(_editorApiBridge);

		base.OnStartup(e);
		Logger.Info("WPF base.OnStartup completed");
	}

	/// <summary>
	/// WebView2Handler初期化後にEditorApiBridgeを接続する。
	/// MainWindow.InitializeWebView2handlerから呼ばれる。
	/// </summary>
	internal void ConnectEditorApiBridge(WebView2Handler handler)
	{
		handler.ConnectEditorApiBridge(_editorApiBridge);
	}

	private static async Task<McpHttpServer?> StartMcpHttpServerAsync(EditorApiBridge bridge)
	{
		try
		{
			return await McpHttpServer.CreateAndStartAsync(bridge, default);
		}
		catch (Exception ex)
		{
			Logger.Error(ex, "MCP HTTP Server startup");
			return null;
		}
	}

	private void SetupGlobalExceptionHandlers()
	{
		// UIスレッドの未処理例外をキャッチ
		DispatcherUnhandledException += (sender, e) =>
		{
			HandleException(e.Exception, sender, "UIスレッド");
			e.Handled = true; // アプリケーションの終了を防ぐ
		};

		// バックグラウンドスレッドの未処理例外をキャッチ
		TaskScheduler.UnobservedTaskException += (sender, e) =>
		{
			HandleException(e.Exception, sender, "バックグラウンドタスク");
			e.SetObserved(); // 例外を観測済みとしてマーク
		};

		// その他の未処理例外をキャッチ
		AppDomain.CurrentDomain.UnhandledException += (sender, e) =>
		{
			var exception = e.ExceptionObject as Exception;
			HandleException(exception, sender, "AppDomain");
		};
	}

	protected override void OnExit(ExitEventArgs e)
	{
		// MCPサーバーの起動完了を待ち、確実にDisposeする
		var mcpServer = _mcpServerStartup.GetAwaiter().GetResult();
		mcpServer?.DisposeAsync().AsTask().GetAwaiter().GetResult();

		Logger.Close();
		base.OnExit(e);
	}

	private void HandleException(Exception? exception, object? sender, string source)
	{
		if (exception == null)
		{
			return;
		}

		try
		{
			Logger.Error(exception, source);
		}
		catch
		{
			// 例外処理中にエラーが発生した場合は最低限のログ出力
			Logger.Debug($"[{source}] 例外処理中にエラーが発生しました");
		}
	}
}
