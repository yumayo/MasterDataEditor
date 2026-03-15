import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// FEAT_0025: 通常テーブルで空行がなくなったら自動的に空行を挿入する
//
// 問題:
//   左ペインの通常テーブル（メインEditorTable）でバッファ行（editor-table-empty-row）に
//   データを入力して確定すると、その行がストアに昇格（promoteBufferRowToStore）される。
//   昇格後、新しいバッファ行が補充されないため、末尾バッファ行が消える。
//   この状態ではさらなる新規データ入力はコンテキストメニュー経由でしかできない。
//
// 根本原因:
//   editor-table.ts の promoteBufferRowToStore() 末尾に
//   `if (this.isMiniTable) this.ensureTrailingBufferRow()` という条件分岐があり、
//   通常テーブルではバッファ行補充が行われない。
//   同様に、demoteStoreRowToBuffer() 末尾の normalizeTrailingBufferRows() 呼び出しも
//   `if (this.isMiniTable)` で制限されている。
//
// 修正方針:
//   promoteBufferRowToStore() と demoteStoreRowToBuffer() の isMiniTable ガードを除去し、
//   通常テーブルでも ensureTrailingBufferRow() / normalizeTrailingBufferRows() を呼ぶ。
//
// テーブル構成:
//   item: id, name（シンプルな単一テーブル）
//   初期データ: id=1, name=sword の1行。
//   バッファ行（editor-table-empty-row）が末尾に表示される（FEAT_0014で実装済み）。
// =============================================================================

/**
 * テスト用ファイルシステムを生成する。
 * item（アイテムマスター）のみを定義するシンプルな構成。
 */
function createFileSystem(): MockFileSystem {
	return {
		"schema/item.json": JSON.stringify({
			description: "アイテムマスター",
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
			],
			primary_key: "id",
		}),
		"data/item.csv": [
			"id,name",
			"1,sword",
		].join("\n"),
	};
}

/**
 * エクスプローラーからテーブルを開き、左ペインの通常EditorTable Locatorを返す。
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
 * 通常テーブルのバッファ行（editor-table-empty-row）の指定列セルにデータを入力して確定する。
 * ダブルクリックで編集モードに入り、テキストを入力して Enter で確定する。
 * Enter 確定で promoteBufferRowToStore が呼ばれる。
 *
 * @param page Playwright Page
 * @param table 通常EditorTable Locator
 * @param colIndex 入力する列インデックス（行ヘッダーを除く 0始まり）
 * @param value 入力するテキスト
 */
async function inputToBufferRowAsync(page: Page, table: Locator, colIndex: number, value: string): Promise<void> {
	// バッファ行（末尾の editor-table-empty-row）の指定列セルをダブルクリックする
	const bufferRow = table.locator('.editor-table-empty-row').first();
	await expect(bufferRow).toBeVisible();
	const targetCell = bufferRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
	await targetCell.dblclick();
	// 編集フィールドが表示されるまで待機する
	const editField = page.locator('.grid-textfield-active').first();
	await expect(editField).toBeVisible();
	await editField.selectText();
	await editField.type(value);
	// Enter で確定する（promoteBufferRowToStore が呼ばれる）
	await page.keyboard.press('Enter');
}

// =============================================================================
// テスト本体
// =============================================================================

