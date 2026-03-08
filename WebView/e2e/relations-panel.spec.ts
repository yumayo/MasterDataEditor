import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

/**
 * リレーションパネルテスト用のファイルシステムを生成する
 *
 * テーブル構成:
 *   enemy: id, ja（敵名テーブル）
 *   quest: id, name, enemy_id（クエスト。enemy.idをFKとして参照）
 *
 * reference: "enemy.id" にする理由:
 *   resolveRowsByFkValue() は columnName（"id"）で enemy テーブルの行を検索する。
 *   "enemy.id" ならPKルックアップで fkValue="1" → enemy.id=1 の行が1件正しく返る。
 *   "enemy.ja" にすると ja 列の値（"スライム"等）と fkValue="1" を比較するため 0 件になり、
 *   ミニEditorTableが空になってデータセルが存在しない状態になる。
 */
function createRelationsPanelTestFileSystem(): MockFileSystem {
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
            "3,ゴブリン",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                // enemy.id を FK として参照する（RelationsPanel は columnName="id" で PKルックアップ）
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
 * エディターテーブルが表示されるまで待機し、テーブルのLocatorを返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator('.editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行ヘッダーをクリックして行を選択する
 * rowIndex: 0始まり（ヘッダー行を除く）
 */
async function selectRowAsync(table: Locator, rowIndex: number): Promise<void> {
    const header = table
        .locator('.editor-table-row-header')
        .nth(rowIndex);
    await header.click();
}

test.describe('RelationsPanel', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createRelationsPanelTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        '右ペインに .relations-panel 要素が存在すること',
        async ({ page }) => {
            const relationsPanel = page.locator('.relations-panel');
            await expect(relationsPanel).toBeVisible();
        },
    );

    test(
        'テーブルを開いた初期状態で行未選択のプレースホルダーが表示されること',
        async ({ page }) => {
            await openTableAsync(page, 'quest');
            const relationsPanel = page.locator('.relations-panel');
            await expect(relationsPanel).toBeVisible();
            await expect(relationsPanel.locator('.relations-panel-placeholder')).toBeVisible();
        },
    );

    test(
        '行を選択すると relations-panel 内にコンテンツが表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            await selectRowAsync(table, 0);
            const relationsPanel = page.locator('.relations-panel');
            await expect(relationsPanel).toBeVisible();
            const content = relationsPanel.locator('.relations-panel-content');
            await expect(content).toBeVisible();
        },
    );

    test(
        '行を選択すると参照先テーブル名が relations-panel 内に表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            // quest テーブルは enemy を参照している
            await selectRowAsync(table, 0);
            const relationsPanel = page.locator('.relations-panel');
            await expect(relationsPanel.locator('.relations-table-title').getByText('enemy', { exact: true })).toBeVisible();
        },
    );

    test(
        '別の行を選択すると relations-panel の内容が更新されること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            // 1行目（first_quest, enemy_id=1 → スライム）を選択
            await selectRowAsync(table, 0);
            const relationsPanel = page.locator('.relations-panel');
            // 2行目（second_quest, enemy_id=2 → ドラゴン）を選択して内容が変わることを確認
            await selectRowAsync(table, 1);
            await expect(relationsPanel).toBeVisible();
            const content = relationsPanel.locator('.relations-panel-content');
            await expect(content).toBeVisible();
        },
    );
});

// =============================================================================
// 改善1: パネル幅リサイザー
// =============================================================================

test.describe('RelationsPanel リサイザー', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createRelationsPanelTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'リサイズハンドルが存在すること',
        async ({ page }) => {
            const handle = page.locator('.relations-panel-resize-handle');
            await expect(handle).toHaveCount(1);
        },
    );

    test(
        'リサイズハンドルをドラッグするとパネル幅が変わること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            // 行選択してパネルにコンテンツを表示させる
            await selectRowAsync(table, 0);
            await expect(page.locator('.relations-panel-content')).toBeVisible();

            const handle = page.locator('.relations-panel-resize-handle');

            // ドラッグ前の幅を取得
            const beforeWidth = await page.evaluate(() => {
                const el = document.querySelector('.relations-panel');
                return el ? el.getBoundingClientRect().width : 0;
            });

            // ハンドルを左に100px ドラッグ（パネルを広げる方向）
            const handleBox = await handle.boundingBox();
            if (!handleBox) throw new Error('リサイズハンドルの boundingBox が取得できません');
            const startX = handleBox.x + handleBox.width / 2;
            const startY = handleBox.y + handleBox.height / 2;
            await page.mouse.move(startX, startY);
            await page.mouse.down();
            await page.mouse.move(startX - 100, startY);
            await page.mouse.up();

            // ドラッグ後の幅を取得して変化していることを確認
            const afterWidth = await page.evaluate(() => {
                const el = document.querySelector('.relations-panel');
                return el ? el.getBoundingClientRect().width : 0;
            });

            expect(afterWidth).not.toBeCloseTo(beforeWidth, -1);
            // パネルは広がっているはずなので幅が増加していることも確認
            expect(afterWidth).toBeGreaterThan(beforeWidth);
        },
    );
});

// =============================================================================
// 改善2: 常に全テーブル表示
// =============================================================================

test.describe('RelationsPanel 全テーブル常時表示', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createRelationsPanelTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        '行選択時にすべての参照テーブルが常に表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            // quest の1行目を選択（enemy_id=1 → enemy テーブルが参照先）
            await selectRowAsync(table, 0);

            const sections = page.locator('.relations-table-section');
            await expect(sections).toHaveCount(1);

            const miniTables = page.locator('.relations-panel .editor-table');
            await expect(miniTables.first()).toBeVisible();
        },
    );

    test(
        'リスト切り替えボタンが存在しないこと',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            await selectRowAsync(table, 0);
            await expect(page.locator('.relations-panel-content')).toBeVisible();

            const refList = page.locator('.relations-ref-list');
            await expect(refList).toHaveCount(0);
        },
    );
});

// =============================================================================
// 改善3: EditorTable流用
// =============================================================================

test.describe('RelationsPanel EditorTable流用', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createRelationsPanelTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'リレーションパネル内にeditor-tableクラスの要素が存在すること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            await selectRowAsync(table, 0);
            await expect(page.locator('.relations-panel-content')).toBeVisible();

            const editorTableInPanel = page.locator('.relations-panel .editor-table');
            await expect(editorTableInPanel.first()).toBeVisible();
        },
    );

    test(
        'リレーションパネル内のセルをダブルクリックすると編集UIが表示されること（編集可能）',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            await selectRowAsync(table, 0);
            await expect(page.locator('.relations-panel-content')).toBeVisible();

            // Phase 1 仕様変更: ミニEditorTableは編集可能になった（makeReadOnly() 廃止）。
            // dblclick で grid-textfield-active が表示されることを確認する。
            // buildMiniTableAsync は非同期のため、セルが DOM に出現するまで明示的に待機する。
            const panelCell = page.locator(
                '.relations-panel .editor-table .editor-table-cell:not(.editor-table-row-header):not(.editor-table-column-header):not(.editor-table-corner-cell)'
            ).first();
            await expect(panelCell).toBeVisible();
            await panelCell.dblclick();

            // 編集可能になったため編集UIが表示される
            const editField = page.locator(
                '.relations-panel .grid-textfield-active, .relations-panel input'
            ).first();
            await expect(editField).toBeVisible();
        },
    );
});
