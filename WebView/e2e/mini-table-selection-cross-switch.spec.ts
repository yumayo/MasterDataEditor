import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// 異なるミニテーブル間を切り替えた後に同じ行インデックスをクリックしても
// RelationsPanel が正しく更新されることを確認するテスト
//
// 根本原因（修正済み）:
//   selection.ts の updateRenderer() の lastNotifiedRow ガードが、
//   異なるミニテーブル間の切り替えを考慮していなかった。
//   修正後は lastNotifiedRow ガードを EditorTable 側に移動し、
//   ミニテーブルの場合は常に通知するよう変更した。
//
// テーブル構成:
//   chara:        id, name（キャラクターテーブル）
//   skill_name:   id, name（スキル名テーブル）
//   chara_name:   id, chara_id（→chara.id）, lang（キャラ名テーブル。charaの1:N逆参照）
//   quest_reward: id, chara_id（→chara.id）, item（報酬テーブル。charaの1:N逆参照）
//   skill:        id, chara_id（→chara.id）, skill_name_id（→skill_name.id）
//
// 再現シナリオ:
//   1. skill テーブルを開く
//   2. skill の行0を選択 → 右スロットのRP（RP1）に chara N:1ミニテーブルと
//      skill_name N:1ミニテーブルが表示される
//   3. RP1内の chara ミニテーブルの0,0セルをCtrl+Click
//      → ペインスタック追加: 左スロット=RP1、右スロット=RP2（charaのrelations）
//      RP2には skill(1:N), chara_name(1:N), quest_reward(1:N) が表示される
//   4. 左スロット（RP1）の chara ミニテーブルの0,0セルをクリック → RP2更新
//   5. 左スロット（RP1）の skill_name ミニテーブルの0,0セルをクリック → RP2更新
//   6. 再び左スロット（RP1）の chara ミニテーブルの0,0セルをクリック
//      → RP2が chara のrelations（skill, chara_name, quest_reward）に更新されるべき
// =============================================================================

/**
 * テスト用のファイルシステムを生成する
 */
function createCrossMiniTableSwitchFileSystem(): MockFileSystem {
	return {
		"schema/chara.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
			],
			primary_key: ["id"],
		}),
		"data/chara.csv": [
			"id,name",
			"1,hero",
			"2,mage",
		].join("\n"),
		"schema/skill_name.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				{ key: 1, name: "name", type: "string" },
			],
			primary_key: ["id"],
		}),
		"data/skill_name.csv": [
			"id,name",
			"1,slash",
			"2,fireball",
		].join("\n"),
		"schema/chara_name.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				// chara.id をFKとして参照する（charaから見て1:N逆参照）
				{ key: 1, name: "chara_id", type: "int", reference: "chara.id" },
				{ key: 2, name: "lang", type: "string" },
			],
			primary_key: ["id"],
		}),
		"data/chara_name.csv": [
			"id,chara_id,lang",
			"1,1,ja",
			"2,1,en",
			"3,2,ja",
		].join("\n"),
		"schema/quest_reward.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				// chara.id をFKとして参照する（charaから見て1:N逆参照）
				{ key: 1, name: "chara_id", type: "int", reference: "chara.id" },
				{ key: 2, name: "item", type: "string" },
			],
			primary_key: ["id"],
		}),
		"data/quest_reward.csv": [
			"id,chara_id,item",
			"1,1,sword",
			"2,2,staff",
		].join("\n"),
		"schema/skill.json": JSON.stringify({
			header: [
				{ key: 0, name: "id", type: "int" },
				// chara.id をFKとして参照する（N:1: skill → chara）
				{ key: 1, name: "chara_id", type: "int", reference: "chara.id" },
				// skill_name.id をFKとして参照する（N:1: skill → skill_name）
				{ key: 2, name: "skill_name_id", type: "int", reference: "skill_name.id" },
			],
			primary_key: ["id"],
		}),
		"data/skill.csv": [
			"id,chara_id,skill_name_id",
			"1,1,1",
			"2,1,2",
			"3,2,2",
		].join("\n"),
	};
}

