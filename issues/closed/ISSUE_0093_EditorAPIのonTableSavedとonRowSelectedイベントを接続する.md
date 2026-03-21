# EditorAPIの onTableSaved と onRowSelected イベントを接続する

## 背景

ISSUE_0085 で EditorAPI 内部API層を新設した際、`onTableSaved` と `onRowSelected` は発火箇所が未実装のため型定義ごと削除した。
プラグインやMCPサーバーが保存完了や行選択変化を検知するためには、これらのイベントの接続が必要。

## やること

### onTableSaved
- `EditorEventsAPI` に `onTableSaved` を追加
- `EditorApiImpl` に `tableSavedHandlers` と `emitTableSaved()` を追加
- `EditorTableHandler` の Ctrl+S 保存成功時に `emitTableSaved(tableName)` を呼ぶ

### onRowSelected
- `EditorEventsAPI` に `onRowSelected` を追加
- `EditorApiImpl` に `rowSelectedHandlers` と `emitRowSelected()` を追加
- `Selection.updateRenderer()` の `notifyRowSelectionChanged()` 相当の箇所で `emitRowSelected(tableName, storeRowIndex)` を呼ぶ

## テスト
- Playwright テストで保存後にイベントが発火することを検証
- 行選択変更後にイベントが発火することを検証
- `dispose()` 後はイベントが発火しないことを検証
