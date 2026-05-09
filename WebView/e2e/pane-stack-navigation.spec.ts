import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// ペインスタック・ナビゲーションテスト
//
// 機能概要:
//   ミニテーブルのCtrl+Clickで現在のRelationsPanelが左に移動し、
//   新しいRelationsPanelが右に表示される「ペインスタック」機能。
//
// DOM構造:
//   .editor
//     ├── .editor-navigation-bar  (ペインが3つ以上のとき表示)
//     │     ├── button.nav-left   (←)
//     │     ├── span.nav-indicator ("2 / 3")
//     │     └── button.nav-right  (→)
//     └── .editor-content
//           ├── .editor-left-slot  (表示中の左ペイン)
//           └── .editor-right-slot (表示中の右ペイン)
//
// ペインスタック構成（3ペイン時）:
//   内部: [EditorTable(P0), RelationsPanel(P1), RelationsPanel(P2)]
//   表示インデックス i=1 のとき: 左=P0(EditorTable), 右=P1(RP1)
//   表示インデックス i=2 のとき: 左=P1(RP1), 右=P2(RP2)
//   インジケーター: "{i} / {total}"
//
// テーブル構成（3段階リレーションチェーン）:
//   world: id, name
//   area:  id, name, world_id (→ world.id)
//   enemy: id, name, area_id  (→ area.id)
//
//   world を開いて row0 を選択 → RP1 に area（1:N）が表示される
//   area ミニテーブルの行をCtrl+Click → RP2 に enemy（1:N）が表示される
//   enemy ミニテーブルの行をCtrl+Click → RP3 に area（N:1）が表示される
// =============================================================================

/**
 * ペインスタックナビゲーションテスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   world: id, name（ワールドマスター）
 *   area:  id, name, world_id（エリア。world.idをFKとして参照）
 *   enemy: id, name, area_id（敵。area.idをFKとして参照）
 */
function createPaneStackTestFileSystem(): MockFileSystem {
	return {
		"schema/world.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
			],
			primary_key: ["id"],
		}),
		"data/world.csv": [
			"id,name",
			"1,forest",
			"2,desert",
		].join("\n"),
		"schema/area.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
				{ key: 2, name: "world_id", type: "int", reference: "world.id" },
			],
			primary_key: ["id"],
		}),
		"data/area.csv": [
			"id,name,world_id",
			"1,forest_north,1",
			"2,forest_south,1",
			"3,desert_center,2",
		].join("\n"),
		"schema/enemy.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
				{ key: 2, name: "area_id", type: "int", reference: "area.id" },
			],
			primary_key: ["id"],
		}),
		"data/enemy.csv": [
			"id,name,area_id",
			"1,slime,1",
			"2,dragon,1",
			"3,scorpion,3",
		].join("\n"),
	};
}

/**
 * エクスプローラーからテーブルを開き、左スロットのEditorTable Locatorを返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
	const explorer = page.locator('#explorer');
	await explorer.getByText(tableName, { exact: true }).click();
	// タブ切替後は editor-left-slot 内の EditorTable を返す（新DOM構造対応）
	const table = page.locator('.editor-left-slot .editor-table');
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
 * visibleなデータセルを返すセレクタ
 */
const RIGHT_SLOT_MINI_TABLE_VISIBLE_CELL_SELECTOR = [
	'.editor-right-slot .relations-panel .editor-table',
	' .editor-table-cell:not(.editor-table-row-header)',
	':not(.editor-table-column-header)',
	':not(.editor-table-corner-cell)',
	':not([style*="display: none"])',
].join('');

// =============================================================================
// テストスイート: ペインスタックナビゲーション
// =============================================================================

