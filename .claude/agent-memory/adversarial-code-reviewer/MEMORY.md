# Adversarial Code Reviewer Memory

## Project Architecture
- Frontend: Vanilla TypeScript (no framework), DOM is SSOT
- Backend: C#
- Design: Intentionally tightly coupled, Command pattern for Undo/Redo
- WebView2 (Microsoft browser control) used for frontend hosting

## Key Files
- `/WebView/src/editor.ts` - Editor area (breadcrumb bar + content area with left/right panes)
- `/WebView/src/editor-table.ts` - Core table
- `/WebView/src/editor-table-handler.ts` - High-level edit handler
- `/WebView/src/editor-table-reference.ts` - Reverse reference hints
- `/WebView/src/editor-table-context-menu.ts` - Context menu handlers
- `/WebView/src/editor-table-structure.ts` - Row/column insert/delete
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
- **Map key semantics change**: When changing the key meaning of a Map, ALL .get() call sites must be updated (see parentColumnName review 2026-03-09)

## ReverseReferenceMap Key Change (2026-03-09, parentColumnName)
- **Background**: Map key changed from "PK value" to "parent column value" (e.g. group_id value)
- **Round 1: 4 unpatched .get() sites identified**
- **Round 2 status**:
  1. `updateReverseReferenceHints()`: FIXED - iterates all parentColumnNames
  2. `applyReverseReferenceHint()`: OPEN - PK cell edit destroys non-PK-column-reference hints (setCellValue L71-73)
  3. `updateReverseReferenceDisplayText()`: Dead code (zero callers), still uses pkValue. Should delete.
  4. Context menu: FIXED - iterates all parentColumnNames
- **relations-panel.ts**: Correctly updated

## Dirty Management (2026-03-08 -> 2026-03-09)
- **IHistory interface** in in-memory-table-store.ts: isDirty(), markSaved(), setTabButtonDirty()
- **historyRegistry**: Map<string, Set<IHistory>> in InMemoryTableStore tracks all Histories per table
- **markAllSaved N^2 bug**: FIXED via two-phase markSavedSilent + setTabButtonDirty
- **Dirty保持パス**: unregisterTable でDirtyならrefCountsのみ削除しheaders/rowsを保持
- **dirtyTableNames補完フラグ**: Undo永久Dirty固着問題あり

## Editable Relations Panel Issues (2026-03-08)
- **OPEN: Handler event listener leak** - destroyMiniEditorTables removes DOM but doesn't remove listeners
- **Getter/Setter violations**: getStore(), getAutoFillEntries/setAutoFillEntries, getLeftPaneForScroll

## Dual Data Source Pattern (store vs referenceDataCache)
- 1:N resolution: InMemoryTableStore (tab open) vs referenceDataCache (tab closed)
- **Stale cache risk**: fullDataCache snapshots CSV at load time

## Review History
- 2026-03-07 (ea2398b): group-end insertion + FK sync
- 2026-03-07 (ded3f74+unstaged): View cleanup. APPROVED.
- 2026-03-07 (254635d): RelationsPanel addition. race/staleness FIXED.
- 2026-03-08 (mini EditorTable rounds 1-5): Progressive fixes
- 2026-03-08 (editable relations panel): makeReadOnly REMOVED, Ctrl+S data destruction
- 2026-03-08 (1:N tab-unloaded fix): Cache fallback. Stale cache risk.
- 2026-03-08 (breadcrumb Editor-level): Moved from RelationsPanel. Dual update path.
- 2026-03-08 (a22b7b3): RelationsPanel initial display fix.
- 2026-03-08 (unstaged-resizer): ミニテーブル列幅リサイズ修正。並列配列増殖パターン指摘。
- 2026-03-08 (unstaged-dirty): Dirty管理追加。markAllSaved N^2問題、保存失敗時dirty誤リセット指摘。
- 2026-03-09 (unstaged-dirty-preserve-r1): Dirty保持パス追加。孤立データ・Dirtyマーク未表示・順序不整合指摘。
- 2026-03-09 (unstaged-dirty-preserve-r2): 修正レビュー。isTableDirty到達不能・.catch内throw無意味・例外安全性欠如指摘。
- 2026-03-09 (08cd3a1): dirtyTableNames補完フラグ追加+タブDirtyマーク初期化。Undo時永久Dirty固着・コメント3箇所不整合指摘。
- 2026-03-09 (unstaged-drag-selection): editorTable.activate()追加。windowリスナー累積・テストコピペ指摘。
- 2026-03-09 (parentColumnName-r1): 逆参照マップキー変更。4箇所の.get()未修正・コメント不整合・テスト不足指摘。
- 2026-03-09 (parentColumnName-r2): 修正レビュー。2/4修正済み。applyReverseReferenceHintがPK編集時に非PKヒント消失・死んだコード残留・コメント3箇所古い指摘。

## Structural Concerns
- **Parallel array anti-pattern in RelationsPanel**: Now 5 arrays. Must consolidate into single MiniTableEntry[] array.
- **Window listener累積問題**: activate()をN個のミニテーブルに呼ぶとmain+N個のSelectionDragControllerがwindow mousemove/mouseupを同時登録。

## Test Infrastructure Issues
- Copy-paste: openTableAsync duplicated across 18+ e2e spec files (as of 2026-03-09).
