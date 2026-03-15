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
- `/WebView/src/editor-table-reference.ts` - Reverse reference hints
- `/WebView/src/editor-table-context-menu.ts` - Context menu handlers
- `/WebView/src/editor-table-structure.ts` - Row/column insert/delete + storeRowIndices sync
- `/WebView/src/history.ts` - Undo/Redo history management
- `/WebView/src/command.ts` - Command pattern implementations
- `/WebView/src/relations-panel.ts` - Relations panel (right pane)
- `/WebView/src/selection.ts` - Selection and focus management
- `/WebView/src/tab.ts` - Tab management, EditorTable factory, pane stack management
- `/WebView/src/editor-actions.ts` - saveTableDataFromStoreAsync/saveSchemaDataAsync
- `/WebView/src/in-memory-table-store.ts` - Central data store + IHistory interface + Dirty management
- `/WebView/src/reference-expression.ts` - Reference expression parser (SimpleReference + DynamicReference)
- `/WebView/src/csv.ts` - CSV parser (naive split-based, not RFC 4180 compliant)
- `/WebView/src/settings-panel.ts` - Settings panel (theme selection, localStorage persistence)
- `/WebView/src/activity-bar.ts` - Activity bar with settings gear icon
- `/WebView/src/model/editor-table-data-column.ts` - Column model (comment/reference are string|null since FEAT_0004 R2)
- `/WebView/src/diff-view.ts` - Diff view (FEAT_0005)
- `/WebView/src/source-control-panel.ts` - Source control sidebar panel (FEAT_0005)
- `/WebView/src/git-diff-tracker.ts` - Git diff tracker for cell highlight (FEAT_0006)

## CSS Variables (index.css)
- `:root` = light theme defaults, `[data-theme="dark"]` = dark overrides
- Defined: `--font-color`, `--background-color`, `--background-sub-color`, `--border-color`, `--selection-color`, `--selection-font-color`, `--scroll-bar-background-color`
- NOTE: `--selected-color` does NOT exist; `--selection-color` is the correct variable name
- NOTE: `--tab-background` does NOT exist (used incorrectly in diff-view.css FEAT_0005)
- NOTE: `--list-hover-background` does NOT exist (used incorrectly in source-control-panel.css FEAT_0005)

## Pane Stack (2026-03-14)
- **Design**: Tab.paneStack = [{element, panel}] where [0]=leftPane, [1]=globalRP, [2..]=pushed RPs
- **viewIndex**: which pair (paneStack[vi], paneStack[vi+1]) is displayed in left/right slots
- **resetPaneStackToRoot()**: truncates to [0][1], sets viewIndex=0 (called from updateForRow on row change)

## RelationsPanel Row Notification (2026-03-14)
- **updateForRow()**: row change -> resets paneStack + refreshes data
- **refreshCurrentRow()**: cell edit -> refreshes data only (no paneStack reset)
- **ORPHANED**: Selection.forceNotifyRelationsPanel() has no callers after refactor — landmine for future devs
- **STALE COMMENT**: editor-table.ts L72 still says "forceRefreshRelationsPanel resets to -1" (no longer true)

## Settings Tab (FEAT_0002, 2026-03-14)
- **KNOWN ISSUE**: closeTab('設定') does NOT clean up settingsWrapperElement/settingsPanel -> dangling reference on re-open
- **KNOWN ISSUE**: Closing settings tab without saving does NOT revert preview theme
- **KNOWN ISSUE**: settingsPanel/settingsWrapperElement are half-baked object fields (|false pattern)
- **KNOWN ISSUE**: settings-panel.css uses `--selected-color` (undefined); should be `--selection-color`

## Column Header 2-Row Display (FEAT_0004, 2026-03-14 R3)
- **KNOWN ISSUE**: applyCellHeight() sets lineHeight=DEFAULT_ROW_HEIGHT on column headers (2-row clipped)
- **KNOWN ISSUE**: comment='' vs null distinction lost on Undo
- **KNOWN ISSUE**: serialize() outputs `description: null` (should omit)
- **KNOWN ISSUE**: getColumnHeaderValue vs getColumnHeaderLabel asymmetric null handling

