import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// バグ: N:1ミニテーブルのヘッダーにFK名とFK値のコンテキストヒントが表示されない問題
//
// 現象:
//   右ペインの RelationsPanel で、1:N バッジのミニテーブルには
//   `[fk_column_name=value]` 形式のコンテキストヒント（.relations-table-context）が
//   表示されるが、N:1バッジのミニテーブルには表示されない。
//
// 根本原因:
//   1. relations-panel.ts のシンプル参照のN:1エントリ生成部（486-495行付近）で
//      `fkColumnName: ''`, `fkValue: ''` と空文字列で固定されている。
//      `col.name` と `fkValue`（474行目で取得済み）を入れるべき。
//   2. 動的参照のN:1エントリ生成部（437-446行付近）でも同様に空文字列。
//   3. ペインスタック版のN:1エントリ生成部（1014-1023行付近）でも同様に空文字列。
//   4. 描画条件（739行付近）が `entry.relationType === '1:N'` に限定されているため、
//      N:1エントリが正しいfkColumnName/fkValueを持っていても描画されない。
//
// 期待動作:
//   N:1ミニテーブルのセクションヘッダーにも `.relations-table-context` 要素が表示され、
//   `fk_column_name=fk_value` 形式のテキストが含まれること。
//
// テーブル構成:
//   quest: id, name（クエストマスター）
//   quest_reward: id, quest_id（→ quest.id 参照）, reward_name
//
//   quest_reward id=1: quest_id=1 → quest.id=1（はじまりのクエスト）
//   quest_reward id=2: quest_id=1 → quest.id=1（はじまりのクエスト）
//
//   quest_reward を開くと N:1 として quest ミニテーブルが表示される。
//   そのヘッダーに `quest_id=1` という .relations-table-context 要素が表示されるべき。
// =============================================================================

/**
 * N:1コンテキストヒントテスト用のファイルシステムを生成する
 *
 * quest_reward テーブルが quest.id を参照する quest_id 列を持つ（シンプル参照）。
 * quest_reward テーブルを開いて行を選択すると N:1 として quest ミニテーブルが表示される。
 */
function createN1ContextHintTestFileSystem(): MockFileSystem {
    return {
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/quest.csv": [
            "id,name",
            "1,はじまりのクエスト",
            "2,ふたつめのクエスト",
        ].join("\n"),
        "schema/quest_reward.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                // quest.id を FK として参照する（シンプル参照）
                { key: 1, name: "quest_id", type: "int", reference: "quest.id" },
                { key: 2, name: "reward_name", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/quest_reward.csv": [
            "id,quest_id,reward_name",
            "1,1,ゴールド",
            "2,1,経験値",
            "3,2,レアアイテム",
        ].join("\n"),
    };
}

/**
 * エクスプローラーからテーブルを開き、左ペインのアクティブな EditorTable の Locator を返す。
 * タブ名でスコープを限定することで strict mode violation を防ぐ。
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const activeTab = page.locator('.tab-button-active');
    await expect(activeTab).toHaveText(tableName);
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
 * RelationsPanel 内の指定テーブル名のセクションを取得する
 */
function getRelationSection(page: Page, tableName: string): Locator {
    return page.locator('.relations-table-section').filter({
        has: page.locator('.relations-table-title').getByText(tableName, { exact: true }),
    });
}

// =============================================================================
// テストスイート: N:1ミニテーブルにFK名とFK値のコンテキストヒントが表示されること
// =============================================================================

test.describe('バグ: N:1ミニテーブルのヘッダーにFK名とFK値のコンテキストヒントが表示されること', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createN1ContextHintTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'quest_reward の行を選択したとき、N:1 の quest セクションヘッダーに .relations-table-context 要素が存在すること',
        async ({ page }) => {
            // quest_reward テーブルを開いて1行目（id=1, quest_id=1）を選択する
            const mainTable = await openTableAsync(page, 'quest_reward');
            await selectRowAsync(mainTable, 0);

            // quest テーブルセクション（N:1）が表示されるまで待機する
            const questSection = getRelationSection(page, 'quest');
            await expect(questSection).toBeVisible();

            // N:1 タグが表示されていることを確認する
            await expect(questSection.locator('.relations-tag--n1')).toBeVisible();

            // バグ修正前: `fkColumnName: ''`, `fkValue: ''` が空文字列で固定されているため
            //   .relations-table-context 要素が生成されない（描画条件の relationType === '1:N' にも該当しない）
            //   → このアサーションが失敗して RED になる
            // バグ修正後: `fkColumnName: col.name`（"quest_id"）, `fkValue`（"1"）が正しく設定され、
            //   描画条件も `entry.fkColumnName !== ''` のみになるため GREEN になる
            const contextEl = questSection.locator('.relations-table-context');
            await expect(contextEl).toBeVisible();
        },
    );

    test(
        'quest_reward の1行目（quest_id=1）を選択したとき、コンテキストヒントに "quest_id=1" が含まれること',
        async ({ page }) => {
            // quest_reward テーブルを開いて1行目（id=1, quest_id=1）を選択する
            const mainTable = await openTableAsync(page, 'quest_reward');
            await selectRowAsync(mainTable, 0);

            // quest テーブルセクション（N:1）が表示されるまで待機する
            const questSection = getRelationSection(page, 'quest');
            await expect(questSection).toBeVisible();

            // コンテキスト要素のテキストが "quest_id=1" であることを確認する
            // バグ修正前: 要素自体が存在しないか、空文字列になっているため失敗する（RED）
            // バグ修正後: "quest_id=1" が表示されるため GREEN になる
            const contextEl = questSection.locator('.relations-table-context');
            await expect(contextEl).toHaveText('quest_id=1');
        },
    );

    test(
        'quest_reward の3行目（quest_id=2）を選択したとき、コンテキストヒントが "quest_id=2" に更新されること',
        async ({ page }) => {
            // quest_reward テーブルを開いて3行目（id=3, quest_id=2）を選択する
            const mainTable = await openTableAsync(page, 'quest_reward');
            await selectRowAsync(mainTable, 2);

            // quest テーブルセクション（N:1）が表示されるまで待機する
            const questSection = getRelationSection(page, 'quest');
            await expect(questSection).toBeVisible();

            // コンテキストが行の選択に応じて更新されることを確認する
            // バグ修正前: 要素自体が存在しないため失敗する（RED）
            // バグ修正後: 行が変わるとコンテキストも "quest_id=2" に更新されるため GREEN になる
            const contextEl = questSection.locator('.relations-table-context');
            await expect(contextEl).toHaveText('quest_id=2');
        },
    );
});
