using System;
using System.ComponentModel;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using ModelContextProtocol.Server;

namespace App.MasterDataEditor.Mcp.Tools;

/// <summary>
/// テーブルデータを編集するMCPツール。
/// EditorApiBridge経由でWebView2のEditorAPIのedit名前空間を呼び出す。
/// 列の指定は列名（columnName）で行い、内部でヘッダーから列インデックスに変換する。
/// Undo/Redoは EditorEditAPI.setCellValue 内部の Commandパターンで自動対応される。
/// </summary>
[McpServerToolType]
public sealed class TableEditTool
{
	/// <summary>一括更新で受け付ける最大変更件数</summary>
	private const int MaxChangesPerRequest = 1000;

	private readonly EditorApiBridge _bridge;

	public TableEditTool(EditorApiBridge bridge)
	{
		_bridge = bridge;
	}

	[McpServerTool, Description("指定テーブルの1つのセルの値を更新します。複数セルを変更する場合はUpdateCellsを使ってください（1回の呼び出しで複数セルを一括更新でき、ツール呼び出し回数を節約できます）。テーブルが開いていない場合は自動的にタブで開きます。")]
	public async Task<string> UpdateCellAsync(
		[Description("テーブル名")] string tableName,
		[Description("行インデックス（0始まり）")] int row,
		[Description("カラム名")] string columnName,
		[Description("新しい値")] string value,
		CancellationToken cancellationToken)
	{
		if (string.IsNullOrWhiteSpace(tableName))
		{
			return "エラー: テーブル名を指定してください。";
		}
		if (string.IsNullOrWhiteSpace(columnName))
		{
			return "エラー: カラム名を指定してください。";
		}

		try
		{
			// テーブルが開いていなければ自動的にタブで開く
			var openError = await EnsureTableOpenAsync(tableName, cancellationToken);
			if (openError != null) return openError;

			// ヘッダーを取得して列名→列インデックスに変換する
			var headerResult = await _bridge.RequestAsync("data.getHeader", new { tableName }, cancellationToken);
			if (headerResult.ValueKind == JsonValueKind.Null)
			{
				return $"エラー: テーブル \"{tableName}\" を開けませんでした。";
			}

			var columnIndex = FindColumnIndex(headerResult, columnName);
			if (columnIndex < 0)
			{
				return $"エラー: テーブル \"{tableName}\" にカラム \"{columnName}\" は存在しません。";
			}

			// edit.setCellValue を呼び出す（row/column はストアインデックス 0始まり）
			// 戻り値は boolean（TypeScript側の契約）
			var result = await _bridge.RequestAsync("edit.setCellValue", new { tableName, row, column = columnIndex, value }, cancellationToken);
			var success = result.GetBoolean();
			if (!success)
			{
				return $"エラー: セルの更新に失敗しました（テーブル: {tableName}, 行: {row}, カラム: {columnName}）。テーブルが閉じられたか、行インデックスが範囲外の可能性があります。";
			}

			await SaveTableAsync(tableName, cancellationToken);
			return $"セルを更新しました: {tableName}[{row}].{columnName} = \"{value}\"";
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
			return $"エラー: セルの更新中に内部エラーが発生しました（テーブル: {tableName}, 行: {row}, カラム: {columnName}）。";
		}
	}

	[McpServerTool, Description("指定テーブルの複数セルの値を一括更新します。行追加後のデータ投入や複数行の修正など、2つ以上のセルを変更する場合は常にこのツールを使ってください。異なる行のセルも1回の呼び出しでまとめて更新できます。テーブルが開いていない場合は自動的にタブで開きます。")]
	public async Task<string> UpdateCellsAsync(
		[Description("テーブル名")] string tableName,
		[Description("変更リスト")] CellChangeEntry[] changes,
		CancellationToken cancellationToken)
	{
		if (string.IsNullOrWhiteSpace(tableName))
		{
			return "エラー: テーブル名を指定してください。";
		}

		if (changes.Length == 0)
		{
			return "エラー: changes が空です。変更するセルを1件以上指定してください。";
		}
		if (changes.Length > MaxChangesPerRequest)
		{
			return $"エラー: 一度に更新できるセル数は{MaxChangesPerRequest}件までです（{changes.Length}件が指定されました）。";
		}

		try
		{
			// テーブルが開いていなければ自動的にタブで開く
			var openError = await EnsureTableOpenAsync(tableName, cancellationToken);
			if (openError != null) return openError;

			// ヘッダーを取得して列名→列インデックスに変換する
			var headerResult = await _bridge.RequestAsync("data.getHeader", new { tableName }, cancellationToken);
			if (headerResult.ValueKind == JsonValueKind.Null)
			{
				return $"エラー: テーブル \"{tableName}\" を開けませんでした。";
			}

			// 各変更の列名をインデックスに変換する
			var convertedChanges = new System.Collections.Generic.List<object>();
			for (var i = 0; i < changes.Length; i++)
			{
				var change = changes[i];
				var columnIndex = FindColumnIndex(headerResult, change.ColumnName);
				if (columnIndex < 0)
				{
					return $"エラー: テーブル \"{tableName}\" にカラム \"{change.ColumnName}\" は存在しません（changes[{i}]）。";
				}
				convertedChanges.Add(new { row = change.Row, column = columnIndex, value = change.Value });
			}

			// edit.setCellValues を呼び出す
			// 戻り値は boolean（TypeScript側の契約）
			var result = await _bridge.RequestAsync("edit.setCellValues", new { tableName, changes = convertedChanges }, cancellationToken);
			var success = result.GetBoolean();
			if (!success)
			{
				return $"エラー: セルの一括更新に失敗しました（テーブル: {tableName}）。テーブルが閉じられたか、行インデックスが範囲外の可能性があります。";
			}

			await SaveTableAsync(tableName, cancellationToken);
			return $"{changes.Length}件のセルを更新しました（テーブル: {tableName}）";
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
			return $"エラー: セルの一括更新中に内部エラーが発生しました（テーブル: {tableName}）。";
		}
	}

