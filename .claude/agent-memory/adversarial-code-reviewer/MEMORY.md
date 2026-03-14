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
- `/WebView/src/model/editor-table-data-column.ts` - Column model (comment/reference are string|null since FEAT_0004 R2)
- `/WebView/src/diff-view.ts` - Diff view (FEAT_0005)
- `/WebView/src/source-control-panel.ts` - Source control sidebar panel (FEAT_0005)

## CSS Variables (index.css)
- `:root` = light theme defaults, `[data-theme="dark"]` = dark overrides
- Defined: `--font-color`, `--background-color`, `--background-sub-color`, `--border-color`, `--selection-color`, `--selection-font-color`, `--scroll-bar-background-color`
- NOTE: `--selected-color` does NOT exist; `--selection-color` is the correct variable name
- NOTE: `--tab-background` does NOT exist (used incorrectly in diff-view.css FEAT_0005)
- NOTE: `--list-hover-background` does NOT exist (used incorrectly in source-control-panel.css FEAT_0005)

## Pane Stack (2026-03-14)
- **Design**: Tab.paneStack = [{element, panel}] where [0]=leftPane, [1]=globalRP, [2..]=pushed RPs
- **viewIndex**: which pair (paneStack[vi], paneStack[vi+1]) is displayed in left/right slots

## Settings Tab (FEAT_0002, 2026-03-14)
- **KNOWN ISSUE**: closeTab('設定') does NOT clean up settingsWrapperElement/settingsPanel -> dangling reference on re-open
- **KNOWN ISSUE**: Closing settings tab without saving does NOT revert preview theme
- **KNOWN ISSUE**: settingsPanel/settingsWrapperElement are half-baked object fields (|false pattern)
- **KNOWN ISSUE**: settings-panel.css uses `--selected-color` (undefined); should be `--selection-color`

## Column Header 2-Row Display (FEAT_0004, 2026-03-14 R3)
- **KNOWN ISSUE**: applyCellHeight() sets lineHeight=DEFAULT_ROW_HEIGHT on column headers (2-row clipped)
- **KNOWN ISSUE**: comment='' vs null distinction lost on Undo
- **KNOWN ISSUE**: serialize() outputs `description: null` (should omit)
- **KNOWN ISSUE**: getColumnHeaderValue vs getColumnHeaderLabel asymmetric null handling

## Diff View / Source Control (FEAT_0005, 2026-03-14)
- **CRITICAL**: showDiffView() sets rightSlot.style.display='none' but tab switch does NOT call hideDiffView() -> rightSlot stays hidden permanently
- **CRITICAL**: C# git show handler has NO path validation -> path traversal vulnerability
- **KNOWN ISSUE**: diff-view.css uses `--tab-background` (undefined CSS variable)
- **KNOWN ISSUE**: source-control-panel.css uses `--list-hover-background` (undefined CSS variable)
- **KNOWN ISSUE**: SourceControlPanel.currentDiffView is null member variable (half-baked object)
- **KNOWN ISSUE**: diff-view.ts has its own parseCsv() duplicating csv.ts functionality
- **KNOWN ISSUE**: No UI to close diff view and return to editor
- **KNOWN ISSUE**: git status error returns success:true with empty data (error swallowed)
- **KNOWN ISSUE**: diff-view.ts uses `undefined` comparisons in multiple places

## Recurring Review Patterns
- **Operation path coverage gap**: ALL paths must be secured when adding new features
- **New DOM structure: update ALL readers/writers**: 新しいDOM構造を追加したら全APIを同時に更新
- **open/close symmetry for special tabs**: Settings tab open creates DOM+panel but close has NO cleanup
- **show/hide symmetry for overlay views**: showDiffView hides rightSlot but no path restores it on tab switch
- **CSS変数名の打ち間違い**: 未定義CSS変数が3回連続で別FEAT/ファイルで発生(FEAT_0002,0004,0005)
- **awaitポイント後のrequestIdチェック**: 全awaitポイントでrequestIdチェック必須
- **C#バックエンド入力バリデーション不足**: git系ハンドラでフロントエンド入力をそのままコマンド引数に渡している

## Structural Concerns
- **Parallel array anti-pattern in RelationsPanel**: 5 arrays + storeRowIndices
- **Window listener accumulation**: activate() on N mini-tables registers simultaneously
- **store.getHeader/getRows returns internal reference**: caller mutation corrupts store
- **Csv class**: half-baked object pattern (10+ instances project-wide)
- **textNode: Text | false = false**: | false pattern (廃止方向の既知負債)

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
- 2026-03-14 (FEAT_0004 R1-R3): 致命的2件ずつ
- 2026-03-14 (FEAT_0005 source-control-diff R1): 致命的2件、重要4件、軽微4件
