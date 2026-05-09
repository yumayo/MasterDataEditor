import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import {
    installMockApiAsync,
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
    await explorer
        .getByText(tableName, { exact: true })
        .click();
    // アクティブなタブのテーブルを取得
    // 非アクティブなタブは display:none が設定される
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
        .nth(rowIndex);
    return row
        .locator(
            '.editor-table-cell'
            + ':not(.editor-table-row-header)'
        )
        .nth(colIndex);
}

/**
 * 指定した行・列の参照ヒント要素を返す
 */
function getReferenceHint(
    table: Locator,
    rowIndex: number,
    colIndex: number,
): Locator {
    return getDataCell(table, rowIndex, colIndex)
        .locator('.cell-reference-hint');
}

/**
 * 指定した行・列の逆参照ヒント要素を返す
 */
function getReverseReferenceHint(
    table: Locator,
    rowIndex: number,
    colIndex: number,
): Locator {
    return getDataCell(table, rowIndex, colIndex)
        .locator('.cell-reverse-reference-hint');
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

    // 編集フィールドが表示されるまで待機
    const editField = page.locator(
        '.grid-textfield-active'
    );
    await expect(editField).toBeVisible();

    // 既存テキストを全選択して上書き
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(newValue);
    await page.keyboard.press('Enter');
}

// -------------------------------------------------------
// 参照ヒントがインメモリデータを使用するテスト
// -------------------------------------------------------
test.describe(
    '参照ヒントのインメモリデータ優先取得',
    () => {
        /**
         * テストデータ:
         * enemy テーブル: id, ja
         * quest テーブル: id, enemy_id(→enemy.ja)
         */
        const createFileSystem = (): MockFileSystem => ({
            "schema/enemy.json": JSON.stringify({
                header: [
                    {
                        key: 0,
                        name: "id",
                        type: "int",
                    },
                    {
                        key: 1,
                        name: "ja",
                        type: "string",
                    },
                ],
                primary_key: ["id"],
            }),
            "data/enemy.csv": [
                "id,ja",
                "1,slime",
                "2,dragon",
                "3,goblin",
            ].join("\n"),
            "schema/quest.json": JSON.stringify({
                header: [
                    {
                        key: 0,
                        name: "id",
                        type: "int",
                    },
                    {
                        key: 1,
                        name: "enemy_id",
                        type: "int",
                        reference: "enemy.ja",
                    },
                ],
                primary_key: ["id"],
            }),
            "data/quest.csv": [
                "id,enemy_id",
                "1,1",
                "2,2",
                "3,3",
            ].join("\n"),
        });

        test(
            '別タブで編集中のテーブルの値が'
            + '参照ヒントに反映されること',
            async ({ page }) => {
                await installMockApiAsync(page, createFileSystem());
                await page.goto('/');

                // enemyテーブルを開く
                await openTableAsync(page, 'enemy');

                // questテーブルを開く
                // → enemy はタブに開かれているので
                //   インメモリデータが使用される
                await openTableAsync(page, 'quest');

                // enemyタブに切り替えて編集する
                await page.locator('#tab-content')
                    .getByText('enemy', { exact: true })
                    .click();
                const enemyTable = page.locator(
                    '.tab-wrapper'
                    + ':not([style*="display: none"])'
                    + ' .editor-table'
                );
                await editCellAsync(
                    page, enemyTable,
                    0, 1, 'slime_edited'
                );

                // questタブに戻る
                // → タブ切り替え時に参照ヒントが
                //   再更新される
                await page.locator('#tab-content')
                    .getByText('quest', { exact: true })
                    .click();
                const questTable = page.locator(
                    '.tab-wrapper'
                    + ':not([style*="display: none"])'
                    + ' .editor-table'
                );

                // 参照ヒントが非同期で読み込まれるまで
                // 待機する
                const firstHint = getReferenceHint(questTable, 0, 1);
                await expect(firstHint).toBeVisible();

                // quest row0: enemy_id=1
                // → 編集後の値 "slime_edited"
                await expect(firstHint)
                    .toHaveText('slime_edited');

                // quest row1: enemy_id=2
                // → 未編集の値 "dragon"
                await expect(
                    getReferenceHint(questTable, 1, 1)
                ).toHaveText('dragon');

                // quest row2: enemy_id=3
                // → 未編集の値 "goblin"
                await expect(
                    getReferenceHint(questTable, 2, 1)
                ).toHaveText('goblin');
            },
        );

        test(
            'タブに開いていないテーブルの参照は'
            + 'CSVから正常に表示されること',
            async ({ page }) => {
                await installMockApiAsync(
                    page, createFileSystem()
                );
                await page.goto('/');

                // enemyテーブルを開かずに
                // questテーブルを直接開く
                const questTable =
                    await openTableAsync(
                        page, 'quest'
                    );

                // CSVのデータがそのまま表示される
                const firstHint =
                    getReferenceHint(questTable, 0, 1);
                await expect(firstHint).toBeVisible();

                await expect(firstHint)
                    .toHaveText('slime');
                await expect(
                    getReferenceHint(questTable, 1, 1)
                ).toHaveText('dragon');
                await expect(
                    getReferenceHint(questTable, 2, 1)
                ).toHaveText('goblin');
            },
        );
    },
);

