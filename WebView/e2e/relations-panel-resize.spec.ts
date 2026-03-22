import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// ISSUE_0103: Relationsパネルの幅調節で低速ドラッグ時に倍の距離調整される問題
//
// 根本原因:
//   onResize コールバックに3つの設計不整合があった:
//   1. panelElement（border-left 1px含む）の幅を読み取り、parent（rightSlot）の flexBasis を設定
//   2. パーセンテージ変換の丸め誤差（0.1%単位の Math.round）が低速ドラッグ時に蓄積
//   3. consumed delta が実際の width 変化量と乖離
//
// 修正:
//   parent.getBoundingClientRect().width を基準にし、Math.round の丸めを撤廃。
//   パーセンテージ指定は維持する（ウィンドウリサイズ時の比率保持のため）。
// =============================================================================

/**
 * テスト用ファイルシステム
 *
 * テーブル構成:
 *   enemy: id, ja（敵名テーブル）
 *   quest: id, name, enemy_id（クエスト。enemy.id を FK として参照）
 *
 * quest を開いて行を選択すると RelationsPanel に enemy のミニEditorTable が表示される。
 */
function createResizeTestFileSystem(): MockFileSystem {
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
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                { key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
            ],
            primary_key: ["id"],
        }),
        "data/quest.csv": [
            "id,name,enemy_id",
            "1,first_quest,1",
            "2,second_quest,2",
        ].join("\n"),
    };
}

/**
 * Explorerでテーブルを開き、左ペインのEditorTableを返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    await page.locator('#explorer').getByText(tableName, { exact: true }).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行ヘッダーをクリックして行を選択する（rowIndex: 0始まり）
 */
async function selectRowAsync(table: Locator, rowIndex: number): Promise<void> {
    await table.locator('.editor-table-row-header').nth(rowIndex).click();
}

test.describe('ISSUE_0103: Relationsパネルのリサイズが1:1追従すること', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createResizeTestFileSystem());
        await page.goto('/');
    });

    test(
        '低速ドラッグ（小ステップ複数回）でパネル幅変化量がマウス移動量と1:1で追従すること',
        async ({ page }) => {
            // quest テーブルを開いて1行目を選択し、RelationsPanel にコンテンツを表示させる
            const mainTable = await openTableAsync(page, 'quest');
            await selectRowAsync(mainTable, 0);
            await expect(page.locator('.relations-panel-content')).toBeVisible();

            // リサイズハンドルを取得する
            const handle = page.locator('.relations-panel .resize-handle[data-direction="horizontal"]');
            await expect(handle).toBeVisible();

            // rightSlot（RelationsPanelの親）の初期幅を取得する
            const rightSlot = page.locator('.editor-right-slot');
            const initialBox = await rightSlot.boundingBox();
            if (!initialBox) throw new Error('editor-right-slot の boundingBox が取得できません');
            const initialWidth = initialBox.width;

            // ハンドルの位置を取得してドラッグを開始する
            const handleBox = await handle.boundingBox();
            if (!handleBox) throw new Error('リサイズハンドルの boundingBox が取得できません');
            const startX = handleBox.x + handleBox.width / 2;
            const startY = handleBox.y + handleBox.height / 2;

            await page.mouse.move(startX, startY);
            await page.mouse.down();

            // 低速ドラッグ: 左に2pxずつ50回移動する（合計100px）
            // バグ修正前: Math.round による丸め誤差が蓄積し、実際の幅変化が約200pxになる
            // バグ修正後: 丸めを撤廃し高精度パーセンテージを直接設定するため、1:1で追従する
            const stepCount = 50;
            const stepSize = -2; // 左に移動 = ハンドルを左に = パネル幅拡大
            const totalDelta = stepCount * stepSize; // -100px

            for (let i = 1; i <= stepCount; i++) {
                await page.mouse.move(startX + stepSize * i, startY);
            }

            await page.mouse.up();

            // ドラッグ後のパネル幅を取得する
            const finalBox = await rightSlot.boundingBox();
            if (!finalBox) throw new Error('ドラッグ後の editor-right-slot の boundingBox が取得できません');
            const finalWidth = finalBox.width;

            // ハンドルを左に100px移動 → delta=-100 → newWidth = currentWidth - (-100) = currentWidth + 100
            // パネル幅が約100px増加していること（許容誤差3px以内）
            const expectedWidthChange = -totalDelta; // 100px
            const actualWidthChange = finalWidth - initialWidth;
            expect(Math.abs(actualWidthChange - expectedWidthChange),
                `パネル幅変化量が期待値と乖離しています: actual=${actualWidthChange.toFixed(1)}px, expected=${expectedWidthChange}px`
            ).toBeLessThanOrEqual(3);
        },
    );
});
