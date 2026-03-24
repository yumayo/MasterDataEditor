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

### 最新レビュー結果（2026-03-25）

#### プラグインバリデーション機能 評価: B
- 良い点: プラグインバッジ（validation-panel-item-kind-plugin）が警告色（#cda632/黄金色）でPK重複・FK切れの赤バッジと明確に差別化されている。convertPluginErrors()でtableName="(plugin)"グループに分離し、PKエラーグループと視覚的に分断できている。PluginValidationRunnerのrunAllPluginsAsync()が構文エラーをcatchしてプラグインエラーとして報告するフォールスルー設計が適切。executePlugin()がnew Functionで実行スコープをtables/assertに限定しており安全。
- 修正必須(🔴): クリックジャンプ不可の視覚的表現がない。role="button"/tabindex="0"が設定されているにもかかわらず何も起きないアイテムが存在し、プランナーが「壊れている」と誤認する。cursor:default + pointer-events:none の追加またはrole/tabindex の除去が必須。
- 修正必須(🔴): グループ名が "(plugin)" という内部識別子そのまま。プランナー向けには「プラグイン」または「カスタムチェック」等の日本語が適切。
- 修正必須(🔴): location表示が "(plugin):" のみでプラグインファイル名が重複表示される（message側にも "[balance-check.js]" が含まれるため）。locationはプラグインファイル名のみにし、messageにはassertメッセージのみを表示する分離が必要。
- 修正必須(🔴): DOMダンプが存在しない（テストが実行されていない）。plugin-validation.spec.tsは存在するがautoDumpが機能していない。テスト実行後にDOMダンプを確認してビジュアル検証が必要。
- 改善推奨(🟡): validation-panel-group-header に role/aria-label なし（全サイクル継続課題）。
- 改善推奨(🟡): プラグインエラーにはcell-errorクラスが付与されない（セル特定不能）が、エラー件数バッジには計上される。プランナーが「赤バッジが出ているのにどのセルも赤くない」と混乱する可能性。

#### RelationsPanelトグル（非表示時ミニテーブル構築スキップ）評価: B+
- 前回(2026-03-24)から変化なし。未修正課題が継続。

### 横断的な継続課題（最新）
- インタラクティブな div/span 要素に role="button"/tabindex がない（activity-bar-item, notification-bell ほか）
- SVG に aria-hidden="true" がない（filter-icon, sort-icon, activity-bar SVG）
- row-resize-handle がミニテーブル・バッファ行・差分削除行に残存
- cell-error セルに aria-invalid="true"/aria-describedby がない（ISSUE_0080から全サイクル継続）
- validation-panel-group-header に role/aria-label なし（全サイクル継続）
- fill-handle が非表示・inactive ペインに display:block で残存
- 起動時スキャン中であることを示すインジケーターなし（2026-03-24）
- editor-right-slot の非表示時に 6px 幅の透明スロットが残留（relations-panel-toggle で新規発見、2026-03-24）
- プラグインエラーのvalidation-panel-itemにrole="button"が付いているが、クリックしても何も起きない（2026-03-25新規発見）
