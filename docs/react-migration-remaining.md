# React移行 残タスク一覧

## 概要

Phase 0〜10でReactコンポーネントのプロトタイプが作成済み。
Vanilla TypeScript側に実装されている約100個のメソッド/ロジックがReact側に未移植。
本ドキュメントは、残タスクをカテゴリ別・優先度別に整理したものである。

---

## 現在のReactファイル構成（Phase 10完了時点）

### stores (5ファイル)
| ファイル | 責務 |
|---|---|
| `table-store.ts` | テーブルデータ管理（Zustand + Immer） |
| `selection-store.ts` | セル選択状態 |
| `sidebar-store.ts` | サイドバー状態 |
| `tab-store.ts` | タブ管理 |
| `relations-store.ts` | 右ペイン参照エントリ |

### components (18ファイル)
| ディレクトリ | ファイル | 責務 |
|---|---|---|
| EditorTable/ | `EditorTableView.tsx` | メインテーブル（TanStack Table + Virtual） |
| EditorTable/ | `Cell.tsx` | セルコンポーネント |
| EditorTable/ | `HeaderCell.tsx` | ヘッダーセル |
| EditorTable/ | `RowHeader.tsx` | 行番号ヘッダー |
| EditorTable/ | `SelectionOverlay.tsx` | 選択範囲表示オーバーレイ |
| EditorTable/ | `FillPreview.tsx` | フィル操作のプレビュー |
| Sidebar/ | `Sidebar.tsx` | サイドバー統合 |
| Sidebar/ | `ActivityBar.tsx` | EXPLORER/REFERENCES/SEARCH切替 |
| Sidebar/ | `ExplorerPanel.tsx` | ファイルエクスプローラー |
| Sidebar/ | `ReferencesPanel.tsx` | 逆参照パネル |
| Sidebar/ | `SearchPanel.tsx` | 検索パネル |
| RelationsPanel/ | `RelationsPanel.tsx` | 右ペイン親コンポーネント |
| RelationsPanel/ | `RelationSection.tsx` | N:1/1:Nセクション |
| RelationsPanel/ | `MiniEditorTable.tsx` | ミニテーブル |
| TabBar/ | `TabBar.tsx` | タブバー |
| TabBar/ | `TabButton.tsx` | 個別タブボタン |
| — | `GridTextField.tsx` | テキスト入力 |
| — | `GridDropdownInput.tsx` | ドロップダウン入力 |

### hooks (1ファイル)
| ファイル | 責務 |
|---|---|
| `useEditorTableKeyboard.ts` | キーボード操作フック |

### types (2ファイル)
| ファイル | 責務 |
|---|---|
| `selection-types.ts` | 選択状態の型定義 |
| `relation-types.ts` | 参照データの型定義 |

---

## カテゴリ別 未実装ロジック一覧

### カテゴリ A: セル編集・参照ヒント

| # | 機能 | Vanilla側 | React側 | 優先度 |
|---|------|-----------|---------|--------|
| A-1 | セル編集モード（テキスト入力） | editor-table-handler.ts | useEditorTableKeyboard + GridTextField | **高** |
| A-2 | 参照列ドロップダウン | editor-table-handler.ts | GridDropdownInput + useEditorTableKeyboard | **高** |
| A-3 | 参照ヒント表示（FK→表示名） | editor-table-reference.ts | Cell component | **高** |
| A-4 | 逆参照ヒント（PK→参照元バッジ） | editor-table-reference.ts | Cell component | 中 |
| A-5 | 動的参照対応（二段リスト） | editor-table-handler.ts | useEditorTableKeyboard | 中 |

### カテゴリ B: キーボード・マウス入力制御

| # | 機能 | Vanilla側 | React側 | 優先度 |
|---|------|-----------|---------|--------|
| B-1 | Ctrl+C（コピー） | editor-table-handler.ts | useEditorTableKeyboard / selection-store | **高** |
| B-2 | Ctrl+V（ペースト） | editor-table-handler.ts | 新Hook | **高** |
| B-3 | Ctrl+Z/Y（Undo/Redo） | history.ts | history-store（新） + useEditorTableKeyboard | **高** |
| B-4 | Ctrl+S（保存） | editor-table-handler.ts | 新Hook | **高** |
| B-5 | Delete/Backspace（セルクリア） | editor-table-handler.ts | useEditorTableKeyboard | 中 |
| B-6 | 矢印キー + Shift（範囲拡張） | editor-table-handler.ts | useEditorTableKeyboard / selection-store | 中 |

### カテゴリ C: フィルハンドル（Fill Down/Series）

