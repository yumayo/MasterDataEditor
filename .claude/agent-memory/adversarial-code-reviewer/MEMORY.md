# Adversarial Code Reviewer Memory

## Project Architecture
- Frontend: Vanilla TypeScript (no framework), DOM is SSOT
- Backend: C#
- Design: Intentionally tightly coupled, Command pattern for Undo/Redo
- WebView2 (Microsoft browser control) used for frontend hosting

## C# Security Patterns
→ 詳細は `csharp-security-patterns.md` 参照
- ResolveSafePath: symlink/ADS 未対応、ex.Message 情報漏洩が既知の攻撃面
- GitCommandHelper: ArgumentList でインジェクション防止済み、git内部構文は別問題

## MCP Tools Patterns
- `/App.MasterDataEditor/Mcp/Tools/TableEditTool.cs` - セル編集MCPツール
- `/App.MasterDataEditor/Mcp/Tools/TableInfoTool.cs` - テーブル情報取得MCPツール
- `/App.MasterDataEditor/Mcp/McpHttpServer.cs` - MCPサーバー（Kestrel HTTP）
- `/App.MasterDataEditor/Mcp/EditorApiBridge.cs` - C#↔WebView2ブリッジ
- **MCPツールにtry/catch必須**: _bridge.RequestAsync は TS例外→InvalidOperationException、WebView2未接続→InvalidOperationException、タイムアウト→TaskCanceledException をスローする。MCPは外部インターフェースのため内部情報漏洩防止が必須
- **TOCTOU (getHeader→setCellValue間)**: 列名→インデックス変換後にユーザーが列追加/削除すると誤った列に書き込む
- **TableInfoTool.FormatDataRows にデフォルト引数**: CLAUDE.md違反が既存で残存

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
- `/WebView/src/fuzzy-search.ts` - ローマ字変換・正規化・ファジーマッチング (FEAT_0038)
- `/WebView/src/search-query.ts` - 検索クエリパース・matchesQuery (FEAT_0038)
- `/WebView/src/search-panel.ts` - 全文検索パネル (FEAT_0038)
- `/WebView/src/editor-api.ts` - EditorAPI実装 (内部API層)
- `/WebView/src/editor-api-bridge.ts` - C#↔WebViewブリッジ
- `/WebView/src/editor-api-types.ts` - EditorAPI型定義

