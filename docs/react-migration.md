# React化 移行計画書

## 前提

### 導入済みライブラリ
- React 19, react-dom 19
- Zustand 5, Immer 11
- TanStack Query 5, TanStack Table 8, TanStack Virtual 3
- @dnd-kit/core 6, @dnd-kit/sortable 10

### 現行コードベース（約12,000行）
| ファイル | 行数 | 責務 |
|---|---|---|
| editor-table.ts | 1,122 | テーブルグリッドファサード |
| editor-table-handler.ts | 1,059 | キーボード・マウスイベント制御 |
| selection.ts | 912 | セル選択・ドラッグ選択 |
| tab.ts | 770 | タブ管理・EditorTable生成 |
| command.ts | 706 | Commandパターン（Undo/Redo） |
| relations-panel.ts | 673 | 右ペイン関連テーブル表示 |
| reference-data-cache.ts | 651 | 参照データキャッシュ |
| reverse-reference-resolver.ts | 481 | 逆参照マップ構築 |
| editor-table-structure.ts | 458 | 列/行の構造操作 |
| history.ts | 400 | Undo/Redo履歴管理 |
| その他（18ファイル） | ~4,854 | 各種UI・ロジック |

### 設計原則（変更なし）
- **SSOTの転換**: DOM → Zustand Store
- **Commandパターン維持**: Undo/Redoは自前実装を継続
- **密結合・高凝集**: React化後もコンポーネント間の直接参照を許容
- **テストファースト**: 各フェーズでPlaywrightテストをGREEN維持

---

## 移行戦略: ボトムアップ段階移行

### 全体方針
VanillaクラスをReactコンポーネント＋Zustand Storeに「内側から外側へ」段階的に置き換える。
各フェーズは独立してコミット・テスト可能な単位とする。

```
Phase 0: 基盤構築（React mount point + Zustand Store + Vite設定）
    ↓
Phase 1: データ層（InMemoryTableStore → Zustand Store）
    ↓
Phase 2: 純粋ロジック層（Command, History, fill-series, reference-expression等）
    ↓
Phase 3: 基本UIコンポーネント（ActivityBar, TabButton, ContextMenu等）
    ↓
Phase 4: EditorTable コア（TanStack Table + TanStack Virtual）
    ↓
Phase 5: Selection + ドラッグ操作
    ↓
Phase 6: 入力制御（GridTextField, GridDropdownInput）
    ↓
Phase 7: Sidebar（Explorer, Search, References）
    ↓
Phase 8: Tab管理（@dnd-kit でタブ並び替え）
    ↓
Phase 9: RelationsPanel（TanStack Query + ミニEditorTable）
    ↓
Phase 10: 統合・main.ts の React化・Vanillaコード除去
```

---

## Phase 0: 基盤構築

### 目的
Reactアプリケーションのマウントポイントを作成し、VanillaコードとReactコードが共存できる状態にする。

### タスク
1. **Vite設定にReactプラグイン追加**
   - `vite.config.ts` に `@vitejs/plugin-react` を追加
2. **エントリポイント分岐**
   - `index.html` に `<div id="root">` を追加
   - `src/main.tsx` を作成し `createRoot(document.getElementById('root')).render(<App />)` で起動
   - 既存の `main.ts` の初期化コードは `App` コンポーネントの `useEffect` 内で一時的に呼び出す（ブリッジ）
3. **App コンポーネント作成**
   - `src/App.tsx`: 最上位レイアウト（Sidebar + TabBar + Editor 領域の枠だけ）
   - `QueryClientProvider` でTanStack Queryのプロバイダをラップ
4. **tsconfig.json にJSX設定追加**
   - `"jsx": "react-jsx"` を追加
5. **CSSインポート方式の変更**
   - `index.html` の `<link>` タグを `App.tsx` での `import './xxx.css'` に移行

### 完了条件
- `npm run dev` でReactアプリが起動する
- 既存のVanilla UIが従来通り動作する（リグレッションなし）

---

## Phase 1: データ層（Zustand Store）

### 目的
InMemoryTableStore をZustand Storeに移行し、React stateとしてテーブルデータを管理できる状態にする。

