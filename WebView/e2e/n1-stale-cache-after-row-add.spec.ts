import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// リグレッションテスト: N:1ミニテーブルがキャッシュ陳腐化により新規追加行を表示しないバグ
//
// 根本原因:
//   resolveEntriesForEditorRowAsync() の N:1 解決部（L286-319）が
//   referenceDataCache.fullDataCache のみを参照しており、
//   ストアに新規追加された行を反映しない。
//
//   具体的な再現フロー:
//   1. shop タブを開き行選択 → fullDataCache["shop_product"] に Map を構築（id=1,2,3 のみ）
//   2. shop_product タブで id=8(group_id=1) を追加 → ストアは最新
//   3. shop タブに戻り product_group_id=1 の行を選択
//   4. resolveEntriesForEditorRowAsync() が fullDataCache にキャッシュヒット
//   5. resolveRowsByFkValue() が古い Map（id=1,2,3）を走査 → id=8 は存在しない
//   6. N:1 ミニテーブルに id=8 が表示されない（バグ）
//
// 期待動作:
//   N:1 パスでストアにデータがある場合は store.getRows() を優先使用することで、
//   新規追加行が N:1 ミニテーブルに表示される。
// =============================================================================

/**
 * テスト用ファイルシステム
 *
 * shop_product(参照先): id, group_id, name
 *   - group_id=1: id=1(Sword), id=2(Shield)  ← 2件
 *   - group_id=2: id=3(Potion)               ← 1件
 *
 * shop(参照元): id, name, product_group_id
 *   - product_group_id は shop_product.group_id を参照（group_id はPK "id" ではない列）
 *   - id=1(WeaponShop, product_group_id=1)
 *   - id=2(ItemShop,   product_group_id=2)
 *
 * テスト中に shop_product のバッファ空行に id=8, group_id=1, Axe を追加する。
 * 正しい動作: shop の product_group_id=1 を選択したとき、ミニテーブルに
 *             Sword・Shield・Axe の3行が表示される。
 * バグの動作: fullDataCache が陳腐化しているため Axe が除外されて2行しか表示されない。
 */
function createFileSystem(): MockFileSystem {
	return {
		"schema/shop_product.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "group_id", type: "int" },
				{ key: 2, name: "name", type: "string" },
			],
			primary_key: ["id"],
		}),
		"data/shop_product.csv": [
			"id,group_id,name",
			"1,1,Sword",
			"2,1,Shield",
			"3,2,Potion",
		].join("\n"),
		"schema/shop.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
				// product_group_id は shop_product.group_id を参照（group_id はPK "id" ではない）
				{ key: 2, name: "product_group_id", type: "int", reference: "shop_product.group_id" },
			],
			primary_key: ["id"],
		}),
		"data/shop.csv": [
			"id,name,product_group_id",
			"1,WeaponShop,1",
			"2,ItemShop,2",
		].join("\n"),
	};
}

/**
 * エクスプローラーからテーブルを開き、左ペインの EditorTable Locator を返す
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
 * RelationsPanel の指定テーブルセクションにあるミニ EditorTable Locator を返す
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
 * 共通セットアップ:
 *   1. shop タブを開いて行選択 → N:1 キャッシュを構築させる（fullDataCache["shop_product"] 生成）
 *   2. shop_product タブを開き、バッファ空行に id=8, group_id=1, Axe を入力して Ctrl+S 保存
 *   3. shop タブに戻り product_group_id=1（WeaponShop）の行を選択した状態にする
 *
 * 戻り値: shop テーブルの Locator（WeaponShop 行が選択済み）
 */
async function setupAxeAddedAndShopSelectedAsync(page: Page): Promise<Locator> {
	// Step 1: shop タブを開いて最初の行（WeaponShop, product_group_id=1）を選択する
	// → N:1 解決が走り fullDataCache["shop_product"] が構築される（id=1,2,3 のスナップショット）
	const shopTable = await openTableAsync(page, 'shop');
	await selectRowAsync(shopTable, 0);
	await waitForRelationsPanelContentAsync(page);

	// Step 2: shop_product タブを開き、バッファ空行に Axe (id=8, group_id=1) を入力する
	// DOM 構造: row[0]=ヘッダー, row[1]=id=1(Sword), row[2]=id=2(Shield), row[3]=id=3(Potion), row[4]=バッファ空行
	const shopProductTable = await openTableAsync(page, 'shop_product');
	const bufferRow = shopProductTable.locator('.editor-table-row').nth(4);

	const idCell = bufferRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
	await idCell.dblclick();
	const idField = page.locator('.grid-textfield-active').first();
	await idField.selectText();
	await idField.type('8');
	await page.keyboard.press('Enter');

	const groupIdCell = bufferRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(1);
	await groupIdCell.dblclick();
	const groupIdField = page.locator('.grid-textfield-active').first();
	await groupIdField.selectText();
	await groupIdField.type('1');
	await page.keyboard.press('Enter');

	const nameCell = bufferRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(2);
	await nameCell.dblclick();
	const nameField = page.locator('.grid-textfield-active').first();
	await nameField.selectText();
	await nameField.type('Axe');
	await page.keyboard.press('Enter');

	// Step 3: Ctrl+S で保存する（ストアに id=8, group_id=1 が追加される）
	await shopProductTable.click();
	await page.keyboard.press('Control+s');
	await page.waitForTimeout(500);

	// Step 4: shop タブに戻り WeaponShop（product_group_id=1）の行を選択する
	// openTableAsync でエクスプローラーをクリックしてタブを切り替えてから行を選択する
	const updatedShopTable = await openTableAsync(page, 'shop');
	await selectRowAsync(updatedShopTable, 0);
	await waitForRelationsPanelContentAsync(page);
	return updatedShopTable;
}

