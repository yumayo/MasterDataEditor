# Adversarial Code Reviewer Memory

## Project Architecture
- Frontend: Vanilla TypeScript (no framework), DOM is SSOT
- Backend: C#
- Design: Intentionally tightly coupled, Command pattern for Undo/Redo
- WebView2 (Microsoft browser control) used for frontend hosting

## Key Files
- `/WebView/src/editor.ts` - Editor area (nav bar + content area with left/right slots)
- `/WebView/src/editor-table.ts` - Core table + storeRowIndices (DOM->store row mapping)
- `/WebView/src/editor-table-handler.ts` - High-level edit handler
- `/WebView/src/editor-table-structure.ts` - Row/column insert/delete + storeRowIndices sync
- `/WebView/src/history.ts` - Undo/Redo history management
- `/WebView/src/command.ts` - Command pattern implementations
- `/WebView/src/relations-panel.ts` - Relations panel (right pane)
- `/WebView/src/tab.ts` - Tab management, EditorTable factory, pane stack management
- `/WebView/src/in-memory-table-store.ts` - Central data store + IHistory interface + Dirty management
- `/WebView/src/reference-data-cache.ts` - ReferenceDataCache (items + fullData cache)
- `/WebView/src/grid-dropdown-input.ts` - FK dropdown input component
- `/WebView/src/dropdown-quick-view.ts` - Hover quick preview panel (RelationsPanel-style)

## CSS Variables (index.css)
- Defined: `--font-color`, `--background-color`, `--background-sub-color`, `--border-color`, `--selection-color`, `--selection-font-color`, `--scroll-bar-background-color`
- NOT defined: `--selected-color`, `--tab-background`, `--list-hover-background`, `--text-muted-color`, `--text-color-secondary`
- CSS hardcoded colors: 7+ occurrences across FEATs (recurring pattern)

## Recurring Review Patterns
- **Operation path coverage gap**: ALL paths must be secured when adding new features
- **open/close symmetry for special tabs**: Settings tab open creates DOM+panel but close has NO cleanup
- **show/hide symmetry for overlay views**: showDiffView hides rightSlot but no path restores it on tab switch
- **CSS未定義変数**: 別FEAT/ファイルで繰り返し発生 (FEAT_0002,0004,0005,0013)
- **awaitポイント後のrequestIdチェック**: 全awaitポイントでrequestIdチェック必須
- **reloadCellsFromStore行数同期の副作用漏れ**: Selection/GitDiffHighlight/行ヘッダー再ナンバリングが必要
- **Orphaned public methods after refactor**: 呼び出し元ゼロのpublicメソッドが地雷化
- **CSV parse duplication**: parseCsv() reimplemented 3+ times with inconsistent behavior
- **Special tab deactivate() gap**: destroy()でEditorTableHandler.deactivate()を忘れる
- **Row sync added but column sync forgotten**: notifyRowInserted/Deleted追加時にnotifyColumnInserted/Deletedを忘れる
- **Sort/Filter reorder missing state propagation**: DOM再配置後にSelection/CopyRange/GitDiff/PKValidationを更新しない
- **CSS hardcoded colors**: 7回再発 — CSS変数使用を徹底せよ
- **document listener leak on re-instantiation**: 無名リスナーはremoveEventListener不可
- **previewCache key must include tableName**: itemIdのみのキーは複数テーブル跨ぎで汚染される (FEAT_0019)
- **hover維持の対称性**: アイテム→QV間もQV→アイテム間も同一ディレイで統一する (FEAT_0019)
- **Factory method must complete ALL setup**: 参照ヒント+ドロップダウン設定を外部に出さない

## Structural Concerns
- **Parallel array anti-pattern in RelationsPanel**: 5 arrays + storeRowIndices
- **store.getHeader/getRows returns internal reference**: caller mutation corrupts store
- **Csv class**: half-baked object pattern (10+ instances project-wide)
- **textNode: Text | false = false**: | false pattern (廃止方向の既知負債)
- **GridDropdownInput.element is public HTMLElement**: 既存負債 (FEAT_0013〜)