| # | 機能 | Vanilla側 | React側 | 優先度 |
|---|------|-----------|---------|--------|
| C-1 | フィルハンドルのドラッグ検出 | fill-controller.ts | 新Hook | **高** |
| C-2 | フィル方向・範囲の自動判定 | selection.ts getFillInfo() | selection-store | **高** |
| C-3 | 数値シリーズの自動生成 | fill-series.ts | utility（流用可） | 中 |
| C-4 | フィル結果のプレビュー表示 | Selection.fillPreviewElement | FillPreview component | 中 |

### カテゴリ D: Undo/Redo履歴管理

| # | 機能 | Vanilla側 | React側 | 優先度 |
|---|------|-----------|---------|--------|
| D-1 | Commandパターンの移植 | command.ts | history-store（新） | **高** |
| D-2 | PromoteBufferRowCommand | command.ts | table-store action | **高** |
| D-3 | SavedIndex管理（保存状態追跡） | history.ts | history-store（新） | 中 |
| D-4 | 複数History並行管理 | history.ts | history-store（新） | 中 |
| D-5 | Tab Dirty表示 | history.ts + tab-button.ts | tab-store | 中 |

### カテゴリ E: 右ペイン（RelationsPanel）

| # | 機能 | Vanilla側 | React側 | 優先度 |
|---|------|-----------|---------|--------|
| E-1 | N:1参照先の自動取得 | relations-panel.ts | relations-store | **高** |
| E-2 | 1:N逆参照の自動取得 | reverse-reference-resolver.ts | relations-store | **高** |
| E-3 | ミニEditorTable生成 | Tab.createMiniEditorTable() | MiniEditorTable component | **高** |
| E-4 | パンくずナビゲーション | relations-panel.ts | 新action | 中 |
| E-5 | ミニテーブルのDirty表示 | RelationsPanel.updateDirtyMark() | relations-store | 中 |

### カテゴリ F: テーブル構造操作（列/行）

| # | 機能 | Vanilla側 | React側 | 優先度 |
|---|------|-----------|---------|--------|
| F-1 | 列挿入/削除 | editor-table-structure.ts | 新Command + table-store action | 中 |
| F-2 | 行挿入/削除 | editor-table-structure.ts | 新Command + table-store action | 中 |
| F-3 | バッファ行昇格 | editor-table.ts | table-store action | 中 |

### カテゴリ G: 参照データ管理

| # | 機能 | Vanilla側 | React側 | 優先度 |
|---|------|-----------|---------|--------|
| G-1 | ReferenceDataCacheのZustand化 | reference-data-cache.ts | reference-store（新） | 中 |
| G-2 | 逆参照マップの構築 | reverse-reference-resolver.ts | utility function | 中 |
| G-3 | 参照式パーサ | reference-expression.ts | utility（流用可） | 低 |

### カテゴリ H: サイドバー・ナビゲーション

| # | 機能 | Vanilla側 | React側 | 優先度 |
|---|------|-----------|---------|--------|
| H-1 | パネル切替制御 | sidebar.ts + activity-bar.ts | Sidebar component | 中 |
| H-2 | REFERENCESパネル（逆参照一覧） | references-panel.ts | ReferencesPanel component | 中 |
| H-3 | SEARCHパネル（全テーブル検索） | search-panel.ts + search-data-provider.ts | SearchPanel component | 低 |
| H-4 | タブ間ナビゲーション | Tab.navigateToTableRow() | 新action | 中 |

### カテゴリ I: スクロール・レイアウト

| # | 機能 | Vanilla側 | React側 | 優先度 |
|---|------|-----------|---------|--------|
| I-1 | フォーカス行の自動スクロール | selection.ts scrollCellIntoView() | 新useEffect | 中 |
| I-2 | 固定ヘッダー（行/列） | CSS sticky | EditorTableView CSS | 中 |
| I-3 | ResizeObserverによる列幅更新 | area-resizer.ts | useEffect + ResizeObserver | 低 |

### カテゴリ J: セル選択表示

| # | 機能 | Vanilla側 | React側 | 優先度 |
|---|------|-----------|---------|--------|
| J-1 | 選択範囲の背景表示 | selection.ts updateRenderer() | SelectionOverlay component | **高** |
| J-2 | コピー範囲の点線表示 | selection.ts updateCopyRenderer() | SelectionOverlay component | 中 |
| J-3 | フォーカスセルのハイライト | selection.ts | Cell component className | **高** |
| J-4 | 列ヘッダー選択状態 | selection.ts | HeaderCell component className | 中 |
| J-5 | 行ヘッダー選択状態 | selection.ts | RowHeader component className | 中 |

### カテゴリ K: コンテキストメニュー

