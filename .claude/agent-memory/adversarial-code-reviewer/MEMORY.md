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

## BUG_0024 N:1コンテキストヒント修正 (2026-03-17) Known Patterns
- **CRITICAL**: buildMiniEditorTableAsync L841 の `setAutoFillEntries` 呼び出しは relationType チェックなし。N:1の fkColumnName が空文字列から非空文字列になった修正で、N:1ミニテーブルにも自動入力が設定される新バグが発生する。`entry.relationType === '1:N'` 条件を追加すること。
- **CRITICAL**: 描画条件 `if (entry.fkColumnName !== '')` が fkValue の空文字列をガードしていない → `quest_id=` という不正テキスト表示の可能性。
- **PATTERN**: fkColumnName/fkValue を「コンテキスト表示」と「自動入力」の2つの目的に使い回しているため、一方の修正がもう一方に意図せぬ副作用を与えやすい構造的問題。

## BUG_0023 Diff Tab Padding Row Save (2026-03-17)
- **CRITICAL (R2 未解決)**: computeCurrentRightPaddingStoreRowIndices が「domDataRowIndex < storeRowIndices.length」で2種のパディング行を区別しようとしているが、行削除後にstoreRowIndices.spliceで詰まった後、削除後パディング行のdomDataRowIndexがstoreRowIndices.length未満になるシナリオで誤判定する。初期パディング行インデックスをコンストラクタ時点でSet<number>として保持しCommandでsync するのが正しい設計
- **CRITICAL (R2 新規)**: reloadCellsFromStore()で通常タブに行が追加される場合、参照ヒント・ドロップダウンが設定されないセルが生成される (EditorTable.createCell は基本DOMのみ)
- **CRITICAL (R2 新規)**: reloadTableDataAsync でDirtyなストアをCSV上書きするリスク。差分タブ保存→通常タブのDirtyデータが消えるシナリオ
- **KNOWN ISSUE (R2)**: connectOpenEditorTables()が生焼けオブジェクトパターン(| falseメンバ変数+後付けconnect)
- **FIXED (R2)**: openEditorTables経由でreloadCellsFromStore()呼び出し追加
- **PATTERN**: テストは「行追加→保存」のみカバー。「行削除（パディング化）→保存」パスが未検証 — 操作パスの網羅漏れパターン(BUG_REPORT#1)の再発
- **PATTERN**: then().catch()内で再throwした場合、親chainと繋がらずunhandled rejectionになる

## DropdownQuickView Instant-Show Refactor (2026-03-17) Known Patterns
- **CRITICAL**: showPreviewImmediate が cancelHideTimer() を呼ばない。アイテムA→B素早く移動時にmouseleave(A)の50ms hideTimerが残存し、B用のfetchAndRenderAsyncをキャンセルする。修正: showPreviewImmediateの冒頭でcancelHideTimer()を呼ぶこと。
- **IMPORTANT**: showPreviewWithDelay と showPreviewImmediate が完全に同一の実装になった。"WithDelay"という名前が嘘。一方を削除してAPIを統一すべき。
- **IMPORTANT**: max-width削除後にpositionElementの左配置 (listRect.left - offsetWidth) に Math.max(0,...) が無い。大量列テーブルでQVが画面外左に消える。
- **MINOR**: テスト1番の { timeout: 100 } はモックが速いので通るが「即座表示」の証明としては不十分。フレイキーリスクあり。
- **PATTERN**: ディレイを削除するとき「ディレイ中は発火しない」ガード条件も必ず合わせて見直すこと。旧コードの hoverTimerId !== 0 ガードが hidePreviewWithDelay に存在していた。

## Click Auto-Scroll (scroll-position / selection.ts) Known Patterns
- **CRITICAL**: extendSelection()にscrollCellIntoView()を追加すると、ドラッグ中(selecting=true)にDragControllerのオートスクロールと競合する。`if (!this.selecting)` ガードが必須。
- **CRITICAL**: start()のscrollFocusIntoView()→rAF再適用が、ドラッグ開始直後のDragControllerスクロールを上書きする競合がある。rAFコールバック内でselecting確認が必要。
- **IMPORTANT**: selectColumn/selectRow/extendToColumn/extendToRowにもscrollFocusIntoViewが必要 — 操作パスの網羅漏れパターン再発
- **PATTERN**: scrollCellIntoView()のrAF再適用はdrag中に高頻度登録される。selecting=trueのガードで呼び出し自体を抑制する設計が正しい。
- **TEST PATTERN**: getCellBoundingRectAsyncのセレクタが.editor-table-empty-rowを除外していないとバッファ行構造変更時にOff-by-one発生
- **TEST PATTERN**: 使われていないcontainerRect変数がデッドコードとして両テストに存在

## Sort/Filter Icon SVG (FEAT_0033) Known Patterns
- **FIXED R2**: arrowPairラッパーspan導入でprioritySpanのflexrow横並び問題が解消
- **CRITICAL (R2未解決)**: span.sort-icon-asc/descのline-height:1が残存。display:flexまたはdisplay:inline-flexを付与しないとfont metrics由来のline-boxがSVGサイズと不整合になる
- **CRITICAL (FEAT_0023継続)**: area-resizerの最小列幅が20pxハードコード → MIN_COLUMN_WIDTH_PX(50px)と乖離。has-icons列で20pxまで縮小するとアイコンがセル外にはみ出す
- **IMPORTANT (R2未解決)**: createSortArrowSvgにaria-hidden="true"がない — 装飾SVG全般に必須
- **IMPORTANT (R2未解決)**: E2Eテストでfor+breakパターンが3テスト全てに再発 — 「最初の1列だけ検証」で全列カバーしない
- **MINOR (R2未解決)**: filter-icon border-radius:2pxがbackground-color削除後もデッドCSSとして残存
- **PATTERN**: flexレイアウト変更時は複数列ソート優先度表示パスを必ずテストすること
- **PATTERN**: SVGをspan内に入れる場合はaria-hidden="true"を付与すること（装飾目的のSVG全般に適用）
- **PATTERN**: E2Eテストでfor+breakパターンは「最初の1件しか検証しない」欠陥になる。全件走査すること

## Review History (2026-03-17 続き)
- (click-auto-scroll selection.ts): 致命的2件、重要3件、軽微3件
- (FEAT_0033 sort-filter-icon R2): 致命的2件、重要2件、軽微2件

## Review History (2026-03-16)
- (FEAT_0028 source-control-panel改修): 致命的2件、重要3件、軽微3件
- (diff-tab-resize-handle): 致命的2件、重要3件、軽微2件
- (diff-tab-resize-handle R2): 致命的0件、重要2件(うち1件継続)、軽微2件(うち1件継続) — 前回指摘4件はすべて修正済み

→ 詳細は `review-history.md` 参照

## FEAT_0036 Column Auto-Resize Known Patterns (R2確認済み)
- **FIXED R2**: calculateAutoColumnWidth のセレクタが `.cell-reference-hint, .cell-reverse-reference-hint` に修正された
- **FIXED R2**: widthFactoryパターンで applyColumnsWidthWithUndo に統合された（重複コード解消）
- **FIXED R2**: 空テーブルでの isColumnSelection 判定は実質問題なし（バッファ行が常に存在するため rowCount>=2）
- **CRITICAL R2 UNFIXED**: D&Dリサイズの Math.max(20,...) が MIN_COLUMN_WIDTH_PX(50px) に未修正。MIN_COLUMN_WIDTH_PX がimportすらされていない (area-resizer.ts L86)
- **CRITICAL R2 UNFIXED**: 複数列選択D&Dでドラッグ対象列の幅が変化なし→他の選択列も未更新。L89の早期リターンが原因（`resizeColumnOldWidth !== newWidthStr`チェックをD&D経路から除去すべき）
- **IMPORTANT R2 UNFIXED**: calculateAutoColumnWidth が Utility.canvas シングルトンを使わず毎回 document.createElement('canvas')（3度目の指摘）
- **MINOR R2 UNFIXED**: hintElement.textContent! → `as string` にすべき (editor-table.ts L697)
- **PATTERN**: D&Dとダブルクリックで最小幅保証が非対称になるパターン — 両経路の Math.max を同じ定数で揃えること
- **PATTERN**: 「セル幅計算でreferenceヒントを考慮する」コードは正参照・逆参照の両セレクタを網羅すること

## CommandPalette Description (FEAT_未定) Known Patterns
- **CRITICAL**: main.tsの `typeof x === 'string'` 判定は空文字列を通過させる → `description = ''` で空spanがDOM生成される。`length > 0` チェックが必須
- **IMPORTANT**: createTestFileSystem()が両テーブルともdescriptionありに変更された → descriptionなしパスのテストが欠落（操作パス網羅漏れパターン再発）
- **IMPORTANT**: デッドCSS `.command-palette-item-kind` が残留したまま同一スタイルの `.command-palette-item-description` を重複追加 → `.kind` を削除すべき
- **IMPORTANT**: TDDコメント「現在は 6px なので RED」が実装後も残留
- **MINOR**: descriptionのtext-overflow/white-space/overflow対策なし → 長いdescriptionでitem高が崩れる
- **PATTERN**: TDDのRED段階コメントは実装完了後（GREEN）に必ず削除またはリライトすること

## Review History (2026-03-17 最新)
- (FEAT_0036 column-auto-resize R1): 致命的2件、重要3件、軽微3件
- (FEAT_0036 column-auto-resize R2): 致命的2件、重要1件、軽微2件 — 前回5件中3件修正済み
- (CommandPalette description表示): 致命的1件、重要3件、軽微2件
