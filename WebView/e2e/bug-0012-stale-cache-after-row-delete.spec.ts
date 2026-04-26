import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// BUG_0012: 行削除後にReferenceDataCacheが無効化されず、
//           ドロップダウン候補に削除済み行が残るバグ
//
// 根本原因:
//   editor-table-structure.ts の deleteRow() は store.removeRow() でストアを更新するが、
//   ReferenceDataCache には通知しない。
//   ReferenceDataCache.get() はキャッシュヒット時にストアと照合せず古いデータを返す。
// =============================================================================

function createFileSystem(): MockFileSystem {
	return {
		"schema/quest_reward.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "group_id", type: "int" },
				{ key: 2, name: "name", type: "string" },
			],
			primary_key: ["id"],
		}),
		"data/quest_reward.csv": [
			"id,group_id,name",
			"1,1,gold_small",
			"2,1,gold_medium",
			"3,2,item_potion",
			"4,2,item_ether",
		].join("\n"),
		"schema/quest.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
				{ key: 2, name: "reward_id", type: "int", reference: "quest_reward.name" },
			],
			primary_key: ["id"],
		}),
		"data/quest.csv": [
			"id,name,reward_id",
			"1,first_quest,2",
			"2,second_quest,3",
		].join("\n"),
	};
}

/**
 * エクスプローラーからテーブルを開き、左ペインの EditorTable Locator を返す
 * 既存テスト（reverse-reference-hint.spec.ts）と同じパターン
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
	await page.locator('#explorer').getByText(tableName, { exact: true }).click();
	// 複数タブが左ペインに存在するため data-tab-name で特定する
	const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
	await expect(table).toBeVisible();
	return table;
}

/**
 * 指定した行・列のデータセルを返す
 * rowIndex: 0始まり（ヘッダー行を除く）、colIndex: 0始まり（行ヘッダーを除く）
 */
function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
	const row = table.locator('.editor-table-row').nth(rowIndex);
	return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

/**
 * 左ペインのドロップダウンリスト Locator を返す
 */
function getLeftPaneDropdownList(page: Page): Locator {
	return page.locator('.editor-left-pane .grid-dropdown.visible .grid-dropdown-list');
}

/**
 * ドロップダウン候補リストのすべての ID テキストを収集する
 */
async function getDropdownItemIdsAsync(page: Page): Promise<string[]> {
	const dropdown = getLeftPaneDropdownList(page);
	await expect(dropdown).toBeVisible();
	const items = dropdown.locator('.grid-dropdown-item');
	const count = await items.count();
	const ids: string[] = [];
	for (let i = 0; i < count; i++) {
		ids.push(await items.nth(i).locator('.grid-dropdown-item-id').innerText());
	}
	return ids;
}

// =============================================================================
// テスト本体
// =============================================================================

test.describe('BUG_0012: 行削除後にキャッシュが無効化されてドロップダウン候補が更新されること', () => {
	test.beforeEach(async ({ page }) => {
		await installMockApiAsync(page, createFileSystem());
		await page.goto('/');
	});

	test(
		'quest_reward の id=1 を削除した後、quest テーブルの reward_id ドロップダウンに id=1 が含まれないこと',
		async ({ page }) => {
			// Step 1: quest テーブルを開いてドロップダウンを一度開き、キャッシュを構築する
			const questTable = await openTableAsync(page, 'quest');
			const rewardIdCell = getDataCell(questTable, 0, 2);
			await rewardIdCell.dblclick();
			const dropdown = getLeftPaneDropdownList(page);
			await expect(dropdown).toBeVisible();

			// 初期状態の確認: id=1,2,3,4 が候補に存在する
			const initialIds = await getDropdownItemIdsAsync(page);
			expect(initialIds).toEqual(expect.arrayContaining(['1', '2', '3', '4']));

			// ドロップダウンを閉じる
			await page.keyboard.press('Escape');
			await expect(dropdown).not.toBeVisible();

			// Step 2: quest_reward テーブルを開いて id=1 の行を削除する
			const questRewardTable = await openTableAsync(page, 'quest_reward');
			// 1行目（id=1）の行ヘッダーを右クリック
			const rowHeader = questRewardTable.locator('.editor-table-row-header').nth(0);
			await rowHeader.click({ button: 'right' });
			const menu = page.locator('.context-menu.visible');
			await expect(menu).toBeVisible();
			await menu.locator('.context-menu-item', { hasText: '行を削除' }).click();

			// 削除確認: 先頭行が id=2 になっている
			await expect(getDataCell(questRewardTable, 0, 0)).toHaveText('2');

			// Step 3: quest テーブルに戻る
			const updatedQuestTable = await openTableAsync(page, 'quest');

			// Step 4: reward_id 列をダブルクリックしてドロップダウンを再度開く
			await getDataCell(updatedQuestTable, 0, 2).dblclick();
			await expect(getLeftPaneDropdownList(page)).toBeVisible();

			// Step 5: 検証 — 削除した id=1 が候補リストに含まれていないこと
			// バグ状態: キャッシュが陳腐化しており id=1 が表示される → RED
			// 修正後: キャッシュが更新されており id=1 が消える → GREEN
			const afterDeleteIds = await getDropdownItemIdsAsync(page);
			expect(afterDeleteIds, '削除した id=1 が候補に残っている').not.toContain('1');
			expect(afterDeleteIds, '残存 id=2,3,4 が候補にあるべき').toEqual(expect.arrayContaining(['2', '3', '4']));
		},
	);

	test(
		'quest_reward の id=1 を削除した後のドロップダウン候補は id=2,3,4 のみであること',
		async ({ page }) => {
			// Step 1: quest テーブルを開いてドロップダウンでキャッシュを構築
			const questTable = await openTableAsync(page, 'quest');
			await getDataCell(questTable, 0, 2).dblclick();
			await expect(getLeftPaneDropdownList(page)).toBeVisible();
			await page.keyboard.press('Escape');

			// Step 2: quest_reward テーブルを開いて id=1 の行を削除
			const questRewardTable = await openTableAsync(page, 'quest_reward');
			const rowHeader = questRewardTable.locator('.editor-table-row-header').nth(0);
			await rowHeader.click({ button: 'right' });
			const menu = page.locator('.context-menu.visible');
			await expect(menu).toBeVisible();
			await menu.locator('.context-menu-item', { hasText: '行を削除' }).click();

			// Step 3: quest テーブルに戻りドロップダウンを開く
			const updatedQuestTable = await openTableAsync(page, 'quest');
			await getDataCell(updatedQuestTable, 0, 2).dblclick();
			await expect(getLeftPaneDropdownList(page)).toBeVisible();

			// 候補リストが id=2,3,4 の3件のみであること
			// バグ状態: 4件（1,2,3,4）→ RED
			const afterDeleteIds = await getDropdownItemIdsAsync(page);
			expect(afterDeleteIds, '候補は id=2,3,4 の3件のみ').toEqual(['2', '3', '4']);
		},
	);
});
