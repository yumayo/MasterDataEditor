# リレーションパネル編集機能 実装仕様書

## 1. 機能一覧

### A. リレーションパネルのテーブルを編集可能にする

#### 概要
現在 `createMiniEditorTable()` の末尾で呼ばれている `editorTable.makeReadOnly()` を廃止し、ミニEditorTableをフル編集可能にする。

#### 詳細仕様
- `makeReadOnly()` の呼び出しを削除する。
- ミニEditorTableの `EditorTableHandler` を `enable()` して、キーボードイベント（Enter編集、Delete削除、Ctrl+Z/Y等）を受け付ける。
- `EditorTableContextMenu` のコンテキストメニュー（行挿入・行削除・列挿入・列削除）を有効にする。
- ミニEditorTableの `FillController` を `initialize()` 後に `activate()` して、フィルハンドルによるドラッグ操作を有効にする。
- `AreaResizer` は `activate()` しない（右ペインでの列幅・行高さリサイズは不要）。
- セルのダブルクリック編集、参照列のドロップダウン選択は既存の `EditorTable.createCell()` のイベントハンドラがそのまま動作する。
- ミニEditorTableにも `DropdownInput` を生成する。現在 `createMiniEditorTable()` では `editorTableHandler.setReferenceComponents()` を呼んでいないため、これを追加する。

#### フォーカス排他制御
既存の `RelationsPanel.activateHandler()` がそのまま機能する。セルの `mousedown` イベントで `relationsPanel.activateHandler(table)` が呼ばれ、クリックしたテーブルのみがアクティブになる。

#### Undo/Redo
各ミニEditorTableは独自の `History` インスタンスを持つ（`createMiniEditorTable()` 内で生成済み）。テーブルごとに独立したUndo/Redo履歴になる。ミニEditorTableにフォーカスがある状態でCtrl+Z/Yを押すと、そのテーブルのHistoryが操作される。

---

### B. 行追加時に外部キーを自動埋め込みする

#### 概要
右ペインの1:Nテーブルで行を追加したとき、親テーブルの外部キー値を自動的にセルに埋め込む。

#### 詳細仕様

##### コンテキスト情報の保持
`RelationEntry` インターフェースに以下のフィールドを追加する:

```typescript
interface RelationEntry {
    // ...既存フィールド...
    /** 1:Nの場合: 親テーブルのFK列名（子テーブル側の列名） */
    fkColumnName: string;
    /** 1:Nの場合: 親テーブルのFK値（自動埋め込みする値） */
    fkValue: string;
}
```

1:Nエントリを構築する際（`resolveEntriesForEditorRowAsync()` の逆参照解決部分）、`reverseEntry` から `childColumnName` と親のPK値を取得して `fkColumnName` / `fkValue` に設定する。

N:1エントリの場合は `fkColumnName = ''`、`fkValue = ''` とする（N:1テーブルに行追加するケースでは外部キー自動埋め込みの対象外）。

##### ミニEditorTableへのコンテキスト伝達
`buildMiniEditorTableAsync()` でミニEditorTableを生成した後、そのEditorTableに対してコンテキスト情報を設定する。

EditorTableに以下のフィールドを追加する:

```typescript
/** 行追加時に自動埋め込みするFK列名と値のペア配列 */
private autoFillEntries: Array<{ columnName: string; value: string }>;
```

初期値は空配列。`setAutoFillEntries(entries)` メソッドで設定する。

##### 行挿入コマンドの拡張
`InsertRowCommand` / `InsertRowsCommand` の `execute()` 内で、行挿入後に `autoFillEntries` を参照して該当セルに値を書き込む。

具体的な流れ:
1. コンテキストメニューから「下に行を挿入」を選択
2. `EditorTableStructure.insertRow()` → `InsertRowCommand.execute()`
3. 新しい行がDOMに追加される
4. `autoFillEntries` の各エントリについて、列ヘッダー名から列インデックスを解決し、該当セルに値を書き込む
5. ストアにも同期する（`updateCellValueAt()` 経由）

##### Undo対応
自動埋め込みされたセル値は `InsertRowCommand` のUndoで行ごと削除される。行の挿入と値の埋め込みは1つのコマンドとして扱い、Undo1回で元に戻る。

