# Adversarial Code Reviewer Memory

## Project Architecture
- Frontend: Vanilla TypeScript (no framework), DOM is SSOT
- Backend: C#
- Design: Intentionally tightly coupled, Command pattern for Undo/Redo
- WebView2 (Microsoft browser control) used for frontend hosting

## Key Files
- `/WebView/src/editor.ts` - Editor area (breadcrumb bar + content area with left/right panes)
- `/WebView/src/editor-table.ts` - Core table + storeRowIndices (DOM→store row mapping)
- `/WebView/src/editor-table-handler.ts` - High-level edit handler
- `/WebView/src/editor-table-reference.ts` - Reverse reference hints
- `/WebView/src/editor-table-context-menu.ts` - Context menu handlers
- `/WebView/src/editor-table-structure.ts` - Row/column insert/delete + storeRowIndices sync
- `/WebView/src/history.ts` - Undo/Redo history management
- `/WebView/src/command.ts` - Command pattern implementations
- `/WebView/src/relations-panel.ts` - Relations panel (right pane)
- `/WebView/src/selection.ts` - Selection and focus management
- `/WebView/src/tab.ts` - Tab management, EditorTable factory
- `/WebView/src/editor-actions.ts` - saveTableData/extractTableData/mergeCsvData
- `/WebView/src/in-memory-table-store.ts` - Central data store + IHistory interface + Dirty management

## DOM Structure (as of 2026-03-08)
- `.editor` (flex column)
  - `.editor-breadcrumb-bar` (navigation history, hidden when empty)
  - `.editor-content` (flex row)
    - `.editor-left-pane` (EditorTable wrapper)
    - `.relations-panel` (right pane)

## Recurring Review Patterns
- **Operation path coverage gap**: When removing a guard (e.g. makeReadOnly), ALL paths that depended on it must be re-secured
- **readOnly flag dependencies**: Ctrl+S, Delete/Backspace, Paste, cell edit all depend on readOnly in handler
- Cleanup tasks often miss items in the SAME FILE as deleted code
- Dead code detection: when removing a feature, search for methods whose ONLY callers were in the deleted code
- **Map key semantics change**: When changing the key meaning of a Map, ALL .get() call sites must be updated
- **insert/delete対称性**: insertRowInternalがストアを操作するなら、deleteRowも必ずストアを操作すべき。対称操作の片方欠落はbug-report #2パターン
- **storeRowIndicesミニテーブル不整合**: ミニテーブルのstoreRowIndicesは不連続配列。通常テーブル前提のインデックス計算を適用すると破綻する

## storeRowIndices (2026-03-10)
- **導入**: PK重複時にupdateCellValueが最初のヒット行を誤更新するバグ修正
- **設計**: EditorTable.storeRowIndices[] = DOMデータ行i → ストア行インデックス
- **通常テーブル**: [0,1,2,...] の単純連番。initialize()で初期化
- **ミニテーブル**: filteredRows構築時の不連続インデックス。setStoreRowIndices()で設定
- **OPEN ISSUES**:
  1. deleteRowでストアのremoveRow()未呼び出し（insertRowAtとの非対称性）
  2. ミニテーブルでのinsertRowInternalのインデックス計算が不正
  3. N:1の全列一致比較が重複行で破綻（常に最初のマッチを返す）
  4. replaceAllRows()後にstoreRowIndicesが陳腐化する
  5. getter/setter禁止違反（getStoreRowIndices/setStoreRowIndices）

## Dirty Management (2026-03-08 -> 2026-03-09)
- **IHistory interface** in in-memory-table-store.ts: isDirty(), markSaved(), setTabButtonDirty()
- **historyRegistry**: Map<string, Set<IHistory>> tracks all Histories per table
- **Dirty保持パス**: unregisterTable でDirtyならrefCountsのみ削除しheaders/rowsを保持
- **dirtyTableNames補完フラグ**: Undo永久Dirty固着問題あり

## Editable Relations Panel Issues
- **OPEN: Handler event listener leak** - destroyMiniEditorTables removes DOM but doesn't remove listeners
- **Getter/Setter violations**: getStore(), getAutoFillEntries/setAutoFillEntries, getStoreRowIndices/setStoreRowIndices

## Dual Data Source Pattern (store vs referenceDataCache)
- 1:N resolution: InMemoryTableStore (tab open) vs referenceDataCache (tab closed)
- **Stale cache risk**: fullDataCache snapshots CSV at load time

## Save Paths
- 通常テーブル: extractTableData (DOM→CSV) + mergeCsvData
- ミニテーブル: saveTableDataFromStoreAsync (ストア→CSV直接)
- deleteRowでストア行未削除 → ミニテーブル保存時に削除行が復活する致命的バグ

## Review History
- 2026-03-07 ~ 2026-03-09: 省略（詳細は過去レビュー参照）
- 2026-03-10 (440756e): storeRowIndicesインデックスベース化。致命的3件（deleteRow非対称/ミニテーブルinsert計算不正/N:1重複行破綻）、重要6件指摘。

## Structural Concerns
- **Parallel array anti-pattern in RelationsPanel**: Now 5 arrays + storeRowIndices. Must consolidate into single MiniTableEntry[] array.
- **Window listener累積問題**: activate()をN個のミニテーブルに呼ぶとmain+N個のSelectionDragControllerがwindow mousemove/mouseupを同時登録。

## Test Infrastructure Issues
- Copy-paste: openTableAsync duplicated across 18+ e2e spec files (as of 2026-03-09).
