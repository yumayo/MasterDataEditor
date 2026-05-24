import { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

const SETTINGS_FILE = '.masterdataeditor/settings.json';

function createExportDatePkFileSystem(
    exportValidationDateTime: string,
    beginColumnName = 'export_begin_date',
    endColumnName = 'export_end_date',
    dataRows: string[] = [
        '1,2026-05-10 00:00:00,2026-05-11 23:59:59,before',
        '1,2026-05-11 00:00:00,2026-05-11 23:59:59,overlap',
        '1,2026-05-12 00:00:00,2026-05-13 00:00:00,later',
        '2,2026-05-01 00:00:00,,stable',
    ],
): MockFileSystem {
    return {
        [SETTINGS_FILE]: JSON.stringify({
            theme: 'dark',
            tabWrapEnabled: false,
            exportValidationDateTime,
            exportBeginDateColumnName: beginColumnName,
            exportEndDateColumnName: endColumnName,
        }),
        'schema/item.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: beginColumnName, type: 'string' },
                { key: 2, name: endColumnName, type: 'string' },
                { key: 3, name: 'name', type: 'string' },
            ],
            primary_key: ['id'],
        }),
        'data/item.csv': [
            `id,${beginColumnName},${endColumnName},name`,
            ...dataRows,
        ].join('\n'),
    };
}

function createExportDateFkFileSystem(exportValidationDateTime: string): MockFileSystem {
    return {
        [SETTINGS_FILE]: JSON.stringify({
            theme: 'dark',
            tabWrapEnabled: false,
            exportValidationDateTime,
            exportBeginDateColumnName: 'export_begin_date',
            exportEndDateColumnName: 'export_end_date',
        }),
        'schema/chara.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'export_begin_date', type: 'datetime' },
                { key: 2, name: 'export_end_date', type: 'datetime' },
                { key: 3, name: 'name', type: 'string' },
            ],
            primary_key: ['id'],
        }),
        'data/chara.csv': [
            'id,export_begin_date,export_end_date,name',
            '1,2026-01-01 00:00:00,2026-02-28 23:59:59,winter',
            '1,2026-05-01 00:00:00,2026-05-31 23:59:59,may',
            '2,,,stable',
        ].join('\n'),
        'schema/chara_name.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int', reference: 'chara.id' },
                { key: 1, name: 'ja', type: 'string' },
            ],
            primary_key: ['id'],
        }),
        'data/chara_name.csv': [
            'id,ja',
            '1,アリス',
            '2,ボブ',
        ].join('\n'),
    };
}

function createDynamicReferenceCharaOutOfPeriodFileSystem(): MockFileSystem {
    return {
        [SETTINGS_FILE]: JSON.stringify({
            theme: 'dark',
            tabWrapEnabled: false,
            exportValidationDateTime: '2026-03-20 00:00:00',
            exportBeginDateColumnName: 'export_begin_date',
            exportEndDateColumnName: 'export_end_date',
        }),
        'schema/table.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'master', type: 'string' },
                { key: 2, name: 'column', type: 'string' },
            ],
            primary_key: ['id'],
        }),
        'data/table.csv': [
            'id,master,column',
            '1,chara,id',
        ].join('\n'),
        'schema/chara.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'recover_stamina', type: 'int' },
                { key: 2, name: 'recover_hp', type: 'int' },
                { key: 3, name: 'attack', type: 'int' },
                { key: 4, name: 'defence', type: 'int' },
                { key: 5, name: 'speed', type: 'int' },
                { key: 6, name: 'skill_id', type: 'int' },
                { key: 7, name: 'selling_price', type: 'int' },
                { key: 8, name: 'export_begin_date', type: 'datetime' },
                { key: 9, name: 'export_end_date', type: 'datetime' },
            ],
            primary_key: ['id'],
        }),
        'data/chara.csv': [
            'id,recover_stamina,recover_hp,attack,defence,speed,skill_id,selling_price,export_begin_date,export_end_date',
            '1,8,14,0,0,7,99,4631,2026-05-10 00:00:00,2026-05-10 23:59:59',
            '1,1,14,0,0,7,11,3079,2026-05-11 00:00:00,2026-05-11 23:59:59',
            '1,3,7,0,0,10,33,627,2026-05-12 00:00:00,2026-05-12 23:59:59',
            '1,7,4,0,0,8,98,3667,2026-01-12 00:00:00,2026-02-12 23:59:59',
        ].join('\n'),
        'schema/gacha_item.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'table_id', type: 'int', reference: 'table.id' },
                {
                    key: 2,
                    name: 'record_id',
                    type: 'int',
                    reference: {
                        sourceTable: 'table',
                        sourceMatchColumn: 'id',
                        sourceMatchValue: 'table_id',
                        destTable: 'master',
                        destColumn: 'column',
                    },
                },
            ],
            primary_key: ['id'],
        }),
        'data/gacha_item.csv': [
            'id,table_id,record_id',
            '1,1,1',
        ].join('\n'),
    };
}

