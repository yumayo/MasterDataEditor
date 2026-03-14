# Adversarial Code Reviewer Memory

## Project Architecture
- Frontend: Vanilla TypeScript (no framework), DOM is SSOT
- Backend: C#
- Design: Intentionally tightly coupled, Command pattern for Undo/Redo
- WebView2 (Microsoft browser control) used for frontend hosting

## Key Files
- `/WebView/src/editor.ts` - Editor area (nav bar + content area with left/right slots)
- `/WebView/src/editor-table.ts` - Core table + storeRowIndices (DOM->store row mapping)
- `/WebView/src/editor-table-handler.ts` - High-level edit handler
- `/WebView/src/editor-table-reference.ts` - Reverse reference hints
- `/WebView/src/editor-table-context-menu.ts` - Context menu handlers
- `/WebView/src/editor-table-structure.ts` - Row/column insert/delete + storeRowIndices sync
- `/WebView/src/history.ts` - Undo/Redo history management
- `/WebView/src/command.ts` - Command pattern implementations
- `/WebView/src/relations-panel.ts` - Relations panel (right pane)
- `/WebView/src/selection.ts` - Selection and focus management
- `/WebView/src/tab.ts` - Tab management, EditorTable factory, pane stack management
- `/WebView/src/editor-actions.ts` - saveTableDataFromStoreAsync/saveSchemaDataAsync
- `/WebView/src/in-memory-table-store.ts` - Central data store + IHistory interface + Dirty management
- `/WebView/src/reference-expression.ts` - Reference expression parser (SimpleReference + DynamicReference)
- `/WebView/src/csv.ts` - CSV parser (naive split-based, not RFC 4180 compliant)
- `/WebView/src/settings-panel.ts` - Settings panel (theme selection, localStorage persistence)
- `/WebView/src/activity-bar.ts` - Activity bar with settings gear icon

## CSS Variables (index.css)
- `:root` = light theme defaults, `[data-theme="dark"]` = dark overrides
- Defined: `--font-color`, `--background-color`, `--background-sub-color`, `--border-color`, `--selection-color`, `--selection-font-color`, `--scroll-bar-background-color`
- NOTE: `--selected-color` does NOT exist; `--selection-color` is the correct variable name

## Pane Stack (2026-03-14)
- **Design**: Tab.paneStack = [{element, panel}] where [0]=leftPane, [1]=globalRP, [2..]=pushed RPs
- **viewIndex**: which pair (paneStack[vi], paneStack[vi+1]) is displayed in left/right slots

## Settings Tab (FEAT_0002, 2026-03-14)
- **KNOWN ISSUE**: closeTab('設定') does NOT clean up settingsWrapperElement/settingsPanel -> dangling reference on re-open
- **KNOWN ISSUE**: Closing settings tab without saving does NOT revert preview theme
- **KNOWN ISSUE**: settingsPanel/settingsWrapperElement are half-baked object fields (|false pattern)
- **KNOWN ISSUE**: settings-panel.css uses `--selected-color` (undefined); should be `--selection-color`

## Recurring Review Patterns
- **Operation path coverage gap**: When removing a guard, ALL paths that depended on it must be re-secured
- **open/close symmetry for special tabs**: Settings tab open creates DOM+panel but close has NO cleanup path
- **register/unregister symmetry**: registerTableAsync must have paired unregisterTable lifecycle
- **deactivate/activate symmetry**: If deactivate destroys resources, activate MUST rebuild them
- **suspend/resume symmetry**: suspend must deactivate global listeners, resume must re-activate them
- **CSS変数名の打ち間違い**: 未定義CSS変数が参照されても実行時エラーにならず見逃される
- **awaitポイント後のrequestIdチェック**: 全awaitポイントでrequestIdチェック必須

## Structural Concerns
- **Parallel array anti-pattern in RelationsPanel**: 5 arrays + storeRowIndices
- **Window listener accumulation**: activate() on N mini-tables registers simultaneously
- **store.getHeader/getRows returns internal reference**: caller mutation corrupts store
- **Csv class**: half-baked object pattern (10+ instances project-wide)

## Review History
- 2026-03-13 (dynamic-reference): 致命的2件、重要4件、軽微2件
- 2026-03-13 (pane-stack v1): 致命的4件、重要6件、軽微3件
- 2026-03-13 (pane-stack v2): 致命的3件、重要5件、軽微3件
- 2026-03-13 (mini-table-row-selection): 致命的2件、重要4件、軽微2件
- 2026-03-14 (lastNotifiedRow cross-switch fix): 致命的1件、重要3件、軽微2件
- 2026-03-14 (dynamic-ref-panestack+referenceDataCache除去 R1): 致命的2件、重要4件、軽微3件
- 2026-03-14 (Round 2): 致命的2件、重要4件、軽微3件
- 2026-03-14 (tab-switch-pane-stack-persistence): 致命的2件、重要4件、軽微2件
- 2026-03-14 (suspend-method+removeTab-cleanup R2): 致命的2件、重要4件、軽微3件
- 2026-03-14 (suspend-resume R3): 致命的2件、重要4件、軽微2件
- 2026-03-14 (inactive-selection-color R1): 致命的2件、重要4件、軽微2件
- 2026-03-14 (inactive-selection-color R2): 致命的2件、重要4件、軽微2件
- 2026-03-14 (FEAT_0002 light-theme): 致命的2件、重要4件、軽微3件
