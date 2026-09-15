import {test, expect} from './fixtures/test';
import {installMockApiAsync} from './fixtures/mock-api';
import {getDataCell} from './fixtures/test-utils';
import type {Locator, Page} from '@playwright/test';

const schema = JSON.stringify({
    header: [
        {key: 0, name: 'id', type: 'int'},
        {key: 1, name: 'name', type: 'string'},
        {key: 2, name: 'value', type: 'int'},
    ],
    primary_key: ['id'],
});
const headCsv = 'id,name,value\n1,sword,100\n2,shield,200\n3,potion,50\n4,ring,300';
const currentCsv = 'id,name,value\n1,sword,150\n2,shield,200\n4,ring,300\n5,staff,400';

async function openDiffTab(page: Page, staged: boolean): Promise<void> {
    await page.addInitScript(({staged, headCsv}) => {
        const entry = {path: 'data/item.csv', tableName: 'item', isNew: false};
        Object.assign(window, {
            __mockGitStatus: {changes: staged ? [] : [entry], staged: staged ? [entry] : []},
            __mockGitHeadFiles: {'data/item.csv': headCsv},
        });
    }, {staged, headCsv});
    await installMockApiAsync(page, {'schema/item.json': schema, 'data/item.csv': currentCsv});
    await page.goto('/');
    await page.locator('[data-panel="sourceControl"]').click();
    await page.locator(staged ? '.source-control-staged-section' : '.source-control-changes-section').getByText('item', {exact: true}).click();
    await expect(page.locator('.diff-tab')).toBeVisible();
}

async function expectSelection(table: Locator, startRow: number, startCol: number, endRow: number, endCol: number, focusRow = startRow, focusCol = startCol): Promise<void> {
    await expect(getDataCell(table, focusRow, focusCol)).toHaveClass(/editor-table-cell-focused/);
    await expect(getDataCell(table, startRow, startCol)).toHaveClass(/sel-top/);
    await expect(getDataCell(table, startRow, startCol)).toHaveClass(/sel-left/);
    await expect(getDataCell(table, endRow, endCol)).toHaveClass(/sel-bottom/);
    await expect(getDataCell(table, endRow, endCol)).toHaveClass(/sel-right/);
    await expect(table.locator('.sel-bg')).toHaveCount((endRow - startRow + 1) * (endCol - startCol + 1) - 1);
}

for (const staged of [false, true]) {
    test.describe(staged ? 'ステージ済み差分の選択同期' : '作業ツリー差分の選択同期', () => {
        test.beforeEach(async ({page}) => { await openDiffTab(page, staged); });

        test('左右のクリックとキー移動で同じセルを選択する', async ({page}) => {
            const left = page.locator('.diff-pane-left .editor-table');
            const right = page.locator('.diff-pane-right .editor-table');
            for (const source of [right, left]) {
                await getDataCell(source, 1, 1).click();
                for (const table of [left, right]) await expectSelection(table, 1, 1, 1, 1);
                await page.keyboard.press('ArrowRight');
                for (const table of [left, right]) await expectSelection(table, 1, 2, 1, 2);
                await page.keyboard.press('Shift+ArrowDown');
                for (const table of [left, right]) await expectSelection(table, 1, 2, 2, 2);
            }
        });

        test('逆方向のドラッグ範囲とアンカーを同期する', async ({page}) => {
            const left = page.locator('.diff-pane-left .editor-table');
            const right = page.locator('.diff-pane-right .editor-table');
            for (const source of [left, right]) {
                const start = await getDataCell(source, 3, 2).boundingBox();
                const end = await getDataCell(source, 0, 0).boundingBox();
                if (start === null || end === null) throw new Error('セルの位置を取得できません');
                await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
                await page.mouse.down();
                await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {steps: 8});
                await page.mouse.up();
                for (const table of [left, right]) await expectSelection(table, 0, 0, 3, 2, 3, 2);
                // 範囲の向きが保持され、Shift操作がドラッグ終点から続くことも検証する。
                await page.keyboard.press('Shift+ArrowDown');
                for (const table of [left, right]) await expectSelection(table, 1, 0, 3, 2, 3, 2);
            }
        });

        test('追加・削除行では反対側の空白セルを選択する', async ({page}) => {
            const left = page.locator('.diff-pane-left .editor-table');
            const right = page.locator('.diff-pane-right .editor-table');
            await expect(right.locator('.editor-table-row').nth(2)).toHaveClass(/diff-row-empty/);
            await getDataCell(left, 2, 1).click();
            for (const table of [left, right]) await expectSelection(table, 2, 1, 2, 1);
            await expect(left.locator('.editor-table-row').nth(4)).toHaveClass(/diff-row-empty/);
            await getDataCell(right, 4, 1).click();
            for (const table of [left, right]) await expectSelection(table, 4, 1, 4, 1);
        });
    });
}
