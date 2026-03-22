# ISSUE_0104: diff-row-addedとdiff-cell-addedの色を統一する

## 種別
改善

## 概要
`.editor-table-row.diff-row-added` と `.editor-table-cell.diff-cell-added` で異なる色が定義されているが、統一して `.diff-cell-added` 一本にする。`.editor-table-row` と `.editor-table-cell` で区別する必要はない。

## 対応内容

- `.diff-row-added` を廃止し、`.diff-cell-added` に統一する
- 行追加時も `.diff-cell-added` クラスを使用する
