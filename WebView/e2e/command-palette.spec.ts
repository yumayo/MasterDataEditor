import {test, expect} from './fixtures/test';
import {installMockApiAsync} from './fixtures/mock-api';
import {Page} from '@playwright/test';

/**
 * コマンドパレットのE2Eテスト
 *
 * Round 1: Ctrl+Pで表示
 * Round 2: Escapeで閉じる
 * Round 3: オーバーレイクリックで閉じる
 * Round 4: 全項目リスト表示
 * Round 5: 部分一致フィルタリング
 * Round 6: キーボードナビゲーション
 * Round 7: Enter確定でテーブル遷移
 * Round 8: マウスクリック選択
 * Round 9: View遷移
 * Round 10: 再表示リセット
 *
 * コマンドパレットは `.command-palette-overlay` 要素で構成され、
 * `.visible` クラスの付与/削除で表示・非表示を切り替える。
 */

/**
 * テーブル2つ（enemy, item）とビュー1つ（view_enemy）を含むテスト用ファイルシステムを構築する
 */
function createTestFileSystem(): Record<string, string> {
    return {
        'schema/enemy.json': JSON.stringify({
            header: [{key: 0, name: "id", type: "int"}, {key: 1, name: "name", type: "string"}],
            primary_key: "id",
        }),
        'data/enemy.csv': 'id,name\r\n1,Goblin\r\n',
        'schema/item.json': JSON.stringify({
            header: [{key: 0, name: "id", type: "int"}, {key: 1, name: "name", type: "string"}],
            primary_key: "id",
        }),
        'data/item.csv': 'id,name\r\n1,Potion\r\n',
        'view/view_enemy.json': JSON.stringify({
            name: 'view_enemy',
            baseTable: 'enemy',
            joins: [],
        })
    };
}

/**
 * テスト用ファイルシステムをインストールし、非同期初期化の完了を待つ
 */
async function setupTestPageAsync(page: Page): Promise<void> {
    await installMockApiAsync(page, createTestFileSystem());
    await page.goto('/');
    await page.waitForFunction(() => document.querySelectorAll('.explorer-file').length >= 3);
}

