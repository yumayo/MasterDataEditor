import {test, expect} from './fixtures/test';
import {installMockApiAsync} from './fixtures/mock-api';
import type {Page, Locator} from '@playwright/test';

const ROW_COUNT = 45000;
interface BlameRequest {requestId: string; startLine: number; endLine: number;}
interface BlameMockWindow {
    __mockGitBlameRequests: BlameRequest[];
    __mockGitBlamePendingResponses: Array<() => void>;
    __mockGitBlameError?: string;
}

async function openAsync(page: Page, sorted = false): Promise<Locator> {
    await page.addInitScript(rowCount => {
        const target = window as unknown as Record<string, unknown>;
        target.__mockGitBlameManualResponses = true;
        target.__mockGitBlame = {'data/large.csv': Array.from({length: rowCount}, (_, index) => ({
            lineNumber: index + 2, author: `author_${index + 1}`, date: '2026-09-10', commitHash: 'aaa1111', commitMessage: 'initial',
        }))};
    }, ROW_COUNT);
    await installMockApiAsync(page, {
        'schema/large.json': JSON.stringify({
            header: [{key: 0, name: 'id', type: 'int'}], primary_key: ['id'],
            ...(sorted ? {sortKeys: [{columnName: 'id', direction: 'desc'}]} : {}),
        }),
        'data/large.csv': ['id', ...Array.from({length: ROW_COUNT}, (_, index) => String(index + 1))].join('\n'),
        'schema/other.json': JSON.stringify({header: [{key: 0, name: 'id', type: 'int'}], primary_key: ['id']}),
        'data/other.csv': 'id\n1\n',
    });
    await page.goto('/');
    await page.locator('#explorer').getByText('large', {exact: true}).click();
    const table = page.locator('.editor-left-pane .editor-table:visible');
    await expect(table).toBeVisible();
    return table;
}

async function toggleAsync(page: Page, table: Locator, show: boolean): Promise<void> {
    const point = await table.evaluate(element => {
        const viewport = element.querySelector('.editor-table-main-viewport')!.getBoundingClientRect();
        for (const header of element.querySelectorAll('.editor-table-detached-row-header-layer .editor-table-row-header')) {
            const rect = header.getBoundingClientRect();
            if (rect.top >= viewport.top && rect.bottom <= viewport.bottom) return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
        }
        throw new Error('visible row header missing');
    });
    await page.mouse.click(point.x, point.y, {button: 'right'});
    await page.locator('.context-menu.visible').getByText(show ? '変更履歴を表示' : '変更履歴を非表示', {exact: true}).click();
}

async function requestsAsync(page: Page): Promise<BlameRequest[]> {
    return page.evaluate(() => (window as unknown as BlameMockWindow).__mockGitBlameRequests ?? []);
}

async function waitRequestAsync(page: Page, count: number): Promise<BlameRequest> {
    await expect.poll(async () => (await requestsAsync(page)).length).toBe(count);
    return (await requestsAsync(page))[count - 1];
}

async function releaseAsync(page: Page): Promise<void> {
    await page.evaluate(() => {
        const respond = (window as unknown as BlameMockWindow).__mockGitBlamePendingResponses.shift();
        if (respond === undefined) throw new Error('pending BLAME response missing');
        respond();
    });
}

