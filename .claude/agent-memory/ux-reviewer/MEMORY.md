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
