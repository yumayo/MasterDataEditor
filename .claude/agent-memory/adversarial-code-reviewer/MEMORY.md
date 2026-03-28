# Adversarial Code Reviewer Memory

## Project Architecture
- Frontend: Vanilla TypeScript (no framework), DOM is SSOT
- Backend: C#
- Design: Intentionally tightly coupled, Command pattern for Undo/Redo
- WebView2 (Microsoft browser control) used for frontend hosting

## C# Security Patterns
-> See `csharp-security-patterns.md`

## Key Files
- `/WebView/src/editor-table.ts` - Core table + storeRowIndices
- `/WebView/src/tab.ts` - Tab management, EditorTable factory, pane stack, special tabs (settings/diff/ER diagram)
- `/WebView/src/bookmark-panel.ts` - Bookmark panel (cell-level bookmarks, persistence to bookmarks.json)
- `/WebView/src/command-palette.ts` - Command palette (table fuzzy search, query式, @bookmark prefix)
- `/WebView/src/er-diagram-tab.ts` - ER diagram SVG tab (schema→node/edge→SVG)
- `/WebView/src/er-diagram-layout.ts` - Grid layout for ER diagram nodes
- `/WebView/src/in-memory-table-store.ts` - Central data store + refCount + Dirty management
- `/WebView/src/validation-engine.ts` - PK/FK/type validation logic
- `/WebView/src/validation-panel.ts` - Validation UI + runAndUpdate + runInitialScanAsync
- `/WebView/src/editor-api-types.ts` - SchemaEntry, EditorAPI types
- `/WebView/src/editor-api.ts` - EditorAPI impl (data/schema/edit/events namespaces)
- `/WebView/src/relations-panel.ts` - Right pane relations
- `/WebView/src/reference-data-cache.ts` - FK reference cache
- `/WebView/src/plugin-validation-runner.ts` - Plugin validation (Web Worker sandbox)
- `/WebView/src/reference-expression.ts` - DynamicReferenceSchema + parseReferenceExpression
- `/WebView/src/model/editor-table-data-column.ts` - Column model with reference: string | DynamicReferenceSchema | null
- `/WebView/src/editor-table-handler.ts` - Keyboard/mouse handler, markSavedAndUpdatePanel

