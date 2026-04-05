# TypeScript TDD Developer Memory

## Feedback
- [テストデータの表示列命名規約](feedback_display_column_naming.md) — FK参照テストデータの表示列は ja/comment にする

## Project Architecture
- Frontend: Vanilla TypeScript (no framework), DOM is SSOT
- Backend: C# (WinForms + WebView2)
- Design: Intentionally tightly coupled, Command pattern for Undo/Redo
- Build: Vite (`WebView/` directory)

## Virtual Scroll
- [VirtualScrollControllerパターン](virtual-scroll-patterns.md) — 方式B（テーブル外スペーサー）: DOM構造不変、connectRenderRow、Object.Assign注意点

## Key Files
- `/WebView/src/editor-table.ts` - Core table facade
- `/WebView/src/editor-table-handler.ts` - High-level edit handler
- `/WebView/src/editor-table-reference.ts` - Reverse reference hints
- `/WebView/src/editor-table-context-menu.ts` - Context menu handlers
- `/WebView/src/editor-table-structure.ts` - Row/column insert/delete
- `/WebView/src/history.ts` - Undo/Redo history management
- `/WebView/src/command.ts` - Command pattern implementations
- `/WebView/src/relations-panel.ts` - Relations panel (right pane)
- `/WebView/src/selection.ts` - Selection and focus management
- `/WebView/src/reference-expression.ts` - 参照式パース（SimpleReference/DynamicReference）
- `/WebView/src/notification.ts` - NotificationToast（エラー通知トースト）
- `/WebView/e2e/fixtures/test-utils.ts` - Shared test utilities

## Implementation Patterns

### 相互参照クラスの構築
セッターを使わず `connectXxx()` メソッドで相互参照を後から注入する。
```typescript
class A {
  private b!: B;
  connectB(b: B) { this.b = b; }
}
class B {
  private a!: A;
  connectA(a: A) { this.a = a; }
}
// main.ts で
const a = new A(); const b = new B();
a.connectB(b); b.connectA(a);
```

### センチネル値
null/undefined 禁止 → boolean `false` や空文字 `""` をセンチネルとして使う。

### ループ後の副作用
ループ内に副作用を置かない。バッチ処理完了後に1回だけ副作用メソッドを呼ぶ。

### 非同期競合防止
`currentRequestId` パターン: 呼び出し元でインクリメント、`renderAsync` 自身はインクリメントしない。

### 動的参照（DynamicReference）のスキーマ形式と解決パターン
スキーマJSON上の動的参照は `DynamicReferenceSchema` オブジェクト形式で記述する（旧文字列形式は廃止）:
```json
"reference": {
    "sourceTable": "table",
    "sourceMatchColumn": "id",
    "sourceMatchValue": "reward_table_id",
    "destTable": "master",
    "destColumn": "id"
}
```
`parseReferenceExpression(string | DynamicReferenceSchema)` がオブジェクトを受け取ると `DynamicReference` に変換する。
`EditorTableDataColumn.reference` の型は `string | DynamicReferenceSchema | null`。

解決手順:
1. 同一行から `expr.filter.valueColumn` の値を取得
2. フィルタテーブルを取得し、`expr.filter.filterColumn` で線形検索
3. その行の `expr.lookupColumn` 値 = 最終テーブル名を取得
4. 最終テーブルを取得し `expr.targetColumn == fkValue` でフィルタ

## Recurring Implementation Mistakes

### ミニテーブルとメインテーブルのstoreRowIndices陳腐化バグ
ミニテーブルとメインテーブルは同一ストアを共有する。ミニテーブルで行追加・削除するとストア行数が変わるが、
左ペインのEditorTableの `storeRowIndices` は更新されないため、`reloadCellsFromStore()` で範囲外インデックスが発生する。

**修正方法**: `reloadCellsFromStore()` の先頭で、通常テーブル（`!isMiniTable`）の場合のみ DOM 行数とストア行数を同期する。
- ストアが多い → バッファ空行を昇格（`editor-table-empty-row` 除去）、足りなければ新規行を DOM 挿入
- ストアが少ない → 末尾のデータ行を DOM から除去（バッファ空行は維持）
- `storeRowIndices` を `push/splice` で同期

ミニテーブルは `destroyMiniEditorTables()/buildMiniEditorTableAsync()` で都度再構築されるため対象外。

### ミニテーブルのストア行インデックス計算ミス（修正済）
`insertRowInternal` でストアインデックスを計算する際は `storeRowIndices` から引く必要がある。
- 上に挿入（domDataRowIndex < indices.length）: `storeRowIndex = indices[domDataRowIndex]`
- 下に挿入（末尾の外）: `storeRowIndex = indices[domDataRowIndex - 1] + 1`
- `splice` は DOM 位置 `domDataRowIndex` で行い、値は計算した `storeRowIndex` を使う
- 後続エントリの+1は `indices[i] >= storeRowIndex` の条件でフィルタする（すでに正しい値のものを二重更新しない）
通常テーブルでは `storeRowIndices[i] = i` なので同じロジックで正しく動作する。

