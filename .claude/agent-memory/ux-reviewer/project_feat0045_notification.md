---
name: FEAT_0045 通知UIレビュー
description: システムエラー通知（トースト・ベルマーク・履歴パネル）のUXレビュー結果（2026-03-19）
type: project
---

## FEAT_0045 通知UI（2026-03-19レビュー）評価: C

### DOM構造サマリ
- `notification-container` がオーバーレイ層末尾に配置（z-index競合リスクは低）
- `notification-bell` (div) + `notification-toast-area` + `notification-history` の3要素構成
- `notification-history` の表示は `visible` クラスの付与で制御
- トースト3件スタック・4件目で最古削除・履歴に全件保持は正常動作確認

### 致命的問題（🔴）
1. **履歴パネルを閉じる手段がない**
   - `notification-history visible` 内に閉じるボタン・オーバーレイなし
   - ESCで閉じる設計は bug-report #119 の既存ハンドラ競合リスクあり
   - 推奨: `notification-history-close` ボタン + document mousedown でクローズ

2. **`notification-bell` に role/tabindex/aria-label がない**
   - `<div class="notification-bell">` のまま
   - activity-bar-item と同じ継続パターンの新規発生
   - 推奨: `role="button" tabindex="0" aria-label="通知履歴を表示" aria-expanded="false"`

3. **`notification-toast` に `role="alert"` / `aria-live` がない**
   - スクリーンリーダーが新着通知を読み上げない
   - 推奨: `notification-toast-area` に `role="log" aria-live="polite"`、各トーストに `role="alert"`

### 改善推奨（🟡）
- 未読バッジ（カウンター）が未実装
- 履歴アイテムにタイムスタンプなし（`data-timestamp` 属性を今から付与推奨）
- 3件スタック+履歴同時展開時の高さ競合に未対処
- 履歴の表示順が古い順（新しい順が直感的）

### bug-report.md 照合
- show/hide 対称性欠落（#84/#1145）: visible クラスに対応するクローズ手段なし → 再発リスク高
- SVGにaria-hidden未付与: ベルアイコンSVGが対象 → 継続パターン再発
- インタラクティブdivへのrole欠落: notification-bell → 継続パターン再発

**Why:** 通知UIは初導入機能なので過去レビューとの比較が難しいが、継続課題（アクセシビリティ属性・show/hide対称性）が全て再現している。
**How to apply:** 次回通知UI修正レビュー時はこの課題リストを起点にアクセシビリティと閉じる動線を最初に確認する。
