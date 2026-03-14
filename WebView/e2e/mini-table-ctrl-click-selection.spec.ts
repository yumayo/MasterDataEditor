import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// ミニテーブルのCtrl+クリック後に選択ボーダーが表示されることを検証するテスト
//
// 修正済み（editor-table.ts mousedownハンドラ）:
//   Ctrl+クリック時に navigateToDefinition() を先に呼んでペインスタックを追加してから
//   selection.start() を呼ぶ。これにより正しいRPに対して選択状態が設定される。
//
//   ```typescript
//   if ((e.ctrlKey || e.metaKey) && table.isMiniTableInstance()) {
//       table.navigateToDefinition(position.row);  // ← ペインスタック追加を先に行う
//       table.selection.start(position.row, position.column);
//       e.preventDefault();
//       return;
//   }
//   ```
//
// 期待動作:
//   ミニテーブルのセルをCtrl+クリックしてペインスタックが追加された後、
//   左スロットに移動したRelationsPanelのミニテーブルで Ctrl+クリックしたセルに
//   選択ボーダー（.selection 要素が visible かつ border-color が青色）が表示されること。
//
// テーブル構成:
//   enemy: id, ja（敵名テーブル。参照なし）
//   quest: id, name, enemy_id（クエスト。enemy.id をFKとして参照）
//
//   quest を開いて row0 を選択 → RelationsPanelに enemy の N:1 ミニテーブルが表示される。
//   enemy ミニテーブルのセルをCtrl+クリック → ペインスタックが追加され、
//   左スロットに enemy ミニテーブルが残る。クリックしたセルに選択ボーダーが表示されること。
// =============================================================================

/**
 * テスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   enemy: id, ja（敵テーブル。どの列も外部参照なし）
 *   quest: id, name, enemy_id（クエスト。enemy.id をFKとして参照）
 *
 * quest の row0（first_quest, enemy_id=1）を選択すると
 * RelationsPanelに N:1 として enemy のミニEditorTable が表示される。
 */
function createCtrlClickSelectionTestFileSystem(): MockFileSystem {
	return {
		"schema/enemy.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "ja", type: "string" },
			],
			primary_key: "id",
		}),
		"data/enemy.csv": [
			"id,ja",
			"1,スライム",
			"2,ドラゴン",
		].join("\n"),
		"schema/quest.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
				{ key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
			],
			primary_key: "id",
		}),
		"data/quest.csv": [
			"id,name,enemy_id",
			"1,first_quest,1",
			"2,second_quest,2",
		].join("\n"),
	};
}

/**
 * エクスプローラーからテーブルを開き、左スロットのEditorTable Locatorを返す
 * .editor-left-slot を使う理由: Ctrl+クリック後にペインスタックが追加されると
 * .editor-left-slot 内に RelationsPanel（とその中の .editor-table）が現れるが、
 * メインテーブルは .editor-left-pane 内に留まる。
 * ペインスタック後に strict mode violation を避けるため .editor-left-pane で限定する。
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
	const explorer = page.locator('#explorer');
	await explorer.getByText(tableName, { exact: true }).click();
	const table = page.locator('.editor-left-pane .editor-table');
	await expect(table).toBeVisible();
	return table;
}

/**
 * 指定した行ヘッダーをクリックして行を選択する
 * rowIndex: 0始まり（ヘッダー行を除く）
 */
async function selectRowAsync(table: Locator, rowIndex: number): Promise<void> {
	const header = table.locator('.editor-table-row-header').nth(rowIndex);
	await header.click();
}

/**
 * RelationsPanelのコンテンツが表示されるまで待機する
 */
async function waitForRelationsPanelContentAsync(page: Page): Promise<void> {
	await expect(page.locator('.relations-panel-content')).toBeVisible();
}

/**
 * 指定した要素の computed border-color が「青色系」かどうかを返す。
 * .selection 要素のアクティブ時の border-color は rgba(0, 120, 215, 0.5)。
 * computed style は "rgba(R, G, B, A)" 形式で返るため、スペースありなしの両方を許容する。
 */