// =============================================================================
// テスト本体
// =============================================================================

test.describe('N:1ミニテーブルがストア新規追加行をキャッシュ陳腐化なく表示すること', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
		await enableRelationsPanelAsync(page);
	});

	test(
		'shop_product に行を追加した後、shop の N:1 ミニテーブルに追加行が表示されること',
		async ({ page }) => {
			// 初期状態を確認:
			// shop の WeaponShop（product_group_id=1）を選択 → ミニテーブルに Sword・Shield の2行が表示される
			const shopTable = await openTableAsync(page, 'shop');
			await selectRowAsync(shopTable, 0);
			await waitForRelationsPanelContentAsync(page);
			const miniTable = await getMiniTableSectionAsync(page, 'shop_product');
			// 初期状態: ヘッダー行(1) + データ行(2, Sword・Shield) = 3行
			// バッファ空行（editor-table-empty-row）を除外してヘッダー+データ行のみカウントする
			await expect(miniTable.locator('.editor-table-row:not(.editor-table-empty-row)')).toHaveCount(3);

			// Axe を追加して shop WeaponShop 行を選択した状態にする
			await setupAxeAddedAndShopSelectedAsync(page);

			// 期待: ヘッダー行(1) + データ行(3, Sword・Shield・Axe) = 4行
			// バグの動作: fullDataCache が陳腐化しているため Axe が除外されて3行（ヘッダー+2）になる
			// バッファ空行（editor-table-empty-row）を除外してヘッダー+データ行のみカウントする
			const refreshedMiniTable = await getMiniTableSectionAsync(page, 'shop_product');
			await expect(
				refreshedMiniTable.locator('.editor-table-row:not(.editor-table-empty-row)'),
				'shop_product に追加した Axe（group_id=1）が N:1 ミニテーブルに表示されるべき',
			).toHaveCount(4);
		},
	);

	test(
		'shop_product に行を追加した後、N:1 ミニテーブルに "Axe" として表示されること',
		async ({ page }) => {
			// Axe を追加して shop WeaponShop 行を選択した状態にする
			await setupAxeAddedAndShopSelectedAsync(page);

			const miniTable = await getMiniTableSectionAsync(page, 'shop_product');

			// ミニテーブルのデータ行一覧から "Axe" セルを探す
			// バグ修正前は fullDataCache の古いデータで resolveRowsByFkValue() が走るため Axe が含まれない
			// バッファ空行（editor-table-empty-row）を除外してヘッダー+データ行のみカウントする
			const allRows = miniTable.locator('.editor-table-row:not(.editor-table-empty-row)');
			const rowCount = await allRows.count();
			// ヘッダー行(0) + データ行(1,2,3) = 4行あるはず。バグがあれば3行になる。
			expect(rowCount, 'ミニテーブルの行数が4行（ヘッダー+3データ）であるべき').toBe(4);

			// 最後のデータ行（Axe）の name 列に "Axe" が表示されていることを確認する
			// データ行インデックス: nth(1)=Sword, nth(2)=Shield, nth(3)=Axe
			// shop_product のカラム: 行ヘッダー(col=0), id(col=1), group_id(col=2), name(col=3)
			const axeRow = allRows.nth(3);
			await expect(axeRow, '3番目のデータ行（Axe）がミニテーブルに存在するべき').toBeVisible();
			const nameCell = axeRow.locator('.editor-table-cell:not(.editor-table-row-header)').last();
			await expect(
				nameCell,
				'追加した Axe がミニテーブルの name 列に表示されるべき',
			).toHaveText('Axe');
		},
	);

	test(
		'shop_product に行を追加した後、N:1 ミニテーブルの行カウント表示が3件になること',
		async ({ page }) => {
			// Axe を追加して shop WeaponShop 行を選択した状態にする
			await setupAxeAddedAndShopSelectedAsync(page);

			const section = page.locator('.relations-table-section').filter({
				has: page.locator('.relations-table-title').getByText('shop_product', { exact: true }),
			});
			await expect(section).toBeVisible();

			// .relations-table-row-count が "3 rows" を示すことを確認する
			// バグがあると fullDataCache の古いデータで2件のみ解決されるため "2 rows" になる
			const rowCountEl = section.locator('.relations-table-row-count');
			await expect(
				rowCountEl,
				'shop_product に行を追加した後の row-count が 3 rows と表示されるべき',
			).toHaveText('3 rows');
		},
	);
});