### Command の Do/Undo の非対称実装
`insertRowInternal` がストアに `insertRowAt` するのに、対応する `deleteRowInternal`（Undo時）が
`store.removeRow` を呼ばない非対称実装は危険。追加・削除 Command は必ずストアの対応メソッドを
両方呼ぶこと。

### expectCsvAsync でFK自動入力行を検証する書き方
ミニテーブルで行追加すると `autoFillEntries` によりFK列に親IDが自動設定される。
1:Nミニテーブルで行を挿入すると `applyAutoFillToRow()` が呼ばれ、FK列に親行のID値が入る。
そのため挿入行は「全列空 `,,`」ではなく「FK列だけ埋まった `,2,`」になる。
テストの期待値は `autoFillEntries` の動作を考慮して書くこと。

例: enemy_id=2 を持つ親行の1:N子テーブル(skill)に行挿入した場合:
```typescript
await expectCsvAsync(page, 'data/skill.csv', `
    id, enemy_id, name
    1,  1,        slash
    ,   2,          // ← enemy_id=2 が自動入力される（「,  ,」ではない）
    2,  2,        thunder
`);
```

### ミニテーブルの Ctrl+S 保存の設計（現在の正しい実装）
ミニテーブルの Ctrl+S は `isMiniTableInstance()` で**ストア経由の保存を行う**（拒否ではない）。
- `saveTableDataFromStoreAsync(tableName, store)` でストアの全列全行を保存（CSV破壊を防ぐ）
- 保存後に `store.markAllSaved()` + `relationsPanel.updateDirtyMark(name, false)` でDirty解除
- ミニテーブルはDOM上にフィルタ済みデータしか持たないがストアは全データを持つため安全

通常テーブルの Ctrl+S も同様に `saveTableDataFromStoreAsync` を使う。
保存フロー変更時は必ず Dirty マーク解除も合わせて実装すること（`relations-panel-dirty.spec.ts`）。

## e2e テストパターン

### ミニテーブルのコンテキストメニューで行操作
```typescript
// ミニテーブルの行ヘッダーを右クリック（rowIndex: 0始まり、データ行）
const header = miniTable.locator('.editor-table-row-header').nth(rowIndex);
await header.click({ button: 'right' });
// コンテキストメニュー項目をクリック
await page.locator('.context-menu.visible').locator('.context-menu-item', { hasText: '下に行を挿入' }).click();
```

### タブ名で絞り込んだテーブル取得（strict mode violation 防止）
```typescript
const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
```

### 非アクティブなタブのDOM要素は visible ではない
非アクティブなタブは `deactivateTabState()` で `wrapperElement.style.display = 'none'` が設定される。
そのため非アクティブタブ内の `.editor-table-row-header` は Playwright で `not visible` になりタイムアウトする。
タブを切り替えてから行を操作するには必ず `openTableAsync`（エクスプローラークリック）を呼ぶこと。

```typescript
// NG: skill タブがアクティブなまま enemy テーブルの行をクリックしようとする（タイムアウト）
const enemyTable = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="enemy"] .editor-table`);
await selectRowAsync(enemyTable, 0); // enemy タブが非アクティブなら not visible でタイムアウト

// OK: エクスプローラーをクリックしてタブを切り替えてから行を選択する
const enemyTable = await openTableAsync(page, 'enemy');
await selectRowAsync(enemyTable, 0);
```

### expectCsvAsync で空行（挿入した行）を検証する書き方
通常テーブルへの行挿入では autoFill がないため `insertRowAt(tableName, idx, Array(columnCount).fill(''))` で全列空になる。
3列テーブル（id,name,value）なら挿入行は `,,` として保存される。
```typescript
await expectCsvAsync(page, 'data/item.csv', `
    id, name,  value
    1,  sword, 100
    ,,                // ← 挿入した空行（3列なので ,, = ['','','']）
    2,  shield, 200
`);
```

### セル編集 UI の取得方法
左ペインのテキストフィールドは `.grid-textfield-active` セレクタで取得する。
`.editor-left-pane input` はフォールバックとして使えるが、より正確には `.grid-textfield-active`。
```typescript
const editField = page.locator('.grid-textfield-active').first();
await expect(editField).toBeVisible();
await editField.selectText();
await editField.type('new value');
await page.keyboard.press('Enter');
```

### 通常テーブルの行数カウント（バッファ空行除外）
通常テーブルには `emptyRowCount=100` のバッファ空行がDOMに存在する（`editor-table-empty-row` クラス付き）。
`.editor-table-row` を `toHaveCount` で数えるとバッファ行も含まれるため、データ行のみカウントする場合は
`:not(.editor-table-empty-row)` で除外する。
```typescript
// NG: バッファ行97行も含まれて期待値とズレる
const allRows = itemTable.locator('.editor-table-row');

