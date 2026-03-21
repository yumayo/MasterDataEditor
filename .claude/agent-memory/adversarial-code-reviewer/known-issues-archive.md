---
name: Known Issues Archive (FEAT_0002 ~ FEAT_0017)
description: 過去レビューで発見された既知問題の詳細アーカイブ
type: project
---

## Settings Tab (FEAT_0002)
- closeTab('設定') does NOT clean up settingsWrapperElement/settingsPanel -> dangling reference on re-open
- Closing settings tab without saving does NOT revert preview theme
- settingsPanel/settingsWrapperElement are half-baked object fields (|false pattern)
- settings-panel.css uses `--selected-color` (undefined); should be `--selection-color`

## Column Header 2-Row Display (FEAT_0004 R3)
- applyCellHeight() sets lineHeight=DEFAULT_ROW_HEIGHT on column headers (2-row clipped)
- comment='' vs null distinction lost on Undo
- serialize() outputs `description: null` (should omit)
- getColumnHeaderValue vs getColumnHeaderLabel asymmetric null handling

## Diff View / Source Control (FEAT_0005)
- CRITICAL: showDiffView() sets rightSlot.style.display='none' but tab switch does NOT call hideDiffView() -> rightSlot stays hidden permanently
- diff-view.css uses `--tab-background` (undefined CSS variable)
- source-control-panel.css uses `--list-hover-background` (undefined CSS variable)
- SourceControlPanel.currentDiffView is null member variable (half-baked object)
- diff-view.ts has its own parseCsv() duplicating csv.ts functionality
- No UI to close diff view and return to editor
- git status error returns success:true with empty data (error swallowed)
- diff-view.ts uses `undefined` comparisons in multiple places

## Git Diff Tracker (FEAT_0006)
- CRITICAL: Row insert/delete/promote/demote do NOT call applyGitDiffHighlight() -> highlight lost
- CRITICAL: buildHeadRowMap uses .trim() but Csv.load() does not -> data mismatch on comparison
- gitDiffTracker: GitDiffTracker | false is half-baked object pattern
- pkColumnIndex=-1 not guarded (findIndex returns -1 if PK not found)
- No race condition guard after await in connectGitDiffTrackerAsync
- buildHeadRowMap duplicates Csv.load() CSV parsing logic

## Diff Tab (FEAT_0008)
- CRITICAL: Right pane Ctrl+S saves to `data/test:diff:current.csv` (wrong path with colons)
- CRITICAL: DiffTab.destroy() does NOT call EditorTableHandler.deactivate() -> global listener leak
- diffTab/diffTabTableName are |false half-baked object pattern
- diff-tab.ts parseCsv() duplicates Csv.load() (3rd time)
- dummyTabButton creates DOM <li> + listeners that are never cleaned up
- scroll sync listeners are anonymous -> cannot be removed in destroy()

## PK Validation
- validatePkDuplicates() runs on mini-tables using store-wide counts -> false positive red wavy underlines
- `as number` type assertions in pkCounts.get() (2 places)
- pkColIdx < row.length fallback to empty string silently hides mismatch

## Column Sorter (R3)
- CRITICAL R3: applySortForColumn() does not update Selection/CopyRange -> stale selection after sort
- CRITICAL R3: clearSortState() does not restore DOM row order -> sorted order persists to CSV on Ctrl+S
- getSortKeyForColumn() leaks SortKey object reference
- compareValues() allows Number(' ')=0, Number('0x1A')=26
- applySortForColumn() does not call applyGitDiffHighlight()/validatePkDuplicates()

## Column Filter (FEAT_0012)
- CRITICAL: Column insert/delete does not reset filter state -> columnIndex stale -> wrong column filtered
- CRITICAL: FilterDropdown anonymous mousedown listener -> removeEventListener impossible, accumulates on re-creation
- Row insert/delete/buffer promote does not call applyFilterDisplay()
- reloadCellsFromStore() does not reset filter state -> stale filter after tab switch
- filter-dropdown.css uses hardcoded colors
- FilterDropdown.element added to document.body but never removed on tab close (no destroy())

## Dropdown QuickView (FEAT_0013)
- CRITICAL: hoverTimerId: number|null, currentReferenceTableName: string|null are null member variables (half-baked)
- CRITICAL: renderContent uses `??` fallback (フォールバック禁止違反)
- CSS `--text-muted-color` and `--text-color` not defined in index.css
- setReferenceTable() is a setter method (getter/setter禁止違反)
- GridDropdownInput.element is public HTMLElement (既存負債)
- No destroy() method — DOM element persists until parent removed
- cleanup() did not clear previewCache (fixed in FEAT_0019 revision)
- positionElement only checked right overflow, not bottom overflow (fixed in FEAT_0019)

