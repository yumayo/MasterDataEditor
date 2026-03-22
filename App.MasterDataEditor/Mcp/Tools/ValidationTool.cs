using System;
using System.ComponentModel;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using ModelContextProtocol.Server;

namespace App.MasterDataEditor.Mcp.Tools;

/// <summary>
/// バリデーションエラーを取得するMCPツール。
/// EditorApiBridge経由でWebView2のValidationEngineを呼び出し、
/// PK重複・FK参照切れ・型不一致のエラー一覧を人間可読なテキストで返す。
/// </summary>
[McpServerToolType]
public sealed class ValidationTool
{
	private readonly EditorApiBridge _bridge;

	public ValidationTool(EditorApiBridge bridge)
	{
		_bridge = bridge;
	}

	[McpServerTool, Description("開いているテーブルのバリデーションエラー一覧を取得します（PK重複・FK参照切れ・型不一致）。まだタブで開いていないテーブルはバリデーション対象外です。FK参照切れの検出は参照先テーブルが開いているかキャッシュ済みの場合のみ有効です。テーブル名を指定すると、そのテーブルのエラーのみに絞り込めます。")]
	public async Task<string> GetValidationErrorsAsync(
		[Description("テーブル名（省略時は全テーブル対象）")] string? tableName = null,
		CancellationToken cancellationToken = default)
	{
		try
		{
			var result = await _bridge.RequestAsync("data.getValidationErrors", new { }, cancellationToken);

			if (result.ValueKind != JsonValueKind.Array)
			{
				return "エラー: バリデーション結果の取得に失敗しました。";
			}

			var sb = new StringBuilder();
			var totalCount = 0;

			foreach (var error in result.EnumerateArray())
			{
				var errorTableName = error.GetProperty("tableName").GetString()!;

				// テーブル名フィルタ: 指定されている場合はそのテーブルのエラーのみ
				if (!string.IsNullOrWhiteSpace(tableName) && errorTableName != tableName)
				{
					continue;
				}

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
					_ => kind
				};

				sb.AppendLine($"[{kindLabel}] {errorTableName} 行{rowIndex + 1} (rowIndex={rowIndex}) 列 \"{columnName}\": 値 \"{value}\" — {message}");
				totalCount++;
			}

			if (totalCount == 0)
			{
				if (string.IsNullOrWhiteSpace(tableName))
				{
					return "バリデーションエラーはありません。";
				}
				return $"テーブル \"{tableName}\" にバリデーションエラーはありません。";
			}

			var header = string.IsNullOrWhiteSpace(tableName)
				? $"バリデーションエラー ({totalCount}件):"
				: $"バリデーションエラー ({totalCount}件, テーブル: {tableName}):";

			return header + "\n\n" + sb.ToString();
		}
		catch (OperationCanceledException)
		{
			return "エラー: リクエストがキャンセルまたはタイムアウトしました。";
		}
		catch (InvalidOperationException ex) when (ex.Message.Contains("WebView2"))
		{
			return "エラー: エディタがまだ起動していません。アプリケーションのメインウィンドウを開いてください。";
		}
		catch (Exception)
		{
			return "エラー: バリデーションエラー取得中に内部エラーが発生しました。";
		}
	}
}
