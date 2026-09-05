import {test, expect} from './fixtures/test';
import type {Locator, Page} from '@playwright/test';
import {installMockApiAsync, MockFileSystem, readMockFileAsync} from './fixtures/mock-api';

const storedWidths = {enemy: 337, chara: 173};

function createFileSystem(): MockFileSystem {
    const fs: MockFileSystem = {
        'user:column-widths.json': JSON.stringify({
            tables: {
                enemy: {id: storedWidths.enemy, removed_column: 281, future_column: 312},
                chara: {id: storedWidths.chara},
            },
        }),
    };
    for (const tableName of ['enemy', 'chara']) {
        fs[`schema/${tableName}.json`] = JSON.stringify({
            primary_key: ['id'],
            header: [
                {key: 0, name: 'id', type: 'int', comment: 'ID', ...(tableName === 'enemy' ? {width: 100} : {})},
                {key: 1, name: 'attack', type: 'int'},
            ],
        });
        fs[`data/${tableName}.csv`] = 'id,attack\n1,20';
        fs[`schema/${tableName}_name.json`] = JSON.stringify({
            primary_key: ['id'],
            header: [
                {key: 0, name: 'id', type: 'int', reference: `${tableName}.id`},
                {key: 1, name: 'ja', type: 'string'},
            ],
        });
        fs[`data/${tableName}_name.csv`] = 'id,ja\n1,保存した列幅よりも長い逆参照ヒントの表示名がある場合も幅を維持する';
    }
    return fs;
}

async function openDiffAsync(page: Page, tableName = 'enemy'): Promise<Locator> {
    await page.locator('[data-panel="sourceControl"]').click();
    await page.locator('.source-control-changes-section').getByText(tableName, {exact: true}).click();
    const diff = page.locator('.diff-tab');
    await expect(diff).toBeVisible();
    await expect(diff.locator('.cell-reverse-reference-hint').first()).toBeVisible();
    return diff;
}

function getDiffHeader(diff: Locator, side: 'left' | 'right', columnIndex = 0): Locator {
    return diff.locator(`.diff-pane-${side} .editor-table-column-header`).nth(columnIndex);
}

async function resizeHeaderAsync(page: Page, header: Locator, delta: number): Promise<number> {
    const box = await header.boundingBox();
    if (box === null) throw new Error('列ヘッダーが見つかりません');
    const startX = box.x + box.width - 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + delta, startY);
    await page.mouse.up();
    return box.width + delta;
}

async function readWidthsAsync(page: Page): Promise<{tables: Record<string, Record<string, number>>}> {
    return JSON.parse(await readMockFileAsync(page, 'user:column-widths.json'));
}