### タスク
1. **`src/stores/table-store.ts` を作成**
   ```typescript
   // Zustand + Immer でテーブルデータを管理
   interface TableStoreState {
     headers: Map<string, string[]>
     rows: Map<string, string[][]>
     refCounts: Map<string, number>
     // actions
     registerTable(tableName: string, header: string[], body: string[][]): void
     registerTableAsync(tableName: string): Promise<Csv>
     unregisterTable(tableName: string): void
     updateCellValue(tableName: string, rowIndex: number, colIndex: number, value: string): boolean
     appendRow(tableName: string, values: string[]): void
     removeRow(tableName: string, rowIndex: number): void
     insertRowAt(tableName: string, rowIndex: number, values: string[]): void
     // ... 既存のInMemoryTableStoreの全メソッドをaction化
   }
   ```
2. **Dirty管理をストアに統合**
   - `historyRegistry` と `dirtyTableNames` もZustand stateに含める
3. **既存 InMemoryTableStore をアダプター化**
   - Phase 1完了時点では、既存クラスの内部をZustand storeへの委譲に書き換える
   - Vanilla側のコードは既存インターフェースのまま動作する
4. **TanStack Query のクエリ関数定義**
   - `src/queries/table-queries.ts`: `readFileAsync` をラップするクエリ関数
   - スキーマJSON読み込み、CSVファイル読み込みをそれぞれクエリ化

### 完了条件
- Zustand storeが全テーブルデータのSSOTとして機能する
- 既存InMemoryTableStoreのAPIを通じてVanillaコードが動作する
- Playwrightテスト全GREEN

---

## Phase 2: 純粋ロジック層

### 目的
DOM非依存の純粋ロジック（Command, History, fill-series, reference-expression, Csv）をReact hookまたはそのまま流用可能な形に整理する。

### タスク
1. **そのまま流用するモジュール（変更なし）**
   - `fill-series.ts` — 純粋関数
   - `reference-expression.ts` — 純粋パース関数
   - `csv.ts` — CSV変換ロジック
   - `search-query.ts` — クエリパース
2. **Command / History をZustandと連携**
   - `src/stores/history-store.ts` を作成
   - 各タブのHistoryインスタンスをstoreで管理
   - `canUndo`, `canRedo`, `isDirty` をリアクティブなstateとして公開
   - Commandの execute/undo/redo はZustand storeのactionを直接呼び出す
3. **reference-data-cache → TanStack Query化**
   - `src/queries/reference-queries.ts` を作成
   - `queryKey: ['referenceData', tableName]` でキャッシュ管理
   - 既存の `evictEntry()` → `queryClient.removeQueries()` に対応表を作成
4. **reverse-reference-resolver → TanStack Query化**
   - `queryKey: ['reverseReferences', tableName]` でキャッシュ管理
   - 逆参照マップはZustand storeにも保持（複数コンポーネントからの参照用）

### 完了条件
- Command/Historyが Zustand store経由でUndo/Redo可能
- 参照データがTanStack Query経由で取得・キャッシュされる
- Playwrightテスト全GREEN

---

## Phase 3: 基本UIコンポーネント

### 目的
小規模な末端UIをReactコンポーネントに置き換える。

### タスク
1. **ActivityBar コンポーネント**
   - `src/components/ActivityBar.tsx`
   - 3つのアイコンボタン + アクティブ状態管理
   - SVGアイコンはインラインJSXで保持（既存のハードコードSVGを移植）
2. **TabButton コンポーネント**
   - `src/components/TabButton.tsx`
   - タブ名表示、Dirtyマーク、閉じるボタン、中クリック閉じ
3. **ContextMenu コンポーネント**
   - `src/components/ContextMenu.tsx`
   - 右クリック位置にポータルで表示
4. **Toolbar コンポーネント**
   - `src/components/Toolbar.tsx`
5. **CommandPalette コンポーネント**
   - `src/components/CommandPalette.tsx`
   - Ctrl+P でオーバーレイ表示、テーブル名のフィルタリング選択

### 完了条件
- 各コンポーネントが単体でレンダリングされる
- 既存CSSがそのまま適用される
- Playwrightテスト全GREEN

---

## Phase 4: EditorTable コア

### 目的
テーブルグリッドの中核をTanStack Table + TanStack Virtualで再構築する。**最大かつ最も慎重に進めるフェーズ。**

