---
name: FEAT_0027 クイックビュー改修（body直下固定配置＋ミニEditorTable）
description: クイックビューをbody直下にposition:fixedで配置し、独自テーブルをミニEditorTableに置き換えたレビュー記録
type: project
---

## 評価: A

### 正しく実装されている点
- `body > .dropdown-quick-view.visible` として body 直下に1インスタンスだけ配置されていることをダンプで確認
- `position: fixed` でビューポート座標を使用。StackingContext問題を根本解決
- シングルトン設計: Tab が `sharedDropdownQuickView` を所有し、GridDropdownInput に `connectDropdownQuickView()` で後付け接続
- ミニEditorTable のDOM構造が RelationsPanel と完全同一: `.relations-mini-table-wrapper > .relations-mini-table-scroll > div > .editor-table`
- 矢印キー移動でクイックビューが即時更新されることをダンプで確認（top座標が変化している）
- fetchAndRenderAsync 内の requestId チェックが3箇所（スキーマ読込後・store登録後・EditorTable生成後）に配置されレースコンディション対策が多段
- diff-tab.ts で connectDropdownQuickView を接続しないことでクイックビューを適切に無効化

### 残課題（🔴 改善必須）
- クイックビュー内のミニEditorTableに `editor-table--inactive` が付いていない
  - ダンプ: `<div class="editor-table">` （RelationsPanelは `editor-table editor-table--inactive`）
  - bug-report #3/84 パターン（対称操作の欠落）に該当
  - プランナーがクイックビューをクリックして意図せず編集モードに入るリスク

### 残課題（🟡 改善推奨）
- `private tab!: Tab` / `private store!: InMemoryTableStore` の `!` アサーションで生焼けオブジェクトに近い状態
  - connectTab 二重呼び出し時のファストフェイル（throw Error）を推奨
- `dropdownListElement` の初期値が空 div のプレースホルダーであり、コンストラクタ完了時に有効値でない
- Tab 破棄時のクイックビュー destroyCurrentMiniEditorTable 呼び出しパスが未定義（現構造では問題なし）

### 参考情報
- クイックビュー内 EditorTable が History に接続されているため、誤編集のUndoスタック混在リスクを確認推奨
- クイックビューの max-width が未定義（列数が多いテーブルでの表示崩れリスク）

**Why:** FEAT_0027の改修目的（StackingContext問題解消＋RelationsPanelとの視覚統一）は達成されている
**How to apply:** 次レビューで editor-table--inactive 付与が修正されているか確認すること
