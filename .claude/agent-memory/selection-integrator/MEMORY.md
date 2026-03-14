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
- `updateRenderer()` はスクロールに触れない（CSSポジション更新のみ）
- `notifyRowSelectionChanged` は `updateRenderer()` の末尾で呼ばれる（EditorTable 経由で RelationsPanel へ）

## 既知のバグ（未修正）

### BUG: `scrollCellIntoView` の `requestAnimationFrame` 競合
**ファイル:** `selection.ts` 614-628行目
**症状:** 複数の `scrollCellIntoView` が連続して呼ばれると、古い rAF コールバックが新しいスクロール位置を上書きする。
**修正方針:** `private scrollRafId: number = 0` フィールドを追加し、新しい呼び出し時に `cancelAnimationFrame(this.scrollRafId)` してから再登録する。

## 調査記録: セル編集確定後のスクロール (0,0) リセット問題（2026-03-15）

### 症状
1024x768 画面で95行目（右端列）を編集・確定するとスクロール位置が (0,0) にリセットされる。

### Selection 担当範囲の調査結果
- `scrollCellIntoView` の計算ロジック（593-603行目）は正常
- `requestAnimationFrame` 競合バグあり（614-628行目）← 修正必要
- `move()` 後のスクロール計算に負値クランプが欠如（高スクロール位置で誤動作する可能性）

### 真の原因（Selection管轄外）
`editor-table-handler.ts:267` の `this.element.focus({ preventScroll: true })` が、
`hide()` 後（`top: -99999px`）の `contenteditable` 要素に対して呼ばれると、
WebView2 の特定ビルドでスクロールコンテナの `scrollTop/scrollLeft` が 0 にリセットされる可能性が高い。

**協調が必要:** `editor-table-integrator` エージェントに `editor-table-handler.ts` の
`onFocusout` → `focus()` パスを調査依頼すること。

### フロー図（Enter確定時）
```
keydown(Enter)
  → submitText()         // セル値確定
  → hide()               // grid-textfield を top:-99999px へ（フォーカスは失われない）
  → moveCellDownWithinSelection()  // 例: row=96 へ
     → selection.move(96, col)
        → scrollFocusIntoView()
        → scrollCellIntoView(96, col)
           [ここで rAF 競合バグが影響する可能性]
--- keydown 完了 ---
[非同期] blur/focusout 発火（別操作によりフォーカスが移った場合）
  → onFocusout(editor-table-handler.ts:224)
     → this.element.focus({ preventScroll: true })
        [WebView2 バグ: scrollTop/scrollLeft が 0 にリセットされる]
```
