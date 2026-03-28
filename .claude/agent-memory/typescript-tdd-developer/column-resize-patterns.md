---
name: column-resize-patterns
description: 列リサイズ（D&D・dblclick）実装パターンと注意点
type: project
---

## 列リサイズの実装パターン

### AreaResizer の D&D と dblclick の排他制御

`dblclick` と D&D は `columnDragConfirmed` フラグで排他制御する。

- `mousedown` 時: `isResizingColumn = true`, `columnDragConfirmed = false`, ガイドライン表示
- `mousemove` 時: 移動距離 `>= DRAG_MIN_DISTANCE_PX (3px)` で `columnDragConfirmed = true`
- `mouseup` 時: `columnDragConfirmed = true` のときのみリサイズを実行
- `dblclick` 時: `isResizingColumn = false`, `columnDragConfirmed = false` でD&Dキャンセル → 自動幅調整

ガイドラインは mousedown 時から `display: block` で表示する（feat-0015 テストがmousedown後にguideline表示を検証するため）。
D&Dが確定しない（3px未満の移動）場合は mouseup 時にリサイズは行わないが、ガイドラインは非表示にする。

### 複数列選択時の一括幅変更

selection.isSelectingColumn() で判定し、getSelectionRange() で選択範囲を取得する。
- selection の column は 1始まり（行ヘッダーを含む DOM 列インデックス）
- EditorTable の columnIndex は 0始まり（行ヘッダーを除く）
- 変換: `colIndex = col - 1`

複数列を1回のUndoで戻せるよう `CompositeCommand` でラップする。
コマンドが1つだけの場合も `CompositeCommand` でも問題ないが、シンプルさのため単体コマンドを使う:
```typescript
const command = commands.length === 1 ? commands[0] : new CompositeCommand(commands);
```

### 自動幅計算（calculateAutoColumnWidth）

EditorTable に実装。バッファ空行（`editor-table-empty-row`）は除外する。
- セルテキスト幅: `CELL_FONT = '13px sans-serif'`
- 参照ヒント幅: `REFERENCE_HINT_FONT = '11.7px sans-serif'`（0.9em）+ `REFERENCE_HINT_MARGIN_PX = 4px`
- ヘッダー幅: `Utility.calculateColumnWidth(name, !isMiniTable)` で計算
- 最終値: `Math.max(maxCellWidth, MIN_COLUMN_WIDTH_PX)`

**Why:** Canvas API は DOM に描画せずにテキスト幅を計測できるため、DOMのレイアウト依存なく正確な幅が得られる。

**How to apply:** 新しい自動幅計算が必要になったら EditorTable.calculateAutoColumnWidth を呼ぶ。
