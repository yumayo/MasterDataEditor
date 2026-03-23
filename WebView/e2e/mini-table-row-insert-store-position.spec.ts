import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem, readMockFileAsync } from './fixtures/mock-api';
import { expectCsvAsync, enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// ミニテーブル行追加時のストア挿入位置バグ検証
//
// 根本原因:
//   editor-table-structure.ts の insertRowInternal() が
//   `storeRowIndex = rowIndex - 1`（DOMデータ行インデックス）で
//   store.insertRowAt() を呼んでいる。
//
//   通常テーブルでは storeRowIndices[i] = i なので問題ないが、
//   ミニテーブルでは storeRowIndices がフィルタされたサブセット（例: [1, 2]）。
//   ミニテーブルの最終行（ストアインデックス=2）の下に行追加する場合、
//   storeRowIndex = 3（DOMデータ行インデックス=3-1=2 ではなく）に挿入すべきだが、
//   バグによりストアインデックス=2（DOMの行インデックスそのまま）に挿入してしまう。
//   これはストア上の既存行（blizzard等）を上書き・ずらすことになる。
//
// テーブル構成:
//   enemy: id, ja（親テーブル）
//   skill: id, enemy_id, name（子テーブル。enemy.id をFKとして参照）
//
//   skillデータ:
//     [0] id=1, enemy_id=1, name=slash      ← enemy id=1 の行
//     [1] id=2, enemy_id=2, name=thunder     ← enemy id=2 の行（ストアインデックス=1）
//     [2] id=3, enemy_id=2, name=blizzard    ← enemy id=2 の行（ストアインデックス=2）
//
//   enemy row1（id=2, ドラゴン）を選択すると、ミニテーブルに
//   thunder（ストアインデックス=1）, blizzard（ストアインデックス=2）の2行が表示される。
//
//   ミニテーブルの最終行（blizzard）の下に行を挿入すると：
//   - 正しい動作: ストアインデックス=3 に空行が挿入される
//                 CSV: slash, thunder, blizzard, [空行], ... と blizzard の直後に入る
//   - バグの動作: ストアインデックス=2 に空行が挿入されてしまい、
//                 blizzard がインデックス=3 にずれる（もしくは blizzard を上書き）
//
// バグ2:
//   deleteRow（Undo時に呼ばれる）が store.removeRow() を呼んでいない。
//   insertRowInternal がストアに空行を挿入するのに、
//   deleteRowInternal はストアから行を削除しない非対称な実装になっている。
//   Undo後もストアに挿入した空行が残り続ける。
// =============================================================================

/**
 * テスト用ファイルシステムを生成する。
 *
 * enemy(id=2, ドラゴン)の行を選択したとき、RelationsPanelに
 * skill テーブルの enemy_id=2 の行（thunder, blizzard）が1:Nミニテーブルで表示される。
 * ミニテーブルのstoreRowIndicesは [1, 2]（skillのストア全体から enemy_id=2 の行だけ）。
 * この状態でミニテーブルの最終行（blizzard, ストアインデックス=2）の下に行追加すると
 * 挿入位置バグが再現する。
 */
function createMiniTableRowInsertFileSystem(): MockFileSystem {
	return {
		"schema/enemy.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "ja", type: "string" },
			],
			primary_key: ["id"],
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
			primary_key: ["id"],
		}),
		// ストアインデックス:
		//   [0] id=1, enemy_id=1, name=slash    → enemy id=1 の行
		//   [1] id=2, enemy_id=2, name=thunder   → enemy id=2 の行
		//   [2] id=3, enemy_id=2, name=blizzard  → enemy id=2 の行
		"data/skill.csv": [
			"id,enemy_id,name",
			"1,1,slash",
			"2,2,thunder",
			"3,2,blizzard",
		].join("\n"),
	};
}

/**
 * エクスプローラーからテーブルを開き、左ペインのアクティブな EditorTable Locator を返す。
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
 * 指定した行ヘッダーをクリックして行を選択する。
 * rowIndex: 0始まり（ヘッダー行を除く）
 */
async function selectRowAsync(table: Locator, rowIndex: number): Promise<void> {
	const header = table.locator('.editor-table-row-header').nth(rowIndex);
	await header.click();
}

/**
 * リレーションパネルのコンテンツが表示されるまで待機する。
 */
