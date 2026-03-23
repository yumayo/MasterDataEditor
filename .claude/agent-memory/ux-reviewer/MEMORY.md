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

#### 起動時全テーブルバリデーションスキャン（DOMダンプなし、実装レビューのみ）評価: B+
- テスト未実行のためDOMダンプなし。validation-panel.ts / status-bar.ts / validation-engine.ts / bottom-panel.ts / main.ts の実装コードから評価
- 良い点: status-bar-badge に role="button"/tabindex="0"/aria-label 揃っている。data-errorCount 属性でE2Eテスト対応。グループ別表示構造。jumpToError が未開タブにも対応
- 修正必須(🔴): スキャン中であることをプランナーが認識できない（「0件」がスキャン前なのか確定済みなのか区別不能）。BackgroundTaskTracker.trackAsync でスキャンをラップするだけで対応可能
- 修正必須(🔴): テストケースにFKエラーの起動時検出が含まれない（PK重複のみ）
- 修正必須(🔴): validation-panel-group-header に role/aria-label なし（全サイクル継続）
- 改善推奨(🟡): data-error-count="0" 時のバッジ視覚状態（グリーン/グレー系）の分化
- 改善推奨(🟡): グループヘッダークリックでテーブルタブを開く動線
- 改善推奨(🟡): cell-error セルに aria-invalid="true" なし（全サイクル継続）
- リスク: runInitialScanAsync 完了前にユーザーがタブを開いた場合のレースコンディション（未検証）
- リスク: 通常タブクローズ時に unregisterSchema が呼ばれる経路があれば起動時スキャン結果が消える（tab.ts の close処理要確認）
- BottomPanel の closeBtn が element.style.display='none' を直接操作しており toggleTab を経由しないため activeTab 状態と同期崩れの可能性

#### ISSUE_0113 SOURCE CONTROLパネルstage/discard/unstageボタン 評価: B+
- 残存(🔴): discardボタンに確認ダイアログなし（git checkoutは取り消し不可能な破壊的操作）
- 残存(🔴): source-control-action-btn に role="button"/aria-label/title がない（SVGのみ）

#### ISSUE_0112 FKデフォルト値スキップ 評価: A
- 残存(🟡): cell-error セルに aria-invalid="true"/aria-describedby がない（全サイクル継続）

#### ISSUE_0107 差分ビューバリデーション 評価: B
- 残存(🔴): PROBLEMSパネルが data-error-count="0"・「エラーはありません」で矛盾。DiffTab未接続の疑い
- 残存(🔴): 左ペイン grid-textfield に contenteditable="true" が残存

#### ISSUE_0108 差分ビュー再表示時最新データ反映 評価: A
- 残存(🔴): 再作成方式によりスクロール位置がリセットされる

### 横断的な継続課題（最新）
- インタラクティブな div/span 要素に role="button"/tabindex がない（activity-bar-item, notification-bell, relations-panel-open-tab ほか）
- SVG に aria-hidden="true" がない（filter-icon, sort-icon, activity-bar SVG）
- 差分ビュー左ペインに aria-readonly がない（BUG_0021から継続）・contenteditable="true" 残存
- row-resize-handle がミニテーブル・バッファ行・差分削除行に残存
- cell-error セルに aria-invalid="true"/aria-describedby がない（ISSUE_0080から全サイクル継続）
- validation-panel-group-header に role/aria-label なし（全サイクル継続）
- show/hide 非対称パターン（style.display='' での表示復元）が再発 — bug-report #3/#32/#77/#84
- fill-handle が読み取り専用ペイン（差分左ペイン・ミニテーブル inactive）に display:block で残存
- 起動時スキャン中であることを示すインジケーターなし（新規、2026-03-24）