## Recurring Review Patterns (Top Priority)
- **awaitポイント後のrequestIdチェック**: **10回再発** (+showBlameAsync requestIdガードなし)
- **register/unregister 非対称**: **5回再発** (+TableDefinitionEditor destroy()未実装、indicator永続残留)
- **CSS hardcoded colors**: 21+ 回再発 (+table-definition-editor #f44336, #ffffff)
- **CSS/JS定数の二重管理→乖離**: constant.ts REFERENCE_HINT_MARGIN_PX vs CSS margin-right変更で列幅計算破壊, **--selected-color未定義(22箇所)**, **--list-hover-bg未定義(timeline-panel.css)**, **--z-dialog未定義(commit-selector-dialog.css)**, **未定義CSS変数12箇所+フォールバック値乱用(commit-selector-dialog.css)**
- **フォールバック禁止 (?? / ||)**: 22+ 回再発 (+applyOriginalSchemaToRow dynRef 5箇所)
- **生焼けオブジェクト | false + connect パターン**: 8回再発 (+ErDiagramTab tables/edges empty arrays)
- **undefined比較 (Map.get)**: api.ts gitShowCache.get() !== undefined
- **fire-and-forget Promise without .catch()**: 複数箇所 (+renderQueryResultsAsync in command-palette, +showBlameAsync in context-menu)
- **document listener leak (anonymous arrow)**: removeEventListener不可 (+ErDiagramTab mousemove/mouseup)
- **コピペコード**: SchemaEntry→TableSchema変換, parseCsv, PK解決, **PluginError変換**, **refreshGitDiffAsync .catch(4箇所)**, int/floatインクリメント処理, **ブックマーク追加メニュー(PK列/非PK列の同一コード)**, **table-definition-editor.ts saveEditModeAsync内のCSV split(',')がcsv.tsのRFC4180パーサと重複かつ機能不足**, **ハッシュ7桁切り詰めロジック(tab.ts formatCommitDisplay + commit-selector-dialog.ts buildCommitList)**
- **操作パスの網羅漏れ(型別入力)**: bool型セルでSpace/dblclickはガードされるが文字入力(^\w$)経路がブロックされていない
- **操作パスの網羅漏れ(DOM属性復元)**: data-bookmarked属性がソート/行操作/reloadCellsFromStore/Undo/moveRowで消失, **blame-info要素が同じ全操作で消失**
- **操作パスの網羅漏れ(moveRow後処理)**: moveRowにevictOwnReferenceDataCache/refreshFilterDisplayIfActive/restoreBookmarkMarks欠落
- **public API漏出→呼び出しパターン拡散**: applyTypedCellStyle が public で createCell/setCellValue の2箇所から個別呼出, **sidebar が readonly(public)に格上げ**
- **CSSセレクタインジェクション(新パターン)**: querySelector に data属性値を直接結合→特殊文字でクエリ破壊
- **PK値変更によるブックマーク永続データ不整合(新パターン)**: PK編集後にbookmarks.json/DOM属性が陳腐化
- **try/catch なし async**: searching/loading状態が永続固着するパターン
- **同期メソッド内の.then()非同期化**: runAndUpdate()内で.then()使用+requestIDガードなし
- **型定義の変更波及漏れ**: reference型変更時にrelations-panel, search-data-provider等の型アサーションが未更新
- **C# MCP出力のエッジケース未対応**: rowIndex=-1時のフォーマット崩壊 (ValidationTool.cs)
- **MCP保存パスの後処理不足**: markSavedAndUpdatePanel相当の処理がMCPパスに未実装 (2026-03-26)

## MCP Save Path vs Normal Save Path (2026-03-26)
-> See `mcp-save-path-analysis.md`
- markSavedAndUpdatePanel (normal): markAllSaved + updateDirtyMark + refreshGitDiffAsync + emitTableSaved
- MCP saveTableAsync: markAllSaved + refreshGitDiffAsync only (missing updateDirtyMark, saveSchemaDataAsync)
- Tab-closed case: dirtyTableNames not cleared after MCP save
- Mini EditorTable git diff not updated (emitTableSaved goes to handlers only, not Tab)

## DynamicReferenceSchema Migration Patterns (2026-03-25, updated 2026-03-27)
- reference型は `string | DynamicReferenceSchema | null` に統一済み
- **destColumn動的解決 (2026-03-27)**: destColumnも動的解決に変更。セマンティクスが「列名そのもの」→「列名を格納するカラム名」に変化
- **FormPanel逆参照が動的参照で完全に壊れている**: form-panel.ts L237でpkValueのみでルックアップ+L248でchildColumnName=''のフィルタ失敗（2回目レビューで再指摘）
- **RP2パス(resolveEntriesForTableRowAsync)**: L1079-1080でparentPkColumnNameのみでフィルタ→動的参照の逆参照が一切表示されない
- **editor-table-reference.ts updateDynamicReferenceHint**: targetColumn動的解決を実装済み（3rd review）。ただし非PK列参照パスのテスト未検証、PK/非PK表示テキスト解決の非対称性あり
- **未更新箇所**: FKバッジのツールチップ(editor-table-structure.ts L620)がdestColumn間接参照の意味を反映していない
- **main.ts起動バリデーション**: createSchemaEntryFromJson が動的参照をスキップ→起動時FKバリデーション漏れ（**依然未修正**）
- **EditorAPI**: getReferences/getRelatedTablesAsync が動的参照列を完全に無視（SchemaEntry.references由来のため）
- **serialize() roundtrip**: reference: null がJSONに出力され元スキーマを汚染
- reference-data-cache.ts: Record<string, unknown>→as DynamicReferenceSchemaキャスト (型安全性不足)
- search-data-provider.ts: 動的参照→空文字列変換が2箇所でコピペ

## Plugin Validation Known Patterns (2026-03-25)
- Plugin runs in Web Worker sandbox (plugin-sandbox.ts) — no window/document access
- runAndUpdate() sync→async via .then() without requestId guard (9th recurrence)
- pluginRunner = false + connectPluginRunner() is half-baked object (7th recurrence)
- Proxy get handler typed as string but prop can be symbol
- No infinite loop protection for plugin code (timeout 10s via Worker terminate)
- buildRowObjects has no caching — O(n) per all()/where()/find() call per plugin
- **convertPluginErrors duplicated**: editor-api.ts L209-233 vs validation-panel.ts L307-340 (value field diverged)
- **editor-api.ts plugin error conversion has no try/catch**: engine results lost on runAllPluginsAsync rejection

## Structural Concerns
- **store.getHeader/getRows returns internal reference**: caller mutation corrupts store
- **Csv class**: half-baked object pattern (10+ instances)
- **GridDropdownInput.element is public HTMLElement**: legacy debt
- **SchemaEntry.references omits dynamic refs**: createSchemaEntryFromJson only handles string references

## CSS Variables
- Defined: --font-color, --background-color, --background-sub-color, --border-color, --selection-color, --selection-font-color, --scroll-bar-background-color, --focus-border, --error-color, --error-bg, --error-border
- NOT defined: --warning-color, --warning-bg, --warning-border (needed for plugin errors)
- NOT defined: --text-muted-color (used in .cell-reference-hint, .cell-reverse-reference-hint, grid-dropdown-input with fallback #888)
- NOT defined: **--selected-color** (table-definition-editor.css 10箇所 + settings-panel.css 1箇所で使用。正しくは --selection-color)
- NOT defined: **--list-hover-bg** (timeline-panel.css 1箇所。正しくは --hover-color)
- NOT defined: **--z-dialog** (commit-selector-dialog.css 1箇所。z-index.cssに未登録、フォールバック1000)
- NOT defined: **--editor-background, --foreground-color, --tab-background, --list-hover-background, --list-active-selection-background, --description-foreground, --button-background, --button-hover-background** (commit-selector-dialog.css 12箇所。プロジェクト定義済み変数を使うべき)

## ER Diagram Tab Patterns (2026-03-28)
- tab.ts 特殊タブ分岐(settings/diff/ER): 条件分岐が4種(通常/設定/差分/ER)に増殖、leaveSettingsMode漏れリスク高
- ErDiagramTab: document listener leak (mousemove/mouseup), 生焼けオブジェクト(tables/edges空), fire-and-forget buildAsync
- activateErDiagramTab: 設定タブ→ER図遷移時のleaveSettingsMode欠落
- performCloseTab ER図パス: activeTabName=false 未設定
- CSS全色ハードコード、SVGにviewBox未設定(pan/zoom不可)
- エッジY座標マジックナンバー(40)が3箇所コピペ

## Search-Replace Known Patterns (2026-03-28)
- replaceWithQuery が wholeWord を完全無視 — matchesQuery との非対称性（致命的）
- replaceAllMatches: 複数テーブル変更を最初のテーブルのhistoryにのみ登録 → 2番目以降のテーブルでUndoが壊れる
- SearchResult.columnIndex はCSV列インデックス — ColumnSorter適用後のDOMとズレてデータ破壊
- currentResults はスナップショット — Undo後に陳腐化、splice済みの結果でインデックスがズレる
- saveActiveTableAsync: 同期メソッドなのにAsync命名（命名規則違反）
- findDomRowByPkValue: PK空文字列時に全行が同一行にマッチ

## Typed Input Control Patterns (2026-03-28)
- bool型セル: SVG表示 + data-rawValue でgetCellValueと整合。ただし文字入力経路がブロックされていない（致命的）
- int/float/double: ArrowUp/Down インクリメント（editMode中のみ）。Undo未記録（submitTextで一括確定）
- float精度問題: parseFloat+1→String でIEEE 754精度劣化。toFixed等で桁数保持が必要
- 数値入力フィルタ: keydown で isAllowedNumericKey。ただしIME composing中はスキップ
- applyTypedCellStyle: public で createCell + setCellValue の2経路から呼出（パターン拡散リスク）
- **ISSUE_0127**: FK列にcell-numericクラスを適用する変更。setCellValueの参照列パスでapplyTypedCellStyleが呼ばれない（createCellのみ）→暗黙的依存
- **ISSUE_0127**: appendReferenceHint→prepend実装だが名称未変更、float:left+table-cellの脆さ、max-width 2emマジックナンバー

## Bookmark Feature Patterns (2026-03-28)
- bookmark-panel.ts: DOMがSSOT、data-*属性でエントリ情報保持、永続化はbookmarks.json
- CSSセレクタインジェクション: querySelector に data属性値を直接結合（致命的）
- data-bookmarked属性: createCell/reloadCellsFromStore/ソート/行操作で復元なし（致命的）
- PK値変更: bookmarks.json/DOM data-pk-valueが陳腐化（致命的）
- sidebar: private→readonly(public)に変更、EditorTableHandler経由のチェーンコール発生
- PK列右クリック: 追加=1列、削除=全列の非対称性
- renderQueryResultsAsync: fire-and-forget呼出し（.catch無し）
- コンテキストメニュー: PK列/非PK列で追加メニューコード完全コピペ

## Row Drag Controller Patterns (2026-03-28)
- moveRow: 後処理がinsertRowInternal/deleteRowと比較して圧倒的に不足（キャッシュ無効化、フィルター更新、ブックマーク復元なし）
- **ソート中のmoveRow**: storeRowIndicesを[0,1,2,...]にリセット→DOMのセル内容はソート順のまま→データ不整合（致命的）
- **ミニテーブル/差分タブガードなし**: moveRow/onRowHeaderMouseDownに特殊コンテキストのガードが一切ない
- destroy()でdocumentリスナー未解除（register/unregister非対称4回目）
- stopImmediatePropagation依存: イベントリスナー登録順序への暗黙的契約
- **操作パスの網羅漏れ(moveRow)**: insertRow系では7-8種の後処理、moveRowでは4種のみ（bug-report.md #7の再発）
- **新規操作パス追加時の後処理チェックリスト**: evictOwnReferenceDataCache, refreshFilterDisplayIfActive, restoreBookmarkMarks, ensureTrailingBufferRow, **restoreBlameIfVisible** が漏れやすい

## Table Definition Editor Patterns (2026-03-28, updated ISSUE_0129)
- **destroy()未実装**: indicator要素がdocument.bodyに永続残留、ErDiagramTabにはdestroy()があるのに未踏襲
- **Redo未実装**: undoStackのみ、redoStack/Ctrl+Yなし。docコメント「Undo/Redo対応」が虚偽
- **列削除後のUndoスタック陳腐化**: row.remove()がundoStackを無視→境界外アクセス
- **lastIndicatorClientY初期値0**: ドラッグ閾値超え直後のmouseupでinsertIndex=0に飛ぶ
- **dragSourceRowダミー要素**: nullの代わりにdocument.createElement('div')で生焼け回避
- **updateIndicatorPosition/calculateInsertIndex**: insertIndex計算ロジック完全コピペ
- tab.ts: 特殊タブ分岐が5種(通常/設定/差分/ER/定義)に増殖
- **ISSUE_0129 CSVパーサ不一致(致命的)**: saveEditModeAsync内で split(',') を使用→csv.ts RFC4180準拠パーサと不一致→カンマ含むデータ破壊
- **ISSUE_0129 テーブルリネーム時ゴーストファイル(致命的)**: 旧schema/csv未削除、エクスプローラー未更新、nameInput readOnly未設定
- **ISSUE_0129 スキーマフィールド消失(致命的)**: references/default等の既存フィールドが保存時に丸ごと消える
- **ISSUE_0129 pendingEditTarget生焼け**: メンバ変数を一時的な引数受け渡し場所として使用するアンチパターン
- **ISSUE_0129 バリデーション/キャッシュ未更新**: closeTableDefinitionAndReopenTable後にvalidationPanel/referenceDataCache無効化なし
- **全スキーマプロパティUI(2026-03-29)**: reverseReferencePriority読み込み欠落(致命的), default値の型不一致(致命的), 動的参照バリデーション無し(致命的), width/rrp数値バリデーション無し, 単純参照形式バリデーション無し, CSSコピペ6箇所, --selected-color未定義6箇所追加

## Version Compare (ISSUE_0123) Patterns (2026-03-29)
- commit-selector-dialog.ts: コールバック疎結合(onCompare)、ダイアログ多重オープン防止なし、MutationObserverで過剰監視
- --z-dialog CSS変数未定義(z-index.css未登録)→コマンドパレット等にダイアログが隠れる
- 同一コミット比較の入力バリデーション欠如
- fetchCsvAtCommitAsync: ファイル不存在時にPromise reject→UIフィードバック無し
- 現在のスキーマJSONで古いCSVをパース→列構成不整合で差分表示破壊
- dataset.commit as string 型アサーション(undefined無視)
- DiffTab コンストラクタ18引数(leftLabel/rightLabel追加で膨張)

## Review History
-> See `known-issues-archive.md` for details
- (2026-03-29) ISSUE_0123 バージョン比較: 致命的3件、重要5件、軽微4件 (z-index未定義ダイアログ隠れ, 同一コミット比較無検証, fetchCsvエラー握りつぶし, コールバック疎結合, CSSフォールバック12箇所, ダイアログ多重オープン, 型アサーション, スキーマ不整合)
- (2026-03-29) ISSUE_0120 タイムライン・blame: 致命的3件、重要5件、軽微4件 (blame操作パス網羅漏れ, fire-and-forget showBlameAsync, requestIdガードなし, --list-hover-bg未定義, タブ切替時ログ未更新, lineNumberマッピングoff-by-one疑い)
- (2026-03-29) 全スキーマプロパティUI: 致命的3件、重要5件、軽微4件 (rrp読込欠落, default型不一致, 動的参照バリデーション無し, フォールバック||5箇所, width/rrp数値検証無し, 参照形式検証無し, CSSコピペ6箇所, --selected-color未定義)
- (2026-03-28) ISSUE_0129 既存テーブル定義編集: 致命的3件、重要5件、軽微4件 (CSVパーサ不一致データ破壊, リネーム時ゴーストファイル, スキーマフィールド消失, pendingEditTarget生焼け, CRLF, バリデーション/キャッシュ未更新)
- (2026-03-28) ISSUE_0128 列ドラッグ並び替え: 致命的3件、重要5件、軽微4件 (indicatorリーク, Redo未実装, 列削除後Undo破壊, ドラッグキャンセル未対応, lastIndicatorClientY初期値)
- (2026-03-28) ISSUE_0127 FK列int値右揃え・ヒント左配置: 致命的2件、重要4件、軽微3件 (constant.ts列幅計算破壊, float:leftレイアウト脆弱性, CSSコメント不整合, applyTypedCellStyleパス漏れ, appendReferenceHint命名)
- (2026-03-28) ISSUE_0126 行ドラッグ移動: 致命的3件、重要6件、軽微3件 (ソート中データ破壊, ミニテーブルガード欠落, moveRow後処理不足, destroyリスナー漏れ)
- (2026-03-28) ISSUE_0125 セルブックマーク: 致命的3件、重要6件、軽微3件 (CSSセレクタインジェクション, DOM属性復元漏れ, PK値不整合, sidebar公開, 型安全性, 入力検証, コピペ)
- (2026-03-28) Typed Input Control: 致命的2件、重要5件、軽微3件 (bool文字入力漏れ, float精度破壊, Undo未記録, publicメソッド漏出)
- (2026-03-28) Search Replace: 致命的2件、重要5件、軽微3件 (wholeWord無視, 複数テーブルUndo破壊, 列ソート非対応)
- (2026-03-28) ER Diagram Tab: 致命的2件、重要5件、軽微3件 (document listener leak, 生焼け, leaveSettingsMode欠落, parseSchemaクラッシュ)
- (2026-03-27) destColumn動的解決 3rd review (参照ヒント実装): 致命的2件、重要3件、軽微3件 (サンプルデータ破壊、非PK列テスト欠落、PK/非PK非対称性)
- (2026-03-27) destColumn動的解決 2nd review: 致命的2件、重要5件、軽微3件 (FormPanel/RP2パス未対応、参照ヒント未対応)
- (2026-03-27) destColumn動的解決: 致命的2件、重要5件、軽微3件
- (2026-03-26) MCP Save Git Diff: 致命的2件、重要2件、軽微3件
- (2026-03-25) EditorAPI getValidationErrorsAsync + Plugin: 致命的2件、重要4件、軽微3件
- (2026-03-25) DynamicReferenceSchema Migration: 致命的2件、重要4件、軽微3件
- (2026-03-25) Plugin Validation: 致命的4件、重要5件、軽微4件
- (2026-03-24) RP Visibility Toggle: 致命的3件、重要4件、軽微3件
- (2026-03-24) Initial Scan: 致命的4件、重要4件、軽微2件
- (2026-03-21) Diff Tab Save Highlight, FormPanel Drilldown, etc.
- (2026-03-20) ResizeHandle, ISSUE_0080, config refactor, FEAT_0047/0048
- (2026-03-19) FEAT_0047 Navigation, FEAT_0045 Notification
- (2026-03-18) FEAT_0043 FormPanel, FEAT_0042 HTML render, FEAT_0040 search
- (2026-03-17) FEAT_0038 fuzzy-search, FEAT_0036 resize
