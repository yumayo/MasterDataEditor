import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// リグレッションテスト: バッファ空行に追加した行がミニテーブルに反映されないバグ
//
// 根本原因:
//   ReverseReferenceResolver.resolveAsync() は呼び出し時点のCSV/ストアデータから
//   逆参照マップを構築し、reverseEntry.rows（子テーブルのPK値スナップショット）を保持する。
//   その後、ストアに行が追加（バッファ空行への入力）されても reverseEntry.rows は更新されない。
//
//   relations-panel.ts L363:
//     const pkSet = new Set(reverseEntry.rows.map(r => r.pkValue));
//   この pkSet は古いスナップショットなため、新規追加行の pkValue が含まれない。
//   一方 allRows はストア経由で最新データを参照しているため乖離が発生し、
//   フィルタ（pkSet.has(row[pkColIdx])）で新規行が除外されてミニテーブルに表示されない。
//
// 再現手順:
//   1. enemy テーブルを開く（逆参照マップが構築される）
//   2. skill テーブルを開き、バッファ空行に新データを入力・保存
//   3. enemy テーブルで行を選択してミニテーブルを確認
//   → 修正前は新しく追加した skill 行がミニテーブルに表示されなかった
// =============================================================================

/**
 * テスト用ファイルシステム
 *
 * enemy(親): id=1（スライム）, id=2（ドラゴン）
 * skill(子): id=1,enemy_id=1,slash / id=2,enemy_id=2,thunder
 *
 * テスト中にバッファ空行へ id=3,enemy_id=1,flame を追加する。
 * 正しい動作: enemy id=1 を選択したとき、ミニテーブルに slash と flame の2行が表示される。
 * バグの動作: 逆参照マップが古いため flame が除外されて slash の1行しか表示されなかった。
 */
function createFileSystem(): MockFileSystem {
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
		"schema/skill.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "enemy_id", type: "int", reference: "enemy.id" },
				{ key: 2, name: "name", type: "string" },
			],
			primary_key: "id",
		}),
		"data/skill.csv": [
			"id,enemy_id,name",
			"1,1,slash",
			"2,2,thunder",
		].join("\n"),
	};
}

/**
 * エクスプローラーからテーブルを開き、左ペインのEditorTable Locatorを返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
	const explorer = page.locator('#explorer');
	await explorer.getByText(tableName, { exact: true }).click();
	const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
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
 * リレーションパネルのコンテンツが表示されるまで待機する
 */
async function waitForRelationsPanelContentAsync(page: Page): Promise<void> {
	await expect(page.locator('.relations-panel-content')).toBeVisible();
}

/**
 * RelationsPanelの指定テーブルセクションにあるミニEditorTable Locatorを返す
 */
async function getMiniTableSectionAsync(page: Page, childTableName: string): Promise<Locator> {
	const section = page.locator('.relations-table-section').filter({
		has: page.locator('.relations-table-title').getByText(childTableName, { exact: true }),
	});
	await expect(section).toBeVisible();
	const miniTable = section.locator('.editor-table');
	await expect(miniTable).toBeVisible();
	return miniTable;
}

/**
 * enemy テーブルを先に開いて逆参照マップを構築させた後、
 * skill テーブルのバッファ空行に flame (id=3, enemy_id=1) を入力して Ctrl+S で保存し、
 * enemy テーブルに切り替えて id=1 の行を選択した状態にする。
 *
 * 3つのテストケースに共通するセットアップ。
 * 戻り値: enemy テーブルの Locator（id=1 行が選択済み）
 */
