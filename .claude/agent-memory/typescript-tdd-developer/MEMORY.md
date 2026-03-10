# TypeScript TDD Developer Memory

## Project Architecture
- Frontend: Vanilla TypeScript (no framework), DOM is SSOT
- Backend: C# (WinForms + WebView2)
- Design: Intentionally tightly coupled, Command pattern for Undo/Redo
- Build: Vite (`WebView/` directory)

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

## Recurring Implementation Mistakes

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
ミニテーブルは `emptyRowCount=0` なので `.editor-table-row` で全行カウントしても問題なし。