// OK: バッファ空行（editor-table-empty-row）を除外して実データ行のみカウント
const allRows = itemTable.locator('.editor-table-row:not(.editor-table-empty-row)');
await expect(allRows).toHaveCount(5); // ヘッダー(1) + データ(4) = 5
```
ミニテーブルも `emptyRowCount = entry.rows.length + 1` のためバッファ空行が1行存在する。
`.editor-table-row:not(.editor-table-empty-row)` でバッファ除外すること（N:1・1:N どちらも同様）。

## テスト実行環境の知見

### production ビルドの更新方法（重要）
playwright テストは `http://localhost:4173` で動作する production ビルドを使う（`vite build && vite preview`）。
`reuseExistingServer: !process.env.CI` なので、**最初のテスト実行後はサーバーが起動済みのため再ビルドされない**。

ソースコード変更をテストに反映させるには、**別のポートを使う**ことで新しいビルドを強制起動できる：
```typescript
// playwright.config.ts
webServer: {
    command: 'npx vite build && npx vite preview --host --port 4174',
    url: 'http://localhost:4174',
    reuseExistingServer: !process.env.CI,
},
use: { baseURL: 'http://localhost:4174' },
```
- コンテナ再起動・ビルドコマンド直接実行は不可（`npx playwright` のみ許可）
- ポートを変えることで既存サーバーと競合せず新規ビルドが走る

### ブラウザコンソールのデバッグ方法
production ビルドの console.log はテスト出力に出ない。`page.on('console', ...)` でキャプチャする：
```typescript
page.on('console', msg => { ... });
```

### Object.assign パターンと initializeModules() の注意点
詳細は `patterns.md` 参照。新しく `new Xxx(this, ...)` を追加したら `initializeModules()` に再作成コードを追加すること。

### Ctrl+Shift+Z の Redo キーハンドリング
`editor-table-handler.ts` の Redo は `Ctrl+Y` と `Ctrl+Shift+Z` の両方に対応する。
`Shift+Z` を押すと `keyboardEvent.key === 'Z'`（大文字）になるため Ctrl+Z (Undo) と区別される。
```typescript
if (keyboardEvent.ctrlKey && (keyboardEvent.key === 'y' || keyboardEvent.key === 'Z')) {
    // Redo処理
}
```

### style.top 変更後のスクロール位置読み取りバグ
`focusWithoutScrolling()` のようにスクロール位置を保護するメソッドは、DOM スタイル変更「前」に
スクロール位置を取得して渡す必要がある。`style.top = '-99999px'` のような変更でブラウザが
同期的にスクロールをリセットした後に `getScrollTop()` を呼ぶと 0 を読んでしまい「0 で保護」する。
`editor-table-handler.ts` の `hide()` で実例を参照。

### 列リサイズ（D&D・dblclick）実装パターン
詳細は `column-resize-patterns.md` 参照。D&D/dblclick排他は `columnDragConfirmed` フラグ、
複数列一括はCompositeCommand、自動幅はEditorTable.calculateAutoColumnWidth()。

### DiffTabのパディング行同期パターン（FEAT_0018）
EditorTableStructure の行挿入・削除が diffTab 接続時に左ペインのパディング行を同期する。
- `insertRowInternal` 末尾: `diffTab.notifyRightPaneRowInserted(rowIndex)` で左ペインにパディング行挿入
- `deleteRow` DOM削除: `diffTab.notifyRightPaneRowDeleted(rowIndex, rowElement)` に委譲
  - `diff-row-padding-inserted` クラス付き → 行挿入のUndo → 左右DOM行を削除
  - それ以外（通常削除）→ 右ペインをパディング行変換 + 左ペインに `diff-row-deleted` 付与
Undo/Redo の対称性はDOMのクラス状態（`diff-row-padding-inserted`）で判断する。

### 差分タブ保存の3つの落とし穴（BUG_0023）
詳細は `diff-tab-save-patterns.md` を参照。
- 問題1: パディング行が CSV に混入 → DOM の `.diff-row-empty` から動的にストア行インデックスを取得して除外
- 問題2: `markAllSaved` のキー不一致 → `this.table.tableName`（ストアキー）で呼ぶ
- 問題3: 通常タブのストア未更新 → 保存後に `store.reloadTableDataAsync(saveTargetTableName)` を呼ぶ

### バリデーションパネル実装パターン
詳細は `validation-panel-patterns.md` 参照。
- `rgba(...)` は `/rgb\(25[0-5]/` にマッチしない → `rgb(255, 60, 60)` を使う
- `editor-table-cell-focused` は `Selection.updateRenderer()` で付与・除去する
- `ValidationPanel → Tab → EditorTable` の1段経由で循環参照を回避する

### fire-and-forget 非同期保存テストの待機パターン
Ctrl+S の保存処理（`saveDiffTableDataFromStoreAsync` 等）は fire-and-forget（`.then()` で await なし）。
mock API の `postMessage` は `setTimeout(0)` で応答するため、`page.keyboard.press('Control+s')` 後に
即座に `expectCsvAsync` を呼ぶと書き込み未完了になる。`waitForTimeout` ではなく
**Dirty マーク消去を保存完了シグナルとして `expect(dirtyIndicator).not.toHaveClass(...)` で待機する**。
