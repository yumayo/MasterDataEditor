import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// ブラウザ History API によるナビゲーション履歴テスト (RED)
//
// 機能概要:
//   各種ナビゲーション操作時に pushState でブラウザ履歴を記録し、
//   マウスの戻る/進むボタン（page.goBack/goForward）でナビゲーションを復元する。
//
// 対象操作:
//   1. タブ切替 (tab-switch) — 実装済み
//   2. 定義ジャンプ (navigate-definition) — ミニテーブルのCtrl+Clickで paneStack 深化
//   3. REFERENCESパネルからのジャンプ (navigate-row) — 別テーブルの特定行へジャンプ
//   4. 検索パネルからのジャンプ (navigate-cell) — 別テーブルの特定セルへジャンプ
//   5. フォームパネル開閉 (form-panel-open) — PKセル右クリックでフォームパネルを開く
//   6. paneStack深化 (pane-push) — 定義ジャンプで viewIndex が変化する
//
// 実装クラス: NavigationHistory (navigation-history.ts)
//   - 各操作時に pushState でエントリを積む
//   - popstate イベントで操作の逆を再現する
//
// テスト1-4 は実装済み。テスト5以降は RED（プロダクションコード未実装）。
// =============================================================================

/**
 * item テーブルと quest テーブルを持つテスト用ファイルシステムを生成する
 */
function createNavigationTestFileSystem(): MockFileSystem {
	return {
		"schema/item.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
			],
			primary_key: ["id"],
		}),
		"data/item.csv": [
			"id,name",
			"1,sword",
			"2,shield",
		].join("\n"),
		"schema/quest.json": JSON.stringify({
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
	};
}

/**
 * 定義ジャンプ・paneStack深化テスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   world: id, name（ワールドマスター）
 *   area:  id, name, world_id（エリア。world.idをFKとして参照）
 *
 * worldを開いてrow0を選択 → RelationsPanelにareaの1:Nミニテーブルが表示される。
 * areaミニテーブルのセルをCtrl+Click → paneStackにRelationsPanelが追加される（定義ジャンプ）。
 */
function createDefinitionJumpTestFileSystem(): MockFileSystem {
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
		].join("\n"),
	};
}

/**
 * REFERENCESパネル・フォームパネルテスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   enemy: id, ja（敵マスター）
 *   quest: id, name, enemy_id（クエスト。enemy.idをFKとして参照）
 *   item:  id, name, quest_id（アイテム。quest.idをFKとして参照）
 *
 * quest.id はitem.quest_idから逆参照されるため、questのPKセル右クリックで
 * REFERENCESパネルに逆参照エントリが表示される。
 * REFERENCESパネルの行をクリックすると item テーブルの該当行へジャンプする。
 */
function createReferencesJumpTestFileSystem(): MockFileSystem {
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
		"schema/quest.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
				{ key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
			],
			primary_key: ["id"],
		}),
		"data/quest.csv": [
			"id,name,enemy_id",
			"1,first_quest,1",
			"2,second_quest,2",
		].join("\n"),
		"schema/item.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
				{ key: 2, name: "quest_id", type: "int", reference: "quest.id" },
			],
			primary_key: ["id"],
		}),
		"data/item.csv": [
			"id,name,quest_id",
			"1,sword,1",
			"2,shield,1",
			"3,potion,2",
		].join("\n"),
	};
}

/**
 * エクスプローラーから指定テーブルを開く
 * サイドバーのファイル名をクリックしてタブをアクティブにする
 */
async function openTableAsync(page: Page, tableName: string): Promise<void> {
	const explorer = page.locator('#explorer');
	await explorer.getByText(tableName, { exact: true }).click();
	// タブが開かれてアクティブになるまで待機する
	await expect(page.locator(`.tab-button-active`)).toContainText(tableName);
}

/**
 * 左スロットのEditorTableを取得する
 */
function getLeftSlotTable(page: Page): Locator {
	return page.locator('.editor-left-slot .editor-table');
}

/**
 * 行ヘッダーをクリックして行を選択する（rowIndex: 0始まり、ヘッダー行除く）
 */
async function selectRowAsync(table: Locator, rowIndex: number): Promise<void> {
	const header = table.locator('.editor-table-row-header').nth(rowIndex);
	await header.click();
}

