---
name: virtual-scroll-patterns
description: VirtualScrollController実装パターン — 方式B（テーブル内topSpacer）でのEditorTable統合の注意点
type: project
---

## VirtualScrollController（方式B: テーブル内topSpacer）

### DOM構造
```
.tab-wrapper (data-tab-name="xxx")
  .editor-table (display: table)
    .editor-table-column-header-row            ← 常時存在（position: sticky; top: 0）
    .virtual-scroll-top-spacer (display:table-row) ← テーブル内 children[1]（enabled=true のみ）
      .virtual-scroll-top-spacer-cell (height: Xpx)
    .editor-table-row (visible data rows only) ← 表示範囲のみ children[2..]
  .virtual-scroll-bottom-spacer (height: Ypx)  ← テーブル外（enabled=true のみ）
  .filter-row-count
  selection overlay elements...
```

### enabled=true 時の children インデックス体系
topSpacer がテーブル内 children[1] にあるため:
- children[0] = ヘッダー行
- children[1] = topSpacer（display:table-row）
- children[2..N] = データ行（表示範囲のみ）
- spacerCount() = 1（enabled=true）、0（enabled=false）
- DATA_ROW_START_INDEX = 2

### topSpacer テーブル内配置の理由と注意点
topSpacer をテーブル内に配置することで、stickyヘッダー行の自然位置が常に0になり、
高速スクロール中にヘッダーが画面下に落ちる問題を解決する。

**scrollTop リセット問題**: topSpacer（display:table-row）の高さ変更と行入れ替え後、
ブラウザの非同期 display:table レイアウト再計算で scrollTop が 0 にリセットされることがある。
- `ensureRowVisible()` では scrollTop 変更時に rAF で復元コールバックを登録する
- テスト（Playwright）では `waitForFunction` でポーリングして scrollTop が安定するのを待つ

### totalRowCount にはバッファ行を含めること
`updateTotalRowCount()` に渡す値はバッファ行を含むDOM上の総データ行数。
バッファ行を含めないと `forceRecalculate()` 時にバッファ行がDOMから削除される。
- 通常テーブル初期化: `Math.max(emptyRowCount, storeRowIndices.length)`
- 差分テーブル（emptyRowCount=0）: `storeRowIndices.length` がそのまま使われる

### 重要な設計判断
1. **getRowElement の変換**: domRowIndex=0 はヘッダー、1以降は dataRowToDomIndex() で実DOM位置に変換
2. **dataRowToDomIndex**: enabled=false → `dataRowIndex + 1`、enabled=true → 表示範囲内なら `dataRowIndex - renderedStart + DATA_ROW_START_INDEX`、範囲外なら `null`
3. **renderRow コールバックの設定タイミング**: Object.Assign パターンの問題で、コンストラクタではなく `initializeModules()` 内で `connectRenderRow()` を呼ぶ
4. **スペーサー配置**: `attachSpacers()` は `initialize()` 内のヘッダー行追加直後に呼ぶ（データ行追加前に必要）
5. **初期状態**: 全行がDOMに存在（renderedStart=0, renderedEnd=totalRowCount）。forceRecalculate() でビューポート内のみに削減される

### Object.Assign パターンとコールバックの注意
EditorTable は `Object.assign(proxy, realInstance)` で構築される。コンストラクタ内のクロージャは `realInstance` の `this` を捕捉するため、`storeRowIndices` 等のプロキシ側で更新されるフィールドを正しく参照できない。
- `renderRow` コールバック → `initializeModules()` で `connectRenderRow()` を使って設定
- `FilterDropdown` → `initializeModules()` で再作成
- `RowDragController` → `initializeModules()` で再作成

**Why:** realEditorTable の storeRowIndices は [] のまま initialize() が呼ばれないため、コールバック経由で旧オブジェクトのデータを参照してしまう
**How to apply:** VirtualScrollController に新しいコールバックやフィールド参照を追加する場合、Object.Assign 後のプロキシオブジェクトの this を使うこと
