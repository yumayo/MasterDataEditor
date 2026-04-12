using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Interop;

namespace App.MasterDataEditor;

/// <summary>
/// Interaction logic for MainWindow.xaml
/// </summary>
public partial class MainWindow : Window, IWebViewWindowController
{
	private const int WmGetMinMaxInfo = 0x0024;
	private const int WmNcLButtonDown = 0x00A1;
	private const uint MonitorDefaultToNearest = 0x00000002;
	private const int DwmwaNcrenderingPolicy = 2;
	private const int DwmncrpEnabled = 2;
	private static readonly IntPtr HtCaption = new(2);
	private static readonly IntPtr HtLeft = new(10);
	private static readonly IntPtr HtRight = new(11);
	private static readonly IntPtr HtTop = new(12);
	private static readonly IntPtr HtTopLeft = new(13);
	private static readonly IntPtr HtTopRight = new(14);
	private static readonly IntPtr HtBottom = new(15);
	private static readonly IntPtr HtBottomLeft = new(16);
	private static readonly IntPtr HtBottomRight = new(17);
	private const double RestoredWindowDragTopOffset = 18;
	[DllImport("user32.dll")]
	private static extern bool ReleaseCapture();
	[DllImport("user32.dll", CharSet = CharSet.Auto)]
	private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
	[DllImport("user32.dll")]
	private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);
	[DllImport("user32.dll", CharSet = CharSet.Auto)]
	private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MonitorInfo monitorInfo);
	[DllImport("dwmapi.dll")]
	private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int valueSize);
	[DllImport("dwmapi.dll")]
	private static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref Margins margins);

	private IntPtr _windowHandle;
	private WebView2Handler? _webView2Handler;

	public MainWindow()
	{
		InitializeComponent();
		_windowHandle = IntPtr.Zero;

		Title = $"マスターデータ入力支援ツール";
		StateChanged += (_, _) => SendWindowStateChanged();
		SourceInitialized += (_, _) =>
		{
			_windowHandle = new WindowInteropHelper(this).Handle;
			var source = HwndSource.FromHwnd(_windowHandle);
			source?.AddHook(WindowProc);
			EnableWindowShadow();
		};

		Logger.Info("Starting MainWindow service initialization");
		Application.Current.Dispatcher.InvokeAsync(InitializeWebView2handler);

		Logger.Info("MainWindow initialized with WebView2");
	}

	private async Task InitializeWebView2handler()
	{
		var consoleLogPath = AppEnvironment.GetConsoleLogPath();
		_webView2Handler = await WebView2Handler.CreateAsync(Application.Current.Dispatcher, webView2, consoleLogPath, this);

		// EditorApiBridgeをWebView2Handlerに接続し、MCPツールからのAPI呼び出しを有効にする
		((App)Application.Current).ConnectEditorApiBridge(_webView2Handler);
	}

	void IWebViewWindowController.BeginWindowDrag(double screenX, double screenY)
	{
		if (_windowHandle == IntPtr.Zero)
		{
			throw new InvalidOperationException("ウィンドウハンドルが初期化される前にドラッグ開始が要求されました。");
		}

		if (WindowState == WindowState.Maximized)
		{
			var restoreBounds = RestoreBounds;
			var currentWidth = ActualWidth;
			if (restoreBounds.Width > 0 && currentWidth > 0)
			{
				var relativeX = Math.Clamp((screenX - Left) / currentWidth, 0.0, 1.0);
				WindowState = WindowState.Normal;
				Left = screenX - (restoreBounds.Width * relativeX);
				Top = screenY - RestoredWindowDragTopOffset;
			}
			else
			{
				WindowState = WindowState.Normal;
			}
		}

		ReleaseCapture();
		SendMessage(_windowHandle, WmNcLButtonDown, HtCaption, IntPtr.Zero);
	}

	void IWebViewWindowController.BeginWindowResize(string direction)
	{
		if (_windowHandle == IntPtr.Zero)
		{
			throw new InvalidOperationException("ウィンドウハンドルが初期化される前にリサイズ開始が要求されました。");
		}
		if (WindowState == WindowState.Maximized)
		{
			return;
		}

		ReleaseCapture();
		SendMessage(_windowHandle, WmNcLButtonDown, GetResizeHitTest(direction), IntPtr.Zero);
	}

	void IWebViewWindowController.ShowSystemMenu(double screenX, double screenY)
	{
		SystemCommands.ShowSystemMenu(this, new Point(screenX, screenY));
	}

	void IWebViewWindowController.MinimizeWindow()
	{
		WindowState = WindowState.Minimized;
	}

	void IWebViewWindowController.ToggleMaximizeWindow()
	{
		WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
	}

	void IWebViewWindowController.CloseWindow()
	{
		Close();
	}

	object IWebViewWindowController.CreateWindowStateChangedMessage()
	{
		return new
		{
			type = "window_state_changed",
			isMaximized = WindowState == WindowState.Maximized,
			title = Title
		};
	}

	private void SendWindowStateChanged()
	{
		_webView2Handler?.SendWindowStateChanged();
	}

	private static IntPtr GetResizeHitTest(string direction)
	{
		return direction switch
		{
			"left" => HtLeft,
			"right" => HtRight,
			"top" => HtTop,
			"top_left" => HtTopLeft,
			"top_right" => HtTopRight,
			"bottom" => HtBottom,
			"bottom_left" => HtBottomLeft,
			"bottom_right" => HtBottomRight,
			_ => throw new InvalidOperationException($"未知のリサイズ方向: {direction}")
		};
	}

	private IntPtr WindowProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
	{
		if (msg == WmGetMinMaxInfo)
		{
			ApplyMonitorWorkAreaToMaximizedWindow(hwnd, lParam);
			handled = true;
		}
		return IntPtr.Zero;
	}

	private static void ApplyMonitorWorkAreaToMaximizedWindow(IntPtr hwnd, IntPtr lParam)
	{
		var monitor = MonitorFromWindow(hwnd, MonitorDefaultToNearest);
		if (monitor == IntPtr.Zero)
		{
			return;
		}

		var monitorInfo = MonitorInfo.Create();
		if (!GetMonitorInfo(monitor, ref monitorInfo))
		{
			throw new InvalidOperationException("モニター情報の取得に失敗しました。");
		}

		var minMaxInfo = Marshal.PtrToStructure<MinMaxInfo>(lParam);
		var workArea = monitorInfo.WorkArea;
		var monitorArea = monitorInfo.MonitorArea;

		minMaxInfo.MaxPosition.X = workArea.Left - monitorArea.Left;
		minMaxInfo.MaxPosition.Y = workArea.Top - monitorArea.Top;
		minMaxInfo.MaxSize.X = workArea.Right - workArea.Left;
		minMaxInfo.MaxSize.Y = workArea.Bottom - workArea.Top;

		Marshal.StructureToPtr(minMaxInfo, lParam, false);
	}

	private void EnableWindowShadow()
	{
		if (_windowHandle == IntPtr.Zero)
		{
			throw new InvalidOperationException("ウィンドウハンドルが初期化される前に影の有効化が要求されました。");
		}

		var renderingPolicy = DwmncrpEnabled;
		var setAttributeResult = DwmSetWindowAttribute(_windowHandle, DwmwaNcrenderingPolicy, ref renderingPolicy, Marshal.SizeOf<int>());
		if (setAttributeResult != 0)
		{
			Logger.Warning($"DwmSetWindowAttribute に失敗しました。HRESULT=0x{setAttributeResult:X8}");
			return;
		}

		var margins = new Margins
		{
			LeftWidth = 1,
			RightWidth = 1,
			TopHeight = 1,
			BottomHeight = 1
		};
		var extendFrameResult = DwmExtendFrameIntoClientArea(_windowHandle, ref margins);
		if (extendFrameResult != 0)
		{
			Logger.Warning($"DwmExtendFrameIntoClientArea に失敗しました。HRESULT=0x{extendFrameResult:X8}");
		}
	}

	[StructLayout(LayoutKind.Sequential)]
	private struct PointInt
	{
		public int X;
		public int Y;
	}

	[StructLayout(LayoutKind.Sequential)]
	private struct MinMaxInfo
	{
		public PointInt Reserved;
		public PointInt MaxSize;
		public PointInt MaxPosition;
		public PointInt MinTrackSize;
		public PointInt MaxTrackSize;
	}

	[StructLayout(LayoutKind.Sequential)]
	private struct RectInt
	{
		public int Left;
		public int Top;
		public int Right;
		public int Bottom;
	}

	[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
	private struct MonitorInfo
	{
		public int Size;
		public RectInt MonitorArea;
		public RectInt WorkArea;
		public uint Flags;

		public static MonitorInfo Create()
		{
			return new MonitorInfo
			{
				Size = Marshal.SizeOf<MonitorInfo>()
			};
		}
	}

	[StructLayout(LayoutKind.Sequential)]
	private struct Margins
	{
		public int LeftWidth;
		public int RightWidth;
		public int TopHeight;
		public int BottomHeight;
	}
}
