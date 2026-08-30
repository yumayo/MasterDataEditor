using Microsoft.Win32;
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace App.MasterDataEditor;

/// <summary>
/// Windows のアプリテーマに合わせて、標準タイトルバーのライト／ダーク表示を切り替える。
/// タイトルバー自体の色は指定せず、Windows のテーマ色とアクセントカラーをそのまま使用する。
/// </summary>
internal static class WindowTitleBarTheme
{
	private const string PersonalizeRegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
	private const string AppsUseLightThemeValueName = "AppsUseLightTheme";
	private const int DwmUseImmersiveDarkModeBefore20H1 = 19;
	private const int DwmUseImmersiveDarkMode = 20;

	private static bool _isDark = ReadIsDarkTheme();
	private static bool _isInitialized;

	public static void Initialize(Application application)
	{
		if (_isInitialized)
		{
			return;
		}

		_isInitialized = true;
		SystemEvents.UserPreferenceChanged += OnUserPreferenceChanged;
		application.Exit += (_, _) => SystemEvents.UserPreferenceChanged -= OnUserPreferenceChanged;
	}

	public static void Apply(Window window)
	{
		window.SourceInitialized += (_, _) => ApplyToHandle(window);
		ApplyToHandle(window);
	}

	private static void OnUserPreferenceChanged(object sender, UserPreferenceChangedEventArgs e)
	{
		if (e.Category != UserPreferenceCategory.Color &&
			e.Category != UserPreferenceCategory.General &&
			e.Category != UserPreferenceCategory.VisualStyle &&
			e.Category != UserPreferenceCategory.Window)
		{
			return;
		}

		Application? application = Application.Current;
		if (application == null)
		{
			return;
		}

		application.Dispatcher.BeginInvoke((Action)(() =>
		{
			bool isDark = ReadIsDarkTheme();
			if (isDark == _isDark)
			{
				return;
			}

			_isDark = isDark;
			foreach (Window window in application.Windows)
			{
				ApplyToHandle(window);
			}
		}));
	}

	private static void ApplyToHandle(Window window)
	{
		IntPtr handle = new WindowInteropHelper(window).Handle;
		if (handle == IntPtr.Zero)
		{
			return;
		}

		try
		{
			int value = _isDark ? 1 : 0;
			int result = DwmSetWindowAttribute(
				handle,
				DwmUseImmersiveDarkMode,
				ref value,
				sizeof(int));

			if (result != 0)
			{
				DwmSetWindowAttribute(
					handle,
					DwmUseImmersiveDarkModeBefore20H1,
					ref value,
					sizeof(int));
			}
		}
		catch (Exception ex) when (ex is DllNotFoundException || ex is EntryPointNotFoundException)
		{
			Logger.Debug($"タイトルバーへのWindowsテーマ適用をスキップしました。{ex.Message}");
		}
	}

	private static bool ReadIsDarkTheme()
	{
		try
		{
			object? value = Registry.CurrentUser
				.OpenSubKey(PersonalizeRegistryPath, writable: false)
				?.GetValue(AppsUseLightThemeValueName);

			return value is int appsUseLightTheme && appsUseLightTheme == 0;
		}
		catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is System.Security.SecurityException)
		{
			Logger.Debug($"Windowsテーマを取得できなかったため、ライトテーマを使用します。{ex.Message}");
			return false;
		}
	}

	[DllImport("dwmapi.dll", PreserveSig = true)]
	private static extern int DwmSetWindowAttribute(
		IntPtr hwnd,
		int attribute,
		ref int attributeValue,
		int attributeSize);
}
