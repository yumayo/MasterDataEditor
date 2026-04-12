using App.MasterDataEditor.Mcp;
using Microsoft.Web.WebView2.Wpf;
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;

namespace App.MasterDataEditor.Headless;

/// <summary>
/// --validate モード用のヘッドレスバリデーター。
/// WPF ウィンドウを表示せずに WebView2 を起動し、TypeScript の ValidationEngine + PluginValidationRunner を
/// そのまま使ってバリデーション結果を取得する。
/// バリデーションロジックの二重実装を避け、フロントエンド側のSSOTを維持する。
/// </summary>
internal static class HeadlessValidator
{
    /// <summary>WinExe は起動時にコンソールを持たないため、親プロセスのコンソールにアタッチする。</summary>
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AttachConsole(int dwProcessId);

    /// <summary>コンソールの出力コードページを設定する。</summary>
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetConsoleOutputCP(uint wCodePageID);

    private const int ATTACH_PARENT_PROCESS = -1;
    private const uint CP_UTF8 = 65001;

    /// <summary>ヘッドレスバリデーションを実行する。WPF Application.Run() でメッセージループを起動し、完了後に終了する。</summary>
    public static void Run()
    {
        // WinExe は標準出力を持たないため、親プロセス（ターミナル）のコンソールにアタッチする。
        // cmd.exe のデフォルトコードページは 932（Shift-JIS）なので UTF-8（65001）に切り替える。
        AttachConsole(ATTACH_PARENT_PROCESS);
        SetConsoleOutputCP(CP_UTF8);
        Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), Encoding.UTF8) { AutoFlush = true });
        Console.SetError(new StreamWriter(Console.OpenStandardError(), Encoding.UTF8) { AutoFlush = true });

        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        var exitCode = 1;
        app.Startup += (_, _) =>
        {
            app.Dispatcher.InvokeAsync(async () =>
            {
                try
                {
                    exitCode = await RunAsync();
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"ヘッドレスバリデーション中にエラーが発生しました: {ex.Message}");
                }
                finally
                {
                    app.Shutdown();
                }
            });
        };
        app.Run();
        Environment.ExitCode = exitCode;
    }

    /// <summary>WebView2 を起動してバリデーションを実行し、終了コード（0=エラーなし, 1=エラーあり）を返す。</summary>
    private static async Task<int> RunAsync()
    {
        // 非表示ウィンドウを作成して WebView2 を配置する。
        // WebView2 の初期化には親ウィンドウの HWND が必要なため、Show() → Hide() で HWND を確保する。
        var webView2Control = new WebView2();
        var window = new Window
        {
            Content = webView2Control,
            Width = 1,
            Height = 1,
            ShowInTaskbar = false,
            ShowActivated = false,
            WindowStyle = WindowStyle.None,
        };
        window.Show();
        window.Hide();

        try
        {
            // 既存の WebView2Handler を使ってファイルI/Oハンドラ等を有効化する
            var consoleLogPath = AppEnvironment.GetConsoleLogPath();
            var handler = await WebView2Handler.CreateAsync(Application.Current.Dispatcher, webView2Control, consoleLogPath, NullWebViewWindowController.Instance);

            // EditorApiBridge を接続して TypeScript API を呼び出し可能にする
            var bridge = new EditorApiBridge();
            handler.ConnectEditorApiBridge(bridge);

            // TypeScript アプリの初期化完了を待機する（window.editorApi が定義されるまでポーリング）
            Console.Error.WriteLine("WebView2 初期化完了。アプリケーションの読み込みを待機中...");
            await WaitForEditorApiReadyAsync(webView2Control);

            // 起動時バリデーションスキャン（全テーブルのストア登録）の完了を待機する。
            // schema.getSchemaTableNames() で全スキーマテーブル数を取得し、
            // data.getTableNames() でストアに登録済みのテーブル数が追いつくまでポーリングする。
            Console.Error.WriteLine("全テーブルの読み込みを待機中...");
            await WaitForAllTablesLoadedAsync(bridge);

            // プラグインバリデーション含む全バリデーション結果を取得する
            Console.Error.WriteLine("バリデーションを実行中...");
            var result = await bridge.RequestAsync("data.getValidationErrorsAsync", new { }, CancellationToken.None);

            // 結果を stdout に出力する
            return OutputValidationResult(result);
        }
        finally
        {
            window.Close();
        }
    }

    /// <summary>TypeScript 側の EditorAPI が初期化されるまでポーリングする。</summary>
    private static async Task WaitForEditorApiReadyAsync(WebView2 webView2Control)
    {
        var timeout = TimeSpan.FromSeconds(30);
        var deadline = DateTime.UtcNow + timeout;

        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var result = await webView2Control.CoreWebView2.ExecuteScriptAsync(
                    "typeof window.editorApi !== 'undefined'");
                if (result == "true") return;
            }
            catch
            {
                // ページ読み込み中は例外が発生する可能性がある
            }
            await Task.Delay(100);
        }

        throw new TimeoutException("EditorAPI の初期化がタイムアウトしました（30秒）");
    }

    /// <summary>全スキーマテーブルが InMemoryTableStore に登録されるまでポーリングする。</summary>
    private static async Task WaitForAllTablesLoadedAsync(EditorApiBridge bridge)
    {
        var timeout = TimeSpan.FromSeconds(60);
        var deadline = DateTime.UtcNow + timeout;
        var ct = CancellationToken.None;

        while (DateTime.UtcNow < deadline)
        {
            var schemaNames = await bridge.RequestAsync("schema.getSchemaTableNames", new { }, ct);
            var storeNames = await bridge.RequestAsync("data.getTableNames", new { }, ct);

            var schemaCount = schemaNames.GetArrayLength();
            var storeCount = storeNames.GetArrayLength();

            if (schemaCount > 0 && storeCount >= schemaCount)
            {
                Console.Error.WriteLine($"全 {storeCount} テーブルの読み込みが完了しました。");
                return;
            }

            await Task.Delay(200);
        }

        throw new TimeoutException("全テーブルの読み込みがタイムアウトしました（60秒）");
    }

    /// <summary>バリデーション結果を ValidationTool.cs と同じフォーマットで stdout に出力する。</summary>
    private static int OutputValidationResult(JsonElement result)
    {
        if (result.ValueKind != JsonValueKind.Array)
        {
            Console.Error.WriteLine("エラー: バリデーション結果の取得に失敗しました。");
            return 1;
        }

        var totalCount = 0;
        var sb = new StringBuilder();

        foreach (var error in result.EnumerateArray())
        {
            var tableName = error.GetProperty("tableName").GetString()!;
            var rowIndex = error.GetProperty("rowIndex").GetInt32();
            var columnName = error.GetProperty("columnName").GetString()!;
            var value = error.GetProperty("value").GetString()!;
            var kind = error.GetProperty("kind").GetString()!;
            var message = error.GetProperty("message").GetString()!;

            var kindLabel = kind switch
            {
                "pk-duplicate" => "PK重複",
                "fk-broken" => "FK参照切れ",
                "type-mismatch" => "型不一致",
                "plugin" => "プラグイン",
                _ => kind,
            };

            if (rowIndex == -1)
            {
                sb.AppendLine($"[{kindLabel}] {message}");
            }
            else
            {
                sb.AppendLine($"[{kindLabel}] {tableName} 行{rowIndex + 1} (rowIndex={rowIndex}) 列 \"{columnName}\": 値 \"{value}\" — {message}");
            }
            totalCount++;
        }

        if (totalCount == 0)
        {
            Console.WriteLine("バリデーションエラーはありません。");
            return 0;
        }

        Console.WriteLine($"バリデーションエラー ({totalCount}件):");
        Console.WriteLine();
        Console.Write(sb.ToString());
        return 1;
    }
}
