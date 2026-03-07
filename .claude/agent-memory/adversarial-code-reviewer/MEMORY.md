# Adversarial Code Reviewer Memory

## Project Architecture
- Frontend: Vanilla TypeScript (no framework), DOM is SSOT
- Backend: C#
- Design: Intentionally tightly coupled (密結合), Command pattern for Undo/Redo
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

## Recurring Patterns & Risks
- **Undo/Redo with sibling sync**: InsertViewRowCommand tracks actualRowIndex offset from sibling insertions. undo() uses findAllGroupLeadersByFkValue dynamically - fragile if DOM state changes between execute/undo.
- **joinStoreRowAddedFlag**: Mutable flag consumed once - race-condition-like pattern, though single-threaded. Must be consumed before any other operation sets it.
- **findAllGroupLeadersByFkValue**: Stops at first row without data-base-row-index - assumes data rows are contiguous. If insertions create gaps this breaks.
- **getGroupInfos parses JSON from DOM**: No validation, `as string` assertion on getAttribute - will throw if attribute missing.
- **isAboveChildRow condition (ea2398b)**: `getGroupInfos(rowAbove).some(g => g.groupPosition > 0)` - can false-positive on first row of multi-join where only one join level has position>0.

## Review History
- 2026-03-07: Reviewed ea2398b (group-end insertion + FK sync). Found critical undo metaIndex drift issue, isAboveChildRow false-positive for single-row groups at table boundary, and redo sibling metaIndex fragility.
