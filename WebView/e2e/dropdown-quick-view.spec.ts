import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// ドロップダウン クイックビュー機能のテスト
//
// 機能概要:
//   FK列のドロップダウンアイテム（.grid-dropdown-item）にマウスオーバーすると、
//   300ms後にクイックビューパネル（.dropdown-quick-view）が表示される。
//   クイックビューには参照先テーブルの関連データがHTMLテーブルとして表示される。
//   アイテムからマウスが離れるとクイックビューが非表示になる。
//   矢印キーで選択を移動してもクイックビューが更新される。
//   ドロップダウンを閉じるとクイックビューも消える。
//   300ms以内に別のアイテムへ移動した場合、前のタイマーはキャンセルされる（レースコンディション防止）。
//
// テストケース一覧:
//   1. マウスオーバーで300ms後にクイックビューが表示される
//   2. クイックビューに参照先テーブルのHTMLテーブルが表示される（ヘッダーと行）
//   3. クイックビューに参照先テーブルの列名と値が含まれる
//   4. マウスリーブでクイックビューが非表示になる
//   5. 矢印キーでの選択移動でクイックビューが更新される
//   6. ドロップダウンを閉じるとクイックビューも消える
//   7. 300ms以内に別のアイテムへ移動するとレースコンディションを防止する
//   8. クイックビューはドロップダウンの右側に表示される
// =============================================================================

// =============================================================================
// フィクスチャ生成ヘルパー
// =============================================================================

/**
 * クイックビューテスト用のファイルシステムを生成する。
 *
 * テーブル構成:
 *   reward_group: id（int）, name（string）
 *   quest: id（int）, name（string）, reward_group_id（int, → reward_group.id）
 *
 * quest.reward_group_id は FK 列として reward_group テーブルを参照する。
 * ドロップダウンで reward_group のエントリを選択するシナリオを想定。
 */
function createQuickViewTestFileSystem(): MockFileSystem {
    return {
        "schema/reward_group.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/reward_group.csv": [
            "id,name",
            "1,daily_reward",
            "2,event_reward",
            "3,login_bonus",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                // reward_group.id を FK として参照する
                { key: 2, name: "reward_group_id", type: "int", reference: "reward_group.id" },
            ],
            primary_key: "id",
        }),
        "data/quest.csv": [
            "id,name,reward_group_id",
            "1,first_quest,1",
            "2,second_quest,2",
            "3,third_quest,1",
        ].join("\n"),
    };
}

// =============================================================================
// テストユーティリティ
// =============================================================================

/**
 * Explorerでテーブルを開き、左ペインのEditorTable Locatorを返す。
 * RelationsPanelにもミニEditorTableが表示されるため、左ペインに限定する。
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行・列のデータセルを返す。
 * rowIndex: 0始まり（ヘッダー行を除く）, colIndex: 0始まり（行ヘッダーを除く）
 */
function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

/**
 * FK列のセルをダブルクリックしてドロップダウンを表示し、ドロップダウンリスト Locator を返す。
 * .grid-dropdown コンテナはゼロサイズ（子が全てabsolute）のため、
 * 既存テストと同じく .grid-dropdown-list を使用する。
 * ドロップダウンアイテムが表示されるまで待機する。
 */
async function openFkDropdownAsync(page: Page, table: Locator, rowIndex: number, fkColIndex: number): Promise<Locator> {
    const cell = getDataCell(table, rowIndex, fkColIndex);
    await cell.dblclick();
    // ドロップダウンリストが表示されるまで待機（左ペインに限定）
    const dropdownList = page.locator('.editor-left-pane .grid-dropdown-list');
    await expect(dropdownList).toBeVisible();
    // アイテムが1件以上表示されるまで待機
    await expect(dropdownList.locator('.grid-dropdown-item').first()).toBeVisible();
    return dropdownList;
}

// =============================================================================
// テスト
// =============================================================================

