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

### 最新レビュー結果（2026-03-24）

#### RelationsPanelトグル（非表示時ミニテーブル構築スキップ）評価: B+
- 良い点: 非表示中のミニテーブル構築スキップが正確に機能（relations-panel-content が空）。再表示時の自動リフレッシュが正常（enemy_id=2行選択→「ドラゴン」が即時表示）。ツールバートグルボタンのアクティブ/非アクティブ切替（toolbar-button-relations-active クラス付与/除去）が正確。«/»ボタンに aria-label="RelationsPanelを閉じる/開く" 設定済み。relations-panel-open-tab に role="button"/tabindex="0" あり。
- 修正必須(🔴): 非表示時に editor-right-slot が visibility:hidden + flex:0 0 6px となり6px幅の透明スロットが残留。左ペインが「全幅」にならない。display:none または flex:0 0 0px が正しい
- 修正必須(🔴): 非表示時のミニテーブルDOMが relations-panel-content 内に残留（visibility:hidden で隠しているだけ）。前の行のデータがメモリに残り続け、タブ数が増えると不要なEditorTableインスタンスが蓄積する
- 修正必須(🔴): 「ツールバーにRelationsトグルボタンが存在すること」テストのスクリーンショットでタブが開かれていない（空エディタ状態）。トグルボタン自体は toolbar に存在するが、テストがタブを開かずに検証している可能性。実際の動作に疑問が残る
- 修正必須(🔴): relations-panel-close-button（«ボタン）が非表示状態のDOMに残留したまま（visibility:hiddenの親の中）。tabindex が指定されていないためフォーカストラップは起きないが、スクリーンリーダーからは到達可能
- 改善推奨(🟡): fill-handle が非表示時のミニテーブル内に display:block で残存（継続課題）
- 改善推奨(🟡): row-resize-handle が非表示時のミニテーブル内に残存（継続課題）
- 改善推奨(🟡): relations-panel-close-button に tabindex="-1" を付与して非表示時はフォーカスから外す

#### 起動時全テーブルバリデーションスキャン（DOMダンプなし、実装レビューのみ）評価: B+
- 修正必須(🔴): スキャン中であることをプランナーが認識できない
- 修正必須(🔴): テストケースにFKエラーの起動時検出が含まれない（PK重複のみ）
- 修正必須(🔴): validation-panel-group-header に role/aria-label なし（全サイクル継続）

#### ISSUE_0113 SOURCE CONTROLパネルstage/discard/unstageボタン 評価: B+
- 残存(🔴): discardボタンに確認ダイアログなし
- 残存(🔴): source-control-action-btn に role="button"/aria-label/title がない

#### ISSUE_0107 差分ビューバリデーション 評価: B
- 残存(🔴): PROBLEMSパネルが data-error-count="0"・「エラーはありません」で矛盾
- 残存(🔴): 左ペイン grid-textfield に contenteditable="true" が残存

### 横断的な継続課題（最新）
- インタラクティブな div/span 要素に role="button"/tabindex がない（activity-bar-item, notification-bell ほか）
- SVG に aria-hidden="true" がない（filter-icon, sort-icon, activity-bar SVG）
- row-resize-handle がミニテーブル・バッファ行・差分削除行に残存
- cell-error セルに aria-invalid="true"/aria-describedby がない（ISSUE_0080から全サイクル継続）
- validation-panel-group-header に role/aria-label なし（全サイクル継続）
- fill-handle が非表示・inactive ペインに display:block で残存
- 起動時スキャン中であることを示すインジケーターなし（2026-03-24）
- editor-right-slot の非表示時に 6px 幅の透明スロットが残留（relations-panel-toggle で新規発見、2026-03-24）
