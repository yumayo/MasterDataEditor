---
name: ミニテーブル行追加・削除後の左ペインEditorTable行数不整合
description: ミニテーブルで行を追加・削除すると左ペインのEditorTableで重複行が表示されるバグの根本原因
type: project
---

## バグの症状

ミニテーブル（RelationsPanelの1:Nセクション）で行を追加・削除した後、
左ペインの同テーブルEditorTableに重複行や行数不整合が発生する。

## 根本原因

`editor-table.ts` の `reloadCellsFromStore()` (776-812行) が
**セル値のみ更新し、行数の変化（挿入・削除）を処理しない**こと。

**Why:** タブ切替時（tab.ts 499-500行）は `reloadCellsFromStore()` のみ呼ばれる。
ミニテーブルが `store.insertRowAt` / `store.removeRow` でストアの行数を変えても、
左ペインEditorTableのDOMと `storeRowIndices` は古いまま残る。

## 発生フロー（具体例）

```
quest テーブルを開く → ミニテーブルで行追加 → quest_reward ストア 4行→5行
quest_reward タブを開く → DOM5行作成、storeRowIndices=[0,1,2,3,4]
quest タブに戻る → ミニテーブル再構築（正しい）
ミニテーブルで3行目削除 → ストア 5行→4行
quest_reward タブをクリック → reloadCellsFromStore() のみ呼ばれる
  storeRowIndices[4]=4 だがストア4行 → スキップ
  DOM5行目に古いデータが残る → 重複行
```

## 関連ファイル・行番号

| 地点 | ファイル | 行番号 | 内容 |
|---|---|---|---|
| 行数変化の無処理 | editor-table.ts | 776-812 | reloadCellsFromStore() |
| ストアへの行追加 | editor-table-structure.ts | 173 | store.insertRowAt() |
| ストアへの行削除 | editor-table-structure.ts | 334 | store.removeRow() |
| タブ切替時の同期 | tab.ts | 499-500 | reloadCellsFromStore() のみ |

## 修正方針

`reloadCellsFromStore()` を拡張して行数の差分も処理する：
1. ストア行数 > DOM行数 → 不足分を追加（storeRowIndices も拡張）
2. ストア行数 < DOM行数 → 余分を削除（storeRowIndices も縮小、バッファ行除く）
3. セル値同期は従来通り

**注意**: editor-table-integrator エージェントとの協調が必要
