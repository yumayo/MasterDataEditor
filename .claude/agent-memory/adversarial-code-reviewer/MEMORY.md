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
- `/WebView/src/editor-actions.ts` - saveTableDataFromStoreAsync/saveSchemaDataAsync (旧saveTableData/extractTableData/mergeCsvData削除済み)
- `/WebView/src/in-memory-table-store.ts` - Central data store + IHistory interface + Dirty management

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
- **Map key semantics change**: When changing the key meaning of a Map, ALL .get() call sites must be updated (see parentColumnName review 2026-03-09)
- **CSS selector dependency on removed feature**: When removing CSS display:none logic, grep ALL test files for `:not([style*="display: none"])` selectors AND nth() index assumptions that depended on hidden columns
- **insert/delete対称性**: insertRowInternalがストアを操作するなら、deleteRowも必ずストアを操作すべき。対称操作の片方欠落はbug-report #2パターン
- **storeRowIndicesミニテーブル不整合**: ミニテーブルのstoreRowIndicesは不連続配列。通常テーブル前提のインデックス計算を適用すると破綻する

## storeRowIndices (2026-03-10, updated)
- **導入**: PK重複時にupdateCellValueが最初のヒット行を誤更新するバグ修正
- **設計**: EditorTable.storeRowIndices[] = DOMデータ行i → ストア行インデックス
- **通常テーブル**: [0,1,2,...] の単純連番。initialize()で初期化
- **ミニテーブル**: filteredRows構築時の不連続インデックス。setStoreRowIndices()で設定
- **FIXED**: deleteRowでストアのremoveRow()追加（insertRowAtとの対称性修正）
- **FIXED**: ミニテーブルでのinsertRowInternalインデックス計算修正（storeRowIndicesベース解決）
- **OPEN ISSUES**:
  1. 0行テーブルへのinsertRowInternalでindices[-1]→NaN（境界値未処理）
  2. N:1の全列一致比較が重複行で破綻（常に最初のマッチを返す）
  3. replaceAllRows()後にstoreRowIndicesが陳腐化する
  4. getter/setter禁止違反（getStoreRowIndices/setStoreRowIndices）
  5. 同一テーブル名の複数ミニテーブル間でstoreRowIndices陳腐化

## Dirty Management (2026-03-08 -> 2026-03-09)
- **IHistory interface** in in-memory-table-store.ts: isDirty(), markSaved(), setTabButtonDirty()
- **historyRegistry**: Map<string, Set<IHistory>> tracks all Histories per table
- **Dirty保持パス**: unregisterTable でDirtyならrefCountsのみ削除しheaders/rowsを保持
- **dirtyTableNames補完フラグ**: Undo永久Dirty固着問題あり

## Editable Relations Panel Issues
- **OPEN: Handler event listener leak** - destroyMiniEditorTables removes DOM but doesn't remove listeners
- **Getter/Setter violations**: getStore(), getAutoFillEntries/setAutoFillEntries, getStoreRowIndices/setStoreRowIndices

## Dual Data Source Pattern (store vs referenceDataCache)
- 1:N resolution: InMemoryTableStore (tab open) vs referenceDataCache (tab closed)
- N:1 resolution: ストア優先→キャッシュフォールバック（021a6c2以降）
- **Stale cache risk**: fullDataCache snapshots CSV at load time
- **FIXED: resolveTableDataAsync共通化**: N:1/1:Nの「ストア優先→キャッシュフォールバック」を共通メソッドに統合
- **OPEN: PK高速パス**: find()はO(n)だがコメントに「O(1)相当」と虚偽記載。分岐自体が不要（filterRowsByColumnValue一本化推奨）

## Save Paths (updated 2026-03-10)
- 通常テーブル・ミニテーブル共通: saveTableDataFromStoreAsync (ストア→CSV直接)
- 旧saveTableData/extractTableData/mergeCsvData は削除済み
- deleteRowのストア行削除は修正済み（insertRowInternalと対称化）
- **OPEN**: 0行テーブルへのinsertRowInternalでindices[-1]→NaN（境界値バグ）
- **OPEN**: ミニテーブルのDeleteRowCommand.undo()でFK列がストアに復元されない（DOMに表示されない列は退避されない）
- **OPEN**: 同一テーブル名の複数ミニテーブル間でstoreRowIndicesが陳腐化する