---

### C. 右ペインの編集を左ペインに即時反映する

#### 概要
右ペインでセルを編集すると、中央ストア（`InMemoryTableStore`）が更新される。左ペインのEditorTableは同じストアを参照しているため、参照ヒントの再描画で反映する。

#### 詳細仕様

##### ストア更新の仕組み（既存）
ミニEditorTableのセル編集は `EditorTable.updateCellValueAt()` を通じて以下を実行する:
1. DOMの更新（`reference.setCellValueAt()`）
2. ストアの更新（`store.updateCellValue()`）
3. referenceDataCacheの更新（`referenceDataCache.updateFullDataCell()`）

この仕組みは既に実装済みで、`makeReadOnly()` を外すだけで動作する。

##### 左ペインへの反映
右ペインでのセル編集後、左ペインのEditorTableの参照ヒントを再描画する必要がある。

方法: ミニEditorTableの `applyCellChanges()` / `replayCellChanges()` の末尾で、左ペインの `currentEditorTable` の参照ヒントを更新する。

`RelationsPanel` に以下のメソッドを追加する:

```typescript
/** ミニEditorTableのセル編集後に左ペインの参照ヒントを再描画する */
notifyMiniTableCellChanged(): void {
    if (this.currentEditorTable === false) return;
    this.currentEditorTable.updateReferenceHints();
}
```

ミニEditorTableの `applyCellChanges()` / `replayCellChanges()` 内の `forceRefreshRelationsPanel()` 呼び出しの直後に、`relationsPanel.notifyMiniTableCellChanged()` を呼ぶ。

ただし、ミニEditorTableの `isMiniTable` フラグを利用して、左ペインテーブルでは呼ばない（無限ループ防止）。

##### 考慮事項: ミニEditorTable自身の再描画
現在、ミニEditorTableは `isMiniTable = true` により `notifyRowSelectionChanged()` を抑制している。これにより、ミニテーブルのセル編集で `forceRefreshRelationsPanel()` を呼んでも、自己破棄のループは発生しない。

ただし、`forceRefreshRelationsPanel()` は左ペインの `Selection.forceNotifyRelationsPanel()` を呼ぶため、左ペインの選択行に基づいてリレーションパネル全体が再描画される。つまり、ミニEditorTableのセル編集後にパネル全体が再構築され、編集中のミニEditorTableが破棄される。

これを防ぐため、ミニEditorTableの `forceRefreshRelationsPanel()` は呼ばない。代わりに `notifyMiniTableCellChanged()` のみ呼ぶ。`isMiniTable` フラグで分岐する。

---

### D. ドリルダウン = 左ペインで開く（定義へジャンプ）

#### 概要
右ペインのリレーションテーブルから参照先テーブルを開く操作を、右ペイン内の階層深化ではなく、左ペインの新規タブとして実装する。

#### 操作方法
- **Ctrl+クリック**: 参照セル（外部キー列のセル）をCtrl+クリックすると、参照先テーブルを左ペインのタブで開き、該当行にフォーカスする。
- **F12キー**: 参照セルにフォーカスがある状態でF12を押すと同様の動作。

#### 詳細仕様

##### 発火条件
セルの `mousedown` イベントで `e.ctrlKey` または `e.metaKey` が true の場合、通常のセル選択の代わりに定義へジャンプを実行する。F12は `EditorTableHandler` の `onKeydown` で処理する。

##### ジャンプの実行
1. フォーカスセルの列が参照列（`header[colIdx].reference` が存在する）かを判定する。
2. 参照式を `parseReferenceExpression()` でパースし、参照先テーブル名を取得する。
3. セルの値（FK値）を取得する。
4. `Tab.navigateToTableRow(tableName, pkValue)` を呼び出す。
  - 既にタブが開かれていれば、そのタブをアクティブにして該当行を選択する。
  - 開かれていなければ、新規タブを作成して読み込み完了後に該当行を選択する。
5. 右ペインは新しいタブのリレーションに自動更新される（`activateTabState()` 内の `connectEditorTable()` で実現）。

##### ジャンプ対象の判定
- N:1参照列のセル: 参照先テーブルの該当PK行にジャンプ。
- 1:Nは対象外（子テーブルの特定行を指し示すFK値がないため）。
- セル値が空の場合はジャンプしない。