/**
 * エクスプローラーからテーブルを開き、左スロットのEditorTable Locatorを返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
	const explorer = page.locator('#explorer');
	await explorer.getByText(tableName, { exact: true }).click();
	// ペインスタックナビゲーション未使用時は .editor-left-pane 内の EditorTable
	const table = page.locator('.editor-left-pane .editor-table');
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
 * 指定スロット内のRelationsPanel内で指定テーブル名のセクションを返す
 */
function getRelationsSectionByTable(slotLocator: Locator, page: Page, tableName: string): Locator {
	return slotLocator.locator('.relations-table-section').filter({
		has: page.locator('.relations-table-title', { hasText: tableName }),
	});
}

/** ミニテーブルのデータセル（行ヘッダー・列ヘッダー・コーナーセルを除く）のCSSセレクタ */
const MINI_TABLE_DATA_CELL_SELECTOR = '.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell)';

// =============================================================================
// テストスイート: 異なるミニテーブル間切り替え後に同じ行インデックスをクリックしても
// RelationsPanel が更新されること
// =============================================================================

test.describe('異なるミニテーブル間を切り替えた後のRelationsPanelが正しく更新されること', () => {
	test.beforeEach(async ({ page }) => {
		const fs = createCrossMiniTableSwitchFileSystem();
		await installMockApiAsync(page, fs);
		await page.goto('/');
		await enableRelationsPanelAsync(page);
	});

	// ---------------------------------------------------------------------------
	// 前提確認テスト: ペインスタック追加後に右スロットに chara のrelationsが表示されること
	// ---------------------------------------------------------------------------
	test(
		'skill のミニテーブルの chara セルをCtrl+Clickすると右スロットに chara のrelationsが表示されること',
		async ({ page }) => {
			// skill テーブルを開いて row0 を選択する
			const mainTable = await openTableAsync(page, 'skill');
			await selectRowAsync(mainTable, 0);
			await waitForRelationsPanelContentAsync(page);

			// 右スロット（RP1）に chara のN:1ミニテーブルが表示されるまで待機する
			const rightSlotRP1 = page.locator('.editor-right-slot .relations-panel');
			await expect(rightSlotRP1).toBeVisible();

			// RP1内の chara セクションのミニテーブルのデータセルを取得する
			const charaSection = getRelationsSectionByTable(rightSlotRP1, page, 'chara');
			await expect(charaSection).toBeVisible();
			const charaDataCell = charaSection.locator(MINI_TABLE_DATA_CELL_SELECTOR).first();
			await expect(charaDataCell).toBeVisible();

			// Ctrl+Clickでペインスタックを追加する
			await charaDataCell.click({ modifiers: ['Control'] });

			// ペインスタック追加後にナビゲーションバーが表示されること
			await expect(page.locator('.editor-navigation-bar')).toBeVisible();

			// 右スロットにRP2が表示され、chara の1:N逆参照テーブル（skill, chara_name, quest_reward）が存在すること
			const rightSlotRP2 = page.locator('.editor-right-slot .relations-panel');
			await expect(rightSlotRP2).toBeVisible();

			const skillSection = getRelationsSectionByTable(rightSlotRP2, page, 'skill');
			await expect(skillSection).toBeVisible();
		},
	);

	// ---------------------------------------------------------------------------
	// メインテスト: ミニテーブルAのrow0 → ミニテーブルBのrow0 → 再びミニテーブルAのrow0と
	// クリックしたとき、3回目のクリックで右スロットのRelationsPanelが更新されること
	// ---------------------------------------------------------------------------
	test(
		'左スロットのcharaミニテーブル(row0) → skill_nameミニテーブル(row0) → 再びcharaミニテーブル(row0)と' +
		'クリックすると右スロットのRelationsPanelがcharaのrelationsに更新されること',
		async ({ page }) => {
			// skill テーブルを開いて row0 を選択する
			const mainTable = await openTableAsync(page, 'skill');
			await selectRowAsync(mainTable, 0);
			await waitForRelationsPanelContentAsync(page);

			// ---- ステップ2: RP1内のcharaミニテーブルをCtrl+Click → ペインスタック追加 ----
			const rightSlotRP1 = page.locator('.editor-right-slot .relations-panel');
			await expect(rightSlotRP1).toBeVisible();

			const charaSection = getRelationsSectionByTable(rightSlotRP1, page, 'chara');
			await expect(charaSection).toBeVisible();
			const charaDataCell = charaSection.locator(MINI_TABLE_DATA_CELL_SELECTOR).first();
			await expect(charaDataCell).toBeVisible();

			// Ctrl+Clickでペインスタックに RP2 を追加する
			await charaDataCell.click({ modifiers: ['Control'] });

			// ペインスタック追加後のナビゲーションバーを確認する
			await expect(page.locator('.editor-navigation-bar')).toBeVisible();

			// この時点でのレイアウト:
			//   左スロット = RP1 (skill行のrelations: charaとskill_nameのN:1ミニテーブルを含む)
			//   右スロット = RP2 (charaのrelations: skill, chara_name, quest_rewardの1:Nミニテーブルを含む)

			// ---- ステップ3: 左スロット（RP1）のcharaミニテーブルの0,0セルをクリック ----
			// 左スロットに移動した RP1 の chara ミニテーブルのデータセルを取得する
			const leftSlotRP1 = page.locator('.editor-left-slot .relations-panel');
			await expect(leftSlotRP1).toBeVisible();

			const leftCharaSection = getRelationsSectionByTable(leftSlotRP1, page, 'chara');
			await expect(leftCharaSection).toBeVisible();
			const leftCharaDataCell = leftCharaSection.locator(MINI_TABLE_DATA_CELL_SELECTOR).first();
			await expect(leftCharaDataCell).toBeVisible();

			// クリックして chara のrow0を選択する → 右スロット（RP2）が chara のrelationsに更新される
			await leftCharaDataCell.click();

			// RP2に chara の1:N逆参照テーブルが表示されること（初回クリック後）
			const rightSlotRP2 = page.locator('.editor-right-slot .relations-panel');
			const skillSectionInRP2 = getRelationsSectionByTable(rightSlotRP2, page, 'skill');
			await expect(skillSectionInRP2).toBeVisible();

			// ---- ステップ4: 左スロット（RP1）のskill_nameミニテーブルの0,0セルをクリック ----
			const leftSkillNameSection = getRelationsSectionByTable(leftSlotRP1, page, 'skill_name');
			await expect(leftSkillNameSection).toBeVisible();
			const leftSkillNameDataCell = leftSkillNameSection.locator(MINI_TABLE_DATA_CELL_SELECTOR).first();
			await expect(leftSkillNameDataCell).toBeVisible();

			// skill_nameミニテーブルのrow0をクリックする → 右スロット（RP2）がskill_nameのrelationsに更新される
			await leftSkillNameDataCell.click();

			// RP2の内容がskill_nameのrelationsに更新されること
			// skill_nameを参照するのはskillテーブルのみ → skillが1:Nとして表示される
			await expect(rightSlotRP2).toBeVisible();

			// ---- ステップ5: 再び左スロット（RP1）のcharaミニテーブルの0,0セルをクリック ----
			// 修正前: ミニテーブルAのlastNotifiedRow=0のまま → 通知スキップ → RP2が更新されない
			// 修正後: lastNotifiedRowガードをEditorTable側に移動し、ミニテーブルは常に通知 → RP2が更新される
			await leftCharaDataCell.click();

			// ---- 期待: 右スロット（RP2）がcharaのrelationsに更新されること ----
			// chara のrow0（id=1, hero）を参照するテーブル:
			//   - skill（chara_id=1: id=1(slash), id=2(fireball)）
			//   - chara_name（chara_id=1: id=1(ja), id=2(en)）
			//   - quest_reward（chara_id=1: id=1(sword)）

			// charaのrelationsとして skill セクションが RP2 に表示されることを確認する
			await expect(skillSectionInRP2).toBeVisible();

			// chara_name セクションも RP2 に表示されることを確認する
			const charaNameSectionInRP2 = getRelationsSectionByTable(rightSlotRP2, page, 'chara_name');
			await expect(charaNameSectionInRP2).toBeVisible();

			// quest_reward セクションも RP2 に表示されることを確認する
			const questRewardSectionInRP2 = getRelationsSectionByTable(rightSlotRP2, page, 'quest_reward');
			await expect(questRewardSectionInRP2).toBeVisible();
		},
	);

});
