import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// 主キーバリデーション機能のテスト
//
// 機能概要:
//   主キーが重複したセルには `cell-pk-duplicate` CSSクラスを付与して
//   赤波線を表示し、ユーザーにPK重複を視覚的に通知する。
//
// 重複判定の範囲:
//   表示されている行だけでなく InMemoryTableStore の全行データで判定する。
//   ミニテーブルでフィルタされていない行も含めて重複チェックを行う。
//
// テストケース一覧:
//   1. PK値が重複した場合、両方のPKセルに cell-pk-duplicate クラスが付与される
//   2. PK値の重複が解消された場合、cell-pk-duplicate クラスが除去される
//   3. 空のPK値は重複チェックの対象外（空値が複数あってもクラスが付かない）
//   4. テーブル初期表示時に既存の重複PKが検出される（初期表示から赤波線表示）
//   5. ストア全体で重複判定される（ミニテーブルで表示されていない行との重複も検出）
// =============================================================================

// =============================================================================
// フィクスチャ生成ヘルパー
// =============================================================================

/**
 * 基本的なアイテムテーブルのファイルシステムを生成する
 * id列をPKとし、初期データは id=1,2,3 の一意な行
 */
function createItemFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/item.csv": [
            "id,name",
            "1,sword",
            "2,shield",
            "3,potion",
        ].join("\n"),
    };
}

/**
 * 初期状態からPK重複が存在するファイルシステムを生成する
 * テストケース4（初期表示で重複検出）用
 */
function createInitialDuplicateFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        // id=1 が2行存在する（初期データに重複あり）
        "data/item.csv": [
            "id,name",
            "1,sword",
            "1,shield",
            "3,potion",
        ].join("\n"),
    };
}

/**
 * ミニテーブルでの「ストア全体での重複判定」テスト用ファイルシステムを生成する
 *
 * enemy テーブルの1:Nリレーションとして skill テーブルを持つ。
 * enemy_id=1 の行: id=10 (slash)
 * enemy_id=2 の行: id=20 (thunder)
 *
 * enemy_id=1 の行を選択してミニテーブルを表示すると、id=10 の行のみが見える。
 * ミニテーブルで新しい行に id=20 を入力した場合、
 * ミニテーブル上には id=20 の行は表示されていないが、
 * ストア全体（enemy_id=2 の行）と重複しているため cell-pk-duplicate が付与される必要がある。
 */
function createMiniTableStoreWideDuplicateFileSystem(): MockFileSystem {
    return {
        "schema/enemy.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/enemy.csv": [
            "id,ja",
            "1,スライム",
            "2,ドラゴン",
        ].join("\n"),
        "schema/skill.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "enemy_id", type: "int", reference: "enemy.id" },
                { key: 2, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        // enemy_id=1 の行: id=10、enemy_id=2 の行: id=20
        // ミニテーブル（enemy_id=1フィルタ）には id=10 のみ表示される
        "data/skill.csv": [
            "id,enemy_id,name",
            "10,1,slash",
            "20,2,thunder",
        ].join("\n"),
    };
}

// =============================================================================
// テストヘルパー関数
// =============================================================================

/**
 * エクスプローラーからテーブルを開き、タブ名で絞り込んだ EditorTable の Locator を返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行ヘッダーをクリックして行を選択する
 * rowIndex: 0始まり（ヘッダー行を除く）
 */
async function selectRowAsync(table: Locator, rowIndex: number): Promise<void> {
    const header = table.locator('.editor-table-row-header').nth(rowIndex);
    await header.click();
}

/**
 * 指定行・列のデータセルをダブルクリックして新しい値を入力しEnterで確定する
 * rowIndex: 0始まり（ヘッダー行を除く）、colIndex: 0始まり（行ヘッダーを除く）
 */
async function editCellAsync(
    table: Locator,
    page: Page,
    rowIndex: number,
    colIndex: number,
    newValue: string,
): Promise<void> {
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
    await expect(cell).toBeVisible();
    await cell.dblclick();

    const editField = page.locator('.grid-textfield-active');
    await expect(editField).toBeVisible();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(newValue);
    await page.keyboard.press('Enter');
}

/**
 * 指定行のPKセル（colIndex=0）を返す
 * rowIndex: 0始まり（ヘッダー行を除く）
 */
function getPkCell(table: Locator, rowIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex + 1);
    // PKセルは最初のデータセル（行ヘッダーを除く）
    return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
}

