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
- **KNOWN ISSUE**: activateTabState does reference assignment (not copy) for paneStack (指摘3回目、未修正)
- **KNOWN ISSUE**: EditorTable.activate()/deactivate() asymmetry: deactivate() calls handler.deactivate() but activate() does NOT call handler.activate()

## DOM Structure (confirmed 2026-03-14)
- **wrapperElement children**: .editor-table, .selection, .copy-border, .fill-preview, handler-element, .fill-handle
- **ALL are siblings** of .editor-table, including .fill-handle (Selection constructor L121 appends to wrapperElement)
- .fill-handle is NOT inside .editor-table (selection.css L48 comment is WRONG)
- CSS sibling combinator `~` needed for ALL inactive styling, NOT descendant selector

## Recurring Review Patterns
- **Operation path coverage gap**: When removing a guard, ALL paths that depended on it must be re-secured
- **readOnly flag dependencies**: Ctrl+S, Delete/Backspace, Paste, cell edit all depend on readOnly in handler
- Cleanup tasks often miss items in the SAME FILE as deleted code
- Dead code detection: when removing a feature, search for methods whose ONLY callers were in the deleted code
- **Map key semantics change**: When changing key meaning of a Map, ALL .get() call sites must be updated
- **insert/delete symmetry**: insertRowInternal operates store -> deleteRow must also
- **register/unregister symmetry**: registerTableAsync must have paired unregisterTable lifecycle
- **deactivate/activate symmetry**: If deactivate destroys resources, activate MUST rebuild them
- **suspend/resume symmetry**: suspend must deactivate global listeners, resume must re-activate them
- **awaitポイント後のrequestIdチェック**: 全awaitポイントでrequestIdチェック必須
- **テストがDOM存在のみ検証し中身を検証しない**: 要素存在だけでなくデータ内容の検証が必須
- **CSSコメントの事実誤認がバグを隠蔽**: コメントでDOMの位置関係を誤記するとセレクタバグが見逃される

## Structural Concerns
- **Parallel array anti-pattern in RelationsPanel**: 5 arrays + storeRowIndices
- **Window listener accumulation**: activate() on N mini-tables registers simultaneously
- **store.getHeader/getRows returns internal reference**: caller mutation corrupts store
- **Csv class**: half-baked object pattern (10+ instances project-wide)

## Inactive Appearance Pattern (2026-03-14)
- **activate()/deactivate()から視覚状態を分離**: setInactiveAppearance()に一本化（修正済み）
- **destroyMiniEditorTables()パス**: handler.activate() + setInactiveAppearance(false) 追加済み
- **createMiniEditorTable()初期状態不整合**: 指摘4回目、依然未修正。handler非アクティブだが視覚アクティブで生成
- **.fill-handle CSSセレクタバグ**: 子孫セレクタで書かれているが実際は兄弟。~セレクタが必要

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