| # | 機能 | Vanilla側 | React側 | 優先度 |
|---|------|-----------|---------|--------|
| K-1 | 右クリックメニュー表示 | editor-table-context-menu.ts + context-menu.ts | 新ContextMenu component | 中 |
| K-2 | メニュー項目の動的有効化 | context-menu.ts | ContextMenu props | 低 |

### カテゴリ L: ファイルI/O・保存

| # | 機能 | Vanilla側 | React側 | 優先度 |
|---|------|-----------|---------|--------|
| L-1 | CSV生成・保存 | editor-actions.ts | 新Hook | **高** |
| L-2 | スキーマ保存 | editor-actions.ts | 新Hook | **高** |
| L-3 | バッファ行昇格後の保存 | editor-table-handler.ts | 新Hook | 中 |
| L-4 | DirtyClear（保存完了） | history.ts + relations-panel.ts | 新action | 中 |

### カテゴリ M: テキスト入力・IME対応

| # | 機能 | Vanilla側 | React側 | 優先度 |
|---|------|-----------|---------|--------|
| M-1 | セル編集開始（F2/ダブルクリック） | editor-table-handler.ts | 新Hook | **高** |
| M-2 | テキストコンテンツ更新 | grid-textfield.ts | GridTextField component | 中 |
| M-3 | IME入力中の処理制御 | editor-table-handler.ts | useEditorTableKeyboard | 中 |
| M-4 | フォーカス管理 | editor-table-handler.ts | 新状態管理 | **高** |

### カテゴリ N: エディタレイアウト（2ペイン）

| # | 機能 | Vanilla側 | React側 | 優先度 |
|---|------|-----------|---------|--------|
| N-1 | 左ペイン（メインテーブル） | editor.ts | App.tsx レイアウト | **高** |
| N-2 | 右ペイン（RelationsPanel） | editor.ts + relations-panel.ts | RelationsPanel component | **高** |
| N-3 | パネル間の相互作用 | EditorTable ↔ RelationsPanel | Zustand action | **高** |

---

## 実装フェーズ

### 完了済み

| Phase | 内容 | コミット |
|-------|------|---------|
| 11 | セル選択・表示（SelectionOverlay、フォーカスハイライト、自動スクロール） | `de1cfcb` |
| 12 | セル編集（F2/ダブルクリック/文字入力、GridTextField） | `8f9522b` |
| 13 | Undo/Redo（history-store、CellChangeCommand、Ctrl+Z/Y） | `5a83e07` |
| 14 | コピー・ペースト（Ctrl+C/V、Delete、Shift+矢印範囲拡張） | `6f988b4` |
| 15 | フィルハンドル（ドラッグ検出、方向判定、数値シリーズ生成） | `0ccb099` |
| 16 | ファイル保存（Ctrl+S、CSV生成、DirtyClear） | `f54f0ac` |
| 17 | 参照データ（reference-store、reverse-reference-store、ヒント表示、ドロップダウン） | `5a5fa00` |
| 18 | RelationsPanel連動（updateForRowAsync、N:1/1:N エントリ解決） | `cc9f035` |

### Phase 19: 構造操作（列/行の挿入・削除）
**目的**: テーブル構造を変更する操作を実装する

1. 行挿入: 選択行の上/下に空行を挿入（InsertRowCommand）
2. 行削除: 選択行を削除（DeleteRowCommand）
3. 列挿入: 選択列の左/右に空列を挿入（InsertColumnCommand）
4. 列削除: 選択列を削除（DeleteColumnCommand）
5. table-store に insertRowAt/removeRow/insertColumn/removeColumn アクション追加
6. useEditorTableKeyboard への対応キーバインド追加

**Vanilla側参照**: editor-table-structure.ts
**完了条件**: 行/列の挿入削除ができ、Undo/Redoに対応している

### Phase 20: バッファ行昇格
**目的**: 末尾の空行に値を入力した際にストア行として昇格させる

1. PromoteBufferRowCommand: バッファ行→ストア行昇格（Undo対応）
2. DemoteStoreRowCommand: Undo時の降格
3. EditorTableView のバッファ行表示ロジック
4. FK自動埋め込み（autoFillEntries）対応

**Vanilla側参照**: editor-table.ts:776-846, command.ts
**完了条件**: 空行に値を入力するとストアに追加、Ctrl+Zで元に戻る

### Phase 21: コンテキストメニュー
**目的**: 右クリックメニューを実装する

1. ContextMenu コンポーネント（汎用）
2. 列ヘッダー右クリック: 列挿入/削除メニュー
3. 行ヘッダー右クリック: 行挿入/削除メニュー
4. セル右クリック: コピー/ペースト/削除メニュー
5. メニュー項目の動的有効化/無効化