## Diff View / Source Control (FEAT_0005, 2026-03-14)
- **CRITICAL**: showDiffView() sets rightSlot.style.display='none' but tab switch does NOT call hideDiffView() -> rightSlot stays hidden permanently
- **PARTIALLY FIXED**: C# git show handler now validates dataPrefix but path normalization incomplete (Git `/c/` vs `C:\`)
- **KNOWN ISSUE**: diff-view.css uses `--tab-background` (undefined CSS variable)
- **KNOWN ISSUE**: source-control-panel.css uses `--list-hover-background` (undefined CSS variable)
- **KNOWN ISSUE**: SourceControlPanel.currentDiffView is null member variable (half-baked object)
- **KNOWN ISSUE**: diff-view.ts has its own parseCsv() duplicating csv.ts functionality
- **KNOWN ISSUE**: No UI to close diff view and return to editor
- **KNOWN ISSUE**: git status error returns success:true with empty data (error swallowed)
- **KNOWN ISSUE**: diff-view.ts uses `undefined` comparisons in multiple places

## Diff Tab / EditorTable-based diff (FEAT_0008, 2026-03-15)
- **CRITICAL**: Right pane Ctrl+S saves to `data/test:diff:current.csv` (wrong path with colons)
- **CRITICAL**: DiffTab.destroy() does NOT call EditorTableHandler.deactivate() -> global listener leak
- **KNOWN ISSUE**: diffTab/diffTabTableName are |false half-baked object pattern (same as settingsPanel)
- **KNOWN ISSUE**: diff-tab.ts parseCsv() duplicates Csv.load() with different trim behavior (3rd time)
- **KNOWN ISSUE**: dummyTabButton creates DOM <li> + listeners that are never cleaned up
- **KNOWN ISSUE**: closeTab diff tab -> enableTabButton normal tab: rightSlot may stay hidden
- **KNOWN ISSUE**: buildUniqueKeyMap `_row` suffix collides with PK values containing `_row`
- **KNOWN ISSUE**: SchemaJson/SchemaColumn interfaces duplicate existing schema types
- **KNOWN ISSUE**: scroll sync listeners are anonymous -> cannot be removed in destroy()

## Recurring Review Patterns
- **Operation path coverage gap**: ALL paths must be secured when adding new features
- **New DOM structure: update ALL readers/writers**: 新しいDOM構造を追加したら全APIを同時に更新
- **open/close symmetry for special tabs**: Settings tab open creates DOM+panel but close has NO cleanup
- **show/hide symmetry for overlay views**: showDiffView hides rightSlot but no path restores it on tab switch
- **CSS変数名の打ち間違い**: 未定義CSS変数が4回連続で別FEAT/ファイルで発生(FEAT_0002,0004,0005,0013)
- **awaitポイント後のrequestIdチェック**: 全awaitポイントでrequestIdチェック必須
- **C#バックエンド入力バリデーション不足**: git系ハンドラでフロントエンド入力をそのままコマンド引数に渡している
- **reloadCellsFromStore行数同期の副作用漏れ**: 行数変更後にSelection/GitDiffHighlight/行ヘッダー再ナンバリングが必要
- **Orphaned public methods after refactor**: forceNotifyRelationsPanel残存 — リファクタ後に呼び出し元ゼロのpublicメソッドが地雷化
- **Comment staleness after behavior change**: lastNotifiedRow/forceNotifyRelationsPanel関連コメント3箇所が実装と乖離
- **CSV parse duplication**: parseCsv() reimplemented 3 times (diff-view.ts, git-diff-tracker.ts, diff-tab.ts) with inconsistent trim/filter behavior
- **Special tab deactivate() gap**: DiffTab.destroy() missing EditorTableHandler.deactivate() (same pattern as Settings tab cleanup gap)
- **Ctrl+S on special-key tables**: isMiniTable=true tables with non-standard tableName (`:diff:`) trigger saveTableDataFromStoreAsync with wrong path
- **Row sync added but column sync forgotten**: notifyRowInserted/Deleted added but notifyColumnInserted/Deleted missing — sortKeys.columnIndex stale after column insert/delete
- **Sort reorder missing state propagation**: applySortForColumn reorders DOM but does not update Selection/CopyRange/GitDiff/PKValidation — same pattern as reloadCellsFromStore行数同期の副作用漏れ
- **New view-state feature missing column-index sync**: Sort/Filter both use columnIndex as key but neither resets when columns are inserted/deleted — clearSortState added for sort but clearFilterState forgotten for filter
- **CSS hardcoded colors (no CSS variables)**: 5回再発 (FEAT_0002, 0005, 0012, 0013, 0016) — filter-dropdown.css, editor-table.css badge colors
- **document listener leak on re-instantiation**: FilterDropdown anonymous mousedown listener cannot be removed, leaks on initializeModules() re-creation

