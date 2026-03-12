# Adversarial Code Reviewer Memory

## Project Architecture
- Frontend: Vanilla TypeScript (no framework), DOM is SSOT
- Backend: C#
- Design: Intentionally tightly coupled, Command pattern for Undo/Redo
- WebView2 (Microsoft browser control) used for frontend hosting

## Key Files
- `/WebView/src/editor.ts` - Editor area (breadcrumb bar + content area with left/right panes)
- `/WebView/src/editor-table.ts` - Core table + storeRowIndices (DOM→store row mapping)
- `/WebView/src/editor-table-handler.ts` - High-level edit handler
- `/WebView/src/editor-table-reference.ts` - Reverse reference hints
- `/WebView/src/editor-table-context-menu.ts` - Context menu handlers
- `/WebView/src/editor-table-structure.ts` - Row/column insert/delete + storeRowIndices sync
- `/WebView/src/history.ts` - Undo/Redo history management
- `/WebView/src/command.ts` - Command pattern implementations
- `/WebView/src/relations-panel.ts` - Relations panel (right pane)
- `/WebView/src/selection.ts` - Selection and focus management
- `/WebView/src/tab.ts` - Tab management, EditorTable factory
- `/WebView/src/editor-actions.ts` - saveTableDataFromStoreAsync/saveSchemaDataAsync
- `/WebView/src/in-memory-table-store.ts` - Central data store + IHistory interface + Dirty management
- `/WebView/src/reference-expression.ts` - Reference expression parser (SimpleReference + DynamicReference)

## DOM Structure (as of 2026-03-08)
- `.editor` (flex column)
  - `.editor-breadcrumb-bar` (navigation history, hidden when empty)
  - `.editor-content` (flex row)
    - `.editor-left-pane` (EditorTable wrapper)
    - `.relations-panel` (right pane)

## Recurring Review Patterns
- **Operation path coverage gap**: When removing a guard (e.g. makeReadOnly), ALL paths that depended on it must be re-secured
- **readOnly flag dependencies**: Ctrl+S, Delete/Backspace, Paste, cell edit all depend on readOnly in handler
- Cleanup tasks often miss items in the SAME FILE as deleted code
- Dead code detection: when removing a feature, search for methods whose ONLY callers were in the deleted code
- **Map key semantics change**: When changing the key meaning of a Map, ALL .get() call sites must be updated
- **CSS selector dependency on removed feature**: When removing CSS display:none logic, grep ALL test files for `:not([style*="display: none"])` selectors AND nth() index assumptions
- **insert/delete対称性**: insertRowInternalがストアを操作するなら、deleteRowも必ずストアを操作すべき
- **storeRowIndicesミニテーブル不整合**: ミニテーブルのstoreRowIndicesは不連続配列
- **動的参照解決の二重実装**: handler(resolveDynamicReferenceAsync)とRelationsPanel(resolveDynamicReferenceEntryAsync)で同じロジックが異なるデータソースで実装されている（handler=referenceDataCacheのみ, RelationsPanel=ストア優先）

## Dynamic Reference (2026-03-13)
- **構文**: `$(table.id == $reward_table_id).master.id`
- **解決フロー**: valueColumn値取得 → フィルタテーブル検索 → lookupColumn取得(=テーブル名) → ターゲットテーブルのtargetColumnでフィルタ
- **二重実装問題**: editor-table-handler.ts L913-961 と relations-panel.ts L281-327 で同一ロジック。データソースが異なるため結果不一致リスク
- **N:1ミニテーブルのautoFill**: 動的参照N:1のfkColumnName/fkValueは空文字列（行追加時FK自動埋め込みなし）

## storeRowIndices (2026-03-10, updated)
- **導入**: PK重複時にupdateCellValueが最初のヒット行を誤更新するバグ修正
- **設計**: EditorTable.storeRowIndices[] = DOMデータ行i → ストア行インデックス
- **通常テーブル**: [0,1,2,...] の単純連番。initialize()で初期化
- **ミニテーブル**: filteredRows構築時の不連続インデックス。setStoreRowIndices()で設定
- **OPEN ISSUES**:
  1. 0行テーブルへのinsertRowInternalでindices[-1]→NaN
  2. N:1の全列一致比較が重複行で破綻
  3. replaceAllRows()後にstoreRowIndicesが陳腐化する
  4. getter/setter禁止違反（getStoreRowIndices/setStoreRowIndices）
  5. 同一テーブル名の複数ミニテーブル間でstoreRowIndices陳腐化

## Dual Data Source Pattern (store vs referenceDataCache)
- 1:N resolution: InMemoryTableStore (tab open) vs referenceDataCache (tab closed)
- N:1 resolution: ストア優先→キャッシュフォールバック（021a6c2以降）
- **Stale cache risk**: fullDataCache snapshots CSV at load time
- **FIXED: resolveTableDataAsync共通化**: N:1/1:Nの「ストア優先→キャッシュフォールバック」を共通メソッドに統合

## Save Paths (updated 2026-03-10)
- 通常テーブル・ミニテーブル共通: saveTableDataFromStoreAsync (ストア→CSV直接)
- **OPEN**: 0行テーブルへのinsertRowInternalでindices[-1]→NaN
- **OPEN**: ミニテーブルのDeleteRowCommand.undo()でFK列がストアに復元されない
- **OPEN**: 同一テーブル名の複数ミニテーブル間でstoreRowIndicesが陳腐化する

## Buffer Row Promotion (2026-03-11)
- **OPEN: Fill操作パス漏れ**: applyFillSeriesはapplyCellChangesWithHistoryを経由しない
- **OPEN: demote対称性**: PromoteBufferRowCommandの中間行降格が非対称
- **OPEN: DOM列数vsストア列数**: promoteBufferRowToStoreがgetColumnCount()(DOM)を使用

## Structural Concerns
- **Parallel array anti-pattern in RelationsPanel**: 5 arrays + storeRowIndices
- **Window listener累積問題**: activate()をN個のミニテーブルに呼ぶと同時登録

## Test Infrastructure Issues
- Copy-paste: openTableAsync duplicated across 25 e2e spec files (as of 2026-03-13). selectRowAsync 15 files.

## Review History
- 2026-03-07 ~ 2026-03-11: See detailed entries in previous versions
- 2026-03-13 (dynamic-reference): 動的参照N:1ミニテーブル表示。致命的2件（autoFill設計欠落/二重実装）、重要4件（ジャンプ未テスト/直列await/エッジケーステスト不足/コピペ25個目）、軽微2件。
