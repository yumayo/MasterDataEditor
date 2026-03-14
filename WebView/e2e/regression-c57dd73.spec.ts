import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { expectCsvAsync } from './fixtures/test-utils';

// =============================================================================
// リグレッションテスト: コミット c57dd73 で発生したリグレッション
//
// リグレッション1: ミニテーブルで外部キーが連続していないと表示されない
//   根本原因（推定）:
//     relations-panel.ts の 1:N解決部で、reverseEntry.rows（PKValue一覧）を
//     pkSet として構築し allRows を pkSet.has(row[pkColIdx]) でフィルタする。
//     allRows がストア経由（タブオープン済み）の場合、storeRows は物理行順を保持する。
//     この処理自体は正しいが、reverseReferenceMap の初期構築に使った CSV と
//     ストアデータの乖離によりフィルタが期待通りに動かない可能性がある。
//     FK値が連続していない（例: id=1,FK=1; id=2,FK=2; id=3,FK=1）配置では、
//     reverseEntry.rows に FK=1 の行（id=1 と id=3）の pkValue が含まれるべきだが
//     何らかの理由で欠落してミニテーブルの行数が不正になる。
//
// リグレッション2: 通常テーブルの一番下にデータを入れても保存されない
//   根本原因（推定）:
//     c57dd73 で通常テーブルの保存が saveTableData（DOM経由）から
//     saveTableDataFromStoreAsync（ストア経由）に変更された。
//     ストア経由の保存では「最初のセルが空の行で終了」するロジックが不要なため
//     全行が保存されるはずだが、セル編集後のストア更新が適切に行われているか
//     確認が必要。セル編集で setCellValueAt → store.updateCellValueByRowIndex
//     が呼ばれるが、DOM と ストアが正しく同期されていない場合は最終行が欠落する。
//     特に「最下行より下の空行エリアにセルを追加」するケースを検証する。
// =============================================================================

