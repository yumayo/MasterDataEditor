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
//   - bool型: チェックマークSVG表示、ダブルクリック/SpaceキーでTrue/Falseトグル、数字キー入力で数値テキスト入力
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
//   - bool型テキスト入力とトグルのCommandが存在しない
//   - 数値型の入力フィルタが未実装
//   - 数値型の上下矢印インクリメント/デクリメントが未実装
//
// テストケース一覧:
//   1. bool型セルがチェックマークで表示される
//   2. bool型セルをダブルクリックするとトグルされる
//   3. bool型セルでSpaceキーを押すとトグルされる
//   4. bool型セルで数字キーを押すと数値テキスト入力できる
//   5. int型セルで文字入力がフィルタされる
//   6. int型セルで上矢印を押すと値がインクリメントされる
//   7. 数値型セルが右寄せで表示される
//   8. bool型テキスト入力がCtrl+Zでundo可能
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
 *   1, TestA, 1,  10, 1.5, 99.9
 *   2, TestB, 0, 20, 2.5, 88.8
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
			"1,TestA,1,10,1.5,99.9",
			"2,TestB,0,20,2.5,88.8",
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
			"1,1,1",
			"2,2,0",
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
	const row = table.locator('.editor-table-row').nth(rowIndex);
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
		const editField = page.locator('.grid-textfield-active');
		await expect(editField).not.toBeVisible();

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
	// テストケース4: bool型セルで数字キーを押すと数値テキスト入力できる
	// =============================================================================

	test('bool型セルで数字キーを押すと数値テキスト入力できる', async ({ page }) => {
		const table = await openTableAsync(page, 'typed_test');
		const cell = getDataCell(table, 0, 2);
		await expect(cell.locator('.cell-bool-check')).toBeVisible();

		await selectCellAsync(table, 0, 2);
		await page.keyboard.press('0');
		const editField = page.locator('.grid-textfield-active');
		await expect(editField).toBeVisible();
		await expect(editField).toHaveText('0');

		// 数字以外は入力できない
		await page.keyboard.press('a');
		await expect(editField).toHaveText('0');

		await page.keyboard.press('Enter');
		await expect(cell.locator('.cell-bool-uncheck')).toBeVisible();
		await expect(cell.locator('.cell-bool-check')).not.toBeVisible();

		// 0以外の数字は true として確定される
		await selectCellAsync(table, 0, 2);
		await page.keyboard.press('2');
		await expect(editField).toBeVisible();
		await expect(editField).toHaveText('2');
		await page.keyboard.press('Enter');
		await expect(cell.locator('.cell-bool-check')).toBeVisible();
		await expect(cell.locator('.cell-bool-uncheck')).not.toBeVisible();
	});

	// =============================================================================
	// テストケース5: int型セルで文字入力がフィルタされる
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
	// テストケース6: int型セルで上矢印を押すと値がインクリメントされる
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
	// テストケース7: 数値型セルが右寄せで表示される
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
	// テストケース8: bool型テキスト入力がCtrl+Zでundo可能
	// =============================================================================

	test('bool型テキスト入力がCtrl+Zでundo可能', async ({ page }) => {
		const table = await openTableAsync(page, 'typed_test');

		// 1行目のactive列（初期値: true）
		const cell = getDataCell(table, 0, 2);
		await expect(cell).toBeVisible();

		// 初期状態を確認: true → .cell-bool-check が表示
		await expect(cell.locator('.cell-bool-check')).toBeVisible();

		// 数字キー入力で true → false
		await selectCellAsync(table, 0, 2);
		await page.keyboard.press('0');
		const editField = page.locator('.grid-textfield-active');
		await expect(editField).toBeVisible();
		await page.keyboard.press('Enter');
		await expect(cell.locator('.cell-bool-uncheck')).toBeVisible();

		// Ctrl+Z で Undo: false → true に戻る
		await page.keyboard.press('Control+z');
		await expect(cell.locator('.cell-bool-check')).toBeVisible();
		await expect(cell.locator('.cell-bool-uncheck')).not.toBeVisible();

		// Ctrl+Y で Redo: true → false に戻る
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

	test('FK参照が設定されたint型列にも .cell-numeric が付与される（ISSUE_0127: FK列の数値型右揃え対応）', async ({ page }) => {
		const table = await openTableAsync(page, 'fk_test');

		// category_id列(colIndex=1): int型かつFK参照あり → .cell-numeric が付与される（数値型は右揃え）
		const fkCell = getDataCell(table, 0, 1);
		await expect(fkCell).toBeVisible();
		await expect(fkCell).toHaveClass(/cell-numeric/);

		// id列(colIndex=0): int型でFK参照なし → .cell-numeric が付与される
		const idCell = getDataCell(table, 0, 0);
		await expect(idCell).toHaveClass(/cell-numeric/);
	});
});