test.describe('通常テーブルとGit差分の保存済み列幅', () => {
    test.beforeEach(async ({page}) => {
        await page.addInitScript(() => {
            const mockWindow = window as unknown as {__mockGitStatus: object; __mockGitHeadFiles: Record<string, string>};
            mockWindow.__mockGitStatus = {
                changes: ['enemy', 'chara'].map(tableName => ({path: `data/${tableName}.csv`, tableName, isNew: false})),
                staged: [],
            };
            mockWindow.__mockGitHeadFiles = {
                'data/enemy.csv': 'id,attack\n1,10',
                'data/chara.csv': 'id,attack\n1,10',
            };
        });
        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');
    });

    for (const tableName of ['enemy', 'chara'] as const) {
        test(`${tableName}の保存幅が通常テーブルと差分の左右ペインに適用されること`, async ({page}) => {
            await page.locator('#explorer').getByText(tableName, {exact: true}).first().click();
            const table = page.locator(`.tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
            await expect(table).toBeVisible();
            await expect(table.locator('.cell-reverse-reference-hint').first()).toBeVisible();
            const header = table.locator('.editor-table-column-header').first();
            await expect(header).toHaveCSS('width', `${storedWidths[tableName]}px`);
            expect(await header.evaluate(el => el.getBoundingClientRect().width)).toBe(storedWidths[tableName]);

            await page.locator('[data-panel="sourceControl"]').click();
            await page.locator('.source-control-changes-section').getByText(tableName, {exact: true}).click();
            const diff = page.locator('.diff-tab');
            await expect(diff).toBeVisible();
            for (const pane of ['.diff-pane-left', '.diff-pane-right']) {
                const diffTable = diff.locator(`${pane} .editor-table`);
                await expect(diffTable.locator('.cell-reverse-reference-hint').first()).toBeVisible();
                const diffHeader = diffTable.locator('.editor-table-column-header').first();
                await expect(diffHeader).toHaveCSS('width', `${storedWidths[tableName]}px`);
                expect(await diffHeader.evaluate(el => el.getBoundingClientRect().width)).toBe(storedWidths[tableName]);
            }
        });
    }

    test('アプリ上で変更した列幅を再起動せずに差分へ反映すること', async ({page}) => {
        await page.locator('#explorer').getByText('chara', {exact: true}).first().click();
        const table = page.locator('.tab-wrapper[data-tab-name="chara"] .editor-table');
        await expect(table.locator('.cell-reverse-reference-hint').first()).toBeVisible();
        const header = table.locator('.editor-table-column-header').first();
        const box = await header.boundingBox();
        if (box === null) throw new Error('列ヘッダーが見つかりません');
        const startX = box.x + box.width - 2;
        const startY = box.y + box.height / 2;
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX + 26, startY);
        await page.mouse.up();
        await expect(header).toHaveCSS('width', '199px');
        await expect.poll(async () => {
            const state = JSON.parse(await readMockFileAsync(page, 'user:column-widths.json'));
            return state.tables.chara.id;
        }).toBe(199);

        await page.locator('[data-panel="sourceControl"]').click();
        await page.locator('.source-control-changes-section').getByText('chara', {exact: true}).click();
        for (const pane of ['.diff-pane-left', '.diff-pane-right']) {
            const diffTable = page.locator(`.diff-tab ${pane} .editor-table`);
            await expect(diffTable.locator('.cell-reverse-reference-hint').first()).toBeVisible();
            await expect(diffTable.locator('.editor-table-column-header').first()).toHaveCSS('width', '199px');
        }
    });

    for (const side of ['left', 'right'] as const) {
        test(`${side}ペインのリサイズを同名列へ同期し、対象列だけ保存してUndoとRedoできること`, async ({page}) => {
            const initialState = await readWidthsAsync(page);
            const diff = await openDiffAsync(page);
            const resizedWidth = await resizeHeaderAsync(page, getDiffHeader(diff, side), 31);
            const expectedState = {
                tables: {...initialState.tables, enemy: {...initialState.tables.enemy, id: resizedWidth}},
            };
            const assertWidthAsync = async (width: number) => {
                await expect(getDiffHeader(diff, 'left')).toHaveCSS('width', `${width}px`);
                await expect(getDiffHeader(diff, 'right')).toHaveCSS('width', `${width}px`);
            };
            await assertWidthAsync(resizedWidth);
            // 差分の一時キーを作らず、表示されていない列も未操作の列も保持する。
            await expect.poll(() => readWidthsAsync(page)).toEqual(expectedState);
            await page.keyboard.press('Control+z');
            await assertWidthAsync(storedWidths.enemy);
            await expect.poll(() => readWidthsAsync(page)).toEqual(initialState);
            await page.keyboard.press('Control+y');
            await assertWidthAsync(resizedWidth);
            await expect.poll(() => readWidthsAsync(page)).toEqual(expectedState);

            await page.reload();
            await page.locator('[data-panel="files"]').click();
            await page.locator('#explorer').getByText('enemy', {exact: true}).first().click();
            const normalHeader = page.locator('.tab-wrapper[data-tab-name="enemy"] .editor-table-column-header').first();
            await expect(normalHeader).toHaveCSS('width', `${resizedWidth}px`);
        });
    }

    test('差分の自動幅調整も反対ペインへ同期し対象列だけ保存すること', async ({page}) => {
        const initialState = await readWidthsAsync(page);
        const diff = await openDiffAsync(page);
        await getDiffHeader(diff, 'left').locator('.column-resize-handle').first().dblclick();
        const width = await getDiffHeader(diff, 'left').evaluate(el => parseFloat((el as HTMLElement).style.width));
        expect(width).toBeGreaterThan(storedWidths.enemy);
        await expect(getDiffHeader(diff, 'right')).toHaveCSS('width', `${width}px`);
        await expect.poll(() => readWidthsAsync(page)).toEqual({
            tables: {...initialState.tables, enemy: {...initialState.tables.enemy, id: width}},
        });
    });

    test('差分の複数列リサイズとUndoとRedoでも列ごとの変更を保存すること', async ({page}) => {
        const initialState = await readWidthsAsync(page);
        const diff = await openDiffAsync(page, 'chara');
        const oldAttackWidth = await getDiffHeader(diff, 'right', 1).evaluate(el => parseFloat((el as HTMLElement).style.width));
        await getDiffHeader(diff, 'right', 0).click();
        await getDiffHeader(diff, 'right', 1).click({modifiers: ['Control']});
        const width = await resizeHeaderAsync(page, getDiffHeader(diff, 'right', 1), 40);
        const expectedState = {tables: {...initialState.tables, chara: {id: width, attack: width}}};
        for (const side of ['left', 'right'] as const) {
            await expect(getDiffHeader(diff, side, 0)).toHaveCSS('width', `${width}px`);
            await expect(getDiffHeader(diff, side, 1)).toHaveCSS('width', `${width}px`);
        }
        await expect.poll(() => readWidthsAsync(page)).toEqual(expectedState);
        await page.keyboard.press('Control+z');
        for (const side of ['left', 'right'] as const) {
            await expect(getDiffHeader(diff, side, 0)).toHaveCSS('width', `${storedWidths.chara}px`);
            await expect(getDiffHeader(diff, side, 1)).toHaveCSS('width', `${oldAttackWidth}px`);
        }
        await expect.poll(() => readWidthsAsync(page)).toEqual({
            tables: {...initialState.tables, chara: {id: storedWidths.chara, attack: oldAttackWidth}},
        });
        await page.keyboard.press('Control+y');
        await expect.poll(() => readWidthsAsync(page)).toEqual(expectedState);
    });
});
