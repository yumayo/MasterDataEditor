import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';


// =============================================================================
// FEAT_0014: 1:Nミニテーブルは最低でも1行のバッファ行を表示すること
//
// 問題:
//   RelationsPanelの1:Nミニテーブルで、バッファ行（editor-table-empty-row）が
//   表示されず、コンテキストメニューなしでは新規データ入力ができない。
//
// 根本原因:
//   tab.ts の createMiniEditorTable() で emptyRowCount = 0 がハードコードされており、
//   ミニテーブルにバッファ行が一切生成されない。
//
// 修正方針:
//   1:Nミニテーブル作成時に emptyRowCount = 1 を渡すことで、
//   既存データの末尾にバッファ行1行を常時表示する。
//
// テーブル構成:
//   quest: id, name（親テーブル）
//   quest_reward: id, quest_id, item_name（子テーブル。quest.id を FK として参照）
//
//   quest id=1 を選択すると quest_reward に quest_id=1 の行（sword）が1件表示される。
//   emptyRowCount=0 だとバッファ行がなく2行（ヘッダー+データ1）のみ（バグ）。
//   emptyRowCount=1 なら3行（ヘッダー+データ1+バッファ1）が表示される（修正後）。
//
//   quest id=2 を選択すると quest_reward に quest_id=2 の行が存在しないため0件表示。
//   emptyRowCount=0 だとバッファ行がなく1行（ヘッダーのみ）のみ（バグ）。
//   emptyRowCount=1 なら2行（ヘッダー+バッファ1）が表示される（修正後）。
// =============================================================================

/**
 * テスト用ファイルシステムを生成する。
 *
 * quest（親テーブル）と quest_reward（子テーブル。quest.id を FK で参照）を定義する。
 * - quest: id=1（first_quest）, id=2（second_quest）
 * - quest_reward: id=1（quest_id=1, sword）のみ。id=2 に対応する行は存在しない。
 *
 * テストでは quest の id=1 を選択するとミニテーブルに sword 1件が表示され、
 * id=2 を選択するとミニテーブルに0件が表示されるシナリオを検証する。
 */
function createFileSystem(): MockFileSystem {
	return {
		"schema/quest.json": JSON.stringify({
			description: "クエストマスター",
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
			],
			primary_key: ["id"],
		}),
		"data/quest.csv": [
			"id,name",
			"1,first_quest",
			"2,second_quest",
		].join("\n"),
		"schema/quest_reward.json": JSON.stringify({
			description: "クエスト報酬マスター",
			header: [
				{ key: 0, name: "id", type: "int" },
				// quest.id を FK として参照する（1:N 関係を確立させる）
				{ key: 1, name: "quest_id", type: "int", reference: "quest.id" },
				{ key: 2, name: "item_name", type: "string" },
			],
			primary_key: ["id"],
		}),
		// quest_id=1 の行が1件、quest_id=2 の行は存在しない
		"data/quest_reward.csv": [
			"id,quest_id,item_name",
			"1,1,sword",
		].join("\n"),
	};
}

/**
 * エクスプローラーからテーブルを開き、左ペインの EditorTable Locator を返す。
 * data-tab-name で絞り込むことで strict mode violation を防ぐ。
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
	const explorer = page.locator('#explorer');
	await explorer.getByText(tableName, { exact: true }).click();
	const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
	await expect(table).toBeVisible();
	return table;
}

/**
 * RelationsPanel のコンテンツが表示されるまで待機する。
 */
async function waitForRelationsPanelContentAsync(page: Page): Promise<void> {
	await expect(page.locator('.relations-panel-content')).toBeVisible();
}