test.describe('CommandPalette', () => {
    test('Ctrl+Pでコマンドパレットが表示される', async ({page, mockFileSystem}) => {
        // コマンドパレットのオーバーレイを取得
        const overlay = page.locator('.command-palette-overlay');

        // 初期状態ではvisibleクラスが付いていないこと
        await expect(overlay).not.toHaveClass(/visible/);

        // Ctrl+Pを押下してコマンドパレットを開く
        await page.keyboard.press('Control+p');

        // オーバーレイにvisibleクラスが付与されて表示されること
        await expect(overlay).toHaveClass(/visible/);
        await expect(overlay).toBeVisible();
    });

    test('Escapeキーでコマンドパレットが閉じる', async ({page, mockFileSystem}) => {
        const overlay = page.locator('.command-palette-overlay');

        // Ctrl+Pでコマンドパレットを表示
        await page.keyboard.press('Control+p');
        await expect(overlay).toHaveClass(/visible/);

        // Escapeキーを押下してコマンドパレットを閉じる
        await page.keyboard.press('Escape');

        // オーバーレイからvisibleクラスが削除されて非表示になること
        await expect(overlay).not.toHaveClass(/visible/);
        await expect(overlay).not.toBeVisible();
    });

    test('オーバーレイクリックでコマンドパレットが閉じる', async ({page, mockFileSystem}) => {
        const overlay = page.locator('.command-palette-overlay');

        // Ctrl+Pでコマンドパレットを表示
        await page.keyboard.press('Control+p');
        await expect(overlay).toHaveClass(/visible/);

        // オーバーレイ部分（パレット本体ではなく背景部分）をクリックして閉じる
        // オーバーレイの端をクリックすることで、パレット本体ではなく背景を確実にクリックする
        await overlay.click({position: {x: 1, y: 1}});

        // オーバーレイからvisibleクラスが削除されて非表示になること
        await expect(overlay).not.toHaveClass(/visible/);
        await expect(overlay).not.toBeVisible();
    });

    test('Ctrl+Pで開くと登録済みの全項目がリストに表示される', async ({page}) => {
        await setupTestPageAsync(page);

        // Ctrl+Pでコマンドパレットを開く
        await page.keyboard.press('Control+p');

        // 3つの項目がリストに表示されること
        const items = page.locator('.command-palette-item');
        await expect(items).toHaveCount(3);

        // 各項目のテーブル名が表示されること
        const names = page.locator('.command-palette-item-name');
        await expect(names.nth(0)).toHaveText('enemy');
        await expect(names.nth(1)).toHaveText('item');
        await expect(names.nth(2)).toHaveText('view_enemy');

        // 各項目に種別ラベルが表示されること
        const kinds = page.locator('.command-palette-item-kind');
        await expect(kinds.nth(0)).toHaveText('Table');
        await expect(kinds.nth(1)).toHaveText('Table');
        await expect(kinds.nth(2)).toHaveText('View');
    });

    test('入力テキストで部分一致フィルタリングされる', async ({page}) => {
        await setupTestPageAsync(page);

        // Ctrl+Pでコマンドパレットを開く
        await page.keyboard.press('Control+p');
        const items = page.locator('.command-palette-item');
        const input = page.locator('.command-palette-input');

        // "ene"と入力するとenemy関連のみ表示される（enemy, view_enemy）
        await input.fill('ene');
        await expect(items).toHaveCount(2);
        await expect(page.locator('.command-palette-item-name').nth(0)).toHaveText('enemy');
        await expect(page.locator('.command-palette-item-name').nth(1)).toHaveText('view_enemy');

        // "item"と入力するとitemのみ表示される
        await input.fill('item');
        await expect(items).toHaveCount(1);
        await expect(page.locator('.command-palette-item-name').nth(0)).toHaveText('item');

        // "zzz"と入力すると該当なし
        await input.fill('zzz');
        await expect(items).toHaveCount(0);
        await expect(page.locator('.command-palette-empty')).toBeVisible();
        await expect(page.locator('.command-palette-empty')).toHaveText('該当する項目がありません');

        // 大文字小文字区別なし: "ENE"でもenemy関連が表示される
        await input.fill('ENE');
        await expect(items).toHaveCount(2);
        await expect(page.locator('.command-palette-item-name').nth(0)).toHaveText('enemy');
    });

    test('矢印キーでリスト項目を循環選択できる', async ({page}) => {
        await setupTestPageAsync(page);

        // Ctrl+Pでコマンドパレットを開く
        await page.keyboard.press('Control+p');
        const items = page.locator('.command-palette-item');

        // 初期状態で最初の項目が選択されていること
        await expect(items.nth(0)).toHaveClass(/selected/);
        await expect(items.nth(1)).not.toHaveClass(/selected/);
        await expect(items.nth(2)).not.toHaveClass(/selected/);

        // ↓キーで2番目に移動
        await page.keyboard.press('ArrowDown');
        await expect(items.nth(0)).not.toHaveClass(/selected/);
        await expect(items.nth(1)).toHaveClass(/selected/);
        await expect(items.nth(2)).not.toHaveClass(/selected/);

        // ↓キーで3番目に移動
        await page.keyboard.press('ArrowDown');
        await expect(items.nth(0)).not.toHaveClass(/selected/);
        await expect(items.nth(1)).not.toHaveClass(/selected/);
        await expect(items.nth(2)).toHaveClass(/selected/);

        // ↓キーで先頭に循環
        await page.keyboard.press('ArrowDown');
        await expect(items.nth(0)).toHaveClass(/selected/);
        await expect(items.nth(1)).not.toHaveClass(/selected/);
        await expect(items.nth(2)).not.toHaveClass(/selected/);

        // ↑キーで最後の項目に循環
        await page.keyboard.press('ArrowUp');
        await expect(items.nth(0)).not.toHaveClass(/selected/);
        await expect(items.nth(1)).not.toHaveClass(/selected/);
        await expect(items.nth(2)).toHaveClass(/selected/);
    });

    test('Enterキーで選択中のテーブルタブが開く', async ({page}) => {
        await setupTestPageAsync(page);

        // Ctrl+Pでコマンドパレットを開く
        await page.keyboard.press('Control+p');
        const overlay = page.locator('.command-palette-overlay');
        await expect(overlay).toHaveClass(/visible/);

        // Enterキーで先頭の項目（enemy）を確定する
        await page.keyboard.press('Enter');

        // パレットが閉じること
        await expect(overlay).not.toHaveClass(/visible/);

        // テーブルタブが開いてEditorTableが表示されること
        await expect(page.locator('.editor-table')).toBeVisible();

        // タブボタンにenemyが表示されること
        await expect(page.locator('.tab-button').first()).toContainText('enemy');
    });

    test('マウスクリックで項目を選択してテーブルタブが開く', async ({page}) => {
        await setupTestPageAsync(page);

        // Ctrl+Pでコマンドパレットを開く
        await page.keyboard.press('Control+p');
        const overlay = page.locator('.command-palette-overlay');
        await expect(overlay).toHaveClass(/visible/);

        // 2番目の項目（item）をクリックする
        const items = page.locator('.command-palette-item');
        await items.nth(1).click();

        // パレットが閉じること
        await expect(overlay).not.toHaveClass(/visible/);

        // テーブルタブが開いてEditorTableが表示されること
        await expect(page.locator('.editor-table')).toBeVisible();

        // タブボタンにitemが表示されること
        await expect(page.locator('.tab-button').first()).toContainText('item');
    });

    test('Enterキーでビュータブが開く', async ({page}) => {
        await setupTestPageAsync(page);

        // Ctrl+Pでコマンドパレットを開く
        await page.keyboard.press('Control+p');
        const input = page.locator('.command-palette-input');
        const overlay = page.locator('.command-palette-overlay');

        // "view"で検索してビュー項目のみに絞り込む
        await input.fill('view');
        const items = page.locator('.command-palette-item');
        await expect(items).toHaveCount(1);
        await expect(page.locator('.command-palette-item-name').first()).toHaveText('view_enemy');

        // Enterキーでビュータブを開く
        await page.keyboard.press('Enter');

        // パレットが閉じること
        await expect(overlay).not.toHaveClass(/visible/);

        // ビュータブが開いてEditorTableが表示されること（ビューは複数の非同期読み込みがあるため待機時間を延長）
        await expect(page.locator('.editor-table')).toBeVisible({timeout: 10000});

        // タブボタンにview:view_enemyが表示されること
        await expect(page.locator('.tab-button').first()).toContainText('view:view_enemy');
    });

    test('再表示時に入力欄がリセットされ全項目が表示される', async ({page}) => {
        await setupTestPageAsync(page);

        // Ctrl+Pでコマンドパレットを開く
        await page.keyboard.press('Control+p');
        const input = page.locator('.command-palette-input');
        const items = page.locator('.command-palette-item');

        // "ene"で絞り込む
        await input.fill('ene');
        await expect(items).toHaveCount(2);

        // Escapeで閉じる
        await page.keyboard.press('Escape');

        // 再度Ctrl+Pで開く
        await page.keyboard.press('Control+p');

        // 入力欄が空にリセットされていること
        await expect(input).toHaveValue('');

        // 全項目（3件）が表示されていること
        await expect(items).toHaveCount(3);
    });
});
