---
name: validation-panel-implementation-patterns
description: バリデーションパネル実装で発見したパターンと落とし穴
type: feedback
---

## バリデーションパネル実装パターン（FEAT_validation_panel）

### getComputedStyle が rgba を返す問題
`background-color: rgba(255, 40, 40, 0.18)` を設定すると Playwright の `getComputedStyle(el).backgroundColor` は `rgba(255, 40, 40, 0.18)` を返す。
テストパターン `/rgb\(25[0-5]/` は `rgba(` にはマッチしない（`rgb(` と `rgba(` の `a` の有無）。
**対策**: 背景色に alpha なしの `rgb(255, 60, 60)` を使う。

### EditorTable と ValidationPanel の相互参照パターン
`ValidationPanel` → `Tab.applyValidationErrorsToAll()` → `EditorTable.applyValidationErrors()` と1段経由する。
直接 `EditorTable` を `ValidationPanel` が import すると `editor-table.ts` ← `validation-panel.ts` ← `tab.ts` ← `editor-table.ts` の循環が生じる。
`Tab` を仲介者にすることで `ValidationPanel` が `EditorTable` を直接 import しなくて済む。

### Playwright の `toHaveClass(/cell-error/)` とは
`expect(cell).toHaveClass(/cell-error/)` はセルのクラスリストに `cell-error` が含まれているかを正規表現でチェックする。
`cell-pk-duplicate` など他のクラスが同時に付与されていても問題なくパスする。

### 新規クラスの CSS は `!important` で既存スタイルを上書き
`cell-error` は `cell-pk-duplicate` などと同時に付与される可能性がある。
`background-color: rgb(255, 60, 60) !important;` で他の背景色スタイルを確実に上書きする。

### `editor-table-cell-focused` クラスは Selection が管理
フォーカスセルの識別用クラス `editor-table-cell-focused` は `Selection.updateRenderer()` 末尾で付与・除去する。
`lastFocusedCell: HTMLElement | false` フィールドで前回のフォーカスセルを保持し、付け替えを行う。

**Why:** テストが `table.locator('.editor-table-cell-focused')` でジャンプ後のフォーカスセルを確認するため。

### ValidationPanel のスキーマ登録タイミング
`Tab.createEditorTable()` の末尾でスキーマを `ValidationPanel.registerSchema()` に登録し、`editorTable.validationPanel` を設定する。
`editorTable.initialize()` の時点では `validationPanel === false` なため、後方互換パスの `validatePkDuplicates()` が動作する。
問題なし。
