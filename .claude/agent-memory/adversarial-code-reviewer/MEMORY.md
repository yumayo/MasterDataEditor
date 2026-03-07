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
- `/WebView/src/history.ts` - Undo/Redo history management
- `/WebView/src/command.ts` - Command pattern implementations
- `/WebView/e2e/fixtures/test-utils.ts` - Shared test utilities (getDataCell, expectTableDataAsync, expectCsvAsync)

## View Feature Status (as of ded3f74, 2026-03-07)
- **View feature fully deleted** in commit ded3f74 (20 source files, 15 test files removed)
- Cleanup fully completed: .view-padding-cell, .view-group-leader-row, .view-collapse-toggle CSS, markDirty() dead code, command.ts/test-utils.ts comment/selector all removed
- docs/bug-report.md still references View concepts extensively (historical record, acceptable)

## Recurring Review Patterns
- Cleanup tasks often miss items in the SAME FILE as deleted code (e.g., .view-padding-cell was right below deleted blocks)
- Comment-only fixes should trigger "is this code still needed?" analysis
- Dead code detection: when removing a feature, search for methods whose ONLY callers were in the deleted code

## Review History
- 2026-03-07 (ea2398b): Reviewed group-end insertion + FK sync. Found undo metaIndex drift, isAboveChildRow false-positive, redo sibling metaIndex fragility.
- 2026-03-07 (3c7a134+unstaged): Reviewed actualRowIndex stale fix. Core fix correct.
- 2026-03-07 (ded3f74+unstaged): Reviewed View cleanup. Found .view-padding-cell CSS residue, markDirty() dead code.
- 2026-03-07 (ded3f74+unstaged v2): Fix confirmed. All View residue removed. APPROVED.

## Test Infrastructure Issues
- Massive copy-paste: getDataCell, openTableAsync, editCellAsync duplicated across 15+ e2e spec files. test-utils.ts exports getDataCell, expectTableDataAsync, expectCsvAsync.
