# Adversarial Code Reviewer Memory

## Project Architecture
- Frontend: Vanilla TypeScript (no framework), DOM is SSOT
- Backend: C#
- Design: Intentionally tightly coupled, Command pattern for Undo/Redo
- View system: Base tables + JOIN tables, 1:N expansion creates "groups" of rows
- Group structure: Leader row (groupPosition=0) + child rows (groupPosition>0), padding cells for base columns on child rows
- Metadata stored in DOM attributes: `data-base-row-index`, `data-group-infos` (JSON)

## Key Files
- `/WebView/src/insert-view-row-command.ts` - View row insertion (group-within vs boundary)
- `/WebView/src/view-group-query.ts` - Pure functions for DOM group traversal
- `/WebView/src/editor-table-view-sync.ts` - Propagation of view edits to source tables/Store
- `/WebView/src/editor-table-handler.ts` - High-level edit handler, Lazy Store insertion + group expansion
- `/WebView/src/editor-table.ts` - Core table, joinStoreRowAddedFlag for lazy insertion signaling
- `/WebView/src/model/view-row-metadata.ts` - ViewRowGroupInfo interface, DOM attribute helpers
- `/WebView/e2e/fixtures/test-utils.ts` - Shared test utilities (getDataCell, expectTableDataAsync)

## Recurring Patterns & Risks
- **Undo/Redo with sibling sync**: InsertViewRowCommand tracks actualRowIndex offset from sibling insertions. undo() uses findAllGroupLeadersByFkValue dynamically - fragile if DOM state changes between execute/undo.
- **joinStoreRowAddedFlag**: Mutable flag consumed once - race-condition-like pattern, though single-threaded. Must be consumed before any other operation sets it.
- **findAllGroupLeadersByFkValue**: Stops at first row without data-base-row-index - assumes data rows are contiguous. If insertions create gaps this breaks.
- **getGroupInfos parses JSON from DOM**: No validation, `as string` assertion on getAttribute - will throw if attribute missing.
- **isAboveChildRow (3c7a134)**: `getGroupInfos(rowAbove).some(g => g.groupPosition > 0)` - correct for single-JOIN but may false-positive on multi-JOIN where one level is leader and another is child.
- **actualRowIndex in undo()**: L198 still uses actualRowIndex for mainLeaderDomRow before sibling deletion. Correct because siblings haven't been deleted yet. After deletion, main row is at metaIndex+1.

## Review History
- 2026-03-07 (ea2398b): Reviewed group-end insertion + FK sync. Found undo metaIndex drift, isAboveChildRow false-positive, redo sibling metaIndex fragility.
- 2026-03-07 (3c7a134+unstaged): Reviewed actualRowIndex stale fix. Core fix correct. actualRowIndex field still needed for undo L198 sibling exclusion. Test coverage added for undo/redo with forward siblings.

## Test Infrastructure Issues
- Massive copy-paste: getDataCell, openTableAsync, editCellAsync duplicated across 15+ e2e spec files. test-utils.ts created but only exports getDataCell and expectTableDataAsync.
