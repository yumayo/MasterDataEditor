import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

/**
 * リレーションパネルテスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   enemy: id, ja（敵名テーブル）
 *   quest: id, name, enemy_id（クエスト。enemy.jaを参照）
 */
function createRelationsPanelTestFileSystem(): MockFileSystem {
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
            "3,ゴブリン",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "enemy_id", type: "int", reference: "enemy.ja" },
            ],
            primary_key: "id",
        }),
        "data/quest.csv": [
            "id,name,enemy_id",
            "1,first_quest,1",
            "2,second_quest,2",
        ].join("\n"),
    };
}

/**
 * エディターテーブルが表示されるまで待機し、テーブルのLocatorを返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator('.editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行ヘッダーをクリックして行を選択する
 * rowIndex: 0始まり（ヘッダー行を除く）
 */
async function selectRowAsync(table: Locator, rowIndex: number): Promise<void> {
    const header = table
        .locator('.editor-table-row-header')
        .nth(rowIndex);
    await header.click();
}

test.describe('RelationsPanel', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createRelationsPanelTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        '右ペインに .relations-panel 要素が存在すること',
        async ({ page }) => {
            // エディタ右側に relations-panel が存在することを検証
            // → REDになる（まだ実装されていない）
            const relationsPanel = page.locator('.relations-panel');
            await expect(relationsPanel).toBeVisible();
        },
    );

    test(
        'テーブルを開いた初期状態で行未選択のプレースホルダーが表示されること',
        async ({ page }) => {
            await openTableAsync(page, 'quest');
            // 行が選択されていない状態では「行を選択してください」等の
            // プレースホルダーが relations-panel 内に表示される
            // → REDになる（まだ実装されていない）
            const relationsPanel = page.locator('.relations-panel');
            await expect(relationsPanel).toBeVisible();
            await expect(relationsPanel.locator('.relations-panel-placeholder')).toBeVisible();
        },
    );

    test(
        '行を選択すると relations-panel 内にコンテンツが表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            // 1行目を選択する
            await selectRowAsync(table, 0);
            // relations-panel が表示され、選択行のリレーション情報が表示される
            // → REDになる（まだ実装されていない）
            const relationsPanel = page.locator('.relations-panel');
            await expect(relationsPanel).toBeVisible();
            const content = relationsPanel.locator('.relations-panel-content');
            await expect(content).toBeVisible();
        },
    );

    test(
        '行を選択すると参照先テーブル名が relations-panel 内に表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            // quest テーブルは enemy を参照している
            // 行選択後、参照先の enemy テーブル名がパネル内に表示される
            // → REDになる（まだ実装されていない）
            await selectRowAsync(table, 0);
            const relationsPanel = page.locator('.relations-panel');
            await expect(relationsPanel.locator('.relations-table-title').getByText('enemy', { exact: true })).toBeVisible();
        },
    );

    test(
        '別の行を選択すると relations-panel の内容が更新されること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            // 1行目（first_quest, enemy_id=1 → スライム）を選択
            await selectRowAsync(table, 0);
            const relationsPanel = page.locator('.relations-panel');
            // 2行目（second_quest, enemy_id=2 → ドラゴン）を選択して内容が変わることを確認
            // → REDになる（まだ実装されていない）
            await selectRowAsync(table, 1);
            await expect(relationsPanel).toBeVisible();
            const content = relationsPanel.locator('.relations-panel-content');
            await expect(content).toBeVisible();
        },
    );
});