/**
 * RelationsPanelの指定テーブルセクションのミニ EditorTable を返す
 */
async function getMiniTableAsync(page: Page, childTableName: string): Promise<Locator> {
    const section = page.locator('.relations-table-section').filter({
        has: page.locator('.relations-table-title').getByText(childTableName, { exact: true }),
    });
    await expect(section).toBeVisible();
    const miniTable = section.locator('.editor-table');
    await expect(miniTable).toBeVisible();
    return miniTable;
}

/**
 * ミニテーブルの指定行・列のデータセルをダブルクリックして新しい値を入力しEnterで確定する
 * rowIndex: 0始まり（ヘッダー行を除く）、colIndex: 0始まり（行ヘッダーを除く）
 */
async function editMiniTableCellAsync(
    miniTable: Locator,
    page: Page,
    rowIndex: number,
    colIndex: number,
    newValue: string,
): Promise<void> {
    const visibleDataCells = miniTable.locator('.editor-table-row').nth(rowIndex + 1).locator(
        '.editor-table-cell:not(.editor-table-row-header):not([style*="display: none"])',
    );
    const cell = visibleDataCells.nth(colIndex);
    await expect(cell).toBeVisible();
    await cell.dblclick();

    const editField = page.locator('.relations-panel .grid-textfield-active, .relations-panel input').first();
    await expect(editField).toBeVisible();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(newValue);
    await page.keyboard.press('Enter');
}

// =============================================================================
// テストケース1: PK値が重複した場合、両方のPKセルに cell-pk-duplicate が付与される
// =============================================================================

test.describe('テストケース1: PK値が重複した場合、両方のPKセルに cell-pk-duplicate が付与される', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createItemFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        '2行目のPKセルを1行目と同じ値に変更すると、両方のPKセルに cell-pk-duplicate が付与される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            // 初期状態: id=1,2,3 で重複なし。PKセルに cell-pk-duplicate クラスが付いていないことを確認
            const firstPkCell = getPkCell(table, 0);
            const secondPkCell = getPkCell(table, 1);
            await expect(firstPkCell).not.toHaveClass(/cell-pk-duplicate/);
            await expect(secondPkCell).not.toHaveClass(/cell-pk-duplicate/);

            // 2行目のid（=2）を1行目と同じ値（=1）に変更して重複を発生させる
            await editCellAsync(table, page, 1, 0, '1');

            // 両方のPKセルに cell-pk-duplicate クラスが付与されることを確認
            // 実装前はこのアサーションが失敗してREDになる
            await expect(firstPkCell).toHaveClass(/cell-pk-duplicate/);
            await expect(secondPkCell).toHaveClass(/cell-pk-duplicate/);
        },
    );
});

// =============================================================================
// テストケース2: PK値の重複が解消された場合、cell-pk-duplicate クラスが除去される
// =============================================================================

test.describe('テストケース2: PK値の重複が解消された場合、cell-pk-duplicate クラスが除去される', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createItemFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'PK重複を解消する値に変更すると cell-pk-duplicate クラスが除去される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');
            const firstPkCell = getPkCell(table, 0);
            const secondPkCell = getPkCell(table, 1);

            // まず重複を発生させる: 2行目のidを1行目と同じ "1" に変更する
            await editCellAsync(table, page, 1, 0, '1');

            // 重複状態を確認（実装後に初めて通る）
            await expect(firstPkCell).toHaveClass(/cell-pk-duplicate/);
            await expect(secondPkCell).toHaveClass(/cell-pk-duplicate/);

            // 重複を解消する: 2行目のidをユニークな値 "99" に変更する
            await editCellAsync(table, page, 1, 0, '99');

            // cell-pk-duplicate クラスが両方のセルから除去されることを確認
            // 実装前はこのアサーションが失敗してREDになる
            await expect(firstPkCell).not.toHaveClass(/cell-pk-duplicate/);
            await expect(secondPkCell).not.toHaveClass(/cell-pk-duplicate/);
        },
    );
});

// =============================================================================
// テストケース3: 空のPK値は重複チェックの対象外
// =============================================================================

