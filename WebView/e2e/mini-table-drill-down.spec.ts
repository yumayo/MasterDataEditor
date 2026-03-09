import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// ミニテーブルのドリルダウン動作テスト
//
// 背景:
//   EditorTable.navigateToDefinition() はミニテーブル（RelationsPanel内）で
//   Ctrl+クリック/F12した場合、ミニテーブル自身の tableName を左ペインのタブとして開く。
//
// 期待動作:
//   - ミニテーブルのどのセルでCtrl+クリック/F12しても: ミニテーブルの tableName で
//     左ペインのタブを開く（Tab.navigateToTableRow(miniTable.tableName, pkValue) が呼ばれる）
//   - 通常テーブル（左ペイン）でのCtrl+クリック/F12: FK参照先テーブルへジャンプ（既存動作を維持）
//
// テーブル構成（N:1参照ミニテーブルのシナリオ）:
//   enemy: id, ja（enemyテーブル、参照なし列のみ）
//   quest: id, name, enemy_id（questテーブル。enemy.id をFKとして参照）
//
//   questを開いてrow0選択 → RelationsPanelにenemyのN:1ミニテーブルが表示される。
//   enemyミニテーブルの ja 列（参照なし）をCtrl+クリック → enemyタブが左ペインで開かれる。
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
				// enemy.id を FK として参照する（RelationsPanel は columnName="id" で PKルックアップ）
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
// テストスイート1: ミニテーブルのCtrl+クリック/F12でミニテーブル自身のテーブルが開かれること
// =============================================================================

test.describe('ミニテーブルのCtrl+クリックでミニテーブル自身のテーブルが開かれること', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createDrillDownTestFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
	});

	test(
		'enemyミニテーブルの非参照列（ja列）をCtrl+クリックするとenemyタブが左ペインで開かれること',
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

			// Ctrl+クリックで定義ジャンプを実行する
			await visibleCell.click({ modifiers: ['Control'] });

			// enemy タブが左ペインのアクティブタブになること
			const activeTab = page.locator('.tab-button-active');
			await expect(activeTab).toHaveText('enemy');
		},
	);

	test(
		'enemyミニテーブルのセルにフォーカスしてF12を押すとenemyタブが左ペインで開かれること',
		async ({ page }) => {
			const mainTable = await openTableAsync(page, 'quest');
			await selectRowAsync(mainTable, 0);
			await waitForRelationsPanelContentAsync(page);

			const visibleCell = page.locator(MINI_TABLE_VISIBLE_DATA_CELL_SELECTOR).first();
			await expect(visibleCell).toBeVisible();
			// セルをクリックしてミニテーブルにフォーカスを移す（Ctrlなし）
			await visibleCell.click();
			// F12で定義ジャンプ
			await page.keyboard.press('F12');

			const activeTab = page.locator('.tab-button-active');
			await expect(activeTab).toHaveText('enemy');
		},
	);

	test(
		'enemyミニテーブルのセルをCtrl+クリックすると左ペインにenemyテーブルが表示されること',
		async ({ page }) => {
			const mainTable = await openTableAsync(page, 'quest');
			await selectRowAsync(mainTable, 0);
			await waitForRelationsPanelContentAsync(page);

			const miniTable = page.locator('.relations-panel .editor-table').first();
			await expect(miniTable).toBeVisible();

			const visibleCell = page.locator(MINI_TABLE_VISIBLE_DATA_CELL_SELECTOR).first();
			await expect(visibleCell).toBeVisible();

			await visibleCell.click({ modifiers: ['Control'] });

			// 左ペインのアクティブタブがenemyになり、enemyテーブルが表示されること
			const activeTab = page.locator('.tab-button-active');
			await expect(activeTab).toHaveText('enemy');
			// enemy テーブルのヘッダー（ja列）が左ペインに表示されることを確認する
			// enemy には id・ja の2列があり、quest の id・name・enemy_id とは列構成が異なる
			const enemyJaHeader = page.locator('.editor-left-pane .editor-table .editor-table-column-header')
				.filter({ hasText: 'ja' });
			await expect(enemyJaHeader).toBeVisible();
		},
	);
});

// =============================================================================
// テストスイート2: ミニテーブルの参照列でないセルでもCtrl+クリックでジャンプすること
// =============================================================================

test.describe('ミニテーブルは参照列の有無に関わらずCtrl+クリックでジャンプすること', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createDrillDownTestFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
	});

	test(
		'参照列がひとつもないenemyミニテーブルの任意のセルでCtrl+クリックするとジャンプが動作すること',
		async ({ page }) => {
			// quest を開いて row0 を選択することで enemy ミニテーブルを表示させる
			const mainTable = await openTableAsync(page, 'quest');
			await selectRowAsync(mainTable, 0);
			await waitForRelationsPanelContentAsync(page);

			const visibleCell = page.locator(MINI_TABLE_VISIBLE_DATA_CELL_SELECTOR).first();
			await expect(visibleCell).toBeVisible();

			// Ctrl+クリック前のアクティブタブが quest であることを確認する
			const activeTab = page.locator('.tab-button-active');
			await expect(activeTab).toHaveText('quest');

			// 参照なし列でCtrl+クリック
			await visibleCell.click({ modifiers: ['Control'] });

			// アクティブタブが enemy に変わること（参照なし列でもジャンプが起きる）
			await expect(activeTab).toHaveText('enemy');
		},
	);
});

// =============================================================================
// テストスイート3: 通常テーブルのCtrl+クリックは参照先テーブルへジャンプすること（回帰テスト）
// =============================================================================

test.describe('通常テーブルのCtrl+クリックは参照先テーブルへジャンプすること', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createDrillDownTestFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
	});

	test(
		'questテーブルのenemy_id列（FK列）をCtrl+クリックするとenemyテーブルへジャンプすること',
		async ({ page }) => {
			// quest テーブルを開いて1行目を選択する（参照ヒントが描画されるまで待機）
			const mainTable = await openTableAsync(page, 'quest');
			await selectRowAsync(mainTable, 0);

			// FK列セルは .cell-reference-hint を持つことで識別できる
			const fkCell = page.locator(
				'.editor-left-pane .editor-table-cell' +
				':not(.editor-table-row-header)' +
				':not(.editor-table-column-header)' +
				':not(.editor-table-corner-cell)'
			).filter({ has: page.locator('.cell-reference-hint') }).first();
			await expect(fkCell).toBeVisible();

			// Ctrl+クリックで定義ジャンプ
			await fkCell.click({ modifiers: ['Control'] });

			// enemy タブがアクティブになること
			const activeTab = page.locator('.tab-button-active');
			await expect(activeTab).toHaveText('enemy');
		},
	);

	test(
		'questテーブルのFK列をCtrl+クリックした後にパンくずバーが表示されること（回帰テスト）',
		async ({ page }) => {
			const mainTable = await openTableAsync(page, 'quest');
			await selectRowAsync(mainTable, 0);

			const fkCell = page.locator(
				'.editor-left-pane .editor-table-cell' +
				':not(.editor-table-row-header)' +
				':not(.editor-table-column-header)' +
				':not(.editor-table-corner-cell)'
			).filter({ has: page.locator('.cell-reference-hint') }).first();
			await expect(fkCell).toBeVisible();
			await fkCell.click({ modifiers: ['Control'] });

			await expect(page.locator('.tab-button-active')).toHaveText('enemy');

			// ジャンプ後にパンくずバーが表示されること（遷移履歴が積まれている）
			const breadcrumbBar = page.locator('.editor-breadcrumb-bar');
			await expect(breadcrumbBar).toBeVisible();
		},
	);
});
