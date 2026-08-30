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
                {key: 1, name: "name", type: "string", comment: "アイテム名\n二行目の説明"},
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
                {key: 1, name: "ja", type: "string"},
            ],
            primary_key: ["id"],
        }),
        "data/enemy.csv": [
            "id,ja",
            "1,Slime",
            "2,Dragon",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "enemy_id", type: "int", reference: "enemy.ja"},
            ],
            primary_key: ["id"],
        }),
        "data/quest.csv": [
            "id,enemy_id",
            "1,1",
            "2,2",
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
        "schema/fixed_find.json": JSON.stringify({
            header: [
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "name", type: "string"},
                {key: 2, name: "category", type: "string"},
            ],
            primary_key: ["id"],
            frozenRowCount: 1,
            frozenColumnCount: 2,
        }),
        "data/fixed_find.csv": [
            "id,name,category",
            "1,Alpha,FrozenRowNeedle",
            "2,FrozenColumnNeedle,Body",
            "3,Other,Body",
        ].join("\n"),
        "schema/header_matches.json": JSON.stringify({
            header: [
                {key: 0, name: "category_one", type: "string"},
                {key: 1, name: "category_two", type: "string"},
            ],
            primary_key: ["category_one"],
        }),
        "data/header_matches.csv": [
            "category_one,category_two",
            "Alpha,Beta",
        ].join("\n"),
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

function getFindColumnOptionButton(page: Page): Locator {
    return page.locator('.editor-table-find-option-button[title="列名と列の説明を検索対象に含める"]');
}

function getVisibleColumnHeader(table: Locator, colIndex: number): Locator {
    return table.locator(`.editor-table-column-header[data-col="${colIndex}"]:visible`).first();
}

