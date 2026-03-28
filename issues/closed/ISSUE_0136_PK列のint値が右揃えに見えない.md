# ISSUE_0136 PK列のint値が右揃えに見えない

## 概要

PK列のint値が右揃えに表示されていない。FKやその他のint列は正しく右揃えで表示される。`cell-numeric`クラス自体は正しく付与されているが、逆参照ヒントspanのCSSレイアウトが原因で数値がセル右端に配置されない。

## 再現手順

1. FK参照を持つ子テーブルが存在するテーブル（例: weapon）を開く
2. PK列（id列、type=int）に逆参照ヒントが表示される
3. PK列の数値が右端ではなく、逆参照ヒントの左側に表示される

## 期待する動作

PK列のint値がFK列のint値と同じレイアウトで表示される:
- 数値がセル右端に配置される
- 逆参照ヒントがセル左側に配置される

## 現在の動作

- **FK列**: `[関東                    1]` — 参照ヒントが`float: left`で左に配置され、FK値が右端に表示される
- **PK列**: `[          1 →weapon(剣)]` — 逆参照ヒントがインラインで数値の右に配置され、数値が右端に来ない

## 根本原因

FK参照ヒントと逆参照ヒント（PK列）でCSSレイアウトの扱いが統一されていない。

### 非統一の2経路

| 観点 | FK参照ヒント | 逆参照ヒント（PK列） |
|------|-------------|---------------------|
| CSS | `.cell-numeric .cell-reference-hint { float: left; }` | `float`なし |
| DOM挿入 | `cell.prepend(hintSpan)` — セル先頭 | `cell.appendChild(hintSpan)` — セル末尾 |
| 生成場所 | `setCellValue()` L109-113 | `applyReverseReferenceHintFromEntries()` L345-348 |

### 該当ファイル

- `WebView/src/editor-table-reference.ts`
  - L109-113: FK参照ヒントの生成（`cell.prepend`）
  - L345-348: 逆参照ヒントの生成（`cell.appendChild`）
- `WebView/src/editor-table.css`
  - L258-263: `.cell-numeric .cell-reference-hint { float: left; }` — FK用のレイアウト
  - L267-271: `.cell-reverse-reference-hint` — `float`指定なし

## 対策案

逆参照ヒントにもFK参照ヒントと同等のCSSレイアウトを適用する:

```css
.cell-numeric .cell-reverse-reference-hint {
    float: left;
    max-width: calc(100% - 3em);
    overflow: hidden;
    text-overflow: ellipsis;
}
```

あわせてDOM挿入を`cell.prepend`に統一し、FK参照ヒントと同じパターンにすることも検討する。
