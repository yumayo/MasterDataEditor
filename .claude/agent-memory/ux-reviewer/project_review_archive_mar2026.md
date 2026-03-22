---
name: UXレビュー実績アーカイブ（2026-03-15〜23）
description: 2026-03-15〜23に実施したUXレビューの要約。継続課題の追跡用。
type: project
---

## 修正済み（過去の指摘）

- **RelationsPanel タブ切替時リセット**: bug-report.md #73で記録・修正済み
- **ミニテーブル行操作によるメインテーブルデータ破損**: bug-report.md #80で記録・修正済み

## 2026-03-15 レビュー

- **差分タブ重複開き防止**: 評価 A。project_diff_tab_dedup.md 参照
- **差分ビュー右ペインFKドロップダウン追加**: 評価 A-。project_diff_tab_dropdown.md 参照。console.log 残存・左ペイン aria-readonly 欠如

## 2026-03-16 レビュー

- **BUG_0021 非連番keyスキーマ**: 評価 A。project_bug0021_non_sequential_key.md 参照
- **BUG_0022 差分ビューパディング行高さ**: 評価 B（ラウンド2対応確認済み）。project_bug0022_padding_row_height.md 参照。削除パディング行クラスの非対称継続
- **ヘッダーアイコン領域確保 FEAT_0023**: 評価 A。has-badge padding と calculateColumnWidth の乖離要注意
- **差分ビューペインリサイズハンドル**: 評価 A。ハンドル視覚的不可視が残課題
- **フィルターアイコンSVG化 FEAT_0026**: 評価 A。aria-hidden欠如継続
- **SourceControlPanel FEAT_0028**: 評価 B+。STAGEDアイテムの explorer-file-description 欠如(🔴)継続
- **FEAT_0024 ライトテーマ色**: 修正済み（FEAT_commandpalette_descriptionレビューで解消確認）

## 2026-03-17 レビュー

- **FEAT_0025 通常テーブル末尾バッファ行**: 評価 A（ラウンド2）。project_feat0025_buffer_row.md 参照
- **FEAT_0027 クイックビュー改修**: 評価 A（CSS改修ラウンド2含む）。project_feat0027_quick_view_mini_editor.md 参照。editor-table--inactive 追加済み
- **N:1ミニテーブルコンテキストヒント**: 評価 A。project_n1_context_hint.md 参照
- **BUG_0025 差分ビュー行挿入後左ペイン行番号**: 評価 B+。row-resize-handle 残存(🔴)・コンテキストメニュー残存(🔴)継続
- **BUG_0023 差分ビューパディング行保存・Dirty**: 評価 A-。data-row衝突(🔴)・コンテキストメニュー残存(🔴)継続
- **マウスクリック/Shift+クリック 自動スクロール**: 評価 A-。project_scroll_position_autoscroll.md 参照
- **FEAT_0032 tab-list height:100%**: 評価 A。role="tab"/aria-selected欠如継続
- **FEAT_0033 フィルター・ソートアイコン調整**: 評価 A。aria属性欠如継続
- **FEAT_0035 フィルター機能改修**: 評価 A-。project_feat0035_filter_improvements.md 参照
- **FEAT_0036 列幅自動調整**: 評価 A。project_feat0036_column_resize_autofit.md 参照
- **FEAT_0034 アクティビティバー調整**: 評価 A-。div要素に role="button"欠如(🔴)継続
- **コマンドパレット description表示・角直角化**: 評価 A。project_command_palette_description.md 参照

## 2026-03-19〜22 レビュー（詳細はMEMORY.mdの各セクション参照）

- **FEAT_0045/ISSUE_0079 通知UI**: 評価 C→B→B。残存: トースト縦書き・履歴パネル閉じる手段なし・重複トースト
- **FEAT バリデーションパネル/ResizeHandle**: 評価 B→A→A→A→A-。残存: cell-error aria-invalid欠如・group-header aria欠如
- **ISSUE_0080 動的参照バリデーション**: 評価 B+。残存: cell-error aria-invalid欠如・FK badge title 内部式露出
- **BUG_0026 クイックビュー位置調整**: 評価 B+。残存: max-width/overflow-y アサート・relations-table-context欠如
- **ISSUE_0090 ファイルウォッチャーバッジ**: 評価 B。残存: activity-bar-item role/tabindex なし・source-control-panel空
- **bug-diff-tab-textfield-scroll**: 評価 A。scrollLeft/scrollTop 加算修正確認済み
- **diff-tab-japanese 日本語表示修正**: 評価 A。StandardOutputEncoding UTF8化確認済み
- **ISSUE_0092 差分タブスクロール位置復元**: 評価 A。hide/show スクロール保存復元確認済み
- **EditorAPI onTableSaved/onRowSelected**: 評価 A。非同期発火タイミング・dispose対称性確認済み
- **EditorApiBridge dispose/二重install防止**: 評価 A。センチネルパターン・対称性確認済み
- **type-validation 型バリデーション**: 評価 A-。残存: cell-error aria-invalid欠如・列ヘッダー型バッジなし
- **ISSUE_0102 PROBLEMSジャンプ後フォーカス修正**: 評価 A→A。文字入力反映修正確認済み
- **ISSUE_0101 ミニテーブルgit差分ハイライト**: 評価 A。fire-and-forget refreshGitDiffAsync 確認済み
- **RelationsPanelトグル機能**: 評価 B+。残存: open-tab div 要素・show/hide 非対称
- **ISSUE_0105 DiffTabカンマ含有フィールド誤検出修正**: 評価 A。RFC4180準拠CSV解析確認済み
- **ISSUE_0107 差分ビューバリデーション**: 評価 B。残存: PROBLEMSカウント0・ValidationPanel未接続の疑い
- **ISSUE_0108 差分ビュー再表示時最新データ反映**: 評価 A。再作成方式でvalue=250が正確に反映確認済み

## 横断的な継続課題（未修正リスト）

### 🔴 優先度高
- インタラクティブな div/span 要素に role="button"/tabindex がない（activity-bar-item, source-control-file-item, relations-panel-open-tab ほか）
- SVG に aria-hidden="true" がない（filter-icon, sort-icon, activity-bar SVG）
- 差分ビュー左ペインに aria-readonly がない（BUG_0021から継続）・contenteditable="true" 残存
- cell-error セルに aria-invalid="true"/aria-describedby がない（ISSUE_0080から全サイクル継続）
- コンテキストメニューが操作後に残存する（hide()漏れ、BUG_0025/BUG_0023で確認）

### 🟡 優先度中
- row-resize-handle がミニテーブル・バッファ行・差分削除行に残存
- diff-resize-handle に role="separator"/aria-orientation/aria-label がない
- validation-panel-group-header に role/aria-label なし（全サイクル継続）
- fill-handle が読み取り専用ペイン（差分左ペイン・ミニテーブル inactive）に display:block で残存
- show/hide 非対称パターン（style.display='' での表示復元）— bug-report #3/#32/#77/#84
