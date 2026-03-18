import { test, expect } from './fixtures/test';
import { Page } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// ブラウザ History API によるタブナビゲーション履歴テスト (RED)
//
// 機能概要:
//   タブ切替時に pushState でブラウザ履歴を記録し、
//   マウスの戻る/進むボタン（page.goBack/goForward）でタブを復元する。
//
// 実装クラス（未実装）: NavigationHistory
//   - タブ切替時に pushState({ type: 'tab-switch', tabName }, '', '#tab-xxx') を呼ぶ
//   - 初期ロード時に replaceState({ type: 'initial' }, '', '') を呼ぶ
//   - popstate イベントを受け取り、state.tabName のタブをアクティブにする
//
// 現時点では NavigationHistory が存在しないため、すべてのテストは RED。
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
			primary_key: "id",
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
			primary_key: "id",
		}),
		"data/quest.csv": [
			"id,name",
			"1,first_quest",
			"2,second_quest",
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

// =============================================================================
// テストスイート
// =============================================================================

test.describe('ブラウザ History API によるタブナビゲーション', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createNavigationTestFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
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