async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    await page.locator('#explorer').getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

function getPkCell(table: Locator, rowIndex: number): Locator {
    return getDataCell(table, rowIndex, 0);
}

function getDataCell(table: Locator, rowIndex: number, columnIndex: number): Locator {
    return table.locator('.editor-table-row').nth(rowIndex)
        .locator('.editor-table-cell:not(.editor-table-row-header)').nth(columnIndex);
}

async function setExportValidationDateTimeAsync(page: Page, value: string): Promise<void> {
    await page.locator('.activity-bar-settings').click();
    const input = page.locator('.settings-export-validation-datetime-input');
    await expect(input).toBeVisible();
    await input.fill(value);
    await input.blur();
    await page.waitForFunction(
        ({ path, expected }) => {
            const raw = (window as unknown as { __mockFs: Record<string, string> }).__mockFs[path];
            if (typeof raw !== 'string') return false;
            try {
                const parsed = JSON.parse(raw) as { exportValidationDateTime?: string };
                return parsed.exportValidationDateTime === expected;
            } catch {
                return false;
            }
        },
        { path: SETTINGS_FILE, expected: value },
        { timeout: 5000 },
    );
}

test.describe('export_begin_date/export_end_date付きPK検証', () => {
    test(
        '設定時刻に片方しか有効でなくても期間が重なる同一PKは重複エラーにする',
        async ({ page }) => {
            await installMockApiAsync(page, createExportDatePkFileSystem('2026-05-10 14:40:55'));
            await page.goto('/');

            const table = await openTableAsync(page, 'item');
            const firstPkCell = getPkCell(table, 0);
            const secondPkCell = getPkCell(table, 1);
            const thirdPkCell = getPkCell(table, 2);
            const firstBeginCell = getDataCell(table, 0, 1);
            const firstEndCell = getDataCell(table, 0, 2);
            const secondBeginCell = getDataCell(table, 1, 1);
            const secondEndCell = getDataCell(table, 1, 2);
            const thirdBeginCell = getDataCell(table, 2, 1);
            const thirdEndCell = getDataCell(table, 2, 2);

            await expect(firstPkCell).toHaveClass(/cell-error/, { timeout: 10000 });
            await expect(secondPkCell).toHaveClass(/cell-error/);
            await expect(thirdPkCell).not.toHaveClass(/cell-error/);
            await expect(firstBeginCell).toHaveClass(/cell-error/);
            await expect(firstEndCell).toHaveClass(/cell-error/);
            await expect(secondBeginCell).toHaveClass(/cell-error/);
            await expect(secondEndCell).toHaveClass(/cell-error/);
            await expect(thirdBeginCell).not.toHaveClass(/cell-error/);
            await expect(thirdEndCell).not.toHaveClass(/cell-error/);

            await setExportValidationDateTimeAsync(page, '2026-05-12 00:00:00');
            await page.locator('.tab-button').filter({ hasText: 'item' }).click();

            await expect(firstPkCell).toHaveClass(/cell-error/, { timeout: 10000 });
            await expect(secondPkCell).toHaveClass(/cell-error/);
            await expect(thirdPkCell).not.toHaveClass(/cell-error/);
            await expect(firstBeginCell).toHaveClass(/cell-error/);
            await expect(firstEndCell).toHaveClass(/cell-error/);
            await expect(secondBeginCell).toHaveClass(/cell-error/);
            await expect(secondEndCell).toHaveClass(/cell-error/);
            await expect(thirdBeginCell).not.toHaveClass(/cell-error/);
            await expect(thirdEndCell).not.toHaveClass(/cell-error/);
        },
    );

    test(
        'endとbeginが同時刻の同一PKは重複エラーにする',
        async ({ page }) => {
            await installMockApiAsync(page, createExportDatePkFileSystem(
                '2026-05-10 00:00:00',
                'export_begin_date',
                'export_end_date',
                [
                    '1,2026-05-01 00:00:00,2026-05-10 00:00:00,before',
                    '1,2026-05-10 00:00:00,2026-05-20 00:00:00,after',
                ],
            ));
            await page.goto('/');

            const table = await openTableAsync(page, 'item');
            const firstPkCell = getPkCell(table, 0);
            const secondPkCell = getPkCell(table, 1);

            await expect(firstPkCell).toHaveClass(/cell-error/, { timeout: 10000 });
            await expect(secondPkCell).toHaveClass(/cell-error/);
        },
    );

    test(
        'beginがendより後の行は期間付きPK重複として扱わない',
        async ({ page }) => {
            await installMockApiAsync(page, createExportDatePkFileSystem(
                '2026-05-10 00:00:00',
                'export_begin_date',
                'export_end_date',
                [
                    '1,2026-05-10 00:00:00,2026-05-10 23:59:59,first',
                    '1,2026-05-11 00:00:00,2026-05-11 23:59:59,next',
                    '1,2026-05-12 00:00:00,2026-05-12 23:59:59,later',
                    '1,2026-05-11 00:00:00,2026-02-12 23:59:59,invalid-window',
                ],
            ));
            await page.goto('/');

            const table = await openTableAsync(page, 'item');

            for (let rowIndex = 0; rowIndex < 4; rowIndex++) {
                await expect(getPkCell(table, rowIndex)).not.toHaveClass(/cell-error/, { timeout: 10000 });
                await expect(getDataCell(table, rowIndex, 1)).not.toHaveClass(/cell-error/);
                await expect(getDataCell(table, rowIndex, 2)).not.toHaveClass(/cell-error/);
            }

            await page.locator('.status-bar-badge').click();
            await expect(page.locator('.validation-panel .validation-panel-item')
                .filter({ hasText: '出力フィルター期間が重複しています' })).toHaveCount(0);
        },
    );

    test(
        'settings.jsonで指定したexport期間列名を使ってPK重複を判定する',
        async ({ page }) => {
            await installMockApiAsync(page, createExportDatePkFileSystem('2026-05-10 14:40:55', 'start_at', 'finish_at'));
            await page.goto('/');

            const table = await openTableAsync(page, 'item');
            const firstPkCell = getPkCell(table, 0);
            const secondPkCell = getPkCell(table, 1);
            const thirdPkCell = getPkCell(table, 2);

            await expect(firstPkCell).toHaveClass(/cell-error/, { timeout: 10000 });
            await expect(secondPkCell).toHaveClass(/cell-error/);
            await expect(thirdPkCell).not.toHaveClass(/cell-error/);
        },
    );
});