/**
 * RelationsPanelのコンテンツが表示されるまで待機する
 */
async function waitForRelationsPanelAsync(page: Page): Promise<void> {
	await expect(page.locator('.relations-panel-content')).toBeVisible();
}

/**
 * 右スロットのRelationsPanel内ミニテーブルの最初のvisibleなデータセルを取得する
 */
function getFirstMiniTableVisibleCell(page: Page): Locator {
	return page.locator([
		'.editor-right-slot .relations-panel .editor-table',
		' .editor-table-cell:not(.editor-table-row-header)',
		':not(.editor-table-column-header)',
		':not(.editor-table-corner-cell)',
		':not([style*="display: none"])',
	].join('')).first();
}

/**
 * questテーブルのPKセル（id列、rowIndex行目）を右クリックしてコンテキストメニューを開く
 * rowIndex: 0始まり（ヘッダー行除く）
 */
async function rightClickPkCellAsync(table: Locator, rowIndex: number): Promise<void> {
	// データ行は .editor-table-row の nth(rowIndex + 1)（0番目はヘッダー行）
	const row = table.locator('.editor-table-row').nth(rowIndex);
	const pkCell = row.locator('.editor-table-cell:not(.editor-table-row-header)').first();
	await pkCell.click({ button: 'right' });
}

// =============================================================================
// テストスイート
// =============================================================================

test.describe('ブラウザ History API によるタブナビゲーション', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createNavigationTestFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
		await enableRelationsPanelAsync(page);
	});

	// ---------------------------------------------------------------------------
	// テスト1: タブ切替時に history.state にタブ名が記録される
	//
	// item → quest の順にタブを開いた後、
	// history.state に { type: 'tab-switch', tabName: 'quest' } が含まれることを確認する。
	// ---------------------------------------------------------------------------
	test('タブを切り替えると history.state にタブ名が記録される', async ({ page }) => {
		await openTableAsync(page, 'item');
		await openTableAsync(page, 'quest');

		const state = await page.evaluate(() => history.state);
		expect(state).toMatchObject({ type: 'tab-switch', tabName: 'quest' });
	});

	// ---------------------------------------------------------------------------
	// テスト2: ブラウザの戻るで前のタブに復帰する
	//
	// item → quest の順にタブを開いた後、page.goBack() で
	// item タブがアクティブ（.tab-button-active）になることを確認する。
	// ---------------------------------------------------------------------------
	test('ブラウザの戻るで前のタブに復帰する', async ({ page }) => {
		await openTableAsync(page, 'item');
		await openTableAsync(page, 'quest');

		await page.goBack();

		// item タブのボタンがアクティブになっていること
		const activeTab = page.locator('.tab-button-active');
		await expect(activeTab).toContainText('item');
	});

	// ---------------------------------------------------------------------------
	// テスト3: ブラウザの進むで復帰したタブから再び元のタブに戻る
	//
	// item → quest → goBack (item) → goForward (quest) の流れで
	// quest タブが再びアクティブになることを確認する。
	// ---------------------------------------------------------------------------
	test('ブラウザの進むで復帰したタブから再び元のタブに戻る', async ({ page }) => {
		await openTableAsync(page, 'item');
		await openTableAsync(page, 'quest');

		// 戻る: quest → item
		await page.goBack();
		await expect(page.locator('.tab-button-active')).toContainText('item');

		// 進む: item → quest
		await page.goForward();
		await expect(page.locator('.tab-button-active')).toContainText('quest');
	});

	// ---------------------------------------------------------------------------
	// テスト4: 初期ロード時に replaceState で初期状態がマークされている
	//
	// ページロード直後（タブ未選択状態）の history.state に
	// { type: 'initial' } が含まれることを確認する。
	// ---------------------------------------------------------------------------
	test('初期ロード時に replaceState で初期状態がマークされている', async ({ page }) => {
		// ページロード直後（beforeEach で goto済み）の state を確認する
		const state = await page.evaluate(() => history.state);
		expect(state).toMatchObject({ type: 'initial' });
	});
});

