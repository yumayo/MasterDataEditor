import {test, expect} from './fixtures/test';
import {Page, Locator} from '@playwright/test';
import {installMockApiAsync, MockFileSystem} from './fixtures/mock-api';
import {expectCsvAsync} from './fixtures/test-utils';

/**
 * 検索と置換テスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   item: id(PK), name, value
 *   行データ: (1, "Sword", "100"), (2, "Shield", "200"), (3, "Sword_EX", "300")
 */
function createReplaceTestFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "name", type: "string"},
                {key: 2, name: "value", type: "int"},
            ],
            primary_key: ["id"],
        }),
        "data/item.csv": [
            "id,name,value",
            "1,Sword,100",
            "2,Shield,200",
            "3,Sword_EX,300",
        ].join("\n"),
    };
}

/**
 * テーブルを開いてエディターテーブルが表示されるまで待機する
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * 検索パネルの検索入力要素を取得する
 */
function getSearchInput(page: Page): Locator {
    return page.locator('.search-panel-input');
}

/**
 * 置換入力要素を取得する
 */
function getReplaceInput(page: Page): Locator {
    return page.locator('.search-panel-replace-input');
}

/**
 * 検索結果アイテムを取得する
 */
function getSearchResults(page: Page): Locator {
    return page.locator('.search-result-item');
}

/**
 * 検索オプションボタンを取得する
 */
function getOptionButton(page: Page, option: string): Locator {
    return page.locator(`.search-option-button[data-option="${option}"]`);
}

