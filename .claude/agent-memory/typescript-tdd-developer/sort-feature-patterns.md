---
name: ソート機能の実装パターン
description: ColumnSorterクラスによるView変換ソートの設計と実装パターン
type: project
---

## ソートはView変換のみ（storeRowIndices の並び替え）
ソートはストアのデータ順序を変えず、`storeRowIndices` の並び替えで実現する。
DOM行を物理的に並び替えた後、`renumberRowsFrom(1)` で行番号を再設定する。

## ColumnSorterの設計

### SortKeyの構造
```typescript
interface SortKey {
    columnIndex: number;
    direction: SortDirection;  // 'asc' | 'desc'
    addedOrder: number;        // 追加順序（解除後の並べ直しに使用）
}
```

### 後勝ちルールの正しい実装
- 新規ソートは `sortKeys` 先頭に追加（最高優先度）
- 昇降順の変更は位置を変えない（優先度固定）
- 解除後は残った `sortKeys` を `addedOrder` 昇順で並べ直す

「解除後のaddedOrder昇順並び替え」が重要: 中間列を解除すると残りの列が追加された順序に整列される。
これにより「中間列解除後、後続列の優先度が繰り上がる」テストが通る。

### originalIndicesの管理
- 最初のソート追加時（`sortKeys.length === 0`）にのみ保存
- 全ソート解除時に返却してリセット（`nextAddedOrder`もリセット）
- `computeSortedIndices` は常に `originalIndices` のコピーをソートして返す

## data-store-index 属性
DOM行の `data-store-index` 属性はソート時のstoreIndex→DOM行マッピングに使用する。
以下の全ての行生成箇所で付与が必要:
- `initialize()` のデータ行生成
- `insertRowInternal()` の新規行挿入後
- `promoteBufferRowToStore()` のバッファ行昇格
- `reloadCellsFromStore()` のバッファ行昇格・新規行生成

## ミニテーブルへの非適用
`isMiniTableInstance()` で判定してソートインジケーターを追加しない。
`applySortForColumn()` はソートインジケーターが存在しないミニテーブルでは呼ばれない。

## sort-indicator のイベント
`click` イベントを使い `e.stopPropagation()` で列選択の `mousedown` と分離する。
