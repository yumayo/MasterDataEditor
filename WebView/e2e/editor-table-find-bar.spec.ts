import {test, expect} from './fixtures/test';
import {Page, Locator} from '@playwright/test';
import {installMockApiAsync, MockFileSystem} from './fixtures/mock-api';

function createFindBarFileSystem(): MockFileSystem {
    const largeRows = ["id,name,category"];
    for (let i = 1; i <= 400; i++) {
        largeRows.push(`${i},${i >= 5 && i <= 7 ? 'Needle' : `Row ${i}`},Group`);
    }
    return {
        "schema/item.json": JSON.stringify({
            header: [
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "name", type: "string"},
                {key: 2, name: "category", type: "string"},
            ],
            primary_key: ["id"],
        }),
        "data/item.csv": [
            "id,name,category",
            "1,Sword,Weapon",
            "2,Potion,Consumable",
        ].join("\n"),
        "schema/enemy.json": JSON.stringify({
            header: [
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "name", type: "string"},
            ],
            primary_key: ["id"],
        }),
        "data/enemy.csv": [
            "id,name",
            "1,Slime",
            "2,Dragon",
        ].join("\n"),
        "schema/large.json": JSON.stringify({
            header: [
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "name", type: "string"},
                {key: 2, name: "category", type: "string"},
            ],
            primary_key: ["id"],
        }),
        "data/large.csv": largeRows.join("\n"),
    };
}

async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    await page.locator('#explorer').getByText(tableName).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    return table.locator('.editor-table-row').nth(rowIndex)
        .locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

function getFindInput(page: Page): Locator {
    return page.locator('.editor-table-find-input');
}

