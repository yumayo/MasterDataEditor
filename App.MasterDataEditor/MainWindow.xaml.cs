using System;
using System.Threading.Tasks;
using System.Windows;

namespace App.MasterDataEditor;

/// <summary>
/// Interaction logic for MainWindow.xaml
/// </summary>
public partial class MainWindow : Window
{
	private WebView2Handler? _webView2Handler;

	public MainWindow()
	{
		InitializeComponent();

		Title = $"マスターデータ入力支援ツール";

		Logger.Info("Starting MainWindow service initialization");
		Application.Current.Dispatcher.InvokeAsync(InitializeWebView2handler);

		Logger.Info("MainWindow initialized with WebView2");
	}

	private async Task InitializeWebView2handler()
	{
		var consoleLogPath = AppEnvironment.GetConsoleLogPath();
		_webView2Handler = await WebView2Handler.CreateAsync(Application.Current.Dispatcher, webView2, consoleLogPath);

		// EditorApiBridgeをWebView2Handlerに接続し、MCPツールからのAPI呼び出しを有効にする
		((App)Application.Current).ConnectEditorApiBridge(_webView2Handler);
	}
}