test.describe('日時セル編集の無変更確定', () => {
    test(
        '重複PKの日時セルを無変更確定しても別期間行を壊さず動的参照の出力期間外エラーを維持する',
        async ({ page }) => {
            await installMockApiAsync(page, createDynamicReferenceCharaOutOfPeriodFileSystem());
            await page.goto('/');

            let gachaItemTable = await openTableAsync(page, 'gacha_item');
            await expect(getDataCell(gachaItemTable, 0, 2)).toHaveClass(/cell-error/, { timeout: 10000 });

            const charaTable = await openTableAsync(page, 'chara');
            const secondBeginCell = getDataCell(charaTable, 1, 8);
            const lastBeginCell = getDataCell(charaTable, 3, 8);

            await expect(secondBeginCell).toHaveText('2026-05-11 00:00:00');
            await expect(lastBeginCell).toHaveText('2026-01-12 00:00:00');

            await secondBeginCell.dblclick();
            await expect(page.locator('.grid-textfield.grid-textfield-active')).toHaveText('2026-05-11 00:00:00');
            await page.keyboard.press('Enter');

            await expect(secondBeginCell).toHaveText('2026-05-11 00:00:00');
            await expect(lastBeginCell).toHaveText('2026-01-12 00:00:00');

            await page.locator('.tab-button').filter({ hasText: 'gacha_item' }).click();
            gachaItemTable = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="gacha_item"] .editor-table');
            await expect(getDataCell(gachaItemTable, 0, 2)).toHaveClass(/cell-error/, { timeout: 10000 });

            await page.locator('.status-bar-badge').click();
            const outOfPeriodError = page.locator('.validation-panel .validation-panel-item')
                .filter({ hasText: 'gacha_item' })
                .filter({ hasText: 'record_id' })
                .filter({ hasText: '値 "1" は存在しますが' })
                .filter({ hasText: '出力期間外です' });
            await expect(outOfPeriodError.first()).toBeVisible();
        },
    );
});

test.describe('export_begin_date/export_end_date付きFK検証', () => {
    test(
        '参照先行が設定時刻の出力期間外ならFK参照切れにする',
        async ({ page }) => {
            await installMockApiAsync(page, createExportDateFkFileSystem('2026-03-18 10:00:00'));
            await page.goto('/');

            const table = await openTableAsync(page, 'chara_name');
            const inactiveCharaIdCell = getDataCell(table, 0, 0);
            const stableCharaIdCell = getDataCell(table, 1, 0);

            await expect(inactiveCharaIdCell).toHaveClass(/cell-error/, { timeout: 10000 });
            await expect(stableCharaIdCell).not.toHaveClass(/cell-error/);

            await page.locator('.status-bar-badge').click();
            const errorMessage = page.locator('.validation-panel .validation-panel-item-message').first();
            await expect(errorMessage).toContainText('2026-03-18 10:00:00 時点');
            await expect(errorMessage).toContainText('出力期間外');
            await expect(errorMessage).not.toContainText('exportValidationDateTime');
            await expect(errorMessage).not.toContainText('存在しません');

            await setExportValidationDateTimeAsync(page, '2026-05-15 00:00:00');
            await page.locator('.tab-button').filter({ hasText: 'chara_name' }).click();

            await expect(inactiveCharaIdCell).not.toHaveClass(/cell-error/, { timeout: 10000 });
            await expect(stableCharaIdCell).not.toHaveClass(/cell-error/);
        },
    );
});