	[McpServerTool, Description("指定テーブルに新しい空行を挿入します。挿入後はUpdateCellsで各セルに値を設定してください。複数行を追加する場合はInsertRowを複数回呼んでからUpdateCellsで一括設定すると効率的です。テーブルが開いていない場合は自動的にタブで開きます。")]
	public async Task<string> InsertRowAsync(
		[Description("テーブル名")] string tableName,
		[Description("挿入位置の行インデックス（0始まり）。既存行数と同じ値を指定すると末尾に追加")] int rowIndex,
		CancellationToken cancellationToken)
	{
		if (string.IsNullOrWhiteSpace(tableName))
		{
			return "エラー: テーブル名を指定してください。";
		}

		try
		{
			var openError = await EnsureTableOpenAsync(tableName, cancellationToken);
			if (openError != null) return openError;

			// 戻り値は boolean（TypeScript側の契約）
			var result = await _bridge.RequestAsync("edit.insertRow", new { tableName, rowIndex }, cancellationToken);
			var success = result.GetBoolean();
			if (!success)
			{
				return $"エラー: 行の挿入に失敗しました（テーブル: {tableName}, 行: {rowIndex}）。行インデックスが範囲外の可能性があります。";
			}

			await SaveTableAsync(tableName, cancellationToken);
			return $"行を挿入しました: {tableName}[{rowIndex}]";
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
			return $"エラー: 行の挿入中に内部エラーが発生しました（テーブル: {tableName}, 行: {rowIndex}）。";
		}
	}

	[McpServerTool, Description("指定テーブルの行を削除します。削除位置より後の行はインデックスが1つ前にずれます。テーブルが開いていない場合は自動的にタブで開きます。")]
	public async Task<string> DeleteRowAsync(
		[Description("テーブル名")] string tableName,
		[Description("削除する行のインデックス（0始まり）")] int rowIndex,
		CancellationToken cancellationToken)
	{
		if (string.IsNullOrWhiteSpace(tableName))
		{
			return "エラー: テーブル名を指定してください。";
		}

		try
		{
			var openError = await EnsureTableOpenAsync(tableName, cancellationToken);
			if (openError != null) return openError;

			// 戻り値は boolean（TypeScript側の契約）
			var result = await _bridge.RequestAsync("edit.deleteRow", new { tableName, rowIndex }, cancellationToken);
			var success = result.GetBoolean();
			if (!success)
			{
				return $"エラー: 行の削除に失敗しました（テーブル: {tableName}, 行: {rowIndex}）。行インデックスが範囲外の可能性があります。";
			}

			await SaveTableAsync(tableName, cancellationToken);
			return $"行を削除しました: {tableName}[{rowIndex}]";
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
			return $"エラー: 行の削除中に内部エラーが発生しました（テーブル: {tableName}, 行: {rowIndex}）。";
		}
	}

	/// <summary>
	/// テーブルが開いていなければ自動的にタブで開く。
	/// 成功時は null を返し、失敗時はエラーメッセージを返す。
	/// </summary>
	private async Task<string?> EnsureTableOpenAsync(string tableName, CancellationToken cancellationToken)
	{
		// edit.openTableAsync を呼び出す（既に開いていれば即座に true が返る）
		// 戻り値は boolean（TypeScript側の契約）
		var openResult = await _bridge.RequestAsync("edit.openTableAsync", new { tableName }, cancellationToken);
		var opened = openResult.GetBoolean();
		if (!opened)
		{
			return $"エラー: テーブル \"{tableName}\" を開けませんでした。スキーマファイルが存在しない可能性があります。";
		}
		return null;
	}

	/// <summary>
	/// テーブルデータをCSVファイルに保存する。
	/// 保存失敗時は例外をスローせず、ログ出力のみ行う（編集自体は成功しているため）。
	/// </summary>
	private async Task SaveTableAsync(string tableName, CancellationToken cancellationToken)
	{
		await _bridge.RequestAsync("edit.saveTableAsync", new { tableName }, cancellationToken);
	}

	/// <summary>
	/// ヘッダー配列から列名に対応するインデックスを検索する。
	/// 見つからない場合、またはヘッダーが配列でない場合は -1 を返す。
	/// </summary>
	private static int FindColumnIndex(JsonElement header, string columnName)
	{
		if (header.ValueKind != JsonValueKind.Array) return -1;
		var index = 0;
		foreach (var col in header.EnumerateArray())
		{
			if (col.GetString() == columnName) return index;
			index++;
		}
		return -1;
	}
}

/// <summary>
/// UpdateCells の変更エントリ。
/// MCP SDK が JSON Schema を正しく生成できるよう、型付きレコードで定義する。
/// </summary>
public sealed record CellChangeEntry(
	[property: Description("行インデックス（0始まり）")] int Row,
	[property: Description("カラム名")] string ColumnName,
	[property: Description("新しい値")] string Value
);
