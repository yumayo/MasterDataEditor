using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;

namespace App.MasterDataEditor;

internal static class WindowPlacementManager
{
	private const int StateVersion = 1;
	private const string StateFileName = "window-state.json";
	private const string NormalWindowState = "Normal";
	private const string MaximizedWindowState = "Maximized";
	private const double MinimumVisibleWidth = 320;
	private const double MinimumVisibleHeight = 200;
	private const uint MonitorDefaultToNearest = 2;
	private const int MonitorInfoPrimary = 1;

	private static readonly JsonSerializerOptions JsonOptions = new()
	{
		Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
		PropertyNameCaseInsensitive = true,
		PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
		WriteIndented = true
	};

	public static void Restore(Window window)
	{
		try
		{
			var state = LoadState();
			if (state == null || !IsValidBounds(state))
			{
				return;
			}

			var transformFromDevice = GetTransformFromDevice(window);
			var monitors = GetDisplayMonitors(transformFromDevice);
			var bounds = new Rect(state.Left, state.Top, state.Width, state.Height);
			var workArea = SelectTargetMonitor(state, bounds, monitors)?.WorkArea ?? SystemParameters.WorkArea;

			if (workArea.Width <= 0 || workArea.Height <= 0)
			{
				return;
			}

			var restoredBounds = ClampToWorkArea(bounds, workArea);
			window.WindowStartupLocation = WindowStartupLocation.Manual;
			window.Left = restoredBounds.Left;
			window.Top = restoredBounds.Top;
			window.Width = restoredBounds.Width;
			window.Height = restoredBounds.Height;

			if (string.Equals(state.WindowState, MaximizedWindowState, StringComparison.OrdinalIgnoreCase))
			{
				window.WindowState = WindowState.Maximized;
			}
			else
			{
				window.WindowState = WindowState.Normal;
			}
		}
		catch (Exception ex)
		{
			Logger.Error(ex, "ウィンドウ位置の復元時にエラーが発生しました。");
		}
	}

	public static void Save(Window window)
	{
		try
		{
			var bounds = window.RestoreBounds;
			if (!IsValidBounds(bounds))
			{
				bounds = new Rect(window.Left, window.Top, window.Width, window.Height);
			}

			if (!IsValidBounds(bounds))
			{
				return;
			}

			var transformFromDevice = GetTransformFromDevice(window);
			var monitors = GetDisplayMonitors(transformFromDevice);
			var monitorDeviceName = FindMonitorForBounds(bounds, monitors)?.DeviceName ?? GetCurrentMonitorDeviceName(window);
			var state = new WindowPlacementState
			{
				Version = StateVersion,
				MonitorDeviceName = monitorDeviceName,
				Left = bounds.Left,
				Top = bounds.Top,
				Width = bounds.Width,
				Height = bounds.Height,
				WindowState = window.WindowState == WindowState.Maximized ? MaximizedWindowState : NormalWindowState
			};

			SaveState(state);
		}
		catch (Exception ex)
		{
			Logger.Error(ex, "ウィンドウ位置の保存時にエラーが発生しました。");
		}
	}

	private static WindowPlacementState? LoadState()
	{
		var path = GetStateFilePath();
		if (!File.Exists(path))
		{
			return null;
		}

		try
		{
			using var stream = File.OpenRead(path);
			return JsonSerializer.Deserialize<WindowPlacementState>(stream, JsonOptions);
		}
		catch (Exception ex)
		{
			Logger.Error(ex, $"ウィンドウ位置設定ファイルの読み込みに失敗しました: {path}");
			return null;
		}
	}

	private static void SaveState(WindowPlacementState state)
	{
		var path = GetStateFilePath();
		Directory.CreateDirectory(AppEnvironment.GetDirectoryName(path));

		var json = JsonSerializer.Serialize(state, JsonOptions).Replace("\r\n", "\n") + "\n";
		var temporaryPath = path + ".tmp";
		File.WriteAllText(temporaryPath, json);
		File.Move(temporaryPath, path, true);
	}

	private static string GetStateFilePath()
	{
		return Path.Combine(AppEnvironment.GetUserDataDir(), StateFileName);
	}

