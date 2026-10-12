# InMemoryTableStore エージェントメモリ

## 重要ファイル
- ストア本体: `WebView/src/in-memory-table-store.ts`
- 行操作呼び出し元: `WebView/src/editor-table-structure.ts`
- ミニテーブル生成: `WebView/src/tab.ts` (createMiniEditorTable)
- ミニテーブル統括: `WebView/src/relations-panel.ts`

## 詳細メモ
- [bugs.md](./bugs.md) — 発見済み不具合パターン
- [architecture.md](./architecture.md) — ストアのアーキテクチャと設計
