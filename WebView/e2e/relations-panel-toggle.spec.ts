import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// RelationsPanel トグル機能のテスト
//
// 機能概要:
//   RelationsPanelの表示/非表示をトグルする手段を検証する。
//   1. ツールバーのRelationsトグルボタン
//
//   非表示時は左ペインが全幅を使うことも検証する。
//   非表示時はミニテーブルの構築をスキップし、再表示時に自動リフレッシュする。
// =============================================================================

/**
 * テスト用ファイルシステムを生成する
 *
 * テーブル構成:
 *   enemy: id, ja（敵名テーブル）
 *   quest: id, name, enemy_id（クエスト。enemy.idをFKとして参照）
 *
 * quest テーブルを開いて行を選択すると RelationsPanel に enemy のミニEditorTable が表示される。
 */
function createToggleTestFileSystem(): MockFileSystem {
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
    };
}

/**
 * Explorerでテーブルを開き、左ペインのEditorTableを返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    await page.locator('#explorer').getByText(tableName, { exact: true }).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行ヘッダーをクリックして行を選択する（rowIndex: 0始まり）
 */
async function selectRowAsync(table: Locator, rowIndex: number): Promise<void> {
    await table.locator('.editor-table-row-header').nth(rowIndex).click();
}

/**
 * quest テーブルを開いてパネルを表示し1行目を選択して、RelationsPanel にコンテンツを表示させる
 */
async function setupRelationsPanelAsync(page: Page): Promise<Locator> {
    const table = await openTableAsync(page, 'quest');
    // デフォルト非表示のためトグルボタンで表示する
    await page.locator('#toolbar .toolbar-button-relations-toggle').click();
    await selectRowAsync(table, 0);
    await expect(page.locator('.relations-panel-content')).toBeVisible();
    return table;
}

// =============================================================================
// 1. ツールバーのRelationsトグルボタン
// =============================================================================

test.describe('RelationsPanel トグルボタン', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createToggleTestFileSystem());
        await page.goto('/');
    });

    test('ツールバーにRelationsトグルボタンが存在すること', async ({ page }) => {
        // ツールバー内にRelationsPanel用のトグルボタンが配置されている
        const toggleButton = page.locator('#toolbar .toolbar-button-relations-toggle');
        await expect(toggleButton).toBeVisible();
    });

    test('トグルボタンクリックでRelationsPanelが非表示になること', async ({ page }) => {
        await setupRelationsPanelAsync(page);

        // 初期状態: RelationsPanelが表示されている
        const relationsPanel = page.locator('.relations-panel');
        await expect(relationsPanel).toBeVisible();

        // トグルボタンをクリックして非表示にする
        const toggleButton = page.locator('#toolbar .toolbar-button-relations-toggle');
        await toggleButton.click();

        // RelationsPanelが非表示になっていること
        await expect(relationsPanel).not.toBeVisible();
    });

    test('トグルボタンは表示中にアクティブ状態であること', async ({ page }) => {
        await setupRelationsPanelAsync(page);

        // RelationsPanel表示中はボタンがアクティブ状態（クラスで判定）
        const toggleButton = page.locator('#toolbar .toolbar-button-relations-toggle');
        await expect(toggleButton).toHaveClass(/toolbar-button-relations-active/);
    });

    test('トグルボタンは非表示時に非アクティブ状態であること', async ({ page }) => {
        await setupRelationsPanelAsync(page);

        // トグルボタンをクリックして非表示にする
        const toggleButton = page.locator('#toolbar .toolbar-button-relations-toggle');
        await toggleButton.click();

        // 非アクティブ状態（アクティブクラスが除去されている）
        await expect(toggleButton).not.toHaveClass(/toolbar-button-relations-active/);
    });

    test('非表示後にトグルボタンを再クリックするとRelationsPanelが再表示されること', async ({ page }) => {
        await setupRelationsPanelAsync(page);

        const relationsPanel = page.locator('.relations-panel');
        const toggleButton = page.locator('#toolbar .toolbar-button-relations-toggle');

        // 非表示にする
        await toggleButton.click();
        await expect(relationsPanel).not.toBeVisible();

        // 再クリックで表示する
        await toggleButton.click();
        await expect(relationsPanel).toBeVisible();
    });
});

// =============================================================================
// 2. 左ペインの全幅化
// =============================================================================

