---
name: スキーマ変更コマンドパターン
description: EditorTableContextMenu から History 経由で Command を実行する方法
type: project
---

## EditorTableContextMenu から Undo/Redo 対応コマンドを実行する方法

`EditorTableContextMenu` は `History` を直接保持しない。
そのため `EditorTable` に `executeSchemaCommand(command: Command): void` を追加し、
内部の `this.history.executeCommand(command, range, copyRange)` を呼ぶ形にする。

```typescript
// editor-table.ts に追加
executeSchemaCommand(command: Command): void {
    const anchor = this.selection.getAnchor();
    const copyRange = this.selection.getCopyRange();
    const range = {startRow: anchor.row, startColumn: anchor.column, endRow: anchor.row, endColumn: anchor.column};
    this.history.executeCommand(command, range, copyRange);
}
```

コンテキストメニュー側:
```typescript
const col = this.table.getColumn(contextMenuColumnIndex);
const cmd = new RenderAsHtmlToggleCommand(col, this.table, contextMenuColumnIndex);
this.table.executeSchemaCommand(cmd);
```

**Why:** EditorTableStructure は History を直接持つが、EditorTableContextMenu は持たない。
デメテルの法則を守るため EditorTable をファサードとして経由する。

## innerHTML セルの生テキスト取得パターン

renderAsHtml モードのセル（innerHTML でレンダリング）は、生テキストを `data-raw-value` 属性に保存する。
`EditorTable.getCellValue` で `data-raw-value !== undefined` なら最優先でそれを返す。

モード切替時（renderAsHtml → false）は `delete cell.dataset.rawValue` でクリアする。