### タスク
1. **TanStack Table のテーブル定義**
   - `src/components/EditorTable/EditorTable.tsx`
   - `useReactTable()` でカラム定義・行データをZustand storeから取得
   - ヘッダー行（列名）、データ行、バッファ空行の3種を区別
2. **TanStack Virtual で仮想スクロール**
   - `useVirtualizer()` で行の仮想化
   - 可変行高さ（`estimateSize` + `measureElement`）
   - 行ヘッダーのsticky対応
3. **セルレンダリング**
   - 通常セル: テキスト表示 + 参照ヒント（FK値の横に参照先の表示名）
   - ヘッダーセル: 列名 + ソートインジケーター
   - 行番号ヘッダー: 行インデックス表示
4. **storeRowIndices の管理**
   - DOM行とストア行のマッピングをstateとして管理
   - ミニテーブル用のフィルタリングロジックもここで処理
5. **ScrollViewportController の置き換え**
   - `scrollToIndex()` APIで `ensureCellVisible()` を実現
6. **参照ヒントの表示**
   - セルコンポーネントのpropsとして `hintText: string | null` を渡す
   - 既存の `EditorTableReference` のDOM操作を宣言的レンダリングに変更

### 完了条件
- テーブルが仮想スクロール付きでレンダリングされる
- セル値がZustand storeからリアクティブに表示される
- 参照ヒントが表示される
- Playwrightテスト全GREEN

---

## Phase 5: Selection + ドラッグ操作

### 目的
セル選択・ドラッグ選択・フィルハンドルをReact stateで管理する。

### タスク
1. **Selection state をZustand storeに移行**
   - `src/stores/selection-store.ts`
   - CellRange, CellPosition, focusをstateとして管理
   - 選択範囲の背景は絶対配置divとしてレンダリング（既存方式を維持）
2. **ドラッグ選択**
   - `onMouseDown` / `window.addEventListener('mousemove')` を `useEffect` で管理
   - `document.elementsFromPoint()` によるセルヒットテストを維持
   - オートスクロールは `requestAnimationFrame` ループを `useRef` で保持
3. **フィルハンドル**
   - フィルハンドル要素をSelectionコンポーネント内にレンダリング
   - ドラッグ操作はPhase 5-2と同様のパターン
   - `fill-series.ts` の純粋関数をそのまま呼び出し
4. **コピー範囲の点線ボーダー**
   - 既存の4要素（topBorder等）をReactコンポーネントとしてレンダリング

### 完了条件
- マウスクリックでセル選択できる
- Shift+クリックで範囲選択できる
- ドラッグで範囲選択できる
- フィルハンドルで連続データ生成できる
- Playwrightテスト全GREEN

---

## Phase 6: 入力制御

### 目的
セル編集（テキスト入力・ドロップダウン）をReactコンポーネント化する。

### タスク
1. **GridTextField コンポーネント**
   - `src/components/GridTextField.tsx`
   - contenteditable div を `useRef` で保持
   - セル位置に絶対配置（座標はEditorTableから取得）
   - IME対応（compositionstart/compositionend）
2. **GridDropdownInput コンポーネント**
   - `src/components/GridDropdownInput.tsx`
   - FK列のセル編集時にドロップダウン表示
   - テキストフィルタリング（ID・表示名の部分一致）
   - キーボード選択（矢印キー）
   - 位置計算は `getBoundingClientRect()` を `useRef` 経由で使用
3. **EditorTableHandler のReact化**
   - `src/hooks/useEditorTableKeyboard.ts`
   - キーボードイベント（Enter, Tab, Escape, 矢印キー, Ctrl+Z/Y/C/V/S, Delete）
   - `useEffect` でkeydownリスナーを登録
   - Commandの生成・History への積み上げはZustand storeのaction呼び出し

### 完了条件
- セルをダブルクリックしてテキスト入力できる
- FK列でドロップダウンから選択できる
- Ctrl+Z/Y でUndo/Redo動作する
- Ctrl+C/V でコピー&ペーストできる
- Playwrightテスト全GREEN

---

## Phase 7: Sidebar

### 目的
サイドバー（Explorer, Search, References）をReactコンポーネント化する。

### タスク
1. **Sidebar コンポーネント**
   - `src/components/Sidebar/Sidebar.tsx`
   - ActivityBar + パネル切替 + リサイズハンドル
   - リサイズはmousedown/mousemove/mouseupを `useEffect` + `useRef` で実装
