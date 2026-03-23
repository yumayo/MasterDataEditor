import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// BUG_0009: 設定画面が表示されないことがある問題
//
// 不具合概要:
//   Tab.activateSettingsTab() に2つの欠陥がある。
//
//   欠陥1: editor-right-slot（RelationsPanel）が非表示にならない
//     disconnectEditorTable() は内部状態クリアのみでDOMの表示制御をしない。
//     右スロット（editor-right-slot）にRelationsPanelのDOMが残り、
//     設定画面が左半分に圧縮表示される。
//
//   欠陥2: ナビゲーションバー（← 1/3 →）がリセットされない
//     paneStack/viewIndex がリセットされず updateNavigationBar() も呼ばれないため、
//     前タブのペインスタック深さ表示が設定画面にも残存する。
//
// 再現手順:
//   欠陥1: テーブルタブを開いて行を選択（RelationsPanel表示）→ 設定タブを開く
//          → editor-right-slot が残ったまま設定画面が全幅で表示されない
//
//   欠陥2: テーブルタブを開き定義ジャンプでナビゲーションバーを表示 → 設定タブを開く
//          → ナビゲーションバーが残ったまま設定画面の上部に表示される
//
// テスト状態: RED（プロダクションコードの修正前）
// =============================================================================

/**
 * BUG_0009 テスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   world: id, name（ワールドマスター）
 *   area:  id, name, world_id（→ world.id）
 *
 * world を開いて row0 を選択すると RelationsPanel に area（1:N）が表示される。
 * area ミニテーブルのセルを Ctrl+Click するとペインスタックが追加され
 * ナビゲーションバー（← N/M →）が表示される。
 */
function createBug0009TestFileSystem(): MockFileSystem {
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
	};
}

/**
 * エクスプローラーからテーブルを開き、左スロットのEditorTable Locatorを返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
	const explorer = page.locator('#explorer');
	await explorer.getByText(tableName, { exact: true }).click();
	// タブ切替後は editor-left-slot 内の visible な EditorTable を返す
	const table = page.locator('.editor-left-slot .editor-table:visible').first();
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
 * visibleなデータセルを取得するセレクタ
 */
const RIGHT_SLOT_MINI_TABLE_VISIBLE_CELL_SELECTOR = [
	'.editor-right-slot .relations-panel .editor-table',
	' .editor-table-cell:not(.editor-table-row-header)',
	':not(.editor-table-column-header)',
	':not(.editor-table-corner-cell)',
	':not([style*="display: none"])',
].join('');

// =============================================================================
// テストスイート: BUG_0009 設定タブ表示時のレイアウト問題
// =============================================================================