// -------------------------------------------------------
// 逆参照ヒントがインメモリデータを使用するテスト
// -------------------------------------------------------
test.describe(
    '逆参照ヒントのインメモリデータ優先取得',
    () => {
        test(
            '別タブで編集中の子テーブルの値が'
            + '逆参照ヒントに反映されること',
            async ({ page }) => {
                // parent テーブル: id, ja
                // child テーブル:
                //   id, parent_id(→parent.id), ja
                const fs: MockFileSystem = {
                    "schema/parent.json":
                        JSON.stringify({
                            header: [
                                {
                                    key: 0,
                                    name: "id",
                                    type: "int",
                                },
                                {
                                    key: 1,
                                    name: "ja",
                                    type: "string",
                                },
                            ],
                            primary_key: ["id"],
                        }),
                    "data/parent.csv": [
                        "id,ja",
                        "1,hero",
                        "2,mage",
                    ].join("\n"),
                    "schema/child.json":
                        JSON.stringify({
                            header: [
                                {
                                    key: 0,
                                    name: "id",
                                    type: "int",
                                },
                                {
                                    key: 1,
                                    name: "parent_id",
                                    type: "int",
                                    reference: "parent.id",
                                },
                                {
                                    key: 2,
                                    name: "ja",
                                    type: "string",
                                },
                            ],
                            primary_key: ["id"],
                        }),
                    "data/child.csv": [
                        "id,parent_id,ja",
                        "1,1,skill_a",
                    ].join("\n"),
                };
                await installMockApiAsync(page, fs);
                await page.goto('/');

                // childテーブルを開く
                const childTable =
                    await openTableAsync(
                        page, 'child'
                    );

                // child id=1 の ja を編集
                // (rowIndex=0, colIndex=2 が ja列)
                await editCellAsync(
                    page,
                    childTable,
                    0, 2,
                    'skill_a_edited'
                );

                // parentテーブルを開く
                // → child はタブに開かれているので
                //   インメモリデータが使用される
                const parentTable =
                    await openTableAsync(
                        page, 'parent'
                    );

                // 逆参照ヒントが表示されるまで待機
                const hint =
                    getReverseReferenceHint(
                        parentTable, 0, 0
                    );
                await expect(hint).toBeVisible();

                // parent id=1 の逆参照ヒント
                // → child(1件) で表示テキストは
                //   "skill_a_edited"
                await expect(hint)
                    .toHaveText('skill_a_edited');

                // parent id=2 には逆参照なし
                await expect(
                    getReverseReferenceHint(
                        parentTable, 1, 0
                    )
                ).not.toBeVisible();
            },
        );
    },
);

