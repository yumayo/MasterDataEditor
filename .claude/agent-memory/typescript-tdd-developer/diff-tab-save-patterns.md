---
name: diff-tab-save-patterns
description: 差分タブ（DiffTab）の保存処理に関する設計パターンと落とし穴
type: feedback
---

## 差分タブの保存に関する3つの落とし穴（BUG_0023で修正）

### 落とし穴1: パディング行がCSVに保存される

**問題**: `buildMergedData()` が `deleted` 行に対して右ペインに `emptyRow(columnCount)` を生成し、この空行がストア（`"quest_reward:diff:current"` キー）にそのまま登録される。保存時に全行を書き出すと空行が CSV に混入する。

**修正方法**: 保存時に `.diff-row-empty` クラスを持つ行を動的に検出してストア行インデックスを計算し、`getCsvWithoutRows()` で除外する。

```typescript
// DiffTab に追加
computeCurrentRightPaddingStoreRowIndices(): readonly number[] {
    const rightElement = this.rightEditorTable.getTableElement();
    const storeRowIndices = this.rightEditorTable.getStoreRowIndices();
    const result: number[] = [];
    for (let i = 1; i < rightElement.children.length; i++) {
        const row = rightElement.children[i] as HTMLElement;
        if (row.classList.contains('diff-row-empty')) {
            const domDataRowIndex = i - 1;
            if (domDataRowIndex < storeRowIndices.length) {
                result.push(storeRowIndices[domDataRowIndex]);
            }
        }
    }
    return result;
}
```

**Why**: 行挿入・削除・Undo/Redo でパディング行のインデックスが変わるため、静的な `rightEmptyRowIndices` を初期化時に設定するのではなく、DOM状態からランタイムに計算する必要がある。

**How to apply**: `computeCurrentRightPaddingStoreRowIndices()` は `storeRowIndices.length` チェックでストア行が存在しない（通常のデータ行削除でパディング行に変換された行）をスキップする。`domDataRowIndex < storeRowIndices.length` が false なら除外不要（ストアにもう存在しない）。

### 落とし穴2: markAllSaved のキー不一致

**問題**: 差分タブ保存後に `markAllSaved(saveTargetTableName)` = `markAllSaved("quest_reward")` を呼ぶが、差分タブの History は `"quest_reward:diff:current"` キーで `historyRegistry` に登録されている。キーが不一致なのでエラーまたは Dirty が消えない。

**修正方法**: `markAllSaved(this.table.tableName)` を呼ぶ（`this.table.tableName = "quest_reward:diff:current"`）。

**How to apply**: `saveTargetTableName`（元テーブル名）と `this.table.tableName`（ストアキー）を混同しない。Dirty 解除は History が登録されているキー（ストアキー）で行う。

### 落とし穴3: 通常タブのストアが更新されない

**問題**: 差分タブ保存は CSV ファイルのみ更新するが、通常テーブルのストア（`"quest_reward"` キー）は更新しない。通常タブを開き直しても古いデータが表示される。

**修正方法**: 保存後に `store.reloadTableDataAsync(saveTargetTableName)` を呼んでストアを最新 CSV に更新する。ストアにキャッシュがある場合のみ（`store.hasTable()` が true）実行する。

`reloadTableDataAsync` は `refCount` が 0 でも `headers.has()` があれば（Dirty保持パス）更新を許可するよう変更済み。

## DiffTab の saveTargetTableName パターン

- `buildDiffEditorTable()` でストアキーは `"tableName:diff:current"` を使う（通常テーブルと衝突防止）
- `configureSaveTargetTableName(tableName)` でファイル保存先だけ元のテーブル名に上書き
- `EditorTableHandler` は `saveTargetTableName !== ''` で差分タブ専用の保存フローに入る
- `this.table.tableName`（ストアキー）と `this.saveTargetTableName`（ファイル保存先）は常に別物

## getDiffPaddingStoreRowIndices の連携パターン

```
EditorTableHandler.Ctrl+S
  → this.table.getDiffPaddingStoreRowIndices()
    → this.diffTab.computeCurrentRightPaddingStoreRowIndices()
      → DOM の .diff-row-empty を検索 → storeRowIndices で変換
  → saveDiffTableDataFromStoreAsync(..., paddingIndices)
    → store.getCsvWithoutRows(storeKey, paddingIndices)
```

循環依存を避けるため `EditorTableHandler` は `DiffTab` を直接インポートせず、`EditorTable.getDiffPaddingStoreRowIndices()` を経由する。
