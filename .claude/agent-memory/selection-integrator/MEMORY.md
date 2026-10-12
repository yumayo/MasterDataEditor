# Selection Integrator エージェントメモリ

## 担当ファイル
- `WebView/src/selection.ts`
- `WebView/src/selection-drag-controller.ts`
- `WebView/src/fill-controller.ts`（存在する場合）
- `WebView/src/fill-series.ts`（存在する場合）

## 主要インターフェース

### Selection の public メソッド一覧
- `move(row, column)` — フォーカス移動 + `scrollFocusIntoView()` + `updateRenderer()`
- `start(row, column)` — 選択開始（スクロールなし、`updateRenderer()` のみ）
- `setRange(startRow, startColumn, endRow, endColumn)` — 選択範囲設定（スクロールなし）
- `extendSelection(row, column)` — 選択範囲拡張（絶対座標）
- `extendSelectionOffset(x, y, maxRow, maxColumn)` — 選択範囲拡張（相対座標）+ `scrollCellIntoView`
- `selectColumn(column)`, `selectRow(row)` — 列/行全体選択
- `extendToColumn(column)`, `extendToRow(row)` — アンカーから拡張
- `selectAll()` — 全セル選択
- `updateColumn(column)`, `updateRow(row)` — ドラッグ中の列/行選択更新
- `copy()`, `clearCopyRange()`, `setCopyRange(range)` — コピー範囲管理
- `startFill(row, column, mouseX, mouseY)` — フィル開始
- `updateFill(row, column, mouseX, mouseY)` — フィル更新
- `endFill()` — フィル終了
- `getFillInfo()` — フィル方向・範囲取得
- `updateRendererAfterResize()` — リサイズ後の再描画

### 重要な設計ルール
- `move()` だけが `scrollFocusIntoView()` を呼ぶ（start/setRange/extendSelection は呼ばない）
- `updateRenderer()` はスクロールに触れない（CSSクラス付与のみ）
- `notifyRowSelectionChanged` は `updateRenderer()` の末尾で呼ばれる（EditorTable 経由で RelationsPanel へ）

## 選択範囲レンダリングの実装方式（擬似要素ベース）

### 2026-04-02 に オーバーレイdiv → CSS擬似要素 に移行

**変更の動機:** float座標計算による誤差の排除

**廃止した要素:**
- `selection.element`（`.selection` div）— selection.ts から削除
- `selection.copyBorderElement`（`.copy-border` div）— selection.ts から削除
- `topBackground`, `bottomBackground`, `leftBackground`, `rightBackground` — 削除
- `updateBackgroundElements`, `updateBackgroundElement`, `hideBackgroundElements` — 削除

**維持した要素:**
- `selection.fillPreviewElement`（`.fill-preview` div）— オーバーレイのまま維持
- `selection.fillHandle`（`.fill-handle` div）— オーバーレイのまま維持

**新しい仕組み:**
- EditorTable に `applySelectionClasses(range, focusRow, focusCol)` / `clearSelectionClasses()` を追加
- EditorTable に `applyCopyClasses(range)` / `clearCopyClasses()` を追加
- `lastSelectionCells: { row, col, classes }[]` フィールドで前回付与したクラスを追跡
- `lastCopyCells: { row, col, classes }[]` フィールドで前回付与したクラスを追跡
- セルに `position: relative` を付与（editor-table.css）して擬似要素のアンカーにする

**CSS クラスの意味:**
- `sel-bg` — 選択範囲の背景色（フォーカスセルは除外）
- `sel-top`, `sel-bottom`, `sel-left`, `sel-right` — 選択範囲の各辺のボーダー（::before で描画）
- `copy-top`, `copy-bottom`, `copy-left`, `copy-right` — コピー範囲の各辺のボーダー（::after で描画）

**非アクティブテーブル:** `editor-table--inactive` クラスが EditorTable 要素に付与されるため、
`editor-table--inactive .sel-bg` のように **子孫セレクタ**で灰色に変更できる（オーバーレイ方式の `~` 兄弟セレクタは不要）。
fill-handle / fill-preview はオーバーレイのままなので `~` セレクタを維持している。

**tab.ts/diff-tab.ts の変更:** `wrapperElement.appendChild(selection.element)` と
`wrapperElement.appendChild(selection.copyBorderElement)` の2行を削除。

## 修正済みパターン

### Command実行後の選択状態更新（ISSUE_0139 / b7d656b）
- `executeCommand()` はCommand実行とHistory記録のみ。Selection の更新は呼び出し元が担う
- 行移動のように「対象が物理的に移動する操作」では、Command実行後に移動先行を `selectRow()` で選択するのが正しい挙動
- `row-drag-controller.ts` の `handleMouseUp()` に `this.selection.selectRow(to + 1)` を追加して修正済み
- `to` は「fromを抜いた後の0始まりdomDataRowIndex」→ `+1` で1始まりのselection行番号になる

## 既知のバグ（未修正）

### BUG: `scrollCellIntoView` の `requestAnimationFrame` 競合
**症状:** 複数の `scrollCellIntoView` が連続して呼ばれると、古い rAF コールバックが新しいスクロール位置を上書きする。
**修正方針:** `private scrollRafId: number = 0` フィールドを追加し、新しい呼び出し時に `cancelAnimationFrame(this.scrollRafId)` してから再登録する。

## 調査記録: セル編集確定後のスクロール (0,0) リセット問題（2026-03-15）

### 症状
1024x768 画面で95行目（右端列）を編集・確定するとスクロール位置が (0,0) にリセットされる。

### 真の原因（Selection管轄外）
`editor-table-handler.ts:267` の `this.element.focus({ preventScroll: true })` が、
`hide()` 後（`top: -99999px`）の `contenteditable` 要素に対して呼ばれると、
WebView2 の特定ビルドでスクロールコンテナの `scrollTop/scrollLeft` が 0 にリセットされる可能性が高い。

**協調が必要:** `editor-table-integrator` エージェントに `editor-table-handler.ts` の
`onFocusout` → `focus()` パスを調査依頼すること。