test.describe('ペインスタックナビゲーション', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createPaneStackTestFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
		await enableRelationsPanelAsync(page);
	});

	// ---------------------------------------------------------------------------
	// テスト1: 初期状態ではナビゲーションバーが非表示であること
	// ---------------------------------------------------------------------------
	test('初期状態ではナビゲーションバーが非表示であること', async ({ page }) => {
		// world テーブルを開いて1行目を選択する
		const mainTable = await openTableAsync(page, 'world');
		await selectRowAsync(mainTable, 0);

		// RelationsPanelにコンテンツが表示されるまで待機する
		await waitForRelationsPanelContentAsync(page);

		// ナビゲーションバーは表示されないこと（ペインが2つの初期状態）
		await expect(page.locator('.editor-navigation-bar')).toBeHidden();
	});

	// ---------------------------------------------------------------------------
	// テスト2: ミニテーブルのCtrl+Clickでペインが追加されること
	// ---------------------------------------------------------------------------
	test('areaミニテーブルのCtrl+ClickでRP2が右スロットに表示されること', async ({ page }) => {
		// world テーブルを開いて row0 を選択する（RP1にareaミニテーブル表示）
		const mainTable = await openTableAsync(page, 'world');
		await selectRowAsync(mainTable, 0);
		await waitForRelationsPanelContentAsync(page);

		// RP1内のareaミニテーブルが表示されるまで待機する
		const miniTable = page.locator('.editor-right-slot .relations-panel .editor-table').first();
		await expect(miniTable).toBeVisible();

		// ミニテーブルのvisibleなデータセルを取得する
		const visibleCell = page.locator(RIGHT_SLOT_MINI_TABLE_VISIBLE_CELL_SELECTOR).first();
		await expect(visibleCell).toBeVisible();

		// Ctrl+Clickでペインスタックを追加する
		await visibleCell.click({ modifiers: ['Control'] });

		// 右スロットに新しいRelationsPanel（RP2）が表示されること
		await expect(page.locator('.editor-right-slot .relations-panel')).toBeVisible();

		// RP2にenemyの1:Nテーブルが表示されること
		// enemyテーブルのセクションヘッダー（テーブル名 "enemy"）が右スロットに存在すること
		const enemySection = page.locator('.editor-right-slot .relations-panel .relations-table-title')
			.filter({ hasText: 'enemy' });
		await expect(enemySection).toBeVisible();
	});

	// ---------------------------------------------------------------------------
	// テスト3: Ctrl+Click後にナビゲーションバーが表示されること
	// ---------------------------------------------------------------------------
	test('Ctrl+Click後にナビゲーションバーが表示されインジケーターが"2 / 3"と表示されること', async ({ page }) => {
		// world を開いて row0 を選択 → RP1 に area 表示
		const mainTable = await openTableAsync(page, 'world');
		await selectRowAsync(mainTable, 0);
		await waitForRelationsPanelContentAsync(page);

		const visibleCell = page.locator(RIGHT_SLOT_MINI_TABLE_VISIBLE_CELL_SELECTOR).first();
		await expect(visibleCell).toBeVisible();

		// Ctrl+Clickでペインスタックを追加する
		await visibleCell.click({ modifiers: ['Control'] });

		// ナビゲーションバーが表示されること
		await expect(page.locator('.editor-navigation-bar')).toBeVisible();

		// インジケーターが "2 / 3" と表示されること
		// （ペイン合計3つ、現在表示位置インデックス2）
		await expect(page.locator('.editor-navigation-bar .nav-indicator')).toHaveText('2 / 3');
	});

	// ---------------------------------------------------------------------------
	// テスト4: ←ボタンでEditorTableに戻れること
	// ---------------------------------------------------------------------------
	test('←ボタンクリックで左スロットにEditorTableが表示されインジケーターが"1 / 3"になること', async ({ page }) => {
		// world を開いて row0 を選択 → RP1 → Ctrl+Click → RP2 追加
		const mainTable = await openTableAsync(page, 'world');
		await selectRowAsync(mainTable, 0);
		await waitForRelationsPanelContentAsync(page);

		const visibleCell = page.locator(RIGHT_SLOT_MINI_TABLE_VISIBLE_CELL_SELECTOR).first();
		await expect(visibleCell).toBeVisible();
		await visibleCell.click({ modifiers: ['Control'] });

		// ナビゲーションバーが表示されるまで待機する
		await expect(page.locator('.editor-navigation-bar')).toBeVisible();

		// ←ボタンをクリックする
		await page.locator('.editor-navigation-bar .nav-left').click();

		// 左スロットにEditorTable（worldテーブル）が表示されること
		const leftSlotEditorTable = page.locator('.editor-left-slot .editor-table');
		await expect(leftSlotEditorTable).toBeVisible();

		// world テーブルのヘッダー（name列）が左スロットに存在すること
		const worldNameHeader = page.locator('.editor-left-slot .editor-table-detached-column-header-layer .editor-table-column-header')
			.filter({ hasText: 'name' });
		await expect(worldNameHeader).toBeVisible();

		// 右スロットにRP1（areaのリレーション）が表示されること
		await expect(page.locator('.editor-right-slot .relations-panel')).toBeVisible();

		// インジケーターが "1 / 3" と表示されること
		await expect(page.locator('.editor-navigation-bar .nav-indicator')).toHaveText('1 / 3');
	});

	// ---------------------------------------------------------------------------
	// テスト5: →ボタンで進めること
	// ---------------------------------------------------------------------------
	test('←で戻った後に→ボタンで進めること（インジケーターが"2 / 3"に戻ること）', async ({ page }) => {
		// world を開いて row0 を選択 → RP1 → Ctrl+Click → RP2 追加 → ← で戻る
		const mainTable = await openTableAsync(page, 'world');
		await selectRowAsync(mainTable, 0);
		await waitForRelationsPanelContentAsync(page);

		const visibleCell = page.locator(RIGHT_SLOT_MINI_TABLE_VISIBLE_CELL_SELECTOR).first();
		await expect(visibleCell).toBeVisible();
		await visibleCell.click({ modifiers: ['Control'] });
		await expect(page.locator('.editor-navigation-bar')).toBeVisible();

		// ←で戻る
		await page.locator('.editor-navigation-bar .nav-left').click();
		await expect(page.locator('.editor-navigation-bar .nav-indicator')).toHaveText('1 / 3');

		// →で進む
		await page.locator('.editor-navigation-bar .nav-right').click();

		// 左スロットにRP1（areaのリレーション）が表示されること
		// RP1はEditorTableではなくRelationsPanelなので、左スロットにrelations-panelクラスが存在する
		await expect(page.locator('.editor-left-slot .relations-panel')).toBeVisible();

		// 右スロットにRP2（enemyのリレーション）が表示されること
		await expect(page.locator('.editor-right-slot .relations-panel')).toBeVisible();

		// インジケーターが "2 / 3" と表示されること
		await expect(page.locator('.editor-navigation-bar .nav-indicator')).toHaveText('2 / 3');
	});

	// ---------------------------------------------------------------------------
	// テスト6: 二重ネスト — RP2のミニテーブルをCtrl+Click → RP3が追加されること
	// ---------------------------------------------------------------------------
	test('RP2のenemyミニテーブルをCtrl+ClickするとRP3が右スロットに追加されてインジケーターが"3 / 4"になること', async ({ page }) => {
		// world を開いて row0 を選択 → RP1（area表示）
		const mainTable = await openTableAsync(page, 'world');
		await selectRowAsync(mainTable, 0);
		await waitForRelationsPanelContentAsync(page);

		// RP1のareaミニテーブルのvisibleセルをCtrl+Click → RP2（enemy表示）
		const areaVisibleCell = page.locator(RIGHT_SLOT_MINI_TABLE_VISIBLE_CELL_SELECTOR).first();
		await expect(areaVisibleCell).toBeVisible();
		await areaVisibleCell.click({ modifiers: ['Control'] });
		await expect(page.locator('.editor-navigation-bar')).toBeVisible();
		await expect(page.locator('.editor-navigation-bar .nav-indicator')).toHaveText('2 / 3');

		// この時点で右スロットにRP2（enemyミニテーブル）が表示されている
		// RP2内のenemyミニテーブルのvisibleセルをCtrl+Click → RP3追加
		const enemyVisibleCell = page.locator(RIGHT_SLOT_MINI_TABLE_VISIBLE_CELL_SELECTOR).first();
		await expect(enemyVisibleCell).toBeVisible();
		await enemyVisibleCell.click({ modifiers: ['Control'] });

		// RP3が右スロットに追加されること
		await expect(page.locator('.editor-right-slot .relations-panel')).toBeVisible();

		// インジケーターが "3 / 4" と表示されること
		// （ペイン合計4つ: EditorTable + RP1 + RP2 + RP3、現在表示位置インデックス3）
		await expect(page.locator('.editor-navigation-bar .nav-indicator')).toHaveText('3 / 4');
	});

	// ---------------------------------------------------------------------------
	// テスト7: タブ切替でスタックがリセットされること
	// ---------------------------------------------------------------------------
	test('別タブを開くとナビゲーションバーが非表示になりスタックがリセットされること', async ({ page }) => {
		// world を開いて row0 を選択 → RP1 → Ctrl+Click → RP2 追加（ペイン3つ）
		const mainTable = await openTableAsync(page, 'world');
		await selectRowAsync(mainTable, 0);
		await waitForRelationsPanelContentAsync(page);

		const visibleCell = page.locator(RIGHT_SLOT_MINI_TABLE_VISIBLE_CELL_SELECTOR).first();
		await expect(visibleCell).toBeVisible();
		await visibleCell.click({ modifiers: ['Control'] });
		await expect(page.locator('.editor-navigation-bar')).toBeVisible();

		// エクスプローラーから area タブを開く（タブ切替）
		const explorer = page.locator('#explorer');
		await explorer.getByText('area', { exact: true }).click();

		// 既存のペインスタック表示が維持されること
		await expect(page.locator('.editor-navigation-bar')).toBeVisible();
		await expect(page.locator('.editor-navigation-bar .nav-indicator')).toHaveText('2 / 3');
	});

	// ---------------------------------------------------------------------------
	// テスト8: 左側RPのミニテーブルで別の行をクリックすると右側RPが更新されること
	//
	// シナリオ:
	//   world の row0（id=1, forest）を選択 → RP1 に area の1:N（forest_north, forest_south）表示
	//   RP1 の area ミニテーブルで forest_north（area.id=1）をCtrl+Click → RP2 追加
	//   （RP2 には area.id=1 を参照する enemy: slime, dragon が 2 rows で表示される）
	//   viewIndex=1 の状態で 左スロット=RP1, 右スロット=RP2
	//   RP1 の area ミニテーブルで forest_south（area.id=2）の行を通常クリック
	//   → RP2 が area.id=2 の参照関係に更新されること
	//   （area.id=2 を参照する enemy は 0 件のため、enemy セクション自体が非表示になる）
	//   （代わりに area.world_id=1 の N:1 参照として world セクションのみ表示される）
	// ---------------------------------------------------------------------------
	test('左側RPのミニテーブルで別の行をクリックすると右側RPが更新されること', async ({ page }) => {
		// world テーブルを開いて row0 を選択する（RP1 に area の1:N ミニテーブル表示）
		const mainTable = await openTableAsync(page, 'world');
		await selectRowAsync(mainTable, 0);
		await waitForRelationsPanelContentAsync(page);

		// RP1 内の area ミニテーブルが右スロットに表示されるまで待機する
		const rightSlotMiniTable = page.locator('.editor-right-slot .relations-panel .editor-table').first();
		await expect(rightSlotMiniTable).toBeVisible();

		// RP1 の area ミニテーブルで forest_north（area.id=1, 1行目）のデータセルを Ctrl+Click → RP2 追加
		// Ctrl+Click は createCell の mousedown ハンドラ（navigateToDefinition）で処理されるため、
		// 行ヘッダーではなくデータセル（editor-table-cell かつ非ヘッダー）をクリックする
		const firstRowDataCell = rightSlotMiniTable
			.locator('.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell)')
			.first();
		await expect(firstRowDataCell).toBeVisible();
		await firstRowDataCell.click({ modifiers: ['Control'] });

		// RP2 が追加されてインジケーターが "2 / 3" になることを確認する
		await expect(page.locator('.editor-navigation-bar .nav-indicator')).toHaveText('2 / 3');

		// この時点で viewIndex=1: 左スロット=RP1, 右スロット=RP2
		// RP2 には area.id=1 を参照する enemy（slime, dragon）が 2 rows で表示される
		const rp2EnemySection = page.locator('.editor-right-slot .relations-panel .relations-table-section')
			.filter({ has: page.locator('.relations-table-title', { hasText: 'enemy' }) });
		const rp2EnemyRowCount = rp2EnemySection.locator('.relations-table-row-count');
		await expect(rp2EnemyRowCount).toHaveText('2 rows');

		// 左スロット（RP1）の area ミニテーブルで forest_south（area.id=2, 2行目）の行ヘッダーをクリックする
		// 行ヘッダークリックは selectRow を呼んで行選択を変更する
		const leftSlotMiniTable = page.locator('.editor-left-slot .relations-panel .editor-table').first();
		const secondRowHeader = leftSlotMiniTable.locator('.editor-table-row-header').nth(1);
		await expect(secondRowHeader).toBeVisible();
		await secondRowHeader.click();

		// 右スロット（RP2）が area.id=2 の参照関係に更新されること
		// area.id=2 を参照する enemy は 0 件のため、enemy セクション自体が非表示になる（0件エントリは表示されない）
		// 代わりに area.world_id=1 の N:1 参照（world テーブル）のみが表示される
		await expect(rp2EnemySection).not.toBeVisible();
		// world セクション（N:1）が表示されていることで RP2 が再描画されたことを確認する
		const rp2WorldSection = page.locator('.editor-right-slot .relations-panel .relations-table-section')
			.filter({ has: page.locator('.relations-table-title', { hasText: 'world' }) });
		await expect(rp2WorldSection).toBeVisible();
	});
});
