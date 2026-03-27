import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// データ型別入力コントロール テスト
//
// 機能概要:
//   スキーマで定義された列の型（bool, int, float, double）に応じて、
//   セルの表示形式と入力方法を切り替える。
//
//   - bool型: チェックマークSVG表示、ダブルクリック/SpaceキーでTrue/Falseトグル
//   - int型: 数字・+・-以外の文字をkeydownでフィルタ、編集中の上下矢印でインクリメント/デクリメント
//   - float/double型: 数字・+・-・.・e・E以外をフィルタ、上下矢印で増減
//   - 数値型（int/float/double）: セルに .cell-numeric クラスで右寄せ表示
//   - FK参照列はドロップダウンが優先（型別コントロール不適用）
//   - すべてUndo/Redo対応（Commandパターン）
//
// REDテスト:
//   プロダクションコードに型別入力コントロールが未実装のため、すべてのテストが失敗する。
//   - .cell-bool-check / .cell-bool-uncheck クラスが存在しない
//   - .cell-numeric クラスが存在しない
//   - bool型トグルのCommandが存在しない
//   - 数値型の入力フィルタが未実装
//   - 数値型の上下矢印インクリメント/デクリメントが未実装
//
// テストケース一覧:
//   1. bool型セルがチェックマークで表示される
//   2. bool型セルをダブルクリックするとトグルされる
//   3. bool型セルでSpaceキーを押すとトグルされる
//   4. int型セルで文字入力がフィルタされる
//   5. int型セルで上矢印を押すと値がインクリメントされる
//   6. 数値型セルが右寄せで表示される
//   7. bool型トグルがCtrl+Zでundo可能
// =============================================================================

// =============================================================================
// フィクスチャ生成ヘルパー
// =============================================================================

/**
 * 型別入力テスト用のファイルシステムを生成する。
 *
 * テーブル構成:
 *   typed_test: id(int), name(string), active(bool), count(int), rate(float), score(double)
 *
 * 初期データ:
 *   1, TestA, true,  10, 1.5, 99.9
 *   2, TestB, false, 20, 2.5, 88.8
 */
function createTypedInputFileSystem(): MockFileSystem {
	return {
		"schema/typed_test.json": JSON.stringify({
			description: "型別入力テスト",
			primary_key: ["id"],
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
				{ key: 2, name: "active", type: "bool" },
				{ key: 3, name: "count", type: "int" },
				{ key: 4, name: "rate", type: "float" },
				{ key: 5, name: "score", type: "double" },
			],
		}),
		"data/typed_test.csv": [
			"id,name,active,count,rate,score",
			"1,TestA,true,10,1.5,99.9",
			"2,TestB,false,20,2.5,88.8",
		].join("\n"),
	};
}

/**
 * FK参照優先テスト用のファイルシステムを生成する。
 *
 * テーブル構成:
 *   category: id(int), name(string)
 *   fk_test: id(int), category_id(int, → category.id), flag(bool)
 *
 * category_id は FK参照を持つint型列。
 * FK参照が設定されている場合はドロップダウンが優先され、型別コントロール（.cell-numeric等）は適用されない。
 */
function createFkPriorityFileSystem(): MockFileSystem {
	return {
		"schema/category.json": JSON.stringify({
			primary_key: ["id"],
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
			],
		}),
		"data/category.csv": [
			"id,name",
			"1,melee",
			"2,ranged",
		].join("\n"),
		"schema/fk_test.json": JSON.stringify({
			primary_key: ["id"],
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "category_id", type: "int", reference: "category.id" },
				{ key: 2, name: "flag", type: "bool" },
			],
		}),
		"data/fk_test.csv": [
			"id,category_id,flag",
			"1,1,true",
			"2,2,false",
		].join("\n"),
	};
}

// =============================================================================
// テストヘルパー関数
// =============================================================================

/**
 * エクスプローラーからテーブルを開き、タブ名で絞り込んだ EditorTable の Locator を返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
	const explorer = page.locator('#explorer');
	await explorer.getByText(tableName, { exact: true }).click();
	const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
	await expect(table).toBeVisible();
	return table;
}

/**
 * 指定行・列のデータセルを返す
 * rowIndex: 0始まり（ヘッダー行を除く）, colIndex: 0始まり（行ヘッダーを除く）
 */
function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
	const row = table.locator('.editor-table-row').nth(rowIndex + 1);
	return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

/**
 * 指定行・列のデータセルをダブルクリックして新しい値を入力しEnterで確定する
 */
async function editCellAsync(table: Locator, page: Page, rowIndex: number, colIndex: number, newValue: string): Promise<void> {
	const cell = getDataCell(table, rowIndex, colIndex);
	await expect(cell).toBeVisible();
	await cell.dblclick();
	const editField = page.locator('.grid-textfield-active');
	await expect(editField).toBeVisible();
	await page.keyboard.press('Control+a');
	await page.keyboard.insertText(newValue);
	await page.keyboard.press('Enter');
}

