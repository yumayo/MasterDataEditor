import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import {
    installMockApiAsync,
    readMockFileAsync,
    MockFileSystem,
} from './fixtures/mock-api';

/**
 * Explorerでテーブルを開き、
 * アクティブなタブのEditorTableを返す
 */
async function openTableAsync(
    page: Page,
    tableName: string,
): Promise<Locator> {
    const explorer = page.locator('#explorer');
    // ビューファイルはVIEWSパネルに表示されるため、パネルを切り替える
    if (tableName.startsWith('view_')) {
        await explorer.locator('[data-panel="views"]').click();
    }
    await explorer
        .getByText(tableName, { exact: true })
        .click();
    const table = page.locator(
        '.tab-wrapper'
        + ':not([style*="display: none"])'
        + ' .editor-table'
    );
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行・列のデータセルを返す
 * rowIndex: 0始まり（ヘッダー行を除く）
 * colIndex: 0始まり（行ヘッダーを除く）
 */
function getDataCell(
    table: Locator,
    rowIndex: number,
    colIndex: number,
): Locator {
    const row = table
        .locator('.editor-table-row')
        .nth(rowIndex + 1);
    return row
        .locator(
            '.editor-table-cell'
            + ':not(.editor-table-row-header)'
        )
        .nth(colIndex);
}

/**
 * セルの値を編集する
 * ダブルクリックで編集モードに入り、
 * 全選択→新しい値を入力→Enterで確定
 */
async function editCellAsync(
    page: Page,
    table: Locator,
    rowIndex: number,
    colIndex: number,
    newValue: string,
): Promise<void> {
    const cell = getDataCell(
        table, rowIndex, colIndex
    );
    await cell.dblclick();

    const editField = page.locator(
        '.grid-textfield-active'
    );
    await expect(editField).toBeVisible();

    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(newValue);
    await page.keyboard.press('Enter');
}

/**
 * セルをクリックして選択状態にする
 */
async function selectCellAsync(
    page: Page,
    table: Locator,
    rowIndex: number,
    colIndex: number,
): Promise<void> {
    const cell = getDataCell(
        table, rowIndex, colIndex
    );
    await cell.click();
}

/**
 * テストデータ:
 * chara: id=1(skill_id=1), id=2(skill_id=1), id=3(skill_id=2)
 * skill: id=1(value=3), id=2(value=5), id=3(value=10)
 * view_chara: charaベース、skillをskill_idでJOIN
 *
 * ビュー表示イメージ（結合キー列skill.idは非表示）:
 * | chara.id | chara.skill_id | skill.value |
 * |    1     |       1        |      3      |
 * |    2     |       1        |      3      |
 * |    3     |       2        |      5      |
 */
function createFileSystem(): MockFileSystem {
    return {
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "skill_id", type: "int", reference: "skill.id" },
            ],
            primary_key: "id",
        }),
        "data/chara.csv": [
            "id,skill_id",
            "1,1",
            "2,1",
            "3,2",
        ].join("\n"),
        "schema/skill.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "value", type: "int" },
            ],
            primary_key: "id",
        }),
        "data/skill.csv": [
            "id,value",
            "1,3",
            "2,5",
            "3,10",
        ].join("\n"),
        "view/view_chara.json": JSON.stringify({
            name: "view_chara",
            baseTable: "chara",
            joins: [
                {
                    sourceColumn: "skill_id",
                    targetTable: "skill",
                    targetColumn: "id",
                    insertAfterViewColumnIndex: 1,
                },
            ],
        }),
    };
}

