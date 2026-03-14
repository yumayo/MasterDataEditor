# Adversarial Code Reviewer Memory

## Project Architecture
- Frontend: Vanilla TypeScript (no framework), DOM is SSOT
- Backend: C#
- Design: Intentionally tightly coupled, Command pattern for Undo/Redo
- WebView2 (Microsoft browser control) used for frontend hosting

## Key Files
- `/WebView/src/editor.ts` - Editor area (nav bar + content area with left/right slots)
- `/WebView/src/editor-table.ts` - Core table + storeRowIndices (DOM→store row mapping)
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

## Pane Stack (2026-03-13)
- **Design**: Tab.paneStack = [{element, panel}] where [0]=leftPane, [1]=globalRP, [2..]=pushed RPs
- **viewIndex**: which pair (paneStack[vi], paneStack[vi+1]) is displayed in left/right slots
- **Notification chain**: Selection → ET.notifyRowSelectionChanged → RP.notifyMiniTableRowSelectionChanged → Tab.updateNextPaneForMiniTableRow → nextRP.showForTableRowAsync
- **OPEN: awaitギャップ**: showForTableRowAsync内のunregister(old)→await register(new)間にdisconnectが割り込むとbaseTableName復活+二重unregister+refCountリーク
- **OPEN: appendTo not called**: pushed RPs never have parentElement set → resize handle throws
- **OPEN: fire-and-forget**: showForTableRowAsync errors are caught but resources not cleaned up
- **OPEN: dynamic reference skipped**: resolveEntriesForTableRowAsync skips DynamicReference entirely
- **OPEN: セル編集パス漏れ**: ミニテーブルのPK値編集時に右側RPが更新されない

## Recurring Review Patterns
- **Operation path coverage gap**: When removing a guard (e.g. makeReadOnly), ALL paths that depended on it must be re-secured
- **readOnly flag dependencies**: Ctrl+S, Delete/Backspace, Paste, cell edit all depend on readOnly in handler
- Cleanup tasks often miss items in the SAME FILE as deleted code
- Dead code detection: when removing a feature, search for methods whose ONLY callers were in the deleted code
- **Map key semantics change**: When changing the key meaning of a Map, ALL .get() call sites must be updated
- **insert/delete対称性**: insertRowInternalがストアを操作するなら、deleteRowも必ずストアを操作すべき
- **register/unregister対称性**: registerTableAsyncを呼んだら必ずunregisterTableが対で呼ばれるライフサイクルを確保すること
- **awaitポイント後のrequestIdチェック**: 全awaitポイントでrequestIdチェック必須。特にunregister→await register間はbaseTableName復活+二重unregisterの温床
- **セル編集→右側RP更新漏れ**: applyCellChangesのミニテーブルパスは参照ヒントのみ更新し右側RPは更新しない
- **lastNotifiedRowリセット漏れ**: start()/selectRow()にリセット追加してもmove()/setRange()/selectColumn()に漏れる。updateRenderer()を呼ぶ全パスを網羅すべし

## lastNotifiedRow設計欠陥 (2026-03-14)
- **根本原因**: lastNotifiedRowはSelectionインスタンスの同一性を考慮していない
- **発生パターン**: ミニテーブルA(row0)→ミニテーブルB→ミニテーブルA(row0)で通知スキップ
- **修正箇所**: start()のみリセット追加 → move()/setRange()/selectColumn()に漏れ
- **副作用**: メインテーブルで同一行再クリック時に毎回updateForRowAsync発火（パフォーマンス劣化）
- **updateRenderer()を呼ぶメソッド一覧**: start, move, setRange, selectColumn, selectRow, selectAll, extendSelection, extendSelectionOffset, updateColumn, updateRow, addColumn, addRow, updateRendererAfterResize

## Critical Anti-Pattern: await gap between state mutation and guard
- showForTableRowAsync: unregister(old)→baseTableName未更新→await register(new)→baseTableName設定
- この間にdisconnectEditorTableが割り込むと: 二重unregister + baseTableName復活 + refCountリーク
- **対策**: unregister直後にbaseTableName=false、await後にrequestIdチェック+不一致ならunregister(new)

## storeRowIndices (2026-03-10, updated)
- **導入**: PK重複時にupdateCellValueが最初のヒット行を誤更新するバグ修正
- **設計**: EditorTable.storeRowIndices[] = DOMデータ行i → ストア行インデックス
- **OPEN ISSUES**: 0行テーブルinsert NaN / N:1全列一致破綻 / replaceAllRows陳腐化 / getter/setter違反 / 複数ミニテーブル陳腐化

## Dual Data Source Pattern (store vs referenceDataCache)
- 1:N resolution: InMemoryTableStore (tab open) vs referenceDataCache (tab closed)
- N:1 resolution: ストア優先→キャッシュフォールバック
- **FIXED: resolveTableDataAsync共通化**

## Structural Concerns
- **Parallel array anti-pattern in RelationsPanel**: 5 arrays + storeRowIndices
- **Window listener累積問題**: activate()をN個のミニテーブルに呼ぶと同時登録

## Review History
- 2026-03-07 ~ 2026-03-11: See detailed entries in previous versions
- 2026-03-13 (dynamic-reference): 致命的2件、重要4件、軽微2件
- 2026-03-13 (pane-stack v1): 致命的4件、重要6件、軽微3件
- 2026-03-13 (pane-stack v2): 致命的3件、重要5件、軽微3件
- 2026-03-13 (mini-table-row-selection): 致命的2件(awaitギャップ+二重unregister)、重要4件(セル編集パス漏れ/viewIndex未検証/無意味findIndex/空PKサイレント)、軽微2件
- 2026-03-14 (lastNotifiedRow cross-switch fix): 致命的1件(move/setRange/selectColumnリセット漏れ)、重要3件、軽微2件
