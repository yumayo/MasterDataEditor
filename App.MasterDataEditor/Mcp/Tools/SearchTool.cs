using System;
using System.ComponentModel;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using ModelContextProtocol.Server;

namespace App.MasterDataEditor.Mcp.Tools;

/// <summary>
/// SEARCHパネルと同じ全文検索エンジンをMCP経由で公開するツール。
/// 実際の検索処理はWebView2側のEditorAPIに委譲し、C#側では結果整形のみ行う。
/// </summary>
[McpServerToolType]
public sealed class SearchTool
{
	private const int DefaultMaxResults = 50;
	private const int MaxMaxResults = 200;

	private readonly EditorApiBridge _bridge;

	public SearchTool(EditorApiBridge bridge)
	{
		_bridge = bridge;
	}

	[McpServerTool, Description("SEARCHパネルと同じ検索エンジンでテーブル横断検索を実行します。query には通常の全文検索語、または table.column = value 形式のクエリ式を指定できます。開いているテーブルは編集中の最新値を優先し、数値のみのqueryでは単語一致が自動で有効になります。")]
	public async Task<string> SearchAsync(
		[Description("検索クエリ。通常の全文検索語、または table.column = value 形式")] string query,
		[Description("大文字小文字を区別するか")] bool caseSensitive = false,
		[Description("単語一致にするか")] bool wholeWord = false,
		[Description("正規表現として解釈するか")] bool useRegex = false,
		[Description("返却する最大件数（1〜200、既定50件）")] int maxResults = DefaultMaxResults,
		CancellationToken cancellationToken = default)
	{
		if (string.IsNullOrWhiteSpace(query))
		{
			return "エラー: query を指定してください。";
		}
		if (maxResults < 1 || maxResults > MaxMaxResults)
		{
			return $"エラー: maxResults は1〜{MaxMaxResults}の範囲で指定してください。";
		}

		try
		{
			var result = await _bridge.RequestAsync("data.searchCellsAsync", new { queryText = query, caseSensitive, wholeWord, useRegex }, cancellationToken);
			if (result.ValueKind != JsonValueKind.Array)
			{
				return "エラー: 検索結果の取得に失敗しました。";
			}

			var totalCount = result.GetArrayLength();
			if (totalCount == 0)
			{
				return "検索結果はありません。";
			}

			var sb = new StringBuilder();
			var index = 0;
			foreach (var item in result.EnumerateArray())
			{
				if (index >= maxResults)
				{
					break;
				}

				var tableName = item.GetProperty("tableName").GetString()!;
				var rowIndex = item.GetProperty("rowIndex").GetInt32();
				var columnName = item.GetProperty("columnName").GetString()!;
				var pkValue = item.GetProperty("pkValue").GetString()!;
				var value = item.GetProperty("value").GetString()!;
				var referenceDisplayText = item.GetProperty("referenceDisplayText").GetString()!;

				sb.Append($"- {tableName}.{columnName} 行{rowIndex + 1} (rowIndex={rowIndex}) PK \"{pkValue}\": 値 \"{value}\"");
				if (!string.IsNullOrWhiteSpace(referenceDisplayText))
				{
					sb.Append($" / 表示 \"{referenceDisplayText}\"");
				}
				sb.AppendLine();
				index++;
			}

			var header = totalCount > maxResults
				? $"検索結果 ({totalCount}件, 先頭{maxResults}件を表示):"
				: $"検索結果 ({totalCount}件):";

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
		catch (Exception ex)
		{
			return $"エラー: 検索中に内部エラーが発生しました。詳細: {ex.Message}";
		}
	}
}