	private static Matrix GetTransformFromDevice(Window window)
	{
		return PresentationSource.FromVisual(window)?.CompositionTarget?.TransformFromDevice ?? Matrix.Identity;
	}

	private static IReadOnlyList<DisplayMonitor> GetDisplayMonitors(Matrix transformFromDevice)
	{
		var monitors = new List<DisplayMonitor>();
		EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr handle, IntPtr hdc, ref NativeRect monitorRect, IntPtr data) =>
		{
			if (TryGetMonitorInfo(handle, out var info))
			{
				monitors.Add(new DisplayMonitor(
					info.DeviceName,
					ToDipRect(info.Bounds, transformFromDevice),
					ToDipRect(info.WorkArea, transformFromDevice),
					info.IsPrimary));
			}

			return true;
		}, IntPtr.Zero);

		return monitors;
	}

	private static DisplayMonitor? SelectTargetMonitor(
		WindowPlacementState state,
		Rect bounds,
		IReadOnlyList<DisplayMonitor> monitors)
	{
		if (monitors.Count == 0)
		{
			return null;
		}

		if (!string.IsNullOrWhiteSpace(state.MonitorDeviceName))
		{
			var savedMonitor = monitors.FirstOrDefault(monitor =>
				string.Equals(monitor.DeviceName, state.MonitorDeviceName, StringComparison.OrdinalIgnoreCase));
			if (savedMonitor != null)
			{
				return savedMonitor;
			}
		}

		var visibleMonitor = monitors
			.Select(monitor => new
			{
				Monitor = monitor,
				VisibleArea = Rect.Intersect(bounds, monitor.WorkArea).GetArea()
			})
			.Where(item => item.VisibleArea > 0)
			.OrderByDescending(item => item.VisibleArea)
			.Select(item => item.Monitor)
			.FirstOrDefault();

		if (visibleMonitor != null)
		{
			return visibleMonitor;
		}

		var nearestMonitor = monitors
			.OrderBy(monitor => GetDistanceSquared(GetCenter(bounds), GetCenter(monitor.WorkArea)))
			.FirstOrDefault();

		return nearestMonitor ?? monitors.FirstOrDefault(monitor => monitor.IsPrimary) ?? monitors[0];
	}

	private static DisplayMonitor? FindMonitorForBounds(Rect bounds, IReadOnlyList<DisplayMonitor> monitors)
	{
		if (monitors.Count == 0)
		{
			return null;
		}

		return monitors
			.Select(monitor => new
			{
				Monitor = monitor,
				VisibleArea = Rect.Intersect(bounds, monitor.WorkArea).GetArea()
			})
			.OrderByDescending(item => item.VisibleArea)
			.Select(item => item.Monitor)
			.FirstOrDefault()
			?? monitors
				.OrderBy(monitor => GetDistanceSquared(GetCenter(bounds), GetCenter(monitor.WorkArea)))
				.FirstOrDefault();
	}

	private static Rect ClampToWorkArea(Rect bounds, Rect workArea)
	{
		var width = Math.Min(Math.Max(bounds.Width, Math.Min(MinimumVisibleWidth, workArea.Width)), workArea.Width);
		var height = Math.Min(Math.Max(bounds.Height, Math.Min(MinimumVisibleHeight, workArea.Height)), workArea.Height);
		var maxLeft = workArea.Right - width;
		var maxTop = workArea.Bottom - height;

		return new Rect(
			Clamp(bounds.Left, workArea.Left, maxLeft),
			Clamp(bounds.Top, workArea.Top, maxTop),
			width,
			height);
	}

	private static double Clamp(double value, double minimum, double maximum)
	{
		if (maximum < minimum)
		{
			return minimum;
		}

		return Math.Min(Math.Max(value, minimum), maximum);
	}

	private static bool IsValidBounds(WindowPlacementState state)
	{
		return state.Version == StateVersion
			&& IsFinite(state.Left)
			&& IsFinite(state.Top)
			&& IsFinite(state.Width)
			&& IsFinite(state.Height)
			&& state.Width > 0
			&& state.Height > 0;
	}

	private static bool IsValidBounds(Rect bounds)
	{
		return IsFinite(bounds.Left)
			&& IsFinite(bounds.Top)
			&& IsFinite(bounds.Width)
			&& IsFinite(bounds.Height)
			&& bounds.Width > 0
			&& bounds.Height > 0;
	}

	private static bool IsFinite(double value)
	{
		return !double.IsNaN(value) && !double.IsInfinity(value);
	}

	private static Point GetCenter(Rect rect)
	{
		return new Point(rect.Left + rect.Width / 2, rect.Top + rect.Height / 2);
	}

	private static double GetDistanceSquared(Point left, Point right)
	{
		var x = left.X - right.X;
		var y = left.Y - right.Y;
		return x * x + y * y;
	}

	private static Rect ToDipRect(NativeRect rect, Matrix transformFromDevice)
	{
		var topLeft = transformFromDevice.Transform(new Point(rect.Left, rect.Top));
		var bottomRight = transformFromDevice.Transform(new Point(rect.Right, rect.Bottom));
		return new Rect(topLeft, bottomRight);
	}

	private static string? GetCurrentMonitorDeviceName(Window window)
	{
		var handle = new WindowInteropHelper(window).Handle;
		if (handle == IntPtr.Zero)
		{
			return null;
		}

		var monitorHandle = MonitorFromWindow(handle, MonitorDefaultToNearest);
		return TryGetMonitorInfo(monitorHandle, out var info) ? info.DeviceName : null;
	}

	private static bool TryGetMonitorInfo(IntPtr handle, out NativeMonitorInfo monitorInfo)
	{
		monitorInfo = default;
		if (handle == IntPtr.Zero)
		{
			return false;
		}

		var nativeInfo = new MonitorInfoEx
		{
			Size = Marshal.SizeOf<MonitorInfoEx>(),
			DeviceName = string.Empty
		};

		if (!GetMonitorInfo(handle, ref nativeInfo))
		{
			return false;
		}

		monitorInfo = new NativeMonitorInfo(
			nativeInfo.DeviceName,
			nativeInfo.Monitor,
			nativeInfo.WorkArea,
			(nativeInfo.Flags & MonitorInfoPrimary) == MonitorInfoPrimary);
		return true;
	}

	[DllImport("user32.dll")]
	private static extern bool EnumDisplayMonitors(
		IntPtr hdc,
		IntPtr clipRect,
		MonitorEnumProc enumProc,
		IntPtr data);

	[DllImport("user32.dll", CharSet = CharSet.Unicode)]
	private static extern bool GetMonitorInfo(IntPtr monitorHandle, ref MonitorInfoEx monitorInfo);

	[DllImport("user32.dll")]
	private static extern IntPtr MonitorFromWindow(IntPtr windowHandle, uint flags);

	private delegate bool MonitorEnumProc(IntPtr monitorHandle, IntPtr hdc, ref NativeRect monitorRect, IntPtr data);

	private sealed class WindowPlacementState
	{
		public int Version { get; set; } = StateVersion;
		public string? MonitorDeviceName { get; set; }
		public double Left { get; set; }
		public double Top { get; set; }
		public double Width { get; set; }
		public double Height { get; set; }
		public string WindowState { get; set; } = NormalWindowState;
	}

	private sealed record DisplayMonitor(string DeviceName, Rect Bounds, Rect WorkArea, bool IsPrimary);

	private readonly record struct NativeMonitorInfo(
		string DeviceName,
		NativeRect Bounds,
		NativeRect WorkArea,
		bool IsPrimary);

	[StructLayout(LayoutKind.Sequential)]
	private struct NativeRect
	{
		public int Left;
		public int Top;
		public int Right;
		public int Bottom;
	}

	[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
	private struct MonitorInfoEx
	{
		public int Size;
		public NativeRect Monitor;
		public NativeRect WorkArea;
		public int Flags;

		[MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
		public string DeviceName;
	}
}

internal static class RectExtensions
{
	public static double GetArea(this Rect rect)
	{
		return rect.IsEmpty ? 0 : rect.Width * rect.Height;
	}
}