async function isBlueBorderAsync(el: Locator): Promise<boolean> {
	const color = await el.evaluate((e: Element) => window.getComputedStyle(e).borderTopColor);
	const fragment = '0, 120, 215';
	return color.includes(fragment) || color.includes(fragment.replace(/, /g, ','));
}

/**
 * .selection 要素の top スタイルを数値で返す。
 *
 * selection.ts の実装:
 *   - selection.start() が呼ばれた場合: top は対象セルの位置（ヘッダー行分 > 0px）
 *   - selection.start() が呼ばれていない場合（バグ時）: top は '-99999px'（画面外）
 *
 * 選択が有効になっているかどうかの判定に使用する。
 */
async function getSelectionTopAsync(el: Locator): Promise<number> {
	return el.evaluate((e: Element) => parseFloat(window.getComputedStyle(e).top));
}

/**
 * 右スロットのRelationsPanel内ミニテーブルの
 * visibleなデータセル（行ヘッダー・列ヘッダー・コーナーセル・非表示列を除く）のCSSセレクタ。
 * page.locator() から使用するため、.editor-right-slot .relations-panel .editor-table プレフィックスで
 * 右スロットに限定する（左ペインの通常テーブルセルと混同しない）。
 */
const RIGHT_SLOT_MINI_TABLE_VISIBLE_CELL_SELECTOR = [
	'.editor-right-slot .relations-panel .editor-table',
	' .editor-table-cell:not(.editor-table-row-header)',
	':not(.editor-table-column-header)',
	':not(.editor-table-corner-cell)',
	':not([style*="display: none"])',
].join('');

// =============================================================================
// テストスイート: ミニテーブルのCtrl+クリック後のセル選択状態
// =============================================================================

