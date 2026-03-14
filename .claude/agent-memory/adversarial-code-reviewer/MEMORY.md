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

## Column Header 2-Row Display (FEAT_0004, 2026-03-14 R3)
- **DOM Structure**: comment付き列 = `[.column-header-comment span, .column-header-name span]`; commentなし列 = `[TextNode]`
- **FIXED R3**: `getColumnHeaderValue()`/`setColumnHeaderValue()` updated for 2-row structure (.column-header-name span priority)
- **FIXED R3**: `getColumnHeaderComment()` added; returns null for TextNode-only cells, string for comment span
- **FIXED R3**: `setDisplayName()` now throws on missing TextNode (invariant enforcement)
- **KNOWN ISSUE**: applyCellHeight() sets lineHeight=DEFAULT_ROW_HEIGHT on column headers.
  comment付きヘッダーは2行分の高さが必要だが maxHeight:20px でクリップされる（未修正）
- **KNOWN ISSUE**: comment='' (空文字列) のスキーマを持つ列を削除→Undoすると 2行構造で復元されるが
  元が TextNode（commentなし）であった場合と区別不能。スキーマパース側で '' を null に正規化すべき。
- **KNOWN ISSUE**: serialize() outputs `description: null` when null; should omit key entirely.
  非対称: saveするとnullキーが書き込まれ、C#側の挙動との整合未確認
- **KNOWN ISSUE**: getColumnHeaderValue (editor-table.ts) uses `textContent as string` while
  getColumnHeaderLabel (editor-table-structure.ts) uses `textContent || ''` — asymmetric null handling
- **KNOWN ISSUE**: insertColumnInternal ループが i===columnIndex の新規セルに setColumnHeaderLabel('') を呼ぶ。
  現状は実害なしだが DeleteColumnCommand.undo の setColumnHeaderValue が後から上書きするため順序依存。
- **FIXED**: EditorTableDataColumn.comment/reference: string|null
- **FIXED**: EditorTableData.description: string|null, !== null check
- **FIXED**: DeleteColumnCommand.deletedComment added

## Recurring Review Patterns
- **Operation path coverage gap**: When removing a guard, ALL paths that depended on it must be re-secured
- **New DOM structure: update ALL readers/writers**: 新しいDOM構造を追加したら、そのDOMを読み書きする全APIを同時に更新すること。editor-table.tsのgetColumnHeaderValue/setColumnHeaderValueがFEAT_0004で更新漏れになった典型例
- **open/close symmetry for special tabs**: Settings tab open creates DOM+panel but close has NO cleanup path
- **register/unregister symmetry**: registerTableAsync must have paired unregisterTable lifecycle
- **deactivate/activate symmetry**: If deactivate destroys resources, activate MUST rebuild them
- **suspend/resume symmetry**: suspend must deactivate global listeners, resume must re-activate them
- **CSS変数名の打ち間違い**: 未定義CSS変数が参照されても実行時エラーにならず見逃される
- **awaitポイント後のrequestIdチェック**: 全awaitポイントでrequestIdチェック必須
- **applyCellHeight + 2行コンテンツ**: 固定高さと複数行コンテンツは衝突する。高さ固定前提の設計に多行コンテンツを追加するときは高さ計算を必ず見直す
- **get/setラベルペアの非対称**: insertColumn/deleteColumnのラベル更新ヘルパーが部分情報しか扱わない場合、新機能でフィールドが増えると消える

## Structural Concerns
- **Parallel array anti-pattern in RelationsPanel**: 5 arrays + storeRowIndices
- **Window listener accumulation**: activate() on N mini-tables registers simultaneously
- **store.getHeader/getRows returns internal reference**: caller mutation corrupts store
- **Csv class**: half-baked object pattern (10+ instances project-wide)
- **textNode: Text | false = false**: | false pattern (廃止方向の既知負債、editor-table-structure.ts L186, L349)

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
- 2026-03-14 (FEAT_0004 column-header-comment R1): 致命的2件、重要4件、軽微3件
- 2026-03-14 (FEAT_0004 column-header-comment R2): 致命的2件、重要3件、軽微2件
- 2026-03-14 (FEAT_0004 column-header-comment R3): 致命的2件、重要3件、軽微1件