test.describe('BUG_0009: 設定タブ表示時のレイアウト問題', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createBug0009TestFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
		await enableRelationsPanelAsync(page);
	});

	// ---------------------------------------------------------------------------
	// テスト1: 設定タブ表示時に editor-right-slot が非表示であること
	//
	// 再現手順:
	//   1. world テーブルを開く
	//   2. row0 を選択 → RelationsPanel が右スロットに表示される
	//   3. 設定タブを開く（歯車アイコンをクリック）
	//
	// 期待:
	//   editor-right-slot が非表示（display: none または not visible）であること
	//   設定パネルが全幅で表示されること（設定ラッパーが editor-content 幅いっぱいを使えること）
	//
	// 現在の実装の問題:
	//   activateSettingsTab() が disconnectEditorTable() を呼ぶだけで
	//   editor-right-slot の display を 'none' に設定しないため、
	//   右スロットが残り設定画面が左半分に圧縮される。
	// ---------------------------------------------------------------------------
	test(
		'設定タブ表示時に editor-right-slot が非表示であること',
		async ({ page }) => {
			// world テーブルを開いて row0 を選択する（RelationsPanel表示）
			const worldTable = await openTableAsync(page, 'world');
			await selectRowAsync(worldTable, 0);

			// RelationsPanel のコンテンツが表示されるまで待機する
			await waitForRelationsPanelContentAsync(page);

			// この時点で右スロットに RelationsPanel が表示されていることを前提確認する
			await expect(page.locator('.editor-right-slot')).toBeVisible();

			// 設定タブを開く（歯車アイコンをクリック）
			const settingsButton = page.locator('.activity-bar-settings');
			await settingsButton.click();

			// 設定タブが開かれたことを確認する（前提確認）
			const settingsTabButton = page.locator('.tab-button').filter({ hasText: '設定' });
			await expect(settingsTabButton).toBeVisible();

			// =================================================================
			// アサーション: editor-right-slot が非表示であること
			//
			// 現在の実装では disconnectEditorTable() のみが呼ばれ、
			// editor-right-slot の display は変更されないため、このアサーションは失敗する。
			// 修正後は activateSettingsTab() が editor-right-slot を非表示にするため通過する。
			// =================================================================
			await expect(page.locator('.editor-right-slot')).toBeHidden();
		},
	);

	// ---------------------------------------------------------------------------
	// テスト2: 設定タブ表示時にナビゲーションバーが非表示であること
	//
	// 再現手順:
	//   1. world テーブルを開く
	//   2. row0 を選択 → RelationsPanel が右スロットに表示される
	//   3. area ミニテーブルのセルを Ctrl+Click → ペインスタックが3つになる
	//      （ナビゲーションバーに "2 / 3" が表示される）
	//   4. 設定タブを開く（歯車アイコンをクリック）
	//
	// 期待:
	//   ナビゲーションバー（.editor-navigation-bar）が非表示であること
	//   前タブのペインスタック深さが設定画面に残存しないこと
	//
	// 現在の実装の問題:
	//   activateSettingsTab() が updateNavigationBar() を呼ばず、
	//   paneStack/viewIndex もリセットしないため、
	//   ナビゲーションバーが "2 / 3" のまま設定画面上部に残存する。
	// ---------------------------------------------------------------------------
	test(
		'設定タブ表示時にナビゲーションバーが非表示であること',
		async ({ page }) => {
			// world テーブルを開いて row0 を選択する（RelationsPanel表示）
			const worldTable = await openTableAsync(page, 'world');
			await selectRowAsync(worldTable, 0);
			await waitForRelationsPanelContentAsync(page);

			// area ミニテーブルが右スロットに表示されるまで待機する
			const rightSlotMiniTable = page.locator('.editor-right-slot .relations-panel .editor-table').first();
			await expect(rightSlotMiniTable).toBeVisible();

			// area ミニテーブルのvisibleなデータセルを Ctrl+Click してペインスタックを追加する
			const visibleCell = page.locator(RIGHT_SLOT_MINI_TABLE_VISIBLE_CELL_SELECTOR).first();
			await expect(visibleCell).toBeVisible();
			await visibleCell.click({ modifiers: ['Control'] });

			// ナビゲーションバーが表示されていることを前提確認する（"2 / 3"）
			await expect(page.locator('.editor-navigation-bar')).toBeVisible();
			await expect(page.locator('.editor-navigation-bar .nav-indicator')).toHaveText('2 / 3');

			// 設定タブを開く（歯車アイコンをクリック）
			const settingsButton = page.locator('.activity-bar-settings');
			await settingsButton.click();

			// 設定タブが開かれたことを確認する（前提確認）
			const settingsTabButton = page.locator('.tab-button').filter({ hasText: '設定' });
			await expect(settingsTabButton).toBeVisible();

			// =================================================================
			// アサーション: ナビゲーションバーが非表示であること
			//
			// 現在の実装では activateSettingsTab() が updateNavigationBar() を呼ばないため、
			// ナビゲーションバーが "2 / 3" のまま残存し、このアサーションは失敗する。
			// 修正後は activateSettingsTab() がナビゲーションバーを非表示にするため通過する。
			// =================================================================
			await expect(page.locator('.editor-navigation-bar')).toBeHidden();
		},
	);

	// ---------------------------------------------------------------------------
	// テスト3: 設定タブ → テーブルタブに戻ったとき editor-right-slot が visible に戻ること
	//
	// 再現手順:
	//   1. world テーブルを開く
	//   2. row0 を選択 → RelationsPanel が右スロットに表示される
	//   3. 設定タブを開く → editor-right-slot が非表示になる
	//   4. world タブをクリック → テーブルタブに戻る
	//
	// 期待:
	//   editor-right-slot が再び visible になること
	// ---------------------------------------------------------------------------
	test(
		'設定タブ → テーブルタブに戻ったとき editor-right-slot が visible に戻ること',
		async ({ page }) => {
			// world テーブルを開いて row0 を選択する（RelationsPanel表示）
			const worldTable = await openTableAsync(page, 'world');
			await selectRowAsync(worldTable, 0);
			await waitForRelationsPanelContentAsync(page);

			// この時点で右スロットが表示されていることを前提確認する
			await expect(page.locator('.editor-right-slot')).toBeVisible();

			// 設定タブを開く
			const settingsButton = page.locator('.activity-bar-settings');
			await settingsButton.click();

			// 設定タブが開かれ右スロットが非表示になっていることを前提確認する
			const settingsTabButton = page.locator('.tab-button').filter({ hasText: '設定' });
			await expect(settingsTabButton).toBeVisible();
			await expect(page.locator('.editor-right-slot')).toBeHidden();

			// world タブをクリックしてテーブルタブに戻る
			const worldTabButton = page.locator('.tab-button').filter({ hasText: 'world' });
			await worldTabButton.click();

			// =================================================================
			// アサーション: editor-right-slot が再び表示されること
			//
			// 設定タブから通常テーブルタブへ復帰したとき leaveSettingsMode() が呼ばれ、
			// rightSlot の display が '' にリセットされた後、
			// updateVisiblePanes() によって正しく表示される。
			// =================================================================
			await expect(page.locator('.editor-right-slot')).toBeVisible();
		},
	);
});
