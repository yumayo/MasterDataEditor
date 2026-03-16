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
- `/WebView/src/editor-table-structure.ts` - Row/column insert/delete + storeRowIndices sync
- `/WebView/src/history.ts` - Undo/Redo history management
- `/WebView/src/command.ts` - Command pattern implementations
- `/WebView/src/relations-panel.ts` - Relations panel (right pane)
- `/WebView/src/tab.ts` - Tab management, EditorTable factory, pane stack management
- `/WebView/src/in-memory-table-store.ts` - Central data store + IHistory interface + Dirty management
- `/WebView/src/reference-data-cache.ts` - ReferenceDataCache (items + fullData cache)
- `/WebView/src/grid-dropdown-input.ts` - FK dropdown input component
- `/WebView/src/dropdown-quick-view.ts` - Hover quick preview panel (RelationsPanel-style)

## CSS Variables (index.css)
- Defined: `--font-color`, `--background-color`, `--background-sub-color`, `--border-color`, `--selection-color`, `--selection-font-color`, `--scroll-bar-background-color`, `--focus-border` (#007acc, ライトテーマのみ)
- NOT defined in dark theme: `--focus-border` (`:root`の値を引き継ぐが明示再定義なし)
- NOT defined: `--selected-color`, `--tab-background`, `--list-hover-background`, `--text-muted-color`, `--text-color-secondary`, `--cell-background-color`
- CSS hardcoded colors: 7+ occurrences across FEATs (recurring pattern)

## Recurring Review Patterns
- **Operation path coverage gap**: ALL paths must be secured when adding new features
- **open/close symmetry for special tabs**: Settings tab open creates DOM+panel but close has NO cleanup
- **show/hide symmetry for overlay views**: showDiffView hides rightSlot but no path restores it on tab switch
- **CSS未定義変数**: 別FEAT/ファイルで繰り返し発生 (FEAT_0002,0004,0005,0013)
- **awaitポイント後のrequestIdチェック**: 全awaitポイントでrequestIdチェック必須
- **reloadCellsFromStore行数同期の副作用漏れ**: Selection/GitDiffHighlight/行ヘッダー再ナンバリングが必要
- **Orphaned public methods after refactor**: 呼び出し元ゼロのpublicメソッドが地雷化
- **CSV parse duplication**: parseCsv() reimplemented 3+ times with inconsistent behavior
- **Special tab deactivate() gap**: destroy()でEditorTableHandler.deactivate()を忘れる
- **Row sync added but column sync forgotten**: notifyRowInserted/Deleted追加時にnotifyColumnInserted/Deletedを忘れる
- **Sort/Filter reorder missing state propagation**: DOM再配置後にSelection/CopyRange/GitDiff/PKValidationを更新しない
- **CSS hardcoded colors**: 7回再発 — CSS変数使用を徹底せよ
- **document listener leak on re-instantiation**: 無名リスナーはremoveEventListener不可
- **previewCache key must include tableName**: itemIdのみのキーは複数テーブル跨ぎで汚染される (FEAT_0019)
- **hover維持の対称性**: アイテム→QV間もQV→アイテム間も同一ディレイで統一する (FEAT_0019)
- **Factory method must complete ALL setup**: 参照ヒント+ドロップダウン設定を外部に出さない

## Structural Concerns
- **Parallel array anti-pattern in RelationsPanel**: 5 arrays + storeRowIndices
- **store.getHeader/getRows returns internal reference**: caller mutation corrupts store
- **Csv class**: half-baked object pattern (10+ instances project-wide)
- **textNode: Text | false = false**: | false pattern (廃止方向の既知負債)
- **GridDropdownInput.element is public HTMLElement**: 既存負債 (FEAT_0013〜)

## Dropdown QuickView (FEAT_0013/FEAT_0019 改訂)
- **FIXED FEAT_0019**: cleanup()がpreviewCacheをクリアするようになった
- **FIXED FEAT_0019**: positionElementがbottomオーバーフローも補正するようになった
- **FIXED FEAT_0019**: hoverTimerId/currentReferenceTableName の null メンバー変数が廃止
- **CRITICAL FEAT_0019**: previewCacheキーがitemIdのみ -> tableName違いで別テーブルデータ汚染
- **CRITICAL FEAT_0019**: QV mouseleaveが即時hidePreview() -> QV→アイテム戻り操作が破壊される (hidePreviewWithDelay()を使うべき)
- **KNOWN ISSUE**: isHovered()が呼び出し元ゼロ -> orphaned public method
- **KNOWN ISSUE**: cleanup()でcurrentPreviewRequestIdがリセットされない
- **KNOWN ISSUE**: z-index:1000が親スタッキングコンテキスト(grid-dropdown z-index:100)内に閉じる
- **KNOWN ISSUE**: GridDropdownInput.show()にconsole.logが残留
- **KNOWN ISSUE**: positionElement bottomオーバーフロー補正でcontainerRect基準の誤差

## Review History (2026-03-13〜2026-03-14)
→ 詳細は `known-issues-archive.md` 参照

## Diff Tab (tab.ts) Known Patterns
- **removeTabButton/closeTab二重remove**: removeTabButtonにelement.remove()を追加した場合、closeTab側の tabButton.element.remove()が二重削除になる。経路ごとに削除責務が違う構造が根本原因。
- **diffTabName に isStaged が含まれない**: キー = DIFF_TAB_PREFIX + tableName のみ。staged/changesの切り替えで古いタブが再利用されサイレントバグになる。
- **closeAllDiffTabs は closeTab を経由しない**: enterSettingsMode/leaveSettingsMode の重複呼び出し回避のため直接destroyする設計。この2パスの乖離が今後も問題を生みやすい。

## DiffTab Dropdown (diff-tab-dropdown-fix) Known Patterns
- **staged=true でドロップダウン生成を抑制しない**: isStaged チェックを buildDiffEditorTable 呼び出し前に行い dropdownContainer=null を渡すべき
- **buildDiffEditorTable 戻り値に dropdownInput が含まれない**: destroy() でhide()できずタイマーリークの温床
- **diff-tab-wrapper に position:relative がない**: ドロップダウンの絶対座標基準が .editor(position:fixed)になり、スクロール時ズレが発生する
- **buildDiffEditorTable で fillController.activate() が欠落**: createMiniEditorTable と乖離 (対称操作パターン再発)
- **console.log が GridDropdownInput.show() / EditorTableHandler に残留**: 差分タブドロップダウン修正で初めてこのパスが通るようになり問題が顕在化

## Mini-table Buffer Row (FEAT_0022) Known Patterns (R2で確認済み)
- **FIXED**: deleteRow(structure.ts) に `isMiniTableInstance() && diffTab === false` 条件でensureTrailingBufferRow追加
- **FIXED**: normalizeTrailingBufferRows が removeChild 後に renumberRowsFrom(0) と updateRendererAfterResize を呼ぶ
- **FIXED**: ensureTrailingBufferRow で追加したバッファ行に updateReferenceHintsForRows を呼ぶ
- **FIXED**: ensureTrailingBufferRow/normalizeTrailingBufferRows で selection.updateRendererAfterResize を呼ぶ
- **PATTERN**: deleteRow の diffTab条件チェックが必要な理由: deleteRow はコンテキストメニューから DiffTab テーブルでも呼ばれる。promoteBufferRowToStore/demoteStoreRowToBuffer は DiffTab テーブルで isBufferRow が常に false のため呼ばれず、diffTab条件チェック不要
- **PATTERN**: ensureTrailingBufferRow はアクセス修飾子なし(暗黙public) — EditorTableStructure から呼ばれるため private 化不可（TypeScript の package-level アクセス制御がない）

## BUG_0021 Non-Sequential Schema Key Known Patterns
- **FIXED**: column-sorter.ts computeSortedIndices に getStoreColumnIndex() ファサード経由のDOM→CSV変換追加
- **FIXED**: diff-tab.ts columnCount を schema.header.length から displayHeader.length に修正
- **FIXED**: diff-tab.ts csvIndexToDomIndex 逆引きマップ構築して applyDiffClasses に渡す
- **FIXED**: editor-table.ts applyGitDiffHighlight に columnMapping 変換追加
- **FIXED**: editor-table.ts refreshGitDiffAsync の pkColumnIndices をstoreHeader.indexOf に修正
- **FIXED**: ColumnFilter / FilterDropdown が getStoreColumnIndex() ファサード経由でストア列インデックスを使うよう修正
- **CRITICAL UNFIXED (R2)**: updateCellValueAt (editor-table.ts L1604) が `updateFullDataCell` に `column - 1`（DOM列インデックス）を渡している。storeColIndex（L1600で取得済み）を使うべき。非連番keyスキーマで参照キャッシュが汚染される。
- **PATTERN**: columnMapping 変換が必要な箇所: ソート・フィルター・git差分ハイライト・referenceDataCache更新の4箇所。修正漏れが発生しやすい。
- **PATTERN**: getStoreColumnIndex() ファサードを追加してもそのすぐ下のコードで storeColIndex を使わず column-1 を渡すミスが発生した。同一メソッド内の全column参照を横断チェックすること。

## FEAT_0023 Header Icon Separation Known Patterns
- **CRITICAL**: diff-tabはisMiniTable=trueだが、EditorTableData.parse(..., true)を渡している。isMiniTableInstance()=trueのためcreateColumnHeaderCellがhas-iconsクラスを付与せずアイコンも追加しないが、列幅にHEADER_ICON_AREA_PX(48px)が加算される → 「幅広いのにアイコンがない」逆転バグ
- **CRITICAL**: area-resizerの最小列幅が20pxハードコード → MIN_COLUMN_WIDTH_PX(50px)定数と乖離。has-icons列で20pxまで縮小するとアイコン(right:30px)がセル外にはみ出す
- **PATTERN**: isMiniTable=trueが「アイコンなし/バッファ行なし/保存不可」複数の意味を兼ねる設計。diff-tabが「ミニテーブルだがアイコンあり」を実現しようとして矛盾が生じる
- **PATTERN**: スキーマ保存(saveSchemaDataAsync)でDOM実幅がwidthフィールドに保存される。再読み込み時はcalculateColumnWidthを呼ばずwidthを直接使うため、hasIconsの効果がラウンドトリップで失われる
- **PATTERN**: CELL_HORIZONTAL_EXTRA(17)はpadding-right:6pxを前提にするが、has-iconsクラスでpadding-right:48pxに変わる。table-cellのwidthとpaddingの相互作用が未検証

## FEAT_0027 DropdownQuickView Singleton/body配置 Known Patterns
- **FIXED R2**: cleanup()/hidePreview()が++currentPreviewRequestIdでキャンセルするようになった
- **FIXED R2**: connectQuickView:false引数でQV内ミニテーブルへのQV接続を防止
- **FIXED R2**: tab!/store!をTab|false/InMemoryTableStore|falseに変更+renderContentAsyncでエラースロー
- **FIXED R2**: DOM構築を全await完了後に移動 (renderContentAsync)
- **FIXED R2**: createMiniEditorTable後にeditorTable.deactivate()呼び出し追加
- **CRITICAL R2 UNFIXED**: destroyCurrentMiniEditorTable()がthis.element.innerHTML=''を呼ばない → キャンセル時DOM残留 (visibleクラスなしで非表示だが次のrenderまで孤立)
- **CRITICAL R2 UNFIXED**: connectTab()/connectDropdownQuickView()は依然として後付け設計 → コンストラクタ引数渡しにすべき
- **PATTERN R2**: preloadReferenceTables/resolveReverseReferencesAsyncがfire-and-forgetでQV破棄後も完了コールバックが走る
- **PATTERN R2**: store.registerTableAsync()をQVが呼び、その直後にcreateEditorTableも呼ぶ二重登録の懸念
- **FIXED FEAT_0027**: z-index:1000の親スタッキングコンテキスト問題をbody直下+position:fixedで解決
- **FIXED FEAT_0027**: previewCacheを廃止してミニEditorTableに全面置き換え

## FEAT_0028 SourceControlPanel改修 Known Patterns
- **FIXED (R2)**: refreshAsync に requestId チェックが追加された (2箇所のawaitポイント後)
- **FIXED (R2)**: スキーマ取得失敗時のtry/catchで空文字を返すようになった
- **FIXED (R2)**: STAGEDセクションが上、CHANGESセクションが下に変更 (ExplorerFile同様の2行構造)
- **FIXED (R2)**: description表示を追加 (ExplorerFileと同じ視認性)
- **KNOWN ISSUE**: `schema.description ?? ''` → フォールバック禁止ルール違反 (`??`演算子)
- **PATTERN**: replaceChildren()でDOM全破棄する際、アクティブクラスも失われる → refreshAsync後にアクティブ状態が失われる (未修正)
- **KNOWN ISSUE**: diffTabName に isStaged が含まれない問題が顕在化しやすい (未修正)
- **PATTERN**: アクティブクラス付与がawait前に行われるため「アクティブ表示あり・タブ未表示」の一時状態が発生する

## DiffTab Resize Handle Known Patterns
- **FIXED (R2)**: mousedown後destroy()でdocumentのmousemove/mouseupリスナーを強制解除するようになった (dragMouseMove/dragMouseUp保持+nullチェック)
- **FIXED (R2)**: `--focus-border`がindex.css `:root`に定義された (#007acc)
- **FIXED (R2)**: flexGrow/flexShrink再代入が廃止、flexBasisのみ変更するようになった
- **KNOWN ISSUE**: 水平スクロール同期は左右pane幅が異なる(リサイズ後)と意味をなさない。垂直のみ同期が正しい設計 (未修正)
- **KNOWN ISSUE**: `--focus-border`がdarkテーマで再定義されていない (未修正)
- **PATTERN**: ドラッグ中destroy()はRelationsPanelリサイズも同じ問題を持つ既存負債
- **PATTERN**: `.diff-pane-left`のborder-rightとリサイズハンドルbackgroundが視覚的に二重線になる

## BUG_0023 Diff Tab Padding Row Save (2026-03-17)
- **CRITICAL (R2 未解決)**: computeCurrentRightPaddingStoreRowIndices が「domDataRowIndex < storeRowIndices.length」で2種のパディング行を区別しようとしているが、行削除後にstoreRowIndices.spliceで詰まった後、削除後パディング行のdomDataRowIndexがstoreRowIndices.length未満になるシナリオで誤判定する。初期パディング行インデックスをコンストラクタ時点でSet<number>として保持しCommandでsync するのが正しい設計
- **CRITICAL (R2 新規)**: reloadCellsFromStore()で通常タブに行が追加される場合、参照ヒント・ドロップダウンが設定されないセルが生成される (EditorTable.createCell は基本DOMのみ)
- **CRITICAL (R2 新規)**: reloadTableDataAsync でDirtyなストアをCSV上書きするリスク。差分タブ保存→通常タブのDirtyデータが消えるシナリオ
- **KNOWN ISSUE (R2)**: connectOpenEditorTables()が生焼けオブジェクトパターン(| falseメンバ変数+後付けconnect)
- **FIXED (R2)**: openEditorTables経由でreloadCellsFromStore()呼び出し追加
- **PATTERN**: テストは「行追加→保存」のみカバー。「行削除（パディング化）→保存」パスが未検証 — 操作パスの網羅漏れパターン(BUG_REPORT#1)の再発
- **PATTERN**: then().catch()内で再throwした場合、親chainと繋がらずunhandled rejectionになる

## Review History (2026-03-16)
- (FEAT_0028 source-control-panel改修): 致命的2件、重要3件、軽微3件
- (diff-tab-resize-handle): 致命的2件、重要3件、軽微2件
- (diff-tab-resize-handle R2): 致命的0件、重要2件(うち1件継続)、軽微2件(うち1件継続) — 前回指摘4件はすべて修正済み

## Review History (2026-03-15)
- (FEAT_0008 diff-tab): 致命的2件、重要4件、軽微4件
- (PK-validation R2): 致命的2件、重要4件、軽微3件
- (column-sorter R2): 致命的2件、重要5件、軽微3件
- (column-sorter R3): 致命的2件、重要4件、軽微3件
- (column-filter R1): 致命的2件、重要4件、軽微4件
- (FEAT_0013 dropdown-quickview): 致命的2件、重要4件、軽微4件
- (FEAT_0014 mini-table-buffer-row): 致命的2件、重要3件、軽微2件
- (FEAT_0016 PK/FK badge): 致命的2件、重要3件、軽微3件
- (FEAT_0017 badge-left-placement): 致命的2件、重要3件、軽微2件
- (N:1-buffer-row): 致命的2件、重要3件、軽微2件
- (diff-tab-reference-hint): 致命的2件、重要3件、軽微2件
- (FEAT_0018 diff-tab-row-insert-delete-sync): 致命的2件、重要4件、軽微3件
- (FEAT_0019 dropdown-quickview-hover): 致命的2件、重要4件、軽微4件
- (diff-tab-duplicate-fix): 致命的2件、重要3件、軽微3件
- (diff-tab-dropdown-fix): 致命的2件、重要3件、軽微2件
- (FEAT_0022 mini-table-trailing-buffer-row): 致命的2件、重要3件、軽微2件
- (FEAT_0022 R2): 問題なし（前回指摘4件がすべて修正済み）
- (FEAT_0023 header-icon-separation): 致命的2件、重要3件、軽微3件
- (BUG_0021 non-sequential-schema-key): 致命的1件、重要2件、軽微2件
- (BUG_0021 R2 column-filter fix): 致命的1件、重要2件、軽微2件
- (FEAT_0027 dropdown-quickview-singleton): 致命的3件、重要3件、軽微3件
- (FEAT_0027 R2 dropdown-quickview-singleton-fix): 致命的2件、重要3件、軽微3件