## Structural Concerns
- **Parallel array anti-pattern in RelationsPanel**: 5 arrays + storeRowIndices
- **Window listener accumulation**: activate() on N mini-tables registers simultaneously
- **store.getHeader/getRows returns internal reference**: caller mutation corrupts store
- **Csv class**: half-baked object pattern (10+ instances project-wide)
- **textNode: Text | false = false**: | false pattern (廃止方向の既知負債)

## Git Diff Tracker (FEAT_0006, 2026-03-14)
- **CRITICAL**: Row insert/delete/promote/demote do NOT call applyGitDiffHighlight() -> highlight lost
- **CRITICAL**: buildHeadRowMap uses .trim() but Csv.load() does not -> data mismatch on comparison
- **KNOWN ISSUE**: gitDiffTracker: GitDiffTracker | false is half-baked object pattern
- **KNOWN ISSUE**: pkColumnIndex=-1 not guarded (findIndex returns -1 if PK not found)
- **KNOWN ISSUE**: let statusResult; is implicit any, entry === undefined violates undefined prohibition
- **KNOWN ISSUE**: No race condition guard after await in connectGitDiffTrackerAsync
- **KNOWN ISSUE**: buildHeadRowMap duplicates Csv.load() CSV parsing logic
- **KNOWN ISSUE**: Empty string PK causes incorrect row matching in headRowMap

## Review History
- 2026-03-13 (dynamic-reference): 致命的2件、重要4件、軽微2件
- 2026-03-13 (pane-stack v1): 致命的4件、重要6件、軽微3件
- 2026-03-13 (pane-stack v2): 致命的3件、重要5件、軽微3件
- 2026-03-13 (mini-table-row-selection): 致命的2件、重要4件、軽微2件
- 2026-03-14 (lastNotifiedRow cross-switch fix): 致命的1件、重要3件、軽微2件
- 2026-03-14 (dynamic-ref-panestack+referenceDataCache除去 R1): 致命的2件、重要4件、軽微3件
- 2026-03-14 (Round 2): 致命的2件、重要4件、軽微3件
- 2026-03-14 (tab-switch-pane-stack-persistence): 致命的2件、重要4件、軽微2件
- 2026-03-14 (suspend-method+removeTab-cleanup R2): 致命的2件、重要4件、軽微3件
- 2026-03-14 (suspend-resume R3): 致命的2件、重要4件、軽微2件
- 2026-03-14 (inactive-selection-color R1): 致命的2件、重要4件、軽微2件
- 2026-03-14 (inactive-selection-color R2): 致命的2件、重要4件、軽微2件
- 2026-03-14 (FEAT_0002 light-theme): 致命的2件、重要4件、軽微3件
- 2026-03-14 (FEAT_0004 R1-R3): 致命的2件ずつ
- 2026-03-14 (FEAT_0005 source-control-diff R1): 致命的2件、重要4件、軽微4件
- 2026-03-14 (FEAT_0006 git-cell-highlight): 致命的2件、重要4件、軽微4件
- 2026-03-14 (mini-table-row-store-sync): 致命的2件、重要4件、軽微3件
- 2026-03-14 (BUG_0006 git-path-fix + paneStack-row-reset): 致命的1件、重要3件、軽微3件
- 2026-03-15 (FEAT_0008 diff-tab-editortable): 致命的2件、重要4件、軽微4件
- 2026-03-15 (PK-validation R2): 致命的2件、重要4件、軽微3件
- 2026-03-15 (column-sorter R2): 致命的2件、重要5件、軽微3件
- 2026-03-15 (column-sorter R3): 致命的2件、重要4件、軽微3件
- 2026-03-15 (column-filter R1): 致命的2件、重要4件、軽微4件

## PK Validation (2026-03-15)
- **KNOWN ISSUE**: validatePkDuplicates() runs on mini-tables using store-wide counts -> false positive red wavy underlines on mini-table rows
- **KNOWN ISSUE**: `as number` type assertions in pkCounts.get() (2 places)
- **KNOWN ISSUE**: pkColIdx < row.length fallback to empty string silently hides header/row column count mismatch
- **Pattern**: New validation hooks added at 8 call sites — same "every mutation path" pattern as applyGitDiffHighlight