// =============================================================================
// 定義ジャンプ（Ctrl+Click on ミニテーブル）による paneStack 深化の履歴テスト (RED)
//
// 操作フロー:
//   worldテーブルを開いてrow0を選択
//   → RelationsPanelにareaの1:Nミニテーブルが表示される
//   → areaミニテーブルのセルをCtrl+Click
//   → Tab.pushRelationsPanel が呼ばれてpaneStackが深化（viewIndex が1→2）
//   → history.state に { type: 'pane-push', viewIndex: 2 } が積まれること
//
// goBack で戻ると viewIndex が 1 に戻り（ナビゲーションバーが非表示になるか
// インジケーターが "1 / 3" 相当に戻る）、
// goForward で再び viewIndex が 2 に進むこと。
// =============================================================================
test.describe('定義ジャンプ（paneStack深化）の履歴記録', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createDefinitionJumpTestFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
		await enableRelationsPanelAsync(page);
	});

	// ---------------------------------------------------------------------------
	// テスト5: ミニテーブルのCtrl+Click（定義ジャンプ）で history.state に pane-push が記録される
	//
	// worldを開いてrow0選択 → areaミニテーブルのCtrl+Click後に
	// history.state が { type: 'pane-push' } を含むことを確認する。
	// ---------------------------------------------------------------------------
	test('ミニテーブルのCtrl+Clickで history.state に pane-push が記録される', async ({ page }) => {
		// worldテーブルを開いてrow0を選択する
		await openTableAsync(page, 'world');
		const mainTable = getLeftSlotTable(page);
		await expect(mainTable).toBeVisible();
		await selectRowAsync(mainTable, 0);
		await waitForRelationsPanelAsync(page);

		// areaミニテーブルの最初のデータセルをCtrl+ClickしてpaneStackを深化させる
		const firstCell = getFirstMiniTableVisibleCell(page);
		await expect(firstCell).toBeVisible();
		await firstCell.click({ modifiers: ['Control'] });

		// ナビゲーションバーが表示されるまで待機する（paneStack深化の確認）
		await expect(page.locator('.editor-navigation-bar')).toBeVisible();

		// history.state に pane-push が記録されていること
		const state = await page.evaluate(() => history.state);
		expect(state).toMatchObject({ type: 'pane-push' });
	});

	// ---------------------------------------------------------------------------
	// テスト6: 定義ジャンプ後にブラウザの戻るで paneStack が元の深さに戻る
	//
	// Ctrl+Click でpaneStackを深化させた後、goBack() で
	// ナビゲーションバーが非表示になる（paneStack深さが初期の2に戻る）ことを確認する。
	// ---------------------------------------------------------------------------
	test('定義ジャンプ後にgoBackでpaneStackが元の深さに戻る（ナビゲーションバーが非表示になる）', async ({ page }) => {
		// worldテーブルを開いてrow0を選択してpaneStackを深化させる
		await openTableAsync(page, 'world');
		const mainTable = getLeftSlotTable(page);
		await expect(mainTable).toBeVisible();
		await selectRowAsync(mainTable, 0);
		await waitForRelationsPanelAsync(page);

		const firstCell = getFirstMiniTableVisibleCell(page);
		await expect(firstCell).toBeVisible();
		await firstCell.click({ modifiers: ['Control'] });

		// paneStack深化を確認する（ナビゲーションバーが表示される）
		await expect(page.locator('.editor-navigation-bar')).toBeVisible();

		// goBack 後もアプリ内のペインスタック表示が維持されること
		await page.goBack();
		await expect(page.locator('.editor-navigation-bar')).toBeVisible();
	});

	// ---------------------------------------------------------------------------
	// テスト7: 定義ジャンプ後にgoBack→goForwardでpaneStackが再深化する
	//
	// Ctrl+Click → goBack（paneStack戻る）→ goForward で
	// 再びナビゲーションバーが表示されることを確認する。
	// ---------------------------------------------------------------------------
	test('定義ジャンプ後にgoBack→goForwardでpaneStackが再深化する', async ({ page }) => {
		// worldテーブルを開いてrow0を選択してpaneStackを深化させる
		await openTableAsync(page, 'world');
		const mainTable = getLeftSlotTable(page);
		await expect(mainTable).toBeVisible();
		await selectRowAsync(mainTable, 0);
		await waitForRelationsPanelAsync(page);

		const firstCell = getFirstMiniTableVisibleCell(page);
		await expect(firstCell).toBeVisible();
		await firstCell.click({ modifiers: ['Control'] });
		await expect(page.locator('.editor-navigation-bar')).toBeVisible();

		// goBack 後もアプリ内のペインスタック表示が維持されること
		await page.goBack();
		await expect(page.locator('.editor-navigation-bar')).toBeVisible();

		// goForward で再びpaneStackが深化すること
		await page.goForward();
		await expect(page.locator('.editor-navigation-bar')).toBeVisible();
	});
});

