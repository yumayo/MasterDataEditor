---
name: 差分タブのDirty通知・保存欠陥
description: dummyTabButtonとdisableSaveにより差分タブでのDirtyマーク表示と保存が機能しない問題の詳細
type: project
---

## 問題の概要

差分ビュー（DiffTab）でデータを編集してもタブにDirtyマーク（●）がつかず、Ctrl+Sで保存もできない。

**Why:** DiffTab生成時の設計で2つの意図的な無効化が実装されており、それらが「差分タブ編集分の保存」というユースケースを完全に塞いでいる。

## 根本原因1: dummyTabButtonがDOMに存在しない

**ファイル**: `tab.ts` 643〜650行
**問題**: `openDiffTab()` で実際のタブボタン（`tabButton`）とは別に `dummyTabButton = new TabButton(this.editor, this, '[diff]')` を生成し、これをDiffTabに渡す。この `dummyTabButton` はタブバーに追加されていない（`this.tabButtons` にも入らない）。

`history.ts:notifyChange()` は `store.getHistories(tableName)` で得たHistory群の `setTabButtonDirty()` を呼ぶが、差分タブのHistoryが持つのは `dummyTabButton` のみ。実際のタブボタンは一切通知を受け取らない。

**コメントの誤り**: `tab.ts` 645行のコメント「ダミータブボタンはDirty表示に使うが差分タブでは不要なため同じタブボタンを渡す」は実態と逆。コメントは「同じタブボタンを渡す」と言いながら、実際には別のダミーを渡している。

## 根本原因2: disableSave() によりCtrl+Sが禁止

**ファイル**: `diff-tab.ts` 156〜157行
```typescript
this.leftEditorTableHandler.disableSave();
this.rightEditorTableHandler.disableSave();
```

**ファイル**: `editor-table-handler.ts` 472〜476行
```typescript
if (keyboardEvent.ctrlKey && keyboardEvent.key === 's') {
    keyboardEvent.preventDefault();
    if (this.readOnly) return;
    if (this.saveDisabled) return; // ← ここで早期リターン
    ...
}
```

差分タブのEditorTableHandlerはCtrl+Sを受け取っても保存処理を実行しない。「不正パス(`tableName + ':diff:current'`)へのCSV書き込みを防ぐ」という目的で設計された。

## 注意: disableSaveは正当な保護

差分タブのtableKeyは `quest_reward:diff:current` のような内部キーであり、これをCSVパスとして書き込めば `data/quest_reward:diff:current.csv` という不正ファイルが生成される。`disableSave` の禁止自体は正しい。

## 正しい保存の実現に必要なこと

差分タブで編集した内容を保存する場合：
1. 元テーブル名（`quest_reward`）に対してストアのデータを保存する必要がある
2. しかし差分タブのHistoryが管理するのは `quest_reward:diff:current` キーのストアデータ
3. 差分タブのEditorTableは元テーブルのInMemoryTableStoreとは別のスロットを使っている
4. つまり「差分タブの変更を元CSVに保存する」には、差分タブのストアデータを元テーブル名で保存する専用処理が必要

## 修正方針

1. **Dirtyマーク表示**: `dummyTabButton` を `tabButton`（実際のタブボタン）に差し替えるか、DiffTabが直接`tabButton.setDirty()`を呼べる仕組みを追加する
2. **保存処理**: `disableSave()` を外してtableNameを元のテーブル名(`tableName`)に置き換えた保存処理を実装する。ただしこれはアーキテクチャ上の大きな変更が必要（差分タブのEditorTableが管理するストアキーと実際の保存先テーブル名が異なるため）

## 関連ファイルと行番号

- `tab.ts` L643〜650: openDiffTab() でdummyTabButtonを生成してDiffTabに渡す箇所
- `diff-tab.ts` L156〜157: disableSave() 呼び出し
- `diff-tab.ts` L283: `new History(editorTable, dummyTabButton, store, tableKey, 100)`
- `history.ts` L108〜125: notifyChange() — dummyTabButtonにしか通知が届かない
- `editor-table-handler.ts` L472〜476: Ctrl+SでsaveDisabled=trueの場合に早期リターン
- `editor-table-handler.ts` L649〜657: markSavedAndUpdatePanel() — 差分タブでは到達しない

**How to apply:** 差分タブのDirty/保存関連の修正依頼を受けた場合は、まずこの2つの設計上の制約を念頭に置く。単純にtabButtonを差し替えるだけでは保存処理が実際に機能しないため、保存パスの設計も含めた修正が必要。
