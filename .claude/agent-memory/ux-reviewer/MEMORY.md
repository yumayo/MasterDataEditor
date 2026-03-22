# ux-reviewer メモリ

## プロジェクト: App.MasterDataEditor

### UXレビュー実績アーカイブ
- ファイル: project_review_archive_mar2026.md
- 2026-03-15〜23 全レビューの要約と横断的継続課題リストを収録
- ISSUE_0112まで含む最新版

### このプロジェクトの評価軸メモ
- 核心機能 = 外部キー参照の苦痛解消（定義ジャンプ、RelationsPanel）
- 差別化機能が壊れている場合は問答無用で評価下げ
- 状態の永続性（タブ切替をまたいだ状態保存）はユーザーの当然の期待
- 特殊タブ（差分タブ・設定タブ）は `tabStates` に登録されない → DOMクリーンアップは独自に行う必要あり
- `show/hide` や `activate/deactivate` の対称性チェックが繰り返し指摘されている（bug-report #3, #32, #77, #84）
- ミニテーブルの設計原則: ストアの全行を保持し、表示のみFKフィルタリング（storeRowIndicesのサブセット管理はしない）

### 最新レビュー結果（2026-03-23）

#### ISSUE_0113 SOURCE CONTROLパネルstage/discard/unstageボタン 評価: B+
- 修正済み: changesセクションにstage(+)/discard(←矢印)ボタン、stagedセクションにunstage(-)/discard(←矢印)ボタン表示確認
- 修正済み: stage→STAGED移動・unstage→CHANGES移動・changesのdiscard→CHANGES消去の各操作動作確認
- 残存(🔴): discardボタンに確認ダイアログなし（git checkoutは取り消し不可能な破壊的操作）
- 残存(🔴): source-control-action-btn に role="button"/aria-label/title がない（SVGのみ）
- 残存(🟡): キーボード操作でのボタンアクセス手段なし（ホバー表示のみ）
- 残存(🟡): stagedのdiscardアイコンがchangesと同一（左矢印）でunstageと混同しやすい
- 残存(🟡): activity-bar-badge がdiscard後も "2" のまま（ファイル数バッジ未更新）

#### ISSUE_0112 FKデフォルト値スキップ 評価: A
- 修正済み: category_id=0（int型デフォルト）を入力してもcell-errorなし・PROBLEMSパネル「エラーはありません」・status-bar data-error-count="0" を確認
- 修正済み: category_id を空（""）にしてもエラーなし（空文字列もデフォルトとして扱われている可能性あり）
- 修正済み: default=999 を明示設定したFK列で999入力時もエラーなし。それ以外の888入力でcell-errorクラス付与・FK切れエラー正確表示を確認
- 修正済み: 動的参照FK列（reward_record_id、FK式: $(table.id == $reward_table_id).master.id）でも0入力時はエラーなし
- 残存(🟡): デフォルト値スキップが適用されていることをプランナーが視覚的に認識できる手段がない。FK列ヘッダーのtitle属性に「FK: category.id を参照（デフォルト:0はスキップ）」のような補足があると誤入力を防止できる
- 残存(🟡): cell-error セルに aria-invalid="true"/aria-describedby がない（全サイクル継続）
- 残存(🟡): ミニテーブルの fill-handle が editor-table--inactive でも display:block で残存（継続）
- 残存(🟡): ミニテーブルの row-resize-handle が残存（継続）

#### ISSUE_0111 全文検索ローマ字途中入力・長音符正規化 評価: A
- 修正済み: `findNormalizedMatchIndex` に末尾子音除去ロジック追加（`isTrailingConsonant` + trim）
- 修正済み: `normalizeInternal` で長音符ー(U+30FC)・全角ハイフン－(U+FF0D)→半角ハイフン-（caseSensitiveにも適用）
- 残存(🟡): `fuzzy-search.spec.ts` のテストがUIを起動しないため autoDump が空白ページ記録のみ。ハイライト表示のE2E確認が取れていない
- 残存(🟡): `computeMatchLength` の末尾子音除去マッチ時のハイライト長算出（`trimmed.length`）は正しいが、ローマ字変換後の「あい」と元文字列の「あい」が1:1対応している前提。全角変換後に文字数が変わる場合（拗音など）は要注意
- 残存(🟡): `matchesQuery` の wholeWord+caseSensitive=false ブロック内でローマ字変換は行われるが、長音符正規化後の完全一致は機能しない（仕様上正しい挙動だが、「ー」単独でwholeWord検索できないことはプランナーに説明不要なツールチップで補足したい）

#### ISSUE_0107 差分ビューバリデーション 評価: B
- 修正済み: diff-cell-added cell-error の複合クラス正確付与・誤検出ゼロ確認
- 残存(🔴): PROBLEMSパネルが data-error-count="0"・「エラーはありません」で矛盾。DiffTab未接続の疑い
- 残存(🔴): cell-error セルに aria-invalid="true"/aria-describedby がない（全サイクル継続）
- 残存(🔴): 左ペイン grid-textfield に contenteditable="true" が残存

#### ISSUE_0105 DiffTabカンマ含有フィールド誤検出修正 評価: A
- 修正済み: diff-rows.ts を RFC4180準拠 Csv.load() に置換・誤検出ゼロ確認
- 修正済み: DropdownQuickView の createMiniEditorTable から refreshGitDiffAsync() 削除

#### ISSUE_0108 差分ビュー再表示時最新データ反映 評価: A
- 修正済み: 2回目の差分タブ表示で最新データ（value=250）が正確に反映されることを確認
- 残存(🔴): 再作成方式によりスクロール位置がリセットされる。数百行のテーブルで作業効率低下リスク。再作成前のscrollLeft/scrollTop保存・復元（ISSUE_0092方式の流用）を推奨
- 残存(🔴): 左ペイン contenteditable="true" 継続未対処（2026-03-21から）
- 残存(🔴): 左ペイン editor-table に aria-readonly="true" がない（BUG_0021から継続）
- bug-report.md #175 として「DiffTab再作成時はスクロール位置・Selection状態の保存復元が必要」の記録推奨

### 横断的な継続課題（最新）
- インタラクティブな div/span 要素に role="button"/tabindex がない（activity-bar-item, notification-bell, relations-panel-open-tab ほか）
- SVG に aria-hidden="true" がない（filter-icon, sort-icon, activity-bar SVG）
- 差分ビュー左ペインに aria-readonly がない（BUG_0021から継続）・contenteditable="true" 残存
- row-resize-handle がミニテーブル・バッファ行・差分削除行に残存
- コンテキストメニューが操作後に残存（hide()漏れ、bug-report #8/#65）
- cell-error セルに aria-invalid="true"/aria-describedby がない（ISSUE_0080から全サイクル継続）
- validation-panel-group-header に role/aria-label なし（全サイクル継続）
- 列ヘッダーに型情報バッジがない（型バリデーション機能追加に伴う新規課題）
- show/hide 非対称パターン（style.display='' での表示復元）が再発（open-tab）— bug-report #3/#32/#77/#84
- diff-resize-handle に role="separator"/aria-orientation/aria-label がない
- fill-handle が読み取り専用ペイン（差分左ペイン・ミニテーブル inactive）に display:block で残存