test.describe('FEAT_0025: 通常テーブルのバッファ行昇格後に末尾バッファ行が補充されること', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
	});

	test(
		'テスト1: バッファ行昇格後に新しいバッファ行が末尾に追加されること',
		async ({ page }) => {
			// item テーブルを開く
			const table = await openTableAsync(page, 'item');

			// 昇格前の行数を確認する:
			// ヘッダー行(1) + データ行(1:sword) + バッファ行(1) = 3行
			// ※ 通常テーブルはバッファ行（editor-table-empty-row）を末尾に1行持つため、
			//   全行数ではなくデータ行のみカウントする（:not(.editor-table-empty-row) で除外）
			const dataRows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
			// 初期: ヘッダー(1) + データ(1:sword) = 2行（データ行のみ）
			await expect(dataRows).toHaveCount(2);

			// バッファ行の name 列（col=1）に "potion" を入力して確定する
			// item のカラム順: id(col=0), name(col=1)
			await inputToBufferRowAsync(page, table, 1, 'potion');

			// 【REDになるべき条件（現在の実装: promoteBufferRowToStore 後にバッファ行補充なし）】:
			//   isMiniTable ガードにより ensureTrailingBufferRow() が呼ばれないため、
			//   バッファ行昇格後の DOM には末尾バッファ行が消えている（蓄積バッファが減る）。
			//   修正前はバッファ行昇格後にも適切なバッファ行補充が行われる保証がない。
			//
			// 【GREENになる条件（修正後: isMiniTable ガード除去）】:
			//   promoteBufferRowToStore() 後に ensureTrailingBufferRow() が呼ばれ、
			//   バッファ行が1行以上末尾に補充される。
			//   ヘッダー行(1) + データ行(2:sword,potion) = 3行（データ行のみ）
			await expect(
				dataRows,
				'バッファ行昇格後: ヘッダー(1) + データ(2:sword,potion) = 3行（データ行のみ）',
			).toHaveCount(3);

			// バッファ行が正確に1行であることを確認する（蓄積なし・欠損なし）
			const bufferRows = table.locator('.editor-table-empty-row');
			await expect(
				bufferRows,
				'バッファ行が正確に1行であること（蓄積なし・欠損なし）',
			).toHaveCount(1);
		},
	);

	test(
		'テスト2: バッファ行への連続入力（2回）でも常にバッファ行が末尾に1行存在すること',
		async ({ page }) => {
			// item テーブルを開く
			const table = await openTableAsync(page, 'item');

			// データ行のみのカウント用 Locator（バッファ行を除外）
			const dataRows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
			// 初期: ヘッダー(1) + データ(1:sword) = 2行
			await expect(dataRows).toHaveCount(2);

			// 1回目: バッファ行の name 列に "potion" を入力して確定する
			await inputToBufferRowAsync(page, table, 1, 'potion');

			// 【1回目昇格後の検証】
			// 修正後: ヘッダー(1) + データ(2:sword,potion) = 3行
			await expect(
				dataRows,
				'1回目昇格後: ヘッダー(1) + データ(2:sword,potion) = 3行',
			).toHaveCount(3);

			// 2回目: 補充されたバッファ行の name 列に "elixir" を入力して確定する
			await inputToBufferRowAsync(page, table, 1, 'elixir');

			// 【2回目昇格後の検証】
			// 修正後: ヘッダー(1) + データ(3:sword,potion,elixir) = 4行
			await expect(
				dataRows,
				'2回目昇格後: ヘッダー(1) + データ(3:sword,potion,elixir) = 4行',
			).toHaveCount(4);

			// バッファ行が正確に1行であることを確認する（蓄積なし・欠損なし）
			const bufferRows = table.locator('.editor-table-empty-row');
			await expect(
				bufferRows,
				'2回昇格後もバッファ行が正確に1行であること（蓄積なし・欠損なし）',
			).toHaveCount(1);
		},
	);

	test(
		'テスト3: バッファ行昇格→Undo後もバッファ行が正しく1行存在すること',
		async ({ page }) => {
			// item テーブルを開く
			const table = await openTableAsync(page, 'item');

			// データ行のみのカウント用 Locator（バッファ行を除外）
			const dataRows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
			// 初期: ヘッダー(1) + データ(1:sword) = 2行
			await expect(dataRows).toHaveCount(2);

			// バッファ行の name 列に "potion" を入力して確定する
			await inputToBufferRowAsync(page, table, 1, 'potion');

			// 昇格後: ヘッダー(1) + データ(2:sword,potion) = 3行
			// ※ このアサーションがREDになる場合は修正前の状態で失敗するが、
			//   テスト3のREDはUndoの検証で発生させる
			await expect(dataRows).toHaveCount(3);

			// Ctrl+Z で Undo する（demoteStoreRowToBuffer が呼ばれる）
			// テーブルにフォーカスを移してから Undo を送信する
			const firstDataCell = table.locator(
				'.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell)',
			).first();
			await expect(firstDataCell).toBeVisible();
			await firstDataCell.click();
			await page.keyboard.press('Control+z');

			// 【REDになるべき条件（現在の実装: demoteStoreRowToBuffer 後に補充なし）】:
			//   isMiniTable ガードにより normalizeTrailingBufferRows() が呼ばれないため、
			//   Undo後のバッファ行状態が不定になる（蓄積または欠損）。
			//
			// 【GREENになる条件（修正後: isMiniTable ガード除去）】:
			//   demoteStoreRowToBuffer() 後に normalizeTrailingBufferRows() が呼ばれ、
			//   バッファ行が正規化（蓄積なし、1行以上末尾に存在）される。
			//   ヘッダー(1) + データ(1:sword) = 2行（データ行のみ）
			await expect(
				dataRows,
				'Undo後: ヘッダー(1) + データ(1:sword) = 2行（データ行のみ）',
			).toHaveCount(2);

			// バッファ行が存在することを確認する（蓄積なし・欠損なし）
			const bufferRows = table.locator('.editor-table-empty-row');
			await expect(
				bufferRows.first(),
				'Undo後もバッファ行が末尾に存在すること（蓄積なし）',
			).toBeVisible();
		},
	);

	test(
		'テスト4: コンテキストメニューで行削除後もバッファ行が末尾に1行存在すること',
		async ({ page }) => {
			// item テーブルを開く（id=1, name=sword の1行が存在する）
			const table = await openTableAsync(page, 'item');

			// 初期: ヘッダー(1) + データ(1:sword) = 2行（データ行のみ）
			const dataRows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
			await expect(dataRows).toHaveCount(2);

			// データ行（sword）の行ヘッダーを右クリックしてコンテキストメニューを開く
			// コーナーセルは .editor-table-corner-cell なので .editor-table-row-header の nth(0) がデータ行先頭
			const rowHeader = table.locator('.editor-table-row-header').nth(0);
			await rowHeader.click({ button: 'right' });

			// コンテキストメニューの「行を削除」をクリックする
			const menu = page.locator('.context-menu.visible');
			await expect(menu).toBeVisible();
			await menu.locator('.context-menu-item', { hasText: '行を削除' }).click();

			// 削除後: ヘッダー(1) + データ(0行) = 1行（データ行のみ）
			await expect(
				dataRows,
				'行削除後: ヘッダー(1) + データ(0行) = 1行（データ行のみ）',
			).toHaveCount(1);

			// バッファ行が正確に1行であることを確認する（蓄積なし・欠損なし）
			const bufferRows = table.locator('.editor-table-empty-row');
			await expect(
				bufferRows,
				'行削除後もバッファ行が正確に1行であること（蓄積なし・欠損なし）',
			).toHaveCount(1);
		},
	);
});