##### 実装箇所
- `EditorTable.createCell()` の `mousedown` イベントハンドラに Ctrl+クリック分岐を追加する。
- `EditorTableHandler.onKeydown()` に F12 のハンドラを追加する。
- ジャンプ処理の実体は `EditorTable` または `EditorTableHandler` に `navigateToDefinition()` メソッドとして実装する。Tab への参照は `RelationsPanel` 経由（`relationsPanel` → `tab`）で取得するか、EditorTableに Tab 参照を直接持たせる。

#### パンくずリスト（タブ遷移履歴）

##### 概要
左ペインのタブ遷移履歴をパンくずリストとして表示する。現行のnavStackベースのパンくずリスト（右ペイン内の階層管理）を廃止し、タブ遷移の履歴として再設計する。

##### データ構造
`Tab` クラスに遷移履歴スタックを追加する:

```typescript
/** タブ遷移履歴（定義へジャンプの履歴） */
private navigationHistory: Array<{ tableName: string; pkValue: string }>;
```

##### 表示位置
パンくずリストは右ペイン（リレーションパネル）の上部に表示する。現行の `.relations-breadcrumb` のDOM位置をそのまま使用する。

##### 動作
- 定義へジャンプ実行時: 遷移元の `{ tableName, pkValue }` をスタックにpushする。
- パンくずのクリック: 該当タブをアクティブにし、pkValueの行を選択する。クリックした位置より後の履歴は切り捨てる。
- タブを手動で切り替えた場合: 履歴は更新しない（手動切り替えはジャンプではない）。
- タブを閉じた場合: そのタブを含む履歴エントリを除去する。

##### 表示形式
```
イベント › クエスト › エネミー › スキル（現在のタブ）
```
- 現在のタブ名は太字、クリック不可。
- それ以外はリンク色、クリックでジャンプ。
- セパレータは `›`。

#### 現行の navStack / drillDownAsync の廃止

以下を `relations-panel.ts` から削除する:
- `NavFrame` インターフェース
- `navStack` フィールド
- `drillDownAsync()` メソッド
- `buildBreadcrumb()` メソッド（タブ遷移履歴用に再実装する）
- `resolveEntriesForStoreRowAsync()` メソッド（ドリルダウン専用のため不要になる）

`renderAsync()` は `navStack` を参照せず、直接 `entries` 配列を受け取る形に変更する。

#### 外部キー列の非表示とコンテキスト表示

##### 外部キー列の非表示
1:Nリレーションのミニテーブルでは、親テーブルを参照しているFK列を非表示にする。

方法: `buildMiniEditorTableAsync()` でスキーマJSONを渡す際に、FK列を除外した `header` / `rows` を生成してから `EditorTableData.parse()` に渡す。あるいは、`EditorTableData` から該当列を削除する。

具体的には、`RelationEntry` に `hiddenColumns: string[]` フィールドを追加し、1:Nエントリでは FK列名を設定する。`buildMiniEditorTableAsync()` 内でスキーマの `header` 定義から該当列を除外し、`csvRows` からも該当列のデータを除外する。

##### コンテキスト表示
テーブルヘッダー（`.relations-table-header`）に「`enemy_id=3` でフィルタ中」のようなコンテキスト表示を追加する。

```html
<div class="relations-table-header">
    <span class="relations-table-title">drop_item</span>
    <span class="relations-tag relations-tag--1n">1:N</span>
    <span class="relations-table-context">enemy_id=3</span>
    <span class="relations-table-row-count">5 rows</span>
</div>
```

CSSクラス `.relations-table-context` を追加する:
```css
.relations-table-context {
    font-size: 10px;
    color: var(--font-color);
    opacity: 0.6;
    padding: 1px 6px;
    border-radius: 3px;
    background-color: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border-color);
}
```

---

### E. 左右ペインの認知支援

#### 編集中テーブルの視覚的区別

##### 静的な視覚差
右ペインのミニEditorTableには背景色の差をつける。

方法: ミニEditorTableのルート要素に `.mini-editor-table` のような識別クラスを追加し、CSSで背景色を変更する。

```css
.relations-panel .editor-table {
    background-color: var(--background-sub-color);
}
```

