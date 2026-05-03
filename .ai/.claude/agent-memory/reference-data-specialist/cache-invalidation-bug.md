---
name: cache-invalidation-missing-on-row-delete
description: ReferenceDataCache は行削除後に evictEntry が呼ばれず陳腐化する。削除操作の末尾で evictEntry を必ず呼ぶこと。
type: feedback
---

## BUG_0012: 削除済み行がプルダウン候補に残る問題

**ルール:** `EditorTableStructure.deleteRow()` / `deleteRows()` など行削除の実装の末尾で、必ず `referenceDataCache.evictEntry(tableName)` を呼ぶこと。

**Why:** `ReferenceDataCache.cache` は初回ロード時に `items` 配列を構築して保持する。ストアから行が削除されても `items` は更新されない。`evictEntry` を呼ばないと、次のドロップダウン表示時に古い `items` がそのまま使われる。

**How to apply:**
- `editor-table-structure.ts` の `deleteRow()` / `deleteRows()` の末尾
- または `editor-table.ts` の公開メソッド `removeRow()` / `removeRows()` の末尾
- `evictEntry()` は `cache` と `fullDataCache` の両方を削除するため一度の呼び出しで十分

### キャッシュ取得フロー（参照）
- ドロップダウン表示: `EditorTableHandler.enableCellEditModeWithDropdownAsync()` (editor-table-handler.ts:1043)
  → `referenceDataCache.get(tableName)` → キャッシュヒット時は `items` をそのまま返す
- `load()` は `getCsv()` 経由でストアの `rows` 同一参照を読み、`ReferenceItem[]` を構築する
  → 構築後の `items` はストアから独立したオブジェクト群なのでストア変更を自動反映しない

### evictEntry の既存呼び出し箇所
- タブクローズ時（未保存タブの CSV 巻き戻し）のみ呼ばれている
- 行削除・行挿入・セル編集時には呼ばれていない（行挿入も同様に要注意）
