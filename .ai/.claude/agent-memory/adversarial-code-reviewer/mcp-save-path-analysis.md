---
name: MCP Save Path Analysis
description: MCP saveTableAsync vs normal Ctrl+S save path - missing post-save operations analysis (2026-03-26)
type: project
---

## MCP saveTableAsync vs 通常保存パスの後処理比較

### 通常保存パス (editor-table-handler.ts markSavedAndUpdatePanel L747-758)
1. `store.markAllSaved(tableName)` — History savedIndex更新 + タブボタンDirtyクリア
2. `relationsPanel.updateDirtyMark(tableName, false)` — RP上のDirtyマーク除去
3. `refreshGitDiffAsync()` — git差分ハイライト再計算
4. `tab.emitTableSaved(tableName)` — Tab経由でEditorAPI.emitTableSavedを呼ぶ
5. (通常テーブルのみ) `saveSchemaDataAsync(table)` — スキーマJSON列幅保存

### MCP保存パス (editor-api.ts saveTableAsync L367-384)
1. `store.markAllSaved(tableName)` — (tabState存在時のみ)
2. ~~updateDirtyMark~~ **欠落**
3. `refreshGitDiffAsync()` — (tabState存在時のみ)
4. tableSavedHandlers直接発火（Tab.emitTableSaved経由ではない）
5. ~~saveSchemaDataAsync~~ **欠落**

### 追加の問題: タブ未開封ケース
- tabState === null の場合、markAllSaved もスキップされる
- dirtyTableNames が残存し、次回タブオープン時に誤Dirty判定

**Why:** MCP経由の保存は元々refreshGitDiffAsyncが欠落していたバグの修正だが、markSavedAndUpdatePanelの全体像を把握せず一部だけ追加したため、さらに漏れが残った。

**How to apply:** MCP保存パスの修正時は、必ずmarkSavedAndUpdatePanelの全処理と比較して漏れがないか検証すること。理想的にはmarkSavedAndUpdatePanelを直接呼ぶか、共通の後処理関数に統合すべき。
