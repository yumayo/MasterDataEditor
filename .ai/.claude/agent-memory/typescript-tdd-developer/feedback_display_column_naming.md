---
name: テストデータの表示列命名規約
description: FK参照テストデータの表示列は config.json の referenceDisplayColumnPriority に含まれる名前にする必要がある
type: feedback
---

テストデータでFK参照のヒント句（.cell-reference-hint）を検証する場合、参照先テーブルの表示列名は
`config.json` の `referenceDisplayColumnPriority: ["ja", "comment"]` に含まれる名前にしなければならない。

**Why:** `determineDisplayColumnName()` は優先度リストの列名のみを表示列として認識する。
`name` や `label` は優先度リストに含まれないため、`displayText === id` となりヒントが表示されない。

**How to apply:** FK参照テストデータを作成する際は、参照先テーブルの人間可読な列名を `ja` にする。
既存の正常動作テスト（reference-hint.spec.ts等）では `ja` が使われている。