async function setTableScrollTopAsync(page: Page, tableName: string, scrollTop: number): Promise<void> {
    const viewport = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table-main-viewport`);
    await expect(viewport).toBeVisible();
    await viewport.evaluate((element, nextScrollTop) => {
        element.scrollTop = nextScrollTop;
        element.dispatchEvent(new Event('scroll', {bubbles: true}));
    }, scrollTop);
}

async function hasSearchScrollbarMarkerAsync(page: Page): Promise<boolean> {
    return await page.evaluate(() => {
        const canvas = document.querySelector('.editor-left-slot .scrollbar-marker-track') as HTMLCanvasElement | null;
        if (canvas === null) return false;
        const context = canvas.getContext('2d');
        if (context === null || canvas.width <= 0 || canvas.height <= 0) return false;
        const laneWidth = Math.floor(canvas.width / 3);
        const searchLaneX = laneWidth;
        const searchLaneWidth = Math.max(1, laneWidth);
        const imageData = context.getImageData(searchLaneX, 0, searchLaneWidth, canvas.height);
        for (let i = 0; i < imageData.data.length; i += 4) {
            const r = imageData.data[i];
            const g = imageData.data[i + 1];
            const b = imageData.data[i + 2];
            const a = imageData.data[i + 3];
            if (a > 0 && r > 220 && g > 150 && b < 80) return true;
        }
        return false;
    });
}

test.describe('EditorTable検索バー', () => {
    test.beforeEach(async ({page}) => {
        await installMockApiAsync(page, createFindBarFileSystem());
        await page.goto('/');
    });

    test('Ctrl+FでアクティブなEditorTableの検索バーを開いてセルを検索できる', async ({page}) => {
        const table = await openTableAsync(page, 'item');
        await getDataCell(table, 0, 1).click();

        await page.keyboard.press('Control+F');
        const findInput = getFindInput(page);
        await expect(findInput).toBeVisible();
        await expect(findInput).toBeFocused();

        await findInput.fill('Potion');
        await expect(page.locator('.editor-table-find-count')).toHaveText('1/1');
        const currentMatch = page.locator('.editor-left-pane .editor-table-cell-find-current');
        await expect(currentMatch).toHaveText('Potion');
    });

    test('検索中インジケーターを表示してから検索結果を反映する', async ({page}) => {
        const table = await openTableAsync(page, 'item');
        await getDataCell(table, 0, 1).click();

        await page.keyboard.press('Control+F');
        const findInput = getFindInput(page);
        await page.evaluate(() => {
            const testWindow = window as Window & {
                __editorTableFindBarObserver?: MutationObserver;
                __editorTableFindBarSawSearching?: boolean;
                __editorTableFindBarSawProgressPercent?: boolean;
            };
            const findBar = document.querySelector('.editor-table-find-bar');
            if (!(findBar instanceof HTMLElement)) throw new Error('検索バーが見つかりません');
            const countElement = document.querySelector('.editor-table-find-count');
            if (!(countElement instanceof HTMLElement)) throw new Error('検索件数表示が見つかりません');
            const updateProgressState = () => {
                if (/^\d+%$/.test(countElement.textContent?.trim() ?? '')) {
                    testWindow.__editorTableFindBarSawProgressPercent = true;
                }
            };
            testWindow.__editorTableFindBarSawSearching = findBar.classList.contains('editor-table-find-bar-searching');
            testWindow.__editorTableFindBarSawProgressPercent = false;
            testWindow.__editorTableFindBarObserver = new MutationObserver(() => {
                if (findBar.classList.contains('editor-table-find-bar-searching')) {
                    testWindow.__editorTableFindBarSawSearching = true;
                }
                updateProgressState();
            });
            testWindow.__editorTableFindBarObserver.observe(findBar, {attributes: true, attributeFilter: ['class']});
            testWindow.__editorTableFindBarObserver.observe(countElement, {childList: true, characterData: true, subtree: true});
        });

        await findInput.fill('Potion');
        await expect(page.locator('.editor-table-find-count')).toHaveText('1/1');
        await expect(page.locator('.editor-table-find-status')).toBeHidden();
        const sawSearching = await page.evaluate(() => {
            return Boolean((window as Window & {__editorTableFindBarSawSearching?: boolean}).__editorTableFindBarSawSearching);
        });
        expect(sawSearching).toBe(true);
        const sawProgressPercent = await page.evaluate(() => {
            return Boolean((window as Window & {__editorTableFindBarSawProgressPercent?: boolean}).__editorTableFindBarSawProgressPercent);
        });
        expect(sawProgressPercent).toBe(true);
    });

    test('検索対象は開いている全タブではなくアクティブタブだけになる', async ({page}) => {
        await openTableAsync(page, 'item');
        const enemyTable = await openTableAsync(page, 'enemy');
        await getDataCell(enemyTable, 0, 1).click();

        await page.keyboard.press('Control+F');
        const findInput = getFindInput(page);
        await findInput.fill('Potion');
        await expect(page.locator('.editor-table-find-count')).toHaveText('0/0');

        await findInput.fill('Dragon');
        await expect(page.locator('.editor-table-find-count')).toHaveText('1/1');
        await expect(page.locator('.editor-left-pane .editor-table-cell-find-current')).toHaveText('Dragon');
    });

    test('手動スクロールで検索結果セルが再描画されても背景色を復元する', async ({page}) => {
        const table = await openTableAsync(page, 'large');
        await getDataCell(table, 0, 1).click();

        await page.keyboard.press('Control+F');
        const findInput = getFindInput(page);
        await findInput.fill('Needle');
        await expect(page.locator('.editor-table-find-count')).toHaveText('1/3');
        await expect(page.locator('.editor-left-pane .editor-table-cell-find-current')).toHaveText('Needle');
        await expect(page.locator('.editor-left-pane .editor-table-cell-find-match')).toHaveCount(3);
        await expect.poll(() => hasSearchScrollbarMarkerAsync(page)).toBe(true);

        const thirdMatch = page.locator('.editor-left-pane .editor-table-cell-find-match').nth(2);
        await thirdMatch.click();
        await expect(page.locator('.editor-table-find-count')).toHaveText('3/3');
        await expect(thirdMatch).toHaveClass(/editor-table-cell-find-current/);

        await setTableScrollTopAsync(page, 'large', 10000);
        await expect(page.locator('.editor-left-pane .editor-table-cell-find-current')).toHaveCount(0);

        await setTableScrollTopAsync(page, 'large', 0);
        await expect(page.locator('.editor-table-find-count')).toHaveText('3/3');
        await expect(page.locator('.editor-left-pane .editor-table-cell-find-current')).toHaveText('Needle');
        await expect(page.locator('.editor-left-pane .editor-table-cell-find-match')).toHaveCount(3);
    });

    test('ExplorerでCtrl+Fを押すと既存のテーブル検索入力にフォーカスする', async ({page}) => {
        await page.locator('.explorer-filter-input').focus();
        await page.keyboard.press('Control+F');
        await expect(page.locator('.explorer-filter-input')).toBeFocused();
        await expect(page.locator('.editor-table-find-bar')).not.toBeVisible();
    });

    test('SEARCHパネルでCtrl+Fを押すと既存の全文検索入力にフォーカスする', async ({page}) => {
        await page.locator('.activity-bar-item[data-panel="search"]').click();
        await page.locator('.search-panel-input').focus();
        await page.keyboard.press('Control+F');
        await expect(page.locator('.search-panel-input')).toBeFocused();
        await expect(page.locator('.editor-table-find-bar')).not.toBeVisible();
    });
});
