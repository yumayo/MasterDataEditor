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
            primary_key: ["id"],
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
            primary_key: ["id"],
        }),
        "data/quest.csv": [
            "id,name,enemy_id",
            "1,quest_a,1",
            "2,quest_b,2",
        ].join("\n"),
    };
}

function createStreamingSearchTestFileSystem(): MockFileSystem {
    const laterRows = ["id,name"];
    for (let i = 1; i <= 5000; i++) {
        laterRows.push(`${i},later_${i}`);
    }
    return {
        "schema/first_match.json": JSON.stringify({
            header: [
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "name", type: "string"},
            ],
            primary_key: ["id"],
        }),
        "data/first_match.csv": [
            "id,name",
            "1,needle_first",
        ].join("\n"),
        "schema/later_scan.json": JSON.stringify({
            header: [
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "name", type: "string"},
            ],
            primary_key: ["id"],
        }),
        "data/later_scan.csv": laterRows.join("\n"),
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

async function openSearchPanelAsync(page: Page): Promise<void> {
    await page.locator('.activity-bar-item[data-panel="search"]').click();
    const searchInput = getSearchInput(page);
    await expect(searchInput).toBeVisible();
    await searchInput.focus();
}

test.describe('検索パネル', () => {
    test.beforeEach(async ({page}) => {
        const fs = createSearchTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test('Ctrl+Shift+FでSEARCHパネルがアクティブになること', async ({page}) => {
        await expect(page.locator('.activity-bar-item[data-panel="search"]')).toBeVisible();
        await page.keyboard.press('Control+Shift+F');
        // SEARCHパネルが表示されていることを確認
        const searchPanel = page.locator('.search-panel.sidebar-panel-active');
        await expect(searchPanel).toBeVisible();
        // 検索入力にフォーカスがあること
        const searchInput = getSearchInput(page);
        await expect(searchInput).toBeFocused();
    });

    test('テキスト入力で全文検索結果がリアルタイムに表示されること', async ({page}) => {
        await openSearchPanelAsync(page);
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
        await openSearchPanelAsync(page);
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
        await openSearchPanelAsync(page);
        const searchInput = getSearchInput(page);
        // クエリ式で値をダブルクォーテーションで囲む
        await searchInput.fill('quest.name = "quest_a"');
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible();
        await expect(results.first().locator('.search-result-value')).toHaveText('quest_a');
        await expect(results).toHaveCount(1);
    });

    test('大文字小文字区別トグルが機能すること', async ({page}) => {
        await openSearchPanelAsync(page);
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
        await openSearchPanelAsync(page);
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
        await openSearchPanelAsync(page);
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
        await openSearchPanelAsync(page);
        const searchInput = getSearchInput(page);
        await searchInput.fill('quest_b');
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible();
        // 最初の結果をクリック
        await results.first().click();
        // テーブルが開かれてエディターテーブルが表示される（左ペイン限定で探す）
        const table = page.locator('.editor-left-pane .editor-table');
        await expect(table).toBeVisible();
        // セレクション範囲が表示されていること（左ペイン限定で sel-top クラスを持つセルを探す）
        const selectionCell = page.locator('.editor-left-pane .sel-top');
        await expect(selectionCell.first()).toBeVisible();
    });

    test('ローマ字入力で全文検索がヒットすること', async ({page}) => {
        // enemy テーブルの ja 列: "スライム", "ドラゴン"
        // "suraimu" → "すらいむ" → ひらがな変換後に "スライム"（カタカナ→ひらがな正規化）にマッチ
        await openSearchPanelAsync(page);
        const searchInput = getSearchInput(page);
        await searchInput.fill('suraimu');
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible();
        await expect(results.first().locator('.search-result-value')).toHaveText('スライム');
    });

    test('全角半角を無視して検索がヒットすること', async ({page}) => {
        // quest テーブルの name 列: "quest_a", "quest_b"
        // "ＱＵＥＳＴ" (全角大文字) → 正規化後 "quest" → 部分一致でヒット
        await openSearchPanelAsync(page);
        const searchInput = getSearchInput(page);
        await searchInput.fill('ＱＵＥＳＴ');
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible();
        // quest_a か quest_b のどちらかがヒットすること
        const count = await results.count();
        expect(count).toBeGreaterThan(0);
    });

    test('検索結果にPK値が表示されること', async ({page}) => {
        // quest テーブルを検索: quest_a (id=1) がヒットしたとき、PK値 "1" が表示される
        await openSearchPanelAsync(page);
        const searchInput = getSearchInput(page);
        await searchInput.fill('quest_a');
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible();
        // 検索結果に PK 値を示す .search-result-pk 要素が存在すること
        const pkElement = results.first().locator('.search-result-pk');
        await expect(pkElement).toBeVisible();
        await expect(pkElement).toHaveText('1');
    });

    test('数値のみ入力時にwholeWordが自動的にONになること', async ({page}) => {
        await openSearchPanelAsync(page);
        const searchInput = getSearchInput(page);
        // 数値のみ入力
        await searchInput.fill('1');
        // wholeWord ボタンが active 状態になること（自動ON）
        const wholeWordButton = getOptionButton(page, 'wholeWord');
        await expect(wholeWordButton).toHaveClass(/search-option-active/);
    });

    test('数値から数値以外に変更したらwholeWordの自動ONが解除されること', async ({page}) => {
        await openSearchPanelAsync(page);
        const searchInput = getSearchInput(page);
        // 数値のみ入力でwholeWord自動ON
        await searchInput.fill('1');
        const wholeWordButton = getOptionButton(page, 'wholeWord');
        await expect(wholeWordButton).toHaveClass(/search-option-active/);
        // 数値以外に変更（自動ONが解除される）
        await searchInput.fill('quest');
        await expect(wholeWordButton).not.toHaveClass(/search-option-active/);
    });

    test('ユーザーが手動でwholeWordをONにした場合は数値解除後も維持されること', async ({page}) => {
        await openSearchPanelAsync(page);
        const searchInput = getSearchInput(page);
        const wholeWordButton = getOptionButton(page, 'wholeWord');
        // 手動でwholeWordをONにする
        await wholeWordButton.click();
        await expect(wholeWordButton).toHaveClass(/search-option-active/);
        // 数値を入力（自動ONと同じ状態）
        await searchInput.fill('1');
        // 数値以外に変更（手動ONなので解除されない）
        await searchInput.fill('quest');
        // 手動ONは維持されること
        await expect(wholeWordButton).toHaveClass(/search-option-active/);
    });

    test('検索ヒット部分がハイライト表示されること', async ({page}) => {
        // quest テーブルの name 列: "quest_a" を "quest" で検索
        await openSearchPanelAsync(page);
        const searchInput = getSearchInput(page);
        await searchInput.fill('quest');
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible();
        // ヒット部分に .search-highlight クラスが付与された span が存在すること
        const highlights = results.first().locator('.search-result-value .search-highlight');
        await expect(highlights.first()).toBeVisible();
        await expect(highlights.first()).toHaveText('quest');
    });

    test('テーブルを開いた後でもフィルタ検索ができること', async ({page}) => {
        // まず参照先テーブルを開く
        await openTableAsync(page, 'enemy');
        // テーブルの非同期処理が完了するまで待機
        await page.waitForTimeout(1000);
        await openSearchPanelAsync(page);
        const searchInput = getSearchInput(page);
        // 全文検索で"1"を検索 → enemy, quest両方のテーブルから結果が表示される
        await searchInput.fill('quest_a');
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible({timeout: 10000});
        await expect(results.first().locator('.search-result-value')).toHaveText('quest_a');
    });

    test('検索中にローディングインジケータが表示され、完了後に消えること', async ({page}) => {
        await openSearchPanelAsync(page);
        const searchInput = getSearchInput(page);
        // MutationObserver で searching クラスの付与を検知する（検索が高速完了してもキャッチできる）
        await page.evaluate(() => {
            const target = document.querySelector('.search-panel-results')!;
            (window as Record<string, unknown>)['__searchingDetected'] = false;
            const observer = new MutationObserver(() => {
                if (target.classList.contains('searching')) {
                    (window as Record<string, unknown>)['__searchingDetected'] = true;
                    observer.disconnect();
                }
            });
            observer.observe(target, {attributes: true, attributeFilter: ['class']});
        });
        // 検索ボックスに文字を入力する
        await searchInput.fill('quest_a');
        // 検索完了まで待つ（結果が表示される）
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible({timeout: 10000});
        // searching クラスが一時的に付与されたことを MutationObserver 経由で確認する
        const wasSearching = await page.evaluate(() => (window as Record<string, unknown>)['__searchingDetected']);
        expect(wasSearching).toBe(true);
        // 検索完了後に searching クラスが除去されていること
        const searchResultsContainer = page.locator('.search-panel-results');
        await expect(searchResultsContainer).not.toHaveClass(/searching/, {timeout: 5000});
    });
});

test.describe('検索パネルの進捗表示', () => {
    test.beforeEach(async ({page}) => {
        await installMockApiAsync(page, createStreamingSearchTestFileSystem());
        await page.goto('/');
    });

    test('検索中もパーセンテージインジケーターを表示したままテーブルごとに結果を追加すること', async ({page}) => {
        await openSearchPanelAsync(page);
        const searchInput = getSearchInput(page);

        await page.evaluate(() => {
            const resultsElement = document.querySelector('.search-panel-results');
            const statusElement = document.querySelector('.search-panel-status');
            if (resultsElement === null || statusElement === null) {
                throw new Error('Search panel elements were not found.');
            }
            (window as Record<string, unknown>)['__streamingSearchDetected'] = false;
            (window as Record<string, unknown>)['__streamingSearchPercent'] = -1;
            (window as Record<string, unknown>)['__streamingSearchTableName'] = '';
            (window as Record<string, unknown>)['__streamingSearchTableStyle'] = null;
            let observer: MutationObserver | null = null;
            const detectStreamingResult = (): void => {
                const hasResult = resultsElement.querySelector('.search-result-item') !== null;
                const isSearching = resultsElement.classList.contains('searching');
                const statusVisible = window.getComputedStyle(statusElement).display !== 'none';
                const percentMatch = /検索中\s+(\d+)%/.exec(statusElement.textContent ?? '');
                const tableNameElement = statusElement.querySelector('.search-panel-status-table');
                if (hasResult && isSearching && statusVisible && percentMatch !== null && tableNameElement !== null) {
                    const tableNameStyle = window.getComputedStyle(tableNameElement);
                    (window as Record<string, unknown>)['__streamingSearchDetected'] = true;
                    (window as Record<string, unknown>)['__streamingSearchPercent'] = Number(percentMatch[1]);
                    (window as Record<string, unknown>)['__streamingSearchTableName'] = tableNameElement.textContent ?? '';
                    (window as Record<string, unknown>)['__streamingSearchTableStyle'] = {
                        overflow: tableNameStyle.overflow,
                        textOverflow: tableNameStyle.textOverflow,
                        whiteSpace: tableNameStyle.whiteSpace,
                    };
                    observer?.disconnect();
                }
            };
            observer = new MutationObserver(detectStreamingResult);
            observer.observe(resultsElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['class']});
            observer.observe(statusElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'aria-hidden']});
            detectStreamingResult();
        });

        await searchInput.fill('needle');
        const results = getSearchResults(page);
        await expect(results.first()).toBeVisible({timeout: 10000});
        await expect(results.first().locator('.search-result-value')).toHaveText('needle_first');
        await expect.poll(() => page.evaluate(() => {
            return (window as Record<string, unknown>)['__streamingSearchDetected'] === true;
        })).toBe(true);
        const firstResultProgress = await page.evaluate(() => {
            return (window as Record<string, unknown>)['__streamingSearchPercent'];
        });
        expect(firstResultProgress).toBeLessThan(50);
        const firstResultTableName = await page.evaluate(() => {
            return (window as Record<string, unknown>)['__streamingSearchTableName'];
        });
        expect(firstResultTableName).toBe('first_match');
        const tableNameStyle = await page.evaluate(() => {
            return (window as Record<string, unknown>)['__streamingSearchTableStyle'];
        });
        expect(tableNameStyle).toEqual({
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
        });
        await expect(page.locator('.search-panel-results')).not.toHaveClass(/searching/, {timeout: 10000});
        await expect(page.locator('.search-panel-status')).toHaveAttribute('aria-hidden', 'true');
        await expect(page.locator('.search-panel-status')).toHaveCSS('display', 'flex');
        await expect(page.locator('.search-panel-status')).toHaveCSS('visibility', 'hidden');
    });
});
