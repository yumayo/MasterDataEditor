---
name: FEAT_0027 クイックビュー改修（body直下固定配置＋ミニEditorTable）＋CSS改修
description: クイックビューをbody直下にposition:fixedで配置し、独自テーブルをミニEditorTableに置き換えたレビュー記録。CSS改修（背景色変更・max-width削除・max-height追加・300msディレイ削除）のラウンド2確認済み。
type: project
---

## 評価: A（ラウンド2 CSS改修後）

### 正しく実装されている点
- `body > .dropdown-quick-view.visible` として body 直下に1インスタンスだけ配置（全ダンプで確認）
- `position: fixed` でビューポート座標を使用。StackingContext問題を根本解決
- 表示/非表示: `visible` クラス付け外し + 中身の空化で対称性あり（bug-report #3を回避）
- 素早い移動で最終ホバー先のデータが正しく表示（top座標と内容が両方更新されていることを確認）
- `max-width` 削除が正式仕様としてテスト化された（「クイックビューに max-width が設定されていない」テスト追加）
- `relations-table-row-count` が単数形 `1 row` / 複数形 `rows` を適切に使い分け
- RelationsPanelと同一DOM構造（relations-panel-content > relations-panel-section-header > relations-table-section > ...）

### 残課題（🔴 改善必須）
- クイックビュー内のミニEditorTableに `editor-table--inactive` が付いていない（ラウンド2でも未修正）
  - ダンプ: `<div class="editor-table">` （RelationsPanelは `editor-table editor-table--inactive`）
  - bug-report #3/84 パターン（対称操作の欠落）に継続して該当
  - プランナーがクイックビューをクリックして意図せず編集モードに入るリスク

### 残課題（🟡 改善推奨）
- `relations-table-dirty` スパンがクイックビューヘッダーに欠如（RelationsPanelの5要素 vs クイックビューの3要素）
  - 参照先テーブルが未保存変更を持つ場合にクイックビューで伝えられない
  - bug-report #4パターン（状態変更の波及先への未伝播）に該当
- `relations-table-context`（FK値ヒント: `reward_group_id=1` 等）がクイックビューに欠如
  - RelationsPanelには表示されているのに不対称
- クイックビューに `role="tooltip"` / `aria-live="polite"` がない（スクリーンリーダーが出現を認識不可）
- ミニテーブル内の空 `grid-dropdown` が常時残留（推測: 意図的設計だが確認推奨）

### 参考情報
- 300msディレイ削除後の高速矢印キー移動時のパフォーマンスを大量行テーブルで確認推奨
- max-height到達後のスクロール中にマウスがクイックビュー外に出ると非表示になる操作上の課題（「スクロールしたい」と「クイックビュー上に留まる」の両立）

**Why:** FEAT_0027の改修目的（StackingContext問題解消＋RelationsPanelとの視覚統一）は達成されている
**How to apply:** 次レビューで editor-table--inactive 付与・relations-table-dirty 追加が修正されているか確認すること
