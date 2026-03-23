import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// FEAT_0022: ミニテーブルは常にバッファ行を末尾に表示すること
//
// 問題:
//   RelationsPanelの1:Nミニテーブルでバッファ行（editor-table-empty-row）にデータを
//   入力して確定すると、その行がストアに昇格（promoteBufferRowToStore）される。
//   昇格後、新しいバッファ行が補充されないため、末尾バッファ行が消える。
//   この状態ではさらなる新規データ入力はコンテキストメニュー経由でしかできない。
//
// 根本原因:
//   editor-table.ts の promoteBufferRowToStore() が完了した後、
//   ensureTrailingBufferRow() を呼んで末尾バッファ行を補充する処理が存在しない。
//   同様に、Undo時の demoteStoreRowToBuffer() 完了後も補充処理がない。
//
// 修正方針:
//   editor-table.ts に ensureTrailingBufferRow() メソッドを追加し、
//   promoteBufferRowToStore() と demoteStoreRowToBuffer() の完了後に呼ぶ。
//   既にバッファ行が存在する場合は何もしない（蓄積防止）。
//
// テーブル構成:
//   quest: id, name（親テーブル）
//   quest_reward: id, quest_id, item_name（子テーブル。quest.id を FK として参照）
//
//   quest id=1 を選択すると quest_reward に quest_id=1 の行（sword 1件）が表示される。
//   バッファ行（editor-table-empty-row）が1行存在する（FEAT_0014で実装済み）。
// =============================================================================

/**
 * テスト用ファイルシステムを生成する。
 * quest（親テーブル）と quest_reward（子テーブル。quest.id を FK で参照）を定義する。
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
 * エクスプローラーからテーブルを開き、左ペインのEditorTable Locatorを返す。
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

/**
 * ミニテーブルのバッファ行（editor-table-empty-row）にデータを入力して確定する。
 * バッファ行の item_name 列（col=2、行ヘッダーを除く非ヘッダーセルの3番目）をダブルクリックし、
 * テキストを入力して Enter で確定する（promoteBufferRowToStore が呼ばれる）。
 *
 * @param page Playwright Page
 * @param miniTable ミニEditorTable Locator
 * @param value 入力するテキスト
 */
