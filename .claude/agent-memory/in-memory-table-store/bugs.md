---
name: ミニテーブル行挿入時のストア列数不整合 / 差分タブのパディング行ストア混入
description: ミニテーブルのDOM列数でストア行を挿入すると列数不足の行が混入する / 差分タブのパディング行がストア経由で保存される
type: feedback
---

## 不具合: ミニテーブルの行追加がメインテーブルのデータを破損する

### 症状
RelationsPanelのミニテーブルで行を追加すると、メインテーブル（左ペイン）のデータ表示が壊れる。
CSV保存時のデータは正常（ストアの行データ自体が破損するのでCSVに反映される可能性あり）。

### 根本原因（確定）
`editor-table-structure.ts` の `insertRowInternal()` 139行目・173行目。

```typescript
// 誤り: DOM列数（ミニテーブルはサブセット表示可能なので不正確）
const columnCount = columnHeaderRow.children.length - 1;
this.table.getStore().insertRowAt(this.table.tableName, storeRowIndex, Array(columnCount).fill(''));
```

ミニテーブルはサブセット列を表示する場合があり（`entry.header` でフィルタリング済み列を渡す）、
DOM列数 < ストアの実際の列数 になることがある。このとき列数の少ない行がストアに混入する。

### 修正方法
ストアへの空行挿入時の列数をDOMではなくストアのヘッダー長から取得する。

```typescript
// 正しい: ストアのヘッダー長を使用
const storeHeader = this.table.getStore().getHeader(this.table.tableName);
if (storeHeader === false) throw new Error('[EditorTableStructure.insertRowInternal] ストアにテーブルが登録されていません: ' + this.table.tableName);
this.table.getStore().insertRowAt(this.table.tableName, storeRowIndex, Array(storeHeader.length).fill(''));
```

**Why:** DOMはSSOTではない。InMemoryTableStoreがSSOT。列数の根拠はストアのヘッダーにある。
**How to apply:** 行挿入時に `Array(columnCount).fill('')` している箇所はすべてストアヘッダー長で行う。

---

## 不具合: 差分タブのパディング行がCSVに保存される（Dirtyフラグも消えない）

### 症状
- gitの差分ビューで右ペインを編集してCtrl+Sすると、CSV に空行（`,,,`）が出力される
- Dirtyフラグが消えない
- 通常タブに変更が反映されない

### 根本原因（確定）

**原因1: パディング行がストアに混入する（diff-tab.ts `buildDiffEditorTable()`）**

`buildMergedData()`（diff-rows.ts）は `deleted` 種別の行に対して右ペインに空行（パディング行）を挿入する。
この `rightRows`（パディング行を含む）がそのまま `store.registerTable(tableKey, csv.header, csv.body)` でストアに登録される。
`saveDiffTableDataFromStoreAsync()` は `store.getCsv(storeKey)` でストアの全行をそのまま返すため、
パディング行（`['','','',...` ）がフィルタされずにCSVに出力される。

**原因2: `markAllSaved` が誤ったキーで呼ばれる（editor-table-handler.ts 470行）**

```typescript
// 誤り: saveTargetTableName = "quest_reward"（元テーブル名）でhistoryRegistryを検索する
this.table.getStore().markAllSaved(this.saveTargetTableName);
```

差分タブの History は `tableKey`（= `tableName:diff:current`）で `registerHistory` されている。
`markAllSaved(saveTargetTableName)` は元テーブル名で検索するため、historyRegistryにエントリがなく例外を出すか、
通常タブのHistoryをmarkSavedしてしまい、差分タブ側のDirtyフラグが消えない。

正しい呼び出し:
```typescript
// 正しい: diff:currentキーでHistoryが登録されているため同じキーで呼ぶ
this.table.getStore().markAllSaved(this.table.tableName);
```

**原因3: 通常タブへの反映がない**

差分タブ保存後に通常タブの再描画が行われない。
保存完了コールバックに通常タブの refresh 呼び出しが必要。

### 設計上の教訓
差分ビューのパディング行は「表示上の補完行」であり、保存すべきデータではない。
ストアには保存すべきデータのみを登録すべきで、パディング行をストアに混入させる設計はSSOT違反。

**How to apply:** 差分タブのストア登録時は保存対象行のみを登録する（パディング行インデックス `rightEmptyRowIndices` に対応する行を除外する）。storeRowIndices の管理も同時に修正が必要。
