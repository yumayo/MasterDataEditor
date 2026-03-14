import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// FEAT_0015: 列/行リサイズハンドルの当たり判定改善
//
// 改善内容:
//   列リサイズハンドル: right: 0; width: 5px
//                   → right: -4px; width: 8px（列境界の中央に配置）
//   行リサイズハンドル: bottom: 0; height: 5px
//                   → bottom: -4px; height: 8px（行境界の中央に配置）
//   ガイドライン初期位置: e.clientX 基準
//                   → headerCell.getBoundingClientRect().right 基準
//
// 期待効果:
//   ハンドルが列境界/行境界の中央にまたがって配置されることで、
//   境界線の左側（または上側）からでもドラッグ開始できる。
// =============================================================================

/**
 * テスト用ファイルシステム
 *
 * テーブル構成:
 *   item: id, name, value（シンプルな3列テーブル）
 *
 * 列リサイズハンドルのCSS配置と当たり判定を検証する。
 */
function createResizeHitboxFileSystem(): MockFileSystem {
	return {
		"schema/item.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
				{ key: 2, name: "value", type: "int" },
			],
			primary_key: "id",
		}),
		"data/item.csv": [
			"id,name,value",
			"1,sword,100",
			"2,shield,200",
			"3,staff,80",
		].join("\n"),
	};
}

/**
 * Explorerでテーブルを開き、アクティブなEditorTableを返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
	await page.locator('#explorer').getByText(tableName, { exact: true }).click();
	const table = page.locator(".tab-wrapper:not([style*='display: none']) .editor-table");
	await expect(table).toBeVisible();
	return table;
}

/**
 * 列インデックス（0始まり、コーナーセルを除く）の列ヘッダーセルを返す
 */
function getColumnHeader(table: Locator, colIndex: number): Locator {
	return table.locator('.editor-table-column-header-row .editor-table-column-header').nth(colIndex);
}

