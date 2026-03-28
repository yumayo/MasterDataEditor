import { test, expect } from './fixtures/test';
import type { Page, Locator } from '@playwright/test';
import { readMockFileAsync } from './fixtures/mock-api';

/**
 * テーブル定義エディタの e2e テスト
 *
 * 「+」ボタンからテーブル定義タブを開き、
 * テーブル名・列定義を入力してスキーマJSON + CSV を生成する機能を検証する。
 */

/** エクスプローラーの「+」ボタンを取得する */
function getAddButton(page: Page): Locator {
    return page.locator('.explorer-add-table-button');
}

/** テーブル定義エディタのルート要素を取得する */
function getEditor(page: Page): Locator {
    return page.locator('.table-definition-editor');
}

/** テーブル名入力欄を取得する */
function getNameInput(page: Page): Locator {
    return page.locator('.table-definition-name-input');
}

/** 説明入力欄を取得する */
function getDescInput(page: Page): Locator {
    return page.locator('.table-definition-desc-input');
}

/** 列追加ボタンを取得する */
function getAddColumnButton(page: Page): Locator {
    return page.locator('.table-definition-add-column-button');
}

/** 保存ボタンを取得する */
function getSaveButton(page: Page): Locator {
    return page.locator('.table-definition-save-button');
}

/** テーブル名エラーメッセージを取得する */
function getNameError(page: Page): Locator {
    return page.locator('.table-definition-name-error');
}

/** 保存エラーメッセージを取得する */
function getSaveError(page: Page): Locator {
    return page.locator('.table-definition-save-error');
}

