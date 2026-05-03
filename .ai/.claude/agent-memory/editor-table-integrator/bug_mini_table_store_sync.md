---
name: ミニテーブル操作によるメインテーブルDOM破損バグ
description: ミニテーブルで行を追加・削除するとメインテーブルのDOMがおかしくなるバグの根本原因と修正方針
type: project
---

## 問題

ミニテーブル（RelationsPanelの右ペイン）で行の追加・削除を行うと、同名テーブルをタブで開いたときにメインテーブルのDOMに重複行が表示される（データは正常、CSVに保存は問題なし）。

**Why:** ミニテーブルと通常タブのEditorTableが同一のInMemoryTableStoreを共有しているが、一方のstoreRowIndicesが他方の行挿入・削除を追跡しないため。

**How to apply:** ストアへの行操作を伴う実装をするときは必ずこの問題を意識すること。

## 根本原因の詳細

### 関係するファイルと行番号

| 処理 | ファイル | 行 |
|------|---------|-----|
| ミニテーブル生成 | relations-panel.ts | 769-820 (`buildMiniEditorTableAsync`) |
| ミニテーブル生成（tab側） | tab.ts | 1007-1101 (`createMiniEditorTable`) |
| 行挿入（storeに書く） | editor-table-structure.ts | 135-217 (`insertRowInternal`) |
| 行削除（storeから消す） | editor-table-structure.ts | 324-382 (`deleteRow`) |
| タブ復帰時のDOM同期 | editor-table.ts | 776-812 (`reloadCellsFromStore`) |

### 破損メカニズム

1. questタブ選択中 → quest_rewardミニテーブルが生成される（storeRowIndices=[0,1]など）
2. ミニテーブルで行追加 → `store.insertRowAt('quest_reward', 2, [])` でストアが5行に
3. quest_rewardタブを別途開く → storeRowIndices=[0,1,2,3,4]で初期化された別EditorTableインスタンス
4. questタブ→quest_rewardタブ切替でミニテーブル削除
5. quest_rewardタブのミニテーブルで行削除 → `store.removeRow('quest_reward', 2)` でストアが4行に
6. quest_rewardタブに戻る → `reloadCellsFromStore()` が呼ばれる
   - quest_rewardタブのstoreRowIndices=[0,1,2,3,4]（古い5行分、更新されていない）
   - storeRows.length=4（新しいストア）
   - DOM行3がストアのrow2（本来quest_id=2の行）のデータに書き換えられる
   - DOM行5はスキップ（ストアに5行目なし）
   - → 「4行目が重複」に見える

### なぜCSV保存は正常か

`InMemoryTableStore`のデータ自体は`insertRowAt`/`removeRow`で正しく管理されている。
破損はDOMとstoreRowIndicesの乖離のみであり、`getCsv()`はストアデータを正しく返す。

## 修正方針案

### 案A（根本的）: ミニテーブル操作時に他インスタンスのstoreRowIndicesも更新する

`InMemoryTableStore`が同名テーブルを参照するEditorTableインスタンスを全て追跡し、
`insertRowAt`/`removeRow`時に全インスタンスの`storeRowIndices`を補正する。

**問題点:** InMemoryTableStoreがEditorTableを知ることになり、循環参照・責務違反になる可能性。

### 案B（シンプル）: タブ復帰時に`storeRowIndices`をストア行数に合わせて再構築する

`reloadCellsFromStore()`の先頭で`storeRowIndices.length > storeRows.length`の場合、
超過分のインデックスを切り落とす（または全体を再構築）。

**問題点:** 通常テーブルには適用できるが、ミニテーブルのフィルタリングされたstoreRowIndicesは
この方法では正しく再構築できない（フィルタ条件が別管理のため）。

### 案C（安全）: ミニテーブルで行操作後に必ずミニテーブル全体を再構築する

行挿入・削除後に`forceRefreshRelationsPanel()`を呼び、ミニテーブルを作り直す。
これによりstoreRowIndicesの陳腐化問題が原理的に起きない。

**問題点:** 再構築コストがかかる。行操作後の選択状態や編集中状態が失われる。

### 案D（推奨）: ストアへの行追加・削除の際に、同テーブルの全EditorTableインスタンスに通知する

`InMemoryTableStore`の`insertRowAt`/`removeRow`に、登録されたコールバックを呼ぶ仕組みを追加する。
EditorTableはストア登録時にコールバックを登録し、通知を受けたらstoreRowIndicesを補正する。

**これが案AをDI/コールバックパターンで解決した版。**

## 注意点

- ストアのデータ（行配列）は常に最新・正しい
- 問題は各EditorTableインスタンスが持つ`storeRowIndices`フィールドの陳腐化
- `reloadCellsFromStore`はセル値の更新のみを行い、行の追加・削除は行わない
- ミニテーブルのstoreRowIndicesはフィルタリング後の行インデックスであり、
  通常テーブルのstoreRowIndicesとは意味が異なる