async function setTableScrollTopAsync(page: Page, tableName: string, scrollTop: number): Promise<void> {
    const viewport = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table-main-viewport`);
    await expect(viewport).toBeVisible();
    await viewport.evaluate((element, nextScrollTop) => {
        const editor = (window as Window & {
            editor?: {
                activeEditorTable?: {
                    getScrollMetrics(): {scrollTop: number; scrollLeft: number; scrollHeight: number; clientHeight: number};
                    restoreScrollPosition(scrollTop: number, scrollLeft: number): void;
                } | false;
            };
        }).editor;
        const activeTable = editor?.activeEditorTable;
        if (activeTable !== undefined && activeTable !== false) {
            const metrics = activeTable.getScrollMetrics();
            const clampedScrollTop = Math.max(0, Math.min(nextScrollTop, metrics.scrollHeight - metrics.clientHeight));
            activeTable.restoreScrollPosition(clampedScrollTop, metrics.scrollLeft);
            return;
        }
        element.scrollTop = Math.max(0, Math.min(nextScrollTop, element.scrollHeight - element.clientHeight));
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

async function getBackgroundColorChannelsAsync(cell: Locator): Promise<{color: string; r: number; g: number; b: number; a: number}> {
    return await cell.evaluate((element) => {
        const color = getComputedStyle(element).backgroundColor;
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('Canvas contextを取得できません');
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        return {color, r, g, b, a};
    });
}

function expectYellowSearchHighlight(color: {color: string; r: number; g: number; b: number; a: number}): void {
    expect(color.a, color.color).toBeGreaterThan(0);
    expect(color.r, color.color).toBeGreaterThan(color.b + 20);
    expect(color.g, color.color).toBeGreaterThan(color.b + 20);
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
        await expect(page.locator('.editor-table-find-count')).toHaveAttribute('aria-live', 'polite');
        await expect(page.locator('.editor-table-find-count')).toHaveAttribute('aria-atomic', 'true');

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

    test('参照ヒント句もCtrl+Fの検索結果に含める', async ({page}) => {
        const table = await openTableAsync(page, 'quest');
        const enemyCell = getDataCell(table, 0, 1);
        await expect(enemyCell.locator('.cell-reference-hint')).toHaveText('Slime');
        await enemyCell.click();

        await page.keyboard.press('Control+F');
        const findInput = getFindInput(page);
        await findInput.fill('Slime');

        await expect(page.locator('.editor-table-find-count')).toHaveText('1/1');
        const currentMatch = page.locator('.editor-left-pane .editor-table-cell-find-current');
        await expect(currentMatch).toHaveText(/Slime/);
        await expect(currentMatch).toHaveText(/1/);
    });

    test('列名と列の説明をデフォルトで検索対象に含め、ボタンで除外できる', async ({page}) => {
        const table = await openTableAsync(page, 'item');
        await getDataCell(table, 0, 1).click();

        await page.keyboard.press('Control+F');
        const findInput = getFindInput(page);
        const columnOptionButton = getFindColumnOptionButton(page);
        await expect(columnOptionButton).toHaveClass(/editor-table-find-option-active/);

        await findInput.fill('category');
        await expect(page.locator('.editor-table-find-count')).toHaveText('1/1');
        const categoryHeader = getVisibleColumnHeader(table, 2);
        await expect(categoryHeader.locator('.search-highlight')).toHaveText('category');

        await findInput.fill('アイテム名');
        await expect(page.locator('.editor-table-find-count')).toHaveText('1/1');
        const nameHeader = getVisibleColumnHeader(table, 1);
        await expect(nameHeader.locator('.column-header-name .search-highlight')).toHaveCount(0);
        await expect(nameHeader.locator('.column-header-comment .search-highlight')).toHaveText('アイテム名');

        await columnOptionButton.click();
        await expect(columnOptionButton).not.toHaveClass(/editor-table-find-option-active/);
        await expect(page.locator('.editor-table-find-count')).toHaveText('0/0');
        await expect(table.locator('.editor-table-column-header .search-highlight')).toHaveCount(0);
    });

    test('commentなし列名は検索に一致した文字列断片だけをオレンジ背景の黒字で表示する', async ({page}) => {
        const table = await openTableAsync(page, 'item');
        await getDataCell(table, 0, 1).click();

        await page.keyboard.press('Control+F');
        const findInput = getFindInput(page);
        await findInput.fill('ateg');
        await expect(page.locator('.editor-table-find-count')).toHaveText('1/1');

        const categoryHeader = getVisibleColumnHeader(table, 2);
        const highlights = categoryHeader.locator('.search-highlight');
        await expect(highlights).toHaveCount(1);
        await expect(highlights).toHaveText('ateg');
        await expect(highlights).toHaveCSS('background-color', 'rgb(245, 158, 11)');
        await expect(highlights).toHaveCSS('color', 'rgb(0, 0, 0)');
        await expect(categoryHeader).toContainText('category');
        await expect(categoryHeader).not.toHaveClass(/editor-table-cell-find-(?:match|current)/);
        await expect(categoryHeader).toHaveClass(/selected/);
        expect(await categoryHeader.evaluate((element) => getComputedStyle(element).backgroundImage)).not.toBe('none');
    });

    test('comment一致時は列名ではなく表示中の列説明の一致断片だけをハイライトする', async ({page}) => {
        const table = await openTableAsync(page, 'item');
        await getDataCell(table, 0, 1).click();

        await page.keyboard.press('Control+F');
        await getFindInput(page).fill('テム');
        await expect(page.locator('.editor-table-find-count')).toHaveText('1/1');

        const nameHeader = getVisibleColumnHeader(table, 1);
        await expect(nameHeader.locator('.column-header-name .search-highlight')).toHaveCount(0);
        const commentHighlights = nameHeader.locator('.column-header-comment .search-highlight');
        await expect(commentHighlights).toHaveCount(1);
        await expect(commentHighlights).toHaveText('テム');
        await expect(commentHighlights).toHaveCSS('background-color', 'rgb(245, 158, 11)');
        await expect(commentHighlights).toHaveCSS('color', 'rgb(0, 0, 0)');
        await expect(nameHeader).not.toHaveClass(/editor-table-cell-find-(?:match|current)/);
        const selectedCommentColors = await nameHeader.locator('.column-header-comment').evaluate((element) => ({
            actual: getComputedStyle(element).color,
            themeForeground: getComputedStyle(document.body).color,
        }));
        expect(selectedCommentColors.actual).toBe(selectedCommentColors.themeForeground);
    });

    test('検索クエリ消去と列検索OFFで列名ハイライトを除去しヘッダー部品を保持する', async ({page}) => {
        const table = await openTableAsync(page, 'item');
        await getDataCell(table, 0, 1).click();

        await page.keyboard.press('Control+F');
        const findInput = getFindInput(page);
        const columnOptionButton = getFindColumnOptionButton(page);
        const nameHeader = getVisibleColumnHeader(table, 1);
        const expectHeaderPartsToBeIntactAsync = async (): Promise<void> => {
            await expect(nameHeader.locator('.column-header-name')).toHaveText('name');
            await expect(nameHeader.locator('.column-header-comment')).toHaveText('アイテム名');
            await expect(nameHeader.locator('.filter-icon')).toHaveCount(1);
            await expect(nameHeader.locator('.sort-indicator')).toHaveCount(1);
            await expect(nameHeader.locator('.column-resize-handle')).toHaveCount(1);
        };

        await findInput.fill('テム');
        await expect(nameHeader.locator('.search-highlight')).toHaveText('テム');
        await findInput.fill('');
        await expect(nameHeader.locator('.search-highlight')).toHaveCount(0);
        await expectHeaderPartsToBeIntactAsync();

        await findInput.fill('テム');
        await expect(nameHeader.locator('.search-highlight')).toHaveText('テム');
        await columnOptionButton.click();
        await expect(page.locator('.editor-table-find-count')).toHaveText('0/0');
        await expect(nameHeader.locator('.search-highlight')).toHaveCount(0);
        await expectHeaderPartsToBeIntactAsync();
    });

    test('複数行commentの2行目一致を検索結果に含め解除後は先頭行表示に戻す', async ({page}) => {
        const table = await openTableAsync(page, 'item');
        await getDataCell(table, 0, 1).click();

        await page.keyboard.press('Control+F');
        const findInput = getFindInput(page);
        await findInput.fill('二行目');
        await expect(page.locator('.editor-table-find-count')).toHaveText('1/1');

        const nameHeader = getVisibleColumnHeader(table, 1);
        await expect(nameHeader.locator('.column-header-comment')).toHaveText('二行目の説明');
        await expect(nameHeader.locator('.column-header-comment .search-highlight')).toHaveText('二行目');

        await findInput.fill('');
        await expect(nameHeader.locator('.search-highlight')).toHaveCount(0);
        await expect(nameHeader.locator('.column-header-comment')).toHaveText('アイテム名');
    });

    test('commentなし列のsourceとdetachedヘッダーをEscape時に一時ラッパーなしで復元する', async ({page}) => {
        const table = await openTableAsync(page, 'item');
        await getDataCell(table, 0, 1).click();

        await page.keyboard.press('Control+F');
        const findInput = getFindInput(page);
        const columnOptionButton = getFindColumnOptionButton(page);
        await findInput.fill('ateg');
        await expect(page.locator('.editor-table-find-count')).toHaveText('1/1');

        const sourceHeader = table.locator('.editor-table-source-column-header-row .editor-table-column-header[data-col="2"]');
        const detachedHeader = table.locator('.editor-table-detached-column-header-layer .editor-table-column-header[data-col="2"]');
        await expect(sourceHeader.locator('.search-highlight')).toHaveText('ateg');
        await expect(detachedHeader.locator('.search-highlight')).toHaveText('ateg');

        await findInput.fill('');
        await expect(table.locator('.editor-table-find-header-label')).toHaveCount(0);
        await expect(sourceHeader).toContainText('category');
        await expect(detachedHeader).toContainText('category');

        await findInput.fill('ateg');
        await expect(detachedHeader.locator('.search-highlight')).toHaveText('ateg');
        await columnOptionButton.click();
        await expect(page.locator('.editor-table-find-count')).toHaveText('0/0');
        await expect(table.locator('.editor-table-find-header-label')).toHaveCount(0);

        await columnOptionButton.click();
        await expect(detachedHeader.locator('.search-highlight')).toHaveText('ateg');
        await page.keyboard.press('Escape');
        await expect(page.locator('.editor-table-find-bar')).not.toBeVisible();
        await expect(sourceHeader.locator('.editor-table-find-header-label')).toHaveCount(0);
        await expect(detachedHeader.locator('.editor-table-find-header-label')).toHaveCount(0);
        await expect(sourceHeader).toContainText('category');
        await expect(detachedHeader).toContainText('category');
        await expect(detachedHeader.locator('.filter-icon')).toHaveCount(1);
        await expect(detachedHeader.locator('.sort-indicator')).toHaveCount(1);
        await expect(detachedHeader.locator('.column-resize-handle')).toHaveCount(1);
    });

    test('検索中にcommentなし列名が更新されても解除時に古い列名へ巻き戻さない', async ({page}) => {
        const table = await openTableAsync(page, 'item');
        await getDataCell(table, 0, 1).click();

        await page.keyboard.press('Control+F');
        const findInput = getFindInput(page);
        await findInput.fill('ateg');
        await expect(getVisibleColumnHeader(table, 2).locator('.search-highlight')).toHaveText('ateg');

        await page.evaluate(() => {
            const editor = (window as Window & {
                editor: {activeEditorTable: {setColumnHeaderValue(columnIndex: number, value: string): void} | false};
            }).editor;
            const activeTable = editor.activeEditorTable;
            if (activeTable === false) throw new Error('アクティブテーブルが見つかりません');
            activeTable.setColumnHeaderValue(2, 'category_renamed');
        });
        await findInput.fill('');

        const sourceHeader = table.locator('.editor-table-source-column-header-row .editor-table-column-header[data-col="2"]');
        const detachedHeader = table.locator('.editor-table-detached-column-header-layer .editor-table-column-header[data-col="2"]');
        await expect(sourceHeader).toContainText('category_renamed');
        await expect(detachedHeader).toContainText('category_renamed');
        await expect(table.locator('.editor-table-find-header-label')).toHaveCount(0);
        await expect(sourceHeader).not.toContainText('categorycategory_renamed');
    });

    test('comment付き列名が検索中に非一致名へ変更されたらキャッシュを破棄し再検索する', async ({page}) => {
        const table = await openTableAsync(page, 'item');
        await getDataCell(table, 0, 1).click();

        await page.keyboard.press('Control+F');
        const findInput = getFindInput(page);
        await findInput.fill('name');
        await expect(page.locator('.editor-table-find-count')).toHaveText('1/1');
        await expect(getVisibleColumnHeader(table, 1).locator('.column-header-name .search-highlight')).toHaveText('name');

        await page.evaluate(() => {
            const editor = (window as Window & {
                editor: {activeEditorTable: {setColumnHeaderValue(columnIndex: number, value: string): void} | false};
            }).editor;
            const activeTable = editor.activeEditorTable;
            if (activeTable === false) throw new Error('アクティブテーブルが見つかりません');
            activeTable.setColumnHeaderValue(1, 'title');
        });

        await expect(page.locator('.editor-table-find-count')).toHaveText('0/0');
        const sourceHeader = table.locator('.editor-table-source-column-header-row .editor-table-column-header[data-col="1"]');
        const detachedHeader = table.locator('.editor-table-detached-column-header-layer .editor-table-column-header[data-col="1"]');
        await expect(sourceHeader.locator('.search-highlight')).toHaveCount(0);
        await expect(detachedHeader.locator('.search-highlight')).toHaveCount(0);
        await expect(sourceHeader.locator('.column-header-name')).toHaveText('title');
        await expect(detachedHeader.locator('.column-header-name')).toHaveText('title');
        await expect(findInput).toHaveValue('name');
    });

    test('0件検索中にcomment付き列名が一致名へ変更されたら自動再検索する', async ({page}) => {
        const table = await openTableAsync(page, 'item');
        await getDataCell(table, 0, 1).click();

        await page.keyboard.press('Control+F');
        const findInput = getFindInput(page);
        await findInput.fill('title');
        await expect(page.locator('.editor-table-find-count')).toHaveText('0/0');

        await page.evaluate(() => {
            const editor = (window as Window & {
                editor: {activeEditorTable: {setColumnHeaderValue(columnIndex: number, value: string): void} | false};
            }).editor;
            const activeTable = editor.activeEditorTable;
            if (activeTable === false) throw new Error('アクティブテーブルが見つかりません');
            activeTable.setColumnHeaderValue(1, 'title');
        });

        await expect(page.locator('.editor-table-find-count')).toHaveText('1/1');
        const sourceHeader = table.locator('.editor-table-source-column-header-row .editor-table-column-header[data-col="1"]');
        const detachedHeader = table.locator('.editor-table-detached-column-header-layer .editor-table-column-header[data-col="1"]');
        await expect(sourceHeader.locator('.column-header-name .search-highlight')).toHaveText('title');
        await expect(detachedHeader.locator('.column-header-name .search-highlight')).toHaveText('title');
    });

    test('wholeWordとregexは複数行comment全体に対する従来の一致意味を維持する', async ({page}) => {
        const table = await openTableAsync(page, 'item');
        await getDataCell(table, 0, 1).click();

        await page.keyboard.press('Control+F');
        const findInput = getFindInput(page);
        const wholeWordButton = page.locator('.editor-table-find-option-button[title="単語単位で検索"]');
        const regexButton = page.locator('.editor-table-find-option-button[title="正規表現"]');

        await findInput.fill('アイテム名');
        await expect(page.locator('.editor-table-find-count')).toHaveText('1/1');
        await wholeWordButton.click();
        await expect(page.locator('.editor-table-find-count')).toHaveText('0/0');

        await wholeWordButton.click();
        await findInput.fill('^二行目');
        await regexButton.click();
        await expect(page.locator('.editor-table-find-count')).toHaveText('0/0');
        await expect(table.locator('.column-header-comment .search-highlight')).toHaveCount(0);
    });

    test('検索中に別の通常タブへ切り替えると旧装飾を破棄し新タブだけを検索できる', async ({page}) => {
        const itemTable = await openTableAsync(page, 'item');
        await getDataCell(itemTable, 0, 1).click();
        await page.keyboard.press('Control+F');
        await getFindInput(page).fill('ateg');
        await expect(getVisibleColumnHeader(itemTable, 2).locator('.search-highlight')).toHaveText('ateg');

        const enemyTable = await openTableAsync(page, 'enemy');
        await expect(page.locator('.editor-table-find-bar')).toHaveCount(0);
        await expect(itemTable.locator('.search-highlight')).toHaveCount(0);
        await expect(itemTable.locator('.editor-table-find-header-label')).toHaveCount(0);
        await expect(itemTable.locator('.editor-table-column-header-find-match')).toHaveCount(0);

        await getDataCell(enemyTable, 0, 1).click();
        await page.keyboard.press('Control+F');
        await getFindInput(page).fill('Dragon');
        await expect(page.locator('.editor-table-find-count')).toHaveText('1/1');
        await expect(enemyTable.locator('.editor-table-cell-find-current')).toHaveText('Dragon');
        await expect(itemTable.locator('.editor-table-cell-find-match')).toHaveCount(0);
    });

    test('複数ヘッダー一致時はsemantic classを付け断片外のクリックでcurrent移動できる', async ({page}) => {
        const table = await openTableAsync(page, 'header_matches');
        await getDataCell(table, 0, 0).click();

        await page.keyboard.press('Control+F');
        await getFindInput(page).fill('category');
        await expect(page.locator('.editor-table-find-count')).toHaveText('1/2');

        const firstHeader = getVisibleColumnHeader(table, 0);
        const secondHeader = getVisibleColumnHeader(table, 1);
        await expect(firstHeader).toHaveClass(/editor-table-column-header-find-match/);
        await expect(secondHeader).toHaveClass(/editor-table-column-header-find-match/);
        await expect(firstHeader).not.toHaveClass(/editor-table-cell-find-(?:match|current)/);
        await expect(secondHeader).not.toHaveClass(/editor-table-cell-find-(?:match|current)/);

        await secondHeader.click({position: {x: 5, y: 5}});
        await expect(page.locator('.editor-table-find-count')).toHaveText('2/2');
    });

    test('検索ハイライト中のアクティブタブを閉じると検索DOM装飾も破棄する', async ({page}) => {
        const table = await openTableAsync(page, 'item');
        await getDataCell(table, 0, 1).click();
        await page.keyboard.press('Control+F');
        await getFindInput(page).fill('ateg');
        await expect(getVisibleColumnHeader(table, 2).locator('.search-highlight')).toHaveText('ateg');

        const tabButton = page.locator('.tab-button').filter({hasText: 'item'}).first();
        await tabButton.locator('.tab-button-close').click();

        await expect(page.locator('.tab-wrapper[data-tab-name="item"]')).toHaveCount(0);
        await expect(page.locator('.editor-table-find-bar')).toHaveCount(0);
        await expect(page.locator('.editor-table-find-header-label')).toHaveCount(0);
        await expect(page.locator('.editor-table-column-header-find-match')).toHaveCount(0);
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

    test('固定行・固定列の検索結果セルにも黄色い背景色を表示する', async ({page}) => {
        const table = await openTableAsync(page, 'fixed_find');
        const fixedRowCell = page.locator(
            '.editor-left-pane .tab-wrapper[data-tab-name="fixed_find"] .editor-table-detached-frozen-row-layer .editor-table-detached-row[data-row-index="0"] .editor-table-cell[data-col="2"]',
        );
        const fixedColumnCell = page.locator(
            '.editor-left-pane .tab-wrapper[data-tab-name="fixed_find"] .editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="1"] .editor-table-cell[data-col="1"]',
        );

        await expect(fixedRowCell).toBeVisible();
        await fixedRowCell.click();

        await page.keyboard.press('Control+F');
        const findInput = getFindInput(page);
        await findInput.fill('Needle');
        await expect(page.locator('.editor-table-find-count')).toHaveText('1/2');

        await expect(fixedRowCell).toHaveClass(/editor-table-cell-find-current/);
        await expect(fixedColumnCell).toBeVisible();
        await expect(fixedColumnCell).toHaveClass(/editor-table-cell-find-match/);

        expectYellowSearchHighlight(await getBackgroundColorChannelsAsync(fixedRowCell));
        expectYellowSearchHighlight(await getBackgroundColorChannelsAsync(fixedColumnCell));
    });

    test('多数ヒット時もEnter連続入力で次の検索結果へ移動できる', async ({page}) => {
        const table = await openTableAsync(page, 'large');
        await getDataCell(table, 0, 2).click();

        await page.keyboard.press('Control+F');
        const findInput = getFindInput(page);
        await findInput.fill('Group');
        await expect(page.locator('.editor-table-find-count')).toHaveText('1/400');

        for (let i = 0; i < 24; i++) {
            await page.keyboard.press('Enter');
        }

        await expect(page.locator('.editor-table-find-count')).toHaveText('25/400');
        await expect(page.locator('.editor-left-pane .editor-table-cell-find-current')).toHaveText('Group');
    });

    test('Enter押しっぱなしのrepeatイベントはフレーム単位でまとめて処理する', async ({page}) => {
        const table = await openTableAsync(page, 'large');
        await getDataCell(table, 0, 2).click();

        await page.keyboard.press('Control+F');
        const findInput = getFindInput(page);
        await findInput.fill('Group');
        await expect(page.locator('.editor-table-find-count')).toHaveText('1/400');

        await findInput.evaluate((input) => {
            for (let i = 0; i < 50; i++) {
                input.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter',
                    repeat: true,
                    bubbles: true,
                    cancelable: true,
                }));
            }
        });

        await expect(page.locator('.editor-table-find-count')).toHaveText('51/400');
        await expect(page.locator('.editor-left-pane .editor-table-cell-find-current')).toHaveText('Group');
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
