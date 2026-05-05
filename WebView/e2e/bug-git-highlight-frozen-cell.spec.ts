import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { getDataCell } from './fixtures/test-utils';

const FROZEN_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
        { key: 2, name: "value", type: "int" },
    ],
    primary_key: ["id"],
    frozenRowCount: 1,
    frozenColumnCount: 2,
});

const CURRENT_CSV = [
    "id,name,value",
    "1,item_a,150",
    "2,item_b_changed,200",
].join("\n");

const HEAD_CSV = [
    "id,name,value",
    "1,item_a,100",
    "2,item_b,200",
].join("\n");

const GIT_STATUS = {
    changes: [{ path: "data/test.csv", tableName: "test", isNew: false }],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

const HEAD_FILES: Record<string, string> = {
    "data/test.csv": HEAD_CSV,
};

function createFileSystem(): MockFileSystem {
    return {
        "schema/test.json": FROZEN_SCHEMA,
        "data/test.csv": CURRENT_CSV,
    };
}

interface Fixtures {
    frozenGitPage: void;
}

const test = base.extend<Fixtures>({
    frozenGitPage: async ({ page }, use) => {
        await page.addInitScript((args: {
            status: typeof GIT_STATUS;
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');
        await use();
    },
});

test.describe('git差分ハイライト（固定行・固定列）', () => {
    test('固定行・固定列の変更セルも緑背景で表示されること', async ({ page, frozenGitPage: _ }) => {
        await page.locator('#explorer .explorer-file').getByText('test').click();

        const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="test"] .editor-table');
        const frozenRowChangedCell = getDataCell(table, 0, 2);
        const frozenColumnChangedCell = getDataCell(table, 1, 1);

        await expect(frozenRowChangedCell).toHaveClass(/cell-git-changed/);
        await expect(frozenRowChangedCell).toHaveClass(/freeze-cell/);
        await expect(frozenColumnChangedCell).toHaveClass(/cell-git-changed/);
        await expect(frozenColumnChangedCell).toHaveClass(/freeze-cell/);

        await expect.poll(() => frozenRowChangedCell.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(48, 72, 58)');
        await expect.poll(() => frozenColumnChangedCell.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(48, 72, 58)');
    });
});