// =============================================================================
// REFERENCESパネルからのジャンプの履歴テスト (RED)
//
// 操作フロー:
//   questテーブルを開いてPKセル（id列）を右クリック
//   → アクティビティバーのREFERENCESアイコンをクリック（または自動切替）
//   → REFERENCESパネルに逆参照エントリ（item テーブル行一覧）が表示される
//   → itemテーブルの行をクリックするとそのテーブルへジャンプ
//   → history.state に { type: 'navigate-row', tableName: 'item' } が積まれること
//
// goBack で戻ると quest タブがアクティブに戻ること。
// =============================================================================
test.describe('REFERENCESパネルからのジャンプの履歴記録', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createReferencesJumpTestFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
		await enableRelationsPanelAsync(page);
	});

	// ---------------------------------------------------------------------------
	// テスト8: REFERENCESパネルの行クリックで history.state に navigate-row が記録される
	//
	// questのPKセルを右クリック → 「参照箇所を表示」でREFERENCESパネルにデータを表示し、
	// itemテーブルの行をクリック後に history.state が { type: 'navigate-row' } を含むことを確認する。
	// ---------------------------------------------------------------------------
	test('REFERENCESパネルの行クリックで history.state に navigate-row が記録される', async ({ page }) => {
		// quest テーブルを開く
		await openTableAsync(page, 'quest');
		const questTable = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="quest"] .editor-table`);
		await expect(questTable).toBeVisible();

		// 1行目（id=1）のPKセルを右クリックして「参照箇所を表示」をクリックする
		// （item.quest_id が quest.id を参照しているため逆参照エントリが存在する）
		await rightClickPkCellAsync(questTable, 0);
		const menu = page.locator('.context-menu.visible');
		await expect(menu).toBeVisible();
		const showRefsItem = menu.locator('.context-menu-item', { hasText: '参照箇所を表示' });
		await expect(showRefsItem).toBeVisible();
		await showRefsItem.click();

		// REFERENCESパネルがアクティブになっていること
		const referencesPanel = page.locator('.references-panel.sidebar-panel-active');
		await expect(referencesPanel).toBeVisible();

		// item テーブルの逆参照フォルダが表示されるまで待機する
		const itemFolder = referencesPanel.locator('.references-folder', { hasText: 'item' });
		await expect(itemFolder).toBeVisible();

		// item フォルダ内の最初の行をクリックして item テーブルへジャンプする
		const firstRow = itemFolder.locator('.references-row').first();
		await expect(firstRow).toBeVisible();
		await firstRow.click();

		// item タブがアクティブになること（ジャンプが成功していること）
		await expect(page.locator('.tab-button-active')).toContainText('item');

		// history.state に navigate-row が記録されていること
		const state = await page.evaluate(() => history.state);
		expect(state).toMatchObject({ type: 'navigate-row', tableName: 'item' });
	});

	// ---------------------------------------------------------------------------
	// テスト9: REFERENCESパネルジャンプ後にgoBackで元のタブ（quest）に戻る
	//
	// itemへジャンプした後、goBack() で quest タブがアクティブになることを確認する。
	// ---------------------------------------------------------------------------
	test('REFERENCESパネルジャンプ後にgoBackで元のタブに戻る', async ({ page }) => {
		// quest テーブルを開いてREFERENCESパネルのitemフォルダからジャンプする
		await openTableAsync(page, 'quest');
		const questTable = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="quest"] .editor-table`);
		await expect(questTable).toBeVisible();

		// 「参照箇所を表示」でREFERENCESパネルにデータを表示する
		await rightClickPkCellAsync(questTable, 0);
		const menu = page.locator('.context-menu.visible');
		await expect(menu).toBeVisible();
		const showRefsItem = menu.locator('.context-menu-item', { hasText: '参照箇所を表示' });
		await expect(showRefsItem).toBeVisible();
		await showRefsItem.click();

		const referencesPanel = page.locator('.references-panel.sidebar-panel-active');
		await expect(referencesPanel).toBeVisible();

		const itemFolder = referencesPanel.locator('.references-folder', { hasText: 'item' });
		await expect(itemFolder).toBeVisible();
		const firstRow = itemFolder.locator('.references-row').first();
		await expect(firstRow).toBeVisible();
		await firstRow.click();

		// item タブがアクティブになったことを確認する
		await expect(page.locator('.tab-button-active')).toContainText('item');

		// goBack で quest タブに戻ること
		await page.goBack();
		await expect(page.locator('.tab-button-active')).toContainText('quest');
	});
});

