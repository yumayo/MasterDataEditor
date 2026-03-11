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

## 実装フェーズ（Phase 11〜19）

### Phase 11: セル選択・表示（カテゴリ J + I）
**目的**: セル選択の視覚的表現を完成させる

1. J-1: 選択範囲の背景表示（SelectionOverlay）
2. J-3: フォーカスセルのハイライト
3. I-1: フォーカス行の自動スクロール
4. J-2: コピー範囲の点線表示
5. J-4, J-5: 列/行ヘッダー選択状態

**完了条件**: セルクリックで選択表示、Shift+クリックで範囲選択表示

### Phase 12: セル編集（カテゴリ A + M）
**目的**: セルの値を編集できるようにする

1. M-1: セル編集開始（F2/ダブルクリック）
2. A-1: テキスト入力モード
3. M-4: フォーカス管理
4. M-3: IME入力中の処理制御
5. A-3: 参照ヒント表示

**完了条件**: セルをダブルクリックしてテキスト入力、確定でストア更新

### Phase 13: Undo/Redo（カテゴリ D）
**目的**: Commandパターンによる履歴管理を実装する

1. D-1: Commandパターンの移植（history-store新設）
2. D-2: PromoteBufferRowCommand
3. B-3: Ctrl+Z/Y キーバインド
4. D-3: SavedIndex管理
5. D-5: Tab Dirty表示

**完了条件**: セル編集後Ctrl+Zで元に戻る、Ctrl+Yでやり直せる

### Phase 14: コピー・ペースト・削除（カテゴリ B）
**目的**: クリップボード操作を実装する

1. B-1: Ctrl+C（コピー）
2. B-2: Ctrl+V（ペースト）
3. B-5: Delete/Backspace（セルクリア）
4. B-6: 矢印キー + Shift（範囲拡張）

**完了条件**: Ctrl+C/V でコピー＆ペースト、Delete でセルクリア

### Phase 15: フィルハンドル（カテゴリ C）
**目的**: フィルハンドルによる連続データ生成を実装する

1. C-1: フィルハンドルのドラッグ検出
2. C-2: フィル方向・範囲の自動判定
3. C-3: 数値シリーズの自動生成
4. C-4: フィル結果のプレビュー表示

**完了条件**: フィルハンドルドラッグで連続データ生成

### Phase 16: ファイル保存（カテゴリ L）
**目的**: CSV/スキーマの保存機能を実装する

1. L-1: CSV生成・保存
2. L-2: スキーマ保存
3. B-4: Ctrl+S キーバインド
4. L-4: DirtyClear

**完了条件**: Ctrl+S でファイル保存、Dirty表示がクリアされる

### Phase 17: 参照データ（カテゴリ G + A残り）
**目的**: 参照データのキャッシュ・解決機構を実装する

1. G-1: ReferenceDataCacheのZustand化
2. G-2: 逆参照マップの構築
3. A-2: 参照列ドロップダウン
4. A-4: 逆参照ヒント
5. A-5: 動的参照対応

**完了条件**: FK列のドロップダウン選択、参照ヒント表示

### Phase 18: RelationsPanel完成（カテゴリ E + N）
**目的**: 右ペインの参照パネルを完成させる

1. E-1: N:1参照先の自動取得
2. E-2: 1:N逆参照の自動取得
3. E-3: ミニEditorTable生成
4. N-3: パネル間の相互作用
5. E-4: パンくずナビゲーション

**完了条件**: 行選択で右ペインに関連テーブルが表示・編集可能

### Phase 19: 周辺機能（カテゴリ F, H, K）
**目的**: 構造操作・サイドバー・コンテキストメニューを完成させる

1. F-1, F-2: 列/行挿入・削除
2. F-3: バッファ行昇格
3. K-1: コンテキストメニュー
4. H-1〜H-4: サイドバー各パネルのロジック完成

**完了条件**: 行/列の挿入削除、コンテキストメニュー、サイドバー全機能

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
