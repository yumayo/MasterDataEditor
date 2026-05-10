import { Page, Locator } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

const SETTINGS_FILE = 'userdata/settings.json';

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
            await installMockApiAsync(page, createExportDatePkFileSystem('2026-05-10T14:40:55'));
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

            await expect(firstPkCell).toHaveClass(/cell-pk-duplicate/, { timeout: 10000 });
            await expect(secondPkCell).toHaveClass(/cell-pk-duplicate/);
            await expect(thirdPkCell).not.toHaveClass(/cell-pk-duplicate/);
            await expect(firstBeginCell).toHaveClass(/cell-error/);
            await expect(firstEndCell).toHaveClass(/cell-error/);
            await expect(secondBeginCell).toHaveClass(/cell-error/);
            await expect(secondEndCell).toHaveClass(/cell-error/);
            await expect(thirdBeginCell).not.toHaveClass(/cell-error/);
            await expect(thirdEndCell).not.toHaveClass(/cell-error/);

            await setExportValidationDateTimeAsync(page, '2026-05-12T00:00:00');
            await page.locator('.tab-button').filter({ hasText: 'item' }).click();

            await expect(firstPkCell).toHaveClass(/cell-pk-duplicate/, { timeout: 10000 });
            await expect(secondPkCell).toHaveClass(/cell-pk-duplicate/);
            await expect(thirdPkCell).not.toHaveClass(/cell-pk-duplicate/);
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
                '2026-05-10T00:00:00',
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

            await expect(firstPkCell).toHaveClass(/cell-pk-duplicate/, { timeout: 10000 });
            await expect(secondPkCell).toHaveClass(/cell-pk-duplicate/);
        },
    );

    test(
        'settings.jsonで指定したexport期間列名を使ってPK重複を判定する',
        async ({ page }) => {
            await installMockApiAsync(page, createExportDatePkFileSystem('2026-05-10T14:40:55', 'start_at', 'finish_at'));
            await page.goto('/');

            const table = await openTableAsync(page, 'item');
            const firstPkCell = getPkCell(table, 0);
            const secondPkCell = getPkCell(table, 1);
            const thirdPkCell = getPkCell(table, 2);

            await expect(firstPkCell).toHaveClass(/cell-pk-duplicate/, { timeout: 10000 });
            await expect(secondPkCell).toHaveClass(/cell-pk-duplicate/);
            await expect(thirdPkCell).not.toHaveClass(/cell-pk-duplicate/);
        },
    );
});
