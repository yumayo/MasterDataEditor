import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// プラグインバリデーション機能のテスト
//
// 機能概要:
//   plugins/ ディレクトリに配置されたJSファイルを読み込み、
//   ActiveRecord風APIでテーブルデータにアクセスしてカスタムバリデーションを実行する。
//   assertで収集したエラーをValidationPanelに表示する。
//
// テストケース一覧:
//   1. プラグインが正常に実行され、assertエラーがValidationPanelに表示される
//   2. assertが全てパスするプラグインではエラーが出ない
//   3. プラグインのtables APIが正しくテーブルデータにアクセスできる（where/find/count）
//   4. プラグインが存在しない場合でも正常に動作する（エラーにならない）
//   5. プラグインの構文エラー時にも他のバリデーションは正常に動作する
// =============================================================================

// =============================================================================
// フィクスチャ生成ヘルパー
// =============================================================================

/**
 * プラグインバリデーション基本テスト用ファイルシステム
 *
 * chara テーブル: id, attack, defence の3列
 * plugins/balance-check.js: attack + defence >= 100 でエラーを出すプラグイン
 */
function createPluginFileSystem(): MockFileSystem {
    return {
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "attack", type: "int" },
                { key: 2, name: "defence", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/chara.csv": [
            "id,attack,defence",
            "1,30,20",
            "2,60,50",
        ].join("\n"),
        "plugins/balance-check.js": [
            "for (const chara of tables.chara.all()) {",
            "    if (chara.attack === '' || chara.defence === '') continue;",
            "    const total = Number(chara.attack) + Number(chara.defence);",
            "    assert(total < 100, '合計値' + total + 'が100以上です', chara, 'attack');",
            "}",
        ].join("\n"),
    };
}

/**
 * assertが全パスするプラグインのファイルシステム
 * 全行の合計値が100未満
 */
function createPluginNoErrorFileSystem(): MockFileSystem {
    return {
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "attack", type: "int" },
                { key: 2, name: "defence", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/chara.csv": [
            "id,attack,defence",
            "1,10,20",
            "2,30,40",
        ].join("\n"),
        "plugins/balance-check.js": [
            "for (const chara of tables.chara.all()) {",
            "    if (chara.attack === '' || chara.defence === '') continue;",
            "    const total = Number(chara.attack) + Number(chara.defence);",
            "    assert(total < 100, '合計値' + total + 'が100以上です', chara, 'attack');",
            "}",
        ].join("\n"),
    };
}

/**
 * where/find/count APIテスト用ファイルシステム
 */
function createPluginApiTestFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "price", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/item.csv": [
            "id,name,price",
            "1,sword,100",
            "2,shield,200",
            "3,potion,50",
        ].join("\n"),
        "plugins/api-test.js": [
            "// count() テスト: アイテム数が3であること",
            "assert(tables.item.count() === 3, 'アイテム数が3ではありません: ' + tables.item.count());",
            "",
            "// where() テスト: price >= 100 のアイテムは2件",
            "const expensive = tables.item.where(r => Number(r.price) >= 100);",
            "assert(expensive.length === 2, '高額アイテムが2件ではありません: ' + expensive.length);",
            "",
            "// find() テスト: id=2 のアイテムは shield",
            "const item = tables.item.find(r => r.id === '2');",
            "assert(item !== null && item.name === 'shield', 'id=2のアイテム名がshieldではありません');",
            "",
            "// find() テスト: 存在しないアイテム → null",
            "const notFound = tables.item.find(r => r.id === '999');",
            "assert(notFound === null, '存在しないアイテムがnullではありません');",
        ].join("\n"),
    };
}

/**
 * プラグインなし（plugins/ディレクトリが存在しない）のファイルシステム
 */
function createNoPluginFileSystem(): MockFileSystem {
    return {
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "attack", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/chara.csv": [
            "id,attack",
            "1,30",
        ].join("\n"),
    };
}

/**
 * 構文エラーのあるプラグインを含むファイルシステム
 * PK重複エラーも同時に存在させて、他のバリデーションが正常動作することを確認する
 */
