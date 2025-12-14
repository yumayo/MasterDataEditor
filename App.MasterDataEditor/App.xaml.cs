using System;
using System.Threading.Tasks;
using System.Windows;

namespace App.MasterDataEditor;

/// <summary>
/// Interaction logic for App.xaml
/// </summary>
public partial class App : Application
{
	[STAThread]
	public static void Main()
	{
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

		base.OnStartup(e);
		Logger.Info("WPF base.OnStartup completed");
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