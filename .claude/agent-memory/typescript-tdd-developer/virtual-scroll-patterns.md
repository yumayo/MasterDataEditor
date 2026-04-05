---
name: virtual-scroll-patterns
description: VirtualScrollController実装パターン — 方式B（テーブル外スペーサー）でのEditorTable統合の注意点
type: project
---

## VirtualScrollController（方式B: テーブル外スペーサー）

### DOM構造
```
.tab-wrapper (data-tab-name="xxx")
  .virtual-scroll-top-spacer (height: Xpx)   ← テーブル外（enabled=true のみ）
  .editor-table (display: table)
    .editor-table-column-header-row            ← 常時存在（position: sticky; top: 0）
    .editor-table-row (visible data rows only) ← 表示範囲のみ
  .virtual-scroll-bottom-spacer (height: Ypx)  ← テーブル外（enabled=true のみ）
  .filter-row-count
  selection overlay elements...
```

### enabled=true 時の children インデックス体系
方式Bではスペーサーがテーブル外にあるため、テーブル内の children インデックスは従来と同一:
- children[0] = ヘッダー行
- children[1..N] = データ行（表示範囲のみ）
- spacerCount() = 常に 0

### 重要な設計判断
1. **getRowElement の変換**: domRowIndex=0 はヘッダー、1以降は dataRowToDomIndex() で実DOM位置に変換
2. **dataRowToDomIndex**: enabled=false → `dataRowIndex + 1`、enabled=true → 表示範囲内なら `dataRowIndex - renderedStart + 1`、範囲外なら `null`
3. **renderRow コールバックの設定タイミング**: Object.Assign パターンの問題で、コンストラクタではなく `initializeModules()` 内で `connectRenderRow()` を呼ぶ
4. **スペーサー配置**: `attachSpacers()` は `appendTo()` 後に呼ぶ（テーブル要素が親に追加されている必要がある）
5. **初期状態**: 全行がDOMに存在（renderedStart=0, renderedEnd=totalRowCount）。スクロールで recalculate() が呼ばれるまで Phase 1 と同じ動作

### Object.Assign パターンとコールバックの注意
EditorTable は `Object.assign(proxy, realInstance)` で構築される。コンストラクタ内のクロージャは `realInstance` の `this` を捕捉するため、`storeRowIndices` 等のプロキシ側で更新されるフィールドを正しく参照できない。
- `renderRow` コールバック → `initializeModules()` で `connectRenderRow()` を使って設定
- `FilterDropdown` → `initializeModules()` で再作成
- `RowDragController` → `initializeModules()` で再作成

**Why:** realEditorTable の storeRowIndices は [] のまま initialize() が呼ばれないため、コールバック経由で旧オブジェクトのデータを参照してしまう
**How to apply:** VirtualScrollController に新しいコールバックやフィールド参照を追加する場合、Object.Assign 後のプロキシオブジェクトの this を使うこと