function createSyntaxErrorPluginFileSystem(): MockFileSystem {
    return {
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "attack", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/chara.csv": [
            "id,attack",
            "1,30",
            "1,50",
        ].join("\n"),
        "plugins/broken.js": "if (true { syntax error here }",
    };
}

// =============================================================================
// テストヘルパー関数
// =============================================================================

/** エクスプローラーのテーブル名をクリックしてテーブルを開き、EditorTableのLocatorを返す */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/** ステータスバーのエラーバッジを返す */
function getStatusBarBadge(page: Page): Locator {
    return page.locator('.status-bar-badge');
}

/** バリデーションパネルのエラーアイテムを返す */
function getValidationPanelItems(page: Page): Locator {
    return page.locator('.validation-panel .validation-panel-item');
}

/** ステータスバーのバッジをクリックしてPROBLEMSパネルを開く */
async function openValidationPanelAsync(page: Page): Promise<void> {
    await getStatusBarBadge(page).click();
}

/** 起動時バリデーションスキャン完了まで待機する */
async function waitForInitialScanAsync(page: Page): Promise<void> {
    // 起動時バリデーションスキャンはバックグラウンド非同期で実行される。
    // ステータスバーバッジのテキストが変化する（初期値 "0" から変わるか、安定する）まで待機する。
    // プラグインエラーがある場合は件数が0以上になることで完了を検知する。
    // プラグインエラーがない場合はタイムアウト前にテスト側で適宜待機する。
    await page.waitForTimeout(2000);
}

// =============================================================================
// テストケース1: プラグインが正常に実行され、assertエラーがValidationPanelに表示される
// =============================================================================

test.describe('プラグインバリデーション: assertエラーがパネルに表示される', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createPluginFileSystem());
        await page.goto('/');
    });

    test(
        'プラグインのassertエラーがバリデーションパネルとステータスバーに表示される',
        async ({ page }) => {
            // 起動時バリデーションスキャン完了を待機する
            const badge = getStatusBarBadge(page);
            // chara id=2 は attack=60 + defence=50 = 110 >= 100 なのでエラーが1件出る
            await expect(badge.locator('.status-bar-badge-count')).not.toHaveText('0', { timeout: 10000 });

            // PROBLEMSパネルを開く
            await openValidationPanelAsync(page);

            // プラグインエラー項目が表示されている
            const items = getValidationPanelItems(page);
            const pluginItems = items.filter({ hasText: 'プラグイン' });
            await expect(pluginItems.first()).toBeVisible();

            // エラーメッセージにプラグインファイル名が含まれている
            const pluginErrorWithFileName = items.filter({ hasText: 'balance-check.js' });
            await expect(pluginErrorWithFileName.first()).toBeVisible();

            // エラーメッセージにassertで指定したメッセージが含まれている
            const pluginErrorWithMessage = items.filter({ hasText: '合計値110が100以上です' });
            await expect(pluginErrorWithMessage.first()).toBeVisible();
        },
    );
});

// =============================================================================
// テストケース2: assertが全てパスするプラグインではエラーが出ない
// =============================================================================

test.describe('プラグインバリデーション: assertが全パスならエラーなし', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createPluginNoErrorFileSystem());
        await page.goto('/');
    });

    test(
        'assertが全てパスするプラグインではプラグインエラーが表示されない',
        async ({ page }) => {
            await waitForInitialScanAsync(page);

            // PROBLEMSパネルを開く
            await openValidationPanelAsync(page);

            // プラグインエラーが0件であることを確認する
            const items = getValidationPanelItems(page);
            await expect(items).toHaveCount(0);
        },
    );
});

// =============================================================================
// テストケース3: tables API (where/find/count) が正しく動作する
// =============================================================================

test.describe('プラグインバリデーション: tables APIが正しく動作する', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createPluginApiTestFileSystem());
        await page.goto('/');
    });

    test(
        'all/where/find/countが正しくテーブルデータにアクセスでき、assertが全てパスする',
        async ({ page }) => {
            await waitForInitialScanAsync(page);

            // PROBLEMSパネルを開く
            await openValidationPanelAsync(page);

            // APIテスト用プラグインの全assertがパスしていればエラーは0件
            const items = getValidationPanelItems(page);
            await expect(items).toHaveCount(0);
        },
    );
});

