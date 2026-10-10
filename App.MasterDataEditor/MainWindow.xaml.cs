using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
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
    private bool _workspaceTrustDialogPending;

	public MainWindow()
	{
		InitializeComponent();
        WorkspaceTrust.Changed += OnWorkspaceTrustChanged;

		Title = $"マスターデータ入力支援ツール";
		WindowTitleBarTheme.Apply(this);
		SourceInitialized += (_, _) => WindowPlacementManager.Restore(this);
		Closing += (_, _) => WindowPlacementManager.Save(this);
		Closed += (_, _) =>
		{
			_closed = true;
            WorkspaceTrust.Changed -= OnWorkspaceTrustChanged;
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

    private void OnWorkspaceTrustClick(object sender, RoutedEventArgs e)
    {
        ScheduleWorkspaceTrustDialog();
    }

    internal void ScheduleWorkspaceTrustDialog()
    {
        if (_closed || Dispatcher.HasShutdownStarted) throw new InvalidOperationException("終了中のウィンドウでは信頼設定を開けません。");
        if (_workspaceTrustDialogPending) return;
        // 予約時点でガードし、連続したWebView要求から確認画面を重ねない。
        _workspaceTrustDialogPending = true;
        try
        {
            // 通常優先度の受理応答を先に返し、人が確認する時間をAPIタイムアウトに含めない。
            Dispatcher.BeginInvoke(DispatcherPriority.ContextIdle, new Action(() =>
            {
                try
                {
                    if (_closed) return;
                    var workDir = AppEnvironment.GetWorkDir();
                    var trusted = WorkspaceTrust.IsTrusted(workDir);
                    var message = trusted
                        ? $"この作業フォルダーの信頼を解除しますか？\n\n{workDir}\n\n実行中のプラグイン、保存フック、ターミナルを停止し、Git 操作を無効にします。View 固有の未保存状態は破棄されます。"
                        : $"この作業フォルダーの作成者と内容を信頼しますか？\n\n{workDir}\n\nプラグイン、保存フック、ターミナル、Git が有効になります。保存フックや Git 設定は、このユーザーの権限でプログラムを実行できます。信頼はこの起動中だけ有効です。";
                    var result = MessageBox.Show(this, message, "作業フォルダーの信頼", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No);
                    if (_closed || result != MessageBoxResult.Yes) return;
                    if (trusted) WorkspaceTrust.Revoke();
                    else WorkspaceTrust.GrantFromNativeUi(workDir);
                }
                catch (Exception error)
                {
                    Logger.Error(error, "作業フォルダーの信頼設定を変更できませんでした。");
                    if (!_closed) MessageBox.Show(this, error.Message, "信頼設定のエラー", MessageBoxButton.OK, MessageBoxImage.Error);
                }
                finally { _workspaceTrustDialogPending = false; }
            }));
        }
        catch { _workspaceTrustDialogPending = false; throw; }
    }

    private void OnWorkspaceTrustChanged()
    {
        Dispatcher.InvokeAsync(() =>
        {
            if (!_closed) workspaceTrustBar.Visibility = WorkspaceTrust.IsTrusted(AppEnvironment.GetWorkDir()) ? Visibility.Collapsed : Visibility.Visible;
        });
    }

    internal void ApplyNativeTheme(NativeThemePalette palette)
    {
        if (_closed) return;
        var colors = new (string Name, NativeRgba Color)[]
        {
            ("NativeBackground", palette.Background), ("NativeSurface", palette.Surface), ("NativeForeground", palette.Foreground),
            ("NativeSecondaryForeground", palette.SecondaryForeground), ("NativeBorder", palette.Border), ("NativeHover", palette.Hover),
            ("NativePressed", palette.Pressed), ("NativeFocus", palette.Focus),
        };
        foreach (var (name, color) in colors)
        {
            var brush = new SolidColorBrush(Color.FromArgb(color.Alpha, color.Red, color.Green, color.Blue));
            brush.Freeze();
            Resources[name] = brush;
        }
    }

	private async Task InitializeWebView2handler()
	{
		if (_closed)
		{
			webView2.Dispose();
			return;
		}
		var consoleLogPath = AppEnvironment.GetConsoleLogPath();
		var handler = await WebView2Handler.CreateAsync(Application.Current.Dispatcher, webView2, consoleLogPath, this);
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
