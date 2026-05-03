---
name: BUG_0022 差分ビューパディング行高さ修正レビュー
description: createPaddingRow()共通化によるパディング行高さ1px未満バグ修正のUXレビュー（2026-03-16）
type: project
---

BUG_0022修正（createPaddingRow共通化）のUXレビュー結果。評価: A

**Why:** 右ペインで行挿入時に左ペインへ挿入するパディング行の高さが1px未満になる不具合の修正。手書きDOM生成をeditor-table.tsのcreatePaddingRow()に共通化した。

**How to apply:** 差分ビューパディング行のDOM構造チェック時に参照。

## 確認済みDOM構造（正常）

パディング行 `.diff-row-empty.diff-row-padding-inserted` の各セルに明示的なheight指定あり:
```
height: 20px; min-height: 20px; max-height: 20px; line-height: 20px;
```
通常行と完全一致しており、高さ問題は解消済み。

## 確認したダンプ

- bug-diff-tab-padding-row-height / 右ペインで3行選択して下に3行挿入した後...: 3本のパディング行すべてが height:20px で正常
- diff-tab-padding-sync / 右ペインで行を挿入すると左ペインの同一位置に...: 1本パディング行が height:20px で正常
- diff-tab-padding-sync / Undo/Redoテスト: Undo後にパディング行が除去され、Redo後に再生成、いずれも height:20px

## 残課題（継続指摘）

1. 左ペインの読み取り専用表示がDOM上なし（aria-readonlyなし）— 継続指摘
2. パディング行のrow-resize-handleが存在する → ラウンド1で解消確認済み（除去された）
3. パディング行の data-row 属性値が飛び番（3行挿入テストで data-row="4" が欠番）— 観察情報
4. 左ペインの editor-table--inactive クラス付与が、削除ケースUndo後には付与あり、通常挿入ケース直後には付与なし（非対称）— 継続指摘
5. 削除でバッファ化された diff-row-empty と新規挿入後バッファ行の diff-row-empty が同一クラス（意味の区別なし）— 新規指摘

## ラウンド1確認（2026-03-16 フィードバックループ対応）

- row-resize-handle がパディング行から除去されたことをDOMで確認済み
- 全テストケース（3行挿入、1行挿入、1行削除、Undo/Redo）でパディング行高さ20pxを確認
- 左右ペインの行数対応が全シナリオで一致していることを確認