// -------------------------------------------------------
// 未保存タブ閉じ時にキャッシュがCSVに戻るテスト
// -------------------------------------------------------
test.describe(
    '未保存タブ閉じ時のキャッシュ無効化',
    () => {
        test(
            '未保存の参照先タブを閉じると'
            + '参照ヒントがCSVに戻ること',
            async ({ page }) => {
                // enemy テーブル: id, ja
                // quest テーブル:
                //   id, enemy_id(→enemy.ja)
                const fs: MockFileSystem = {
                    "schema/enemy.json":
                        JSON.stringify({
                            header: [
                                {
                                    key: 0,
                                    name: "id",
                                    type: "int",
                                },
                                {
                                    key: 1,
                                    name: "ja",
                                    type: "string",
                                },
                            ],
                            primary_key: ["id"],
                        }),
                    "data/enemy.csv": [
                        "id,ja",
                        "1,slime",
                        "2,dragon",
                        "3,goblin",
                    ].join("\n"),
                    "schema/quest.json":
                        JSON.stringify({
                            header: [
                                {
                                    key: 0,
                                    name: "id",
                                    type: "int",
                                },
                                {
                                    key: 1,
                                    name: "enemy_id",
                                    type: "int",
                                    reference: "enemy.ja",
                                },
                            ],
                            primary_key: ["id"],
                        }),
                    "data/quest.csv": [
                        "id,enemy_id",
                        "1,1",
                        "2,2",
                        "3,3",
                    ].join("\n"),
                };
                await installMockApiAsync(
                    page, fs
                );
                await page.goto('/');

                // enemyテーブルを開く
                await openTableAsync(
                    page, 'enemy'
                );

                // questテーブルを開く
                await openTableAsync(
                    page, 'quest'
                );

                // enemyタブに切り替えて編集
                await page.locator('#tab-content')
                    .getByText('enemy', {
                        exact: true,
                    })
                    .click();
                const enemyTable = page.locator(
                    '.tab-wrapper'
                    + ':not([style*='
                    + '"display: none"])'
                    + ' .editor-table'
                );
                await editCellAsync(
                    page, enemyTable,
                    0, 1, 'slime_edited'
                );

                // questタブに切り替え
                // → 参照ヒントが編集値を反映
                await page.locator('#tab-content')
                    .getByText('quest', {
                        exact: true,
                    })
                    .click();
                const questTable = page.locator(
                    '.tab-wrapper'
                    + ':not([style*='
                    + '"display: none"])'
                    + ' .editor-table'
                );
                const hint = getReferenceHint(
                    questTable, 0, 1
                );
                await expect(hint).toBeVisible();
                await expect(hint)
                    .toHaveText('slime_edited');

                // questがアクティブな状態で
                // enemyタブの閉じるボタンをクリック
                const enemyTab = page
                    .locator('#tab-content')
                    .getByRole('listitem')
                    .filter({ hasText: 'enemy' });
                await enemyTab
                    .locator('.tab-button-close')
                    .click({ force: true });

                // dirty状態のため確認ダイアログが表示される
                // 「閉じる」を選択してタブを閉じる
                await page.locator(
                    '.close-confirm-overlay.visible'
                ).locator(
                    '.close-confirm-button-close'
                ).click();

                // 参照ヒントがCSV元データに戻る
                await expect(hint)
                    .toHaveText('slime');
                await expect(
                    getReferenceHint(
                        questTable, 1, 1
                    )
                ).toHaveText('dragon');
                await expect(
                    getReferenceHint(
                        questTable, 2, 1
                    )
                ).toHaveText('goblin');
            },
        );

        test(
            '未保存の子テーブルタブを閉じると'
            + '逆参照ヒントがCSVに戻ること',
            async ({ page }) => {
                // parent テーブル: id, ja
                // child テーブル:
                //   id, parent_id(→parent.id), ja
                const fs: MockFileSystem = {
                    "schema/parent.json":
                        JSON.stringify({
                            header: [
                                {
                                    key: 0,
                                    name: "id",
                                    type: "int",
                                },
                                {
                                    key: 1,
                                    name: "ja",
                                    type: "string",
                                },
                            ],
                            primary_key: ["id"],
                        }),
                    "data/parent.csv": [
                        "id,ja",
                        "1,hero",
                        "2,mage",
                    ].join("\n"),
                    "schema/child.json":
                        JSON.stringify({
                            header: [
                                {
                                    key: 0,
                                    name: "id",
                                    type: "int",
                                },
                                {
                                    key: 1,
                                    name: "parent_id",
                                    type: "int",
                                    reference:
                                        "parent.id",
                                },
                                {
                                    key: 2,
                                    name: "ja",
                                    type: "string",
                                },
                            ],
                            primary_key: ["id"],
                        }),
                    "data/child.csv": [
                        "id,parent_id,ja",
                        "1,1,skill_a",
                    ].join("\n"),
                };
                await installMockApiAsync(
                    page, fs
                );
                await page.goto('/');

                // childテーブルを開いて編集
                const childTable =
                    await openTableAsync(
                        page, 'child'
                    );
                await editCellAsync(
                    page, childTable,
                    0, 2, 'skill_a_edited'
                );

                // parentテーブルを開く
                // → 逆参照ヒントが編集値を反映
                const parentTable =
                    await openTableAsync(
                        page, 'parent'
                    );
                const hint =
                    getReverseReferenceHint(
                        parentTable, 0, 0
                    );
                await expect(hint).toBeVisible();
                await expect(hint)
                    .toHaveText('skill_a_edited');

                // parentがアクティブな状態で
                // childタブの閉じるボタンをクリック
                const childTab = page
                    .locator('#tab-content')
                    .getByRole('listitem')
                    .filter({ hasText: 'child' });
                await childTab
                    .locator('.tab-button-close')
                    .click({ force: true });

                // dirty状態のため確認ダイアログが表示される
                // 「閉じる」を選択してタブを閉じる
                await page.locator(
                    '.close-confirm-overlay.visible'
                ).locator(
                    '.close-confirm-button-close'
                ).click();

                // 逆参照ヒントがCSV元データに戻る
                await expect(hint)
                    .toHaveText('skill_a');

                // parent id=2 には逆参照なし
                await expect(
                    getReverseReferenceHint(
                        parentTable, 1, 0
                    )
                ).not.toBeVisible();
            },
        );
    },
);