test.describe('ドロップダウン クイックビュー', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createQuickViewTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'マウスオーバーで300ms後にクイックビューパネルが表示される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            // 最初のドロップダウンアイテムにホバー
            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            // 300ms経過前はクイックビューが表示されていない
            // 左ペインのクイックビューに限定（RelationsPanelのミニテーブルにも存在するため）
            const quickView = page.locator('.editor-left-pane .dropdown-quick-view');
            await expect(quickView).not.toBeVisible();

            // 300ms 実時間で待機
            await page.waitForTimeout(350);

            // クイックビューパネルが表示される
            await expect(quickView).toBeVisible();
        },
    );

    test(
        'クイックビューに参照先テーブルのHTMLテーブルが表示される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();
            await page.waitForTimeout(350);

            const quickView = page.locator('.editor-left-pane .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // HTMLテーブルが存在する
            const htmlTable = quickView.locator('table');
            await expect(htmlTable).toBeVisible();

            // ヘッダー行が存在する
            const headerRow = htmlTable.locator('thead tr');
            await expect(headerRow).toBeVisible();

            // データ行が1件以上存在する
            const dataRows = htmlTable.locator('tbody tr');
            await expect(dataRows.first()).toBeVisible();
        },
    );

    test(
        'クイックビューに参照先テーブルの列名と値が含まれる',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            // 1件目（id=1, daily_reward）にホバー
            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();
            await page.waitForTimeout(350);

            const quickView = page.locator('.editor-left-pane .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // reward_group テーブルの列名が表示されている
            await expect(quickView.locator('table thead')).toContainText('id');
            await expect(quickView.locator('table thead')).toContainText('name');

            // id=1 に対応する値が表示されている
            await expect(quickView.locator('table tbody')).toContainText('1');
            await expect(quickView.locator('table tbody')).toContainText('daily_reward');
        },
    );

    test(
        'マウスリーブでクイックビューが非表示になる',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();
            await page.waitForTimeout(350);

            const quickView = page.locator('.editor-left-pane .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // アイテムからマウスを離す（ドロップダウンリスト外に移動）
            await page.mouse.move(0, 0);

            // クイックビューが非表示になる
            await expect(quickView).not.toBeVisible();
        },
    );

    test(
        '矢印キーでの選択移動でクイックビューが更新される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            // 最初のアイテム（id=1, daily_reward）にホバーしてクイックビューを表示
            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();
            await page.waitForTimeout(350);

            const quickView = page.locator('.editor-left-pane .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // 1件目の内容が表示されていることを確認
            await expect(quickView.locator('table tbody')).toContainText('daily_reward');

            // ArrowDown で2件目（id=2, event_reward）に移動
            await page.keyboard.press('ArrowDown');
            // キーボード選択によってクイックビューが即座に更新される
            await expect(quickView.locator('table tbody')).toContainText('event_reward');
        },
    );

    test(
        'ドロップダウンを閉じるとクイックビューも消える',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();
            await page.waitForTimeout(350);

            const quickView = page.locator('.editor-left-pane .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // Escape でドロップダウンを閉じる
            await page.keyboard.press('Escape');

            // ドロップダウンリストが非表示になる
            await expect(dropdown).not.toBeVisible();

            // クイックビューも非表示になる
            await expect(quickView).not.toBeVisible();
        },
    );

    test(
        '300ms以内に別のアイテムへ移動すると前のクイックビューは表示されない',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            const items = dropdown.locator('.grid-dropdown-item');
            const firstItem = items.nth(0);
            const secondItem = items.nth(1);

            // 1件目にホバー
            await firstItem.hover();

            // 150ms 経過前に2件目に移動（前のタイマーはキャンセルされるべき）
            await page.waitForTimeout(100);
            await secondItem.hover();

            // 1件目のタイマー開始から300ms以上経過してもクイックビューは未表示
            // （1件目のタイマーはキャンセル済み、2件目のタイマーはまだ300ms未達）
            await page.waitForTimeout(150);
            const quickView = page.locator('.editor-left-pane .dropdown-quick-view');
            await expect(quickView).not.toBeVisible();

            // 2件目のホバー開始から300ms以上経過させる
            await page.waitForTimeout(200);

            // 2件目のデータがクイックビューに表示される
            await expect(quickView).toBeVisible();
            await expect(quickView.locator('table tbody')).toContainText('event_reward');
        },
    );

    test(
        'クイックビューはドロップダウンの右側に表示される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();
            await page.waitForTimeout(350);

            const quickView = page.locator('.editor-left-pane .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // クイックビューがドロップダウンリストの右側に配置されている
            const listBox = await dropdown.boundingBox();
            const quickViewBox = await quickView.boundingBox();
            if (!listBox || !quickViewBox) {
                throw new Error('boundingBox が取得できません');
            }
            // クイックビューの左端 >= ドロップダウンリストの右端（右側に表示）
            expect(quickViewBox.x).toBeGreaterThanOrEqual(listBox.x + listBox.width - 1);
        },
    );
});