test.describe('ミニテーブルのCtrl+クリック後にクリックしたセルの選択ボーダーが表示されること', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createCtrlClickSelectionTestFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
	});

	// ---------------------------------------------------------------------------
	// テスト1: ミニテーブルのCtrl+クリック後、左スロットのミニテーブルに選択ボーダーが表示されること
	//
	// 再現手順:
	//   1. quest テーブルを開いて row0 を行選択する
	//   2. RelationsPanelに enemy の N:1 ミニテーブルが表示されるのを待つ
	//   3. enemy ミニテーブルの ja 列のセル（row0）をCtrl+クリックする
	//      → navigateToDefinition() が呼ばれてペインスタックが追加される
	//      → RP が左スロットに移動し、enemy ミニテーブルが左スロットに残る
	//   4. 左スロットの enemy ミニテーブルに .selection 要素が表示されること
	//      （バグ時: selection.start() が呼ばれないため .selection が非表示のまま）
	// ---------------------------------------------------------------------------
	test(
		'enemyミニテーブルのセルをCtrl+クリックした後、左スロットに移動したミニテーブルで選択ボーダーが表示されること',
		async ({ page }) => {
			// quest テーブルを開いて1行目を選択する
			const mainTable = await openTableAsync(page, 'quest');
			await selectRowAsync(mainTable, 0);

			// RelationsPanelに enemy のミニテーブルが表示されるまで待機する
			await waitForRelationsPanelContentAsync(page);

			// 右スロットに表示された enemy ミニテーブルが visible になるまで待機する
			const rightSlotMiniTable = page.locator('.editor-right-slot .relations-panel .editor-table').first();
			await expect(rightSlotMiniTable).toBeVisible();

			// 右スロットの enemy ミニテーブルの visibleなデータセルを page.locator で取得する
			// （右スロット限定セレクタで左ペインの通常テーブルセルを除外する）
			const targetCell = page.locator(RIGHT_SLOT_MINI_TABLE_VISIBLE_CELL_SELECTOR).first();
			await expect(targetCell).toBeVisible();

			// Ctrl+クリック前はナビゲーションバーが非表示であること（前提確認）
			await expect(page.locator('.editor-navigation-bar')).toBeHidden();

			// enemy ミニテーブルのセルをCtrl+クリックしてペインスタックを追加する
			await targetCell.click({ modifiers: ['Control'] });

			// ペインスタックが追加されてナビゲーションバーが表示されること（前提確認）
			await expect(page.locator('.editor-navigation-bar')).toBeVisible();

			// 左スロットに RelationsPanel が移動していること（ペインスタック後の配置確認）
			const leftSlotRelationsPanel = page.locator('.editor-left-slot .relations-panel');
			await expect(leftSlotRelationsPanel).toBeVisible();

			// 左スロットの RelationsPanel 内の .selection 要素の top が 0 より大きいこと。
			// selection.start() が呼ばれた場合: top はヘッダー行の高さ以上（> 0）
			// selection.start() が呼ばれていない場合（バグ時）: top は -99999px（画面外） → テスト失敗（RED）
			// 修正後: selection.start() が呼ばれて top > 0 になる → テスト成功（GREEN）
			const leftSlotSelection = page.locator('.editor-left-slot .relations-panel .selection').first();
			await expect.poll(() => getSelectionTopAsync(leftSlotSelection)).toBeGreaterThan(0);
		},
	);

	// ---------------------------------------------------------------------------
	// テスト2: Ctrl+クリックしたセルの選択ボーダーが青色（アクティブ色）であること
	//
	// 選択ボーダーの色仕様:
	//   アクティブ時: rgba(0, 120, 215, 0.5)（青色）
	//   非アクティブ時: rgba(128, 128, 128, 0.5)（灰色）
	//
	// Ctrl+クリックしたセルがアクティブな選択として扱われるべきであるため、
	// 選択ボーダーは青色であること。
	// ---------------------------------------------------------------------------
	test(
		'enemyミニテーブルのセルをCtrl+クリックした後、左スロットの選択ボーダーが青色（アクティブ色）であること',
		async ({ page }) => {
			// quest テーブルを開いて1行目を選択する
			const mainTable = await openTableAsync(page, 'quest');
			await selectRowAsync(mainTable, 0);

			// RelationsPanelに enemy のミニテーブルが表示されるまで待機する
			await waitForRelationsPanelContentAsync(page);

			// 右スロットに表示された enemy ミニテーブルが visible になるまで待機する
			const rightSlotMiniTable = page.locator('.editor-right-slot .relations-panel .editor-table').first();
			await expect(rightSlotMiniTable).toBeVisible();

			// 右スロットの enemy ミニテーブルの visibleなデータセルを page.locator で取得する
			const targetCell = page.locator(RIGHT_SLOT_MINI_TABLE_VISIBLE_CELL_SELECTOR).first();
			await expect(targetCell).toBeVisible();

			// enemy ミニテーブルのセルをCtrl+クリックしてペインスタックを追加する
			await targetCell.click({ modifiers: ['Control'] });

			// ペインスタックが追加されてナビゲーションバーが表示されること（前提確認）
			await expect(page.locator('.editor-navigation-bar')).toBeVisible();

			// 左スロットの RelationsPanel 内の .selection 要素の top が 0 より大きいこと（選択が有効なこと）
			const leftSlotSelection = page.locator('.editor-left-slot .relations-panel .selection').first();
			await expect.poll(() => getSelectionTopAsync(leftSlotSelection)).toBeGreaterThan(0);

			// 選択ボーダーが青色（アクティブ色）であること
			// .selection の border-color がアクティブ色 rgba(0, 120, 215, 0.5) であることを確認する
			// 修正前: selection.start() が呼ばれないため border-color がアクティブ色にならない → テスト失敗（RED）
			// 修正後: selection.start() が呼ばれ blue border が設定される → テスト成功（GREEN）
			await expect.poll(() => isBlueBorderAsync(leftSlotSelection)).toBe(true);
		},
	);

});
