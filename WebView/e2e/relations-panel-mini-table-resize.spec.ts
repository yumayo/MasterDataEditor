import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// バグ5: ミニEditorTableで列幅リサイズが機能しない問題
//
// 根本原因:
//   Tab.createMiniEditorTable() で AreaResizer を生成しているが activate() を呼んでいない。
//   そのため mousemove / mouseup のグローバルリスナーが未登録のままとなり、
//   .column-resize-handle の mousedown は発火しても ドラッグ操作が完結しない。
//   mouseup 時に setColumnWidth() が呼ばれないため列幅が変化しない。
//
// 期待動作:
//   createMiniEditorTable() の末尾で areaResizer.activate() を呼ぶ。
//   RelationsPanel.destroyMiniEditorTables() のクリーンアップ時に areaResizer.deactivate()
//   も対で呼ぶ必要がある。
// =============================================================================

/**
 * テスト用ファイルシステム
 *
 * テーブル構成:
 *   enemy: id, ja（敵名テーブル）
 *   quest: id, name, enemy_id（クエスト。enemy.id を FK として参照）
 *
 * quest を開いて行を選択すると RelationsPanel に enemy のミニEditorTable が表示される。
 * ミニEditorTable の列ヘッダーには .column-resize-handle が存在し、
 * ドラッグ操作で列幅が変化することを検証する。
 */
function createMiniTableResizeFileSystem(): MockFileSystem {
    return {
        "schema/enemy.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "ja", type: "string" },
            ],
            primary_key: "id",
        }),
        "data/enemy.csv": [
            "id,ja",
            "1,スライム",
            "2,ドラゴン",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                // enemy.id を FK として参照する（RelationsPanel に N:1 として enemy が表示される）
                { key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
            ],
            primary_key: "id",
        }),
        "data/quest.csv": [
            "id,name,enemy_id",
            "1,first_quest,1",
            "2,second_quest,2",
        ].join("\n"),
    };
}

/**
 * 左ペインのエディターテーブルが表示されるまで待機し、Locator を返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
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
 * リレーションパネルのコンテンツが表示されるまで待機する
 */
async function waitForRelationsPanelContentAsync(page: Page): Promise<void> {
    await expect(page.locator('.relations-panel-content')).toBeVisible();
}

// =============================================================================
// テスト本体
// =============================================================================