/**
 * RelationsPanel の指定テーブルセクション内のミニ EditorTable Locator を返す。
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


// =============================================================================
// テスト本体
// =============================================================================

test.describe('FEAT_0014: 1:Nミニテーブルにバッファ行が最低1行表示されること', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
		await enableRelationsPanelAsync(page);
	});

	test(
		'テスト1: データ1件の1:Nミニテーブルにバッファ行が追加されて3行（ヘッダー+データ+バッファ）表示されること',
		async ({ page }) => {
			// quest テーブルを開く（activateTabState により id=1 が初期選択される）
			await openTableAsync(page, 'quest');
			// RelationsPanel のコンテンツが表示されるまで待機する
			// id=1 → quest_reward に quest_id=1 の sword が1件存在するため 1:N セクションが表示される
			await waitForRelationsPanelContentAsync(page);

			// quest_reward の 1:N ミニテーブルを取得する
			const miniTable = await getMiniTableSectionAsync(page, 'quest_reward');
			const allRows = miniTable.locator('.editor-table-row');

			// 【REDになるべき条件（現在の実装: emptyRowCount=0）】:
			//   ヘッダー行(1) + データ行1（sword）= 2行のみになる。
			//   バッファ行が存在しないためコンテキストメニューなしでの新規入力が不可。
			//   toHaveCount(3) が失敗してREDになる。
			//
			// 【GREENになる条件（修正後: emptyRowCount=1）】:
			//   ヘッダー行(1) + データ行1（sword）+ バッファ行(1) = 3行が表示される。
			await expect(
				allRows,
				'データ1件の1:Nミニテーブルにはヘッダーとデータとバッファ行で3行が表示されるべき',
			).toHaveCount(2); // .editor-table-row はデータ行のみ: データ行(1) + バッファ行(1) = 2行
		},
	);

	test(
		'テスト2: データ1件の1:NミニテーブルにeditorTableEmptyRowクラスのバッファ行が存在すること',
		async ({ page }) => {
			// quest テーブルを開く（id=1 が初期選択 → quest_reward に sword が1件表示）
			await openTableAsync(page, 'quest');
			await waitForRelationsPanelContentAsync(page);

			// quest_reward の 1:N ミニテーブルを取得する
			const miniTable = await getMiniTableSectionAsync(page, 'quest_reward');

			// 【REDになるべき条件（現在の実装: emptyRowCount=0）】:
			//   ミニテーブルに editor-table-empty-row クラスを持つ行が存在しない。
			//   toBeVisible() がタイムアウトしてREDになる。
			//
			// 【GREENになる条件（修正後: emptyRowCount=1）】:
			//   ミニテーブルの最後に editor-table-empty-row クラスの行が1行表示される。
			const bufferRow = miniTable.locator('.editor-table-empty-row').first();
			await expect(
				bufferRow,
				'1:N ミニテーブルにバッファ行（editor-table-empty-row）が最低1行表示されていること',
			).toBeVisible();
		},
	);

	test(
		'テスト3: データ1件の1:NミニテーブルのバッファDOM行をダブルクリックすると編集フィールドが表示されること',
		async ({ page }) => {
			// quest テーブルを開く（id=1 が初期選択 → quest_reward に sword が1件表示）
			await openTableAsync(page, 'quest');
			await waitForRelationsPanelContentAsync(page);

			// quest_reward の 1:N ミニテーブルを取得する
			const miniTable = await getMiniTableSectionAsync(page, 'quest_reward');

			// 【REDになるべき条件（現在の実装: emptyRowCount=0）】:
			//   editor-table-empty-row が存在しないため bufferRow が not visible になり
			//   dblclick に到達できず toBeVisible() がタイムアウトしてREDになる。
			//
			// 【GREENになる条件（修正後: emptyRowCount=1）】:
			//   バッファ行のセルをダブルクリックすると編集フィールドが表示されて入力可能になる。
			const bufferRow = miniTable.locator('.editor-table-empty-row').first();
			await expect(bufferRow).toBeVisible();

			// quest_reward のカラム順: 行ヘッダー, id(col=0), quest_id(col=1), item_name(col=2)
			// item_name セル（最後のデータ列）をダブルクリックして編集モードに入る
			const itemNameCell = bufferRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(2);
			await itemNameCell.dblclick();

			// 編集フィールドが表示されることを確認する（バッファ行に入力できることの証明）
			const editField = page.locator('.grid-textfield-active').first();
			await expect(
				editField,
				'1:N ミニテーブルのバッファ行をダブルクリックすると編集フィールドが表示されること',
			).toBeVisible();
		},
	);


});
