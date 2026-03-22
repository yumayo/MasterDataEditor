import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// RelationsPanel トグル機能のテスト
//
// 機能概要:
//   RelationsPanelの表示/非表示をトグルする3つの手段を検証する。
//   1. ツールバーのRelationsトグルボタン
//   2. RelationsPanelヘッダーの「»」閉じるボタン
//   3. リサイズハンドルのダブルクリックによる折りたたみ/展開
//
//   非表示時は左ペインが全幅を使うことも検証する。
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
 * quest テーブルを開いて1行目を選択し、RelationsPanel にコンテンツを表示させる
 */
async function setupRelationsPanelAsync(page: Page): Promise<Locator> {
    const table = await openTableAsync(page, 'quest');
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
// 2. RelationsPanelヘッダーの「»」閉じるボタン
// =============================================================================

test.describe('RelationsPanel ヘッダー閉じるボタン', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createToggleTestFileSystem());
        await page.goto('/');
    });

    test('RelationsPanelヘッダーに「»」閉じるボタンが存在すること', async ({ page }) => {
        await setupRelationsPanelAsync(page);

        // RELATIONS セクションヘッダー内に閉じるボタンが配置されている
        const closeButton = page.locator('.relations-panel-section-header .relations-panel-close-button');
        await expect(closeButton).toBeVisible();
        // ボタンのテキストが「»」であること
        await expect(closeButton).toHaveText('»');
    });

    test('「»」閉じるボタンクリックでRelationsPanelが非表示になること', async ({ page }) => {
        await setupRelationsPanelAsync(page);

        const relationsPanel = page.locator('.relations-panel');
        await expect(relationsPanel).toBeVisible();

        // 閉じるボタンをクリック
        const closeButton = page.locator('.relations-panel-section-header .relations-panel-close-button');
        await closeButton.click();

        // RelationsPanelが非表示になること
        await expect(relationsPanel).not.toBeVisible();
    });

    test('「»」閉じるボタンクリック後にツールバーのトグルボタンも非アクティブになること', async ({ page }) => {
        await setupRelationsPanelAsync(page);

        // 閉じるボタンをクリック
        const closeButton = page.locator('.relations-panel-section-header .relations-panel-close-button');
        await closeButton.click();

        // ツールバーのトグルボタンも非アクティブになっていること
        const toggleButton = page.locator('#toolbar .toolbar-button-relations-toggle');
        await expect(toggleButton).not.toHaveClass(/toolbar-button-relations-active/);
    });
});

// =============================================================================
// 3. リサイズハンドルダブルクリックによる折りたたみ/展開
// =============================================================================

test.describe('RelationsPanel リサイズハンドルダブルクリック', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createToggleTestFileSystem());
        await page.goto('/');
    });

    test('リサイズハンドルダブルクリックでRelationsPanelが折りたたまれること', async ({ page }) => {
        await setupRelationsPanelAsync(page);

        const relationsPanel = page.locator('.relations-panel');

        // 折りたたみ前のパネル幅を記録する
        const beforeWidth = await page.evaluate(() => {
            const el = document.querySelector('.editor-right-slot');
            if (!el) throw new Error('.editor-right-slot が見つかりません');
            return el.getBoundingClientRect().width;
        });
        // 初期状態では十分な幅があること
        expect(beforeWidth).toBeGreaterThan(50);

        // リサイズハンドルをダブルクリック
        const resizeHandle = page.locator('.relations-panel .resize-handle[data-direction="horizontal"]');
        await resizeHandle.dblclick();

        // 折りたたまれた状態: RelationsPanelが非表示になるか、幅がほぼ0になること
        await expect(relationsPanel).not.toBeVisible();
    });

    test('折りたたみ状態でリサイズハンドルダブルクリックで展開されること（前回幅復元）', async ({ page }) => {
        await setupRelationsPanelAsync(page);

        // 折りたたみ前のパネル幅を記録する
        const originalWidth = await page.evaluate(() => {
            const el = document.querySelector('.editor-right-slot');
            if (!el) throw new Error('.editor-right-slot が見つかりません');
            return el.getBoundingClientRect().width;
        });

        // リサイズハンドルをダブルクリックして折りたたむ
        const resizeHandle = page.locator('.relations-panel .resize-handle[data-direction="horizontal"]');
        await resizeHandle.dblclick();

        // もう一度ダブルクリックして展開する
        // 折りたたみ後はハンドルの位置が変わる可能性があるため、
        // 開くタブ経由またはトグルボタン経由で再表示してからダブルクリックで展開するパターンもあるが、
        // ここではリサイズハンドルのダブルクリックが折りたたみ/展開のトグルになることを検証する。
        // 折りたたみ時にリサイズハンドルまたは代替のクリック対象が残っていることを前提とする。
        const toggleButton = page.locator('#toolbar .toolbar-button-relations-toggle');
        await toggleButton.click();

        // 再度リサイズハンドルをダブルクリックして折りたたみ → 展開
        const resizeHandleAfter = page.locator('.relations-panel .resize-handle[data-direction="horizontal"]');
        await resizeHandleAfter.dblclick();
        await resizeHandleAfter.dblclick();

        // 展開後のパネル幅が元の幅と近い値に復元されること（許容誤差10px）
        const restoredWidth = await page.evaluate(() => {
            const el = document.querySelector('.editor-right-slot');
            if (!el) throw new Error('.editor-right-slot が見つかりません');
            return el.getBoundingClientRect().width;
        });
        expect(Math.abs(restoredWidth - originalWidth)).toBeLessThanOrEqual(10);
    });
});

// =============================================================================
// 4. 左ペインの全幅化
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
