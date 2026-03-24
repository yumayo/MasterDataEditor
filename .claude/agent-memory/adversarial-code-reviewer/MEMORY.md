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
- `/WebView/src/relations-panel.ts` - Right pane relations
- `/WebView/src/reference-data-cache.ts` - FK reference cache
- `/WebView/src/plugin-validation-runner.ts` - Plugin validation (new Function execution)

## Recurring Review Patterns (Top Priority)
- **awaitポイント後のrequestIdチェック**: **9回再発** (+PluginValidation runAndUpdate .then())
- **register/unregister 非対称**: **3回再発**
- **CSS hardcoded colors**: 17+ 回再発 (+plugin validation-panel.css L72-76)
- **フォールバック禁止 (??)**: 17+ 回再発
- **生焼けオブジェクト | false + connect パターン**: 7回再発 (+ValidationPanel.pluginRunner)
- **undefined比較 (Map.get)**: api.ts gitShowCache.get() !== undefined
- **fire-and-forget Promise without .catch()**: 複数箇所
- **document listener leak (anonymous arrow)**: removeEventListener不可
- **コピペコード**: SchemaEntry→TableSchema変換, parseCsv, PK解決ロジック等
- **try/catch なし async**: searching/loading状態が永続固着するパターン
- **同期メソッド内の.then()非同期化**: runAndUpdate()内で.then()使用+requestIDガードなし

## Plugin Validation Known Patterns (2026-03-25)
- new Function() is NOT sandboxed — full access to window/document/globalThis
- runAndUpdate() sync→async via .then() without requestId guard (9th recurrence)
- pluginRunner = false + connectPluginRunner() is half-baked object (7th recurrence)
- Proxy get handler typed as string but prop can be symbol
- No infinite loop protection for plugin code
- buildRowObjects has no caching — O(n) per all()/where()/find() call per plugin

## Structural Concerns
- **store.getHeader/getRows returns internal reference**: caller mutation corrupts store
- **Csv class**: half-baked object pattern (10+ instances)
- **GridDropdownInput.element is public HTMLElement**: legacy debt

## CSS Variables
- Defined: --font-color, --background-color, --background-sub-color, --border-color, --selection-color, --selection-font-color, --scroll-bar-background-color, --focus-border, --error-color, --error-bg, --error-border
- NOT defined: --warning-color, --warning-bg, --warning-border (needed for plugin errors)

## Review History
-> See `known-issues-archive.md` for details
- (2026-03-25) Plugin Validation: 致命的4件、重要5件、軽微4件
- (2026-03-24) RP Visibility Toggle: 致命的3件、重要4件、軽微3件
- (2026-03-24) Initial Scan: 致命的4件、重要4件、軽微2件
- (2026-03-21) Diff Tab Save Highlight, FormPanel Drilldown, etc.
- (2026-03-20) ResizeHandle, ISSUE_0080, config refactor, FEAT_0047/0048
- (2026-03-19) FEAT_0047 Navigation, FEAT_0045 Notification
- (2026-03-18) FEAT_0043 FormPanel, FEAT_0042 HTML render, FEAT_0040 search
- (2026-03-17) FEAT_0038 fuzzy-search, FEAT_0036 resize
