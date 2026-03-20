# ux-reviewer メモリ

## プロジェクト: App.MasterDataEditor

### UXレビュー実績

#### アーカイブ（2026-03-15〜17）
- ファイル: project_review_archive_mar2026.md
- 差分タブ・BUG_0021〜0025・FEAT_0023〜0036 の要約と横断的継続課題リストを収録

#### FEAT_0045/ISSUE_0079 通知UI（2026-03-19初回C→2026-03-20再レビューB）
- ファイル: project_feat0045_notification.md
- 修正済み: notification-bell に role="button"/tabindex="0"/aria-label 付与
- 修正済み: notification-toast に role="alert" 付与
- 修正済み: ベルSVGに aria-hidden="true" 付与
- 修正済み: notification-container をステータスバー内に移動（ISSUE_0079）
- 残存(🔴): 履歴パネルを閉じる手段がDOM上に依然存在しない
- 残存(🔴): notification-bell に aria-expanded なし
- 残存(🟡): notification-history-item に role="listitem" なし・未読バッジなし

#### FEAT バリデーションエラーパネル（初回2026-03-20 B → 再レビュー2026-03-20 A）
- ファイル: project_feat_validation_panel.md
- 修正済み: validation-panel-item に role="button"/tabindex="0" 付与
- 修正済み: status-bar-badge に role="button"/tabindex="0" 付与
- 修正済み: show/hide 対称（display:block / display:none）
- 修正済み: max-height/overflow-y（スクリーンショットで視覚的に確認）
- 残存(🟡): validation-panel-group-header に role/aria-label がない（複数テーブルエラー混在時のグループ帰属）
- 残存(🟡): バッジのエラー0件時の視覚的区別なし（data-error-count="0" でCSSグレーアウト推奨）

#### BUG_0026 クイックビュー位置調整（2026-03-19レビュー）評価: B+
- ファイル: project_bug0026_quick_view_position.md
- 下端はみ出し: top固定+max-height動的付与 正常（top:620px, max-height:100px）
- 右端フォールバック: クイックビューがドロップダウン左側（left:872px < dropdown left:1080px）に配置
- 残課題(🔴): 右端フォールバック時のダンプに max-width の style 属性が確認できない
- 残課題(🔴): max-height:100px は多行参照時に内容が切れる可能性。overflow-y:auto のアサートが必要
- 残課題(🟡): 「max-height が設定されており overflow-y が auto である」テストのダンプが通常配置になっている疑い
- 残課題(🟡): relations-table-context がクイックビューヘッダーに欠如（継続指摘）
- 残課題(🟡): バッファ行に row-resize-handle 残存・role/aria-label 欠如（継続パターン）

### このプロジェクトの評価軸メモ
- 核心機能 = 外部キー参照の苦痛解消（定義ジャンプ、RelationsPanel）
- 差別化機能が壊れている場合は問答無用で評価下げ
- 状態の永続性（タブ切替をまたいだ状態保存）はユーザーの当然の期待
- 特殊タブ（差分タブ・設定タブ）は `tabStates` に登録されない → DOMクリーンアップは独自に行う必要あり
- `show/hide` や `activate/deactivate` の対称性チェックが繰り返し指摘されている（bug-report #3, #32, #77, #84）
- ミニテーブルの設計原則: ストアの全行を保持し、表示のみFKフィルタリング（storeRowIndicesのサブセット管理はしない）

### 横断的な継続課題（最新）
- インタラクティブな div/span 要素に role="button"/tabindex がない（activity-bar-item, notification-bell ほか）
- SVG に aria-hidden="true" がない（filter-icon, sort-icon, activity-bar SVG）
- 差分ビュー左ペインに aria-readonly がない（BUG_0021から継続）
- row-resize-handle がミニテーブル・バッファ行・差分削除行に残存
- コンテキストメニューが操作後に残存（hide()漏れ、bug-report #8/#65）