test.describe('テーブル定義エディタ', () => {

    test('エクスプローラーに「+」ボタンが表示される', async ({ page, mockFileSystem }) => {
        void mockFileSystem;
        const addButton = getAddButton(page);
        await expect(addButton).toBeVisible();
        await expect(addButton).toHaveAttribute('title', '新しいテーブルを作成');
    });

    test('「+」ボタンクリックでテーブル定義タブが開く', async ({ page, mockFileSystem }) => {
        void mockFileSystem;
        await getAddButton(page).click();
        // テーブル定義エディタが表示される
        const editor = getEditor(page);
        await expect(editor).toBeVisible();
        // タブバーに「新しいテーブル」タブが表示される
        const tabButton = page.locator('.tab-button', { hasText: '新しいテーブル' });
        await expect(tabButton).toBeVisible();
    });

    test('列を追加してスキーマを保存できる', async ({ page, mockFileSystem }) => {
        void mockFileSystem;
        await getAddButton(page).click();
        const editor = getEditor(page);
        await expect(editor).toBeVisible();

        // テーブル名を入力
        await getNameInput(page).fill('weapon');
        // 説明を入力
        await getDescInput(page).fill('武器マスター');

        // 列を追加する（デフォルトで1列目が存在する想定）
        // 1列目: id (int, PK)
        const firstRow = page.locator('.table-definition-column-row').first();
        await firstRow.locator('.column-name-input').fill('id');
        await firstRow.locator('.column-type-select').selectOption('int');
        await firstRow.locator('.column-pk-checkbox').check();

        // 2列目を追加: name (string)
        await getAddColumnButton(page).click();
        const secondRow = page.locator('.table-definition-column-row').nth(1);
        await secondRow.locator('.column-name-input').fill('name');
        await secondRow.locator('.column-type-select').selectOption('string');

        // 3列目を追加: attack (int)
        await getAddColumnButton(page).click();
        const thirdRow = page.locator('.table-definition-column-row').nth(2);
        await thirdRow.locator('.column-name-input').fill('attack');
        await thirdRow.locator('.column-type-select').selectOption('int');

        // 保存ボタンをクリック
        await getSaveButton(page).click();

        // 保存完了を待機: 定義エディタタブが閉じられる（保存→タブ閉じ→テーブルオープンの一連が完了するシグナル）
        const defTabButton = page.locator('.tab-button', { hasText: '新しいテーブル' });
        await expect(defTabButton).toHaveCount(0);

        // スキーマファイルが生成されていることを検証する
        const schemaJson = await readMockFileAsync(page, 'schema/weapon.json');
        const schema = JSON.parse(schemaJson);
        expect(schema.description).toBe('武器マスター');
        expect(schema.primary_key).toEqual(['id']);
        expect(schema.header).toEqual([
            { key: 0, name: 'id', type: 'int' },
            { key: 1, name: 'name', type: 'string' },
            { key: 2, name: 'attack', type: 'int' },
        ]);

        // CSVファイルが生成されていることを検証する
        const csv = await readMockFileAsync(page, 'data/weapon.csv');
        expect(csv).toBe('id,name,attack');

        // テーブル定義タブが閉じられていることを検証する
        const defTab = page.locator('.tab-button', { hasText: '新しいテーブル' });
        await expect(defTab).toHaveCount(0);

        // 新テーブルがエクスプローラーに追加されていることを検証する
        const explorerItem = page.locator('#explorer').getByText('weapon');
        await expect(explorerItem).toBeVisible();
    });

    test('テーブル名が空のときバリデーションエラーが表示される', async ({ page, mockFileSystem }) => {
        void mockFileSystem;
        await getAddButton(page).click();
        await expect(getEditor(page)).toBeVisible();

        // テーブル名を空のまま列を追加してPK設定
        const firstRow = page.locator('.table-definition-column-row').first();
        await firstRow.locator('.column-name-input').fill('id');
        await firstRow.locator('.column-pk-checkbox').check();

        // 保存ボタンをクリック
        await getSaveButton(page).click();

        // テーブル名のバリデーションエラーが表示される
        await expect(getNameError(page)).toHaveText('テーブル名を入力してください');
    });

    test('テーブル名に不正文字を入力したときバリデーションエラーが表示される', async ({ page, mockFileSystem }) => {
        void mockFileSystem;
        await getAddButton(page).click();
        await expect(getEditor(page)).toBeVisible();

        // 不正な文字を含むテーブル名を入力
        await getNameInput(page).fill('my-table');
        const firstRow = page.locator('.table-definition-column-row').first();
        await firstRow.locator('.column-name-input').fill('id');
        await firstRow.locator('.column-pk-checkbox').check();

        await getSaveButton(page).click();

        // テーブル名のバリデーションエラーが表示される
        await expect(getNameError(page)).toHaveText('英数字とアンダースコアのみ使用できます');
    });

    test('PK未設定のときバリデーションエラーが表示される', async ({ page, mockFileSystem }) => {
        void mockFileSystem;
        await getAddButton(page).click();
        await expect(getEditor(page)).toBeVisible();

        // テーブル名を入力
        await getNameInput(page).fill('weapon');

        // 列名を入力するがPKをチェックしない
        const firstRow = page.locator('.table-definition-column-row').first();
        await firstRow.locator('.column-name-input').fill('id');

        // 保存ボタンをクリック
        await getSaveButton(page).click();

        // PK未設定のエラーが表示される
        await expect(getSaveError(page)).toHaveText('プライマリキーを最低1列設定してください');
    });

    test('保存後にテーブルがエクスプローラーに追加される', async ({ page, mockFileSystem }) => {
        void mockFileSystem;
        await getAddButton(page).click();
        await expect(getEditor(page)).toBeVisible();

        // テーブル名: armor
        await getNameInput(page).fill('armor');

        // 1列目: id (int, PK)
        const firstRow = page.locator('.table-definition-column-row').first();
        await firstRow.locator('.column-name-input').fill('id');
        await firstRow.locator('.column-type-select').selectOption('int');
        await firstRow.locator('.column-pk-checkbox').check();

        // 2列目: defense (int)
        await getAddColumnButton(page).click();
        const secondRow = page.locator('.table-definition-column-row').nth(1);
        await secondRow.locator('.column-name-input').fill('defense');
        await secondRow.locator('.column-type-select').selectOption('int');

        // 保存
        await getSaveButton(page).click();

        // エクスプローラーに armor が表示される
        const explorerItem = page.locator('#explorer').getByText('armor');
        await expect(explorerItem).toBeVisible();

        // armor テーブルがタブで開かれている（エクスプローラーをクリックして通常タブで開く）
        const armorTab = page.locator('.tab-button', { hasText: 'armor' });
        await expect(armorTab).toBeVisible();

        // テーブルが表示されていること（通常タブとして描画される）
        const editorTable = page.locator('.editor-table');
        await expect(editorTable).toBeVisible();
    });

    test('既存テーブル名と重複したときバリデーションエラーが表示される', async ({ page, mockFileSystem }) => {
        void mockFileSystem;
        await getAddButton(page).click();
        await expect(getEditor(page)).toBeVisible();

        // 既存テーブル「test」と同じ名前を入力
        await getNameInput(page).fill('test');
        const firstRow = page.locator('.table-definition-column-row').first();
        await firstRow.locator('.column-name-input').fill('id');
        await firstRow.locator('.column-pk-checkbox').check();

        await getSaveButton(page).click();

        // 重複エラーが表示される
        await expect(getNameError(page)).toHaveText('同名のテーブルが既に存在します');
    });

    test('列を削除できる', async ({ page, mockFileSystem }) => {
        void mockFileSystem;
        await getAddButton(page).click();
        await expect(getEditor(page)).toBeVisible();

        // 2列追加する
        await getAddColumnButton(page).click();
        const columnRows = page.locator('.table-definition-column-row');
        await expect(columnRows).toHaveCount(2);

        // 1列目を削除する
        await columnRows.first().locator('.column-delete-button').click();
        await expect(columnRows).toHaveCount(1);
    });
});

