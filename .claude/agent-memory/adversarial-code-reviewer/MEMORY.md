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

## Recurring Review Patterns (Top Priority)
- **awaitポイント後のrequestIdチェック**: **8回再発** (FEAT_0038,0040,DiffTab,ISSUE_0089-0091,InitialScan)
- **register/unregister 非対称**: **3回再発** (ISSUE_0107 DiffTab schema, InitialScan refCount)。registerがあればunregisterが必須（bug-report.md パターン2）
- **CSS hardcoded colors**: 14+ 回再発
- **フォールバック禁止 (??)**: 17+ 回再発 (source-control-panel.ts L99 追加)
- **生焼けオブジェクト | false + connect パターン**: 6回再発 (Editor.relationsPanel 追加)
- **undefined比較 (Map.get)**: api.ts gitShowCache.get() !== undefined パターン追加
- **fire-and-forget Promise without .catch()**: 複数箇所
- **document listener leak (anonymous arrow)**: removeEventListener不可
- **コピペコード**: SchemaEntry→TableSchema変換, parseCsv, PK解決ロジック等
- **try/catch なし async**: searching/loading状態が永続固着するパターン

## Structural Concerns
- **store.getHeader/getRows returns internal reference**: caller mutation corrupts store
- **Csv class**: half-baked object pattern (10+ instances)
- **GridDropdownInput.element is public HTMLElement**: legacy debt

## Initial Scan (runInitialScanAsync) Known Patterns (2026-03-24)
- **CRITICAL**: registerTableAsync で全テーブルの refCount を +1 するが unregisterTable がない → メモリリーク。タブ閉じても refCount が 0 にならずデータ永久常駐
- **CRITICAL**: refCount リークにより unregisterTable の Dirty 判定ブロック(next<=0)に到達しない → Dirty データ巻き戻しも機能しない
- **CRITICAL**: fire-and-forget + forループ内 await で各 yield 間にタブオープンが競合 → runAndUpdate() が互いの結果を上書き（requestId パターンなし = 8回目の再発）
- **CRITICAL**: ループ途中で registerTableAsync が例外 → 一部テーブルだけ refCount 増加+スキーマ登録の中途半端状態。個別 try/catch なし
- **IMPORTANT**: ValidationPanel がストアの registerTableAsync を直接呼ぶのは責務違反（データロードはストア/Tabの責務）
- **IMPORTANT**: SchemaEntry→reference 文字列の分解→再結合が冗長。SchemaEntry→TableSchema 変換関数を共通化すべき
- **IMPORTANT**: テストが PK重複のみ。FK参照切れ・型不一致のテストケースなし

## FEAT-specific Known Patterns (details in known-issues-archive.md)
- FEAT_0036 Column Auto-Resize: area-resizer.ts MIN_COLUMN_WIDTH_PX(50px) vs Math.max(20,...) 未修正
- BUG_0021: editor-table.ts updateFullDataCell に column-1(DOM列)を渡す問題
- FEAT_0042 HTML Cell Render: sanitizeHtml placeholder attack surface
- FEAT_0043 FormPanel: ?? 8箇所、コピペ、loadFkSectionDataAsync regex parse
- FEAT_0045 Notification: window.Notification 上書き、setTimeout ID未管理
- FEAT_0047 Navigation: ゾンビRP参照、restoring フラグ同期リセット
- FEAT_0048 ValidationPanel: clearFocusedCell未呼出、CSS hardcoded 13箇所超
- ISSUE_0080 Dynamic Ref Validation: validateSimpleReference 未修正
- config.primaryKeyColumnName廃止: primary_key抽出コピペ 5ファイル8箇所

## MCP Tools Patterns
- MCPツールにtry/catch必須（内部情報漏洩防止）
- TOCTOU: 列名→インデックス変換後の列追加/削除
- TableInfoTool.FormatDataRows にデフォルト引数（CLAUDE.md違反残存）

## CSS Variables
- Defined: --font-color, --background-color, --background-sub-color, --border-color, --selection-color, --selection-font-color, --scroll-bar-background-color, --focus-border
- NOT defined: --selected-color, --tab-background, --list-hover-background, --text-muted-color, --text-color-secondary, --cell-background-color, --hover-color

## RelationsPanel Visibility Toggle Known Patterns (2026-03-24)
- Editor.relationsPanel は生焼けオブジェクト（false初期化→後からappendRelationsPanel）
- notifyVisibilityChanged(true)のrefreshCurrentRowはvisibleガード通過が順序依存
- ペインスタックRPのshowForTableRowAsyncにはvisibleガードなし（設計判断として明示必要）
- 非表示→破棄時のdestroyMiniEditorTables+clearContentAreaが冗長（renderMessageで統一可能）

## Review History
-> See `known-issues-archive.md` for details
- (2026-03-24) RP Visibility Toggle: 致命的3件（生焼けEditor.relationsPanel/順序依存visible/ペインスタックガード漏れ）、重要4件、軽微3件
- (2026-03-24) Initial Scan: 致命的4件（refCountリーク/Dirty判定不能/レースコンディション/例外で中途半端状態）、重要4件、軽微2件
- (2026-03-21) Diff Tab Save Highlight: 致命的3件、重要3件、軽微2件
- (2026-03-21) FormPanel Drilldown: 致命的4件、重要5件、軽微3件
- (2026-03-21) determineDisplayColumnName: 致命的3件、重要3件、軽微3件
- (2026-03-21) NotificationToast R2: 致命的3件、重要4件、軽微3件
- (2026-03-21) EditorAPI: 致命的5件、重要5件、軽微3件
- (2026-03-21) ValidationPanel jumpToError R2: 致命的1件、重要3件、軽微3件
- (2026-03-20) Various: ResizeHandle, ISSUE_0080, config refactor, FEAT_0047/0048
- (2026-03-19) FEAT_0047 Navigation, FEAT_0045 Notification
- (2026-03-18) FEAT_0043 FormPanel, FEAT_0042 HTML render, FEAT_0040 search
- (2026-03-17) FEAT_0038 fuzzy-search, FEAT_0036 resize
