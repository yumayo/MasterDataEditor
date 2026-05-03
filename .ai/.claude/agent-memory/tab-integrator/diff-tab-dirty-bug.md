---
name: diff-tab-dirty-bug
description: 差分タブでDirtyマーク（●）が表示されず、Ctrl+Sで保存できないバグの根本原因と修正方針
type: project
---

## 根本原因

`tab.ts` の `openDiffTab()` (L646) で `dummyTabButton = new TabButton(this.editor, this, '[diff]')` を生成し、
実際のタブボタン `tabButton`（L643）の代わりに DiffTab へ渡している。

DiffTab の `buildDiffEditorTable()` (L283) が `new History(editorTable, dummyTabButton, store, tableKey, 100)` で
このダミーを History に登録する。

Historyが `notifyChange()` → `setTabButtonDirty()` でDirty状態を通知する先がダミーTabButtonであるため、
画面上の差分タブのタブボタン（`tabButton`）には一切通知が届かず、Dirtyマークが表示されない。

**Why:** コメント（L645）の「差分タブでは不要なため同じタブボタンを渡す」という記述が実態と矛盾している。
ダミーは DiffTab に渡されており、実際の tabButton は DiffTab に渡されていない。

## Ctrl+Sでも保存できない理由

`EditorTableHandler.disableSave()` (diff-tab.ts L156-157) で両ペインの保存が明示的に禁止されている。
これは差分タブのtableKeyが `"tableName:diff:head"` / `"tableName:diff:current"` という不正パスになるため
ファイル破壊を防ぐ意図で正しい設計。つまり差分タブへの「Ctrl+S保存」は設計上禁止されている。

ユーザーが差分ビューで編集した内容は InMemoryTableStore に記録されるが、Ctrl+S では
対応するCSVファイルへ書き込めない構造になっている。

## 影響範囲まとめ

1. Dirtyマークが表示されない → dummyTabButton が通知を受け取るが画面外のため不可視
2. Ctrl+S保存ができない → disableSave() で設計上禁止済み（意図的）

## 修正方針

差分タブにおける編集とDirtyマーク表示の設計方針を決める必要がある：

**案A（最小修正）**: 差分タブ右ペインをreadonlyにして「編集禁止」を明確化
- isStaged=false でも rightEditorTable.makeReadOnly() を呼ぶ
- Dirtyマーク問題が原理的に発生しなくなる

**案B（Dirtyマーク対応のみ）**: DiffTab に実タブボタンを渡してDirty通知先を正す
- `openDiffTab()` で `tabButton` を DiffTab コンストラクタに渡す
- DiffTab が両ペインの History に実タブボタンを渡す
- Dirtyマークは表示されるが、Ctrl+Sでは保存できないまま（disableSave()が残るため）
- ユーザーには「編集はできるがCtrl+Sで保存はできない」という混乱が残る

**案C（本来の設計）**: 差分タブ右ペインを編集可能にし、Ctrl+Sで正しく元のファイルを保存する
- disableSave() を廃止し、tableKey ではなく tableName（実際のファイルパス）で保存する
- History に渡す tableName を diff 専用キーではなく実ファイル名にする必要がある
- InMemoryTableStore の設計と整合する必要があるため editor-table-integrator/in-memory-table-store エージェントとの連携が必要
