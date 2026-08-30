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
 * Round 9: 再表示リセット
 *
 * コマンドパレットは `.command-palette-overlay` 要素で構成され、
 * `.visible` クラスの付与/削除で表示・非表示を切り替える。
 */

/**
 * テーブル2つ（enemy, item）を含むテスト用ファイルシステムを構築する
 * enemy には「エネミーマスター」、item には「アイテムマスター」という description を持つ
 */
function createTestFileSystem(): Record<string, string> {
    return {
        'schema/enemy.json': JSON.stringify({
            description: 'エネミーマスター',
            header: [{key: 0, name: "id", type: "int"}, {key: 1, name: "name", type: "string"}],
            primary_key: ["id"],
        }),
        'data/enemy.csv': 'id,name\r\n1,Goblin\r\n',
        'schema/item.json': JSON.stringify({
            description: 'アイテムマスター',
            header: [{key: 0, name: "id", type: "int"}, {key: 1, name: "name", type: "string"}],
            primary_key: ["id"],
        }),
        'data/item.csv': 'id,name\r\n1,Potion\r\n',
    };
}

/**
 * テスト用ファイルシステムをインストールし、非同期初期化の完了を待つ
 */
async function setupTestPageAsync(page: Page): Promise<void> {
    await installMockApiAsync(page, createTestFileSystem());
    await page.goto('/');
    await page.waitForFunction(() => document.querySelectorAll('.explorer-file').length >= 2);
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
        await page.locator('body').click({position: {x: 1, y: 1}});
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
        await page.locator('body').click({position: {x: 1, y: 1}});
        await page.keyboard.press('Control+p');
        await expect(overlay).toHaveClass(/visible/);

        // オーバーレイ部分（パレット本体ではなく背景部分）をクリックして閉じる
        // オーバーレイの端をクリックすることで、パレット本体ではなく背景を確実にクリックする
        await overlay.click({position: {x: 1, y: 1}});

        // オーバーレイからvisibleクラスが削除されて非表示になること
        await expect(overlay).not.toHaveClass(/visible/);
        await expect(overlay).not.toBeVisible();
    });

    test('descriptionなしのテーブルはパレット項目に.command-palette-item-description要素が存在しない', async ({page, mockFileSystem}) => {
        // mockFileSystem フィクスチャ（descriptionなしテーブル）を使用
        // Ctrl+Pでコマンドパレットを開く
        await page.keyboard.press('Control+p');

        // .command-palette-item-description 要素が存在しないこと
        await expect(page.locator('.command-palette-item-description')).toHaveCount(0);
    });

    test('Ctrl+Pで開くと登録済みの全項目がリストに表示される', async ({page}) => {
        await setupTestPageAsync(page);

        // Ctrl+Pでコマンドパレットを開く
        await page.keyboard.press('Control+p');

        // 2つの項目がリストに表示されること
        const items = page.locator('.command-palette-item');
        await expect(items).toHaveCount(2);

        // 各項目のテーブル名が表示されること
        const names = page.locator('.command-palette-item-name');
        await expect(names.nth(0)).toHaveText('enemy');
        await expect(names.nth(1)).toHaveText('item');
    });

    test('入力テキストで部分一致フィルタリングされる', async ({page}) => {
        await setupTestPageAsync(page);

        // Ctrl+Pでコマンドパレットを開く
        await page.keyboard.press('Control+p');
        const items = page.locator('.command-palette-item');
        const input = page.locator('.command-palette-input');

        // "ene"と入力するとenemyのみ表示される
        await input.fill('ene');
        await expect(items).toHaveCount(1);
        await expect(page.locator('.command-palette-item-name').nth(0)).toHaveText('enemy');

        // "item"と入力するとitemのみ表示される
        await input.fill('item');
        await expect(items).toHaveCount(1);
        await expect(page.locator('.command-palette-item-name').nth(0)).toHaveText('item');

        // "zzz"と入力すると該当なし
        await input.fill('zzz');
        await expect(items).toHaveCount(0);
        await expect(page.locator('.command-palette-empty')).toBeVisible();
        await expect(page.locator('.command-palette-empty')).toHaveText('該当する項目がありません');

        // 大文字小文字区別なし: "ENE"でもenemyが表示される
        await input.fill('ENE');
        await expect(items).toHaveCount(1);
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

        // ↓キーで2番目に移動
        await page.keyboard.press('ArrowDown');
        await expect(items.nth(0)).not.toHaveClass(/selected/);
        await expect(items.nth(1)).toHaveClass(/selected/);

        // ↓キーで先頭に循環
        await page.keyboard.press('ArrowDown');
        await expect(items.nth(0)).toHaveClass(/selected/);
        await expect(items.nth(1)).not.toHaveClass(/selected/);

        // ↑キーで最後の項目に循環
        await page.keyboard.press('ArrowUp');
        await expect(items.nth(0)).not.toHaveClass(/selected/);
        await expect(items.nth(1)).toHaveClass(/selected/);
    });

    test('マウスでhoverした項目から矢印キー選択が継続する', async ({page}) => {
        await setupTestPageAsync(page);

        // Ctrl+Pでコマンドパレットを開く
        await page.keyboard.press('Control+p');
        const items = page.locator('.command-palette-item');
        const selectedBackground = await items.nth(0).evaluate(el => getComputedStyle(el).backgroundColor);

        // 2番目の項目をマウスで選択すると、内部の選択indexも同期されること
        await items.nth(1).hover();
        await expect(items.nth(0)).not.toHaveClass(/selected/);
        await expect(items.nth(1)).toHaveClass(/selected/);

        // ↓キーはhover前の先頭ではなく、hoverした2番目から継続して先頭へ循環すること
        await page.keyboard.press('ArrowDown');
        await expect(items.nth(0)).toHaveClass(/selected/);
        await expect(items.nth(1)).not.toHaveClass(/selected/);
        await expect(items.nth(0)).toHaveCSS('background-color', selectedBackground);
        await expect(items.nth(1)).not.toHaveCSS('background-color', selectedBackground);
    });

    test('静止中のマウス位置に再表示しても先頭を選択し、動かすとhover項目を選択する', async ({page}) => {
        await setupTestPageAsync(page);

        await page.keyboard.press('Control+p');
        const items = page.locator('.command-palette-item');
        const secondItem = items.nth(1);

        // 2番目の項目上へマウスを移動してからパレットを閉じる。
        await secondItem.hover();
        await expect(secondItem).toHaveClass(/selected/);
        await page.keyboard.press('Escape');

        // マウスを動かさず同じ位置へ再表示しても、選択は先頭のままにする。
        await page.keyboard.press('Control+p');
        await expect(items.nth(0)).toHaveClass(/selected/);
        await expect(secondItem).not.toHaveClass(/selected/);

        // 再表示後にマウスを動かしたら、カーソル下の項目へ選択を移す。
        const box = await secondItem.boundingBox();
        if (box === null) throw new Error('2番目のコマンドパレット項目の位置を取得できません');
        await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
        await expect(secondItem).toHaveClass(/selected/);
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

    test('テーブルの説明（description）がコマンドパレットの各項目に表示される', async ({page}) => {
        await setupTestPageAsync(page);

        // Ctrl+Pでコマンドパレットを開く
        await page.keyboard.press('Control+p');

        // enemy の説明が .command-palette-item-description に表示されること
        const descriptions = page.locator('.command-palette-item-description');
        await expect(descriptions).toHaveCount(2);
        await expect(descriptions.nth(0)).toHaveText('エネミーマスター');
        await expect(descriptions.nth(1)).toHaveText('アイテムマスター');
    });

    test('テーブルの説明（description）でフィルタリングにヒットする', async ({page}) => {
        await setupTestPageAsync(page);

        // Ctrl+Pでコマンドパレットを開く
        await page.keyboard.press('Control+p');
        const input = page.locator('.command-palette-input');
        const items = page.locator('.command-palette-item');

        // "エネミー"と入力するとenemyのみ表示される
        await input.fill('エネミー');
        await expect(items).toHaveCount(1);
        await expect(page.locator('.command-palette-item-name').nth(0)).toHaveText('enemy');

        // "アイテム"と入力するとitemのみ表示される
        await input.fill('アイテム');
        await expect(items).toHaveCount(1);
        await expect(page.locator('.command-palette-item-name').nth(0)).toHaveText('item');
    });

    test('コマンドパレットの角は共通の角丸で表示される', async ({page}) => {
        // setupTestPageAsync は不要（パレットのスタイルはデータ依存なし）
        await installMockApiAsync(page, createTestFileSystem());
        await page.goto('/');

        // Ctrl+Pでコマンドパレットを表示
        await page.keyboard.press('Control+p');

        // .command-palette の border-radius が共通トークンと同じであること
        const expectedRadius = await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--border-radius').trim()
        );
        const palette = page.locator('.command-palette');
        await expect(palette).toHaveCSS('border-radius', expectedRadius);
    });

    test('ローマ字入力でdescriptionにマッチしてフィルタリングされる', async ({page}) => {
        // description: エネミーマスター / アイテムマスター
        await setupTestPageAsync(page);
        await page.keyboard.press('Control+p');
        const input = page.locator('.command-palette-input');
        const items = page.locator('.command-palette-item');

        // "aitemu" でローマ字変換→"あいてむ" が description "アイテムマスター" に部分マッチ
        await input.fill('aitemu');
        await expect(items).toHaveCount(1);
        await expect(page.locator('.command-palette-item-name').nth(0)).toHaveText('item');

        // "enemii" でローマ字変換→"えねみー" が description "エネミーマスター" に部分マッチ
        await input.fill('ene');
        await expect(items).toHaveCount(1);
        await expect(page.locator('.command-palette-item-name').nth(0)).toHaveText('enemy');
    });

    test('ヒット部分にハイライトクラスが付与される', async ({page}) => {
        // description: エネミーマスター / アイテムマスター
        await setupTestPageAsync(page);
        await page.keyboard.press('Control+p');
        const input = page.locator('.command-palette-input');

        // "item" でフィルタリング
        await input.fill('item');
        // ヒット部分に .search-highlight クラスが付与された span が存在すること
        const highlights = page.locator('.command-palette-item .search-highlight');
        await expect(highlights.first()).toBeVisible();
    });

    test('再表示時に入力欄がリセットされ全項目が表示される', async ({page}) => {
        await setupTestPageAsync(page);

        // Ctrl+Pでコマンドパレットを開く
        await page.keyboard.press('Control+p');
        const input = page.locator('.command-palette-input');
        const items = page.locator('.command-palette-item');

        // "ene"で絞り込む
        await input.fill('ene');
        await expect(items).toHaveCount(1);

        // Escapeで閉じる
        await page.keyboard.press('Escape');

        // 再度Ctrl+Pで開く
        await page.keyboard.press('Control+p');

        // 入力欄が空にリセットされていること
        await expect(input).toHaveValue('');

        // 全項目（2件）が表示されていること
        await expect(items).toHaveCount(2);
    });
});
