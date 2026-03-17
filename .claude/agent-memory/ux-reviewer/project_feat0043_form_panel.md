---
name: FEAT_0043 フォームビュー作成 UXレビュー結果
description: フォームビュー（PKセル右クリック→key:valueフォーム+アコーディオン）のDOMレビュー結果。評価B-。核心機能のアコーディオン未実装が最大課題。
type: project
---

## FEAT_0043 フォームビュー UXレビュー（2026-03-18）

**評価: B-**

### DOM構造サマリー
- `div.editor-right-slot` 内に `div.relations-panel[style="visibility: hidden;"]` と `div.form-panel` が兄弟として共存
- `div.form-panel` の直接子: `button.form-panel-close` → `div.form-panel-header` → `div.form-panel-content`
- `div.form-panel-header` 内: `div.form-panel-breadcrumb > span.form-panel-breadcrumb-item.form-panel-breadcrumb-item--current`
- `div.form-panel-content` 内: `div.form-panel-title` + `div.form-panel-depth-bar` + `div.form-panel-fields`
- `div.form-panel-depth-bar` 内: 4個の `div.form-panel-depth-dot` (1個が --active)
- `div.form-panel-fields` 内: `div.form-panel-field-row > div.form-panel-field > div.form-panel-field-label` + `div.form-panel-field-value`

### 確認済みの良い点
1. `button.form-panel-close` に `aria-label="フォームビューを閉じる"` が付与（プロジェクト内では珍しく適切）
2. ✕SVGが `stroke="currentColor"` + `stroke-linecap="round"` でテーマ対応完全
3. `form-panel-breadcrumb-item--current` 修飾子が将来の深度増加時にCSSフックとして機能する
4. 4段の `form-panel-depth-dot` で深度上限を視覚化
5. テスト2→テスト3（✕クリック後）でコンテキストメニューが正しくhide済み（bug-report #8再発なし）

### 改善必須
**Why:** FK参照・逆参照のアコーディオンが皆無。FEAT_0043の核心機能が未実装。
- FK値フィールド（enemy_id=1）をクリックで参照先レコードに展開するUIが存在しない
- 1:N逆参照セクションがフォームビュー内に存在しない
- form-panel が relations-panel と visibility:hidden で共存するflex構造がレイアウト崩壊リスクを内包
- form-panel-close が form-panel の最初の子要素でヘッダー外側に浮いている（form-panel-header の内側右端に移動すべき）

### 継続リスク（bug-report参照）
- bug-report #3（対称操作欠落）: show（コンテキストメニュークリック）とhide（✕）の非対称なDOM操作（visibility:hidden vs 要素除去）
- bug-report #116（ハードコード色混入）: 新規コンポーネントでCSS変数の使用確認が必要
- bug-report #135（浮遊UI color欠落）: form-panel に color: var(--font-color) が宣言されているか確認が必要