/**
 * 指定セルをクリックして選択状態にする（シングルクリック）
 */
async function selectCellAsync(table: Locator, rowIndex: number, colIndex: number): Promise<void> {
	const cell = getDataCell(table, rowIndex, colIndex);
	await expect(cell).toBeVisible();
	await cell.click();
}

// =============================================================================
// テストケース1: bool型セルがチェックマークで表示される
// =============================================================================

test.describe('データ型別入力コントロール', () => {
	test.beforeEach(async ({ page }) => {
		await installMockApiAsync(page, createTypedInputFileSystem());
		await page.goto('/');
	});

	test('bool型セルがチェックマークで表示される', async ({ page }) => {
		const table = await openTableAsync(page, 'typed_test');

		// active列(colIndex=2): 1行目はtrue → .cell-bool-check SVGが表示される
		const trueCell = getDataCell(table, 0, 2);
		await expect(trueCell).toBeVisible();
		const checkMark = trueCell.locator('.cell-bool-check');
		await expect(checkMark).toBeVisible();

		// active列(colIndex=2): 2行目はfalse → .cell-bool-uncheck SVGが表示される
		const falseCell = getDataCell(table, 1, 2);
		await expect(falseCell).toBeVisible();
		const uncheckMark = falseCell.locator('.cell-bool-uncheck');
		await expect(uncheckMark).toBeVisible();
	});

	// =============================================================================
	// テストケース2: bool型セルをダブルクリックするとトグルされる
	// =============================================================================

	test('bool型セルをダブルクリックするとトグルされる', async ({ page }) => {
		const table = await openTableAsync(page, 'typed_test');

		// 1行目のactive列（初期値: true）をダブルクリック
		const cell = getDataCell(table, 0, 2);
		await expect(cell).toBeVisible();
		await cell.dblclick();

		// テキスト入力モードには入らず、値がfalseにトグルされる
		// GridTextFieldが表示されていないことを確認（bool型はインライン編集ではなくトグル）
		const editField = page.locator('.grid-textfield-active');
		await expect(editField).not.toBeVisible();

		// セルの表示が .cell-bool-uncheck に変わる
		await expect(cell.locator('.cell-bool-uncheck')).toBeVisible();
		await expect(cell.locator('.cell-bool-check')).not.toBeVisible();

		// もう一度ダブルクリックするとtrueに戻る
		await cell.dblclick();
		await expect(cell.locator('.cell-bool-check')).toBeVisible();
		await expect(cell.locator('.cell-bool-uncheck')).not.toBeVisible();
	});

	// =============================================================================
	// テストケース3: bool型セルでSpaceキーを押すとトグルされる
	// =============================================================================

	test('bool型セルでSpaceキーを押すとトグルされる', async ({ page }) => {
		const table = await openTableAsync(page, 'typed_test');

		// 1行目のactive列（初期値: true）をシングルクリックで選択
		await selectCellAsync(table, 0, 2);

		// Spaceキーを押す
		await page.keyboard.press('Space');

		// 値がfalseにトグルされる（.cell-bool-uncheck が表示される）
		const cell = getDataCell(table, 0, 2);
		await expect(cell.locator('.cell-bool-uncheck')).toBeVisible();
		await expect(cell.locator('.cell-bool-check')).not.toBeVisible();

		// テキスト入力モードには入らない
		const editField = page.locator('.grid-textfield-active');
		await expect(editField).not.toBeVisible();

		// もう一度Spaceキーを押すとtrueに戻る
		await page.keyboard.press('Space');
		await expect(cell.locator('.cell-bool-check')).toBeVisible();
	});

	// =============================================================================
	// テストケース4: int型セルで文字入力がフィルタされる
	// =============================================================================

	test('int型セルで文字入力がフィルタされる', async ({ page }) => {
		const table = await openTableAsync(page, 'typed_test');

		// count列(colIndex=3, int型)をダブルクリックして編集モードに入る
		const cell = getDataCell(table, 0, 3);
		await expect(cell).toBeVisible();
		await cell.dblclick();
		const editField = page.locator('.grid-textfield-active');
		await expect(editField).toBeVisible();

		// 既存値をクリアする
		await page.keyboard.press('Control+a');

		// 数字・+・- は入力可能
		await page.keyboard.press('1');
		await page.keyboard.press('2');
		await page.keyboard.press('3');

		// 入力値が "123" であることを確認
		await expect(editField).toHaveText('123');

		// アルファベットはフィルタされて入力されない
		await page.keyboard.press('a');
		await page.keyboard.press('b');
		await expect(editField).toHaveText('123');

		// 小数点もフィルタされる（intなので）
		await page.keyboard.press('.');
		await expect(editField).toHaveText('123');

		// +と-は入力可能
		await page.keyboard.press('Control+a');
		await page.keyboard.press('-');
		await page.keyboard.press('5');
		await expect(editField).toHaveText('-5');
	});

	// =============================================================================
	// テストケース5: int型セルで上矢印を押すと値がインクリメントされる
	// =============================================================================

	test('int型セルで上矢印を押すと値がインクリメントされる', async ({ page }) => {
		const table = await openTableAsync(page, 'typed_test');

		// count列(colIndex=3, int型, 初期値: 10)をダブルクリックして編集モードに入る
		const cell = getDataCell(table, 0, 3);
		await expect(cell).toBeVisible();
		await cell.dblclick();
		const editField = page.locator('.grid-textfield-active');
		await expect(editField).toBeVisible();

		// 上矢印でインクリメント: 10 → 11
		await page.keyboard.press('ArrowUp');
		await expect(editField).toHaveText('11');

		// もう一度上矢印: 11 → 12
		await page.keyboard.press('ArrowUp');
		await expect(editField).toHaveText('12');

		// 下矢印でデクリメント: 12 → 11
		await page.keyboard.press('ArrowDown');
		await expect(editField).toHaveText('11');

		// Enterで確定
		await page.keyboard.press('Enter');

		// セルの値が 11 になっていることを確認する
		await expect(cell).toContainText('11');
	});

	// =============================================================================
	// テストケース6: 数値型セルが右寄せで表示される
	// =============================================================================

	test('数値型セルが右寄せで表示される', async ({ page }) => {
		const table = await openTableAsync(page, 'typed_test');

		// id列(colIndex=0, int型): .cell-numeric クラスが付与される
		const idCell = getDataCell(table, 0, 0);
		await expect(idCell).toBeVisible();
		await expect(idCell).toHaveClass(/cell-numeric/);

		// count列(colIndex=3, int型): .cell-numeric クラスが付与される
		const countCell = getDataCell(table, 0, 3);
		await expect(countCell).toHaveClass(/cell-numeric/);

		// rate列(colIndex=4, float型): .cell-numeric クラスが付与される
		const rateCell = getDataCell(table, 0, 4);
		await expect(rateCell).toHaveClass(/cell-numeric/);

		// score列(colIndex=5, double型): .cell-numeric クラスが付与される
		const scoreCell = getDataCell(table, 0, 5);
		await expect(scoreCell).toHaveClass(/cell-numeric/);

		// name列(colIndex=1, string型): .cell-numeric クラスが付与されない
		const nameCell = getDataCell(table, 0, 1);
		await expect(nameCell).not.toHaveClass(/cell-numeric/);

		// active列(colIndex=2, bool型): .cell-numeric クラスが付与されない
		const activeCell = getDataCell(table, 0, 2);
		await expect(activeCell).not.toHaveClass(/cell-numeric/);
	});

	// =============================================================================
	// テストケース7: bool型トグルがCtrl+Zでundo可能
	// =============================================================================

	test('bool型トグルがCtrl+Zでundo可能', async ({ page }) => {
		const table = await openTableAsync(page, 'typed_test');

		// 1行目のactive列（初期値: true）
		const cell = getDataCell(table, 0, 2);
		await expect(cell).toBeVisible();

		// 初期状態を確認: true → .cell-bool-check が表示
		await expect(cell.locator('.cell-bool-check')).toBeVisible();

		// ダブルクリックでトグル: true → false
		await cell.dblclick();
		await expect(cell.locator('.cell-bool-uncheck')).toBeVisible();

		// Ctrl+Z で Undo: false → true に戻る
		await page.keyboard.press('Control+z');
		await expect(cell.locator('.cell-bool-check')).toBeVisible();
		await expect(cell.locator('.cell-bool-uncheck')).not.toBeVisible();

		// Ctrl+Y で Redo: true → false に再度トグル
		await page.keyboard.press('Control+y');
		await expect(cell.locator('.cell-bool-uncheck')).toBeVisible();
		await expect(cell.locator('.cell-bool-check')).not.toBeVisible();
	});
});

// =============================================================================
// FK参照が設定された列では型別コントロールが適用されないことの検証
// =============================================================================

test.describe('FK参照 > 型別コントロール優先', () => {
	test.beforeEach(async ({ page }) => {
		await installMockApiAsync(page, createFkPriorityFileSystem());
		await page.goto('/');
	});

	test('FK参照が設定されたint型列には .cell-numeric が付与されない', async ({ page }) => {
		const table = await openTableAsync(page, 'fk_test');

		// category_id列(colIndex=1): int型だがFK参照あり → .cell-numeric は付与されない
		const fkCell = getDataCell(table, 0, 1);
		await expect(fkCell).toBeVisible();
		await expect(fkCell).not.toHaveClass(/cell-numeric/);

		// id列(colIndex=0): int型でFK参照なし → .cell-numeric が付与される
		const idCell = getDataCell(table, 0, 0);
		await expect(idCell).toHaveClass(/cell-numeric/);
	});
});