## FEAT_0014 Mini-table Buffer Row + AutoFill
- CRITICAL: PromoteBufferRowCommand.redo() does not call applyAutoFillToRow() -> FK values lost on Redo
- CRITICAL: demoteStoreRowToBuffer() does not clear DOM cell values -> FK values remain in DOM after Undo
- emptyRowCount名が「空行数」だが実際は「最低総行数」

## FEAT_0016/0017 PK/FK Badge
- CRITICAL: DeleteColumnCommand.undo() calls insertColumnInternal(false, null) -> PK/FK badge lost on Undo
- CRITICAL: appendBadgeIfNeeded uses if/else if -> PK+FK column shows only PK badge
- CRITICAL (FEAT_0017): setColumnHeaderValue/setColumnHeaderLabel TextNode fallback inserts before badgeArea -> DOM corruption
- CSS colors hardcoded (5th/6th occurrence)
- insertColumnInternal signature only accepts comment, not isPrimaryKey/reference -> caller cannot restore badges on Undo

## N:1 Buffer Row (2026-03-15)
- CRITICAL: N:1 entry rows are FK-filtered subset but storeRowIndices=[] -> promoteBufferRowToStore writes to wrong position
- storeRowIndices: [] comment lies "N:1 shows all rows" but rows is filtered subset

## FEAT_0018 DiffTab Row Insert/Delete Sync
- CRITICAL: InsertRowsCommand.execute() calls insertRowInternal(rowIndex) count times with same rowIndex -> padding rows accumulate at same position
- CRITICAL: DeleteRowCommand.undo() calls insertRowInternal() but original deleteRow converted right pane row to padding -> row count inflates per undo cycle
- notifyRightPaneRowDeleted does not renumberLeftRows in normal-delete path

## diff-tab-reference-hint fix
- CRITICAL: buildDiffEditorTable() missing setReferenceComponents() + createDropdownInput() -> FK dropdown disabled in right pane
- buildDiffEditorTable() does not encapsulate reference setup internally -> asymmetry with createEditorTable/createMiniEditorTable

## EditorAPI Internal API Layer (2026-03-21)
- **CRITICAL**: Tab.editorApi が `| false` 生焼けオブジェクト（connectEditorApi で後付け）
- **[FIXED 2026-03-22]**: emitTableSaved / emitRowSelected が接続済み（ISSUE_0093）
- **CRITICAL**: insertRow に rowIndex 境界値チェックなし（deleteRow にはある）
- **CRITICAL**: setCellValues に空配列渡しで cellChanges[0].row → TypeError クラッシュ
- **CRITICAL**: EditorApiBridge の as キャスト嵐 — params の型バリデーション皆無（string "0" + 1 = "01" 問題）
- **[PARTIAL FIX]**: イベントハンドラー例外は try/catch 追加済みだが、emit中のdisposeで配列splice→ハンドラースキップの問題が残存
- **IMPORTANT**: EditorApiBridge.install() の無名リスナーが removeEventListener 不可
- **IMPORTANT**: emitTableOpened が既存タブ再アクティブ化でも発火（Open/Close の非対称性）
- **IMPORTANT**: store.getRows() 内部参照を edit 名前空間で直接使用（data 名前空間ではディープコピー）
- **PATTERN**: テストの window キャスト30箇所コピペ（ヘルパー関数化すべき）
- **PATTERN**: schemaRegistry 構築ロジックが main.ts にベタ書き

## ISSUE_0093 onTableSaved/onRowSelected (2026-03-22)
- **CRITICAL**: 全emitメソッドでループ中にdispose→splice→ハンドラースキップ（再入可能性の欠陥）。スナップショットコピーで修正要
- **IMPORTANT**: C#ブリッジにevents名前空間ディスパッチなし（request-responseパターンに不適合、設計判断として明記要）
- **IMPORTANT**: onRowSelected が矢印キー移動で毎回発火（lastNotifiedRowチェック前にemit）→ パフォーマンス劣化リスク
- **IMPORTANT**: disposeテストがsetTimeout(300)依存（CI環境で偽陽性リスク）
- **PATTERN**: emit/subscribeコピペが5重複（共通ヘルパー化すべき）
- **PATTERN**: EditorTable.emitTableSaved はTab へのパススルーのみ（責務の適切性に疑問）
