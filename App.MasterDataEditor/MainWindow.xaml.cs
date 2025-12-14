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

		Logger.Info("Starting MainWindow service initialization");
		Application.Current.Dispatcher.InvokeAsync(InitializeWebView2handler);

		Logger.Info("MainWindow initialized with WebView2");
	}

	private async Task InitializeWebView2handler()
	{
		_webView2Handler = await WebView2Handler.CreateAsync(Application.Current.Dispatcher, webView2);
	}
}
