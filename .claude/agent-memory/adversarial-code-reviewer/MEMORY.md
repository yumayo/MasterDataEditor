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
- `/WebView/src/fuzzy-search.ts` - ローマ字変換・正規化・ファジーマッチング (FEAT_0038)
- `/WebView/src/search-query.ts` - 検索クエリパース・matchesQuery (FEAT_0038)
- `/WebView/src/search-panel.ts` - 全文検索パネル (FEAT_0038)

## CSS Variables (index.css)
- Defined: `--font-color`, `--background-color`, `--background-sub-color`, `--border-color`, `--selection-color`, `--selection-font-color`, `--scroll-bar-background-color`, `--focus-border` (#007acc, ライトテーマのみ)
- NOT defined in dark theme: `--focus-border` (`:root`の値を引き継ぐが明示再定義なし)
- NOT defined: `--selected-color`, `--tab-background`, `--list-hover-background`, `--text-muted-color`, `--text-color-secondary`, `--cell-background-color`
- CSS hardcoded colors: 8+ occurrences across FEATs (recurring pattern, FEAT_0038でも再発)

## Recurring Review Patterns
- **Operation path coverage gap**: ALL paths must be secured when adding new features
- **awaitポイント後のrequestIdチェック**: 全awaitポイントでrequestIdチェック必須 (FEAT_0038, FEAT_0040で再発。新しいawaitを追加するたびに漏れる)
- **CSS hardcoded colors**: 10回再発 — CSS変数使用を徹底せよ (FEAT_0045: notification.css に #c0392b/#ffffff 等 8箇所ハードコード)
- **CSS class defined in JS but missing in CSS**: search-result-pk がTSで使用されCSSに未定義 (FEAT_0038)
- **fuzzyMatch/fuzzyMatchHighlight重複実装**: マッチングロジックが2箇所に存在、片方の修正漏れリスク
- **参照式の独自パース**: parseReferenceExpression を使わずdotIndex手動パース (search-panel.ts)
- **フォールバック禁止**: `??` 演算子はCLAUDE.mdで禁止。filter-dropdown.ts L261/264/370で違反
- **document listener leak on re-instantiation**: 無名リスナーはremoveEventListener不可
- **previewCache key must include tableName**: itemIdのみのキーは複数テーブル跨ぎで汚染される
- **Factory method must complete ALL setup**: 参照ヒント+ドロップダウン設定を外部に出さない

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

## Review History
→ 詳細は `review-history.md` 参照
- (2026-03-19) FEAT_0045 Notification: 致命的3件、重要4件、軽微3件
- (2026-03-18) FEAT_0043 FormPanel: 致命的5件、重要5件、軽微3件
- (2026-03-18) FEAT_0042 HTML cell render: 致命的2件、重要3件、軽微2件
- (2026-03-18) FEAT_0040 search background: 致命的3件、重要4件、軽微3件
- (2026-03-17) FEAT_0038 fuzzy-search: 致命的4件、重要5件、軽微4件
- (2026-03-17) CommandPalette description表示: 致命的1件、重要3件、軽微2件
- (2026-03-17) FEAT_0036 R2: 致命的2件、重要1件、軽微2件
- (2026-03-16) FEAT_0028/diff-tab-resize: 詳細はreview-history.md参照
