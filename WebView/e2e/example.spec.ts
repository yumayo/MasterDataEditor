import { test, expect } from './fixtures/test';

test(
    'ページが正常に読み込まれること',
    async ({ page, mockFileSystem }) => {
        // Explorer・Tab・Editorの各要素が存在する
        await expect(page.locator('#explorer')).toBeVisible();
        await expect(page.locator('#tab')).toBeVisible();
        await expect(page.locator('#editor')).toBeVisible();
    },
);

test(
    'Explorerにファイル一覧が表示されること',
    async ({ page, mockFileSystem }) => {
        // スキーマから生成されたテーブル名が
        // Explorerに表示される
        const explorer = page.locator('#explorer');

        await expect(explorer.getByText('test')).toBeVisible();

        // アクティビティバーにビューパネルボタンが存在する
        await expect(explorer.locator('[data-panel="views"]')).toBeVisible();
    },
);