現在、左ペインの背景は `var(--background-color)`、右ペインのパネル背景は `var(--background-sub-color)` で差がついている。ミニEditorTable内のセルにも右ペインの背景色を適用する。

##### フォーカスインジケータ
既存のフォーカス排他制御（`activateHandler()`）に加え、アクティブなテーブルのボーダーを強調する。

方法: `activateHandler()` 内で、アクティブなEditorTableの親 `.relations-table-section` に `.relations-table-section--active` クラスを付与し、非アクティブなセクションからは除去する。

```css
.relations-table-section--active {
    border-left: 2px solid var(--focus-border, #007acc);
}
```

左ペインのEditorTableがアクティブな場合は、全ミニテーブルセクションから `--active` を除去する。

#### 未保存インジケータ

##### 概要
右ペインで編集した変更が未保存の場合、テーブル名の横にドットインジケータを表示する。

##### 実装
各ミニEditorTableの `History` の `isDirty()` を監視する。

方法: `History` のコマンド実行後にコールバックで通知する仕組みは現在存在しない。代わりに、ミニEditorTableのセル編集後（`applyCellChanges()` の後）にDOMを更新する。

具体的には、`.relations-table-header` 内の `.relations-table-title` の後に `.relations-table-dirty-indicator` を配置する:

```html
<span class="relations-table-dirty-indicator" style="display:none;">●</span>
```

ミニEditorTableのセル変更時に、対応するインジケータの `display` を `inline` に切り替える。Undo で `isDirty()` が false に戻った場合は `none` にする。

ただし、現在のアーキテクチャでは、ミニEditorTableは `renderAsync()` のたびに破棄・再構築される。行選択の変更でミニテーブルが破棄されると、編集中の変更も失われる。これは機能Aの前提条件として解決すべき根本問題である（後述のエッジケースを参照）。

##### CSS
```css
.relations-table-dirty-indicator {
    color: #e5c07b;
    font-size: 8px;
    margin-left: 4px;
    vertical-align: middle;
}
```

---

### F. 左ペイン変更時の右ペイン追従

#### 概要
左ペインで外部キーの値を変更した場合、右ペインのフィルタリングも追従する。

#### 詳細仕様
この機能は既存の `forceRefreshRelationsPanel()` で実現されている。

現在の動作:
1. 左ペインでセルを編集 → `applyCellChanges()` → `forceRefreshRelationsPanel()`
2. `Selection.forceNotifyRelationsPanel()` → `lastNotifiedRow = -1` にリセット → `notifyRowSelectionChanged(focusRow)` を呼ぶ
3. `RelationsPanel.updateForRow(rowIndex)` → `updateForRowAsync()` で最新のFK値を読み取り → 右ペインを再描画

つまり、左ペインでFK値を変更すると、右ペインは自動的に新しいFK値に基づいてフィルタリングされる。追加実装は不要。

ただし、機能Aの導入に伴い、右ペインの再描画でミニEditorTableが破棄・再構築されるため、右ペインで編集中の未保存変更が失われる問題がある（エッジケースを参照）。

---

## 2. 現行コードからの変更点

### `WebView/src/relations-panel.ts`

| 変更内容 | 詳細 |
|----------|------|
| `NavFrame` インターフェース | 削除。navStack による右ペイン内の階層管理を廃止する |
| `navStack` フィールド | 削除。代わりに `currentEntries: RelationEntry[]` を持つ |
| `drillDownAsync()` | 削除。ドリルダウンは左ペインのタブ遷移として実装する |
| `resolveEntriesForStoreRowAsync()` | 削除。ドリルダウン専用のstore解決が不要になる |
| `buildBreadcrumb()` | 削除。パンくずリストはタブ遷移履歴として `Tab` 側に移動する |
| `RelationEntry` | `fkColumnName`, `fkValue`, `hiddenColumns` フィールドを追加 |
| `renderAsync()` | `navStack` 参照を廃止、`currentEntries` から直接描画する |
| `buildMiniTableAsync()` | FK列の非表示処理とコンテキスト表示を追加する |
| `buildMiniEditorTableAsync()` | `makeReadOnly()` 呼び出しを削除。`setReferenceComponents()` / `enable()` / FillController の `activate()` を追加。`autoFillEntries` を設定する |
| `notifyMiniTableCellChanged()` | 新規追加。ミニEditorTable編集後に左ペインの参照ヒントを更新する |
| `updateForRowAsync()` | navStack操作を削除し、currentEntries に直接代入する |
| `connectEditorTable()` | navStack初期化を currentEntries 初期化に変更 |
| `disconnectEditorTable()` | 同上 |
| テーブルヘッダー描画 | コンテキスト表示（`fkColumnName=fkValue`）の要素を追加 |
| フォーカスインジケータ | `activateHandler()` で `.relations-table-section--active` クラスを切り替える |

