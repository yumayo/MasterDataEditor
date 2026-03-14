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

## Pane Stack (2026-03-14)
- **Design**: Tab.paneStack = [{element, panel}] where [0]=leftPane, [1]=globalRP, [2..]=pushed RPs
- **viewIndex**: which pair (paneStack[vi], paneStack[vi+1]) is displayed in left/right slots
- **Notification chain**: Selection -> ET.notifyRowSelectionChanged -> RP.notifyMiniTableRowSelectionChanged -> Tab.updateNextPaneForMiniTableRow -> nextRP.showForTableRowAsync
- **Tab switch persistence**: paneStack/viewIndex saved to TabState in deactivateTabState, restored in activateTabState
- **FIXED**: deactivateTabState now calls suspend() instead of disconnectEditorTable on added RPs
- **FIXED**: removeTabButton now cleans up added RPs for both active and inactive tabs
- **FIXED**: suspend() now deactivates miniEditorTable/FillController/AreaResizer global listeners
- **FIXED**: resume() re-activates them symmetrically
- **KNOWN ISSUE**: activateTabState does reference assignment (not copy) for paneStack -> state.paneStack mutated by pushRelationsPanel (指摘3回目、未修正)
- **KNOWN ISSUE**: EditorTable.activate()/deactivate() asymmetry: deactivate() calls handler.deactivate() but activate() does NOT call handler.activate()/enable()

## Recurring Review Patterns
- **Operation path coverage gap**: When removing a guard, ALL paths that depended on it must be re-secured
- **readOnly flag dependencies**: Ctrl+S, Delete/Backspace, Paste, cell edit all depend on readOnly in handler
- Cleanup tasks often miss items in the SAME FILE as deleted code
- Dead code detection: when removing a feature, search for methods whose ONLY callers were in the deleted code
- **Map key semantics change**: When changing key meaning of a Map, ALL .get() call sites must be updated
- **insert/delete symmetry**: insertRowInternal operates store -> deleteRow must also
- **register/unregister symmetry**: registerTableAsync must have paired unregisterTable lifecycle
- **deactivate/activate symmetry**: If deactivate destroys resources, activate MUST rebuild them (confirmed 2026-03-14)
- **suspend/resume symmetry**: suspend must deactivate global listeners, resume must re-activate them (confirmed 2026-03-14)
- **awaitポイント後のrequestIdチェック**: 全awaitポイントでrequestIdチェック必須
- **セル編集->右側RP更新漏れ**: applyCellChangesのミニテーブルパスは参照ヒントのみ更新
- **lastNotifiedRowリセット漏れ**: updateRenderer()を呼ぶ全パスを網羅すべし
- **CSV直読みとストアのデータ時点不整合**: resolveTableDataAsync未登録時CSV直読み問題
- **テストがDOM存在のみ検証し中身を検証しない**: 要素存在だけでなくデータ内容の検証が必須 (2026-03-14)

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
