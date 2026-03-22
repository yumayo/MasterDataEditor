# ISSUE_0109 MCPツールでテーブルのセルデータを更新する

## 背景

MCPサーバーにはテーブル情報の読み取りツール（ListTables, DescribeTable）が実装済みだが、データの書き込み手段がない。
LLMがバリデーションエラーを検出した後に自動修正するには、セル単位でデータを更新できるMCPツールが必要。

TypeScript側の `EditorEditAPI` には既に以下のメソッドが定義されており、EditorApiBridge経由で呼び出せる状態にある：
- `setCellValue(tableName, row, column, value)` — 単一セル更新
- `setCellValues(tableName, changes)` — 複数セル一括更新
- `insertRow(tableName, rowIndex)` — 行挿入
- `deleteRow(tableName, rowIndex)` — 行削除

## やること

### C#側: MCPツール `TableEditTool` を新設

`App.MasterDataEditor/Mcp/Tools/TableEditTool.cs` を作成し、以下のMCPツールメソッドを実装する：

#### UpdateCell
- 説明: 指定テーブルの指定セルの値を更新する
- パラメータ: `tableName`, `row`（行インデックス）, `columnName`（列名）, `value`（新しい値）
- EditorApiBridge経由で `edit.setCellValue` を呼び出す
- 列名から列インデックスへの変換はスキーマAPIで行う（LLMが列インデックスを知る必要がないようにする）
- 戻り値: 成功/失敗メッセージ

#### UpdateCells
- 説明: 指定テーブルの複数セルの値を一括更新する
- パラメータ: `tableName`, `changes`（`{ row, columnName, value }` の配列）
- 列名→列インデックス変換を一括で行い、`edit.setCellValues` を呼び出す
- 戻り値: 成功/失敗メッセージ（何件更新したか）

### McpHttpServer への登録

`McpHttpServer.CreateAndStartAsync` の `.WithTools<>()` チェーンに `TableEditTool` を追加する。

## 設計上の注意

- 列の指定は**列名（columnName）**で行う。LLMはDescribeTableで列名を知っているため、インデックス指定より列名のほうが自然で安全。
- Undo/Redoは `EditorEditAPI.setCellValue` 内部でCommandパターンにより自動的に対応される（MCPツール側で意識不要）。
- テーブルが開いていない（ストアにロードされていない）場合はエラーを返す。

## テスト

- 単一セル更新が正しく反映されることを検証
- 存在しないテーブル名やカラム名でエラーが返ることを検証
- 複数セル一括更新が正しく反映されることを検証
