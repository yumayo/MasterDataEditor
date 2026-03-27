import {test, expect} from './fixtures/test';
import {installMockApiAsync} from './fixtures/mock-api';
import {Page} from '@playwright/test';

/**
 * コマンドパレット クエリ式セルジャンプのE2Eテスト
 *
 * 「テーブル名.列名=値」形式の入力で該当行を検索し、
 * 確定時に Tab.navigateToTableCell でセルにジャンプする。
 */

/**
 * テスト用ファイルシステムを構築する
 * item テーブル: id(PK), name, value の3列
 */
function createTestFileSystem(): Record<string, string> {
    return {
        'schema/item.json': JSON.stringify({
            description: 'アイテムマスター',
            header: [
                {key: 0, name: 'id', type: 'int'},
                {key: 1, name: 'name', type: 'string'},
                {key: 2, name: 'value', type: 'int'},
            ],
            primary_key: ['id'],
        }),
        'data/item.csv': 'id,name,value\r\n1,Sword,100\r\n2,Shield,200\r\n3,Potion,50\r\n',
    };
}

/**
 * テスト用ファイルシステムをインストールし、非同期初期化の完了を待つ
 */
async function setupTestPageAsync(page: Page): Promise<void> {
    await installMockApiAsync(page, createTestFileSystem());
    await page.goto('/');
    await page.waitForFunction(() => document.querySelectorAll('.explorer-file').length >= 1);
}

test.describe('コマンドパレット クエリ式セルジャンプ', () => {
    test('クエリ式入力で該当行が候補に表示される', async ({page}) => {
        await setupTestPageAsync(page);

        // Ctrl+P でコマンドパレットを表示する
        await page.keyboard.press('Control+p');
        const input = page.locator('.command-palette-input');

        // クエリ式「item.name=Sword」を入力する
        await input.fill('item.name=Sword');

        // クエリ式候補アイテムが表示されること
        const items = page.locator('.command-palette-item');
        await expect(items).toHaveCount(1);

        // 候補にテーブル名・PK値・マッチした値が含まれること
        const itemText = await items.nth(0).textContent();
        expect(itemText).toContain('item');
        expect(itemText).toContain('1');
        expect(itemText).toContain('Sword');
    });

    test('候補を確定すると該当セルにジャンプする', async ({page}) => {
        await setupTestPageAsync(page);

        // Ctrl+P でコマンドパレットを表示する
        await page.keyboard.press('Control+p');
        const input = page.locator('.command-palette-input');
        const overlay = page.locator('.command-palette-overlay');

        // クエリ式「item.name=Shield」を入力する
        await input.fill('item.name=Shield');

        // 候補が表示されることを確認する
        const items = page.locator('.command-palette-item');
        await expect(items).toHaveCount(1);

        // Enterで確定する
        await page.keyboard.press('Enter');

        // パレットが閉じること
        await expect(overlay).not.toHaveClass(/visible/);

        // テーブルタブが開いてEditorTableが表示されること
        await expect(page.locator('.editor-table')).toBeVisible();
        await expect(page.locator('.tab-button').first()).toContainText('item');

        // 該当テーブルのセルにジャンプしていること（選択オーバーレイが表示される）
        const selection = page.locator('.selection');
        await expect(selection).toBeVisible();
    });

    test('通常のテーブル名入力は従来通り動作する', async ({page}) => {
        await setupTestPageAsync(page);

        // Ctrl+P でコマンドパレットを表示する
        await page.keyboard.press('Control+p');
        const input = page.locator('.command-palette-input');

        // 通常のテーブル名「item」を入力する（クエリ式ではない）
        await input.fill('item');

        // 従来通りテーブル名でファジー検索されること
        const items = page.locator('.command-palette-item');
        await expect(items).toHaveCount(1);
        await expect(page.locator('.command-palette-item-name').nth(0)).toHaveText('item');
    });

    test('存在しないテーブル名のクエリ式で警告が表示される', async ({page}) => {
        await setupTestPageAsync(page);

        // Ctrl+P でコマンドパレットを表示する
        await page.keyboard.press('Control+p');
        const input = page.locator('.command-palette-input');

        // 存在しないテーブル名「unknown.name=test」を入力する
        await input.fill('unknown.name=test');

        // 該当なしメッセージにテーブル名が含まれること
        const emptyMessage = page.locator('.command-palette-empty');
        await expect(emptyMessage).toBeVisible();
        await expect(emptyMessage).toContainText("テーブル 'unknown' が見つかりません");
    });
});
