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
- **Stale panel after cell edit**: FIXED via forceRefreshRelationsPanel chain
- **Race condition in async panel updates**: FIXED via currentRequestId pattern
- **Breadcrumb stale closure**: MITIGATED
- **Dual update path**: removeTabButton updates breadcrumb, then closeTab may call activateTabState which updates again
- **activateTabState ordering bug**: forceNotifyRelationsPanel() fires BEFORE reloadCellsFromStore()
- **e2e locator fragility**: `.editor-table` locator in 4+ e2e files will break when test tables gain FK columns

## Dirty Management (2026-03-08 -> 2026-03-09)
- **IHistory interface** in in-memory-table-store.ts: isDirty(), markSaved(), setTabButtonDirty()
- **historyRegistry**: Map<string, Set<IHistory>> in InMemoryTableStore tracks all Histories per table
- **markAllSaved N^2 bug**: FIXED via two-phase markSavedSilent + setTabButtonDirty
- **Dirty保持パス (unstaged 2026-03-09)**: unregisterTable でDirtyならrefCountsのみ削除しheaders/rowsを保持
  - CRITICAL: history.unregister()後にhistoryRegistry空→isTableDirty=false、しかしheaders/rows残留→孤立データ
  - CRITICAL: registerTableAsyncのDirty保持パスがheaders.has()のみ→Cleanな古いデータもCSV再読み込みスキップ
  - IMPORTANT: Dirty保持データ再利用時、新HistoryはClean初期化→タブDirtyマーク未表示
- **Parallel array now 5-deep**: miniEditorTables/miniFillControllers/miniAreaResizers/miniHistories/miniTableNames
- **tab.ts vs relations-panel.ts 順序不整合**: tab.tsはhistory.unregister()→unregisterTable、relations-panel.tsは逆順
  - r2で確認: tab.tsの順序だとisTableDirtyが常にfalse→Dirty保持パスは到達不能
- **throw変更の例外安全性**: unregisterTable/unregisterHistoryがthrowになったが、ループ内呼び出し元が例外で中断→リソースリーク
- **.catch内throw無意味パターン**: .catch((e) => { throw new Error(...); }) は unhandled rejection のまま

## Editable Relations Panel Issues (2026-03-08)
- **RESOLVED: Dirty indicator** - now managed via History.notifyChange → updateDirtyMark
- **FIXED: SelectionDragController not activated** - createMiniEditorTable now calls editorTable.activate(). NEW CONCERN: multiple window listeners from N mini tables + main table
- **OPEN: Handler event listener leak** - destroyMiniEditorTables removes DOM but doesn't remove listeners
- **Getter/Setter violations**: getStore(), getAutoFillEntries/setAutoFillEntries, getLeftPaneForScroll

## Breadcrumb Bar (Editor-level, 2026-03-08)
- Moved from RelationsPanel to Editor class
- Updated via: activateTabState (tab switch) and removeTabButton (tab close)

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

## dirtyTableNames 補完フラグの問題 (2026-03-09)
- **CRITICAL: Undo永久Dirty固着**: isTableDirty()がdirtyTableNames.has()を最優先で返すため、Historyが登録されている状態でもdirtyTableNamesが残っていればUndoしてもDirtyが消えない
- **修正方針**: Historyが存在する場合はHistoryのisDirty()を優先、dirtyTableNamesはHistory全除去時のフォールバックにすべき
- **コメント不整合3箇所**: L42「unregisterHistoryで追加」→実際はunregisterTableで追加、L43「markTableClean」→メソッド未実装、テストコメントにRED前提記述残留

## Structural Concerns
- **Parallel array anti-pattern in RelationsPanel**: Now 5 arrays (miniEditorTables/miniFillControllers/miniAreaResizers/miniHistories/miniTableNames). Must consolidate into single MiniTableEntry[] array.
- **Multiple window listeners**: ミニテーブルのAreaResizer全てがwindow mousemove/mouseupを同時登録。SelectionDragControllerも同様（activate()追加後）。
- **Window listener累積問題**: activate()をN個のミニテーブルに呼ぶと、main+N個のSelectionDragControllerがwindow mousemove/mouseupを同時登録。現状は各自のSelection.isSelecting()ガードで無害だが、end()に副作用追加時に破綻する地雷。

## Test Infrastructure Issues
- Copy-paste: getDataCell, openTableAsync, editCellAsync duplicated across 17+ e2e spec files (openTableAsync confirmed in 17 files as of 2026-03-09).
