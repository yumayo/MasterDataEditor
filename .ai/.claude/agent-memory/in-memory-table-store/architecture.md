---
name: InMemoryTableStore アーキテクチャ
description: ストアの設計、公開メソッド、storeRowIndices の仕組み
type: project
---

## InMemoryTableStore の設計

### 内部データ構造
- `headers: Map<string, string[]>` — テーブル名 → ヘッダー列名配列
- `rows: Map<string, string[][]>` — テーブル名 → 行データ（各行は列値の配列）
- `refCounts: Map<string, number>` — 参照カウント（タブ/ミニテーブルが参照中の数）
- `historyRegistry: Map<string, Set<IHistory>>` — Dirty管理用Historyの登録簿
- `dirtyTableNames: Set<string>` — Historyが全除去された後もDirty状態を保持するフラグセット

### 参照カウント方式
- タブオープン/ミニテーブル生成時: `registerTableAsync()` で refCount を増加
- タブクローズ/ミニテーブル破棄時: `unregisterTable()` で refCount を減少
- refCount=0になりDirty状態なら: データを保持してdirtyTableNamesに記録（次のregisterTableAsyncで再利用）
- refCount=0になりClean状態なら: データを完全削除

### ミニテーブルとメインテーブルのストア共有
`Tab.createMiniEditorTable()` (tab.ts:1048-1051) でミニEditorTableを生成する際、
`Tab.store`（シングルトン）をそのまま渡す。メインテーブルも同じストアを参照。
**ミニテーブルとメインテーブルは同じInMemoryTableStoreを共有する。**

### storeRowIndices の役割
EditorTable が持つ `private storeRowIndices: number[]`。
- 通常テーブル: `storeRowIndices[i] = i`（DOM行i+1 → ストア行i）
- ミニテーブル（1:N）: フィルタリングされた行のストアインデックスを保持
- ミニテーブル（N:1）: 全行表示のため `[0, 1, ..., n-1]`

行挿入・削除時に storeRowIndices も同期して更新される。

### 公開メソッド一覧
| メソッド | 用途 |
|---------|------|
| `registerTable(name, header, body)` | テーブル登録（テスト・同期用） |
| `registerTableAsync(name)` | テーブル登録（ファイルから読み込み） |
| `unregisterTable(name)` | 参照カウント減少 |
| `reloadTableDataAsync(name)` | CSVから再読み込み |
| `hasTable(name)` | 存在判定 |
| `getCsv(name)` | header+bodyをCsvとして返す |
| `getHeader(name)` | ヘッダー取得 |
| `getRows(name)` | 行データ取得 |
| `updateCellValueByRowIndex(name, row, col, value)` | セル更新 |
| `replaceAllRows(name, newRows)` | 全行置換 |
| `appendRow(name, values)` | 行追加 |
| `removeRow(name, rowIndex)` | 行削除 |
| `insertRowAt(name, rowIndex, values)` | 指定インデックスに行挿入 |
| `buildKeyMap(name, keyColumnName)` | キー列でグループ化したMapを構築 |
| `registerHistory(name, history)` | History登録 |
| `unregisterHistory(name, history)` | History登録解除 |
| `isTableDirty(name)` | Dirty判定 |
| `markAllSaved(name)` | 保存済みにする |
| `getHistories(name)` | 全History取得 |

### 重要な不変条件
- `insertRowAt` に渡す `values` 配列の長さはストアのヘッダー長と一致しなければならない
- DOMの列数をストアへの挿入列数として使ってはならない（ミニテーブルはサブセット列表示可能）
