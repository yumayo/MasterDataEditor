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
- **Breadcrumb stale closure**: MITIGATED - entry object captured directly (not via array index) in new Editor-level implementation
- **Dual update path**: removeTabButton updates breadcrumb, then closeTab may call activateTabState which updates again. Non-active tab close relies solely on removeTabButton update.
- **activateTabState ordering bug**: forceNotifyRelationsPanel() fires BEFORE reloadCellsFromStore() in enableTabButton(). Tab switch shows stale FK data in RelationsPanel.
- **forceNotifyRelationsPanel lastNotifiedRow leak**: does not set lastNotifiedRow=focus.row after notifying, causing double notification on next updateRenderer()
- **resetNotification() dead code**: sole caller replaced by forceNotifyRelationsPanel() but method not deleted
- **e2e locator fragility**: `.editor-table` locator in 4+ e2e files will break when test tables gain FK columns (need `.editor-left-pane .editor-table`)

## Editable Relations Panel Issues (2026-03-08)
- **CRITICAL: Ctrl+S data destruction** - makeReadOnly() removed but readOnly=false allows Ctrl+S on miniEditorTable
- **CRITICAL: autoFill store sync failure** - new row has empty PK so store.updateCellValue() silently fails
- **CRITICAL: Dirty indicator DOM-only** - no code to toggle visible/invisible
- **OPEN: SelectionDragController not activated** - createMiniEditorTable skips editorTable.activate()
- **OPEN: Handler event listener leak** - destroyMiniEditorTables removes DOM but doesn't remove listeners
- **Getter/Setter violations**: getAutoFillEntries/setAutoFillEntries, getLeftPaneForScroll (public HTMLElement leak)

## Breadcrumb Bar (Editor-level, 2026-03-08)
- Moved from RelationsPanel to Editor class
- Updated via: activateTabState (tab switch) and removeTabButton (tab close)
- pushNavigationHistory does NOT update breadcrumb (relies on subsequent navigateToTableRow → activateTabState)
- getNavigationHistory REMOVED (was getter violation)
- Anonymous type `{ tableName: string; pkValue: string }` duplicated between editor.ts and tab.ts
- Editor.connectTab() establishes mutual reference with Tab

## insertRowInternal Design Note
- insertRowInternal() only modifies DOM, does NOT sync to InMemoryTableStore
- Consistent with DOM-as-SSOT but causes issues when store is queried

## Dual Data Source Pattern (store vs referenceDataCache)
- 1:N resolution: InMemoryTableStore (tab open) vs referenceDataCache (tab closed)
- **Stale cache risk**: fullDataCache snapshots CSV at load time
- **Data shape difference**: store.getRows() returns ALL rows; fullData.rows (Map) skips empty-PK

## Review History
- 2026-03-07 (ea2398b): group-end insertion + FK sync
- 2026-03-07 (ded3f74+unstaged): View cleanup. APPROVED.
- 2026-03-07 (254635d): RelationsPanel addition. race/staleness FIXED.
- 2026-03-08 (mini EditorTable rounds 1-5): Progressive fixes
- 2026-03-08 (editable relations panel): makeReadOnly REMOVED, Ctrl+S data destruction
- 2026-03-08 (1:N tab-unloaded fix): Cache fallback. Stale cache risk.
- 2026-03-08 (breadcrumb Editor-level): Moved from RelationsPanel. Dual update path in removeTabButton.
- 2026-03-08 (a22b7b3): RelationsPanel initial display fix. forceNotify ordering bug with reloadCellsFromStore.

## Test Infrastructure Issues
- Copy-paste: getDataCell, openTableAsync, editCellAsync duplicated across 15+ e2e spec files.