### `WebView/src/editor-table.ts`

| 変更内容 | 詳細 |
|----------|------|
| `autoFillEntries` フィールド | 新規追加。行追加時のFK自動埋め込み情報を保持する |
| `setAutoFillEntries()` | 新規追加。autoFillEntries を設定するメソッド |
| `getAutoFillEntries()` | 新規追加。InsertRowCommand から参照するためのメソッド |
| `createCell()` の mousedown | Ctrl+クリック時の定義ジャンプ分岐を追加 |
| `applyCellChanges()` | isMiniTable の場合は `forceRefreshRelationsPanel()` を呼ばず `notifyMiniTableCellChanged()` を呼ぶ |
| `replayCellChanges()` | 同上 |
| `navigateToDefinition()` | 新規追加。参照列のFK値から参照先テーブルにジャンプする |

### `WebView/src/editor-table-handler.ts`

| 変更内容 | 詳細 |
|----------|------|
| `makeReadOnly()` | 残存させるが、`createMiniEditorTable()` からの呼び出しを削除する |
| `onKeydown()` | F12 キーハンドラを追加（定義へジャンプ） |

### `WebView/src/tab.ts`

| 変更内容 | 詳細 |
|----------|------|
| `navigationHistory` フィールド | 新規追加。タブ遷移履歴を保持する |
| `pushNavigationHistory()` | 新規追加。ジャンプ元情報を履歴に追加する |
| `getNavigationHistory()` | 新規追加。パンくずリスト描画用 |
| `truncateNavigationHistory()` | 新規追加。パンくずクリック時に履歴を切り詰める |
| `createMiniEditorTable()` | `makeReadOnly()` を削除。`setReferenceComponents()` の呼び出しを追加。`editorTableHandler.enable()` を追加。FillController を `activate()` する。DropdownInput を生成する |
| `removeTabButton()` | navigationHistory から該当タブのエントリを除去する |

### `WebView/src/editor-table-context-menu.ts`

| 変更内容 | 詳細 |
|----------|------|
| `createRowHeaderContextMenuHandler()` | 行挿入アクション内で `autoFillEntries` による自動埋め込みを実行する（InsertRowCommand の拡張で対応するため、ここの変更は不要かもしれない） |

### `WebView/src/command.ts`

| 変更内容 | 詳細 |
|----------|------|
| `InsertRowCommand` | `execute()` で行挿入後に `autoFillEntries` を参照してFK値を書き込む処理を追加 |
| `InsertRowsCommand` | 同上 |

### `WebView/src/selection.ts`

| 変更内容 | なし（既存のフォーカス排他制御をそのまま使用） |

### `WebView/src/in-memory-table-store.ts`

| 変更内容 | なし（既存のAPIで十分） |

### `WebView/src/relations-panel.css`

| 変更内容 | 詳細 |
|----------|------|
| `.relations-table-context` | 新規追加。コンテキスト表示（FK列=値）のスタイル |
| `.relations-table-section--active` | 新規追加。フォーカス中テーブルセクションのボーダー強調 |
| `.relations-table-dirty-indicator` | 新規追加。未保存インジケータのスタイル |
| `.relations-panel .editor-table-cell` | 右ペインのセル背景色を `var(--background-sub-color)` に設定 |

---

## 3. 新規追加が必要なもの

### メソッド