## CSS Variables (index.css)
- Defined: `--font-color`, `--background-color`, `--background-sub-color`, `--border-color`, `--selection-color`, `--selection-font-color`, `--scroll-bar-background-color`, `--focus-border` (#007acc, ライトテーマのみ)
- NOT defined in dark theme: `--focus-border` (`:root`の値を引き継ぐが明示再定義なし)
- NOT defined: `--selected-color`, `--tab-background`, `--list-hover-background`, `--text-muted-color`, `--text-color-secondary`, `--cell-background-color`
- CSS hardcoded colors: 8+ occurrences across FEATs (recurring pattern, FEAT_0038でも再発)

## Recurring Review Patterns
- **Operation path coverage gap**: ALL paths must be secured when adding new features
- **awaitポイント後のrequestIdチェック**: 全awaitポイントでrequestIdチェック必須 (FEAT_0038, FEAT_0040, DiffTabSaveHighlight, ISSUE_0089, ISSUE_0091, ISSUE_0090で再発 **7回目**。catchブロック内も漏れやすい。新しいawaitを追加するたびに漏れる。正常系にはチェックがあるのにcatch側に忘れるパターンが定着)
- **CSS hardcoded colors**: 13回再発 — CSS変数使用を徹底せよ (RelationsPanel Toggle: editor.css/toolbar.css にrgbaハードコード追加)
- **CSS class defined in JS but missing in CSS**: search-result-pk がTSで使用されCSSに未定義 (FEAT_0038)
- **fuzzyMatch/fuzzyMatchHighlight重複実装**: マッチングロジックが2箇所に存在、片方の修正漏れリスク
- **参照式の独自パース**: parseReferenceExpression を使わずdotIndex手動パース (search-panel.ts)
- **フォールバック禁止**: `??` 演算子はCLAUDE.mdで禁止。15回以上再発（reference-data-cache.ts, form-panel.ts, filter-dropdown.ts, type-validation.spec.ts等）
- **Number()のJS特有挙動**: Number("Infinity")=Infinity(isNaN=false), Number("0x1f")=31, Number("0b101")=5 → C#パースと不整合。型バリデーションにはNumber.isFinite()+正規表現が必須
- **document listener leak on re-instantiation**: 無名リスナーはremoveEventListener不可
- **previewCache key must include tableName**: itemIdのみのキーは複数テーブル跨ぎで汚染される
- **fire-and-forget Promise without .catch()**: createMiniEditorTable内のrefreshGitDiffAsync()がcatchなし。EditorTableHandler.markSavedAndUpdatePanel L719-720に既存パターンあり。破棄済みDOMアクセスでUnhandled Rejectionになる (ISSUE_0101)
- **createMiniEditorTable呼び出し元の網羅漏れ**: ISSUE_0105でrefreshGitDiffAsyncをcreateMiniEditorTableから削除し呼び出し元責任にしたが、DropdownQuickViewの呼び出しパスを見落とした。createMiniEditorTableの呼び出し元はRelationsPanel + DropdownQuickViewの2箇所ある
- **diff-view.ts と diff-rows.ts のコピペ parseCsv**: 2ファイルに同一のparseCsv+DiffRow+SchemaJson重複。diff-rows.tsのみ修正しdiff-view.tsを放置するパターンがISSUE_0105で発生
- **Factory method must complete ALL setup**: 参照ヒント+ドロップダウン設定を外部に出さない
- **bug-report.md 既修正不具合の回帰**: ISSUE_0103でbug-report#75(px→%変更)を逆方向に戻した。修正時はbug-reportの過去エントリを必ず確認し、同一箇所の過去修正と矛盾しないか検証せよ
- **生焼けオブジェクト | false + connect パターン**: 4回再発（FEAT_0043 EditorTable.tab → FEAT_0047 NavigationHistory → EditorAPI Tab.editorApi → RelationsPanel Toggle RelationsPanel.editor）。コンストラクタ引数化を徹底せよ
- **registerSchema / unregisterSchema 非対称**: ISSUE_0107でDiffTab右ペインのスキーマがValidationEngine.schemasに登録されるがdestroy()で解除されない。validate()全走査でDiffTabスキーマが混入しPROBLEMSパネルにゴーストエラーが表示される。registerがあればunregisterが必要（bug-report.mdパターン2）
- **validateForTable / validatePkDuplicatesForTable コピペ**: validation-engine.ts L103-132。スキーマ解決ロジック6行が完全重複。resolveSchemaAndData()ヘルパー抽出で解消すべき

## FEAT_0040 Background Search Known Patterns
- **CRITICAL**: loadAllTableNamesAsync 後に requestId チェックなし → 無駄な Promise.all 実行
- **CRITICAL**: Promise.all はキャンセル不能 → 新 await ポイント追加のたびにキャンセル漏れが構造的に発生
- **CRITICAL**: executeSearchAsync に try/catch なし → loadAllTableNamesAsync 例外で searching クラスが永続固着
- **IMPORTANT**: setTimeout(0) が searchInTable の後 → 最後テーブルで yield しない (最初のテーブルでも初回 yield なし)
- **IMPORTANT**: MutationObserver が disconnect されない → テストのメモリリーク
- **PATTERN**: Promise.all + requestId キャンセルの組み合わせは危険。各 map 内でも requestId チェックが必要

## Structural Concerns
- **Parallel array anti-pattern in RelationsPanel**: 5 arrays + storeRowIndices
- **store.getHeader/getRows returns internal reference**: caller mutation corrupts store
- **Csv class**: half-baked object pattern (10+ instances project-wide)
- **textNode: Text | false = false**: | false pattern (廃止方向の既知負債)
- **GridDropdownInput.element is public HTMLElement**: 既存負債 (FEAT_0013〜)

## FEAT_0038 Fuzzy Search Known Patterns (初回レビュー)
- **CRITICAL**: romajiToHiragana で「n」+「y」の場合 CONSONANTS.has('y')=true → 「ん」+「y」になる。`ny`入力途中状態でにゃ/にゅ/にょ検索が壊れる。修正: `CONSONANTS.has(next) && next !== 'y'`
- **CRITICAL**: executeSearchAsync に requestId パターンなし → await後に古い検索結果で上書きされるレースコンディション
- **CRITICAL**: `.search-result-pk` がTSで使用されるがsearch-panel.cssに定義なし → PK値がスタイルなしで表示
- **CRITICAL**: buildSegments が normalizedHaystack のインデックスで元文字列をスライス → 正規化が1:1写像であることが不変条件だが未文書化。半角カタカナ(U+FF65-FF9F)は変換対象外で検索不能
- **IMPORTANT**: handleInputChange の数値判定が trim() なし、executeSearchAsync は trim() あり → 空白混じり数値でwholeWordAuto/OFF乖離
- **IMPORTANT**: resolveReferenceDisplay が独自dotパース → parseReferenceExpression/isSimpleReference を使うべき
- **IMPORTANT**: filterItems/collectCheckedValues の `?? textContent` がフォールバック禁止ルール違反
- **IMPORTANT**: searchInTable でpkColumnIndex=-1時に rowIndex を pkValue代替 → navigateToTableCell が誤動作
- **MINOR**: fuzzyMatch と fuzzyMatchHighlight がロジック重複 → fuzzyMatch は fuzzyMatchHighlight.some(s => s.highlight) に統一すべき
- **MINOR**: search-highlight が #fde68a ハードコード → ダークテーマ対応なし (CSS hardcoded colors 8回目)

## FEAT_0036 Column Auto-Resize Known Patterns (R2確認済み)
→ 詳細は `feat-archive.md` 参照
- **CRITICAL R2 UNFIXED**: area-resizer.ts L86 の Math.max(20,...) が MIN_COLUMN_WIDTH_PX(50px) 未修正
- **CRITICAL R2 UNFIXED**: 複数列選択D&DでL89早期リターンが原因で選択列幅が更新されない

## BUG_0021 Non-Sequential Schema Key Known Patterns
→ 詳細は `feat-archive.md` 参照
- **CRITICAL UNFIXED**: editor-table.ts L1604 updateFullDataCell に `column - 1`（DOM列）を渡している。storeColIndex を使うべき

## FEAT_0042 HTML Cell Render Known Patterns
- **CRITICAL**: sanitizeHtml のプレースホルダー `\x00BR\x00` がユーザー入力に含まれる場合、手順2で `&` エスケープ後にプレースホルダーが `<br>` に展開され任意の `<br>` が挿入される。ただし `\x00` はCSVや通常テキスト入力では実用上発生しにくい。将来的な攻撃面として存在する。
- **CRITICAL**: `applyTextOrHtml` が `cell.innerHTML = sanitizeHtml(value)` した後、参照ヒントの `appendChild` は機能するが、逆参照ヒントが PK 列に付く際も同フローを通るため、PK列に renderAsHtml が有効な場合のみ問題はないが、renderAsHtml列への参照ヒント+innerHTML の組み合わせでセルにヒント span が残ったまま innerHTML が上書きされると、次の setCellValue でヒント削除→innerHTML 再設定の順序になるため、一見正しく見えるが「setCellValue 冒頭でヒントを remove() してから innerHTML 設定」という不変条件が実際には満たされている。問題なし。
- **CRITICAL**: `getCellValue` で `cell.dataset.rawValue !== undefined` を先頭チェックするが、renderAsHtml列に参照ヒント span を appendChild した後は、`data-raw-value` も設定されているため rawValue を返す。正常。ただし、`cell.dataset.rawValue` が空文字列 `""` の場合 `undefined` ではなく `""` を返すため空文字値は正常に機能する。
- **CRITICAL**: `createCell` で `table.tableData.header[columnIndex]` アクセスが未範囲チェック。columnIndex がバッファ行挿入時に header 長を超える場合 `undefined` になり `.renderAsHtml` で TypeError がスローされる。
- **IMPORTANT**: `getColumnRenderAsHtml` と `getColumn` が getter に相当する（CLAUDE.md getter禁止）。
- **IMPORTANT**: `RenderAsHtmlToggleCommand` の `execute`/`undo`/`redo` が全て `this.toggle()` を呼ぶだけ → `redo()` は不要（`Command` インターフェースに `redo` があるなら正しい実装だが、interface 側に `redo` があるかを確認すること）。
- **PATTERN**: renderAsHtml + 参照ヒント共存時: innerHTML で描画した後に span を appendChild するのは安全だが、innerHTML 再設定でヒントが消えるため、setCellValue の冒頭でヒント remove → applyTextOrHtml という順序が不変条件。現実装は満たしている。

## FEAT_0043 FormPanel Known Patterns
- **CRITICAL**: `EditorTable.tab` が public フィールドで生焼けオブジェクトパターン再発。`connectTabRef(tab)` + private化すべき
- **CRITICAL**: `loadFkSectionDataAsync` が `section.title` 文字列を正規表現パースしてテーブル名取得 → `section.tableKey` / `section.fkValue` を直接使うべき
- **CRITICAL**: `renderCurrentPageAsync` に try/catch なし → resolveAsync 例外で「読み込み中...」が永続固着
- **CRITICAL**: `reverseMap.get(pkValue) ?? []` 含む ?? 演算子が計8箇所 → フォールバック禁止ルール大量違反
- **CRITICAL**: テストスキーマが `{ header: [...] }` 形式だが `SchemaJson` は `{ columns: [...] }` を期待 → FK参照セクションが常に空の可能性
- **IMPORTANT**: `getPanelElement()` がgetter相当 → `dispose()` メソッドで閉じ処理をカプセル化すべき
- **IMPORTANT**: `visibility: hidden/''` によるRP切り替えが `disconnectEditorTable()` と二重状態管理
- **PATTERN**: `buildRefSection` と `loadFkSectionDataAsync` でref-item構築ロジックが完全コピペ → 共通メソッド化必須
- **PATTERN**: CSS `rgba(255,255,255,0.03/0.06/0.08)` ハードコード + `--hover-color` は未定義変数（CSS hardcoded 10回目）

## FEAT_0045 Notification Known Patterns
- **CRITICAL**: `window.Notification` への代入は Web標準 Notification API を上書きする。クラス名を `SystemNotification` 等に変更必須
- **CRITICAL**: setTimeout IDを保持しないため shift() による強制削除時にタイマーをキャンセルできない。Map<HTMLElement, ReturnType<typeof setTimeout>> で管理すべき
- **CRITICAL**: `historyMessages: string[]` がDOMと二重状態管理（DOMがSSOT違反）。historyElement の children から復元可能であり削除すべき
- **IMPORTANT**: 無名アロー関数リスナー → removeEventListener 不可。dispose() 実装が必要
- **PATTERN**: FADE_DURATION_MS(TS) と CSS transition 0.4s の二重定義 → transitionend イベントで解消可能
- **PATTERN**: (window as any) によるグローバル公開がmain.tsに本番コードとして混入。テスト専用グローバルはフィクスチャで注入すべき

## FEAT_0047 Navigation History Known Patterns
- **CRITICAL**: `navigationHistory: NavigationHistory | false` + `connectNavigationHistory()` が生焼けオブジェクトパターン再発。Tab コンストラクタ末尾で `new NavigationHistory(this)` して解決すべき
- **CRITICAL**: `restoring` フラグが同期的にリセットされるが、`enableTabButton()` が非同期処理をトリガーするため非同期完了後の副作用には無効
- **CRITICAL**: タブ閉鎖後に戻る操作をすると孤立エントリを踏み続け、UIが変化しない。`skipCurrentEntry()` で相互参照を介したスキップ処理が必要
- **CRITICAL**: 現在アクティブなタブと同じタブをクリックすると同一エントリが重複 push される。`name !== this.activeTabName` ガードが必要
- **IMPORTANT**: `window.addEventListener('popstate', 無名関数)` → removeEventListener 不可 (MEMORY既知パターン再発)
- **IMPORTANT**: `state['tabName'] as string` の実行時型チェックなし
- **PATTERN**: TDD RED フェーズのコメントが実装後も残存 → GREEN 後に削除すること

## FEAT_0048 ValidationPanel Known Patterns (R2修正後)
- **[FIXED]** runValidation() に統合（全6箇所の validatePkDuplicates 直接呼び出し解消）
- **[FIXED]** storeRowToDomRow() 追加でソート中のジャンプが正しく機能
- **[FIXED]** ValidationPanel/StatusBar を Object.assign パターンで生焼けオブジェクト解消（Tab↔Sidebar と同パターン）
- **[FIXED]** ?? 演算子4箇所を除去（validation-engine.ts で list !== undefined チェックに変更）
- **[STILL]** Tab.validationPanel が | false パターン（connectValidationPanel で後付け）→ 生焼けオブジェクトの名残。ただしTab自体が巨大コンストラクタのため許容されているパターン
- **NEW ISSUE**: validation-panel.css に rgba ハードコード9箇所（CSS hardcoded colors 12回目）; status-bar.css に rgba/rgb 2箇所
- **NEW ISSUE**: clearFocusedCell() が定義されているが呼ばれていない（タブ切り替え時にフォーカスクラスが残留する）
- **NEW ISSUE**: jumpToError() で switchToExistingTab→getTabStates は同期完了するが、enableTabButton内でpaneStack操作後にsetRange/moveを呼ぶため、paneStack状態依存のタイミング問題が残存
- **NEW ISSUE**: display:'none'/'block' の比較によるトグルは visibility の SSOT 問題（DOMから状態を読んでいる点はSSOT準拠だがCSS classで管理すべき）
- **PATTERN**: CSS hardcoded colors は validation-panel.css/status-bar.css でも再発（rgba()直書き13箇所超）

## FEAT_0047 Navigation goBack/goForward R2 Known Patterns
- **CRITICAL**: `tab-switch` popstate で同一タブに goBack した場合、`enableTabButton` L618 が深化 paneStack を `currentState.paneStack` に保存した後 `activateTabState` が復元、さらに `restoreViewIndex(0)` の `truncateStackAfterIndex` が RP インスタンスに `disconnectEditorTable()` + `element.remove()` を実行。同一インスタンスを指す `existingState.paneStack[2]` がゾンビ参照になる
- **CRITICAL**: goBack 直後に同一タブが `activateTabState` されると `resume()` がゾンビ RP に呼ばれる可能性（一般的なタブ切り替えは `deactivateTabState` で paneStack を上書きするため実用上は顕在化しにくい）
- **IMPORTANT**: `restoreOrRebuildPaneStack` が `pushRelationsPanel` を呼ぶ前の `this.viewIndex=0` を暗黙の前提としている
- **PATTERN**: コメント「pushRelationsPanel 内で restoring=true のため...」は Tab が NavigationHistory の private フィールドを参照できるかのような誤解を招く

## ResizeHandle 共通化 Known Patterns
- **CRITICAL**: ResizeHandle は `dispose()` メソッドを持たない。ValidationPanel や Sidebar は生涯1インスタンスなので問題なしだが、将来的に動的破棄されるコンポーネントに使う場合はリスク。mousedown リスナーは匿名アロー経由であり RemoveEventListener 不可
- **CRITICAL**: ドラッグ中に mousemove が `document` で捕捉されるが、`pointer-events: none` を body に設定しないため iframe/SVG 上でイベントが消える可能性あり（WebView2 環境では iframe なしのため現状問題なし）
- **CRITICAL**: 2つの ResizeHandle ドラッグが同時発火した場合（ハンドル重なり等）、`document.body.style.cursor` が競合してリセットで片方が cursor='' になり状態が壊れる
- **IMPORTANT**: ValidationPanel.render() が毎回 `while(firstChild) removeChild` で全子削除 → resizeHandle.prependTo() で再 prepend。ResizeHandle の element は同一インスタンスなのでリスナーも生き続けるが、render() 内のクローズボタン click リスナーは毎回新規追加されている（1回のみの使用でOK）
- **IMPORTANT**: `resize-handle.css` の `.resize-handle[data-direction="vertical"]` は `top: 0` に配置。ValidationPanel 上端に固定されるが、パネルに `overflow-y: auto` があるため、スクロール後にハンドルがスクロール領域内に引き込まれ位置がズレる可能性がある（position:absolute は親のposition:relativeを基準とするため実際にはズレない、ただし overflow:auto との兼ね合いで clip される可能性がある）
- **IMPORTANT**: notification.css に `#c0392b`/`#ffffff`/`#252526`/`#cccccc` ハードコード 8 箇所（CSS hardcoded colors パターン継続）

## ResizeHandle consumedDelta パターン (2026-03-20 追加)
- **onResize の返り値規約**: 「マウスの移動方向と同符号のピクセル消費量」を返す。prevCoord += consumedDelta で更新される
- **Sidebar**: `return newWidth - currentWidth`（右移動でwidthが増えれば正）→ delta と同符号 → 正しい
- **ValidationPanel**: `return currentHeight - newHeight`（下移動でheightが縮小するので currentHeight - newHeight が正）→ delta と同符号 → 正しい
- **RelationsPanel**: `return currentWidth - clampedNewWidth`。右移動(delta正)でwidth縮小なのでcurrentWidth - clampedNewWidth が正。delta と同符号になり正しい（ただし符号二重反転で成立しているため脆い）
- **RelationsPanel の浮動小数点誤差**: percentage を 0.1%丸めした後 `(percentage/100) * rect.width` で clampedNewWidth を計算 → rect.width が整数でない HiDPI 環境でフレームごとに最大 0.5px の誤差が蓄積。長時間ドラッグで prevCoord がドリフトする
- **テスト設計のパターン**: 「上限到達後に超過分を戻るまで動かない」は検証しているが「超過解消後に動き始める」を検証していない。境界の両側をテストせよ

## ISSUE_0080 Dynamic Reference Validation Known Patterns
- **CRITICAL**: `validateSimpleReference` に ReferenceDataCache フォールバックが未追加（動的参照のみ修正、単純参照は放置）→ 操作パスの網羅漏れ（bug-report.md パターン1）再発
- **CRITICAL**: `filterRowIndex === -1` のサイレントスキップ → bug-report.md パターン5（b1384a0）と同構造。フィルタテーブルにマッチしない filterValue で動的参照カラムのエラーが黙殺される
- **CRITICAL**: `getFullDataSync` が `??` 演算子使用（reference-data-cache.ts L627）→ フォールバック禁止ルール違反（FEAT_0043/FEAT_0048で指摘・修正済みにもかかわらず残存）
- **IMPORTANT**: `ReferenceDataCache.fullDataCache` は行追加・削除を反映しない（updateFullDataCell はセル値更新のみ）→ キャッシュ陳腐化リスク
- **PATTERN**: ストア/キャッシュからの有効値セット構築コードが完全重複（共通メソッド化可能）
- **PATTERN**: `previousErrors.find()` が行ループ内で毎回線形検索 → O(rows * previousErrors)

## config.primaryKeyColumnName 廃止リファクタリング Known Patterns (2026-03-20)
- **CRITICAL**: `search-data-provider.ts` `loadFromFileAsync` が `primary_key` 不正時に `''` をサイレント返却 → throw に変えること
- **CRITICAL**: `form-panel.ts` の `primary_key[0]` アクセスが配列長未検証（空配列で undefined）× 6箇所コピペ
- **CRITICAL**: `form-panel.ts` L486/L492 に `?? ''` フォールバック残存（フォールバック禁止ルール違反）
- **IMPORTANT**: `extractFirstPrimaryKeyColumn` / `extractFirstPrimaryKeyColumnFromSchema` が2ファイルに重複実装 → 共通化必須
- **IMPORTANT**: `relations-panel.ts` L963-965 が空配列でサイレント `''` フォールバック（throw に変えること）
- **IMPORTANT**: `reference-data-cache.ts` でインポートと関数定義が混在（import順序破損）
- **IMPORTANT**: `form-panel.ts` N:1 セクションが `primaryKeyColumnName: ''` で生焼けオブジェクト生成
- **PATTERN**: primary_key 抽出ロジックのコピペが5ファイル8箇所に分散 → リファクタ時はユーティリティ関数化を先行させること

## ValidationPanel jumpToError リファクタ Known Patterns (2026-03-21)
- **[R1 FIXED]** PK重複ジャンプ: タブ開時は storeRowToDomRow で正確にジャンプ、タブ未開時は navigateToTableCell（PK値ベース）に分岐
- **[R1 FIXED]** フィルタ非表示行スキップ保護: storeRowToDomRow === null で早期リターン復活
- **[R1 FIXED]** getRowPkValue() デッドコード削除済み、resolvePkValueForRow に統合
- **[R2 STILL]** PK重複 + タブ未開時: pkValue が重複値そのもの → navigateToCell は最初の一致行にしかジャンプできない（設計判断として許容、コメント記載済み）
- **[R2 STILL]** validValues == null (L445) が抽象等価比較 → === null に修正すべき（R1指摘からの持ち越し）
- **[R2 STILL]** TDD RED フェーズコメントがテストに残存（L13-16, L138-140）（FEAT_0047 から3回目の再発）
- **[R2 NEW]** テスト2件のセットアップが完全コピペ（共通関数に抽出すべき）
- **[R2 NEW]** タブ開/未開でナビゲーション履歴への影響が非対称（switchToExistingTab vs navigateToTableCell）

## NotificationToast エラー通知伝播 Known Patterns (2026-03-21 R2)
- **[R1 FIXED]** EditorTableHandler.notification がコンストラクタ引数に修正済み（生焼けオブジェクト解消）
- **[R1 FIXED]** `if (this.notification)` フォールバック解消（notification は常に存在）
- **[R2 STILL]** 保存失敗 .catch() 4箇所（editor-table-handler.ts L516/519/528/538）に通知未追加。throw new Error で unhandled rejection（R1からの持ち越し）
- **[R2 STILL]** tab-reference.ts L108-109 の `.catch(() => {})` が console.warn すら出力しない完全握り潰し（R1からの持ち越し）
- **[R2 NEW]** notification.ts L97/99 の `== null` が抽象等価比較 → `=== undefined` に変更すべき
- **[R2 NEW]** (window as any).editor がmain.ts L77に残存（notification は修正済みだがeditorは放置）
- **[R2 NEW]** tab.ts L515 の reloadTableDataAsync catch も throw new Error パターン
- **[R2 NEW]** editor-table-handler.ts L701 refreshGitDiffAsync の catch に通知スキップの判断理由コメントなし
- **[R2 NEW]** 通知追加箇所の選定基準が不明確（「ノイズ防止」コメントありの箇所とコメントなしの箇所が混在）
- **PATTERN**: removeToast() が public だが呼び出し箇所なし（デッドコード）
- **PATTERN**: 同一メッセージ重複トースト防止なし（UXレビューでも指摘済み）

## determineDisplayColumnName 共通化リファクタ Known Patterns (2026-03-21)
- **CRITICAL**: `determineDisplayColumnName() ?? ''` が reference-data-cache.ts 2箇所でフォールバック禁止ルール違反（??演算子 14回目の再発）
- **CRITICAL**: fixtures config.json の referenceDisplayColumnPriority を ["ja"]→["ja","comment"] に変更。table テーブル（comment列あり）を使う3テストの振る舞いが暗黙変更
- **CRITICAL**: primaryKeyColumnName フィールドの無断削除がリファクタスコープを逸脱
- **IMPORTANT**: `(schema.header as Array<{name: string}>).map(h => h.name)` が reference-data-cache.ts 3箇所にコピペ新規発生
- **IMPORTANT**: form-panel.ts に ?? 演算子8箇所が既存のまま放置（FEAT_0043指摘からの持越し）
- **MINOR**: isDisplayColumn が1箇所からしか呼ばれていない（共通化の名目だがpublic export過剰）

## FormPanel Drilldown Navigation History Known Patterns (2026-03-21)
- **CRITICAL**: form-panel-open/drilldown の popstate で switchToExistingTab が呼ばれない → 別タブアクティブ中に goBack するとフォームが間違ったタブの右スロットに表示される（操作パスの網羅漏れ）
- **CRITICAL**: isRestoring() は getter 禁止ルール違反。pushFormPanelOpen 内部で restoring チェック済みのため showFormPanel 側のガードは不要。メソッド自体を削除可能
- **CRITICAL**: restoreNavStackAsync に空配列バリデーションなし → navStack=[] で TypeError（Array.isArray は空配列も true）
- **CRITICAL**: pushFormPanelDrillDown のコメント「ディープコピー」は虚偽。[...navStack] はシャローコピー（history.pushState の structured clone に救われているが将来誤導の原因）
- **IMPORTANT**: popstate ハンドラの restoring フラグが同期リセットだが showFormPanel/showFormPanelWithNavStack は非同期 → 連打でレースコンディション（FEAT_0047 既知パターン再発）
- **IMPORTANT**: _tabName パラメータ未使用 → タブ切り替え漏れの根本原因
- **IMPORTANT**: navStack 要素のプロパティ型バリデーションなし → structured clone 復元からの型安全性破壊
- **IMPORTANT**: パンくず history.go(delta) のクロージャが this.navStack.length を動的参照 → capturedDepth でキャプチャすべき
- **MINOR**: パンくずクリックのテストがない（goToPageAsync → history.go 完全置換後のテスト漏れ）

## Diff Tab Save Highlight Known Patterns (2026-03-21)
- **CRITICAL**: `refreshGitDiffForDiffTabAsync` に `refreshGitDiffRequestId` チェックなし → awaitポイント後のrequestIdチェック漏れ **4回目** の再発（FEAT_0038, FEAT_0040, 今回）
- **CRITICAL**: `refreshGitDiffAsync` と `refreshGitDiffForDiffTabAsync` のPK解決ロジック（L1752-1777 vs L1812-1834）が完全コピペ → `resolvePkColumnIndices()` に抽出すべき
- **CRITICAL**: `connectGitDiffTracker` のJSDocコメント「refreshGitDiffAsync内からのみ呼ばれる」が嘘（refreshGitDiffForDiffTabAsyncからも呼ばれる）
- **IMPORTANT**: `gitShowAsync` 失敗時の挙動が2メソッド間で非対称（通常: tracker=false, 差分タブ: createForNewTable）
- **IMPORTANT**: `catch { }` で例外変数を省略 → デバッグ情報消失
- **PATTERN**: テストフィクスチャの `__mockGitStatus/__mockGitHeadFiles` セットアップが15+ファイルでコピペ

## Review History
→ 詳細は `known-issues-archive.md` 参照
- (2026-03-21) Diff Tab Save Highlight: 致命的3件（requestIdチェック漏れ/PKロジックコピペ/コメント虚偽）、重要3件、軽微2件
- (2026-03-21) FormPanel Drilldown Navigation History: 致命的4件（タブ切替漏れ/getter禁止/空配列/コメント虚偽）、重要5件、軽微3件
- (2026-03-21) determineDisplayColumnName共通化リファクタ: 致命的3件（??新規導入/fixtures暗黙変更/スコープ逸脱）、重要3件、軽微3件
- (2026-03-21) NotificationToast エラー通知伝播 R2: 致命的3件（保存失敗通知漏れ持越し/catch握り潰し持越し/==null）、重要4件、軽微3件
- (2026-03-21) EditorAPI内部API層: 致命的5件（生焼け/emit未接続/insertRow境界/空配列クラッシュ/Bridge型バリデ皆無）、重要5件、軽微3件
- (2026-03-21) NotificationToast エラー通知伝播: 致命的3件（生焼けnotification/保存失敗通知漏れ/catch網羅漏れ）、重要4件、軽微3件
- (2026-03-21) ValidationPanel jumpToError リファクタ R2: 致命的1件（PK重複+タブ未開の制約）、重要3件（REDコメント残存/==null持越し/pkValueスナップショット）、軽微3件
- (2026-03-21) ValidationPanel jumpToError リファクタ: 致命的3件、重要4件、軽微3件
- (2026-03-20) config.primaryKeyColumnName廃止リファクタ: 致命的3件、重要4件、軽微3件
- (2026-03-20) ISSUE_0080 Dynamic Reference Validation: 致命的3件（validateSimpleReference未修正、??演算子、filterRowIndex=-1黙殺）、重要3件、軽微3件
- (2026-03-20) ResizeHandle consumedDelta 符号修正: 致命的1件（RelationsPanel浮動小数点ドリフト）、重要3件、軽微2件
- (2026-03-20) ResizeHandle共通化+PROBLEMSパネル縦リサイズ+StatusBar UI: 致命的2件、重要4件、軽微3件
- (2026-03-20) FEAT_0047 Navigation goBack/goForward R2: 致命的1件（ゾンビ RP 参照）、重要2件、軽微2件
- (2026-03-20) FEAT_0048 ValidationPanel R2: 致命的5件修正確認。新規: 重要2件（clearFocusedCell未呼び出し、CSS hardcoded）、軽微2件
- (2026-03-19) FEAT_0047 Navigation History: 致命的4件、重要3件、軽微3件
- (2026-03-19) FEAT_0045 Notification: 致命的3件、重要4件、軽微3件
- (2026-03-18) FEAT_0043 FormPanel: 致命的5件、重要5件、軽微3件
- (2026-03-18) FEAT_0042 HTML cell render: 致命的2件、重要3件、軽微2件
- (2026-03-18) FEAT_0040 search background: 致命的3件、重要4件、軽微3件
- (2026-03-17) FEAT_0038 fuzzy-search: 致命的4件、重要5件、軽微4件
- (2026-03-17) CommandPalette description表示: 致命的1件、重要3件、軽微2件
- (2026-03-17) FEAT_0036 R2: 致命的2件、重要1件、軽微2件
- (2026-03-16) FEAT_0028/diff-tab-resize: 詳細はreview-history.md参照
