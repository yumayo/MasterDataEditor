---
name: FEAT_0036 列幅自動調整機能
description: リサイズハンドルのダブルクリック自動調整・複数列D&D等幅一括適用・複数列各列独立調整のUXレビュー（2026-03-17）
type: project
---

列幅自動調整機能のUXレビュー（2026-03-17）。評価: A

## 確認済み正常動作

- ダブルクリック自動幅: `name` 列が 296px（`very_long_item_name_exceeding_default_width` 包含）
- FK参照ヒント含む幅: `enemy_id` 列が 233px（`超強力なレッドドラゴン（エリート）` を包含）
- 複数列D&D等幅一括: id列・name列が共に 179px、非選択の value 列は 99px で不変
- 複数列ダブルクリック独立: id列 77px、name列 296px と各列データ量に応じた独立した幅
- Undo/Redo: Ctrl+Z でネーム列 99px 復元＋Dirty解消、Ctrl+Y で 296px 再適用＋Dirty付与
- 最小幅制約: 全列 50px 以上を維持

**Why:** 列幅計算がVirtual DOM外（canvas/offscreen計算）で行われているため、実際のDOMに反映された値が正しいかを確認した。
**How to apply:** 今後 FK 参照ヒントを持つ列の幅計算を変更する際は、`span.cell-reference-hint` のテキスト長を幅計算に含めているかを必ず確認すること。

## 残課題

### 注意点
- 列幅変更で `tab-button-dirty-visible` が付く（CSV保存不要な表示設定変更なのにDirtyフラグが立つ）。プランナーが誤って Ctrl+S を乱発する可能性がある。列幅をCSVに保存しないなら Dirty にしない設計、またはツールチップで「列幅の変更は保存対象外です」と注記することを検討。
- `複数列D&DリサイズをCtrl+Z 1回で全列が元の幅に戻ること` のダンプファイルが `&` 文字によりファイルシステム上で欠落（autoDumpのファイル名エスケープ漏れ）。テストは通過前提だが最終状態DOMの確認ができていない。