test.describe('バグ5: ミニEditorTableの列幅リサイズが機能すること', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createMiniTableResizeFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'RelationsPanelのミニEditorTableに .column-resize-handle が存在すること',
        async ({ page }) => {
            // quest テーブルを開いて1行目を選択し、ミニEditorTable（enemy）を表示させる
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();

            // ミニEditorTable の列ヘッダー行にリサイズハンドルが存在することを確認する
            const resizeHandle = miniTable.locator('.column-resize-handle').first();
            await expect(resizeHandle).toBeAttached();
        },
    );

    test(
        'RelationsPanelのミニEditorTableの列ヘッダーをドラッグすると列幅が変化すること',
        async ({ page }) => {
            // quest テーブルを開いて1行目（first_quest, enemy_id=1）を選択する
            // → RelationsPanel に enemy テーブルのミニEditorTable が N:1 として表示される
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();

            // ミニEditorTable の最初の visible な列ヘッダーセルを取得する
            // N:1 では hideColumnsByName() により id 列（col=0）が display:none になるため
            // ":not([style*='display: none'])" で visible なヘッダーに絞る
            const visibleColumnHeader = miniTable.locator(
                '.editor-table-column-header:not([style*="display: none"])'
            ).first();
            await expect(visibleColumnHeader).toBeVisible();

            // リサイズハンドルを取得する（列ヘッダーセル内の .column-resize-handle）
            const resizeHandle = visibleColumnHeader.locator('.column-resize-handle').first();
            await expect(resizeHandle).toBeAttached();

            // ドラッグ前の列幅を取得する（inline style の width）
            const widthBefore = await visibleColumnHeader.evaluate(
                (el: Element) => (el as HTMLElement).style.width
            );

            // リサイズハンドルの位置を取得してドラッグ操作を実行する
            // mousedown → mousemove → mouseup の順に発火し、列幅変更を引き起こす
            const handleBox = await resizeHandle.boundingBox();
            if (!handleBox) throw new Error('リサイズハンドルの boundingBox が取得できません');

            const startX = handleBox.x + handleBox.width / 2;
            const startY = handleBox.y + handleBox.height / 2;

            // mousedown でリサイズ開始
            await page.mouse.move(startX, startY);
            await page.mouse.down();

            // mousemove でドラッグ（右に 80px 移動して列幅を広げる）
            // AreaResizer.activate() が呼ばれていない場合、mousemove リスナーが未登録のため
            // ガイドラインが動かず、mouseup 時に setColumnWidth() も呼ばれない
            await page.mouse.move(startX + 80, startY);

            // mouseup でリサイズ確定（ColumnWidthCommand が History に積まれて setColumnWidth() 呼び出し）
            await page.mouse.up();

            // ドラッグ後の列幅を取得する
            const widthAfter = await visibleColumnHeader.evaluate(
                (el: Element) => (el as HTMLElement).style.width
            );

            // バグ修正前: AreaResizer が activate() されていないため mousemove/mouseup リスナーが未登録。
            //   mouseup が window に届かず setColumnWidth() が呼ばれないので widthBefore === widthAfter となり
            //   このアサーションが失敗して RED になる。
            // バグ修正後: createMiniEditorTable() で areaResizer.activate() が呼ばれるため
            //   グローバルリスナーが登録され、ドラッグ操作が完結して widthAfter が変化して GREEN になる。
            expect(widthAfter).not.toBe(widthBefore);
        },
    );

    test(
        'ミニEditorTableの列幅リサイズ後にUndoすると元の列幅に戻ること',
        async ({ page }) => {
            // quest テーブルを開いて1行目を選択する
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);
            await waitForRelationsPanelContentAsync(page);

            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();

            // visible な列ヘッダーを取得する
            const visibleColumnHeader = miniTable.locator(
                '.editor-table-column-header:not([style*="display: none"])'
            ).first();
            await expect(visibleColumnHeader).toBeVisible();

            // ドラッグ前の列幅を記録する
            const widthBefore = await visibleColumnHeader.evaluate(
                (el: Element) => (el as HTMLElement).style.width
            );

            // リサイズハンドルでドラッグ操作を実行する
            const resizeHandle = visibleColumnHeader.locator('.column-resize-handle').first();
            const handleBox = await resizeHandle.boundingBox();
            if (!handleBox) throw new Error('リサイズハンドルの boundingBox が取得できません');

            const startX = handleBox.x + handleBox.width / 2;
            const startY = handleBox.y + handleBox.height / 2;
            await page.mouse.move(startX, startY);
            await page.mouse.down();
            await page.mouse.move(startX + 80, startY);
            await page.mouse.up();

            // リサイズ後の列幅を確認する（バグ修正前はここでリサイズが未実施のため同値のまま）
            const widthAfterResize = await visibleColumnHeader.evaluate(
                (el: Element) => (el as HTMLElement).style.width
            );
            expect(widthAfterResize).not.toBe(widthBefore);

            // ミニEditorTableのセルをクリックしてフォーカスをミニテーブルに移す
            // Ctrl+Z を押したとき、ミニEditorTable の History に Undo が届くようにする
            const miniCell = miniTable.locator(
                '.editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell):not([style*="display: none"])'
            ).first();
            await expect(miniCell).toBeVisible();
            await miniCell.click();

            // Ctrl+Z で Undo する
            await page.keyboard.press('Control+z');

            // Undo 後に元の列幅に戻っていることを確認する
            const widthAfterUndo = await visibleColumnHeader.evaluate(
                (el: Element) => (el as HTMLElement).style.width
            );
            expect(widthAfterUndo).toBe(widthBefore);
        },
    );
});