// =============================================================================
// テストケース4: プラグインが存在しない場合でも正常に動作する
// =============================================================================

test.describe('プラグインバリデーション: プラグインなしでも正常動作', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createNoPluginFileSystem());
        await page.goto('/');
    });

    test(
        'plugins/ディレクトリが存在しなくてもアプリが正常に起動しエラーにならない',
        async ({ page }) => {
            await waitForInitialScanAsync(page);

            // ステータスバーが表示されている（アプリがクラッシュしていない）
            const badge = getStatusBarBadge(page);
            await expect(badge).toBeVisible();

            // PROBLEMSパネルを開く
            await openValidationPanelAsync(page);

            // バリデーションエラーが0件であることを確認する
            const items = getValidationPanelItems(page);
            await expect(items).toHaveCount(0);
        },
    );
});

// =============================================================================
// テストケース5: プラグインの構文エラー時にも他のバリデーションは正常に動作する
// =============================================================================

test.describe('プラグインバリデーション: 構文エラーのプラグインでも他のバリデーションが動作する', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createSyntaxErrorPluginFileSystem());
        await page.goto('/');
    });

    test(
        '構文エラーのプラグインがあってもPK重複エラーは正常に検出され、プラグインエラーも表示される',
        async ({ page }) => {
            const badge = getStatusBarBadge(page);
            // PK重複(id=1が2行)の2件 + プラグイン構文エラー1件 = 3件以上
            // まずバッジが0でなくなるまで待機する
            await expect(badge.locator('.status-bar-badge-count')).not.toHaveText('0', { timeout: 10000 });

            // PROBLEMSパネルを開く
            await openValidationPanelAsync(page);

            const items = getValidationPanelItems(page);

            // PK重複エラーが検出されている（charaテーブルのid=1が2行）
            const pkErrors = items.filter({ hasText: 'PK重複' });
            await expect(pkErrors).toHaveCount(2);

            // プラグインの構文エラーもプラグインエラーとして表示される
            const pluginErrors = items.filter({ hasText: 'プラグイン' });
            await expect(pluginErrors.first()).toBeVisible();

            // 構文エラーのプラグインファイル名が表示されている
            const brokenPluginError = items.filter({ hasText: 'broken.js' });
            await expect(brokenPluginError.first()).toBeVisible();
        },
    );
});

// =============================================================================
// テストケース6: assertに行オブジェクトを渡すとエラーをクリックして該当セルにジャンプできる
// =============================================================================

test.describe('プラグインバリデーション: assertのコンテキスト付きエラーでセルジャンプ', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createPluginFileSystem());
        await page.goto('/');
    });

    test(
        'コンテキスト付きプラグインエラーをクリックするとテーブルが開かれ該当セルにジャンプする',
        async ({ page }) => {
            // 起動時バリデーション完了を待機する
            const badge = getStatusBarBadge(page);
            await expect(badge.locator('.status-bar-badge-count')).not.toHaveText('0', { timeout: 10000 });

            // PROBLEMSパネルを開く
            await openValidationPanelAsync(page);

            // プラグインエラー項目をクリックする（chara テーブルの行2, attack列）
            const items = getValidationPanelItems(page);
            const pluginItem = items.filter({ hasText: '合計値110が100以上です' });
            await expect(pluginItem.first()).toBeVisible();

            // エラーの location にテーブル名と行番号が表示されていること
            const locationText = pluginItem.first().locator('.validation-panel-item-location');
            await expect(locationText).toHaveText('chara 行2:');

            // エラーをクリックしてジャンプする
            await pluginItem.first().click();

            // chara テーブルが開かれ、該当セルにフォーカスが移動する
            const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="chara"] .editor-table');
            await expect(table).toBeVisible();
            const focusedCell = table.locator('.editor-table-cell-focused');
            await expect(focusedCell).toBeVisible();
        },
    );
});