2. **ExplorerPanel コンポーネント**
   - `src/components/Sidebar/ExplorerPanel.tsx`
   - ファイルリスト表示、クリックでタブオープン
3. **SearchPanel コンポーネント**
   - `src/components/Sidebar/SearchPanel.tsx`
   - テキスト入力 + オプションボタン（caseSensitive/wholeWord/regex）
   - 検索結果リスト + クリックでセルナビゲーション
   - デバウンスは `setTimeout` + `useRef` で自前実装（150ms）
4. **ReferencesPanel コンポーネント**
   - `src/components/Sidebar/ReferencesPanel.tsx`
   - 逆参照エントリのフォルダツリー表示
   - クリックでテーブル行ジャンプ

### 完了条件
- 3パネルが切り替わる
- ファイルクリックでタブが開く
- 検索が動作する
- 逆参照表示が動作する
- Playwrightテスト全GREEN

---

## Phase 8: Tab管理

### 目的
タブバーをReactコンポーネント化し、@dnd-kitでドラッグ並び替えを実現する。

### タスク
1. **TabBar コンポーネント**
   - `src/components/TabBar/TabBar.tsx`
   - タブボタン一覧 + タブ状態管理
   - @dnd-kit/sortable でドラッグ並び替え
2. **Tab状態をZustand storeに移行**
   - `src/stores/tab-store.ts`
   - アクティブタブ、タブ順序、各タブのEditorTable参照をstateとして管理
3. **タブのライフサイクル管理**
   - タブオープン: スキーマ + CSV読み込み → EditorTable生成
   - タブ切替: activate/deactivate
   - タブクローズ: リソース解放、Dirtyチェック

### 完了条件
- タブのオープン・クローズ・切り替えが動作する
- タブのドラッグ並び替えが動作する
- Dirty状態がタブボタンに反映される
- Playwrightテスト全GREEN

---

## Phase 9: RelationsPanel

### 目的
右ペインのRelationsPanelをReactコンポーネント化する。**Phase 4のEditorTableをミニテーブルとして再利用。**

### タスク
1. **RelationsPanel コンポーネント**
   - `src/components/RelationsPanel/RelationsPanel.tsx`
   - N:1（参照先）、1:N（逆参照）セクションを縦並び表示
   - TanStack Query で参照データを非同期取得
   - `queryKey` + 自動キャンセルで `currentRequestId` パターンを置換
2. **MiniEditorTable コンポーネント**
   - Phase 4のEditorTableコンポーネントを `isMiniTable` propsで再利用
   - 編集可能、フィルハンドル有効
   - FK自動埋め込み（1:N行追加時）
3. **リサイズハンドル**
   - mousedown/mousemove/mouseupを `useEffect` + `useRef` で実装
4. **排他制御**
   - アクティブなミニEditorTableをZustand storeで管理

### 完了条件
- 行選択で右ペインにN:1/1:Nテーブルが表示される
- ミニテーブルが編集可能
- 1:N行追加でFK値が自動埋め込みされる
- Ctrl+Click / F12 で定義ジャンプできる
- Playwrightテスト全GREEN

---

## Phase 10: 統合・Vanillaコード除去

### 目的
全コンポーネントをReactツリーに統合し、Vanillaコードを除去する。

### タスク
1. **App.tsx の完成**
   - 全コンポーネントをReactツリーとして構成
   - Vanillaブリッジコードを削除
2. **不要ファイルの削除**
   - 置き換え済みの `.ts` ファイルを削除
   - `index.html` のVanilla用DOM要素を削除
3. **グローバルキーボードショートカット**
   - Ctrl+Shift+F, Ctrl+P をReactコンポーネントレベルで管理
4. **テスト用グローバル変数**
   - `window.editor` をReactのstore経由で公開
5. **最終テスト**
   - Playwrightテスト全GREEN
   - 手動確認: 全機能の動作確認

### 完了条件
- Vanillaコードが0行
- React + Zustand + TanStack 構成で全機能が動作する
- Playwrightテスト全GREEN

---

## ディレクトリ構成（最終形）