## Column Sorter (2026-03-15, R3)
- **FIXED R2→R3**: 列挿入/削除時にclearSortState()呼び出し追加
- **FIXED R2→R3**: Map.get()にthrow Errorガード追加
- **FIXED R2→R3**: undefined比較をfindIndexに変更
- **FIXED R2→R3**: forEachSortKey()デッドコード削除
- **FIXED R2→R3**: reorderDomRowsをapplySortForColumnにインライン展開
- **CRITICAL R3**: applySortForColumn()がSelection/CopyRangeを更新しない -> ソート後に別データを選択状態にする
- **CRITICAL R3**: clearSortState()がDOM行順序を復元しない -> ソート中の列操作でソート順がCtrl+Sで永続化される
- **KNOWN ISSUE R3**: getSortKeyForColumn()がSortKeyオブジェクト参照を漏洩 (R2から残存)
- **KNOWN ISSUE R3**: compareValues()がNumber(' ')=0、Number('0x1A')=26を許容 (空白・Hex文字列)
- **KNOWN ISSUE R3**: applySortForColumn()がapplyGitDiffHighlight()/validatePkDuplicates()を呼ばない
- **KNOWN ISSUE R3**: ソート中のセル編集で自動再ソートしない設計が未ドキュメント

## Column Filter (FEAT_0012, 2026-03-15)
- **CRITICAL**: 列挿入/削除時にフィルター状態がリセットされない -> columnIndex陳腐化で別列にフィルター誤適用
- **CRITICAL**: FilterDropdownのdocument mousedownリスナーが無名関数 -> removeEventListener不可、initializeModules()で再作成時に蓄積
- **KNOWN ISSUE**: 行挿入/削除/バッファ行昇格時にapplyFilterDisplay()が呼ばれない -> フィルター非表示行の表示/行数カウンター不整合
- **KNOWN ISSUE**: reloadCellsFromStore()でフィルター状態がリセットされない -> タブ切替後に陳腐なフィルターが残る
- **KNOWN ISSUE**: filter-dropdown.css が全色ハードコード -> ライトテーマ非対応 (FEAT_0002,0005と同パターン)
- **KNOWN ISSUE**: column-filter.ts L94,L116 で undefined 比較使用
- **KNOWN ISSUE**: collectCheckedValues() L251,L255 で || フォールバック使用
- **KNOWN ISSUE**: FilterDropdown.element がdocument.bodyに追加後、タブ閉じ時に除去されない (destroy()なし)

## Dropdown QuickView (FEAT_0013, 2026-03-15)
- **CRITICAL**: hoverTimerId: number|null, currentReferenceTableName: string|null are null member variables (half-baked object)
- **CRITICAL**: renderContent L136 uses `??` fallback (`this.currentReferenceTableName ?? ''`)
- **KNOWN ISSUE**: CSS `--text-muted-color` and `--text-color` not defined in index.css (4th undefined CSS var occurrence)
- **KNOWN ISSUE**: setReferenceTable() is a setter method (getter/setter禁止違反)
- **KNOWN ISSUE**: parentElement! non-null assertion at L34 and L186
- **KNOWN ISSUE**: GridDropdownInput.element is public HTMLElement (既存負債)
- **KNOWN ISSUE**: No destroy() method — DOM element persists until parent removed
- **KNOWN ISSUE**: cleanup() does not clear previewCache (asymmetry with setReferenceTable)
- **KNOWN ISSUE**: positionElement only checks right overflow, not bottom overflow

## FEAT_0014 Mini-table Buffer Row + AutoFill (2026-03-15)
- **CRITICAL**: PromoteBufferRowCommand.redo()がapplyAutoFillToRow()を呼ばない -> Redo時にFK値が消失
- **CRITICAL**: demoteStoreRowToBuffer()がDOMセル値をクリアしない -> Undo後にFK値がDOM上に残留
- **KNOWN ISSUE**: emptyRowCountの名前が「空行数」だが実際は「最低総行数」(既存負債)
- **Pattern**: 初回パスで直接関数呼び出し + Command構築 → Redo時にCommand.execute()で同じ関数だけ呼んで付随処理を忘れる