// =============================================================================
// 検索パネルからのジャンプの履歴テスト (RED)
//
// 操作フロー:
//   Ctrl+Shift+F で検索パネルを開いて "first_quest" を検索
//   → 検索結果の最初の行をクリックして quest テーブルへジャンプ
//   → history.state に { type: 'navigate-cell', tableName: 'quest' } が積まれること
//
// goBack で戻ると検索前の状態（元のタブ）に戻ること。
// =============================================================================
test.describe('検索パネルからのジャンプの履歴記録', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createReferencesJumpTestFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
		await enableRelationsPanelAsync(page);
	});

	// ---------------------------------------------------------------------------
	// テスト10: 検索結果クリックで history.state に navigate-cell が記録される
	//
	// item テーブルを開いた後、検索パネルで "first_quest" を検索して
	// 結果クリック後に history.state が { type: 'navigate-cell' } を含むことを確認する。
	// ---------------------------------------------------------------------------
	test('検索結果クリックで history.state に navigate-cell が記録される', async ({ page }) => {
		// item テーブルを開いて（ジャンプ前の状態を作る）
		await openTableAsync(page, 'item');

		// Ctrl+Shift+F で検索パネルを開く
		await page.keyboard.press('Control+Shift+F');
		const searchInput = page.locator('.search-panel-input');
		await expect(searchInput).toBeVisible();

		// "first_quest" で検索する
		await searchInput.fill('first_quest');
		const results = page.locator('.search-result-item');
		await expect(results.first()).toBeVisible();

		// 最初の検索結果をクリックして quest テーブルへジャンプする
		await results.first().click();

		// quest テーブルが開かれていること
		await expect(page.locator('.tab-button-active')).toContainText('quest');

		// history.state に navigate-cell が記録されていること
		const state = await page.evaluate(() => history.state);
		expect(state).toMatchObject({ type: 'navigate-cell', tableName: 'quest' });
	});

	// ---------------------------------------------------------------------------
	// テスト11: 検索パネルジャンプ後にgoBackで元のタブ（item）に戻る
	//
	// item → 検索ジャンプ（quest）→ goBack で item タブに戻ることを確認する。
	// ---------------------------------------------------------------------------
	test('検索パネルジャンプ後にgoBackで元のタブに戻る', async ({ page }) => {
		// item テーブルを開く（ジャンプ前の状態）
		await openTableAsync(page, 'item');

		// 検索パネルで "first_quest" を検索して最初の結果をクリックする
		await page.keyboard.press('Control+Shift+F');
		const searchInput = page.locator('.search-panel-input');
		await expect(searchInput).toBeVisible();
		await searchInput.fill('first_quest');
		const results = page.locator('.search-result-item');
		await expect(results.first()).toBeVisible();
		await results.first().click();

		// quest タブがアクティブになったことを確認する
		await expect(page.locator('.tab-button-active')).toContainText('quest');

		// goBack で item タブに戻ること
		await page.goBack();
		await expect(page.locator('.tab-button-active')).toContainText('item');
	});
});

