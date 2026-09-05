import {test, expect} from './fixtures/test';
import {installMockApiAsync, MockFileSystem, readMockFileAsync} from './fixtures/mock-api';

const storedWidths = {enemy: 337, chara: 173};

function createFileSystem(): MockFileSystem {
    const fs: MockFileSystem = {
        'user:column-widths.json': JSON.stringify({
            tables: {enemy: {id: storedWidths.enemy}, chara: {id: storedWidths.chara}},
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
});