/**
 * テーブルを左ペインで開き、EditorTable Locator を返す
 * data-tab-name で絞り込むことで strict mode violation を防ぐ
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
 * RelationsPanelの指定テーブルセクションにあるミニEditorTable Locatorを返す
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
// リグレッション1: ミニテーブルで外部キーが連続していないと表示されない
//
// テーブル構成:
//   enemy: id, ja（親テーブル）
//   skill: id, enemy_id, name（子テーブル。enemy.id をFK として参照）
//
// skillデータ（FK値が連続していない配置）:
//   [0] id=1, enemy_id=1, name=slash    ← enemy id=1 の行
//   [1] id=2, enemy_id=2, name=thunder  ← enemy id=2 の行
//   [2] id=3, enemy_id=1, name=flame    ← enemy id=1 の行（非連続）
//   [3] id=4, enemy_id=2, name=blizzard ← enemy id=2 の行（非連続）
//
// 期待動作:
//   enemy id=1 を選択 → ミニテーブルに slash と flame の2行が表示される
//   enemy id=2 を選択 → ミニテーブルに thunder と blizzard の2行が表示される
// =============================================================================

function createNonConsecutiveFkFileSystem(): MockFileSystem {
	return {
		"schema/enemy.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "ja", type: "string" },
			],
			primary_key: "id",
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
			primary_key: "id",
		}),
		// FK値が非連続に配置されている:
		//   id=1: enemy_id=1 (スライム)
		//   id=2: enemy_id=2 (ドラゴン)
		//   id=3: enemy_id=1 (スライム) ← FK=1が再び現れる
		//   id=4: enemy_id=2 (ドラゴン) ← FK=2が再び現れる
		"data/skill.csv": [
			"id,enemy_id,name",
			"1,1,slash",
			"2,2,thunder",
			"3,1,flame",
			"4,2,blizzard",
		].join("\n"),
	};
}

test.describe('リグレッション1: ミニテーブルでFK値が非連続でも全行が表示されること', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createNonConsecutiveFkFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
	});

	test(
		'enemy id=1（スライム）を選択したとき、ミニテーブルに FK=1 の行が2件表示されること（slash と flame）',
		async ({ page }) => {
			// enemy テーブルを開く
			const enemyTable = await openTableAsync(page, 'enemy');

			// enemy の1行目（id=1, スライム）を選択する
			// → RelationsPanelに skill の1:N ミニテーブルが表示される
			await selectRowAsync(enemyTable, 0);
			await waitForRelationsPanelContentAsync(page);

			// skill ミニテーブルが表示されるまで待機する
			const miniTable = await getMiniTableSectionAsync(page, 'skill');
			const allRows = miniTable.locator('.editor-table-row');

			// 期待: ヘッダー行(1) + データ行(2) + バッファ行(1) = 4行（slash と flame が FK=1 に対応する）
			// リグレッションがある場合: FK値が非連続なため、最初の FK=1 の行 (slash) だけが
			// 検出されて flame が欠落し、ヘッダー行(1) + データ行(1) + バッファ行(1) = 3行になる
			await expect(allRows, 'enemy id=1 を選択したとき、FK=1 の行（slash, flame）が2件ミニテーブルに表示されるべき').toHaveCount(4);
		},
	);

	test(
		'enemy id=1（スライム）を選択したとき、ミニテーブルに "flame" が表示されること（非連続FK行の確認）',
		async ({ page }) => {
			const enemyTable = await openTableAsync(page, 'enemy');
			await selectRowAsync(enemyTable, 0);
			await waitForRelationsPanelContentAsync(page);

			const miniTable = await getMiniTableSectionAsync(page, 'skill');

			// 2番目のデータ行（id=3, flame）が表示されていることを確認する
			// DOM構造: 行0=ヘッダー行、行1=1番目データ行(slash)、行2=2番目データ行(flame)
			// リグレッションがある場合: 行2が存在しない（flame が欠落している）
			const secondDataRow = miniTable.locator('.editor-table-row').nth(2);
			await expect(secondDataRow, '2番目のデータ行（flame）がミニテーブルに存在するべき').toBeVisible();

			// 2番目のデータ行に "flame" が含まれることを確認する
			const nameCell = secondDataRow.locator(
				'.editor-table-cell:not(.editor-table-row-header)'
			).last();
			await expect(nameCell, 'name列に "flame" が表示されるべき（FK非連続行の確認）').toHaveText('flame');
		},
	);

	test(
		'enemy id=2（ドラゴン）を選択したとき、ミニテーブルに FK=2 の行が2件表示されること（thunder と blizzard）',
		async ({ page }) => {
			const enemyTable = await openTableAsync(page, 'enemy');

			// enemy の2行目（id=2, ドラゴン）を選択する
			await selectRowAsync(enemyTable, 1);
			await waitForRelationsPanelContentAsync(page);

			const miniTable = await getMiniTableSectionAsync(page, 'skill');
			const allRows = miniTable.locator('.editor-table-row');

			// 期待: ヘッダー行(1) + データ行(2) + バッファ行(1) = 4行（thunder と blizzard が FK=2 に対応する）
			// リグレッションがある場合: blizzard が欠落して3行になる
			await expect(allRows, 'enemy id=2 を選択したとき、FK=2 の行（thunder, blizzard）が2件ミニテーブルに表示されるべき').toHaveCount(4);
		},
	);

	test(
		'rowcount 表示が FK=1 の正しい件数（2件）を示すこと',
		async ({ page }) => {
			const enemyTable = await openTableAsync(page, 'enemy');
			await selectRowAsync(enemyTable, 0);
			await waitForRelationsPanelContentAsync(page);

			const section = page.locator('.relations-table-section').filter({
				has: page.locator('.relations-table-title').getByText('skill', { exact: true }),
			});
			await expect(section).toBeVisible();

			// .relations-table-row-count が "2 rows" を示すことを確認する
			// リグレッションがある場合: "1 rows" になる（1件しか見つからない）
			const rowCountEl = section.locator('.relations-table-row-count');
			await expect(rowCountEl, 'FK=1 の件数が 2 rows と表示されるべき').toHaveText('2 rows');
		},
	);
});

// =============================================================================
// リグレッション2: 通常テーブルの一番下にデータを入れても保存されない
//
// テーブル構成:
//   item: id, name, value（通常テーブル）
//
// 初期データ:
//   id=1, name=sword,  value=100
//   id=2, name=shield, value=200
//   id=3, name=potion, value=50
//
// 操作:
//   1. 最終行（id=3）のセルをダブルクリックして値を編集する
//   2. Ctrl+S で保存する
//
// 期待動作:
//   保存された CSV に編集したデータが正しく含まれる
//
// リグレッション発生条件:
//   c57dd73 で通常テーブルの保存が saveTableData（DOM経由）から
//   saveTableDataFromStoreAsync（ストア経由）に変更された。
//   旧 saveTableData は「最初のセルが空の行で終了」するロジックがあり、
//   全データ行が保存されない場合があった（これ自体はバグ）。
//   新 saveTableDataFromStoreAsync はストアの全行を保存するが、
//   セル編集後に updateCellValueAt の storeRowIndices 境界チェック
//   （domDataRowIndex >= this.storeRowIndices.length で早期 return）により
//   ストアが更新されないケースがある。
//   特に、insertRowInternal で storeRowIndices に行を追加したが
//   ストア行数との不整合が生じている場合、最下行の編集がストアに反映されず
//   保存時に欠落する可能性がある。
//
// この テスト2は「行挿入後に最終行を編集して保存する」シナリオを検証する:
//   - 行挿入（insertRowInternal）が storeRowIndices とストアを正しく同期する
//   - 挿入した行のセルを編集するとストアが正しく更新される
//   - Ctrl+S でストアの全行（挿入した空行を含む）がCSVに保存される
//   特に insertRowInternal の storeRowIndices 更新ロジックのバグで
//   挿入位置が誤っている場合は既存データが上書きされてリグレッションになる
// =============================================================================

function createLastRowSaveFileSystem(): MockFileSystem {
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
			"3,potion,50",
		].join("\n"),
	};
}

// =============================================================================
// バッファ空行への入力が保存されること（バグ修正後の新規テスト）
//
// 問題の経緯:
//   通常テーブルは emptyRowCount=100 のバッファ空行を DOM に生成する。
//   ユーザーはデータが入っている最終行の下のバッファ空行に直接データを入力できるが、
//   ストアベース保存（saveTableDataFromStoreAsync）に切り替えた後、
//   バッファ空行はストアの storeRowIndices に存在しないため updateCellValueAt が
//   早期リターンしてストアが更新されず、Ctrl+S で保存してもCSVに反映されなかった。
//
// 修正内容:
//   バッファ空行への初めての書き込み時に PromoteBufferRowCommand を CompositeCommand で包み、
//   ストアに空行を挿入して storeRowIndices を拡張する。Undo 時はその逆操作でストアから行を削除する。
// =============================================================================

function createBufferRowFileSystem(): MockFileSystem {
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
		].join("\n"),
	};
}

test.describe('バッファ空行への入力が保存されること', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createBufferRowFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
	});

	test(
		'バッファ空行にデータを入力してCtrl+Sすると、CSVにデータが保存されること',
		async ({ page }) => {
			const itemTable = await openTableAsync(page, 'item');

			// データ行は2行（id=1,id=2）。3行目（rowIndex=3）はバッファ空行。
			// DOM構造: ヘッダー行(nth(0)) + id=1行(nth(1)) + id=2行(nth(2)) + バッファ行(nth(3))...
			const bufferRow = itemTable.locator('.editor-table-row').nth(3);
			// 最初のデータセル（id列）をダブルクリックして編集する
			const idCell = bufferRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
			await expect(idCell).toBeVisible();
			await idCell.dblclick();

			const editField = page.locator('.grid-textfield-active').first();
			await expect(editField).toBeVisible();
			await editField.selectText();
			await editField.type('3');
			await page.keyboard.press('Enter');

			// name列を編集する
			const nameCell = bufferRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(1);
			await nameCell.dblclick();
			const nameField = page.locator('.grid-textfield-active').first();
			await expect(nameField).toBeVisible();
			await nameField.selectText();
			await nameField.type('potion');
			await page.keyboard.press('Enter');

			// Ctrl+S で保存する
			await itemTable.click();
			await page.keyboard.press('Control+s');
			await page.waitForTimeout(500);

			// バッファ空行に入力したデータがCSVに保存されていることを確認する
			await expectCsvAsync(page, 'data/item.csv', `
				id, name,   value
				1,  sword,  100
				2,  shield, 200
				3,  potion,
			`);
		},
	);

	test(
		'バッファ空行への入力をUndoすると、ストアから行が消えてCSVに保存されなくなること',
		async ({ page }) => {
			const itemTable = await openTableAsync(page, 'item');

			// バッファ空行（3行目）のid列にデータを入力する
			const bufferRow = itemTable.locator('.editor-table-row').nth(3);
			const idCell = bufferRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
			await idCell.dblclick();
			const editField = page.locator('.grid-textfield-active').first();
			await expect(editField).toBeVisible();
			await editField.selectText();
			await editField.type('3');
			await page.keyboard.press('Enter');

			// 入力が反映されていることを確認する
			await expect(idCell).toHaveText('3');

			// Undoする
			await itemTable.click();
			await page.keyboard.press('Control+z');

			// セルが空に戻っていることを確認する
			await expect(idCell).toHaveText('');

			// Ctrl+S で保存する（Undo後のストアには元の2行のみが入っているはず）
			await page.keyboard.press('Control+s');
			await page.waitForTimeout(500);

			// Undo後はバッファ空行の入力がストアから消えているためCSVには2行のみが保存される
			await expectCsvAsync(page, 'data/item.csv', `
				id, name,   value
				1,  sword,  100
				2,  shield, 200
			`);
		},
	);
});

// =============================================================================
// Fill操作でバッファ空行にデータがフィルされた場合、保存時にCSVにデータが含まれること
//
// 問題の経緯:
//   applyFillSeries（editor-actions.ts）はセル値変更時に table.replayCellChanges +
//   history.push を使っており、applyCellChangesWithHistory を経由しなかった。
//   そのため、フィルハンドルでデータ行からバッファ空行へドラッグフィルした場合、
//   バッファ行がストアに昇格されず保存時にデータが消失していた。
//
// 修正内容:
//   applyFillSeries 内でバッファ行の昇格処理を追加し、
//   CompositeCommand（PromoteBufferRowCommand + CellChangeCommand）として履歴に記録するようにした。
// =============================================================================

/**
 * フィルハンドルを使ってセルをドラッグフィルする。
 * sourceRow: フィル元のDOM行インデックス（ヘッダー行を含む。データ行は1始まり）
 * targetRow: フィル先の最後のDOM行インデックス
 * column: データ列インデックス（行ヘッダーを含む。データ列は1始まり）
 */
