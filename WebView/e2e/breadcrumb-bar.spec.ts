import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// パンくずバーの Editor レベル配置テスト
//
// 目標のDOM構造:
//   .editor (display: flex, flex-direction: column)
//   ├── .editor-breadcrumb-bar（パンくずバー、1本）
//   └── .editor-content (display: flex, flex-direction: row, flex: 1)
//       ├── .editor-left-pane
//       └── .relations-panel
//
// パンくずバーは .editor 直下の .editor-breadcrumb-bar として配置されている。
// =============================================================================

/**
 * テスト用ファイルシステムを生成する。
 *
 * テーブル構成:
 *   enemy: id, ja（敵名テーブル）
 *   quest: id, name, enemy_id（クエスト。enemy.id をFKとして参照）
 *
 * 定義ジャンプのシナリオ:
 *   1. quest テーブルを開いて1行目を選択する
 *   2. enemy_id セル（FK列）で Ctrl+Click または F12 を押す
 *   3. enemy テーブルの id=1 の行にジャンプする
 *   → この時点で quest が遷移履歴に積まれ、パンくずバーが表示されるべき
 */
function createBreadcrumbBarTestFileSystem(): MockFileSystem {
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
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                // enemy.id を FK として参照する
                { key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
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
 * エクスプローラーからテーブルを開き、左ペインのアクティブな EditorTable の Locator を返す。
 * RelationsPanel 内にもミニテーブル（.editor-table）が存在するため、
 * アクティブタブで絞り込んだ可視状態の1つを返す。
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    // アクティブタブが tableName になるまで待機することでジャンプ完了を確認する
    const activeTab = page.locator('.tab-button-active');
    await expect(activeTab).toHaveText(tableName);
    // 左ペインの可視テーブルを返す（RelationsPanelのミニテーブルは非表示）
    const table = page.locator('.editor-left-pane .editor-table:visible');
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
 * FK列セルを Ctrl+Click して定義ジャンプを実行する
 * quest の1行目 enemy_id 列（参照列）を対象にする
 *
 * FK列セルの取得方法:
 *   .editor-left-pane の主テーブルで、ヘッダー行・行ヘッダー・コーナーセルを除いたデータセル群から
 *   FK参照列（enemy_id列）を含む1行目データセルを取得する。
 *   reference 属性を持つ列は .cell-reference-hint を内包するため、それでフィルタリングする。
 *   参照ヒントは行を選択した後（selectRowAsync後）に描画される。
 */
async function ctrlClickFkCellAsync(page: Page): Promise<void> {
    // .cell-reference-hint を持つセルが FK 列セル
    const fkCell = page.locator(
        '.editor-left-pane .editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell)'
    ).filter({ has: page.locator('.cell-reference-hint') }).first();
    await expect(fkCell).toBeVisible();
    await fkCell.click({ modifiers: ['Control'] });
}

// =============================================================================
// テストスイート1: パンくずバーの配置
// =============================================================================

test.describe('パンくずバーの Editor レベル配置', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createBreadcrumbBarTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        '.editor 直下に .editor-breadcrumb-bar 要素が存在すること',
        async ({ page }) => {
            // 定義ジャンプ後にパンくずバーが表示される前でも、
            // .editor-breadcrumb-bar 要素自体は DOM に存在しているべき（非表示状態で）
            const breadcrumbBar = page.locator('.editor > .editor-breadcrumb-bar');
            await expect(breadcrumbBar).toHaveCount(1);
        },
    );

    test(
        '.editor-breadcrumb-bar が .relations-panel-content の外側にあること',
        async ({ page }) => {
            // パンくずバーは .relations-panel-content の内部ではなく
            // .editor の直接の子として配置されている
            const breadcrumbInRelationsPanel = page.locator(
                '.relations-panel-content .editor-breadcrumb-bar'
            );
            await expect(breadcrumbInRelationsPanel).toHaveCount(0);
        },
    );
});

// =============================================================================
// テストスイート2: ナビゲーション履歴がない場合のバー非表示
// =============================================================================

test.describe('パンくずバーの初期状態（非表示）', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createBreadcrumbBarTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'テーブルを開いた初期状態ではパンくずバーが非表示であること',
        async ({ page }) => {
            await openTableAsync(page, 'quest');
            // ナビゲーション履歴がない状態ではバーが非表示になるべき
            const breadcrumbBar = page.locator('.editor-breadcrumb-bar');
            await expect(breadcrumbBar).not.toBeVisible();
        },
    );

    test(
        '行を選択しただけではパンくずバーが表示されないこと',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            await selectRowAsync(table, 0);
            // 行選択はナビゲーション履歴を積まないため、パンくずバーは非表示のまま
            const breadcrumbBar = page.locator('.editor-breadcrumb-bar');
            await expect(breadcrumbBar).not.toBeVisible();
        },
    );
});

// =============================================================================
// テストスイート3: 定義ジャンプ後のパンくずバー表示
// =============================================================================

