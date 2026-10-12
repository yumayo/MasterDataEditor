# RelationsPanel Owner — MEMORY.md

## 重要な知見ファイル

- [bug_minitable_row_sync.md](./bug_minitable_row_sync.md) — ミニテーブル行追加・削除後の左ペインEditorTable行数不整合バグ

## プロジェクト構造メモ

- `WebView/src/relations-panel.ts` — RelationsPanel 本体（1039行）
- `WebView/src/tab.ts` — createMiniEditorTable 含む Tab クラス
- `WebView/src/editor-table.ts` — EditorTable（reloadCellsFromStore含む）
- `WebView/src/editor-table-structure.ts` — insertRowInternal/deleteRow でストアと storeRowIndices を同期

## アーキテクチャの要点

- ミニテーブルと左ペインEditorTableは **同じ InMemoryTableStore インスタンスを共有**
- ミニテーブルが行を追加・削除するとストアが変更される
- `reloadCellsFromStore()` はセル値のみ更新、**行数の変化は処理しない**
- `storeRowIndices` は各EditorTableインスタンスが独自に持つ（ミニテーブルはフィルタ済みインデックス）
