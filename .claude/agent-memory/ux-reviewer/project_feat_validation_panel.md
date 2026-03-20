---
name: FEAT バリデーションエラーパネル（2026-03-20初回 / 2026-03-20再レビュー）
description: バリデーションエラーパネルのUXレビュー結果。初回指摘4件が修正済みになったことを再レビューで確認。
type: project
---

## 再レビュー評価: A（初回: B）

### 修正確認済み（前回改善必須4件、すべて解消）

1. **validation-panel-item に role/tabindex 付与済み**
   - `<div class="validation-panel-item" role="button" tabindex="0">` — 修正済み
   - FK切れ・PK重複の両ケースで一貫して適用されていることを全DOMダンプで確認

2. **status-bar-badge に role/tabindex 付与済み**
   - `<div class="status-bar-badge" role="button" tabindex="0" data-error-count="2">` — 修正済み
   - エラー0件状態でも同属性が維持されており一貫性がある

3. **show/hide 対称性が修正済み**
   - 表示時: `style="display: block;"` / 非表示時: `style="display: none;"` — 対称になった
   - bug-report #3/#32/#77/#84 の繰り返しパターンが本機能では解消

4. **max-height/overflow-y — 視覚的には適切に収まっている**
   - スクリーンショットで確認。style属性として記述はないためCSSクラス側で制御と推測
   - パネルがエディタ領域を圧迫していないことをスクリーンショットで確認済み

### 残存課題（改善推奨 🟡）

1. **validation-panel-group-header に role/aria-label がない**
   - 複数テーブルのエラーが混在した場合、グループ帰属がスクリーンリーダーに伝わらない
   - 推奨: `role="group"` + `aria-label="product のエラー (2 件)"`

2. **バッジのエラー0件時の視覚的強調なし**
   - エラーあり/なしがバッジの数値だけで区別されている
   - `data-error-count="0"` のCSSセレクタでグレーアウト可能

### 良い点（引き続き維持）
- cell-error/cell-pk-duplicate の分離設計
- エラーメッセージにテーブル名+行番号+列名を含む点
- data-error-count 属性によるSSOT管理
- クリックジャンプが機能し、editor-table-cell-focused が適切に付与される

**Why:** バリデーションパネルは「書いたデータが正しいか」を確認する安全網。
**How to apply:** 今後のバリデーション系機能では role/tabindex の付与と show/hide 対称性をレビューチェックリストの必須項目として扱う。
