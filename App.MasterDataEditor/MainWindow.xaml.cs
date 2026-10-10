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
	private bool _closed;

	public MainWindow()
	{
		InitializeComponent();

		Title = $"マスターデータ入力支援ツール";
		WindowTitleBarTheme.Apply(this);
		SourceInitialized += (_, _) => WindowPlacementManager.Restore(this);
		Closing += (_, _) => WindowPlacementManager.Save(this);
		Closed += (_, _) =>
		{
			_closed = true;
			if (_webView2Handler != null)
			{
				_webView2Handler.Dispose();
				webView2.Dispose();
			}
		};
		Loaded += (_, _) => FocusWebView2();
		Activated += (_, _) => FocusWebView2();
		webView2.NavigationCompleted += OnWebView2NavigationCompleted;

		Logger.Info("Starting MainWindow service initialization");
		Application.Current.Dispatcher.InvokeAsync(InitializeWebView2handler);

		Logger.Info("MainWindow initialized with WebView2");
	}

	private async Task InitializeWebView2handler()
	{
		if (_closed)
		{
			webView2.Dispose();
			return;
		}
		var consoleLogPath = AppEnvironment.GetConsoleLogPath();
		var handler = await WebView2Handler.CreateAsync(Application.Current.Dispatcher, webView2, consoleLogPath);
		if (_closed)
		{
			handler.Dispose();
			webView2.Dispose();
			return;
		}
		_webView2Handler = handler;

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