test.describe('定義ジャンプ後のパンくずバー表示', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createBreadcrumbBarTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'Ctrl+Click で定義ジャンプした後にパンくずバーが表示されること',
        async ({ page }) => {
            // quest テーブルを開いて1行目を選択する
            const table = await openTableAsync(page, 'quest');
            await selectRowAsync(table, 0);

            // FK セルを Ctrl+Click して enemy テーブルにジャンプする
            await ctrlClickFkCellAsync(page);

            // アクティブタブが enemy になることで定義ジャンプ完了を確認する
            await expect(page.locator('.tab-button-active')).toHaveText('enemy');

            // ジャンプ後にパンくずバーが .editor 直下に表示されるべき
            const breadcrumbBar = page.locator('.editor > .editor-breadcrumb-bar');
            await expect(breadcrumbBar).toBeVisible();
        },
    );

    test(
        '定義ジャンプ後のパンくずバーに遷移元テーブル名（quest）が表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            await selectRowAsync(table, 0);
            await ctrlClickFkCellAsync(page);

            // アクティブタブが enemy になることで定義ジャンプ完了を確認する
            await expect(page.locator('.tab-button-active')).toHaveText('enemy');

            // パンくずバーに quest が表示されること
            const breadcrumbBar = page.locator('.editor-breadcrumb-bar');
            await expect(breadcrumbBar.getByText('quest', { exact: true })).toBeVisible();
        },
    );

    test(
        '定義ジャンプ後のパンくずバーに現在のテーブル名（enemy）が表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            await selectRowAsync(table, 0);
            await ctrlClickFkCellAsync(page);

            // アクティブタブが enemy になることで定義ジャンプ完了を確認する
            await expect(page.locator('.tab-button-active')).toHaveText('enemy');

            // パンくずバーに現在テーブル名 enemy が表示されること
            const breadcrumbBar = page.locator('.editor-breadcrumb-bar');
            await expect(breadcrumbBar.getByText('enemy')).toBeVisible();
        },
    );

    test(
        '定義ジャンプ後のパンくずバーが .relations-panel-content 内の .relations-breadcrumb ではなく ' +
        '.editor 直下の .editor-breadcrumb-bar であること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            await selectRowAsync(table, 0);
            await ctrlClickFkCellAsync(page);

            // アクティブタブが enemy になることで定義ジャンプ完了を確認する
            await expect(page.locator('.tab-button-active')).toHaveText('enemy');

            // 旧実装の .relations-breadcrumb（.relations-panel-content 内）は存在しないこと
            // 旧実装では .relations-panel-content > .relations-breadcrumb として生成されていたため、
            // 新実装では .relations-panel-content 内に .relations-breadcrumb が存在しないことを確認する
            const oldBreadcrumb = page.locator('.relations-panel-content .relations-breadcrumb');
            await expect(oldBreadcrumb).toHaveCount(0);

            // 新実装の .editor-breadcrumb-bar が存在し、visible であること
            const newBreadcrumbBar = page.locator('.editor > .editor-breadcrumb-bar');
            await expect(newBreadcrumbBar).toBeVisible();
        },
    );
});

// =============================================================================
// テストスイート4: パンくずクリックによる遷移元テーブルへの戻り
// =============================================================================

test.describe('パンくずクリックによる遷移', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createBreadcrumbBarTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'パンくずの quest をクリックすると quest テーブルに戻ること',
        async ({ page }) => {
            // quest テーブルを開いて1行目を選択する
            const table = await openTableAsync(page, 'quest');
            await selectRowAsync(table, 0);

            // FK セルで定義ジャンプして enemy テーブルに移動する
            await ctrlClickFkCellAsync(page);
            // アクティブタブが enemy になることで定義ジャンプ完了を確認する
            await expect(page.locator('.tab-button-active')).toHaveText('enemy');

            // パンくずバーが表示されるまで待機する
            const breadcrumbBar = page.locator('.editor-breadcrumb-bar');
            await expect(breadcrumbBar).toBeVisible();

            // quest パンくずアイテムをクリックして遷移元に戻る
            const questCrumb = breadcrumbBar.locator('.editor-breadcrumb-item').getByText('quest', { exact: true });
            await expect(questCrumb).toBeVisible();
            await questCrumb.click();

            // quest テーブルが左ペインにアクティブな状態で表示されること
            // タブタイトルから判断する（アクティブタブのタイトルが quest になる）
            const activeTab = page.locator('.tab-button-active');
            await expect(activeTab).toHaveText('quest');
        },
    );

    test(
        'パンくずクリック後にパンくずバーが非表示になること（履歴が空になるため）',
        async ({ page }) => {
            // quest から enemy にジャンプして1段階の履歴を作る
            const table = await openTableAsync(page, 'quest');
            await selectRowAsync(table, 0);
            await ctrlClickFkCellAsync(page);
            // アクティブタブが enemy になることで定義ジャンプ完了を確認する
            await expect(page.locator('.tab-button-active')).toHaveText('enemy');

            const breadcrumbBar = page.locator('.editor-breadcrumb-bar');
            await expect(breadcrumbBar).toBeVisible();

            // パンくずの quest をクリックして戻る（履歴が空になる）
            const questCrumb = breadcrumbBar.locator('.editor-breadcrumb-item').getByText('quest', { exact: true });
            await questCrumb.click();

            // 遷移元に戻ったため履歴が空になり、パンくずバーが非表示になるべき
            await expect(breadcrumbBar).not.toBeVisible();
        },
    );
});