test.describe('RelationsPanel 非表示時の左ペイン全幅化', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createToggleTestFileSystem());
        await page.goto('/');
    });

    test('RelationsPanel非表示時に左ペインが全幅を使うこと', async ({ page }) => {
        await setupRelationsPanelAsync(page);

        // 表示中の左ペイン幅を記録する
        const leftWidthBefore = await page.evaluate(() => {
            const el = document.querySelector('.editor-left-slot');
            if (!el) throw new Error('.editor-left-slot が見つかりません');
            return el.getBoundingClientRect().width;
        });

        // エディターコンテンツ領域の全幅を記録する
        const contentWidth = await page.evaluate(() => {
            const el = document.querySelector('.editor-content');
            if (!el) throw new Error('.editor-content が見つかりません');
            return el.getBoundingClientRect().width;
        });

        // RelationsPanel表示中は左ペインが全幅ではないこと
        expect(leftWidthBefore).toBeLessThan(contentWidth - 50);

        // トグルボタンでRelationsPanelを非表示にする
        const toggleButton = page.locator('#toolbar .toolbar-button-relations-toggle');
        await toggleButton.click();

        // 非表示後の左ペイン幅を取得する
        const leftWidthAfter = await page.evaluate(() => {
            const el = document.querySelector('.editor-left-slot');
            if (!el) throw new Error('.editor-left-slot が見つかりません');
            return el.getBoundingClientRect().width;
        });

        // 左ペインがエディターコンテンツ領域のほぼ全幅を使っていること
        // （リサイズハンドル幅分の微小な差は許容する）
        expect(leftWidthAfter).toBeGreaterThan(contentWidth - 30);
    });

    test('RelationsPanel再表示時に左ペインが元の幅に戻ること', async ({ page }) => {
        await setupRelationsPanelAsync(page);

        // 表示中の左ペイン幅を記録する
        const leftWidthBefore = await page.evaluate(() => {
            const el = document.querySelector('.editor-left-slot');
            if (!el) throw new Error('.editor-left-slot が見つかりません');
            return el.getBoundingClientRect().width;
        });

        // 非表示にして再表示する
        const toggleButton = page.locator('#toolbar .toolbar-button-relations-toggle');
        await toggleButton.click();
        await toggleButton.click();

        // 再表示後の左ペイン幅が元の幅とほぼ同じであること（許容誤差5px）
        const leftWidthAfter = await page.evaluate(() => {
            const el = document.querySelector('.editor-left-slot');
            if (!el) throw new Error('.editor-left-slot が見つかりません');
            return el.getBoundingClientRect().width;
        });
        expect(Math.abs(leftWidthAfter - leftWidthBefore)).toBeLessThanOrEqual(5);
    });
});

// =============================================================================
// 3. 非表示時のミニテーブル構築スキップ
// =============================================================================

test.describe('RelationsPanel 非表示時のミニテーブル構築スキップ', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createToggleTestFileSystem());
        await page.goto('/');
    });

    test('非表示中に行を選択してもミニテーブルが構築されないこと', async ({ page }) => {
        const table = await setupRelationsPanelAsync(page);

        // 前提条件: パネル表示中は .relations-table-section が存在する
        const sections = page.locator('.relations-table-section');
        await expect(sections.first()).toBeVisible();

        // RelationsPanel を非表示にする
        const toggleButton = page.locator('#toolbar .toolbar-button-relations-toggle');
        await toggleButton.click();

        // 非表示中に別の行を選択する（2行目: second_quest, enemy_id=2）
        await selectRowAsync(table, 1);

        // パネルが非表示の間は、ミニテーブルセクションが DOM 上に構築されないこと。
        // visibleガードにより updateForRow / showForTableRowAsync が早期リターンするため、
        // .relations-panel-content 内にセクションが0件であることを確認する。
        const relationsContent = page.locator('.relations-panel-content');
        const sectionCount = await relationsContent.locator('.relations-table-section').count();
        expect(sectionCount).toBe(0);
    });

    test('非表示から再表示したとき現在の選択行に対応するミニテーブルが自動表示されること', async ({ page }) => {
        const table = await setupRelationsPanelAsync(page);

        // 前提条件: 1行目選択中にenemy のミニテーブルが表示されている
        await expect(page.locator('.relations-table-section').first()).toBeVisible();

        // RelationsPanel を非表示にする
        const toggleButton = page.locator('#toolbar .toolbar-button-relations-toggle');
        await toggleButton.click();

        // 非表示中に2行目を選択する（enemy_id=2 → ドラゴン）
        await selectRowAsync(table, 1);

        // RelationsPanel を再表示する
        await toggleButton.click();

        // 再表示後、現在の選択行（2行目: enemy_id=2）に対応するミニテーブルが
        // 自動的にリフレッシュされ、.relations-table-section が表示されること。
        // ミニテーブル内に「ドラゴン」のデータが表示されていることを確認する。
        const sections = page.locator('.relations-table-section');
        await expect(sections.first()).toBeVisible();

        // enemy テーブルのミニEditorTable内に enemy_id=2 に対応する「ドラゴン」が表示されること。
        // 再表示時に自動リフレッシュが行われないと、1行目選択時のデータ（スライム）のまま、
        // あるいはコンテンツが空のままになるため、2行目のデータが反映されていることを検証する。
        const miniTableCell = page.locator('.relations-panel .editor-table .editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell)');
        // enemy テーブルは id, ja の2列。2行目(enemy_id=2)の参照先は id=2, ja=ドラゴン
        // ミニテーブルのデータセルに「ドラゴン」が含まれるか確認する
        await expect(miniTableCell.filter({ hasText: 'ドラゴン' }).first()).toBeVisible();
    });
});