/**
 * テーブル定義エディタにテーブル名を設定し、3列（id, name, damage）を追加する
 * ドラッグ並び替えテストの共通セットアップ
 */
async function setupThreeColumnsAsync(page: Page): Promise<void> {
    await getAddButton(page).click();
    await expect(getEditor(page)).toBeVisible();

    // テーブル名を設定する
    await getNameInput(page).fill('skill');

    // 1列目（初期行）: id (int, PK)
    const firstRow = page.locator('.table-definition-column-row').nth(0);
    await firstRow.locator('.column-name-input').fill('id');
    await firstRow.locator('.column-type-select').selectOption('int');
    await firstRow.locator('.column-pk-checkbox').check();

    // 2列目を追加: name (string)
    await getAddColumnButton(page).click();
    const secondRow = page.locator('.table-definition-column-row').nth(1);
    await secondRow.locator('.column-name-input').fill('name');
    await secondRow.locator('.column-type-select').selectOption('string');

    // 3列目を追加: damage (int)
    await getAddColumnButton(page).click();
    const thirdRow = page.locator('.table-definition-column-row').nth(2);
    await thirdRow.locator('.column-name-input').fill('damage');
    await thirdRow.locator('.column-type-select').selectOption('int');
}

/**
 * 列定義行のドラッグハンドルを掴み、別の行の上までドラッグする
 * sourceIndex の行を targetIndex の行の位置へ移動する
 */
async function dragRowAboveAsync(page: Page, sourceIndex: number, targetIndex: number): Promise<void> {
    const sourceRow = page.locator('.table-definition-column-row').nth(sourceIndex);
    const targetRow = page.locator('.table-definition-column-row').nth(targetIndex);
    const handle = sourceRow.locator('.column-drag-handle');
    const handleBox = await handle.boundingBox();
    if (handleBox === null) throw new Error('ドラッグハンドルのboundingBoxが取得できません');
    const targetBox = await targetRow.boundingBox();
    if (targetBox === null) throw new Error('ターゲット行のboundingBoxが取得できません');

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    const targetX = targetBox.x + targetBox.width / 2;
    const targetY = targetBox.y + targetBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // 5px閾値を超えるために少しだけ移動してからターゲットへ
    await page.mouse.move(startX, startY - 6);
    await page.mouse.move(targetX, targetY);
    await page.mouse.up();
}

