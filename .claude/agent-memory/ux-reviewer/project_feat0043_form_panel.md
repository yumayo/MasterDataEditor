---
name: FEAT_0043 / BUG_0027 フォームビュー UXレビュー結果
description: フォームビュー（PKセル右クリック→key:valueフォーム+アコーディオン）のDOMレビュー結果。BUG_0027でz-index 200対応完了。評価B+。
type: project
---

## FEAT_0043 フォームビュー UXレビュー（最終更新: 2026-03-19）

**現在の評価: B+**（BUG_0027 修正後）

---

### BUG_0027 修正内容（2026-03-19）

`z-index.css` にて `--z-index-form-panel: 200` に変更。
`form-panel.css` の `.form-panel` が `z-index: var(--z-index-form-panel)` で参照。

**StakingContext 確認結果:**
- `.editor-right-slot` は `position` 未指定、`display:flex` のみ → StakingContext を形成しない
- `.relations-panel` は `position: relative` → 新規StakingContext を形成する
- `.form-panel` は `.relations-panel` と **兄弟要素**として `editor-right-slot` に並置される構造に変更済み
- → `.form-panel`（`position:absolute`）の `z-index:200` が `.relations-panel`（`z-index` 相当の10）を正しく上回る

**テスト結果DOMで確認:**
- フォームパネル表示時: `div.relations-panel[style="display: none;"]` + `div.form-panel` が共存
- フォームビュー復帰後: `div.relations-panel[style=""]` のみ（form-panel 要素なし）

---

### DOM構造サマリー（最新）

- `div.editor-right-slot` 内に `div.relations-panel` と `div.form-panel` が兄弟として共存
- フォームパネル表示時に `relations-panel` は `display:none`
- `div.form-panel` 直接子: `div.form-panel-header` + `div.form-panel-content`
- `div.form-panel-header` 内: `div.form-panel-breadcrumb` + `button.form-panel-close[aria-label="フォームビューを閉じる"]`
- `div.form-panel-content` 内: `div.form-panel-title` + `div.form-panel-depth-bar` + `div.form-panel-fields` + `div.form-panel-section` (アコーディオン複数)
- アコーディオン: `→ enemy（enemy_id）` / `← item（quest_id）` の FK参照・逆参照セクション

### 確認済みの良い点
1. `button.form-panel-close` に `aria-label="フォームビューを閉じる"` が付与
2. ✕SVGが `stroke="currentColor"` + `stroke-linecap="round"` でテーマ対応完全
3. `form-panel-breadcrumb-item--current` 修飾子が将来の深度増加時にCSSフックとして機能
4. 4段の `form-panel-depth-dot` で深度上限を視覚化
5. アコーディオンセクションが実装済み（FK参照・逆参照ともに存在）
6. `form-panel-close` が `form-panel-header` 内の右端に移動（FEAT_0043時点の指摘が解消）
7. テスト3（✕クリック後）で `form-panel` 要素がDOMから除去され relations-panel が復帰（clean な show/hide）

### 継続リスク
- bug-report #116（ハードコード色混入）: `.form-panel-field-value` に `background: rgba(255,255,255,0.03)` ハードコードあり（ダークテーマ前提）
- アコーディオン `form-panel-section-body` の初期状態 `display:none` — `aria-expanded` / `role="button"` がセクションヘッダーにない（継続指摘）
- `form-panel-section-header` は `cursor:pointer` の div だが `role="button"` / `tabindex` 未付与（キーボードアクセス不可）
- `form-panel-ref-item-sub` でサブテキスト（スライム）が参照先レコードの名前列を表示しているが、どの列かの説明がない