async function setupFlameAddedAndEnemySelectedAsync(page: Page): Promise<Locator> {
	// Step 1: enemy テーブルを開く（逆参照マップが構築される）
	await openTableAsync(page, 'enemy');

	// Step 2: skill テーブルを開き、バッファ空行に flame（enemy_id=1）を入力する
	// DOM構造: row[0]=ヘッダー、row[1]=id=1(slash)、row[2]=id=2(thunder)、row[3]=バッファ空行
	const skillTable = await openTableAsync(page, 'skill');
	const bufferRow = skillTable.locator('.editor-table-row').nth(3);

	const idCell = bufferRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
	await idCell.dblclick();
	const idField = page.locator('.grid-textfield-active').first();
	await idField.selectText();
	await idField.type('3');
	await page.keyboard.press('Enter');

	const enemyIdCell = bufferRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(1);
	await enemyIdCell.dblclick();
	const enemyIdField = page.locator('.grid-textfield-active').first();
	await enemyIdField.selectText();
	await enemyIdField.type('1');
	await page.keyboard.press('Enter');

	const nameCell = bufferRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(2);
	await nameCell.dblclick();
	const nameField = page.locator('.grid-textfield-active').first();
	await nameField.selectText();
	await nameField.type('flame');
	await page.keyboard.press('Enter');

	// Step 3: Ctrl+S で保存する（ストアに id=3 が追加される）
	await skillTable.click();
	await page.keyboard.press('Control+s');
	await page.waitForTimeout(500);

	// Step 4: enemy テーブルに切り替えて id=1（スライム）を選択する
	// openTableAsync でエクスプローラーをクリックしてタブを切り替えてから行を選択する
	const enemyTable = await openTableAsync(page, 'enemy');
	await selectRowAsync(enemyTable, 0);
	await waitForRelationsPanelContentAsync(page);
	return enemyTable;
}

// =============================================================================
// テスト本体
// =============================================================================

test.describe('バッファ空行に追加した行がミニテーブルに反映されること', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
	});

	test(
		'子テーブルのバッファ空行に追加した行が、親テーブルのミニテーブルに表示されること',
		async ({ page }) => {
			// 初期状態を確認: enemy テーブルを開いて id=1 のミニテーブルが slash の1行のみであることを確認する
			// （共通セットアップの前に別途 enemy を開いてチェックするため、ここでは個別に行う）
			const enemyTable = await openTableAsync(page, 'enemy');
			await selectRowAsync(enemyTable, 0);
			await waitForRelationsPanelContentAsync(page);
			const miniTable = await getMiniTableSectionAsync(page, 'skill');
			// 初期状態: ヘッダー行(1) + データ行(1, slash) + バッファ行(1) = 3行
			await expect(miniTable.locator('.editor-table-row')).toHaveCount(3);

			// flame を追加して enemy id=1 を選択した状態にする
			await setupFlameAddedAndEnemySelectedAsync(page);

			// 期待: ヘッダー行(1) + データ行(2, slash と flame) + バッファ行(1) = 4行
			// 修正前はバグで逆参照マップが古いため flame が除外され、ヘッダー行(1) + データ行(1, slash) = 2行だった
			const refreshedMiniTable = await getMiniTableSectionAsync(page, 'skill');
			await expect(
				refreshedMiniTable.locator('.editor-table-row'),
				'バッファ空行に追加した flame（enemy_id=1）がミニテーブルに表示されるべき',
			).toHaveCount(4);
		},
	);

	test(
		'子テーブルのバッファ空行に追加した行が、ミニテーブルに "flame" として表示されること',
		async ({ page }) => {
			// flame を追加して enemy id=1 を選択した状態にする
			await setupFlameAddedAndEnemySelectedAsync(page);

			const refreshedMiniTable = await getMiniTableSectionAsync(page, 'skill');

			// 2番目のデータ行（ヘッダー行=nth(0)、slash=nth(1)、flame=nth(2)）を確認する
			const secondDataRow = refreshedMiniTable.locator('.editor-table-row').nth(2);
			await expect(secondDataRow, '2番目のデータ行（flame）がミニテーブルに存在するべき').toBeVisible();

			// name列に "flame" が表示されていることを確認する
			const nameDisplayCell = secondDataRow.locator(
				'.editor-table-cell:not(.editor-table-row-header)'
			).last();
			await expect(
				nameDisplayCell,
				// 修正前はバグでミニテーブルに表示されなかった
				'バッファ空行に追加した flame がミニテーブルのname列に表示されるべき',
			).toHaveText('flame');
		},
	);

	test(
		'逆参照マップ構築後に追加した行のrow-count表示が正しい件数（2件）になること',
		async ({ page }) => {
			// flame を追加して enemy id=1 を選択した状態にする
			await setupFlameAddedAndEnemySelectedAsync(page);

			const section = page.locator('.relations-table-section').filter({
				has: page.locator('.relations-table-title').getByText('skill', { exact: true }),
			});
			await expect(section).toBeVisible();

			// .relations-table-row-count が "2 rows" を示すことを確認する
			// 修正前はバグで古いスナップショットのため "1 rows" になっていた
			const rowCountEl = section.locator('.relations-table-row-count');
			await expect(
				rowCountEl,
				'バッファ空行追加後のrow-countが 2 rows と表示されるべき',
			).toHaveText('2 rows');
		},
	);
});