## Review History
- 2026-03-07 (ea2398b): group-end insertion + FK sync
- 2026-03-07 (ded3f74+unstaged): View cleanup. APPROVED.
- 2026-03-07 (254635d): RelationsPanel addition. race/staleness FIXED.
- 2026-03-08 (mini EditorTable rounds 1-5): Progressive fixes
- 2026-03-08 (editable relations panel): makeReadOnly REMOVED, Ctrl+S data destruction
- 2026-03-08 (1:N tab-unloaded fix): Cache fallback. Stale cache risk.
- 2026-03-08 (breadcrumb Editor-level): Moved from RelationsPanel. Dual update path.
- 2026-03-08 (a22b7b3): RelationsPanel initial display fix.
- 2026-03-08 (unstaged-resizer): ミニテーブル列幅リサイズ修正。並列配列増殖パターン指摘。
- 2026-03-08 (unstaged-dirty): Dirty管理追加。markAllSaved N^2問題、保存失敗時dirty誤リセット指摘。
- 2026-03-09 (unstaged-dirty-preserve-r1): Dirty保持パス追加。孤立データ・Dirtyマーク未表示・順序不整合指摘。
- 2026-03-09 (unstaged-dirty-preserve-r2): 修正レビュー。isTableDirty到達不能・.catch内throw無意味・例外安全性欠如指摘。
- 2026-03-09 (08cd3a1): dirtyTableNames補完フラグ追加+タブDirtyマーク初期化。Undo時永久Dirty固着・コメント3箇所不整合指摘。
- 2026-03-09 (unstaged-drag-selection): editorTable.activate()追加。windowリスナー累積・テストコピペ指摘。
- 2026-03-09 (parentColumnName-r1): 逆参照マップキー変更。4箇所の.get()未修正・コメント不整合・テスト不足指摘。
- 2026-03-09 (parentColumnName-r2): 修正レビュー。2/4修正済み。applyReverseReferenceHintがPK編集時に非PKヒント消失・死んだコード残留・コメント3箇所古い指摘。
- 2026-03-10 (unstaged-hideColumns-removal): hideColumnsByName/hiddenColumns/cssHiddenColumns削除。mini-table-data-loss-on-tab-open.spec.ts修正漏れ（nth(1)セルずれ）・resize spec古セレクタ残留指摘。
- 2026-03-10 (440756e): storeRowIndicesインデックスベース化。致命的3件（deleteRow非対称/ミニテーブルinsert計算不正/N:1重複行破綻）、重要6件指摘。

## Structural Concerns
- **Parallel array anti-pattern in RelationsPanel**: Now 5 arrays + storeRowIndices. Must consolidate into single MiniTableEntry[] array.
- **Window listener累積問題**: activate()をN個のミニテーブルに呼ぶとmain+N個のSelectionDragControllerがwindow mousemove/mouseupを同時登録。

## Test Infrastructure Issues
- Copy-paste: openTableAsync duplicated across 20+ e2e spec files (as of 2026-03-10). selectRowAsync, waitForRelationsPanelContentAsync also duplicated.

## navigateToDefinition Dual Path (2026-03-10)
- Two call sites: (a) mousedown Ctrl+click (editor-table.ts L315), (b) F12 key (editor-table-handler.ts L408)
- Mini table branch added at top of navigateToDefinition, uses getRowPkValue(row) ignoring column param
- relationsPanel field IS set on mini tables (relations-panel.ts L647)
- RelationsPanel.navigateToDefinition uses currentEditorTable (left pane) for jump-origin history — correct for mini table case

## Buffer Row Promotion (2026-03-11)
- **概念**: 通常テーブルのemptyRowCount=100のバッファ空行にデータ入力時、ストアに昇格する
- **PromoteBufferRowCommand**: execute→promoteBufferRowToStore, undo→demoteStoreRowToBuffer
- **applyCellChangesWithHistory**: バッファ行検出→昇格→CompositeCommand(Promote+CellChange)で履歴記録
- **OPEN: Fill操作パス漏れ**: applyFillSeriesはapplyCellChangesWithHistoryを経由しないため昇格が行われない
- **OPEN: demote対称性**: PromoteBufferRowCommandが昇格前のstoreRowIndices長を記録しておらず、中間行の降格が非対称
- **OPEN: DOM列数vsストア列数**: promoteBufferRowToStoreがgetColumnCount()(DOM)を使用。ストアヘッダー長を使うべき
- **セル値変更の全経路**: (1)キー入力/submitText (2)ペースト (3)Delete/Backspace (4)Fill操作 (5)ドロップダウン選択。(1)(2)(3)(5)はapplyCellChangesWithHistory経由。(4)はapplyFillSeries直接。

## Review History (continued)
- 2026-03-10 (440756e+unstaged): ミニテーブルドリルダウン動作変更 + レースコンディション修正。F12テスト欠落・コピペ19個目・REDコメント残留指摘。
- 2026-03-10 (5ecf45f): ミニテーブル行挿入ストア位置バグ修正+deleteRowストア同期+保存パス統一。致命的2件（0行NaN/storeRowIndices陳腐化）、重要3件（Undo FK列消失/空行フィルタ変更/getter違反）。
- 2026-03-11 (7cc9daa): バッファ空行昇格(PromoteBufferRowCommand)。致命的1件（Fill操作パス漏れ）、重要4件（Undo対称性/DOM列数/二重実行/テスト不足+コピペ21個目）。
- 2026-03-11 (021a6c2): N:1ストア優先解決。致命的1件（PK高速パス喪失）、重要4件（共通化粒度/コピペ/let乱用/競合リスク）、軽微3件。