| ファイル | メソッド | 責務 |
|----------|---------|------|
| `relations-panel.ts` | `notifyMiniTableCellChanged()` | ミニEditorTable編集後に左ペインの参照ヒントを更新 |
| `editor-table.ts` | `setAutoFillEntries(entries)` | FK自動埋め込み情報を設定 |
| `editor-table.ts` | `getAutoFillEntries()` | FK自動埋め込み情報を取得（Command用） |
| `editor-table.ts` | `navigateToDefinition()` | 参照先テーブルへの定義ジャンプを実行 |
| `tab.ts` | `pushNavigationHistory(tableName, pkValue)` | 遷移履歴にプッシュ |
| `tab.ts` | `getNavigationHistory()` | 遷移履歴を返す |
| `tab.ts` | `truncateNavigationHistory(index)` | 指定インデックスで履歴を切り詰める |

### フィールド

| ファイル | フィールド | 型 | 用途 |
|----------|-----------|-----|------|
| `editor-table.ts` | `autoFillEntries` | `Array<{ columnName: string; value: string }>` | 行追加時のFK自動埋め込み |
| `tab.ts` | `navigationHistory` | `Array<{ tableName: string; pkValue: string }>` | タブ遷移履歴 |
| `relations-panel.ts` | `currentEntries` | `RelationEntry[]` | navStack廃止後の表示エントリ |

### インターフェース変更

| ファイル | インターフェース | 変更 |
|----------|-----------------|------|
| `relations-panel.ts` | `RelationEntry` | `fkColumnName: string`, `fkValue: string`, `hiddenColumns: string[]` を追加 |

### CSSクラス

| クラス名 | 用途 |
|----------|------|
| `.relations-table-context` | コンテキスト表示 |
| `.relations-table-section--active` | フォーカスインジケータ |
| `.relations-table-dirty-indicator` | 未保存ドット |

---

## 4. 削除・廃止するもの

| ファイル | 対象 | 理由 |
|----------|------|------|
| `relations-panel.ts` | `NavFrame` インターフェース | 右ペイン内の階層管理を廃止 |
| `relations-panel.ts` | `navStack: NavFrame[]` フィールド | 同上 |
| `relations-panel.ts` | `drillDownAsync()` メソッド | ドリルダウンは左ペインのタブ遷移に置き換え |
| `relations-panel.ts` | `resolveEntriesForStoreRowAsync()` メソッド | drillDownAsync専用だったため不要 |
| `relations-panel.ts` | `buildBreadcrumb()` メソッド | タブ遷移履歴として再実装 |
| `relations-panel.ts` | `renderAsync()` 内のnavStack参照 | currentEntriesに置き換え |
| `relations-panel.ts` | `renderAsync()` 内のパンくず表示条件 `navStack.length > 1` | タブ遷移履歴の条件に置き換え |
| `tab.ts` の `createMiniEditorTable()` | `editorTable.makeReadOnly()` 呼び出し | 編集可能にするため削除 |

---

## 5. UIの仕様

### パンくずリスト

```
┌──────────────────────────────────────────────────┐
│ イベント › クエスト › エネミー › スキル           │  ← タブ遷移履歴
├──────────────────────────────────────────────────┤
│ RELATIONS                                        │
├──────────────────────────────────────────────────┤
│ drop_item  1:N  enemy_id=3      5 rows           │  ← コンテキスト表示
│ ┌──────────────────────────────────────────────┐ │
│ │ id | name        | rate | ...                │ │  ← enemy_id列は非表示
│ │ 1  | 薬草        | 30   | ...                │ │
│ │ 2  | 鉄の剣      | 10   | ...                │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ skill  N:1                                       │
│ ┌──────────────────────────────────────────────┐ │
│ │ id | name        | power | ...               │ │
│ │ 5  | ファイア     | 120   | ...               │ │
│ └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### コンテキスト表示の詳細
- 1:Nリレーションのみ表示する（N:1では不要。N:1は選択行のFK値から一意に決まるため文脈は明確）。
- 形式: `{FK列名}={FK値}`（例: `enemy_id=3`）
- 複数のFK列がある場合: `enemy_id=3, stage_id=1` のようにカンマ区切り。

### 未保存インジケータ
- テーブル名の右に黄色のドット `●` を表示する。
- 色: `#e5c07b`（VSCodeのwarning色に合わせる）。
- 未保存がない場合は非表示。

