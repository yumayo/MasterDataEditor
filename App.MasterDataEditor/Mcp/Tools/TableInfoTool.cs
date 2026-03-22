using System.ComponentModel;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using ModelContextProtocol.Server;

namespace App.MasterDataEditor.Mcp.Tools;

/// <summary>
/// テーブル情報を取得するMCPツール。
/// EditorApiBridge経由でWebView2のEditorAPIからデータを読み取る。
/// InMemoryTableStoreに登録されたテーブルだけでなく、
/// スキーマレジストリに存在する全テーブルのデータを取得できる。
/// </summary>
[McpServerToolType]
public sealed class TableInfoTool
{
	private readonly EditorApiBridge _bridge;

	public TableInfoTool(EditorApiBridge bridge)
	{
		_bridge = bridge;
	}

	[McpServerTool, Description("利用可能なテーブルの一覧を取得します。開いているテーブルも開いていないテーブルも含まれます。")]
	public async Task<string> ListTablesAsync(CancellationToken cancellationToken)
	{
		// スキーマレジストリと開いているテーブルを並列取得
		var allTablesTask = _bridge.RequestAsync("schema.getSchemaTableNames", new { }, cancellationToken);
		var openTablesTask = _bridge.RequestAsync("data.getTableNames", new { }, cancellationToken);
		await Task.WhenAll(allTablesTask, openTablesTask);

		// TypeScript側のgetSchemaTableNames/getTableNamesは必ず配列を返す（nullにならない）
		var allTableNames = allTablesTask.Result.Deserialize<string[]>()!;
		var openTableNames = new System.Collections.Generic.HashSet<string>(openTablesTask.Result.Deserialize<string[]>()!);

		if (allTableNames.Length == 0)
		{
			return "利用可能なテーブルはありません。";
		}

		var sb = new StringBuilder();
		sb.AppendLine($"利用可能なテーブル ({allTableNames.Length}件):");
		foreach (var name in allTableNames)
		{
			var status = openTableNames.Contains(name) ? "開いている" : "未開";
			sb.AppendLine($"  - {name} ({status})");
		}
		return sb.ToString();
	}

	[McpServerTool, Description("指定したテーブルのスキーマ・データ・参照ヒント・関連テーブルを一括取得します。テーブルが開いていなくてもCSVファイルから読み取ります。FK列にはヒント句（人間可読な表示テキスト）が付与され、N:1参照先テーブルと1:N逆参照元テーブルのデータも含まれます。")]
	public async Task<string> DescribeTableAsync(
		[Description("テーブル名")] string tableName,
		CancellationToken cancellationToken)
	{
		var param = new { tableName };

		// スキーマ・データ・参照ヒント・関連テーブルを並列取得
		var columnsTask = _bridge.RequestAsync("schema.getColumns", param, cancellationToken);
		var primaryKeysTask = _bridge.RequestAsync("schema.getPrimaryKeys", param, cancellationToken);
		var referencesTask = _bridge.RequestAsync("schema.getReferences", param, cancellationToken);
		var tableDataTask = _bridge.RequestAsync("data.readTableDataAsync", param, cancellationToken);
		var hintsTask = _bridge.RequestAsync("data.getReferenceHintsAsync", param, cancellationToken);
		var relatedTask = _bridge.RequestAsync("data.getRelatedTablesAsync", param, cancellationToken);

		await Task.WhenAll(columnsTask, primaryKeysTask, referencesTask, tableDataTask, hintsTask, relatedTask);

		var columns = columnsTask.Result;
		var primaryKeys = primaryKeysTask.Result;
		var references = referencesTask.Result;
		var tableData = tableDataTask.Result;
		var hints = hintsTask.Result;
		var related = relatedTask.Result;

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

		// データ（ヒント句付き）
		sb.AppendLine("## データ");
		if (tableData.ValueKind == JsonValueKind.Null)
		{
			sb.AppendLine("(CSVファイルが見つかりません)");
		}
		else
		{
			var header = tableData.GetProperty("header");
			var rows = tableData.GetProperty("rows");
			FormatDataRows(sb, header, rows, hints);
		}

		// 関連テーブル
		if (related.ValueKind == JsonValueKind.Array && related.GetArrayLength() > 0)
		{
			sb.AppendLine();
			sb.AppendLine("## 関連テーブル");
			sb.AppendLine();
			foreach (var entry in related.EnumerateArray())
			{
				var relationType = entry.GetProperty("relationType").GetString()!;
				var label = entry.GetProperty("label").GetString()!;
				var relHeader = entry.GetProperty("header");
				var relRows = entry.GetProperty("rows");
				var rowCount = relRows.ValueKind == JsonValueKind.Array ? relRows.GetArrayLength() : 0;
				sb.AppendLine($"### {relationType} {label} ({rowCount}行)");
				FormatDataRows(sb, relHeader, relRows);
				sb.AppendLine();
			}
		}

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

	/// <summary>
	/// データ行をマークダウンテーブルとしてフォーマットする。
	/// hints が有効なJSONオブジェクトの場合、FK列の値に対応する表示テキストを "値 (表示テキスト)" の形式で付与する。
	/// hints が Undefined（default）の場合はヒントなしで出力する。
	/// </summary>
	private static void FormatDataRows(StringBuilder sb, JsonElement header, JsonElement rows, JsonElement hints = default)
	{
		if (header.ValueKind != JsonValueKind.Array || rows.ValueKind != JsonValueKind.Array)
		{
			sb.AppendLine("(データなし)");
			return;
		}

		var rowCount = rows.GetArrayLength();
		sb.AppendLine($"({rowCount}行)");
		sb.AppendLine();

		// ヘッダー列名を配列に展開する（ヒント句解決のためインデックスアクセスが必要）
		var headerNames = new System.Collections.Generic.List<string>();
		foreach (var col in header.EnumerateArray())
		{
			headerNames.Add(col.GetString()!);
		}

		// ヘッダー行
		sb.Append('|');
		for (var i = 0; i < headerNames.Count; i++)
		{
			sb.Append($" {headerNames[i]} |");
		}
		sb.AppendLine();

		// セパレーター
		sb.Append('|');
		for (var i = 0; i < headerNames.Count; i++)
		{
			sb.Append("------|");
		}
		sb.AppendLine();

		// データ行（hints が有効な場合はFK列にヒント句を付与する）
		var hasHints = hints.ValueKind == JsonValueKind.Object;
		foreach (var row in rows.EnumerateArray())
		{
			sb.Append('|');
			var colIndex = 0;
			foreach (var cell in row.EnumerateArray())
			{
				var cellValue = cell.GetString()!;
				var displayValue = cellValue;
				// ヒント句の解決: hints[columnName][cellValue] が存在すれば "値 (表示テキスト)" にする
				if (hasHints
					&& colIndex < headerNames.Count
					&& hints.TryGetProperty(headerNames[colIndex], out var columnHints)
					&& columnHints.ValueKind == JsonValueKind.Object
					&& columnHints.TryGetProperty(cellValue, out var hintText)
					&& hintText.ValueKind == JsonValueKind.String)
				{
					displayValue = $"{cellValue} ({hintText.GetString()})";
				}
				sb.Append($" {displayValue} |");
				colIndex++;
			}
			sb.AppendLine();
		}
	}
}