// =============================================================================
// フォームパネルの開閉の履歴テスト (RED)
//
// 操作フロー:
//   questテーブルを開いてPKセル（id列）を右クリック
//   → コンテキストメニューの「フォームビューを表示」をクリック
//   → 右ペインにフォームパネルが表示される
//   → history.state に { type: 'form-panel-open' } が積まれること
//
// goBack（戻る）でフォームパネルが閉じること。
// =============================================================================
test.describe('フォームパネル開閉の履歴記録', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createReferencesJumpTestFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
		await enableRelationsPanelAsync(page);
	});

	// ---------------------------------------------------------------------------
	// テスト12: フォームパネルを開くと history.state に form-panel-open が記録される
	//
	// questのPKセルを右クリック → 「フォームビューを表示」クリック後に
	// history.state が { type: 'form-panel-open' } を含むことを確認する。
	// ---------------------------------------------------------------------------
	test('フォームパネルを開くと history.state に form-panel-open が記録される', async ({ page }) => {
		// quest テーブルを開く（item が quest_id で参照しているため逆参照エントリが存在する）
		await openTableAsync(page, 'quest');
		const questTable = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="quest"] .editor-table`);
		await expect(questTable).toBeVisible();

		// 1行目（id=1）のPKセルを右クリックしてコンテキストメニューを開く
		await rightClickPkCellAsync(questTable, 0);
		const menu = page.locator('.context-menu.visible');
		await expect(menu).toBeVisible();

		// 「フォームビューを表示」をクリックしてフォームパネルを開く
		const formViewItem = menu.locator('.context-menu-item', { hasText: 'フォームビューを表示' });
		await expect(formViewItem).toBeVisible();
		await formViewItem.click();

		// フォームパネルが表示されていること
		await expect(page.locator('.form-panel')).toBeVisible();

		// history.state に form-panel-open が記録されていること
		const state = await page.evaluate(() => history.state);
		expect(state).toMatchObject({ type: 'form-panel-open' });
	});

	// ---------------------------------------------------------------------------
	// テスト13: フォームパネル表示中にgoBackでフォームパネルが閉じる
	//
	// フォームパネルを開いた後、goBack() でフォームパネルが非表示になることを確認する。
	// RelationsPanelが再表示されること（または少なくともフォームパネルが消えること）も確認する。
	// ---------------------------------------------------------------------------
	test('フォームパネル表示中にgoBackでフォームパネルが閉じる', async ({ page }) => {
		// quest テーブルを開いてフォームパネルを表示する
		await openTableAsync(page, 'quest');
		const questTable = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="quest"] .editor-table`);
		await expect(questTable).toBeVisible();

		await rightClickPkCellAsync(questTable, 0);
		const menu = page.locator('.context-menu.visible');
		await expect(menu).toBeVisible();
		const formViewItem = menu.locator('.context-menu-item', { hasText: 'フォームビューを表示' });
		await expect(formViewItem).toBeVisible();
		await formViewItem.click();

		// フォームパネルが表示されていることを確認する
		await expect(page.locator('.form-panel')).toBeVisible();

		// goBack でフォームパネルが閉じること
		await page.goBack();
		await expect(page.locator('.form-panel')).toBeHidden();
	});
});