async function waitForRelationsPanelContentAsync(page: Page): Promise<void> {
	await expect(page.locator('.relations-panel-content')).toBeVisible();
}

/**
 * RelationsPanelの指定テーブルセクションにあるミニEditorTable Locatorを返す。
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
 * ミニテーブルの行ヘッダーを右クリックしてコンテキストメニューを開く。
 * rowIndex: 0始まり（ヘッダー行を除く）
 */
async function rightClickMiniTableRowHeaderAsync(miniTable: Locator, rowIndex: number): Promise<void> {
	// ミニテーブルのデータ行ヘッダー: nth(0) がデータ行1（ヘッダー行の行ヘッダーは存在しない）
	const header = miniTable.locator('.editor-table-row-header').nth(rowIndex);
	await header.click({ button: 'right' });
}

/**
 * コンテキストメニューの項目をクリックする。
 */
async function clickContextMenuItemAsync(page: Page, label: string): Promise<void> {
	const menu = page.locator('.context-menu.visible');
	await expect(menu).toBeVisible();
	await menu.locator('.context-menu-item', { hasText: label }).click();
}

// =============================================================================
// テスト本体
// =============================================================================

test.describe('ミニテーブル行追加時のストア挿入位置バグ', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createMiniTableRowInsertFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
		await enableRelationsPanelAsync(page);
	});

	test(
		'テスト1: ミニテーブルの最終行の下に行追加後、保存するとCSVのストア上の正しい位置に空行が挿入されること',
		async ({ page }) => {
			// enemy テーブルを開く
			const enemyTable = await openTableAsync(page, 'enemy');

			// enemy の2行目（id=2, ドラゴン）を選択する
			// → RelationsPanelに skill の1:N ミニテーブルが表示される（thunder, blizzard の2行）
			await selectRowAsync(enemyTable, 1);
			await waitForRelationsPanelContentAsync(page);

			// skill ミニテーブルが表示されるまで待機する
			// ヘッダー行(1) + データ行(2) + バッファ行(1) = 4行
			const miniTable = await getMiniTableSectionAsync(page, 'skill');
			const allRows = miniTable.locator('.editor-table-row');
			await expect(allRows).toHaveCount(4);

			// ミニテーブルの最終行（2行目、blizzard、ストアインデックス=2）の下に行を挿入する
			// rowIndex=1（0始まり）はミニテーブル内でのデータ行2番目（blizzard）に相当する
			await rightClickMiniTableRowHeaderAsync(miniTable, 1);
			await clickContextMenuItemAsync(page, '下に行を挿入');

			// 行が追加されてミニテーブルに3データ行が表示されることを確認する
			// ヘッダー行(1) + データ行(3) + バッファ行(1) = 5行
			await expect(allRows).toHaveCount(5);

			// エクスプローラーから skill テーブルをタブとして開いて Ctrl+S で保存する
			// ミニテーブルの Ctrl+S は isMiniTableInstance() で拒否されるため、
			// タブ経由で保存する（ストアは共有されているため編集内容が反映される）
			const skillTable = await openTableAsync(page, 'skill');
			await skillTable.click();
			await page.keyboard.press('Control+s');
			// 保存処理は fire-and-forget の非同期処理のため完了を待機する
			await page.waitForTimeout(500);

			// 保存された CSV を検証する。
			//
			// 期待するCSV（正しい動作）:
			//   id,enemy_id,name
			//   1,1,slash         ← ストアインデックス=0（enemy id=1の行。変化しない）
			//   2,2,thunder       ← ストアインデックス=1（enemy id=2の行。変化しない）
			//   3,2,blizzard      ← ストアインデックス=2（enemy id=2の行。変化しない）
			//   ,2,               ← ストアインデックス=3（blizzardの直後に挿入）
			//                        autoFillEntries により enemy_id=2 が自動設定される
			//
			// バグの動作:
			//   挿入位置が storeRowIndex=1（ミニテーブルの storeRowIndices=[0,1] を使って
			//   domDataRowIndex=2 < indices.length=2 が false → indices[1]+1=2 ではなく
			//   旧バグ: rowIndex-1=2 を直接使うと storeRowIndex=2 になり thunder の前に挿入）
			//   → 結果として thunder の前に空行が入り、thunder/blizzard がずれる
			//
			// バグがある場合: 空行が thunder の前（ストアインデックス=1）に入り、
			//   thunder/blizzard が1つ後ろにずれる
			//   → expectCsvAsync でline[2]が thunderでなく空行のため失敗してRED
			await expectCsvAsync(page, 'data/skill.csv', `
				id,   enemy_id, name
				1,    1,        slash
				2,    2,        thunder
				3,    2,        blizzard
				,     2,
			`);
		},
	);

	test(
		'テスト2: ミニテーブルで行追加後に Undo すると、ストアからも挿入行が削除されること',
		async ({ page }) => {
			// enemy テーブルを開く
			const enemyTable = await openTableAsync(page, 'enemy');

			// enemy の2行目（id=2, ドラゴン）を選択する
			await selectRowAsync(enemyTable, 1);
			await waitForRelationsPanelContentAsync(page);

			// skill ミニテーブルが表示されるまで待機する
			// ヘッダー行(1) + データ行(2) + バッファ行(1) = 4行
			const miniTable = await getMiniTableSectionAsync(page, 'skill');
			const allRows = miniTable.locator('.editor-table-row');
			await expect(allRows).toHaveCount(4);

			// ミニテーブルの最終行（blizzard）の下に行を挿入する
			await rightClickMiniTableRowHeaderAsync(miniTable, 1);
			await clickContextMenuItemAsync(page, '下に行を挿入');

			// 行が追加されてミニテーブルに3データ行が表示されることを確認する
			await expect(allRows).toHaveCount(5);

			// ミニテーブルのセルをクリックしてフォーカスを確保してから Ctrl+Z で Undo する
			// フォーカスがミニテーブルにないと、メインテーブルの History に Undo が届く
			const firstDataCell = miniTable.locator(
				'.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell)'
			).first();
			await expect(firstDataCell).toBeVisible();
			await firstDataCell.click();

			await page.keyboard.press('Control+z');

			// Undo 後にミニテーブルの行数が元の2行に戻ることを確認する
			// ヘッダー行(1) + データ行(2) + バッファ行(1) = 4行
			await expect(allRows).toHaveCount(4);

			// エクスプローラーから skill テーブルをタブとして開いて Ctrl+S で保存する
			const skillTable = await openTableAsync(page, 'skill');
			await skillTable.click();
			await page.keyboard.press('Control+s');
			// 保存処理は fire-and-forget の非同期処理のため完了を待機する
			await page.waitForTimeout(500);

			// 保存されたCSVを検証する。
			//
			// 期待するCSV（正しいUndo動作）:
			//   id,enemy_id,name
			//   1,1,slash
			//   2,2,thunder
			//   3,2,blizzard
			//   ← 空行が消えてストアが元の3行に戻る
			//
			// バグの動作（deleteRow が store.removeRow() を呼ばないため）:
			//   Undo でDOMからは行が削除されるが、ストアには挿入した空行が残り続ける。
			//   保存時にストアの4行が全てCSVに書き出されて空行が残る。
			//   → 期待する3行と一致しないため expectCsvAsync が失敗してRED
			await expectCsvAsync(page, 'data/skill.csv', `
				id, enemy_id, name
				1,  1,        slash
				2,  2,        thunder
				3,  2,        blizzard
			`);
		},
	);

	test(
		'テスト3: ミニテーブルの先頭行の上に行追加後、保存するとCSVの正しいストア位置に空行が挿入されること',
		async ({ page }) => {
			// このテストは先頭行挿入もバグの対象かを確認する。
			// enemy id=2 を選択 → ミニテーブルは thunder（ストアインデックス=1）, blizzard（=2）。
			// ミニテーブルの先頭行（thunder, ストアインデックス=1）の上に行追加すると：
			// - 正しい動作: ストアインデックス=1 に空行が挿入され、thunder がインデックス=2 に移動
			//               CSV: slash, [空行], thunder, blizzard
			// - バグの動作: ストアインデックス=0 に挿入されてしまい、slash が押し出される
			//               CSV: [空行], slash, thunder, blizzard（slashの前に入る）

			const enemyTable = await openTableAsync(page, 'enemy');
			await selectRowAsync(enemyTable, 1);
			await waitForRelationsPanelContentAsync(page);

			const miniTable = await getMiniTableSectionAsync(page, 'skill');
			const allRows = miniTable.locator('.editor-table-row');
			// ヘッダー行(1) + データ行(2) + バッファ行(1) = 4行
			await expect(allRows).toHaveCount(4);

			// ミニテーブルの先頭行（thunder、ストアインデックス=1）の上に行を挿入する
			await rightClickMiniTableRowHeaderAsync(miniTable, 0);
			await clickContextMenuItemAsync(page, '上に行を挿入');

			// 行が追加されてミニテーブルに3データ行が表示されることを確認する
			// ヘッダー行(1) + データ行(3) + バッファ行(1) = 5行
			await expect(allRows).toHaveCount(5);

			const skillTable = await openTableAsync(page, 'skill');
			await skillTable.click();
			await page.keyboard.press('Control+s');
			await page.waitForTimeout(500);

			// 期待するCSV（正しい動作）:
			//   id,enemy_id,name
			//   1,1,slash         ← ストアインデックス=0（変化しない）
			//   ,2,               ← ストアインデックス=1（thunder の前に挿入）
			//                        autoFillEntries により enemy_id=2 が自動設定される
			//   2,2,thunder       ← ストアインデックス=2（1つ後ろにずれる）
			//   3,2,blizzard      ← ストアインデックス=3（1つ後ろにずれる）
			//
			// バグの動作:
			//   storeRowIndex = rowIndex - 1 = 1 - 1 = 0 で insertRowAt(0) を呼んでしまう。
			//   ストアインデックス=0（slash の前）に空行が入り、slash が押し出される。
			//   → lines[1] が slash でなく空行になる → expectCsvAsync で失敗してRED
			await expectCsvAsync(page, 'data/skill.csv', `
				id, enemy_id, name
				1,  1,        slash
				,   2,
				2,  2,        thunder
				3,  2,        blizzard
			`);
		},
	);

	test(
		'テスト4: ミニテーブルで行追加後のUndo/Redoが正しくストアを同期すること',
		async ({ page }) => {
			// テスト2の拡張。Undo後にRedoで再挿入すると、再びストアに空行が入ることを検証する。
			// deleteRow が store.removeRow() を呼ばないバグがある場合、
			// Undo でストアの空行が残り、Redo で2重挿入が起きる可能性がある。

			const enemyTable = await openTableAsync(page, 'enemy');
			await selectRowAsync(enemyTable, 1);
			await waitForRelationsPanelContentAsync(page);

			const miniTable = await getMiniTableSectionAsync(page, 'skill');
			const allRows = miniTable.locator('.editor-table-row');
			// ヘッダー行(1) + データ行(2) + バッファ行(1) = 4行
			await expect(allRows).toHaveCount(4);

			// 行を挿入する
			await rightClickMiniTableRowHeaderAsync(miniTable, 1);
			await clickContextMenuItemAsync(page, '下に行を挿入');
			// ヘッダー行(1) + データ行(3) + バッファ行(1) = 5行
			await expect(allRows).toHaveCount(5);

			// フォーカスを確保してから Undo する
			const firstDataCell = miniTable.locator(
				'.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell)'
			).first();
			await expect(firstDataCell).toBeVisible();
			await firstDataCell.click();
			await page.keyboard.press('Control+z');

			// Undo後: ミニテーブルが元の2行に戻る（バッファ行込み）
			// ヘッダー行(1) + データ行(2) + バッファ行(1) = 4行
			await expect(allRows).toHaveCount(4);

			// Redo で行挿入を再実行する
			await page.keyboard.press('Control+y');

			// Redo後: ミニテーブルに3データ行が表示される（ヘッダー行 + データ3行 + バッファ行(1) = 5行）
			await expect(allRows).toHaveCount(5);

			// Ctrl+S で保存する（skill タブ経由）
			const skillTable = await openTableAsync(page, 'skill');
			await skillTable.click();
			await page.keyboard.press('Control+s');
			await page.waitForTimeout(500);

			// 期待するCSV（Undo→Redo後の正しいストア状態）:
			//   テスト1と同じ結果になるはず（blizzardの直後に空行1行）
			//   autoFillEntries により enemy_id=2 が自動設定される
			//
			// バグの動作:
			//   deleteRow が store.removeRow() を呼ばないため、
			//   Undo でもストアに空行が残り、Redo で再挿入すると空行が2行になる。
			//   → 5行になるため expectCsvAsync の行数チェックで失敗してRED
			await expectCsvAsync(page, 'data/skill.csv', `
				id,   enemy_id, name
				1,    1,        slash
				2,    2,        thunder
				3,    2,        blizzard
				,     2,
			`);
		},
	);
});
