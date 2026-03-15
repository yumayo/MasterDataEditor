# ux-reviewer メモリ

## プロジェクト: App.MasterDataEditor

### UXレビュー実績

#### RelationsPanel 定義ジャンプ状態のタブ切替時リセット（過去の指摘、修正済み）
- 評価: 修正済み（bug-report.md #73で記録）
- TabStateにpaneStack/viewIndexを保存・復元するよう修正された

#### ミニテーブル行操作によるメインテーブルデータ破損（過去の指摘、修正済み）
- 評価: 修正済み（bug-report.md #80で記録）
- storeRowIndicesの陳腐化とreloadCellsFromStoreの行数非反映が原因で修正済み

#### 差分タブ重複開き防止（2026-03-15レビュー）
- ファイル: project_diff_tab_dedup.md
- openDiffTab()の重複防止とremoveTabButton()のDOM除去修正が適切に実装されている

#### 差分ビュー右ペインFKドロップダウン追加（2026-03-15レビュー）
- ファイル: project_diff_tab_dropdown.md
- dropdownContainer=wrapperElementパターンで overflow クリッピングを回避
- console.log デバッグログが GridDropdownInput.show() に残存（本番環境への混入リスク）
- 左ペインの読み取り専用状態がDOM上で明示されていない（aria属性なし）

#### BUG_0021 非連番keyスキーマのソート・差分ビューずれ修正（2026-03-16レビュー）評価: A
- ファイル: project_bug0021_non_sequential_key.md
- ソート: data-store-index が attack昇順(10<50<80)に正しく並び替わっている（attack列ヘッダーに sort-asc クラス付与）
- 差分ビュー: CSV列インデックス5(recover_hp)→DOM列インデックス3 への変換が正しく行われ diff-cell-deleted/added が正確に配置されている
- 残課題: 差分ビュー左ペイン（HEAD版）に aria-readonly などの読み取り専用マークアップが皆無（前回レビューの指摘継続）
- 残課題: 差分ビューの行レベルに data-diff-kind="modified" などの属性がなく行単位のアクセシビリティ強調が困難

#### BUG_0022 差分ビューパディング行高さ修正（2026-03-16レビュー、ラウンド2対応確認済み）評価: B
- ファイル: project_bug0022_padding_row_height.md
- createPaddingRow()共通化でheight:20px が正しく付与されバグ解消（ラウンド1）
- ラウンド2追加確認: notifyRightPaneRowDeleted の通常削除パスでも createPaddingRow が使われ height:20px 統一を確認
- ラウンド2追加確認: Undo後の左右ペインの行数・クラスが削除前と完全一致することを確認
- ラウンド2追加確認: 削除後パディング行の row-resize-handle 除去を確認
- 残課題(🔴): 挿入パディング行は diff-row-padding-inserted クラスがあるが、削除パディング行には対称クラスがない。bug-report #3パターン（対称操作の欠落）に該当
- 残課題(🟡): data-row="3" data-store-index="2" のパディング行が store-index を持っており、意図的かゴミ属性か不明
- 残課題(🟡): 削除直後の左ペインに editor-table--inactive がなく、Undo後には付与されるという非対称
- 残課題(🟡): 左ペイン読み取り専用の aria 属性欠如（継続指摘）

#### FEAT_0024 ライトテーマ色改修（ラウンド2 フィードバック修正後）評価: B+
- ファイル: project_feat0024_light_theme.md
- ラウンド1の主要問題（テーマ設定漏れ・ダークオーバーライド欠如）は解消済み
- 残課題: `command-palette.css` に `[data-theme="dark"] .command-palette-item.selected:hover` がない（grid-dropdown との非対称）
- 残課題: `command-palette.spec.ts` の `setupTestPageAsync()` がダークテーマのまま（`data-theme="dark"` をダンプで確認）
- 残課題: コマンドパレット・ドロップダウンの aria-selected / role="listbox" 未実装（継続）

#### ヘッダーアイコン領域確保（FEAT_0023、2026-03-15レビュー）評価: A
- `.editor-table-column-header.has-icons { padding-right: 48px }` と `HEADER_ICON_AREA_PX = 48` の連動が適切
- ミニテーブル除外が CSS付与（isMiniTableInstance()条件）とJS幅計算（hasIcons=false）の両方で対称に実装されており bug-report #3パターンを回避
- 要改善: `has-badge` による `padding-left:32px` が `calculateColumnWidth` に加算されていない。長いPK/FK列名（例: `player_character_id`）で列名が右側アイコン領域に食い込む可能性あり
- `HEADER_ICON_AREA_PX` の算出根拠（filter-icon right:30px、width:14px）が CSS の absolute positioning に依存しており、CSSを変更した際に定数の更新漏れが起きやすい構造

### このプロジェクトの評価軸メモ
- 核心機能 = 外部キー参照の苦痛解消（定義ジャンプ、RelationsPanel）
- 差別化機能が壊れている場合は問答無用で評価下げ
- 状態の永続性（タブ切替をまたいだ状態保存）はユーザーの当然の期待
- 特殊タブ（差分タブ・設定タブ）は `tabStates` に登録されない → DOMクリーンアップは独自に行う必要あり
- `show/hide` や `activate/deactivate` の対称性チェックが繰り返し指摘されている（bug-report #3, #32, #77, #84）

### DOM構造パターン（良い例）
- タブバー: `div#tab > div.tab-scroll-area > ul#tab-content.tab-list > li.tab-button`
- タブボタン: `.tab-button-name`, `.tab-button-dirty`, `button.tab-button-close` の3要素構成
- ソース管理パネルは `div.source-control-panel` として sidebar 内に存在

### 繰り返し発生するUI問題パターン（bug-report.mdより）
1. 対称操作の欠落（#3, #32, #44, #54, #58, #74, #77, #84）
2. 操作パスの網羅漏れ（#8, #23, #65, #78, #79, #90）
3. クロージャ/キャッシュの陳腐化（#6, #91, #92）
4. 状態変更の波及先への未伝播（#4, #80, #90）
5. 非同期レースコンディション（#42, #60, #77, #86）
