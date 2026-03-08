# Adversarial Code Reviewer Memory

## Project Architecture
- Frontend: Vanilla TypeScript (no framework), DOM is SSOT
- Backend: C#
- Design: Intentionally tightly coupled, Command pattern for Undo/Redo
- WebView2 (Microsoft browser control) used for frontend hosting

## Key Files
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

## Recurring Review Patterns
- **Operation path coverage gap**: When removing a guard (e.g. makeReadOnly), ALL paths that depended on it must be re-secured
- **readOnly flag dependencies**: Ctrl+S, Delete/Backspace, Paste, cell edit all depend on readOnly in handler
- Cleanup tasks often miss items in the SAME FILE as deleted code
- Dead code detection: when removing a feature, search for methods whose ONLY callers were in the deleted code
- **Stale panel after cell edit**: FIXED via forceRefreshRelationsPanel chain
- **Race condition in async panel updates**: FIXED via currentRequestId pattern
- **Breadcrumb closure stale reference**: slice() creates new array but old closure retains original

## Editable Relations Panel Issues (2026-03-08)
- **CRITICAL: Ctrl+S data destruction** - makeReadOnly() removed but readOnly=false allows Ctrl+S on miniEditorTable. extractTableData() gets partial rows (FK-filtered) + missing FK columns (hiddenColumns). mergeCsvData overwrites child CSV with partial data.
- **CRITICAL: autoFill store sync failure** - InsertRowCommand.execute() calls updateCellValueAt() after insertRowInternal(), but new row has empty PK so store.updateCellValue() silently fails (PK lookup). Store and DOM diverge.
- **CRITICAL: Dirty indicator DOM-only** - dirtyIndicator element created with display:none but NO code to toggle it to visible on edit or invisible on undo.
- **OPEN: SelectionDragController not activated** - createMiniEditorTable skips editorTable.activate(), so drag selection doesn't work in mini tables
- **OPEN: Handler event listener leak** - destroyMiniEditorTables removes DOM but doesn't remove keydown/focusout/paste/input listeners from handler element
- **OPEN: Breadcrumb stale closure** - history array captured by closure, truncateNavigationHistory creates new array via slice(), old closure retains stale reference
- **Getter/Setter violations**: getAutoFillEntries/setAutoFillEntries, getNavigationHistory/pushNavigationHistory/truncateNavigationHistory

## insertRowInternal Design Note
- insertRowInternal() only modifies DOM, does NOT sync to InMemoryTableStore
- This is consistent with DOM-as-SSOT design: CSV save uses extractTableData() from DOM
- But causes issues when store is queried (e.g. updateCellValueAt → store.updateCellValue fails for new rows)

## Review History
- 2026-03-07 (ea2398b): group-end insertion + FK sync
- 2026-03-07 (ded3f74+unstaged): View cleanup. APPROVED.
- 2026-03-07 (254635d): RelationsPanel addition. race/staleness FIXED.
- 2026-03-08 (mini EditorTable rounds 1-5): Progressive fixes, makeReadOnly added then removed
- 2026-03-08 (editable relations panel): makeReadOnly REMOVED, Ctrl+S data destruction, autoFill store sync, dirty indicator unimplemented

## Test Infrastructure Issues
- Copy-paste: getDataCell, openTableAsync, editCellAsync duplicated across 15+ e2e spec files.