test.describe('FEAT_0015: リサイズハンドルの当たり判定改善', () => {
	test.beforeEach(async ({ page }) => {
		await installMockApiAsync(page, createResizeHitboxFileSystem());
		await page.goto('/');
	});

	// ---------------------------------------------------------------------------
	// テスト1: 列リサイズハンドルのCSSが列境界の中央に配置されていること
	// ---------------------------------------------------------------------------
	test(
		'列リサイズハンドルの right が -4px、width が 8px であること',
		async ({ page }) => {
			const table = await openTableAsync(page, 'item');
			// id列の列ヘッダー（0列目）にあるリサイズハンドルを取得
			const columnHeader = getColumnHeader(table, 0);
			const resizeHandle = columnHeader.locator('.column-resize-handle').first();
			await expect(resizeHandle).toBeAttached();

			// right が -4px であること（列境界を中央にまたいで配置）
			// 現状: right: 0（列内部に閉じている）→ 改善後: right: -4px（境界にまたがる）
			await expect(resizeHandle).toHaveCSS('right', '-4px');

			// width が 8px であること（現状: 5px → 改善後: 8px）
			await expect(resizeHandle).toHaveCSS('width', '8px');
		},
	);

	// ---------------------------------------------------------------------------
	// テスト2: 行リサイズハンドルのCSSが行境界の中央に配置されていること
	// ---------------------------------------------------------------------------
	test(
		'行リサイズハンドルの bottom が -4px、height が 8px であること',
		async ({ page }) => {
			const table = await openTableAsync(page, 'item');
			// 0行目の行ヘッダーにあるリサイズハンドルを取得
			const rowHeader = table.locator('.editor-table-row-header').first();
			const resizeHandle = rowHeader.locator('.row-resize-handle').first();
			await expect(resizeHandle).toBeAttached();

			// bottom が -4px であること（行境界を中央にまたいで配置）
			// 現状: bottom: 0（行内部に閉じている）→ 改善後: bottom: -4px（境界にまたがる）
			await expect(resizeHandle).toHaveCSS('bottom', '-4px');

			// height が 8px であること（現状: 5px → 改善後: 8px）
			await expect(resizeHandle).toHaveCSS('height', '8px');
		},
	);

	// ---------------------------------------------------------------------------
	// テスト3: 列境界線の外側（隣の列の上）からリサイズ開始できること
	//
	// 現状（right: 0, width: 5px）:
	//   ハンドルは列内部のみ（右端から内側 5px）。
	//   列右端より 2px 外側（隣の列の上）ではハンドルに当たらないためリサイズ不可。
	//
	// 改善後（right: -4px, width: 8px）:
	//   ハンドルは列境界を中央にまたがる（内側 4px + 外側 4px）。
	//   列右端より 2px 外側もハンドル内に入り、リサイズ可能になる。
	// ---------------------------------------------------------------------------
	test(
		'列ヘッダーの右端より 2px 外側（隣の列の上）でドラッグしても列幅が変化すること',
		async ({ page }) => {
			const table = await openTableAsync(page, 'item');
			// 0列目（id列）のリサイズを1列目（name列）との境界外側から開始する
			const columnHeader = getColumnHeader(table, 0);
			await expect(columnHeader).toBeVisible();

			// リサイズ前の列幅を取得
			const widthBefore = await columnHeader.evaluate(
				(el: Element) => (el as HTMLElement).style.width,
			);

			// 列ヘッダーの boundingBox を取得
			const headerBox = await columnHeader.boundingBox();
			if (!headerBox) throw new Error('列ヘッダーの boundingBox が取得できません');

			// 列右端より 2px 外側（1列目と2列目の境界から隣の列領域に入った位置）でmousedown
			// 改善前（right: 0, width: 5px）: この位置はハンドル外なのでリサイズ開始しない
			// 改善後（right: -4px, width: 8px）: この位置はハンドル内なのでリサイズ開始する
			const startX = headerBox.x + headerBox.width + 2;
			const startY = headerBox.y + headerBox.height / 2;

			await page.mouse.move(startX, startY);
			await page.mouse.down();
			await page.mouse.move(startX + 60, startY);
			await page.mouse.up();

			const widthAfter = await columnHeader.evaluate(
				(el: Element) => (el as HTMLElement).style.width,
			);

			// 改善後はハンドルに当たるため列幅が変化する
			// 改善前はハンドルに当たらないためリサイズが起動せず列幅は変化しない（REDになる）
			expect(widthAfter).not.toBe(widthBefore);
		},
	);

	// ---------------------------------------------------------------------------
	// テスト4: ガイドラインの初期位置が列の右端（境界）を基準にすること
	// ---------------------------------------------------------------------------
	test(
		'列リサイズ中のガイドライン初期位置が列ヘッダーの右端を基準にすること',
		async ({ page }) => {
			const table = await openTableAsync(page, 'item');
			const columnHeader = getColumnHeader(table, 0);
			await expect(columnHeader).toBeVisible();

			const headerBox = await columnHeader.boundingBox();
			if (!headerBox) throw new Error('列ヘッダーの boundingBox が取得できません');

			// 列右端より 3px 内側でmousedownし、ガイドラインの left 位置を確認する
			// 改善前: ガイドライン.left = e.clientX - editorRect.left（マウス位置基準）
			//   → 列右端から 3px 手前の位置にガイドラインが表示される
			// 改善後: ガイドライン.left = headerCell.getBoundingClientRect().right - editorRect.left（境界基準）
			//   → 列右端にガイドラインが表示される
			const editorElement = page.locator('.editor-left-pane .editor-table').first();
			const editorBox = await editorElement.boundingBox();
			if (!editorBox) throw new Error('EditorTable の boundingBox が取得できません');

			// マウス位置: 列右端から 3px 内側
			const mouseX = headerBox.x + headerBox.width - 3;
			const mouseY = headerBox.y + headerBox.height / 2;

			await page.mouse.move(mouseX, mouseY);
			await page.mouse.down();

			// ガイドライン要素の left プロパティを取得（スクロールオフセット無視の簡易確認）
			const guidelineLeft = await page.locator('.resize-guideline').evaluate(
				(el: Element) => (el as HTMLElement).style.left,
			);

			// ガイドラインが表示されていること（display: block）
			await expect(page.locator('.resize-guideline')).toHaveCSS('display', 'block');

			// 改善後は境界（列右端）基準なのでガイドラインの left が headerBox.right - editorBox.left に近い値になる
			// 改善前は e.clientX 基準なのでマウス位置（列右端 - 3px）基準になる
			// editorElement.scrollLeft = 0 を仮定（初期表示でスクロールしていない）
			const expectedLeftFromBoundary = headerBox.x + headerBox.width - editorBox.x;
			// マウス位置基準の場合は 3px 手前（列右端 - 3px - editorLeft）
			const expectedLeftFromMouse = headerBox.x + headerBox.width - 3 - editorBox.x;
			const actualLeft = parseFloat(guidelineLeft);

			// 改善後の期待値: 境界基準（列右端）なので expectedLeftFromBoundary と一致する（許容 ±1px）
			// 改善前の期待値: マウス位置基準なので expectedLeftFromMouse と一致する（許容 ±1px）
			// このアサーションは改善前には失敗する（actualLeft が expectedLeftFromBoundary と 3px 以上ずれる）
			expect(actualLeft).toBeGreaterThanOrEqual(expectedLeftFromBoundary - 1);
			expect(actualLeft).toBeLessThanOrEqual(expectedLeftFromBoundary + 1);
			// 改善前のマウス位置基準との差が 2px 以上あることも確認する（REDの根拠）
			expect(Math.abs(actualLeft - expectedLeftFromMouse)).toBeGreaterThan(1);

			// クリーンアップ
			await page.mouse.up();
		},
	);
});
