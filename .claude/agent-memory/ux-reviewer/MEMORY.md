# ux-reviewer メモリ

## プロジェクト: App.MasterDataEditor

### UXレビュー実績アーカイブ
- ファイル: project_review_archive_mar2026.md
- 2026-03-15〜23 全レビューの要約と横断的継続課題リストを収録
- ISSUE_0108まで含む最新版

### このプロジェクトの評価軸メモ
- 核心機能 = 外部キー参照の苦痛解消（定義ジャンプ、RelationsPanel）
- 差別化機能が壊れている場合は問答無用で評価下げ
- 状態の永続性（タブ切替をまたいだ状態保存）はユーザーの当然の期待
- 特殊タブ（差分タブ・設定タブ）は `tabStates` に登録されない → DOMクリーンアップは独自に行う必要あり
- `show/hide` や `activate/deactivate` の対称性チェックが繰り返し指摘されている（bug-report #3, #32, #77, #84）
- ミニテーブルの設計原則: ストアの全行を保持し、表示のみFKフィルタリング（storeRowIndicesのサブセット管理はしない）

### 最新レビュー結果（2026-03-23）

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
