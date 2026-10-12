---
name: 差分ビューペインリサイズハンドル（FEAT_diff-view-resize）
description: diff-tabの左右ペイン間にドラッグリサイズハンドルを追加した機能のUXレビュー記録
type: project
---

差分ビュー左右ペイン間にリサイズハンドルを追加する機能を実装、評価A。

**Why:** 差分確認時に左（HEAD版）と右（現在版）を見比べる際、列幅が片方に偏るとプランナーが内容を読みにくくなる。リサイズで任意のペイン幅に変更できることが必要。

**How to apply:** 今後の diff ビュー改修時に、このパターン（flex-basisパーセンテージ管理・クランプ制約・userSelect解除）を維持すること。

## 良かった点
- `.diff-tab` 直下の DOM 順序: `diff-pane-left` → `diff-resize-handle` → `diff-pane-right`（正しい）
- flex-basisをパーセンテージで管理（px固定のbug-report教訓適用済み）
- 20%〜80%クランプが正しく動作（ダンプで flex: 0 0 20% / 80% を確認）
- `document.body.style.cursor = 'col-resize'` + `userSelect = 'none'` → mouseup で解除（RelationsPanelと同一パターン）
- hover時に `var(--focus-border, #007acc)` を使用（RelationsPanelハンドルと同変数で統一）

## 残課題
- 🔴 初期状態でハンドルが視覚的に不可視: `.diff-resize-handle` は `position: static` で `background: var(--border-color)` のみ。サイドバーハンドルにある `border-right: 1px solid rgba(128,128,128,0.3)` のような常時表示の視覚手がかりがなく、ハンドルの存在に気づかないリスクがある
- 🟡 height 指定なし: flex の align-items:stretch に暗黙的に依存している（明示的に `align-self: stretch` を付けるとより堅牢）
- 🟡 ドラッグ中状態クラス（`.diff-resize-handle--dragging`）が未実装
- 🟡 50%均等リセット手段なし（ダブルクリックリセット等）
- 🟡 `role="separator"` / `aria-orientation="vertical"` 未設定（継続指摘）

## bug-report.md 照合
- px固定リサイズ（RelationsPanel過去バグ）: 再発なし（パーセンテージ管理）
- 最小幅未設定（サイドバー過去バグ）: 再発なし（クランプ実装）
- ドラッグ中 userSelect 未設定: 再発なし
- 対称操作の欠落（#3パターン）: mousedown/mouseup の対称性あり