### 視覚的区別
- 右ペインのテーブルセル背景: `var(--background-sub-color)` — 左ペインより若干暗い。
- フォーカス中のテーブルセクション: 左端に2pxのアクセントボーダー（`var(--focus-border, #007acc)`）。
- 非フォーカスのテーブルセクション: ボーダーなし。

---

## 6. データフロー

### 右ペインでのセル編集フロー

```
ユーザーがミニEditorTableのセルを編集
    ↓
EditorTableHandler.onKeydown() / dblclick → 編集モード開始
    ↓
EditorTableHandler.submitCellEdit() → セル値確定
    ↓
CellChangeCommand.execute()
    ↓
EditorTable.applyCellChanges(changes)
    ↓
EditorTable.updateCellValueAt(row, col, value)
    ├→ DOM更新: reference.setCellValueAt()
    ├→ ストア更新: store.updateCellValue(tableName, pkValue, columnName, value)
    └→ キャッシュ更新: referenceDataCache.updateFullDataCell()
    ↓
(isMiniTable なので forceRefreshRelationsPanel() は呼ばない)
    ↓
relationsPanel.notifyMiniTableCellChanged()
    ↓
currentEditorTable.updateReferenceHints()
    ↓
左ペインの参照ヒントが最新のストア値で再描画される
```

### 右ペインでの行追加フロー（1:Nテーブル）

```
ユーザーが行ヘッダーを右クリック → コンテキストメニュー「下に行を挿入」
    ↓
EditorTableStructure.insertRow(rowIndex)
    ↓
InsertRowCommand.execute()
    ├→ insertRowInternal(rowIndex): 空行をDOMに挿入
    ├→ store.insertRowAt(tableName, storeRowIndex, emptyRow): ストアに行追加
    └→ autoFillEntries.forEach: FK列のセルに親テーブルのPK値を書き込む
        ├→ DOM更新: updateCellValueAt()
        └→ ストア更新: store.updateCellValue()
    ↓
History に InsertRowCommand が記録される
    ↓
Undo: InsertRowCommand.undo() → 行削除（FK値ごと消える）
```

### 定義へジャンプフロー

```
ユーザーがFK列のセルを Ctrl+クリック or F12
    ↓
navigateToDefinition()
    ├→ 現在のテーブル名とPK値を navigationHistory にプッシュ
    ├→ parseReferenceExpression() で参照先テーブル名を取得
    ├→ セルのFK値を取得
    └→ tab.navigateToTableRow(refTableName, fkValue)
        ↓
    Tab.enableTabButton(refTableName)
        ↓
    activateTabState() → relationsPanel.connectEditorTable(newEditorTable)
        ↓
    右ペインが新しいテーブルのリレーションに自動更新
        ↓
    パンくずリストが navigationHistory から再描画
```

---

## 7. エッジケース

### 7-1. ミニEditorTableの破棄・再構築によるデータ損失

**問題**: 現在、左ペインの行選択が変わるたびに `updateForRowAsync()` → `renderAsync()` → `destroyMiniEditorTables()` が呼ばれ、ミニEditorTableが全て破棄・再構築される。右ペインで編集中の未確定テキスト入力や、まだCtrl+Sされていない変更が失われる。

**対処**: ミニEditorTableをエントリ単位でキャッシュし、行選択変更時に破棄ではなく表示/非表示を切り替える方式に変更する。あるいは、ミニEditorTableのデータはストアに即座に反映されるため、再構築してもストアから最新データを読み込めば編集内容は保持される。

具体的な方針: ミニEditorTableのセル編集はストアに即反映される（`updateCellValueAt()` がストアを更新する）。したがって、ミニEditorTableが再構築されても、ストアから読み込んだデータには編集済みの値が含まれる。ただし、Undo履歴は失われる。

**推奨解決策**: `renderAsync()` での全破棄・再構築を、テーブルキーが変わらない場合はスキップする差分更新方式にする。具体的には:
1. `currentEntries` と新しいエントリを比較する。
2. テーブルキーが同じエントリは既存のミニEditorTableを再利用する（行データのみ更新）。
3. テーブルキーが変わったエントリのみ破棄・再構築する。

ただし、これは大きなリファクタリングになるため、初期実装では「ストアに即反映 + 再構築でストアから読み込み」方式で進め、Undo履歴の損失は許容する。