test('表示範囲を先に取得し、上下への先読み中もスクロール先を優先する', async ({page}) => {
    const table = await openAsync(page);
    await table.locator('.editor-table-main-viewport').evaluate(element => {element.scrollTop = element.scrollHeight / 2;});
    await expect(table.locator('.editor-table-grid > .editor-table-row[data-row-index="22500"]')).toBeAttached();
    await toggleAsync(page, table, true);
    expect(await waitRequestAsync(page, 1)).toMatchObject({startLine: 20002, endLine: 30001});
    await expect(table.locator('.editor-table-detached-corner-layer .blame-column-header')).toBeVisible();
    await expect(table.locator('.editor-table-detached-row-header-layer .blame-cell').first()).toHaveText('…');
    // 応答を止めている間に次のGitを起動しない。
    await page.waitForTimeout(150);
    expect(await requestsAsync(page)).toHaveLength(1);
    await releaseAsync(page);
    await expect(table.locator('.editor-table-detached-row-header-layer .blame-author').first()).toBeAttached();
    expect(await waitRequestAsync(page, 2)).toMatchObject({startLine: 10002, endLine: 20001});

    await table.locator('.editor-table-main-viewport').evaluate(element => {element.scrollTop = element.scrollHeight;});
    const lastRow = table.locator('.editor-table-grid > .editor-table-row[data-row-index="44999"]');
    await expect(lastRow.locator('.blame-cell')).toHaveText('…');
    await releaseAsync(page);
    expect(await waitRequestAsync(page, 3)).toMatchObject({startLine: 40002, endLine: 45001});
    await releaseAsync(page);
    await expect(lastRow.locator('.blame-author')).toHaveText('author_45000');
    expect(await waitRequestAsync(page, 4)).toMatchObject({startLine: 30002, endLine: 40001});
    await releaseAsync(page);
    expect(await waitRequestAsync(page, 5)).toMatchObject({startLine: 2, endLine: 10001});
    await releaseAsync(page);
    await expect(page.locator('.debug-console-col-label', {hasText: 'git_blame [load_all_chunks_total]'})).toHaveCount(1);
    const requests = await requestsAsync(page);
    expect(new Set(requests.map(request => request.startLine)).size).toBe(5);
    expect(requests.every(request => request.endLine - request.startLine + 1 <= 10000)).toBe(true);
    await table.locator('.editor-table-main-viewport').evaluate(element => {element.scrollTop = 0;});
    await expect(table.locator('.editor-table-grid > .editor-table-row[data-row-index="0"] .blame-author')).toHaveText('author_1');
});

test('解除・再表示後に前回のチャンクが返っても新しい表示を壊さない', async ({page}) => {
    const table = await openAsync(page);
    await toggleAsync(page, table, true);
    await waitRequestAsync(page, 1);
    await releaseAsync(page);
    await waitRequestAsync(page, 2);
    await toggleAsync(page, table, false);
    await expect(table.locator('.blame-cell')).toHaveCount(0);
    await toggleAsync(page, table, true);
    expect(await waitRequestAsync(page, 3)).toMatchObject({startLine: 2, endLine: 10001});
    await releaseAsync(page); // 前回の応答
    await expect(table.locator('.editor-table-detached-row-header-layer .blame-cell').first()).toHaveText('…');
    await releaseAsync(page); // 今回の応答
    await expect(table.locator('.editor-table-detached-row-header-layer .blame-author').first()).toHaveText('author_1');
    expect(await waitRequestAsync(page, 4)).toMatchObject({startLine: 10002, endLine: 20001});
    await toggleAsync(page, table, false);
    await releaseAsync(page);
    await page.waitForTimeout(150);
    await expect(table.locator('.blame-cell')).toHaveCount(0);
    expect(await requestsAsync(page)).toHaveLength(4);
});