/**
 * 列定義行の列名が期待した順序であることを検証する
 */
async function expectColumnOrderAsync(page: Page, expectedNames: ReadonlyArray<string>): Promise<void> {
    const rows = page.locator('.table-definition-column-row');
    await expect(rows).toHaveCount(expectedNames.length);
    for (let i = 0; i < expectedNames.length; i++) {
        await expect(rows.nth(i).locator('.column-name-input')).toHaveValue(expectedNames[i]);
    }
}

test.describe('テーブル定義エディタ - 列ドラッグ並び替え', () => {

    test('各列定義行にドラッグハンドルが存在する', async ({ page, mockFileSystem }) => {
        void mockFileSystem;
        await getAddButton(page).click();
        await expect(getEditor(page)).toBeVisible();

        // 列を1つ追加して計2行にする（初期行1 + 追加1）
        await getAddColumnButton(page).click();
        const columnRows = page.locator('.table-definition-column-row');
        await expect(columnRows).toHaveCount(2);

        // 各行にドラッグハンドルが存在すること
        for (let i = 0; i < 2; i++) {
            const handle = columnRows.nth(i).locator('.column-drag-handle');
            await expect(handle).toBeVisible();
            // グリップアイコン（⠿）が含まれていること
            await expect(handle).toHaveText('⠿');
        }
    });

    test('ドラッグで列の並び順を変更できる', async ({ page, mockFileSystem }) => {
        void mockFileSystem;
        await setupThreeColumnsAsync(page);
        // 初期順序: id, name, damage
        await expectColumnOrderAsync(page, ['id', 'name', 'damage']);

        // damage（index=2）を name（index=1）の上にドラッグする → id, damage, name
        await dragRowAboveAsync(page, 2, 1);
        await expectColumnOrderAsync(page, ['id', 'damage', 'name']);
    });

    test('並び替え後の保存でスキーマJSONに反映される', async ({ page, mockFileSystem }) => {
        void mockFileSystem;
        await setupThreeColumnsAsync(page);

        // damage（index=2）を name（index=1）の上にドラッグする → id, damage, name
        await dragRowAboveAsync(page, 2, 1);
        await expectColumnOrderAsync(page, ['id', 'damage', 'name']);

        // 保存する
        await getSaveButton(page).click();

        // 定義エディタタブが閉じられるのを待つ
        const defTabButton = page.locator('.tab-button', { hasText: '新しいテーブル' });
        await expect(defTabButton).toHaveCount(0);

        // スキーマJSONのheaderが並び替え後の順序であることを検証する
        const schemaJson = await readMockFileAsync(page, 'schema/skill.json');
        const schema = JSON.parse(schemaJson);
        expect(schema.header).toEqual([
            { key: 0, name: 'id', type: 'int' },
            { key: 1, name: 'damage', type: 'int' },
            { key: 2, name: 'name', type: 'string' },
        ]);

        // CSVヘッダーも並び替え後の順序であること
        const csv = await readMockFileAsync(page, 'data/skill.csv');
        expect(csv).toBe('id,damage,name');
    });

    test('Ctrl+Zで並び替えをUndoできる', async ({ page, mockFileSystem }) => {
        void mockFileSystem;
        await setupThreeColumnsAsync(page);
        // 初期順序: id, name, damage
        await expectColumnOrderAsync(page, ['id', 'name', 'damage']);

        // damage（index=2）を name（index=1）の上にドラッグする → id, damage, name
        await dragRowAboveAsync(page, 2, 1);
        await expectColumnOrderAsync(page, ['id', 'damage', 'name']);

        // Ctrl+Z で Undo する
        await page.keyboard.press('Control+z');

        // 列順が元に戻ること: id, name, damage
        await expectColumnOrderAsync(page, ['id', 'name', 'damage']);
    });
});
