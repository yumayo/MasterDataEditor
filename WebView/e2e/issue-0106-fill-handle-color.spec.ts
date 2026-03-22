import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// ISSUE-0106: フィルハンドルの色を非アクティブselectionと同色（灰色系）にする
//
// フィルハンドル（.fill-handle）のアクティブ時の背景色が灰色系であることを検証する。
// 従来は青色（rgba(0, 120, 215, ...)）だったが、非アクティブselectionと同色の
// 灰色系（rgba(128, 128, 128, ...)）に変更する。
//
// テーブル構成:
//   item: id, name（単純な2列テーブル）
//
// テストシナリオ:
//   1. テーブルを開き、セルをクリックしてフィルハンドルを表示させる
//   2. フィルハンドルの background-color が灰色系であることを検証
//   3. 青系でないことを検証
// =============================================================================

/** テスト用の最小限ファイルシステム */
function createTestFileSystem(): MockFileSystem {
	return {
		"schema/item.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
			],
			primary_key: ["id"],
		}),
		"data/item.csv": [
			"id,name",
			"1,Sword",
			"2,Shield",
		].join("\n"),
	};
}

/** エクスプローラーからテーブルを開き、左ペインの EditorTable Locator を返す */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
	const explorer = page.locator('#explorer');
	await explorer.getByText(tableName, { exact: true }).click();
	const table = page.locator('.editor-left-pane .editor-table');
	await expect(table).toBeVisible();
	return table;
}

/**
 * 指定した要素の computed background-color に colorFragment が含まれるかを返す。
 * colorFragment 例: '128, 128, 128'（灰色）、'0, 120, 215'（青）
 */
async function hasBackgroundColorAsync(el: Locator, colorFragment: string): Promise<boolean> {
	const color = await el.evaluate((e: Element) => window.getComputedStyle(e).backgroundColor);
	return color.includes(colorFragment) || color.includes(colorFragment.replace(/, /g, ','));
}

// データセルセレクタ（行ヘッダー・列ヘッダー・コーナーセルを除外）
const DATA_CELL_SELECTOR =
	'.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell)';

test.describe('ISSUE-0106: フィルハンドルの色', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createTestFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
	});

	test('アクティブ時のフィルハンドルの背景色が灰色系であること', async ({ page }) => {
		// テーブルを開いてデータセルをクリックし、フィルハンドルを表示させる
		const table = await openTableAsync(page, 'item');
		const dataCell = table.locator(DATA_CELL_SELECTOR).first();
		await expect(dataCell).toBeVisible();
		await dataCell.click();

		// フィルハンドルが表示されることを確認する
		const fillHandle = page.locator('.fill-handle');
		await expect(fillHandle).toBeVisible();

		// フィルハンドルの background-color が灰色系（128, 128, 128）であることを検証する
		await expect.poll(() => hasBackgroundColorAsync(fillHandle, '128, 128, 128')).toBe(true);

		// 青系（0, 120, 215）でないことを検証する
		expect(await hasBackgroundColorAsync(fillHandle, '0, 120, 215')).toBe(false);
	});

	test('フィルハンドルのホバー時も灰色系であること', async ({ page }) => {
		// テーブルを開いてデータセルをクリックし、フィルハンドルを表示させる
		const table = await openTableAsync(page, 'item');
		const dataCell = table.locator(DATA_CELL_SELECTOR).first();
		await expect(dataCell).toBeVisible();
		await dataCell.click();

		// フィルハンドルが表示されることを確認する
		const fillHandle = page.locator('.fill-handle');
		await expect(fillHandle).toBeVisible();

		// フィルハンドルにホバーする
		await fillHandle.hover();

		// ホバー時も灰色系（128, 128, 128）であることを検証する
		await expect.poll(() => hasBackgroundColorAsync(fillHandle, '128, 128, 128')).toBe(true);

		// 青系（0, 120, 215）でないことを検証する
		expect(await hasBackgroundColorAsync(fillHandle, '0, 120, 215')).toBe(false);
	});
});
