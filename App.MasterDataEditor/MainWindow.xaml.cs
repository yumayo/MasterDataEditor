using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;

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
		WindowTitleBarTheme.Apply(this);
		SourceInitialized += (_, _) => WindowPlacementManager.Restore(this);
		Closing += (_, _) => WindowPlacementManager.Save(this);
		Loaded += (_, _) => FocusWebView2();
		Activated += (_, _) => FocusWebView2();
		webView2.NavigationCompleted += OnWebView2NavigationCompleted;

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

	private void OnWebView2NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
	{
		if (e.IsSuccess)
		{
			FocusWebView2();
		}
	}

	private void FocusWebView2()
	{
		if (!IsLoaded || !IsActive)
		{
			return;
		}

		Dispatcher.InvokeAsync(() =>
		{
			webView2.Focus();
			Keyboard.Focus(webView2);
		}, DispatcherPriority.ApplicationIdle);
	}
}