// =============================================================================
// ISSUE_0127: FK列のint値を右揃えにしヒント句を値の左側に表示する
//
// 現在の問題:
//   - FK列のint型セルが左揃えのまま（.cell-numericクラスが削除されている）
//   - ヒント句（.cell-reference-hint）がFK値の右側に表示されている
//
// 期待する動作:
//   - FK列のint型セルにも .cell-numeric を付与して右揃えにする
//   - FK列のstring型セルは従来通り左揃えのまま
//   - ヒント句をFK値の左側に配置する（DOM順序またはCSS flexboxで）
//   - ヒント句が長い場合はellipsisで省略し、FK値の表示領域を侵食しない
//
// テストケース:
//   1. FK列のint型セルが右揃え（cell-numericクラスを持つ）
//   2. FK列のstring型セルは左揃えのまま（cell-numericクラスを持たない）
//   3. ヒント句がFK値の左側に表示される
//   4. ヒント句が長い場合にellipsisで省略される
// =============================================================================

/**
 * ISSUE_0127テスト用のファイルシステムを生成する。
 *
 * テーブル構成:
 *   region: id(int), ja(string)               — 地域マスタ（PK: int型）
 *   tag: code(string), ja(string)             — タグマスタ（PK: string型）
 *   product: id(int), region_id(int, → region.id), tag_code(string, → tag.code), price(int)
 *
 * 表示列は config.json の referenceDisplayColumnPriority: ["ja", "comment"] に従い "ja" を使用する。
 * "name" 列は優先度リストに含まれないため表示列として認識されない。
 *
 * product.region_id: int型FK列 → int型PK参照 → .cell-numeric が付与されるべき
 * product.tag_code: string型FK列 → string型PK参照 → .cell-numeric は付与されない
 *
 * 初期データ:
 *   region: 1=関東, 2=関西
 *   tag: A=武器, B=防具
 *   product: (1, 1, A, 100), (2, 2, B, 200)
 */
function createFkAlignmentFileSystem(): MockFileSystem {
	return {
		"schema/region.json": JSON.stringify({
			primary_key: ["id"],
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "ja", type: "string" },
			],
		}),
		"data/region.csv": [
			"id,ja",
			"1,関東",
			"2,関西",
		].join("\n"),
		"schema/tag.json": JSON.stringify({
			primary_key: ["code"],
			header: [
				{ key: 0, name: "code", type: "string" },
				{ key: 1, name: "ja", type: "string" },
			],
		}),
		"data/tag.csv": [
			"code,ja",
			"A,武器",
			"B,防具",
		].join("\n"),
		"schema/product.json": JSON.stringify({
			primary_key: ["id"],
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "region_id", type: "int", reference: "region.id" },
				{ key: 2, name: "tag_code", type: "string", reference: "tag.code" },
				{ key: 3, name: "price", type: "int" },
			],
		}),
		"data/product.csv": [
			"id,region_id,tag_code,price",
			"1,1,A,100",
			"2,2,B,200",
		].join("\n"),
	};
}

/**
 * ISSUE_0127: ヒント句の長いテスト名テスト用のファイルシステムを生成する。
 *
 * テーブル構成:
 *   long_name_master: id(int), ja(string)     — 名前が非常に長いマスタ
 *   long_ref: id(int), master_id(int, → long_name_master.id)
 *
 * 表示列は config.json の referenceDisplayColumnPriority: ["ja", "comment"] に従い "ja" を使用する。
 * long_name_master の ja 列が表示列として使われ、非常に長い文字列がヒント句になる。
 */
function createFkLongHintFileSystem(): MockFileSystem {
	return {
		"schema/long_name_master.json": JSON.stringify({
			primary_key: ["id"],
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "ja", type: "string" },
			],
		}),
		"data/long_name_master.csv": [
			"id,ja",
			"1,これは非常に長い名前のマスターデータエントリでありセル幅を大きく超過する想定です",
		].join("\n"),
		"schema/long_ref.json": JSON.stringify({
			primary_key: ["id"],
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "master_id", type: "int", reference: "long_name_master.id" },
			],
		}),
		"data/long_ref.csv": [
			"id,master_id",
			"1,1",
		].join("\n"),
	};
}

