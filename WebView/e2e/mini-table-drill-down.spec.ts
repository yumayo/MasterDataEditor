import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// ミニテーブルのドリルダウン動作テスト
//
// 背景:
//   EditorTable.navigateToDefinition() はミニテーブル（RelationsPanel内）で
//   Ctrl+クリック/F12した場合、ペインスタックに新しい RelationsPanel を追加する。
//
// 期待動作:
//   - ミニテーブルのどのセルでCtrl+クリック/F12しても: ペインスタックに新しい RP が追加される
//     （Tab.pushRelationsPanel が呼ばれ、右スロットに新しい RP が表示される）
//   - 通常テーブル（左ペイン）でのCtrl+クリック/F12: FK参照先テーブルへジャンプ（既存動作を維持）
//
// テーブル構成（N:1参照ミニテーブルのシナリオ）:
//   enemy: id, ja（enemyテーブル、参照なし列のみ）
//   quest: id, name, enemy_id（questテーブル。enemy.id をFKとして参照）
//
//   questを開いてrow0選択 → RelationsPanelにenemyのN:1ミニテーブルが表示される。
//   enemyミニテーブルの ja 列（参照なし）をCtrl+クリック → ペインスタックに RP が追加される。
// =============================================================================

/**
 * ドリルダウンテスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   enemy: id, ja（enemyテーブル。どの列も外部参照なし）
 *   quest: id, name, enemy_id（クエスト。enemy.id をFKとして参照）
 *
 * questのrow0（first_quest, enemy_id=1）を選択すると
 * RelationsPanelに N:1 として enemy のミニEditorTable が表示される。
 */
function createDrillDownTestFileSystem(): MockFileSystem {
	return {
		"schema/enemy.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "ja", type: "string" },
			],
			primary_key: ["id"],
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
				// enemy.id を FK として参照する（RelationsPanel は columnName="id" で PKルックアップ）
				{ key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
			],
			primary_key: ["id"],
		}),
		"data/quest.csv": [
			"id,name,enemy_id",
			"1,first_quest,1",
			"2,second_quest,2",
		].join("\n"),
	};
}

/**
 * エクスプローラーからテーブルを開き、左ペインのEditorTable Locatorを返す
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
 * ミニテーブルのvisibleなデータセル（非参照列を含む）を取得するセレクタ
 * N:1ミニテーブルではhideColumnsByName()でid列（col=0）がdisplay:noneになるため除外する
 */
const MINI_TABLE_VISIBLE_DATA_CELL_SELECTOR = [
	'.relations-panel .editor-table',
	' .editor-table-cell:not(.editor-table-row-header)',
	':not(.editor-table-column-header)',
	':not(.editor-table-corner-cell)',
	':not([style*="display: none"])',
].join('');

// =============================================================================
// テストスイート1: ミニテーブルのCtrl+クリック/F12でペインスタックが追加されること
// =============================================================================

test.describe('ミニテーブルのCtrl+クリックでペインスタックが追加されること', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createDrillDownTestFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
		await enableRelationsPanelAsync(page);
	});

	test(
		'enemyミニテーブルの非参照列（ja列）をCtrl+クリックするとペインスタックに RP が追加されること',
		async ({ page }) => {
			// quest テーブルを開いて1行目を選択する
			const mainTable = await openTableAsync(page, 'quest');
			await selectRowAsync(mainTable, 0);

			// RelationsPanelに enemy のミニテーブルが表示されるまで待機する
			await waitForRelationsPanelContentAsync(page);

			// ミニテーブルが表示されるまで待機する
			const miniTable = page.locator('.relations-panel .editor-table').first();
			await expect(miniTable).toBeVisible();

			// visibleなデータセル（ja列。id列はhideColumnsByName()でdisplay:none）を取得する
			const visibleCell = page.locator(MINI_TABLE_VISIBLE_DATA_CELL_SELECTOR).first();
			await expect(visibleCell).toBeVisible();

			// Ctrl+クリックでペインスタックへの追加を実行する
			await visibleCell.click({ modifiers: ['Control'] });

			// ナビゲーションバーが表示されること（ペインが3つになった）
			await expect(page.locator('.editor-navigation-bar')).toBeVisible();

			// 右スロットに新しい RelationsPanel が表示されること
			await expect(page.locator('.editor-right-slot .relations-panel')).toBeVisible();
		},
	);

	test(
		'enemyミニテーブルのセルにフォーカスしてF12を押すとペインスタックに RP が追加されること',
		async ({ page }) => {
			const mainTable = await openTableAsync(page, 'quest');
			await selectRowAsync(mainTable, 0);
			await waitForRelationsPanelContentAsync(page);

			const visibleCell = page.locator(MINI_TABLE_VISIBLE_DATA_CELL_SELECTOR).first();
			await expect(visibleCell).toBeVisible();
			// セルをクリックしてミニテーブルにフォーカスを移す（Ctrlなし）
			await visibleCell.click();
			// F12でペインスタックへの追加を実行する
			await page.keyboard.press('F12');

			// ナビゲーションバーが表示されること（ペインが3つになった）
			await expect(page.locator('.editor-navigation-bar')).toBeVisible();

			// 右スロットに新しい RelationsPanel が表示されること
			await expect(page.locator('.editor-right-slot .relations-panel')).toBeVisible();
		},
	);

	test(
		'enemyミニテーブルのセルをCtrl+クリックすると右スロットに新しい RP が表示されること',
		async ({ page }) => {
			const mainTable = await openTableAsync(page, 'quest');
			await selectRowAsync(mainTable, 0);
			await waitForRelationsPanelContentAsync(page);

			const miniTable = page.locator('.relations-panel .editor-table').first();
			await expect(miniTable).toBeVisible();

			const visibleCell = page.locator(MINI_TABLE_VISIBLE_DATA_CELL_SELECTOR).first();
			await expect(visibleCell).toBeVisible();

			await visibleCell.click({ modifiers: ['Control'] });

			// ナビゲーションバーが表示されること（ペインが3つになった）
			await expect(page.locator('.editor-navigation-bar')).toBeVisible();

			// 左スロットに quest テーブル（アクティブタブは quest のまま）が表示されること
			const activeTab = page.locator('.tab-button-active');
			await expect(activeTab).toHaveText('quest');
		},
	);
});

// =============================================================================
// テストスイート2: ミニテーブルの参照列でないセルでもCtrl+クリックでペインスタックが追加されること
// =============================================================================

test.describe('ミニテーブルは参照列の有無に関わらずCtrl+クリックでペインスタックが追加されること', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createDrillDownTestFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
		await enableRelationsPanelAsync(page);
	});

	test(
		'参照列がひとつもないenemyミニテーブルの任意のセルでCtrl+クリックするとペインスタックが追加されること',
		async ({ page }) => {
			// quest を開いて row0 を選択することで enemy ミニテーブルを表示させる
			const mainTable = await openTableAsync(page, 'quest');
			await selectRowAsync(mainTable, 0);
			await waitForRelationsPanelContentAsync(page);

			const visibleCell = page.locator(MINI_TABLE_VISIBLE_DATA_CELL_SELECTOR).first();
			await expect(visibleCell).toBeVisible();

			// Ctrl+クリック前はナビゲーションバーが非表示であること
			await expect(page.locator('.editor-navigation-bar')).toBeHidden();

			// 参照なし列でCtrl+クリック
			await visibleCell.click({ modifiers: ['Control'] });

			// ナビゲーションバーが表示されること（ペインスタックが追加された）
			await expect(page.locator('.editor-navigation-bar')).toBeVisible();
		},
	);
});