async function fillDownWithHandleAsync(
	page: Page,
	table: Locator,
	sourceRowIndex: number,
	targetRowIndex: number,
	colIndex: number
): Promise<void> {
	// ソース行のセルをクリックして選択する（行インデックスはDOM全体の0始まり）
	const sourceRow = table.locator('.editor-table-row').nth(sourceRowIndex);
	const sourceCell = sourceRow.locator('.editor-table-cell').nth(colIndex);
	await sourceCell.click();

	// フィルハンドルを取得する（選択セルの右下に表示される）
	const fillHandle = page.locator('.fill-handle');
	await expect(fillHandle).toBeVisible();

	// フィルハンドルから target 行の対応セルまでドラッグする
	const targetRow = table.locator('.editor-table-row').nth(targetRowIndex);
	const targetCell = targetRow.locator('.editor-table-cell').nth(colIndex);

	const handleBox = await fillHandle.boundingBox();
	const targetBox = await targetCell.boundingBox();
	if (!handleBox || !targetBox) throw new Error('boundingBox が取得できませんでした');

	await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 5 });
	await page.mouse.up();
}

test.describe('Fill操作でバッファ空行にデータがフィルされたとき保存されること', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createBufferRowFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
	});

	test(
		'フィルハンドルでデータ行からバッファ空行へ下方向にフィルした場合、保存時にCSVにデータが含まれること',
		async ({ page }) => {
			const itemTable = await openTableAsync(page, 'item');

			// item.csv: id=1(sword/100), id=2(shield/200)の2行
			// DOM構造: row[0]=ヘッダー、row[1]=id=1行、row[2]=id=2行、row[3]=バッファ空行...
			// id=2行（row[2]）のid列（col=1）をフィルハンドルでrow[3]（バッファ空行）までドラッグする
			await fillDownWithHandleAsync(page, itemTable, 2, 3, 1);

			// フィル後、バッファ空行に id=2 の値がコピーされていることをDOMで確認する
			const bufferRow = itemTable.locator('.editor-table-row').nth(3);
			const idCell = bufferRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
			await expect(idCell).toHaveText('2');

			// Ctrl+S で保存する
			await itemTable.click();
			await page.keyboard.press('Control+s');
			await page.waitForTimeout(500);

			// バッファ空行にフィルされたデータがCSVに保存されていることを確認する
			// フィル操作でバッファ行が昇格されストアに追加されたため、保存時にCSVに反映される。
			// PromoteBufferRowCommand が発行されていないと id=2 の行がストアに存在せず、
			// CSVに保存されないリグレッションが発生する。
			await expectCsvAsync(page, 'data/item.csv', `
				id, name,   value
				1,  sword,  100
				2,  shield, 200
				2,  ,
			`);
		},
	);

	test(
		'フィルハンドルでバッファ空行へフィルしてUndoすると、ストアから行が消えてCSVに保存されなくなること',
		async ({ page }) => {
			const itemTable = await openTableAsync(page, 'item');

			// id=2行のid列をバッファ空行までドラッグフィルする
			await fillDownWithHandleAsync(page, itemTable, 2, 3, 1);

			// フィル後の値確認
			const bufferRow = itemTable.locator('.editor-table-row').nth(3);
			const idCell = bufferRow.locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
			await expect(idCell).toHaveText('2');

			// Undoする（CompositeCommand全体がUndoされ、昇格行もストアから削除される）
			await itemTable.click();
			await page.keyboard.press('Control+z');

			// Undo後はバッファ空行が空に戻っていることを確認する
			await expect(idCell).toHaveText('');

			// Ctrl+S で保存する（Undo後はバッファ行がストアに存在しないため元の2行のみ）
			await page.keyboard.press('Control+s');
			await page.waitForTimeout(500);

			await expectCsvAsync(page, 'data/item.csv', `
				id, name,   value
				1,  sword,  100
				2,  shield, 200
			`);
		},
	);
});