test.describe('検索と置換機能', () => {
    test.beforeEach(async ({page}) => {
        const fs = createReplaceTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        // 置換対象は「開いているテーブルのみ」のため、テーブルを開いておく
        await openTableAsync(page, 'item');
    });

    test('Ctrl+Hで置換モードが起動し置換入力欄が表示される', async ({page}) => {
        await page.keyboard.press('Control+h');
        // SEARCHパネルが表示されていること
        const searchPanel = page.locator('.search-panel.sidebar-panel-active');
        await expect(searchPanel).toBeVisible();
        // 置換入力欄が表示されていること
        const replaceInput = getReplaceInput(page);
        await expect(replaceInput).toBeVisible();
        // 置換ボタンが表示されていること
        const replaceButton = page.locator('.search-replace-button');
        await expect(replaceButton).toBeVisible();
        // すべて置換ボタンが表示されていること
        const replaceAllButton = page.locator('.search-replace-all-button');
        await expect(replaceAllButton).toBeVisible();
    });

    test('Ctrl+Shift+Fでは置換入力欄が表示されない', async ({page}) => {
        await page.keyboard.press('Control+Shift+F');
        // SEARCHパネルが表示されていること
        const searchPanel = page.locator('.search-panel.sidebar-panel-active');
        await expect(searchPanel).toBeVisible();
        // 置換入力欄が非表示であること
        const replaceInput = getReplaceInput(page);
        await expect(replaceInput).not.toBeVisible();
    });

    test('置換ボタンでカレントマッチが1件置換される', async ({page}) => {
        await page.keyboard.press('Control+h');
        const searchInput = getSearchInput(page);
        const replaceInput = getReplaceInput(page);
        // "Sword"を検索（"Sword"と"Sword_EX"の2件がマッチ）
        await searchInput.fill('Sword');
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible();
        // 最初の結果をクリックしてカレントマッチにする
        await results.first().click();
        // フォーカス状態のアイテムが存在すること
        const focusedItem = page.locator('.search-result-item-focused');
        await expect(focusedItem).toBeVisible();
        // 置換文字列を入力
        await replaceInput.fill('Blade');
        // 置換ボタンをクリック
        await page.locator('.search-replace-button').click();
        // 保存: Ctrl+S はグローバルハンドラで処理される。Dirtyマーク消去で保存完了を待機する。
        await page.keyboard.press('Control+s');
        const dirtyMark = page.locator('.tab-button-dirty');
        await expect(dirtyMark).not.toHaveClass(/tab-button-dirty-visible/);
        await expectCsvAsync(page, 'data/item.csv', `
            id, name,      value
            1,  Blade,     100
            2,  Shield,    200
            3,  Sword_EX,  300
        `);
    });

    test('すべて置換で全マッチが一括置換される', async ({page}) => {
        await page.keyboard.press('Control+h');
        const searchInput = getSearchInput(page);
        const replaceInput = getReplaceInput(page);
        // "Sword"を検索（"Sword"と"Sword_EX"の2件がマッチ）
        await searchInput.fill('Sword');
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible();
        // 置換文字列を入力
        await replaceInput.fill('Blade');
        // すべて置換ボタンをクリック
        await page.locator('.search-replace-all-button').click();
        // 保存: Dirtyマーク消去で保存完了を待機する
        await page.keyboard.press('Control+s');
        await expect(page.locator('.tab-button-dirty')).not.toHaveClass(/tab-button-dirty-visible/);
        await expectCsvAsync(page, 'data/item.csv', `
            id, name,      value
            1,  Blade,     100
            2,  Shield,    200
            3,  Blade_EX,  300
        `);
    });

    test('置換後にCtrl+Zでundo可能', async ({page}) => {
        await page.keyboard.press('Control+h');
        const searchInput = getSearchInput(page);
        const replaceInput = getReplaceInput(page);
        // "Sword"を全置換
        await searchInput.fill('Sword');
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible();
        await replaceInput.fill('Blade');
        await page.locator('.search-replace-all-button').click();
        // Undoで元に戻す（1回のUndoで全件戻る）
        await page.keyboard.press('Control+z');
        // 保存: Dirtyマーク消去で保存完了を待機する
        await page.keyboard.press('Control+s');
        await expect(page.locator('.tab-button-dirty')).not.toHaveClass(/tab-button-dirty-visible/);
        await expectCsvAsync(page, 'data/item.csv', `
            id, name,      value
            1,  Sword,     100
            2,  Shield,    200
            3,  Sword_EX,  300
        `);
    });

    test('正規表現キャプチャグループで置換できる', async ({page}) => {
        await page.keyboard.press('Control+h');
        const searchInput = getSearchInput(page);
        const replaceInput = getReplaceInput(page);
        // 正規表現を有効にする
        const regexButton = getOptionButton(page, 'regex');
        await regexButton.click();
        // キャプチャグループ付き正規表現: "Sword" → "SWORD" (大文字化)、"_EX"サフィックスを保持
        // 検索: S(word) → 置換: UPPER_$1 でキャプチャグループ参照テスト
        await searchInput.fill('S(word)');
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible();
        await replaceInput.fill('UPPER_$1');
        // すべて置換
        await page.locator('.search-replace-all-button').click();
        // 保存: Dirtyマーク消去で保存完了を待機する
        await page.keyboard.press('Control+s');
        await expect(page.locator('.tab-button-dirty')).not.toHaveClass(/tab-button-dirty-visible/);
        await expectCsvAsync(page, 'data/item.csv', `
            id, name,          value
            1,  UPPER_word,    100
            2,  Shield,        200
            3,  UPPER_word_EX, 300
        `);
    });

    test('置換入力時に結果リストにプレビューが表示される', async ({page}) => {
        await page.keyboard.press('Control+h');
        const searchInput = getSearchInput(page);
        const replaceInput = getReplaceInput(page);
        // "Sword"を検索
        await searchInput.fill('Sword');
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible();
        // 置換文字列を入力するとプレビューが表示される
        await replaceInput.fill('Blade');
        // 各結果アイテムにプレビュー要素が表示されていること
        const previews = page.locator('.search-result-replace-preview');
        await expect(previews.first()).toBeVisible();
        // プレビューに置換後の値が表示されていること
        // "Sword" → "Blade" のプレビュー
        await expect(previews.first()).toContainText('Blade');
    });
});