test.describe('ISSUE_0127: FK列の右揃えとヒント句配置', () => {
	test.describe('FK列の数値型右揃え', () => {
		test.beforeEach(async ({ page }) => {
			await installMockApiAsync(page, createFkAlignmentFileSystem());
			await page.goto('/');
		});

		// テストケース1: FK列のint型セルが右揃え（cell-numericクラスを持つ）
		test('FK参照が設定されたint型列に .cell-numeric が付与される', async ({ page }) => {
			const table = await openTableAsync(page, 'product');

			// region_id列(colIndex=1): int型かつFK参照あり → .cell-numeric が付与されるべき
			const fkIntCell = getDataCell(table, 0, 1);
			await expect(fkIntCell).toBeVisible();
			await expect(fkIntCell).toHaveClass(/cell-numeric/);

			// 2行目でも同様
			const fkIntCell2 = getDataCell(table, 1, 1);
			await expect(fkIntCell2).toHaveClass(/cell-numeric/);

			// price列(colIndex=3): int型でFK参照なし → 当然 .cell-numeric が付与される
			const priceCell = getDataCell(table, 0, 3);
			await expect(priceCell).toHaveClass(/cell-numeric/);
		});

		// テストケース2: FK列のstring型セルは左揃えのまま（cell-numericクラスを持たない）
		test('FK参照が設定されたstring型列には .cell-numeric が付与されない', async ({ page }) => {
			const table = await openTableAsync(page, 'product');

			// tag_code列(colIndex=2): string型かつFK参照あり → .cell-numeric は付与されない
			const fkStringCell = getDataCell(table, 0, 2);
			await expect(fkStringCell).toBeVisible();
			await expect(fkStringCell).not.toHaveClass(/cell-numeric/);

			// 2行目でも同様
			const fkStringCell2 = getDataCell(table, 1, 2);
			await expect(fkStringCell2).not.toHaveClass(/cell-numeric/);
		});
	});

	test.describe('ヒント句の配置', () => {
		test.beforeEach(async ({ page }) => {
			await installMockApiAsync(page, createFkAlignmentFileSystem());
			await page.goto('/');
		});

		// テストケース3: ヒント句がFK値の左側に表示される
		test('参照ヒントがFK値テキストの左側に配置される', async ({ page }) => {
			const table = await openTableAsync(page, 'product');

			// region_id列(colIndex=1): FK値 "1" に対して参照ヒント "関東" が表示される
			const fkCell = getDataCell(table, 0, 1);
			await expect(fkCell).toBeVisible();
			const hint = fkCell.locator('.cell-reference-hint');
			await expect(hint).toBeVisible();

			// ヒント句のboundingRectのleftがFK値テキストのleftより小さい（ヒント句が左側にある）
			const positions = await fkCell.evaluate((el) => {
				const hintEl = el.querySelector('.cell-reference-hint') as HTMLElement;
				if (!hintEl) return null;
				// テキストノード（FK値）の位置を取得する
				const range = document.createRange();
				for (const node of Array.from(el.childNodes)) {
					if (node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== '') {
						range.selectNodeContents(node);
						break;
					}
				}
				const textRect = range.getBoundingClientRect();
				const hintRect = hintEl.getBoundingClientRect();
				return { hintLeft: hintRect.left, textLeft: textRect.left };
			});

			expect(positions).not.toBeNull();
			// ヒント句のleft < FK値テキストのleft → ヒント句が左に配置されている
			expect(positions!.hintLeft).toBeLessThan(positions!.textLeft);
		});
	});

	test.describe('ヒント句のellipsis省略', () => {
		test.beforeEach(async ({ page }) => {
			await installMockApiAsync(page, createFkLongHintFileSystem());
			await page.goto('/');
		});

		// テストケース4: ヒント句が長い場合にellipsisで省略される
		test('長いヒント句がellipsisで省略されFK値の表示領域が侵食されない', async ({ page }) => {
			const table = await openTableAsync(page, 'long_ref');

			// master_id列(colIndex=1): FK値 "1" に対して長い参照ヒントが表示される
			const fkCell = getDataCell(table, 0, 1);
			await expect(fkCell).toBeVisible();
			const hint = fkCell.locator('.cell-reference-hint');
			await expect(hint).toBeVisible();

			// ヒント句にtext-overflow: ellipsisとoverflow: hiddenが適用されている
			const styles = await hint.evaluate((el) => {
				const computed = window.getComputedStyle(el);
				return {
					textOverflow: computed.textOverflow,
					overflow: computed.overflow,
					whiteSpace: computed.whiteSpace,
				};
			});
			expect(styles.textOverflow).toBe('ellipsis');
			expect(styles.overflow).toBe('hidden');
			// ellipsisが機能するにはwhite-spaceがnowrapである必要がある
			expect(styles.whiteSpace).toBe('nowrap');

			// ヒント句の描画幅がセル幅を超えていない（セル内に収まっている）
			const overflows = await fkCell.evaluate((el) => {
				const hintEl = el.querySelector('.cell-reference-hint') as HTMLElement;
				if (!hintEl) return null;
				const cellRect = el.getBoundingClientRect();
				const hintRect = hintEl.getBoundingClientRect();
				return {
					hintRight: hintRect.right,
					cellRight: cellRect.right,
				};
			});
			expect(overflows).not.toBeNull();
			// ヒント句の右端がセルの右端を超えていない
			expect(overflows!.hintRight).toBeLessThanOrEqual(overflows!.cellRight + 1); // 1pxの誤差許容
		});
	});
});
