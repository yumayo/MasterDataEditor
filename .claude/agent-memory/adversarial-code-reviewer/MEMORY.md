# Adversarial Code Reviewer Memory

## Project Architecture
- Frontend: Vanilla TypeScript (no framework), DOM is SSOT
- Backend: C#
- Design: Intentionally tightly coupled, Command pattern for Undo/Redo
- WebView2 (Microsoft browser control) used for frontend hosting

## C# Security Patterns
-> See `csharp-security-patterns.md`

## Key Files
- `/WebView/src/editor-table.ts` - Core table + storeRowIndices
- `/WebView/src/tab.ts` - Tab management, EditorTable factory, pane stack
- `/WebView/src/in-memory-table-store.ts` - Central data store + refCount + Dirty management
- `/WebView/src/validation-engine.ts` - PK/FK/type validation logic
- `/WebView/src/validation-panel.ts` - Validation UI + runAndUpdate + runInitialScanAsync
- `/WebView/src/editor-api-types.ts` - SchemaEntry, EditorAPI types
- `/WebView/src/editor-api.ts` - EditorAPI impl (data/schema/edit/events namespaces)
- `/WebView/src/relations-panel.ts` - Right pane relations
- `/WebView/src/reference-data-cache.ts` - FK reference cache
- `/WebView/src/plugin-validation-runner.ts` - Plugin validation (Web Worker sandbox)
- `/WebView/src/reference-expression.ts` - DynamicReferenceSchema + parseReferenceExpression
- `/WebView/src/model/editor-table-data-column.ts` - Column model with reference: string | DynamicReferenceSchema | null
- `/WebView/src/editor-table-handler.ts` - Keyboard/mouse handler, markSavedAndUpdatePanel

## Recurring Review Patterns (Top Priority)
- **awaitポイント後のrequestIdチェック**: **9回再発** (+PluginValidation runAndUpdate .then())
- **register/unregister 非対称**: **3回再発**
- **CSS hardcoded colors**: 17+ 回再発 (+plugin validation-panel.css L72-76)
- **フォールバック禁止 (??)**: 17+ 回再発
- **生焼けオブジェクト | false + connect パターン**: 7回再発 (+ValidationPanel.pluginRunner)
- **undefined比較 (Map.get)**: api.ts gitShowCache.get() !== undefined
- **fire-and-forget Promise without .catch()**: 複数箇所
- **document listener leak (anonymous arrow)**: removeEventListener不可
- **コピペコード**: SchemaEntry→TableSchema変換, parseCsv, PK解決, **PluginError変換**, **refreshGitDiffAsync .catch(4箇所)**
- **try/catch なし async**: searching/loading状態が永続固着するパターン
- **同期メソッド内の.then()非同期化**: runAndUpdate()内で.then()使用+requestIDガードなし
- **型定義の変更波及漏れ**: reference型変更時にrelations-panel, search-data-provider等の型アサーションが未更新
- **C# MCP出力のエッジケース未対応**: rowIndex=-1時のフォーマット崩壊 (ValidationTool.cs)
- **MCP保存パスの後処理不足**: markSavedAndUpdatePanel相当の処理がMCPパスに未実装 (2026-03-26)

## MCP Save Path vs Normal Save Path (2026-03-26)
-> See `mcp-save-path-analysis.md`
- markSavedAndUpdatePanel (normal): markAllSaved + updateDirtyMark + refreshGitDiffAsync + emitTableSaved
- MCP saveTableAsync: markAllSaved + refreshGitDiffAsync only (missing updateDirtyMark, saveSchemaDataAsync)
- Tab-closed case: dirtyTableNames not cleared after MCP save
- Mini EditorTable git diff not updated (emitTableSaved goes to handlers only, not Tab)

## DynamicReferenceSchema Migration Patterns (2026-03-25, updated 2026-03-27)
- reference型は `string | DynamicReferenceSchema | null` に統一済み
- **destColumn動的解決 (2026-03-27)**: destColumnも動的解決に変更。セマンティクスが「列名そのもの」→「列名を格納するカラム名」に変化
- **未更新箇所**: FKバッジのツールチップ(editor-table-structure.ts L620)がdestColumn間接参照の意味を反映していない
- **main.ts起動バリデーション**: createSchemaEntryFromJson が動的参照をスキップ→起動時FKバリデーション漏れ（**依然未修正**）
- **EditorAPI**: getReferences/getRelatedTablesAsync が動的参照列を完全に無視（SchemaEntry.references由来のため）
- **serialize() roundtrip**: reference: null がJSONに出力され元スキーマを汚染
- reference-data-cache.ts: Record<string, unknown>→as DynamicReferenceSchemaキャスト (型安全性不足)
- search-data-provider.ts: 動的参照→空文字列変換が2箇所でコピペ

## Plugin Validation Known Patterns (2026-03-25)
- Plugin runs in Web Worker sandbox (plugin-sandbox.ts) — no window/document access
- runAndUpdate() sync→async via .then() without requestId guard (9th recurrence)
- pluginRunner = false + connectPluginRunner() is half-baked object (7th recurrence)
- Proxy get handler typed as string but prop can be symbol
- No infinite loop protection for plugin code (timeout 10s via Worker terminate)
- buildRowObjects has no caching — O(n) per all()/where()/find() call per plugin
- **convertPluginErrors duplicated**: editor-api.ts L209-233 vs validation-panel.ts L307-340 (value field diverged)
- **editor-api.ts plugin error conversion has no try/catch**: engine results lost on runAllPluginsAsync rejection

## Structural Concerns
- **store.getHeader/getRows returns internal reference**: caller mutation corrupts store
- **Csv class**: half-baked object pattern (10+ instances)
- **GridDropdownInput.element is public HTMLElement**: legacy debt
- **SchemaEntry.references omits dynamic refs**: createSchemaEntryFromJson only handles string references

## CSS Variables
- Defined: --font-color, --background-color, --background-sub-color, --border-color, --selection-color, --selection-font-color, --scroll-bar-background-color, --focus-border, --error-color, --error-bg, --error-border
- NOT defined: --warning-color, --warning-bg, --warning-border (needed for plugin errors)

## Review History
-> See `known-issues-archive.md` for details
- (2026-03-27) destColumn動的解決: 致命的2件、重要5件、軽微3件
- (2026-03-26) MCP Save Git Diff: 致命的2件、重要2件、軽微3件
- (2026-03-25) EditorAPI getValidationErrorsAsync + Plugin: 致命的2件、重要4件、軽微3件
- (2026-03-25) DynamicReferenceSchema Migration: 致命的2件、重要4件、軽微3件
- (2026-03-25) Plugin Validation: 致命的4件、重要5件、軽微4件
- (2026-03-24) RP Visibility Toggle: 致命的3件、重要4件、軽微3件
- (2026-03-24) Initial Scan: 致命的4件、重要4件、軽微2件
- (2026-03-21) Diff Tab Save Highlight, FormPanel Drilldown, etc.
- (2026-03-20) ResizeHandle, ISSUE_0080, config refactor, FEAT_0047/0048
- (2026-03-19) FEAT_0047 Navigation, FEAT_0045 Notification
- (2026-03-18) FEAT_0043 FormPanel, FEAT_0042 HTML render, FEAT_0040 search
- (2026-03-17) FEAT_0038 fuzzy-search, FEAT_0036 resize