```
WebView/src/
├── main.tsx                    # Reactエントリポイント
├── App.tsx                     # ルートコンポーネント
├── stores/
│   ├── table-store.ts          # テーブルデータ（旧InMemoryTableStore）
│   ├── selection-store.ts      # セル選択状態
│   ├── tab-store.ts            # タブ状態
│   └── history-store.ts        # Undo/Redo履歴
├── queries/
│   ├── table-queries.ts        # CSV/スキーマ読み込み
│   └── reference-queries.ts    # 参照データキャッシュ
├── components/
│   ├── EditorTable/
│   │   ├── EditorTable.tsx     # メインテーブルグリッド
│   │   ├── Cell.tsx            # セルレンダリング
│   │   ├── HeaderCell.tsx      # ヘッダーセル
│   │   └── Selection.tsx       # 選択範囲オーバーレイ
│   ├── GridTextField.tsx       # contenteditable テキスト入力
│   ├── GridDropdownInput.tsx   # FK選択ドロップダウン
│   ├── ContextMenu.tsx         # コンテキストメニュー
│   ├── TabBar/
│   │   ├── TabBar.tsx          # タブバー
│   │   └── TabButton.tsx       # 個別タブボタン
│   ├── Sidebar/
│   │   ├── Sidebar.tsx         # サイドバーレイアウト
│   │   ├── ActivityBar.tsx     # アクティビティバー
│   │   ├── ExplorerPanel.tsx   # ファイルエクスプローラー
│   │   ├── SearchPanel.tsx     # 検索パネル
│   │   └── ReferencesPanel.tsx # 逆参照パネル
│   ├── RelationsPanel/
│   │   ├── RelationsPanel.tsx  # 右ペイン
│   │   └── MiniEditorTable.tsx # ミニテーブル
│   ├── Toolbar.tsx             # ツールバー
│   └── CommandPalette.tsx      # コマンドパレット
├── hooks/
│   ├── useEditorTableKeyboard.ts  # キーボードショートカット
│   └── useDragSelection.ts       # ドラッグ選択
├── commands/                   # Commandパターン（自前維持）
│   ├── command.ts              # Command インターフェース
│   ├── cell-change-command.ts
│   ├── insert-row-command.ts
│   ├── delete-row-command.ts
│   ├── composite-command.ts
│   └── promote-buffer-row-command.ts
├── utils/                      # 純粋関数（変更なし）
│   ├── fill-series.ts
│   ├── reference-expression.ts
│   ├── csv.ts
│   ├── search-query.ts
│   └── api.ts
├── model/                      # データモデル（変更なし）
│   ├── editor-table-data.ts
│   ├── editor-table-data-row.ts
│   └── editor-table-data-column.ts
└── types.ts                    # 型定義
```

---

## リスク管理

| リスク | 影響 | 対策 |
|---|---|---|
| Phase 4（EditorTable）の複雑さ | 全体遅延 | サブタスクに細分化、ヘッダー→データ行→バッファ行の順で段階実装 |
| 仮想スクロールとselection座標のズレ | セル選択バグ | `useRef` でDOM要素を直接参照し `getBoundingClientRect()` を使用 |
| IME入力のReact化 | 日本語入力不可 | contenteditable divを `useRef` で保持し、Reactのstateとは分離 |
| Commandパターンとストアの二重管理 | データ不整合 | Command.execute() 内でストアのactionを呼び出す一方向フロー |
| ミニEditorTableのライフサイクル | メモリリーク | `useEffect` のcleanupで確実にdeactivate/unregister |
| 既存Playwrightテストのセレクタ破壊 | テスト失敗 | 各フェーズで既存CSSクラス名を維持し、data-testid を追加 |

---

## 実行順序の根拠

1. **Phase 0-1（基盤＋データ層）が最優先**: 全コンポーネントがデータストアに依存するため
2. **Phase 2（ロジック層）が次**: Commandパターンが正しく動かないと以降のUI層がテストできない
3. **Phase 3（基本UI）が先**: 小さなコンポーネントで React 化のパターンを確立する
4. **Phase 4-6（EditorTable系）が中核**: 最も複雑だが、Phase 3で確立したパターンを適用
5. **Phase 7-9（周辺パネル）が後**: EditorTableコンポーネントを前提とするため
6. **Phase 10（統合）が最後**: 全パーツが揃ってからVanillaコードを除去
