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
- `/WebView/src/csv.ts` - CSV parser (naive split-based, not RFC 4180 compliant)

## Pane Stack (2026-03-13)
- **Design**: Tab.paneStack = [{element, panel}] where [0]=leftPane, [1]=globalRP, [2..]=pushed RPs
- **viewIndex**: which pair (paneStack[vi], paneStack[vi+1]) is displayed in left/right slots
- **Notification chain**: Selection → ET.notifyRowSelectionChanged → RP.notifyMiniTableRowSelectionChanged → Tab.updateNextPaneForMiniTableRow → nextRP.showForTableRowAsync

## Recurring Review Patterns
- **Operation path coverage gap**: When removing a guard (e.g. makeReadOnly), ALL paths that depended on it must be re-secured
- **readOnly flag dependencies**: Ctrl+S, Delete/Backspace, Paste, cell edit all depend on readOnly in handler
- Cleanup tasks often miss items in the SAME FILE as deleted code
- Dead code detection: when removing a feature, search for methods whose ONLY callers were in the deleted code
- **Map key semantics change**: When changing the key meaning of a Map, ALL .get() call sites must be updated
- **insert/delete対称性**: insertRowInternalがストアを操作するなら、deleteRowも必ずストアを操作すべき
- **register/unregister対称性**: registerTableAsyncを呼んだら必ずunregisterTableが対で呼ばれるライフサイクルを確保すること
- **awaitポイント後のrequestIdチェック**: 全awaitポイントでrequestIdチェック必須
- **セル編集→右側RP更新漏れ**: applyCellChangesのミニテーブルパスは参照ヒントのみ更新し右側RPは更新しない
- **lastNotifiedRowリセット漏れ**: updateRenderer()を呼ぶ全パスを網羅すべし
- **CSV直読みとストアのデータ時点不整合**: resolveTableDataAsyncがストア未登録時にCSV直読みすると、storeRowIndicesがストアの実行と不一致になる

## Dual Data Source Pattern (store vs CSV fallback)
- **CHANGED 2026-03-14**: referenceDataCache除去→CSV直接読み込みに変更(relations-panel.tsのみ)
- referenceDataCacheは他クラスでは依然使用中(editor-table-handler, editor-table-reference, tab-reference等)
- ストアパス: 編集中の最新データ / CSVパス: ディスク上の保存済みデータ → 時点不整合あり
- **性能問題**: CSVパスは毎回ファイルI/O発生。同一リクエスト内のローカルキャッシュなし

## storeRowIndices (2026-03-10, updated)
- **導入**: PK重複時にupdateCellValueが最初のヒット行を誤更新するバグ修正
- **設計**: EditorTable.storeRowIndices[] = DOMデータ行i → ストア行インデックス

## Csv Class Design Debt
- **生焼けオブジェクト**: constructor()が空状態で生成、load()で充填する2段階初期化
- **publicフィールド**: header/bodyがpublicで外部から書き換え可能
- **パーサ制限**: split(',')ベースでRFC 4180非準拠（カンマ含有フィールドで破壊）
- **プロジェクト全体で10箇所以上** で同じ生焼けパターン使用

## resolveDynamicReferenceEntryAsync requestIdガード漏れ (2026-03-14 R2)
- 内部で2回awaitするが requestId を受け取らずチェックなし
- 呼び出し元で戻り後にチェックしているが、1回目のawait後→2回目のawait間が無防備
- Round 1, Round 2 両方で指摘済み、未修正

## Structural Concerns
- **Parallel array anti-pattern in RelationsPanel**: 5 arrays + storeRowIndices
- **Window listener累積問題**: activate()をN個のミニテーブルに呼ぶと同時登録
- **store.getHeader/getRows returns internal reference**: callerがmutateするとstore破壊

## Review History
- 2026-03-07 ~ 2026-03-11: See detailed entries in previous versions
- 2026-03-13 (dynamic-reference): 致命的2件、重要4件、軽微2件
- 2026-03-13 (pane-stack v1): 致命的4件、重要6件、軽微3件
- 2026-03-13 (pane-stack v2): 致命的3件、重要5件、軽微3件
- 2026-03-13 (mini-table-row-selection): 致命的2件、重要4件、軽微2件
- 2026-03-14 (lastNotifiedRow cross-switch fix): 致命的1件、重要3件、軽微2件
- 2026-03-14 (dynamic-ref-panestack+referenceDataCache除去 R1): 致命的2件、重要4件、軽微3件
- 2026-03-14 (Round 2): 致命的2件(requestIdガード欠落/Csv生焼け)、重要4件、軽微3件
