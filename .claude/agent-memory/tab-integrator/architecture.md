---
name: architecture
description: タブ管理の基本アーキテクチャ（TabState, DiffTab, HistoryとTabButtonの接続パターン）
type: project
---

## タブ管理のコアファイル

- `tab.ts` — タブライフサイクルのオーケストレータ。TabState/DiffTab の生成・破棄
- `tab-button.ts` — タブボタンDOM + Dirty状態表示（dirtyIndicator CSS）
- `diff-tab.ts` — 差分タブ専用クラス。左右EditorTableを管理
- `tab-drag-drop.ts` — ドラッグ&ドロップによるタブ並び替え

## Dirty状態の伝達フロー（通常タブ）

1. ユーザーがセルを編集
2. `EditorTableHandler.applyCellChangesWithHistory()` → `History.push()` or `pushCommand()`
3. `History.notifyChange()` → `store.isTableDirty()` で判定
4. `store.getHistories()` で登録済み全History取得 → `history.setTabButtonDirty(isDirty)` 呼び出し
5. `TabButton.setDirty(true)` → `.tab-button-dirty-visible` CSS クラス追加 → ●表示

## TabButton と History の接続

- 通常タブ: `new History(editorTable, tabButton, store, tableName, 100)` — 実TabButtonを直接渡す
- ミニテーブル: `new History(editorTable, dummyTabButton, ...)` — ダミーTabButton（Dirty表示は不要）
- 差分タブ: `new History(editorTable, dummyTabButton, ...)` — ダミーTabButton（バグの原因）

## DiffTab の構造

- 左ペイン: `tableName + ':diff:head'` キー、常に読み取り専用（makeReadOnly()）
- 右ペイン: `tableName + ':diff:current'` キー、changes状態は編集可能だがdisableSave()で保存禁止
- 両ペインとも `disableSave()` 呼び出し済み（不正パスへのファイル書き込み防止）
- スクロール同期あり（左右双方向）

## Ctrl+S の処理パス

`EditorTableHandler.handleNavigationKeydown()` → `saveTableDataFromStoreAsync()` → `markSavedAndUpdatePanel()`
- `saveDisabled=true` の場合は即リターン（差分タブの全EditorTableはこのフラグがtrue）

## 差分タブ生成の呼び出し元

`SourceControlPanel` → `Tab.openDiffTab(tableName, isStaged, schemaJson, headCsv, currentCsv)`
→ `DiffTab` コンストラクタ → `buildDiffEditorTable()` × 2（左右）