// -------------------------------------------------------
// JOINビュー保存処理のテスト
// -------------------------------------------------------
test.describe(
    'JOINビューの編集と保存',
    () => {
        test(
            '結合列編集時に同一JOINキー行が'
            + '連動更新されること',
            async ({ page }) => {
                await installMockApiAsync(
                    page, createFileSystem()
                );
                await page.goto('/');

                // view_charaを開く
                const table = await openTableAsync(
                    page, 'view_chara'
                );

                // ビュー列: chara.id(0), chara.skill_id(1), skill.value(2)
                // row0: chara.id=1のskill.valueを「4」に変更
                await editCellAsync(
                    page, table, 0, 2, '4'
                );

                // row0のskill.valueが4になっていること
                const row0Value = getDataCell(table, 0, 2);
                await expect(row0Value).toHaveText('4');

                // row1のskill.valueも4に連動更新されること
                // （chara.id=2もskill_id=1を参照）
                const row1Value = getDataCell(table, 1, 2);
                await expect(row1Value).toHaveText('4');

                // row2のskill.valueは変わらないこと
                // （chara.id=3はskill_id=2を参照）
                const row2Value = getDataCell(table, 2, 2);
                await expect(row2Value).toHaveText('5');
            },
        );

        test(
            '連動更新のUndo/Redoが'
            + '正しく動くこと',
            async ({ page }) => {
                await installMockApiAsync(
                    page, createFileSystem()
                );
                await page.goto('/');

                const table = await openTableAsync(
                    page, 'view_chara'
                );

                // row0のskill.valueを「4」に変更
                await editCellAsync(page, table, 0, 2, '4');

                // 連動更新されていることを確認
                await expect(getDataCell(table, 0, 2)).toHaveText('4');
                await expect(getDataCell(table, 1, 2)).toHaveText('4');

                // Undo: 両行が元の値「3」に戻ること
                await page.keyboard.press('Control+z');
                await expect(getDataCell(table, 0, 2)).toHaveText('3');
                await expect(getDataCell(table, 1, 2)).toHaveText('3');

                // Redo: 両行が「4」に戻ること
                await page.keyboard.press('Control+y');
                await expect(getDataCell(table, 0, 2)).toHaveText('4');
                await expect(getDataCell(table, 1, 2)).toHaveText('4');
            },
        );

        test(
            'ビューに表示されないスキル行が'
            + '保存後も残ること',
            async ({ page }) => {
                await installMockApiAsync(
                    page, createFileSystem()
                );
                await page.goto('/');

                const table = await openTableAsync(
                    page, 'view_chara'
                );

                // row0のskill.valueを「4」に変更
                await editCellAsync(page, table, 0, 2, '4');

                // Ctrl+Sで保存
                await page.keyboard.press('Control+s');

                // 保存完了を待つ
                await page.waitForTimeout(500);

                // skill.csvの内容を検証
                const skillCsv = await readMockFileAsync(page, 'data/skill.csv');

                // skill.id=3（ビュー未表示）が残っていること
                expect(skillCsv).toContain('3,10');
            },
        );

        test(
            '編集したスキル値が正しく'
            + '保存されること',
            async ({ page }) => {
                await installMockApiAsync(
                    page, createFileSystem()
                );
                await page.goto('/');

                const table = await openTableAsync(
                    page, 'view_chara'
                );

                // row0のskill.valueを「4」に変更
                await editCellAsync(page, table, 0, 2, '4');

                // Ctrl+Sで保存
                await page.keyboard.press('Control+s');

                await page.waitForTimeout(500);

                const skillCsv = await readMockFileAsync(page, 'data/skill.csv');

                // skill.id=1のvalue=4
                expect(skillCsv).toContain('1,4');
                // skill.id=2のvalue=5（未変更）
                expect(skillCsv).toContain('2,5');
                // skill.id=3のvalue=10（ビュー未表示）
                expect(skillCsv).toContain('3,10');
            },
        );

        test(
            '同一IDの重複行が排除されて'
            + '保存されること',
            async ({ page }) => {
                await installMockApiAsync(
                    page, createFileSystem()
                );
                await page.goto('/');

                const table = await openTableAsync(
                    page, 'view_chara'
                );

                // 何も編集せずに保存
                await page.keyboard.press(
                    'Control+s'
                );

                await page.waitForTimeout(500);

                const skillCsv = await readMockFileAsync(page, 'data/skill.csv');

                // skill.id=1が1行だけであること
                // （ビューではchara.id=1とchara.id=2で
                //   2行表示されるが、保存時に重複排除）
                const lines = skillCsv
                    .split('\n')
                    .filter(
                        (l: string) => l.startsWith('1,')
                    );
                expect(lines.length).toBe(1);
            },
        );

        test(
            'ビューファイル読み込み時にJOIN列ヘッダーの背景色が適用されること',
            async ({ page }) => {
                await installMockApiAsync(
                    page, createFileSystem()
                );
                await page.goto('/');

                const table = await openTableAsync(
                    page, 'view_chara'
                );

                // ヘッダー行から列ヘッダーセルを取得
                const headerRow = table.locator(
                    '.editor-table-column-header-row'
                );
                const columnHeaders = headerRow.locator(
                    '.editor-table-column-header'
                );

                // JOIN列（skill.value, index=2）にCSSクラスが付与されていること
                await expect(columnHeaders.nth(2)).toHaveClass(
                    /editor-table-joined-column-header/
                );

                // ベーステーブル列にはCSSクラスが付与されていないこと
                await expect(columnHeaders.nth(0)).not.toHaveClass(
                    /editor-table-joined-column-header/
                );
                await expect(columnHeaders.nth(1)).not.toHaveClass(
                    /editor-table-joined-column-header/
                );
            },
        );

        test(
            '結合列へのペーストが拒否され'
            + '震えアニメーションが表示されること',
            async ({ page }) => {
                await installMockApiAsync(
                    page, createFileSystem()
                );
                await page.goto('/');

                const table = await openTableAsync(
                    page, 'view_chara'
                );

                // 非結合列（chara.id）をコピー
                await selectCellAsync(page, table, 0, 0);
                await page.keyboard.press('Control+c');

                // 結合列（skill.value）を選択してペースト
                await selectCellAsync(page, table, 0, 2);
                await page.keyboard.press('Control+v');

                // 値が変わっていないこと
                await expect(getDataCell(table, 0, 2)).toHaveText('3');

                // 震えアニメーションが表示されること
                const selection = page.locator('.selection');
                await expect(selection).toHaveClass(/selection-rejected/);
            },
        );

        test(
            'FK列変更時にJOIN列が'
            + '新しい参照先の値に同期されること',
            async ({ page }) => {
                await installMockApiAsync(
                    page, createFileSystem()
                );
                await page.goto('/');

                const table = await openTableAsync(
                    page, 'view_chara'
                );

                // 初期状態: row0 skill_id=1, skill.value=3
                // row0のskill_idを「3」に変更
                await editCellAsync(page, table, 0, 1, '3');

                // row0のskill.valueを「4」に変更（JOIN列を直接編集）
                await editCellAsync(page, table, 0, 2, '4');

                // row0のskill_idを「1」に戻す
                await editCellAsync(page, table, 0, 1, '1');

                // row0のskill.valueがskill_id=1の値「3」に同期されること
                // （row1がskill_id=1でskill.value=3を持つため、そこからコピー）
                await expect(getDataCell(table, 0, 2)).toHaveText('3');

                // row1のskill.valueは「3」のまま変わらないこと
                await expect(getDataCell(table, 1, 2)).toHaveText('3');
            },
        );

        test(
            'FK列変更のUndo/Redoで'
            + 'JOIN列も正しく復元されること',
            async ({ page }) => {
                await installMockApiAsync(
                    page, createFileSystem()
                );
                await page.goto('/');

                const table = await openTableAsync(
                    page, 'view_chara'
                );

                // 初期状態: row0 skill_id=1, skill.value=3
                await expect(getDataCell(table, 0, 1)).toHaveText('1');
                await expect(getDataCell(table, 0, 2)).toHaveText('3');

                // row0のskill_idを「3」に変更
                await editCellAsync(page, table, 0, 1, '3');

                // skill_id=3に対応するskill.value=10に同期されること
                await expect(getDataCell(table, 0, 2)).toHaveText('10');

                // Undo: skill_id=1に戻り、skill.value=3に戻ること
                await page.keyboard.press('Control+z');
                await expect(getDataCell(table, 0, 1)).toHaveText('1');
                await expect(getDataCell(table, 0, 2)).toHaveText('3');

                // Redo: skill_id=3に戻り、skill.value=10に戻ること
                await page.keyboard.press('Control+y');
                await expect(getDataCell(table, 0, 1)).toHaveText('3');
                await expect(getDataCell(table, 0, 2)).toHaveText('10');
            },
        );
    },
);