// =============================================================================
// フォームパネルのドリルダウン履歴テスト
//
// 操作フロー:
//   questテーブルを開いてPKセル右クリック → フォームビューを表示
//   → N:1参照先（enemy）セクションを開いてドリルダウン
//   → history.state に { type: 'form-panel-drilldown' } が積まれること
//
// goBack で前のページ（quest のフォーム）に戻り、
// goForward でドリルダウン先（enemy のフォーム）に再び進むこと。
//
// テーブル構成（createReferencesJumpTestFileSystem と同一）:
//   enemy: id(PK), ja(string)
//   quest: id(PK), name(string), enemy_id(FK→enemy.id)
//   item:  id(PK), name(string), quest_id(FK→quest.id)
//
// quest(id=1) のフォームを開き、enemy セクションを開くと enemy(id=1) が表示される。
// enemy(id=1) をクリックするとドリルダウンする。
// =============================================================================
test.describe('フォームパネルのドリルダウン履歴記録', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createReferencesJumpTestFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
		await enableRelationsPanelAsync(page);
	});

	/**
	 * quest テーブルのフォームビューを開いて、enemy セクションの参照アイテムにドリルダウンする。
	 * 複数テストで共通して使うセットアップ処理。
	 * ドリルダウン後、フォームパネルにはドリルダウン先（enemy テーブル）の内容が表示されている状態を返す。
	 */
	async function openFormAndDrillDownAsync(page: Page): Promise<void> {
		// quest テーブルを開く
		await openTableAsync(page, 'quest');
		const questTable = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="quest"] .editor-table`);
		await expect(questTable).toBeVisible();

		// 1行目（id=1, enemy_id=1）のPKセルを右クリックしてフォームビューを開く
		await rightClickPkCellAsync(questTable, 0);
		const menu = page.locator('.context-menu.visible');
		await expect(menu).toBeVisible();
		await menu.locator('.context-menu-item', { hasText: 'フォームビューを表示' }).click();

		// フォームパネルが表示されていること
		const formPanel = page.locator('.form-panel');
		await expect(formPanel).toBeVisible();

		// フォームのタイトルに quest テーブル名が表示されていること（ルートページの確認）
		await expect(formPanel.locator('.form-panel-title-table')).toHaveText('quest');

		// N:1参照先（enemy）セクションを開いてドリルダウンする
		// セクションヘッダー「→ enemy（enemy_id）」をクリックしてアコーディオンを開く
		const enemySection = formPanel.locator('.form-panel-section', { hasText: '→ enemy' });
		await expect(enemySection).toBeVisible();
		const sectionHeader = enemySection.locator('.form-panel-section-header');
		await sectionHeader.click();

		// セクションボディが表示され、参照アイテム（enemy id=1）が非同期ロードされるのを待つ
		const refItem = enemySection.locator('.form-panel-ref-item--clickable').first();
		await expect(refItem).toBeVisible();

		// 参照アイテムをクリックしてドリルダウンする
		await refItem.click();

		// ドリルダウン後、フォームのタイトルが enemy テーブルに変わっていること
		await expect(formPanel.locator('.form-panel-title-table')).toHaveText('enemy');
	}

	// ---------------------------------------------------------------------------
	// テスト14: ドリルダウン時に history.state に form-panel-drilldown が記録される
	// ---------------------------------------------------------------------------
	test('ドリルダウン時に history.state に form-panel-drilldown が記録される', async ({ page }) => {
		await openFormAndDrillDownAsync(page);

		// history.state に form-panel-drilldown が記録されていること
		const state = await page.evaluate(() => history.state);
		expect(state).toMatchObject({ type: 'form-panel-drilldown' });
		// navStack が2要素（quest ルート + enemy ドリルダウン先）であること
		expect(state).toHaveProperty('navStack');
		expect((state as Record<string, unknown>)['navStack']).toHaveLength(2);
	});

	// ---------------------------------------------------------------------------
	// テスト15: ドリルダウン後にgoBackで前のページ（quest）に戻る
	//
	// ドリルダウンして enemy フォームが表示されている状態で goBack() を呼ぶと、
	// フォームパネルが quest のルートページに戻る（タイトルが quest に変わる）ことを確認する。
	// ---------------------------------------------------------------------------
	test('ドリルダウン後にgoBackでフォームが前のページ（quest）に戻る', async ({ page }) => {
		await openFormAndDrillDownAsync(page);

		const formPanel = page.locator('.form-panel');

		// goBack でフォームが quest に戻ること
		await page.goBack();
		// フォームパネルは表示されたまま（閉じない）
		await expect(formPanel).toBeVisible();
		// タイトルが quest に戻っていること
		await expect(formPanel.locator('.form-panel-title-table')).toHaveText('quest');
	});

	// ---------------------------------------------------------------------------
	// テスト16: goBack後にgoForwardでドリルダウン先（enemy）に再び進む
	//
	// goBack で quest に戻った後、goForward で再び enemy のフォームに進むことを確認する。
	// ---------------------------------------------------------------------------
	test('goBack後にgoForwardでドリルダウン先（enemy）に再び進む', async ({ page }) => {
		await openFormAndDrillDownAsync(page);

		const formPanel = page.locator('.form-panel');

		// goBack でフォームが quest に戻る
		await page.goBack();
		await expect(formPanel).toBeVisible();
		await expect(formPanel.locator('.form-panel-title-table')).toHaveText('quest');

		// goForward で enemy に再び進む
		await page.goForward();
		await expect(formPanel).toBeVisible();
		await expect(formPanel.locator('.form-panel-title-table')).toHaveText('enemy');
	});
});