## FEAT_0016 PK/FK Badge (2026-03-15)
- **CRITICAL**: DeleteColumnCommand.undo() calls insertColumnInternal(false, null) -> PK/FK badge lost on Undo
- **CRITICAL**: appendBadgeIfNeeded uses if/else if -> PK+FK column shows only PK badge, FK info hidden
- **KNOWN ISSUE**: CSS colors hardcoded (5th occurrence of same pattern)
- **KNOWN ISSUE**: appendBadgeIfNeeded called in both if/else branches (should be after)
- **KNOWN ISSUE**: PK/FK badge createElement duplicated (PK and FK branches nearly identical)
- **Pattern**: Column delete Undo missing metadata restoration (same as comment='' vs null on FEAT_0004)

## FEAT_0017 PK/FK Badge Left Placement (2026-03-15)
- **CRITICAL**: DeleteColumnCommand.undo() still does not restore badge (same as FEAT_0016 unfixed) -> isPrimaryKey/reference not saved/restored
- **CRITICAL**: setColumnHeaderValue/setColumnHeaderLabel TextNode fallback inserts before badgeArea -> DOM structure corruption when badge-first + no TextNode + no nameSpan
- **KNOWN ISSUE**: insertColumnInternal signature only accepts comment, not isPrimaryKey/reference -> caller cannot restore badges on Undo
- **KNOWN ISSUE**: CSS colors hardcoded (6th occurrence)

## diff-rows.ts buildDiffRows (BUG_0013 fix, 2026-03-15)
- **CRITICAL**: resolveCurrentEntry uses includes('_row') -> PK値に "_row" を含む場合に誤マッチ。正規表現 /_row\d+$/ で末尾サフィックスのみ照合すべき
- **CRITICAL**: buildUniqueKeyMap で PK重複3行以上の場合、seenIndices.set(rawPk,-1)後に firstIndex=-1 で map.has(rawPk)=false → 初出移動スキップ。dupCountマップで出現回数管理に変更すべき
- **IMPORTANT**: resolveCurrentEntry が照合済みCurrentキーを再度照合する可能性 → HEAD版に重複PKがありCurrent版に単一PKが1行の場合、同一Currentエントリが2つのHEAD行に照合され deleted が消える
- **IMPORTANT**: pkIndicesInHead/-current に -1 が含まれる場合の無音失敗（indexOf で列見つからず空文字PKに落ちる）
- **IMPORTANT**: parseCsv が4回目の独自実装（Csv.load() に統一すべき）
- **PATTERN**: `_row<n>` サフィックスによるPKキー重複解消パターンは PK値に "_row" を含む場合に崩壊する設計上の欠陥
- **Review**: 2026-03-15 致命的2件、重要4件、軽微2件
- **Pattern**: Inserting new first-child element (badgeArea) invalidates all TextNode-fallback insert paths that use `insertBefore(x, firstChild)`

## diffTab Map化 (BUG_0015相当, 2026-03-15)
- **CRITICAL**: closeTab(差分タブ) が差分タブブロックで activeTabName=false をリセットするため、removeTabButton L451 の `activeTabName===name` 判定が絶対にtrueにならず paneStack がクリアされない
- **CRITICAL**: closeDiffTab() が「現在アクティブな差分タブ1つを閉じる」に変わったが、呼び出し元 sidebar.ts L154 は「全差分タブを閉じる」意図で呼んでいる -> 非アクティブ差分タブが残留
- **IMPORTANT**: 差分タブ間切り替え時に enableTabButton L522 で leaveSettingsMode → activateDiffTab で enterSettingsMode の二重呼び出し (冪等前提の時限爆弾)
- **IMPORTANT**: テスト3のコメントが実際の動作と乖離 (closeDiffTab が1つしか閉じないため count=1 の保証が誤)
- **KNOWN ISSUE**: dummyTabButton DOM+リスナーリーク (FEAT_0008から未修正)
- **Pattern**: 単一フィールド→Mapへの移行時に「閉じる」API の意味が変わるリスク（1個を閉じる vs 全部閉じる）を見落とす

## Review History (continued)
- 2026-03-15 (FEAT_0013 dropdown-quick-view): 致命的2件、重要5件、軽微4件
- 2026-03-15 (FEAT_0014 buffer-row-autofill R1): 致命的2件、重要3件、軽微2件
- 2026-03-15 (FEAT_0016 pk-fk-badge R1): 致命的2件、重要5件、軽微3件
- 2026-03-15 (diffTab Map化): 致命的2件、重要3件、軽微3件
- 2026-03-15 (FEAT_0017 pk-fk-badge-left R1): 致命的2件、重要4件、軽微3件