test.describe('リグレッション2: 通常テーブルの最下行データが保存されること', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createLastRowSaveFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
	});

	test(
		'最終行（id=3）を編集してCtrl+Sすると、CSVに編集後のデータが保存されること',
		async ({ page }) => {
			const itemTable = await openTableAsync(page, 'item');

			// 最終行（rowIndex=2, id=3, potion）のvalue列をダブルクリックして編集する
			// ヘッダー行(nth(0)) + 1行目(nth(1)) + 2行目(nth(2)) + 3行目(nth(3)) = 4行
			const lastDataRow = itemTable.locator('.editor-table-row').nth(3);
			const valueCell = lastDataRow.locator(
				'.editor-table-cell:not(.editor-table-row-header)'
			).nth(2);
			await expect(valueCell).toBeVisible();
			await valueCell.dblclick();

			// 編集UIが表示されるまで待機する
			const editField = page.locator('.grid-textfield-active').first();
			await expect(editField).toBeVisible();

			// 既存内容を全選択して新しい値を入力する
			await editField.selectText();
			await editField.type('999');
			await page.keyboard.press('Enter');

			// テーブルをクリックしてフォーカスを確保してからCtrl+Sで保存する
			await itemTable.click();
			await page.keyboard.press('Control+s');
			// 保存は非同期処理のため完了を待機する
			await page.waitForTimeout(500);

			// 保存された CSV を検証する
			// 最終行の value が 999 に変更されていることを確認する
			// リグレッションがある場合: ストアのセルが更新されないため
			// CSV の最終行の value が 50 のまま、または最終行が欠落する
			await expectCsvAsync(page, 'data/item.csv', `
				id, name,   value
				1,  sword,  100
				2,  shield, 200
				3,  potion, 999
			`);
		},
	);

	test(
		'最終行の下に行を挿入してCtrl+Sすると、既存の最終行（id=3）がCSVに保持されること',
		async ({ page }) => {
			// このテストは insertRowInternal の storeRowIndices 更新ロジックを検証する。
			// id=3（最終行）の下に行を挿入すると:
			//   - storeRowIndices が [0,1,2] → [0,1,2,3] に更新される（正しい動作）
			//   - または [0,1,2,2] のまま（+1インクリメントが起きない）になる
			//
			// バグがある場合: storeRowIndices の更新が不正で、既存の id=3 の行が
			// ストア上で別のインデックスにずれてしまい、保存時に CSV が乱れる
			const itemTable = await openTableAsync(page, 'item');

			// 最終行（rowIndex=2, id=3）を右クリックして「下に行を挿入」を選択する
			const lastRowHeader = itemTable.locator('.editor-table-row-header').nth(2);
			await lastRowHeader.click({ button: 'right' });

			const menu = page.locator('.context-menu.visible');
			await expect(menu).toBeVisible();
			await menu.locator('.context-menu-item', { hasText: '下に行を挿入' }).click();

			// 行が追加されてテーブルに4データ行が表示されることを確認する
			// ヘッダー行(1) + データ行(4) = 5行
			// バッファ空行（editor-table-empty-row）は除外して実データ行のみカウントする
			const allRows = itemTable.locator('.editor-table-row:not(.editor-table-empty-row)');
			await expect(allRows).toHaveCount(5);

			// Ctrl+S で保存する（行挿入で追加した空行も含めて保存）
			await itemTable.click();
			await page.keyboard.press('Control+s');
			// 保存は非同期処理のため完了を待機する
			await page.waitForTimeout(500);

			// 保存された CSV を検証する
			// 期待: 既存の3行 + 末尾に空行1行 = 合計4行
			// 既存行（id=1,2,3）はそのまま保持され、末尾に空行が挿入される
			//
			// リグレッションがある場合:
			//   insertRowInternal の storeRowIndices 更新で
			//   `if (indices[i] >= storeRowIndex) indices[i] += 1` の条件により
			//   storeRowIndex=3 と同値の既存エントリが存在した場合に二重更新が起き、
			//   ストアに誤った位置に行が入って CSV が乱れる
			await expectCsvAsync(page, 'data/item.csv', `
				id, name,   value
				1,  sword,  100
				2,  shield, 200
				3,  potion, 50
				,,
			`);
		},
	);

	test(
		'先頭行の上に行を挿入してCtrl+Sすると、既存の全行がCSVに保持されること',
		async ({ page }) => {
			// このテストは先頭行への行挿入時の storeRowIndices 更新を検証する。
			// id=1（先頭行）の上に行を挿入すると:
			//   - storeRowIndex = indices[0] = 0
			//   - splice(0, 0, 0) → [0, 0, 1, 2]
			//   - ループ: i=1, indices[1]=0 >= 0 → +1 → [0, 1, 1, 2]
			//             i=2, indices[2]=1 >= 0 → +1 → [0, 1, 2, 2]
			//             i=3, indices[3]=2 >= 0 → +1 → [0, 1, 2, 3]
			//   → 正しく [0, 1, 2, 3] になる（空行が先頭に挿入され既存行が+1ずれる）
			// リグレッションがある場合: ストアの挿入位置が不正で既存行が上書きされる
			const itemTable = await openTableAsync(page, 'item');

			// 先頭行（rowIndex=0, id=1）を右クリックして「上に行を挿入」を選択する
			const firstRowHeader = itemTable.locator('.editor-table-row-header').nth(0);
			await firstRowHeader.click({ button: 'right' });

			const menu = page.locator('.context-menu.visible');
			await expect(menu).toBeVisible();
			await menu.locator('.context-menu-item', { hasText: '上に行を挿入' }).click();

			// 行が追加されてテーブルに4データ行が表示されることを確認する
			// ヘッダー行(1) + データ行(4) = 5行
			// バッファ空行（editor-table-empty-row）は除外して実データ行のみカウントする
			const allRows = itemTable.locator('.editor-table-row:not(.editor-table-empty-row)');
			await expect(allRows).toHaveCount(5);

			// Ctrl+S で保存する
			await itemTable.click();
			await page.keyboard.press('Control+s');
			await page.waitForTimeout(500);

			// 保存された CSV を検証する
			// 期待: 先頭に空行 + 既存3行 = 合計4行
			// リグレッションがある場合: 既存行がストアの誤った位置に入り、
			// id=1 が上書きされるか欠落してCSVが乱れる
			await expectCsvAsync(page, 'data/item.csv', `
				id, name,   value
				,,
				1,  sword,  100
				2,  shield, 200
				3,  potion, 50
			`);
		},
	);

	test(
		'中間行の上に行を挿入してCtrl+Sすると、前後の全行がCSVに保持されること',
		async ({ page }) => {
			// このテストは中間行への行挿入時の storeRowIndices 更新を検証する。
			// id=2（rowIndex=1）の上に行を挿入すると:
			//   - storeRowIndex = indices[1] = 1
			//   - splice(1, 0, 1) → [0, 1, 1, 2]
			//   - ループ: i=2, indices[2]=1 >= 1 → +1 → [0, 1, 2, 2]
			//             i=3, indices[3]=2 >= 1 → +1 → [0, 1, 2, 3]
			//   → 正しく [0, 1, 2, 3] になる
			// リグレッションがある場合: id=2 の前に空行が入るはずが、他の行が上書きされる
			const itemTable = await openTableAsync(page, 'item');

			// 2行目（rowIndex=1, id=2）を右クリックして「上に行を挿入」を選択する
			const secondRowHeader = itemTable.locator('.editor-table-row-header').nth(1);
			await secondRowHeader.click({ button: 'right' });

			const menu = page.locator('.context-menu.visible');
			await expect(menu).toBeVisible();
			await menu.locator('.context-menu-item', { hasText: '上に行を挿入' }).click();

			// 行が追加されてテーブルに4データ行が表示されることを確認する
			// バッファ空行（editor-table-empty-row）は除外して実データ行のみカウントする
			const allRows = itemTable.locator('.editor-table-row:not(.editor-table-empty-row)');
			await expect(allRows).toHaveCount(5);

			// Ctrl+S で保存する
			await itemTable.click();
			await page.keyboard.press('Control+s');
			await page.waitForTimeout(500);

			// 保存された CSV を検証する
			// 期待: id=1 → 空行 → id=2 → id=3 の順
			// リグレッションがある場合: 空行が誤った位置に入って既存行がずれる・欠落する
			await expectCsvAsync(page, 'data/item.csv', `
				id, name,   value
				1,  sword,  100
				,,
				2,  shield, 200
				3,  potion, 50
			`);
		},
	);
});