## Dropdown QuickView (FEAT_0013/FEAT_0019 改訂)
- **FIXED FEAT_0019**: cleanup()がpreviewCacheをクリアするようになった
- **FIXED FEAT_0019**: positionElementがbottomオーバーフローも補正するようになった
- **FIXED FEAT_0019**: hoverTimerId/currentReferenceTableName の null メンバー変数が廃止
- **CRITICAL FEAT_0019**: previewCacheキーがitemIdのみ -> tableName違いで別テーブルデータ汚染
- **CRITICAL FEAT_0019**: QV mouseleaveが即時hidePreview() -> QV→アイテム戻り操作が破壊される (hidePreviewWithDelay()を使うべき)
- **KNOWN ISSUE**: isHovered()が呼び出し元ゼロ -> orphaned public method
- **KNOWN ISSUE**: cleanup()でcurrentPreviewRequestIdがリセットされない
- **KNOWN ISSUE**: z-index:1000が親スタッキングコンテキスト(grid-dropdown z-index:100)内に閉じる
- **KNOWN ISSUE**: GridDropdownInput.show()にconsole.logが残留
- **KNOWN ISSUE**: positionElement bottomオーバーフロー補正でcontainerRect基準の誤差

## Review History (2026-03-13〜2026-03-14)
→ 詳細は `known-issues-archive.md` 参照

## Diff Tab (tab.ts) Known Patterns
- **removeTabButton/closeTab二重remove**: removeTabButtonにelement.remove()を追加した場合、closeTab側の tabButton.element.remove()が二重削除になる。経路ごとに削除責務が違う構造が根本原因。
- **diffTabName に isStaged が含まれない**: キー = DIFF_TAB_PREFIX + tableName のみ。staged/changesの切り替えで古いタブが再利用されサイレントバグになる。
- **closeAllDiffTabs は closeTab を経由しない**: enterSettingsMode/leaveSettingsMode の重複呼び出し回避のため直接destroyする設計。この2パスの乖離が今後も問題を生みやすい。

## DiffTab Dropdown (diff-tab-dropdown-fix) Known Patterns
- **staged=true でドロップダウン生成を抑制しない**: isStaged チェックを buildDiffEditorTable 呼び出し前に行い dropdownContainer=null を渡すべき
- **buildDiffEditorTable 戻り値に dropdownInput が含まれない**: destroy() でhide()できずタイマーリークの温床
- **diff-tab-wrapper に position:relative がない**: ドロップダウンの絶対座標基準が .editor(position:fixed)になり、スクロール時ズレが発生する
- **buildDiffEditorTable で fillController.activate() が欠落**: createMiniEditorTable と乖離 (対称操作パターン再発)
- **console.log が GridDropdownInput.show() / EditorTableHandler に残留**: 差分タブドロップダウン修正で初めてこのパスが通るようになり問題が顕在化

## Review History (2026-03-15)
- (FEAT_0008 diff-tab): 致命的2件、重要4件、軽微4件
- (PK-validation R2): 致命的2件、重要4件、軽微3件
- (column-sorter R2): 致命的2件、重要5件、軽微3件
- (column-sorter R3): 致命的2件、重要4件、軽微3件
- (column-filter R1): 致命的2件、重要4件、軽微4件
- (FEAT_0013 dropdown-quickview): 致命的2件、重要4件、軽微4件
- (FEAT_0014 mini-table-buffer-row): 致命的2件、重要3件、軽微2件
- (FEAT_0016 PK/FK badge): 致命的2件、重要3件、軽微3件
- (FEAT_0017 badge-left-placement): 致命的2件、重要3件、軽微2件
- (N:1-buffer-row): 致命的2件、重要3件、軽微2件
- (diff-tab-reference-hint): 致命的2件、重要3件、軽微2件
- (FEAT_0018 diff-tab-row-insert-delete-sync): 致命的2件、重要4件、軽微3件
- (FEAT_0019 dropdown-quickview-hover): 致命的2件、重要4件、軽微4件
- (diff-tab-duplicate-fix): 致命的2件、重要3件、軽微3件
- (diff-tab-dropdown-fix): 致命的2件、重要3件、軽微2件
