---
name: virtual-scroll-integration-issues
description: バーチャルスクロール導入時に発生する統合問題のパターンと修正方法
type: project
---

## バーチャルスクロール統合で発生した問題と修正

### 1. getCellPosition のDOMインデックスずれ
**問題:** `getCellPosition` が `children` のインデックスで行位置を返すが、バーチャルスクロールでは `children` のインデックスが論理行インデックスと一致しない。
**修正:** 行ヘッダーの `data-row-index` 属性から論理行インデックスを取得する。

### 2. ensureTrailingBufferRow 後の renderedEnd 未更新
**問題:** バッファ行昇格→新バッファ行追加で `renderedEnd` が更新されず、`dataRowToDomIndex` が新行を「範囲外」と判定する。
**修正:** `VirtualScrollController.notifyRowAppended()` / `notifyRowRemoved()` で `renderedEnd` を同期する。

### 3. recalculate でのスクロール位置リセット
**問題:** `updateRenderedRows` でDOM行が削除・挿入されると、ブラウザが `grid-textfield`（top:-99999px の contenteditable）に向かって自動スクロールし `scrollTop` が 0 にリセットされる。
**修正:** `recalculate` でDOM操作前に `scrollTop` を保存し、操作後に復元する。

### 4. enableCellEditMode でのDOM不在
**問題:** `enableCellEditMode` → `getTarget` → `getCellRectAt` → `getCell` で、バーチャルスクロールによりDOMに行が存在しない。
**修正:** `enableCellEditMode` の先頭で `ensureRowVisible(focus.row)` を呼んで行をDOMに確保する。

### 5. テストの data-store-index 対応
scroll-position テストは `nth(rowIndex+1)` でDOM位置ベースの行取得をしていたが、バーチャルスクロールではDOM位置が論理インデックスと一致しない。`data-store-index` 属性で行を特定するように変更。

**Why:** バーチャルスクロールは従来のDOM構造の前提を根本的に変えるため、DOM位置ベースのアクセスは全て論理インデックスベースに変更が必要。
**How to apply:** 新しいテストを書く際は `data-store-index` 属性で行を特定し、スクロール後にバーチャルスクロールの再計算を待つ（`dispatchEvent(new Event('scroll'))` + `requestAnimationFrame`）。
