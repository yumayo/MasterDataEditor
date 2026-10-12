---
name: BUG_0026 クイックビュー位置調整レビュー
description: DropdownQuickViewがドロップダウンリストに被る問題の修正レビュー（2026-03-19 フィードバックループ後再確認済み）
type: project
---

BUG_0026 の positionElement() 修正レビュー。評価: B（フィードバックループ後再確認 2026-03-19）

**Why:** クイックビューが FK ドロップダウンリストに重なり選択操作を妨げていたため修正された。

**How to apply:** 今後の浮遊 UI 配置系の修正をレビューする際の参考として使う。

## 確認済みの正常動作（フィードバックループ後）

- maxWidth リセット解消済み: 通常配置のダンプ `style="left: 791px; top: 91px;"` に `max-width` 属性なし。前回キャリーオーバー問題は解消。
- 下端 max-height 付与: `top: 620px, max-height: 100px` が正しく付与される。
- 右端フォールバック水平回避: クイックビュー `left: 872px`、ドロップダウン `left: 1080px` — 左側配置で重なりなし。
- `editor-table--inactive` クラスが継続維持。

## 残課題（2026-03-19 フィードバックループ後時点）

### 🔴 未解消
- 右端フォールバック時のダンプで `max-width` の style 属性が存在しない。フォールバック時の幅制約が付与されていない。通常配置に戻る際の `max-width = ''` リセットは実装済みだが、フォールバック時の `max-width = availableWidth + 'px'` 付与が未実装と推測。
- `max-height: 100px` は最低限の表示行数（セクションヘッダー20px + テーブルヘッダー20px + 1データ行20px = 60px）を辛うじて確保するが、2行以上の参照先テーブルでは切れる。`overflow-y: auto` を style 属性でも明示しテストで検証可能にすること。

### 🟡 継続
- 「max-height が設定されており overflow-y が auto である」テストのダンプが通常配置（left:791, top:91）であり、下端フォールバックを再現できていない疑い。
- `relations-table-context` がクイックビューヘッダーに欠如（RelationsPanel との構造的非対称）。
- クイックビュー内バッファ行に `row-resize-handle` が残存。
- `dropdown-quick-view` 要素に `role`/`aria-label` なし。

## 注意点
- ドロップダウンが `position: fixed` の場合とそうでない場合が混在（右端フォールバックテスト vs 通常テスト）。
- 下端→通常への移動時に前回の `max-height` が残存しないかのテスト（対称操作、bug-report #3パターン）が存在しない。
