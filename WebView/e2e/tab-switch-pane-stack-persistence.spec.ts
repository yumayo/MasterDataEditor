import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// タブ切替時のペインスタック保持テスト
//
// 不具合概要:
//   tab.ts の activateTabState() が無条件に initPaneStack() を呼び出すため、
//   定義ジャンプでペインスタックを深くした状態でタブ切替すると、
//   元のタブに戻った際にペインスタックが初期状態（2エントリ）にリセットされる。
//
//   根本原因:
//     - TabState に paneStack / viewIndex が保存されていない
//     - activateTabState() がタブを切り替えるたびに initPaneStack() を呼ぶ
//
// 期待動作:
//   shopタブでshop_productの定義ジャンプ後（ペインスタック深化状態）に
//   questタブへ切替し、再びshopタブに戻ると、ペインスタックが保持されている。
//   → ナビゲーションバーが表示されており、shop_productが左スロットに表示される。
//
// テーブル構成:
//   shop:         id, name（ショップマスター）
//   shop_product: id, shop_id（→ shop.id）, item_name（商品名）
//   quest:        id, name（クエストマスター。shop等との関係なし）
//
//   shopを開いてrow0選択 → RelationsPanelにshop_product（1:N）のミニテーブルが表示される。
//   shop_productミニテーブルのセルをCtrl+Click → ペインスタックに新しいRPが追加される。
//   questタブに切替後、shopタブに戻ると、ペインスタックが保持されているはず（現在はリセットされる）。
// =============================================================================

/**
 * タブ切替ペインスタック保持テスト用のファイルシステムを生成する
 */
function createTabSwitchTestFileSystem(): MockFileSystem {
	return {
		"schema/shop.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
			],
			primary_key: "id",
		}),
		"data/shop.csv": [
			"id,name",
			"1,weapon_shop",
			"2,item_shop",
		].join("\n"),
		"schema/shop_product.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				// shop.id をFKとして参照する（RelationsPanelはshop側から1:Nで表示する）
				{ key: 1, name: "shop_id", type: "int", reference: "shop.id" },
				{ key: 2, name: "item_name", type: "string" },
			],
			primary_key: "id",
		}),
		"data/shop_product.csv": [
			"id,shop_id,item_name",
			"1,1,sword",
			"2,1,shield",
			"3,2,potion",
		].join("\n"),
		// questはshopと無関係なテーブル（タブ切替用途のみ）
		"schema/quest.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
			],
			primary_key: "id",
		}),
		"data/quest.csv": [
			"id,name",
			"1,first_quest",
			"2,second_quest",
		].join("\n"),
	};
}

/**
 * エクスプローラーからテーブルを開き、左スロットのEditorTable Locatorを返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
	const explorer = page.locator('#explorer');
	await explorer.getByText(tableName, { exact: true }).click();
	// タブ切替後は editor-left-slot 内の visible な EditorTable を返す
	const table = page.locator('.editor-left-slot .editor-table:visible').first();
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
 * 右スロット（.editor-right-slot）内のRelationsPanelにあるミニテーブルの
 * visibleなデータセルを取得するセレクタ
 * N:1ミニテーブルではhideColumnsByName()でid列がdisplay:noneになるため除外する
 */
const RIGHT_SLOT_MINI_TABLE_VISIBLE_CELL_SELECTOR = [
	'.editor-right-slot .relations-panel .editor-table',
	' .editor-table-cell:not(.editor-table-row-header)',
	':not(.editor-table-column-header)',
	':not(.editor-table-corner-cell)',
	':not([style*="display: none"])',
].join('');

// =============================================================================
// テストスイート: タブ切替後のペインスタック保持
// =============================================================================

