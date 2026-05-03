---
name: 差分タブのキー入力不活性バグ
description: 差分タブ（DiffTab）のEditorTableでセルをクリック後キー入力が無視される根本原因と修正箇所
type: project
---

## 問題

差分タブ（git変更ビュー）のEditorTableでセルをクリックして選択した後、キー入力しても編集モードが開始しない。
ダブルクリック後は正常に動作する。

**Why:** DiffTabのEditorTableはRelationsPanelに接続されていない（relationsPanel=false）ため、
セルのmousedownで activateHandler() が呼ばれず、EditorTableHandler.active が false のまま。
onKeydown冒頭の `if (!this.active) return;` で全キー入力が弾かれる。

**How to apply:** RelationsPanel未接続のEditorTableにはセルクリック時にhandler.activate()を直接呼ぶパスが必要。

## 根本原因

### 通常テーブルのフォーカス獲得フロー

1. `tab.ts` の `enableTabButton()` → `state.editorTableHandler.enable()` で active=true+フォーカス獲得
2. セルのmousedown → `table.relationsPanel.activateHandler(table)` → `targetEditorTable.getHandler().activate()` で active=true

### 差分タブの欠落

`diff-tab.ts` の `buildDiffEditorTable()` では:
- `editorTable.activate()` は呼ぶ（selectionDragController・scrollBindingのみ有効化）
- `editorTableHandler.enable()` は**呼ばない**（active=false のまま）

セルのmousedown（editor-table.ts:412）:
```typescript
if (table.relationsPanel !== false) {
    table.relationsPanel.activateHandler(table);  // DiffTabはrelationsPanel=falseなのでここを通らない
}
// elseブランチなし → active=falseのまま
```

### ダブルクリックで動く理由

`enableCellEditMode()` 内で `this.active = true` を明示的にセット（editor-table-handler.ts:265）。
「dblclick経由でミニEditorTableから呼ばれる場合はenable()が呼ばれていないためここでactive=trueにする」という既存コメント通り。

## 修正箇所

### editor-table.ts（createCell内のmousedownハンドラ）

```typescript
if (table.relationsPanel !== false) {
    table.relationsPanel.activateHandler(table);
} else {
    // RelationsPanel未接続（差分タブ等）は自ハンドラのみactivate
    table.handler.activate();
}
```

- ファイル: `/mnt/c/Users/y_hoshina/workspace/github/yumayo/MasterDataEditor/WebView/src/editor-table.ts`
- 行番号: 412-414付近

## 注意点

- 差分タブは左右2ペインのEditorTableを持つが、RelationsPanel相当の排他制御がない
- 今回の修正では左右それぞれのhandlerが独立してactivateされる
- 両ペインのhandlerが同時にactiveになる可能性があるが、focusout時に一方がdeactivateされる
  （onFocusout内でfocusWithoutScrolling()→フォーカス奪還→反対側がfocusoutを受け取りdeactivateされる）
- この動作で問題なければシンプルな修正で完結する
