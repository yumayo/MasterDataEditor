import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// ミニテーブルの逆参照ヒント表示テスト（REDテスト）
//
// 不具合の概要:
//   skillテーブルを開いた際、右ペインRelationsのミニテーブルで
//   charaテーブルのid列に逆参照ヒント（.cell-reverse-reference-hint）が表示されない。
//   charaテーブルを直接タブで開いた場合は正常に表示される。
//
// 根本原因:
//   tab.ts の createMiniEditorTable() で
//   this.reference.resolveReverseReferencesAsync(tableKey, editorTable) が呼ばれていない。
//   通常タブでは createTabState() 内で preloadReferenceTables() と
//   resolveReverseReferencesAsync() の両方が呼ばれるが、
//   ミニテーブルでは preloadReferenceTables() のみ呼ばれている。
//
// テーブル構成:
//   chara: id（PK。表示列なし）
//   chara_name: id（PK, FK→chara.id）, ja（表示列。逆参照チェーンでcharaのid列に表示される）
//   skill: id, chara_id（FK→chara.id）
//
//   skillを開いてrow0選択 → RelationsPanelにcharaのN:1ミニテーブルが表示される。
//   charaミニテーブルのid列（colIndex=0）の逆参照ヒントに
//   chara_nameのja値が表示されるべき。
// =============================================================================

/**
 * テスト用のファイルシステムを生成する
 *
 * chara: id のみ（表示列なし。逆参照チェーンにより chara_name.ja で解決）
 * chara_name: id(PK, FK→chara.id), ja（chara.idの逆参照ヒントとして表示される）
 * skill: id, chara_id(FK→chara.id)（skillを開くと右ペインにcharaミニテーブルが表示）
 */
function createFileSystem(): MockFileSystem {
    return {
        "schema/chara.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
            ],
            primary_key: ["id"],
        }),
        "data/chara.csv": [
            "id",
            "1",
            "2",
        ].join("\n"),
        "schema/chara_name.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int", reference: "chara.id" },
                { key: 1, name: "ja", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/chara_name.csv": [
            "id,ja",
            "1,勇者",
            "2,魔法使い",
        ].join("\n"),
        "schema/skill.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "chara_id", type: "int", reference: "chara.id" },
            ],
            primary_key: ["id"],
        }),
        "data/skill.csv": [
            "id,chara_id",
            "1,1",
            "2,2",
        ].join("\n"),
    };
}

/**
 * Explorerでテーブルを開き、左ペインのEditorTableを返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    // RelationsPanelにもミニEditorTableが表示されるため、左ペインのEditorTableに限定する
    const table = page.locator('.editor-left-pane .editor-table');
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
 * RelationsPanelのコンテンツが表示されるまで待機する
 */
async function waitForRelationsPanelContentAsync(page: Page): Promise<void> {
    const content = page.locator('.relations-panel-content');
    await expect(content).toBeVisible();
}

/**
 * 指定したテーブル内の指定行・列の逆参照ヒント要素を返す
 * rowIndex: 0始まり（ヘッダー行を除く）
 * colIndex: 0始まり（行ヘッダーを除く）
 */
function getReverseReferenceHint(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex);
    const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
    return cell.locator('.cell-reverse-reference-hint');
}

// =============================================================================
// REDテスト: ミニテーブルの逆参照ヒント
// =============================================================================

test.describe('ミニテーブルの逆参照ヒント表示', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');
        await enableRelationsPanelAsync(page);
    });

    test(
        'skillテーブルを開いた際、右ペインcharaミニテーブルのid列に'
        + '逆参照ヒントが表示されること',
        async ({ page }) => {
            // skillテーブルを開く
            const skillTable = await openTableAsync(page, 'skill');

            // skill row0（chara_id=1）を選択 → 右ペインにcharaのN:1ミニテーブルが表示される
            await selectRowAsync(skillTable, 0);
            await waitForRelationsPanelContentAsync(page);

            // RelationsPanelのcharaミニテーブルが表示されるまで待機
            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();

            // charaミニテーブルのid列（colIndex=0）に逆参照ヒントが表示されるべき
            // chara id=1 → chara_name.ja = "勇者" が逆参照ヒントとして表示される
            // 不具合のためこのアサーションが失敗する（REDテスト）
            const hint = getReverseReferenceHint(miniTable, 0, 0);
            await expect(hint).toBeVisible();
            await expect(hint).toHaveText('勇者');
        },
    );

    test(
        'charaテーブルを直接開いた場合はid列に逆参照ヒントが表示されること'
        + '（正常ケースの確認）',
        async ({ page }) => {
            // charaテーブルを直接開く（こちらは正常に動作することを確認する参照テスト）
            const charaTable = await openTableAsync(page, 'chara');

            // 逆参照ヒントが非同期で表示されるまで待機
            const hint = getReverseReferenceHint(charaTable, 0, 0);
            await expect(hint).toBeVisible();

            // chara id=1 → chara_name.ja = "勇者" が表示される
            await expect(hint).toHaveText('勇者');

            // chara id=2 → chara_name.ja = "魔法使い" が表示される
            const hint2 = getReverseReferenceHint(charaTable, 1, 0);
            await expect(hint2).toBeVisible();
            await expect(hint2).toHaveText('魔法使い');
        },
    );
});