test.describe('タブ切替後のペインスタック保持', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createTabSwitchTestFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
	});

	// ---------------------------------------------------------------------------
	// テスト: shopタブで定義ジャンプ後、questタブ→shopタブの順に切り替えると
	//         ペインスタックが保持されること
	//
	// 再現手順:
	//   1. questテーブルをクリック（タブを開く）
	//   2. shopテーブルをクリック（タブを開く）
	//   3. shopのrow0を選択 → 右ペインにshop_productミニテーブルが表示される
	//   4. shop_productミニテーブルの0行0列セルをCtrl+Click（定義ジャンプ）
	//   5. 定義ジャンプ成功を確認（ナビゲーションバーが表示され "2 / 3" になる）
	//   6. questタブをクリック
	//   7. shopタブをクリック
	//   → 期待: ナビゲーションバーが表示されており、shop_productが左スロットに残っている
	// ---------------------------------------------------------------------------
	test(
		'shopタブでshop_product定義ジャンプ後にquestタブへ切替し戻るとペインスタックが保持されること',
		async ({ page }) => {
			// 手順1: questテーブルをクリックしてタブを開く
			const explorer = page.locator('#explorer');
			await explorer.getByText('quest', { exact: true }).click();
			await expect(page.locator('.editor-left-slot .editor-table:visible').first()).toBeVisible();

			// 手順2: shopテーブルをクリックしてタブを開く
			const shopTable = await openTableAsync(page, 'shop');

			// 手順3: shopのrow0を選択 → 右ペインにshop_product（1:N）ミニテーブルが表示される
			await selectRowAsync(shopTable, 0);
			await waitForRelationsPanelContentAsync(page);

			// shop_productミニテーブルが右スロットに表示されるまで待機する
			const shopProductMiniTable = page.locator('.editor-right-slot .relations-panel .editor-table').first();
			await expect(shopProductMiniTable).toBeVisible();

			// shop_productセクションのタイトルが右スロットに存在することを確認する
			const shopProductSection = page.locator('.editor-right-slot .relations-panel .relations-table-title')
				.filter({ hasText: 'shop_product' });
			await expect(shopProductSection).toBeVisible();

			// 手順4: shop_productミニテーブルのvisibleなデータセルをCtrl+Click（定義ジャンプ）
			const visibleCell = page.locator(RIGHT_SLOT_MINI_TABLE_VISIBLE_CELL_SELECTOR).first();
			await expect(visibleCell).toBeVisible();
			await visibleCell.click({ modifiers: ['Control'] });

			// 手順5: 定義ジャンプ成功を確認
			//   ペインスタックが3つになり、ナビゲーションバーが表示されインジケーターが "2 / 3" になる
			await expect(page.locator('.editor-navigation-bar')).toBeVisible();
			await expect(page.locator('.editor-navigation-bar .nav-indicator')).toHaveText('2 / 3');

			// 定義ジャンプ後: 左スロットにshop_productのRelationsPanelが表示されていることを確認する
			// （viewIndex=1: 左=RP1[shop_product], 右=RP2[shop_productの参照先]）
			const leftSlotRelationsPanel = page.locator('.editor-left-slot .relations-panel');
			await expect(leftSlotRelationsPanel).toBeVisible();

			// 手順6: questタブをクリックして切り替える
			await explorer.getByText('quest', { exact: true }).click();

			// questタブに切り替わったことを確認する（left-slotが更新される）
			const questTable = page.locator('.editor-left-slot .editor-table:visible').first();
			await expect(questTable).toBeVisible();

			// 手順7: shopタブをクリックして戻る
			// タブボタン（.tab-button）をクリックして既存のshopタブに戻る
			const shopTabButton = page.locator('.tab-button').filter({ hasText: 'shop' }).first();
			await shopTabButton.click();

			// =============================================================
			// アサーション: ペインスタックが保持されていること
			//
			// 現在の実装（バグあり）では activateTabState() が initPaneStack() を呼び出すため、
			// ナビゲーションバーが非表示になりペインスタックがリセットされる。
			// 修正後はペインスタックが保持されており以下のアサーションが通るはず。
			// =============================================================

			// ナビゲーションバーが表示されていること（ペインスタックがリセットされていない）
			await expect(page.locator('.editor-navigation-bar')).toBeVisible();

			// インジケーターが "2 / 3" のままであること（定義ジャンプ後の状態が保持されている）
			await expect(page.locator('.editor-navigation-bar .nav-indicator')).toHaveText('2 / 3');

			// 左スロットにshop_productのRelationsPanelが表示されていること
			// （ペインスタックがリセットされるとshopのEditorTableが左スロットに表示されてしまう）
			await expect(page.locator('.editor-left-slot .relations-panel')).toBeVisible();

			// 左スロットのRelationsPanel内にshop_productのミニテーブルが存在すること
			// （内部状態が保持されており、タブ復帰後も再構築なしで表示される）
			const leftSlotMiniTable = page.locator('.editor-left-slot .relations-panel .editor-table').first();
			await expect(leftSlotMiniTable).toBeVisible();

			// ミニテーブル内に実際のデータが表示されていること（"sword" はshop_id=1の商品）
			// タブ復帰後に内部状態が破壊されていた場合、データセルが空になる
			const leftSlotMiniTableCells = page.locator([
				'.editor-left-slot .relations-panel .editor-table',
				' .editor-table-cell:not(.editor-table-row-header)',
				':not(.editor-table-column-header)',
				':not(.editor-table-corner-cell)',
				':not([style*="display: none"])',
			].join(''));
			await expect(leftSlotMiniTableCells.filter({ hasText: 'sword' })).toBeVisible();

			// 右スロット（追加RP）にもミニテーブルが存在すること
			// shop_product の参照先（shop）または参照元テーブルのミニEditorTableが描画されていること
			const rightSlotRelationsPanel = page.locator('.editor-right-slot .relations-panel');
			await expect(rightSlotRelationsPanel).toBeVisible();
			const rightSlotMiniTable = page.locator('.editor-right-slot .relations-panel .editor-table').first();
			await expect(rightSlotMiniTable).toBeVisible();
		},
	);
});