**Vanilla側参照**: context-menu.ts, editor-table-context-menu.ts
**完了条件**: 右クリックでメニュー表示、各操作が実行可能

### Phase 22: タブ管理ロジック完成
**目的**: タブのオープン/クローズ/ナビゲーションを完成させる

1. tab-store に openTableAsync アクション（スキーマ+CSV読み込み→テーブル登録）
2. tab-store に closeTab アクション（Dirtyチェック→リソース解放）
3. navigateToTableRow: REFERENCESパネルからのジャンプ
4. navigateToTableCell: SearchPanelからのジャンプ
5. pendingNavigation: タブ読み込み完了後の遅延ナビゲーション

**Vanilla側参照**: tab.ts:188-307
**完了条件**: タブの開閉、外部からのセルジャンプ

### Phase 23: サイドバーロジック完成
**目的**: サイドバーの各パネルのロジックを実装する

1. ExplorerPanel: ファイルツリーからタブを開く
2. ReferencesPanel: PK値の逆参照一覧→クリックでジャンプ
3. SearchPanel: 全テーブル全文検索→クリックでジャンプ
4. SearchDataProvider: テーブルリスト読み込み、キャッシュ管理
5. サイドバーリサイズハンドル

**Vanilla側参照**: sidebar.ts, references-panel.ts, search-panel.ts, search-data-provider.ts
**完了条件**: 各パネルが機能し、ジャンプ操作が動作する

### Phase 24: 定義ジャンプ・ナビゲーション
**目的**: FK値からの定義ジャンプとパンくずナビゲーションを実装する

1. Ctrl+Click / F12: FK列のセルから参照先テーブルへジャンプ
2. navigateToDefinition: 左ペインのタブとして開く
3. パンくずナビゲーション: Tab.navigationHistory ベース

**Vanilla側参照**: editor-table-handler.ts, tab.ts
**完了条件**: Ctrl+Click でFK参照先テーブルにジャンプ

### Phase 25: IME制御・入力精度向上
**目的**: IME入力の正確化と入力制御の完成

1. compositionstart/compositionend イベント処理
2. contenteditable div でのテキスト入力正確化
3. useRef での直接DOM参照

**Vanilla側参照**: editor-table-handler.ts
**完了条件**: 日本語IME入力が正確に動作する

### Phase 26: 列幅リサイズ・コマンドパレット
**目的**: 列幅の動的変更とコマンドパレットを実装する

1. 列ヘッダーのドラッグリサイズ
2. ColumnWidthCommand（Undo対応）
3. Ctrl+P コマンドパレット（テーブル名ファジー検索）

**Vanilla側参照**: area-resizer.ts, command-palette.ts
**完了条件**: 列幅変更、コマンドパレットからテーブルオープン

### Phase 27: タブドラッグ並び替え
**目的**: タブボタンのドラッグ&ドロップ並び替えを実装する

1. @dnd-kit または HTML5 DnD API でタブ並び替え
2. ドロップインジケータ表示
3. tab-store の順序更新アクション

**Vanilla側参照**: tab-drag-drop.ts
**完了条件**: タブをドラッグで並び替えられる

### Phase 28: Vanilla コード除去・最終統合
**目的**: Vanilla側コードを完全に除去し、React版に統合する

1. App.tsx のコメントアウト解除
2. Vanilla側エントリポイント（main.ts）からの呼び出し除去
3. 不要なVanillaファイルの削除
4. Playwrightテストの全件GREEN確認

**完了条件**: React版のみで全機能が動作し、全テストがGREEN

---

## 技術的課題

### 1. キャッシュ陳腐化（逆参照マップ）
- **問題**: バッファ行昇格後、関連パネルのキャッシュが更新されない
- **対策**: Zustand selectorに統合し、store更新時に自動無効化

### 2. 相互参照（EditorTable ↔ RelationsPanel）
- **問題**: 両者が相互参照関係を持ち、Reactの親子関係が曖昧
- **対策**: Zustand actionを通じた間接的な通信で対応

### 3. 複数History並行管理
- **問題**: メイン + ミニEditorTable（複数）のUndo/Redoを独立管理
- **対策**: Zustand historyRegistry Mapで一元管理

### 4. IME入力制御
- **問題**: contenteditable divのfocus/blurでブラウザIMEが混乱
- **対策**: useRef + useEffectでのfine-grained制御

### 5. 仮想スクロール + 固定列
- **問題**: TanStack VirtualはColumn Virtualizationをサポートしない
- **対策**: CSS stickyで固定列を実現
