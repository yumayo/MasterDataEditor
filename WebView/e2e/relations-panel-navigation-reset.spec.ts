import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// RelationsPanelナビゲーション履歴リセットテスト
//
// 不具合概要:
//   定義ジャンプ（Ctrl+Click）でペインスタックを深くした後、←ボタンで戻り、
//   メインテーブルで別の行を選択しても Tab の paneStack がリセットされない。
//   updateForRow() は paneStack[1]（グローバルRP）のコンテンツだけ更新するが、
//   paneStack[2] 以降の追加RPは残ったまま。
//   → →ボタンを押すと前の行の古いコンテキストが表示される。
//
// 修正方針:
//   Tab に resetPaneStackToRoot() メソッドを追加し、
//   RelationsPanel.updateForRow() 内で行選択変更時に呼ぶ。
//   ただし forceRefreshRelationsPanel()（同一行リフレッシュ）では呼ばない。
//
// テーブル構成:
//   shop:         id, name（ショップマスター）
//   shop_product: id, shop_id（→ shop.id）, item_name（商品名）
//
//   shopを開いてrow0選択 → RelationsPanelにshop_product（1:N）のミニテーブルが表示される。
//   shop_productミニテーブルのセルをCtrl+Click → ペインスタックに新しいRPが追加される。
//   ←ボタンで戻る → viewIndex が 0 になる（インジケーターは "1 / 3"）
//   shopテーブルの別の行（row1）を選択する
//   → paneStack がルートにリセットされ、追加RP（paneStack[2]以降）が破棄されること
//   → ナビゲーションバーのインジケーターが "1 / 2" 以下になること
// =============================================================================

/**
 * ナビゲーション履歴リセットテスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   shop:         id, name（ショップマスター）
 *   shop_product: id, shop_id（→ shop.id）, item_name（商品名）
 *
 * shopのrow0（weapon_shop, id=1）を選択すると
 * RelationsPanelに 1:N として shop_product のミニEditorTable が表示される。
 * shopのrow1（item_shop, id=2）を選択すると
 * RelationsPanelに shop_id=2 のshop_productのみが表示される。
 */
function createNavigationResetTestFileSystem(): MockFileSystem {
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
// テストスイート: メインテーブルで別の行を選択したらナビゲーション履歴がリセットされること
// =============================================================================

test.describe('メインテーブルで別の行を選択したら、RelationsPanel のナビゲーション履歴がリセットされること', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createNavigationResetTestFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
	});

	// ---------------------------------------------------------------------------
	// テスト: 定義ジャンプ後に←で戻り、別の行を選択したらpaneStackがリセットされること
	//
	// 再現手順:
	//   1. shopテーブルを開く
	//   2. row0を選択 → RelationsPanelにshop_productミニテーブル表示
	//   3. shop_productミニテーブルのセルをCtrl+Click（定義ジャンプ）→ "2 / 3"
	//   4. ←ボタンをクリック → "1 / 3"（paneStackには3エントリが残っている）
	//   5. shopテーブルのrow1（別の行）をクリック
	//   → 期待: インジケーターのMが2以下になること（paneStack追加RPが破棄される）
	// ---------------------------------------------------------------------------
	test(
		'定義ジャンプ後に←で戻り、メインテーブルで別の行を選択したらpaneStackがリセットされること',
		async ({ page }) => {
			// 手順1: shopテーブルを開く
			const shopTable = await openTableAsync(page, 'shop');

			// 手順2: row0を選択 → RelationsPanelにshop_productミニテーブルが表示される
			await selectRowAsync(shopTable, 0);
			await waitForRelationsPanelContentAsync(page);

			// shop_productミニテーブルが右スロットに表示されるまで待機する
			const shopProductMiniTable = page.locator('.editor-right-slot .relations-panel .editor-table').first();
			await expect(shopProductMiniTable).toBeVisible();

			// 手順3: shop_productミニテーブルのvisibleなデータセルをCtrl+Click（定義ジャンプ）
			const visibleCell = page.locator(RIGHT_SLOT_MINI_TABLE_VISIBLE_CELL_SELECTOR).first();
			await expect(visibleCell).toBeVisible();
			await visibleCell.click({ modifiers: ['Control'] });

			// 定義ジャンプ成功を確認する（ペインスタックが3つになり "2 / 3" と表示される）
			await expect(page.locator('.editor-navigation-bar')).toBeVisible();
			await expect(page.locator('.editor-navigation-bar .nav-indicator')).toHaveText('2 / 3');

			// 手順4: ←ボタンをクリックして戻る
			await page.locator('.editor-navigation-bar .nav-left').click();

			// ←で戻った後のインジケーターが "1 / 3" であることを確認する
			// （paneStackは3エントリのまま: EditorTable + RP1 + RP2）
			await expect(page.locator('.editor-navigation-bar .nav-indicator')).toHaveText('1 / 3');

			// 手順5: shopテーブルのrow1（id=2, item_shop）を選択する（別の行）
			// editor-left-slot 内の EditorTable はアクティブなshopテーブル
			const shopTableAfterNav = page.locator('.editor-left-slot .editor-table:visible').first();
			await selectRowAsync(shopTableAfterNav, 1);

			// =================================================================
			// アサーション: paneStack がリセットされていること
			//
			// 現在の実装（バグあり）では updateForRow() が paneStack[1] のコンテンツのみ
			// 更新し、paneStack[2] 以降の追加RPは残ったまま。
			// → ナビゲーションバーのインジケーターは "1 / 3" のまま（Mが3）。
			//
			// 修正後は resetPaneStackToRoot() が呼ばれ追加RPが破棄されるため、
			// paneStackは2エントリ（EditorTable + RP1）になり、
			// ナビゲーションバーが非表示（または "1 / 2" 以下）になるはず。
			// =================================================================

			// paneStack がリセットされることで、ナビゲーションバーが非表示になること
			// （paneStackが2エントリ = ペインが2つ = ナビゲーションバー非表示）
			// または、少なくともインジケーターのMが3から2以下に減少すること
			await expect(page.locator('.editor-navigation-bar')).toBeHidden();
		},
	);

});
