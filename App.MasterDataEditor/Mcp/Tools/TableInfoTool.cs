using System.ComponentModel;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using ModelContextProtocol.Server;

namespace App.MasterDataEditor.Mcp.Tools;

/// <summary>
/// テーブル情報を取得するMCPツール。
/// EditorApiBridge経由でWebView2のInMemoryTableStore（SSOT）からデータを読み取る。
/// </summary>
[McpServerToolType]
public sealed class TableInfoTool
{
	private readonly EditorApiBridge _bridge;

	public TableInfoTool(EditorApiBridge bridge)
	{
		_bridge = bridge;
	}

	[McpServerTool, Description("現在開いているテーブルの一覧を取得します。")]
	public async Task<string> ListTablesAsync(CancellationToken cancellationToken)
	{
		var result = await _bridge.RequestAsync("data.getTableNames", new { }, cancellationToken);
		var tableNames = result.Deserialize<string[]>()!;

		if (tableNames.Length == 0)
		{
			return "現在開いているテーブルはありません。テーブルを開いてから再度お試しください。";
		}

		var sb = new StringBuilder();
		sb.AppendLine($"開いているテーブル ({tableNames.Length}件):");
		foreach (var name in tableNames)
		{
			var rowCountResult = await _bridge.RequestAsync("data.getRowCount", new { tableName = name }, cancellationToken);
			var rowCount = rowCountResult.ValueKind == JsonValueKind.Number ? rowCountResult.GetInt32() : 0;
			sb.AppendLine($"  - {name} ({rowCount}行)");
		}
		return sb.ToString();
	}

	[McpServerTool, Description("指定したテーブルのスキーマ（カラム定義・主キー・外部キー参照）とデータを取得します。テーブルの内容について質問するときに使ってください。")]
	public async Task<string> DescribeTableAsync(
		[Description("テーブル名")] string tableName,
		CancellationToken cancellationToken)
	{
		var param = new { tableName };

		// スキーマとデータを並列取得
		var columnsTask = _bridge.RequestAsync("schema.getColumns", param, cancellationToken);
		var primaryKeysTask = _bridge.RequestAsync("schema.getPrimaryKeys", param, cancellationToken);
		var referencesTask = _bridge.RequestAsync("schema.getReferences", param, cancellationToken);
		var headerTask = _bridge.RequestAsync("data.getHeader", param, cancellationToken);
		var rowsTask = _bridge.RequestAsync("data.getRows", param, cancellationToken);

		await Task.WhenAll(columnsTask, primaryKeysTask, referencesTask, headerTask, rowsTask);

		var columns = columnsTask.Result;
		var primaryKeys = primaryKeysTask.Result;
		var references = referencesTask.Result;
		var header = headerTask.Result;
		var rows = rowsTask.Result;

		var sb = new StringBuilder();

		// テーブル名
		sb.AppendLine($"# テーブル: {tableName}");
		sb.AppendLine();

		// スキーマ情報
		sb.AppendLine("## スキーマ");
		FormatColumns(sb, columns, primaryKeys);
		sb.AppendLine();

		// 外部キー参照
		if (references.ValueKind == JsonValueKind.Array && references.GetArrayLength() > 0)
		{
			sb.AppendLine("## 外部キー参照");
			foreach (var refEntry in references.EnumerateArray())
			{
				var colName = refEntry.GetProperty("columnName").GetString();
				var targetTable = refEntry.GetProperty("targetTable").GetString();
				var targetColumn = refEntry.GetProperty("targetColumn").GetString();
				sb.AppendLine($"  - {colName} → {targetTable}.{targetColumn}");
			}
			sb.AppendLine();
		}

		// データ
		sb.AppendLine("## データ");
		FormatDataRows(sb, header, rows);

		return sb.ToString();
	}

	private static void FormatColumns(StringBuilder sb, JsonElement columns, JsonElement primaryKeys)
	{
		// 主キーセットを構築
		var pkSet = new System.Collections.Generic.HashSet<string>();
		if (primaryKeys.ValueKind == JsonValueKind.Array)
		{
			foreach (var pk in primaryKeys.EnumerateArray())
			{
				pkSet.Add(pk.GetString()!);
			}
		}

		sb.AppendLine("| カラム名 | 型 | 主キー |");
		sb.AppendLine("|----------|------|--------|");
		if (columns.ValueKind == JsonValueKind.Array)
		{
			foreach (var col in columns.EnumerateArray())
			{
				var name = col.GetProperty("name").GetString()!;
				var type = col.GetProperty("type").GetString()!;
				var isPk = pkSet.Contains(name) ? "PK" : "";
				sb.AppendLine($"| {name} | {type} | {isPk} |");
			}
		}
	}

	private static void FormatDataRows(StringBuilder sb, JsonElement header, JsonElement rows)
	{
		if (header.ValueKind != JsonValueKind.Array || rows.ValueKind != JsonValueKind.Array)
		{
			sb.AppendLine("(データなし)");
			return;
		}

		var rowCount = rows.GetArrayLength();
		sb.AppendLine($"({rowCount}行)");
		sb.AppendLine();

		// ヘッダー行
		sb.Append('|');
		foreach (var col in header.EnumerateArray())
		{
			sb.Append($" {col.GetString()} |");
		}
		sb.AppendLine();

		// セパレーター
		sb.Append('|');
		foreach (var _ in header.EnumerateArray())
		{
			sb.Append("------|");
		}
		sb.AppendLine();

		// データ行
		foreach (var row in rows.EnumerateArray())
		{
			sb.Append('|');
			foreach (var cell in row.EnumerateArray())
			{
				sb.Append($" {cell.GetString()} |");
			}
			sb.AppendLine();
		}
	}
}