### 7-2. 右ペインで行削除した場合の参照整合性

**問題**: 右ペインで参照先テーブルの行を削除した場合、左ペインの外部キーが宙に浮く。

**対処**: 設計案に従い、参照先が全て削除された場合はリレーションを切る。具体的には:
- 右ペインの行削除後、`notifyMiniTableCellChanged()` で左ペインの参照ヒントを更新する。
- 参照先が存在しないFK値を持つセルは、参照ヒントが空になる（`(不明)` 等は表示しない）。
- 将来的にバリデーション機能で警告を出すことは可能だが、今回のスコープ外。

### 7-3. ミニEditorTableからのCtrl+S保存

**問題**: ミニEditorTableにフォーカスがある状態でCtrl+Sを押した場合、どのテーブルが保存されるか。

**対処**: Ctrl+Sは左ペインのアクティブタブのCSVを保存する。ミニEditorTableのCtrl+Sは左ペインのタブに転送する。`EditorTableHandler` の Ctrl+S ハンドラで、`isMiniTable` の場合は左ペインの `currentEditorTable` のハンドラに処理を委譲する。

あるいは、Ctrl+S は全ての開いているテーブルのデータを一括保存する方式にする。ストアには既に最新のデータが入っているため、全テーブルのストアデータをCSVに書き出せばよい。

**推奨**: 左ペインのアクティブタブのみ保存する現行動作を維持する。ミニEditorTableの変更はストアには即反映されるが、ファイル保存はアクティブタブでCtrl+Sを押したときのみ行う。ミニEditorTableでCtrl+Sが押された場合は、そのミニEditorTableのtableNameに対応するストアデータを保存する。

### 7-4. 同一テーブルが左ペインと右ペインの両方に表示される場合

**問題**: 左ペインで「エネミーテーブル」を開いており、右ペインにも1:Nとして「エネミーテーブル」の一部行が表示される場合。

**対処**: 両方のEditorTableは同じストア（`InMemoryTableStore`）を参照している。どちらで編集してもストアは同期される。ただし、DOMの同期は自動的には行われない。
- 右ペインで編集 → `notifyMiniTableCellChanged()` → 左ペインの参照ヒントが更新される。
- 左ペインで編集 → `forceRefreshRelationsPanel()` → 右ペインが再描画される。

### 7-5. ミニEditorTableのFillController競合

**問題**: 複数のミニEditorTableが同時に存在する場合、FillControllerのグローバルイベントリスナー（mousemove/mouseup）が競合する可能性。

**対処**: FillController の `activate()` / `deactivate()` を RelationsPanel の `activateHandler()` と連動させる。アクティブなテーブルのFillControllerのみ activate し、他は deactivate する。

### 7-6. DropdownInput の配置

**問題**: ミニEditorTableのDropdownInput（参照列のドロップダウン選択UI）は、スクロールコンテナ内に配置するとクリッピングされる。

**対処**: GridTextField と同様に、`positioningContainer`（`.relations-panel`）に配置する。`createMiniEditorTable()` 内で `editorTableHandler.createDropdownInput(positioningContainer)` を呼ぶ。

### 7-7. ミニEditorTableのemptyRowCount

**問題**: 現在ミニEditorTableは `emptyRowCount=0` で生成されており、データ行数ぴったりの行しか表示されない。行追加するにはコンテキストメニューを使う必要がある。

**対処**: `emptyRowCount=0` を維持する。行追加はコンテキストメニューの「下に行を挿入」で行う。空行への直接入力による行追加は、ミニEditorTableでは行わない（空行があると、どこまでがデータでどこからが空行かの区別がつきにくい）。

### 7-8. パンくずリストの履歴とタブの独立性

**問題**: パンくずリストのクリックでタブが切り替わるが、手動でタブを切り替えた場合は履歴に反映されない。これにより、パンくずの履歴と実際のタブ遷移の間に不整合が生じうる。

**対処**: パンくずリストはあくまで「定義へジャンプ」の履歴であり、タブ遷移の完全な記録ではない。手動でのタブ切り替えは履歴に含まれないが、パンくずの各エントリは常に有効（クリックでそのタブと行にジャンプできる）。タブが閉じられた場合のみ、該当エントリを履歴から除去する。
