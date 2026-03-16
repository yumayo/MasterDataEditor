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
- **awaitポイント後のrequestIdチェック**: 全awaitポイントでrequestIdチェック必須 (FEAT_0038で未適用)
- **CSS hardcoded colors**: 8回再発 — CSS変数使用を徹底せよ
- **CSS class defined in JS but missing in CSS**: search-result-pk がTSで使用されCSSに未定義 (FEAT_0038)
- **fuzzyMatch/fuzzyMatchHighlight重複実装**: マッチングロジックが2箇所に存在、片方の修正漏れリスク
- **参照式の独自パース**: parseReferenceExpression を使わずdotIndex手動パース (search-panel.ts)
- **フォールバック禁止**: `??` 演算子はCLAUDE.mdで禁止。filter-dropdown.ts L261/264/370で違反
- **document listener leak on re-instantiation**: 無名リスナーはremoveEventListener不可
- **previewCache key must include tableName**: itemIdのみのキーは複数テーブル跨ぎで汚染される
- **Factory method must complete ALL setup**: 参照ヒント+ドロップダウン設定を外部に出さない

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

## Review History
→ 詳細は `review-history.md` 参照
- (2026-03-17) FEAT_0038 fuzzy-search: 致命的4件、重要5件、軽微4件
- (2026-03-17) CommandPalette description表示: 致命的1件、重要3件、軽微2件
- (2026-03-17) FEAT_0036 R2: 致命的2件、重要1件、軽微2件
- (2026-03-16) FEAT_0028/diff-tab-resize: 詳細はreview-history.md参照
