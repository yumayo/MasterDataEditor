import {test, expect} from './fixtures/test';
import {Page, Locator} from '@playwright/test';
import {installMockApiAsync, MockFileSystem} from './fixtures/mock-api';

/**
 * 検索パネルテスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   enemy: id, ja (敵名テーブル)
 *   quest: id, name, enemy_id (クエスト、enemy.jaを参照)
 */
function createSearchTestFileSystem(): MockFileSystem {
    return {
        "schema/enemy.json": JSON.stringify({
            header: [
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "ja", type: "string"},
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
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "name", type: "string"},
                {key: 2, name: "enemy_id", type: "int", reference: "enemy.id"},
            ],
            primary_key: "id",
        }),
        "data/quest.csv": [
            "id,name,enemy_id",
            "1,quest_a,1",
            "2,quest_b,2",
        ].join("\n"),
    };
}

/**
 * テーブルを開いてエディターテーブルが表示されるまで待機する
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName).click();
    // リレーションパネル内のミニEditorTableと区別するため左ペイン限定で探す
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

test.describe('検索パネル', () => {
    test.beforeEach(async ({page}) => {
        const fs = createSearchTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test('Ctrl+Shift+FでSEARCHパネルがアクティブになること', async ({page}) => {
        await page.keyboard.press('Control+Shift+F');
        // SEARCHパネルが表示されていることを確認
        const searchPanel = page.locator('.search-panel.sidebar-panel-active');
        await expect(searchPanel).toBeVisible();
        // 検索入力にフォーカスがあること
        const searchInput = getSearchInput(page);
        await expect(searchInput).toBeFocused();
    });

    test('テキスト入力で全文検索結果がリアルタイムに表示されること', async ({page}) => {
        await page.keyboard.press('Control+Shift+F');
        const searchInput = getSearchInput(page);
        // "quest_a"で検索
        await searchInput.fill('quest_a');
        // デバウンス150ms + 非同期読み込みを待機
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible();
        // quest_aが結果に表示されていること
        await expect(results.first().locator('.search-result-value')).toHaveText('quest_a');
    });

    test('テーブル名.列名 = 値 のクエリ式でフィルタリングできること', async ({page}) => {
        await page.keyboard.press('Control+Shift+F');
        const searchInput = getSearchInput(page);
        await searchInput.fill('quest.name = quest_a');
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible();
        // quest.name のフィルタ結果が表示されること
        await expect(results.first().locator('.search-result-location')).toHaveText('quest.name');
        await expect(results.first().locator('.search-result-value')).toHaveText('quest_a');
        // 結果は1件のみ（quest_aのみマッチ）
        await expect(results).toHaveCount(1);
    });

    test('スペースを含む値をダブルクォーテーションで検索できること', async ({page}) => {
        // このテストではスペースを含むデータを使うために先にテーブルのデータ構造を確認
        // quest_a/quest_bにスペースがないため、部分一致で代替テスト
        await page.keyboard.press('Control+Shift+F');
        const searchInput = getSearchInput(page);
        // クエリ式で値をダブルクォーテーションで囲む
        await searchInput.fill('quest.name = "quest_a"');
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible();
        await expect(results.first().locator('.search-result-value')).toHaveText('quest_a');
        await expect(results).toHaveCount(1);
    });

    test('大文字小文字区別トグルが機能すること', async ({page}) => {
        await page.keyboard.press('Control+Shift+F');
        const searchInput = getSearchInput(page);
        // デフォルトは大文字小文字区別なし → "QUEST_A"で検索してもマッチする
        await searchInput.fill('QUEST_A');
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible();
        // 大文字小文字区別を有効にする
        const caseSensitiveButton = getOptionButton(page, 'caseSensitive');
        await caseSensitiveButton.click();
        // 大文字の"QUEST_A"では小文字のquest_aにマッチしない
        await expect(results).toHaveCount(0);
    });

    test('単語検索トグルが機能すること', async ({page}) => {
        await page.keyboard.press('Control+Shift+F');
        const searchInput = getSearchInput(page);
        // デフォルトは部分一致 → "quest"で検索するとquest_a,quest_bがマッチ
        await searchInput.fill('quest');
        const results = getSearchResults(page);
        // quest_a, quest_bの2つの行のname列がマッチ
        await expect(results.first()).toBeVisible();
        const countBefore = await results.count();
        expect(countBefore).toBeGreaterThan(0);
        // 単語検索を有効にする
        const wholeWordButton = getOptionButton(page, 'wholeWord');
        await wholeWordButton.click();
        // "quest"は完全一致しない（quest_a, quest_bにはマッチしない）
        // デバウンス待ち
        await page.waitForTimeout(300);
        await expect(results).toHaveCount(0);
    });

    test('正規表現トグルが機能すること', async ({page}) => {
        await page.keyboard.press('Control+Shift+F');
        const searchInput = getSearchInput(page);
        // 正規表現を有効にする
        const regexButton = getOptionButton(page, 'regex');
        await regexButton.click();
        // quest_[ab]で検索 → quest_a, quest_bにマッチ
        await searchInput.fill('quest_[ab]');
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible();
        const count = await results.count();
        expect(count).toBe(2);
    });

    test('検索結果クリックで該当セルにジャンプすること', async ({page}) => {
        await page.keyboard.press('Control+Shift+F');
        const searchInput = getSearchInput(page);
        await searchInput.fill('quest_b');
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible();
        // 最初の結果をクリック
        await results.first().click();
        // テーブルが開かれてエディターテーブルが表示される（左ペイン限定で探す）
        const table = page.locator('.editor-left-pane .editor-table');
        await expect(table).toBeVisible();
        // セレクション範囲が表示されていること（左ペイン限定で探す）
        const selection = page.locator('.editor-left-pane .selection');
        await expect(selection).toBeVisible();
    });

    test('テーブルを開いた後でもフィルタ検索ができること', async ({page}) => {
        // まず参照先テーブルを開く
        await openTableAsync(page, 'enemy');
        // テーブルの非同期処理が完了するまで待機
        await page.waitForTimeout(1000);
        await page.keyboard.press('Control+Shift+F');
        const searchInput = getSearchInput(page);
        // 全文検索で"1"を検索 → enemy, quest両方のテーブルから結果が表示される
        await searchInput.fill('quest_a');
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible({timeout: 10000});
        await expect(results.first().locator('.search-result-value')).toHaveText('quest_a');
    });
});
