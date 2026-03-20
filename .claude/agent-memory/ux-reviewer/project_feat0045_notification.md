---
name: FEAT_0045 通知UIレビュー（ISSUE_0079含む）
description: システムエラー通知（トースト・ベルマーク・履歴パネル）のUXレビュー結果。ISSUE_0079でStatusBar統合済み。
type: project
---

## FEAT_0045 通知UI 初回レビュー（2026-03-19）評価: C

### 致命的問題（当時）
1. 履歴パネルを閉じる手段がない（visible クラスに対応するクローズ手段なし）
2. `notification-bell` に role/tabindex/aria-label がない
3. `notification-toast` に `role="alert"` がない

---

## ISSUE_0079 StatusBar統合 再レビュー（2026-03-20）評価: B

### 改善確認済み（前回指摘 → 今回修正）
1. **`notification-bell` に role="button"/tabindex="0"/aria-label="通知履歴を表示" が付与された** — 前回の最重要指摘が解消
2. **`notification-toast` に `role="alert"` が付与された** — スクリーンリーダー対応
3. **SVGに `aria-hidden="true"` が付与された** — ベルアイコンSVGの継続パターン解消
4. **`notification-container` が body直下オーバーレイからステータスバー内に移動** — DOMの意味的な整理

### DOM構造サマリ（ISSUE_0079後）
```
.status-bar
  .status-bar-badge [role="button" tabindex="0" data-error-count="0"]
  .status-bar-spacer
  .notification-container
    .notification-toast-area
      .notification-toast [role="alert"]  ← 複数並列
    .notification-history [.visible で表示切替]
      .notification-history-item  ← 複数
    .notification-bell [role="button" tabindex="0" aria-label="通知履歴を表示"]
      SVG [aria-hidden="true"]
```

### 視覚的問題（スクリーンショット確認）
- ベルアイコンがステータスバー右端に正しく配置（画面右下 y:708付近）
- トーストが右端に縦並び（ステータスバーの上方に展開）— 正常
- 履歴パネルが右端縦に並ぶ（最新順に上から表示）— 正常

### 残存問題（🔴 改善必須）
1. **履歴パネルを閉じる手段が依然としてDOM上に存在しない**
   - 「ベルマークをクリックすると過去の全通知が表示される」ダンプで `notification-history visible` 内に閉じるボタン・クローズ用要素がない
   - aria-expanded 属性も notification-bell に存在しない（開閉状態がスクリーンリーダーに伝わらない）
   - 推奨: `notification-history-close` ボタン + document mousedown でクローズ

2. **`notification-history-item` に role がない**
   - 単純な div のまま。読み取り専用コンテンツとして `role="listitem"` + 親に `role="list"` が望ましい

### 残存問題（🟡 改善推奨）
- 未読バッジ（カウンター）が未実装（ベルを見ても未読数が分からない）
- 履歴アイテムにタイムスタンプなし
- `notification-bell` に `aria-expanded` 属性なし（履歴パネル開閉状態の可視化）
- トースト表示中に履歴パネルも同時に開くと高さ競合が発生する可能性（スクリーンショットで共存状態が確認できる）

### bug-report.md 照合
- show/hide 対称性欠落（#84）: visible クラスに対応するクローズ手段なし → 再発
- インタラクティブdivへのrole欠落: notification-history-item → 部分的再発

**Why:** ISSUE_0079でステータスバー統合という構造的改善を実施。アクセシビリティ属性（role/aria）の主要問題が解消されたが、「閉じる手段がない」という最初から指摘している根本問題は未解決。
**How to apply:** 次回レビュー時は「閉じる手段とaria-expanded」を最初に確認する。