test('初回取得中にタブを切り替えると後続チャンクを取得しない', async ({page}) => {
    const errors: Error[] = [];
    page.on('pageerror', error => errors.push(error));
    const table = await openAsync(page);
    await page.evaluate(() => {(window as unknown as BlameMockWindow).__mockGitBlameError = 'cancelled request failed';});
    await toggleAsync(page, table, true);
    await waitRequestAsync(page, 1);
    await page.locator('#explorer').getByText('other', {exact: true}).click();
    await releaseAsync(page);
    await page.waitForTimeout(150);
    expect(await requestsAsync(page)).toHaveLength(1);
    await expect(page.locator('.blame-cell')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('ソート後の表示行をCSV行へ変換して取得し、著者を対応する行に表示する', async ({page}) => {
    const table = await openAsync(page, true);
    await toggleAsync(page, table, true);
    expect(await waitRequestAsync(page, 1)).toMatchObject({startLine: 40002, endLine: 45001});
    await releaseAsync(page);
    await expect(table.locator('.editor-table-grid > .editor-table-row[data-row-index="0"] .blame-author')).toHaveText('author_45000');
    await toggleAsync(page, table, false);
});

for (const firstChunkLoaded of [false, true]) {
    test(`${firstChunkLoaded ? '先読み' : '初回取得'}中のタブ切り替えから戻るとBLAMEを再開し、古い応答を適用しない`, async ({page}) => {
        const table = await openAsync(page, true);
        await toggleAsync(page, table, true);
        await waitRequestAsync(page, 1);
        if (firstChunkLoaded) {
            await releaseAsync(page);
            await waitRequestAsync(page, 2);
        }
        const previousRequestCount = firstChunkLoaded ? 2 : 1;
        await page.locator('#explorer').getByText('other', {exact: true}).click();
        await page.waitForTimeout(150);
        expect(await requestsAsync(page)).toHaveLength(previousRequestCount);
        await expect(table.locator('.blame-cell')).toHaveCount(0);

        await page.locator('.tab-button').getByText('large', {exact: true}).click();
        expect(await waitRequestAsync(page, previousRequestCount + 1)).toMatchObject({startLine: 40002, endLine: 45001});
        await expect(table.locator('.editor-table-detached-corner-layer .blame-column-header')).toBeVisible();
        await releaseAsync(page); // タブ切り替え前の応答は破棄する。
        await expect(table.locator('.editor-table-grid > .editor-table-row[data-row-index="0"] .blame-cell')).toHaveText('…');
        await releaseAsync(page);
        await expect(table.locator('.editor-table-grid > .editor-table-row[data-row-index="0"] .blame-author')).toHaveText('author_45000');
        expect(await waitRequestAsync(page, previousRequestCount + 2)).toMatchObject({startLine: 30002, endLine: 40001});
        await toggleAsync(page, table, false);
        await releaseAsync(page);
    });
}

test('タブ復帰後の初回取得が失敗したら、先に確保したBLAME列を解除する', async ({page}) => {
    const errors: Error[] = [];
    page.on('pageerror', error => errors.push(error));
    const table = await openAsync(page);
    const viewport = table.locator('.editor-table-main-viewport');
    const withoutBlame = await viewport.boundingBox();
    await toggleAsync(page, table, true);
    await waitRequestAsync(page, 1);
    await page.locator('#explorer').getByText('other', {exact: true}).click();
    await releaseAsync(page);
    await page.evaluate(() => {(window as unknown as BlameMockWindow).__mockGitBlameError = 'initial request failed';});
    await page.locator('.tab-button').getByText('large', {exact: true}).click();
    await waitRequestAsync(page, 2);
    await expect(table.locator('.editor-table-detached-corner-layer .blame-column-header')).toBeVisible();
    expect((await viewport.boundingBox())!.x - withoutBlame!.x).toBe(200);
    await releaseAsync(page);
    await expect(table.locator('.blame-cell, .blame-column-header')).toHaveCount(0);
    await expect(page.locator('.notification-toast-error')).toHaveText('変更履歴の取得に失敗しました');
    expect(await viewport.boundingBox()).toEqual(withoutBlame);
    expect(await requestsAsync(page)).toHaveLength(2);
    expect(errors).toEqual([]);
});

test('後続チャンクの失敗時は取得を止め、BLAME列を解除する', async ({page}) => {
    const errors: Error[] = [];
    page.on('pageerror', error => errors.push(error));
    const table = await openAsync(page);
    await toggleAsync(page, table, true);
    await waitRequestAsync(page, 1);
    await page.evaluate(() => {(window as unknown as BlameMockWindow).__mockGitBlameError = 'chunk failed';});
    await releaseAsync(page);
    await waitRequestAsync(page, 2);
    await releaseAsync(page);
    await expect(table.locator('.blame-cell')).toHaveCount(0);
    await expect(page.locator('.debug-console-row-error .debug-console-col-label', {hasText: 'git_blame [load_all_chunks_total]'})).toHaveCount(1);
    await page.waitForTimeout(150);
    expect(await requestsAsync(page)).toHaveLength(2);
    expect(errors).toEqual([]);
});
