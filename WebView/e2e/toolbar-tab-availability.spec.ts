import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { installMockApiAsync, type MockFileSystem } from './fixtures/mock-api';

const TEST_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: 'id', type: 'int' },
        { key: 1, name: 'name', type: 'string' },
        { key: 2, name: 'value', type: 'int' },
    ],
    primary_key: ['id'],
});

const CURRENT_CSV = [
    'id,name,value',
    '1,item_a,150',
    '2,item_b,200',
].join('\n');

const HEAD_CSV = [
    'id,name,value',
    '1,item_a,100',
    '2,item_b,200',
].join('\n');

function createToolbarFileSystem(): MockFileSystem {
    return {
        'schema/test.json': TEST_SCHEMA,
        'data/test.csv': CURRENT_CSV,
        'plugins/views/summary.js': [
            'window.masterDataEditor.registerViewPlugin({',
            "  id: 'summary',",
            "  title: 'Summary View',",
            '  render(container) {',
            "    const marker = document.createElement('div');",
            "    marker.className = 'summary-marker';",
            "    marker.textContent = 'summary';",
            '    container.appendChild(marker);',
            '  }',
            '});',
        ].join('\n'),
        'user:bookmarks.json': '[]',
    };
}

async function installToolbarPageAsync(page: Page): Promise<void> {
    await page.addInitScript((args: {
        status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
        headFiles: Record<string, string>;
    }) => {
        (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
        (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
    }, {
        status: {
            changes: [{ path: 'data/test.csv', tableName: 'test', isNew: false }],
            staged: [],
        },
        headFiles: { 'data/test.csv': HEAD_CSV },
    });
    await installMockApiAsync(page, createToolbarFileSystem());
    await page.goto('/');
}

async function expectToolbarButtonsAsync(page: Page, mode: 'all' | 'relations' | 'none'): Promise<void> {
    if (mode === 'none') {
        await expect(page.locator('#toolbar')).toBeHidden();
    } else {
        await expect(page.locator('#toolbar')).toBeVisible();
    }

    const csvButton = page.locator('#toolbar .toolbar-button-csv-export');
    const formButton = page.locator('#toolbar .toolbar-button-form-toggle');
    const relationsButton = page.locator('#toolbar .toolbar-button-relations-toggle');

    if (mode === 'all') {
        await expect(csvButton).toBeVisible();
        await expect(csvButton).toBeEnabled();
        await expect(formButton).toBeVisible();
        await expect(formButton).toBeEnabled();
        await expect(relationsButton).toBeVisible();
        await expect(relationsButton).toBeEnabled();
        return;
    }

    if (mode === 'relations') {
        await expect(csvButton).toBeHidden();
        await expect(formButton).toBeHidden();
        await expect(relationsButton).toBeVisible();
        await expect(relationsButton).toBeEnabled();
        return;
    }

    await expect(csvButton).toBeHidden();
    await expect(formButton).toBeHidden();
    await expect(relationsButton).toBeHidden();
}

test.describe('toolbarのタブ別利用可否', () => {
    test('通常テーブル以外のタブではtoolbarボタンを表示しない', async ({ page }) => {
        await installToolbarPageAsync(page);

        await expectToolbarButtonsAsync(page, 'relations');

        await page.locator('.sidebar-panel-active .explorer-file').getByText('test', { exact: true }).click();
        await expect(page.locator('.editor-left-pane .tab-wrapper[data-tab-name="test"] .editor-table')).toBeVisible();
        await expectToolbarButtonsAsync(page, 'all');

        await page.locator('.activity-bar-settings').click();
        await expect(page.locator('.settings-panel')).toBeVisible();
        await expectToolbarButtonsAsync(page, 'none');

        await page.locator('.tab-button').filter({ hasText: 'test' }).click();
        await expect(page.locator('.editor-left-pane .tab-wrapper[data-tab-name="test"] .editor-table')).toBeVisible();
        await expectToolbarButtonsAsync(page, 'all');

        await page.locator('.explorer-add-table-button').click();
        await expect(page.locator('.table-definition-editor')).toBeVisible();
        await expectToolbarButtonsAsync(page, 'none');

        await page.locator('.activity-bar-item[data-panel="views"]').click();
        await page.locator('.view-plugin-item[data-plugin-id="summary"]').click();
        await expect(page.locator('.view-plugin-tab-root[data-view-plugin-id="summary"] .summary-marker')).toBeVisible();
        await expectToolbarButtonsAsync(page, 'none');

        await page.locator('[data-panel="sourceControl"]').click();
        await page.locator('.source-control-changes-section').getByText('test').click();
        await expect(page.locator('.diff-tab')).toBeVisible();
        await expectToolbarButtonsAsync(page, 'none');
    });
});