async function inputToBufferRowAsync(page: Page, miniTable: Locator, value: string): Promise<void> {
	// バッファ行の item_name セル（列ヘッダーでも行ヘッダーでもないセルの3番目）をダブルクリックする
	// quest_reward のカラム順: id(col=0), quest_id(col=1), item_name(col=2)
	const bufferRow = miniTable.locator('.editor-table-empty-row').first();
	await expect(bufferRow).toBeVisible();
	const itemNameCell = bufferRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(2);
	await itemNameCell.dblclick();
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

test.describe('FEAT_0022: ミニテーブルのバッファ行昇格後に末尾バッファ行が補充されること', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
		await enableRelationsPanelAsync(page);
	});

	test(
		'テスト1: バッファ行昇格後に新しいバッファ行が末尾に追加されること',
		async ({ page }) => {
			// quest テーブルを開く（id=1 が初期選択 → quest_reward に sword が1件表示）
			await openTableAsync(page, 'quest');
			await waitForRelationsPanelContentAsync(page);

			const miniTable = await getMiniTableSectionAsync(page, 'quest_reward');

			// 昇格前: ヘッダー行(1) + データ行(1:sword) + バッファ行(1) = 3行
			// ※ FEAT_0014 で emptyRowCount=1 が実装済みのため初期バッファ行は存在する
			const allRows = miniTable.locator('.editor-table-row');
			await expect(allRows).toHaveCount(3);

			// バッファ行にデータを入力して確定する（promoteBufferRowToStore が呼ばれる）
			await inputToBufferRowAsync(page, miniTable, 'potion');

			// 【REDになるべき条件（現在の実装: 昇格後に新バッファ行が補充されない）】:
			//   昇格後、editor-table-empty-row が消えて末尾にバッファ行がない状態になる。
			//   ヘッダー行(1) + データ行(2:sword,potion) = 2行のみになる。
			//   toHaveCount(4) が失敗してREDになる。
			//
			// 【GREENになる条件（修正後: ensureTrailingBufferRow() が呼ばれる）】:
			//   昇格後に新しいバッファ行が1行補充される。
			//   ヘッダー行(1) + データ行(2:sword,potion) + バッファ行(1) = 4行が表示される。
			await expect(
				allRows,
				'バッファ行昇格後に末尾に新しいバッファ行（editor-table-empty-row）が補充されること',
			).toHaveCount(4);

			// 末尾行が editor-table-empty-row クラスを持つことを確認する
			const lastRow = allRows.last();
			await expect(
				lastRow,
				'末尾行が editor-table-empty-row クラスを持つこと（蓄積防止のため1行のみ）',
			).toHaveClass(/editor-table-empty-row/);
		},
	);

	test(
		'テスト2: バッファ行への連続入力（2回）でも常にバッファ行が末尾に存在すること',
		async ({ page }) => {
			// quest テーブルを開く（id=1 が初期選択 → quest_reward に sword が1件表示）
			await openTableAsync(page, 'quest');
			await waitForRelationsPanelContentAsync(page);

			const miniTable = await getMiniTableSectionAsync(page, 'quest_reward');
			const allRows = miniTable.locator('.editor-table-row');

			// 昇格前: ヘッダー行(1) + データ行(1:sword) + バッファ行(1) = 3行
			await expect(allRows).toHaveCount(3);

			// 1回目の入力確定（バッファ行 → データ行に昇格）
			await inputToBufferRowAsync(page, miniTable, 'potion');

			// 【1回目昇格後のバッファ行検証】
			// 現在の実装では昇格後にバッファ行が補充されないため toHaveCount(4) が失敗してREDになる。
			// 修正後はバッファ行が補充されて4行になる。
			await expect(
				allRows,
				'1回目昇格後: ヘッダー(1) + データ(2:sword,potion) + バッファ(1) = 4行',
			).toHaveCount(4);

			// 2回目の入力確定（補充されたバッファ行 → データ行に昇格）
			await inputToBufferRowAsync(page, miniTable, 'elixir');

			// 【2回目昇格後のバッファ行検証】
			// 修正後はさらにバッファ行が補充されて5行になる。
			// 現在の実装では2回目昇格後もバッファ行がないため toHaveCount(5) が失敗してREDになる。
			await expect(
				allRows,
				'2回目昇格後: ヘッダー(1) + データ(3:sword,potion,elixir) + バッファ(1) = 5行',
			).toHaveCount(5);

			// 末尾行が editor-table-empty-row クラスを持つことを確認する（蓄積防止: 1行のみ）
			const bufferRows = miniTable.locator('.editor-table-empty-row');
			await expect(
				bufferRows,
				'バッファ行が蓄積せず末尾に1行のみ存在すること',
			).toHaveCount(1);
		},
	);

	test(
		'テスト3: バッファ行昇格→Undo後もバッファ行が正しく1行存在すること（蓄積しないこと）',
		async ({ page }) => {
			// quest テーブルを開く（id=1 が初期選択 → quest_reward に sword が1件表示）
			await openTableAsync(page, 'quest');
			await waitForRelationsPanelContentAsync(page);

			const miniTable = await getMiniTableSectionAsync(page, 'quest_reward');
			const allRows = miniTable.locator('.editor-table-row');

			// 昇格前: ヘッダー行(1) + データ行(1:sword) + バッファ行(1) = 3行
			await expect(allRows).toHaveCount(3);

			// バッファ行にデータを入力して確定する（promoteBufferRowToStore が呼ばれる）
			await inputToBufferRowAsync(page, miniTable, 'potion');

			// 昇格後: 修正後はバッファ行が補充されて4行になる
			// ただしこのテストのREDはUndoの検証で発生させる（Undo後バッファ行が消える問題）
			await expect(allRows).toHaveCount(4);

			// Undo する（demoteStoreRowToBuffer が呼ばれる）
			// フォーカスをミニテーブルに置く（ミニテーブルの History に Undo が届くようにする）
			const firstDataCell = miniTable.locator(
				'.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell)'
			).first();
			await expect(firstDataCell).toBeVisible();
			await firstDataCell.click();
			await page.keyboard.press('Control+z');

			// Undo後: sword のみが残りバッファ行が1行存在する
			// ヘッダー行(1) + データ行(1:sword) + バッファ行(1) = 3行
			//
			// 【REDになるべき条件（現在の実装: demoteStoreRowToBuffer 後に補充されない）】:
			//   Undo で potion が降格されてバッファ行に戻るが、初期バッファ行は初期化時の1行のみ。
			//   降格でバッファ行が増えて蓄積するのか、それとも初期バッファ行に戻るのかによって
			//   3行になるか4行になるか（不確定な挙動）。
			//   修正後は demoteStoreRowToBuffer 後に ensureTrailingBufferRow() が呼ばれて
			//   バッファ行が正確に1行になる（蓄積しない）。
			//
			// 【GREENになる条件（修正後）】:
			//   Undo 後に末尾バッファ行が1行だけ存在する。
			//   ヘッダー行(1) + データ行(1:sword) + バッファ行(1) = 3行が表示される。
			await expect(
				allRows,
				'Undo後: ヘッダー(1) + データ(1:sword) + バッファ(1) = 3行（蓄積なし）',
			).toHaveCount(3);

			// バッファ行が蓄積していないことを確認する（1行のみ）
			const bufferRows = miniTable.locator('.editor-table-empty-row');
			await expect(
				bufferRows,
				'Undo後のバッファ行が蓄積せず1行のみ存在すること',
			).toHaveCount(1);
		},
	);
});