test.describe('テストケース3: 空のPK値は重複チェックの対象外', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createItemFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        '空のPKセルが複数あっても cell-pk-duplicate が付与されない',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            // 1行目のid（=1）を空文字に変更する
            await editCellAsync(table, page, 0, 0, '');

            // 2行目のid（=2）を空文字に変更する
            await editCellAsync(table, page, 1, 0, '');

            // 空のPKセルには cell-pk-duplicate が付与されないことを確認
            // 空値は「未入力」であり重複判定の対象外とする
            // 実装前はこのアサーションが失敗してREDになる
            const firstPkCell = getPkCell(table, 0);
            const secondPkCell = getPkCell(table, 1);
            await expect(firstPkCell).not.toHaveClass(/cell-pk-duplicate/);
            await expect(secondPkCell).not.toHaveClass(/cell-pk-duplicate/);
        },
    );
});

// =============================================================================
// テストケース4: テーブル初期表示時に既存の重複PKが検出される
// =============================================================================

test.describe('テストケース4: テーブル初期表示時に既存の重複PKが検出される', () => {
    test.beforeEach(async ({ page }) => {
        // 初期データにPK重複がある状態でテーブルを開く
        const fs = createInitialDuplicateFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'テーブルを開いた時点で既存のPK重複行に cell-pk-duplicate が付与される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            // 初期データ: id=1 が2行ある（1行目と2行目）
            const firstPkCell = getPkCell(table, 0);
            const secondPkCell = getPkCell(table, 1);
            const thirdPkCell = getPkCell(table, 2);

            // 初期表示の時点で id=1 の両行に cell-pk-duplicate が付与されることを確認
            // テーブルオープン直後にバリデーションが実行される
            // 実装前はこのアサーションが失敗してREDになる
            await expect(firstPkCell).toHaveClass(/cell-pk-duplicate/);
            await expect(secondPkCell).toHaveClass(/cell-pk-duplicate/);

            // id=3 の行（重複していない）には cell-pk-duplicate が付与されないことを確認
            await expect(thirdPkCell).not.toHaveClass(/cell-pk-duplicate/);
        },
    );
});

// =============================================================================
// テストケース5: ストア全体で重複判定される（ミニテーブルで表示されていない行との重複も検出）
// =============================================================================

test.describe('テストケース5: ストア全体で重複判定される（表示範囲外のデータとの重複も検出）', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createMiniTableStoreWideDuplicateFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await enableRelationsPanelAsync(page);
    });

    test(
        'ミニテーブルで表示されていない行（別enemy_idの行）と同じPK値を入力すると cell-pk-duplicate が付与される',
        async ({ page }) => {
            // enemy テーブルを開いて id=1（スライム）の行を選択する
            const enemyTable = await openTableAsync(page, 'enemy');
            await selectRowAsync(enemyTable, 0);

            // RelationsPanelに skill の1:Nミニテーブルが表示される
            // enemy_id=1でフィルタ済みのため id=10（slash）の行のみ表示される
            // id=20（thunder, enemy_id=2）の行はミニテーブルに表示されない
            const miniTable = await getMiniTableAsync(page, 'skill');

            // ミニテーブルの表示行確認（ヘッダー1行 + データ1行 + バッファ行(1) = 3行）
            await expect(miniTable.locator('.editor-table-row')).toHaveCount(3);

            // ミニテーブルの 1行目（id=10, slash）のPKセル（colIndex=0）に
            // ストア上には存在するが表示されていない id=20 を入力する
            // ミニテーブルには id=20 の行は表示されていないが、
            // ストア全体に id=20 が存在するため重複として検出されるべき
            await editMiniTableCellAsync(miniTable, page, 0, 0, '20');

            // PKセルに cell-pk-duplicate が付与されることを確認
            // ミニテーブルのPKセル（colIndex=0）は id 列
            const miniPkCell = miniTable.locator('.editor-table-row').nth(1).locator(
                '.editor-table-cell:not(.editor-table-row-header):not([style*="display: none"])',
            ).nth(0);

            // ストア全体で重複判定するため、表示外の行（id=20）との重複も検出される
            // 実装前はこのアサーションが失敗してREDになる
            await expect(miniPkCell).toHaveClass(/cell-pk-duplicate/);
        },
    );
});
