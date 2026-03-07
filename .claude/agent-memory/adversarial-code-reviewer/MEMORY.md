# Adversarial Code Reviewer Memory

## Project Architecture
- Frontend: Vanilla TypeScript (no framework), DOM is SSOT
- Backend: C#
- Design: Intentionally tightly coupled, Command pattern for Undo/Redo
- WebView2 (Microsoft browser control) used for frontend hosting - "view" in WebView2API/api.ts is NOT related to the deleted View feature

## Key Files
- `/WebView/src/editor-table.ts` - Core table
- `/WebView/src/editor-table-handler.ts` - High-level edit handler
- `/WebView/src/editor-table-reference.ts` - Reverse reference hints, groupPosition used here is NOT View-related
- `/WebView/src/editor-table-context-menu.ts` - Context menu handlers for row/column headers
- `/WebView/src/editor-table-structure.ts` - Row/column insert/delete operations
- `/WebView/src/history.ts` - Undo/Redo history management
- `/WebView/src/command.ts` - Command pattern implementations
- `/WebView/src/relations-panel.ts` - Relations panel (right pane, FK references + reverse refs)
- `/WebView/src/selection.ts` - Selection and focus management, notifies RelationsPanel
- `/WebView/e2e/fixtures/test-utils.ts` - Shared test utilities (getDataCell, expectTableDataAsync, expectCsvAsync)

## View Feature Status (as of ded3f74, 2026-03-07)
- **View feature fully deleted** in commit ded3f74 (20 source files, 15 test files removed)

## Recurring Review Patterns
- **Operation path coverage gap**: readOnly guard exists in EditorTableHandler AND EditorTableContextMenu, but NOT in EditorTableStructure. Undo/Redo/Delete/Backspace/Paste in handler also lack readOnly guard (rely on active=false).
- Cleanup tasks often miss items in the SAME FILE as deleted code
- Dead code detection: when removing a feature, search for methods whose ONLY callers were in the deleted code
- **Stale panel after cell edit**: FIXED via forceRefreshRelationsPanel chain
- **Race condition in async panel updates**: FIXED via currentRequestId pattern in updateForRowAsync
- **Breadcrumb click does NOT increment requestId** - renderAsync no longer increments itself, so breadcrumb callers must do it

## Mini EditorTable Issues (2026-03-08, round 5)
- **FIXED: ContextMenu** - makeReadOnly() on EditorTableContextMenu blocks row/col insert/delete menus
- **OPEN: renderAsync DOM flash** - destroyMiniEditorTables()+clearContentArea() run before await, causing blank flash on interruption
- **OPEN: Breadcrumb requestId** - breadcrumb click calls renderAsync() without ++currentRequestId, enabling race condition between concurrent breadcrumb clicks
- **OPEN: Undo/Redo not blocked by readOnly** - Ctrl+Z/Y in handleNavigationKeydown has no readOnly guard (safe only while active=false)
- **OPEN: Delete/Backspace/Paste not blocked by readOnly** - relies on active=false (fragile)
- **FIXED: Store pollution via cell edit** - makeReadOnly() blocks enableCellEditMode() and enableCellEditModeWithDropdownAsync()
- **FIXED: Ctrl+S** - readOnly check in handleNavigationKeydown blocks save
- **FIXED: renderAsync race** - requestId guard prevents stale DOM from being appended
- **Root cause**: readOnly defense should be comprehensive across ALL mutation paths, not just cell edit and context menu

## Review History
- 2026-03-07 (ea2398b): group-end insertion + FK sync. undo metaIndex drift, isAboveChildRow false-positive.
- 2026-03-07 (ded3f74+unstaged): View cleanup. CSS residue, markDirty() dead code. v2: APPROVED.
- 2026-03-07 (254635d): RelationsPanel addition. cell-edit staleness, async race, broken drillDown. Fix review: race/staleness FIXED.
- 2026-03-08 (mini EditorTable round 1-3): Progressive fixes for store pollution, enable(), shared ContextMenu/Sidebar.
- 2026-03-08 (mini EditorTable round 4): makeReadOnly() blocks cell edit. ContextMenu row/col ops STILL OPEN. renderAsync flash OPEN.
- 2026-03-08 (mini EditorTable round 5): ContextMenu readOnly FIXED. Breadcrumb requestId OPEN. Undo/Redo/Delete/Paste readOnly OPEN. DOM flash OPEN.

## Test Infrastructure Issues
- Copy-paste: getDataCell, openTableAsync, editCellAsync duplicated across 15+ e2e spec files.
