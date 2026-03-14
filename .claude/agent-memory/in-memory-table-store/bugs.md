---
name: ミニテーブル行挿入時のストア列数不整合
description: ミニテーブルのDOM列数でストア行を挿入すると列数不足の行が混入する
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
