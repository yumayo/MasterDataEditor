import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// ドロップダウン クイックビュー機能のテスト
//
// 機能概要:
//   FK列のドロップダウンアイテム（.grid-dropdown-item）にマウスオーバーすると、
//   即座にクイックビューパネル（.dropdown-quick-view）が表示される。
//   クイックビューはRelationsPanelと同じCSSクラス・視覚スタイルで表示される。
//   アイテムからマウスが離れるとクイックビューが非表示になる。
//   クイックビュー自体にマウスオーバーしている間は表示が維持される。
//   クイックビューからもマウスが離れると非表示になる。
//   矢印キーで選択を移動してもクイックビューが更新される。
//   ドロップダウンを閉じるとクイックビューも消える。
//   素早く別のアイテムへ移動した場合、最後にホバーしたアイテムのデータが表示される（レースコンディション防止）。
//
// テストケース一覧:
//   1. マウスオーバーで即座にクイックビューが表示される（300msディレイなし）
//   2. クイックビューに参照先テーブルのHTMLテーブルが表示される（ヘッダーと行）
//   3. クイックビューに参照先テーブルの列名と値が含まれる
//   4. マウスリーブでクイックビューが非表示になる
//   5. 矢印キーでの選択移動でクイックビューが更新される
//   6. ドロップダウンを閉じるとクイックビューも消える
//   7. 素早く別のアイテムへ移動すると最後にホバーしたアイテムのデータが表示される
//   8. クイックビューはドロップダウンの左右の広い方に表示される
//   9. クイックビューにRelationsPanel風のセクションヘッダーが表示される
//  10. クイックビューにテーブルヘッダー（テーブル名・参照種別タグ・行数）が表示される
//  11. クイックビューにマウスオーバーすると表示が維持される
//  12. クイックビューからマウスが離れると非表示になる
//  13. クイックビューの背景色が --background-sub-color である
//  14. クイックビューに max-width が設定されていない
//  15. クイックビューに max-height と overflow-y:auto が設定されている
// BUG_0026:
//  16. クイックビューはビューポート下端付近でも 2D AABB 判定でドロップダウンリストの領域に重ならない
//  17. 右端フォールバック時にクイックビューはドロップダウンリストの領域に水平方向で被らない
//  18. ドロップダウンが右寄りのとき、クイックビューは左側に表示される（左側余白が広い）
//  19. 左右余白が同じとき、クイックビューは右側に表示される（同値は右優先）
// =============================================================================

// =============================================================================
// フィクスチャ生成ヘルパー
// =============================================================================

/**
 * クイックビューテスト用のファイルシステムを生成する。
 *
 * テーブル構成:
 *   reward_group: id（int）, name（string）
 *   quest: id（int）, name（string）, reward_group_id（int, → reward_group.id）
 *
 * quest.reward_group_id は FK 列として reward_group テーブルを参照する。
 * ドロップダウンで reward_group のエントリを選択するシナリオを想定。
 */
function createQuickViewTestFileSystem(): MockFileSystem {
    return {
        "schema/reward_group.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/reward_group.csv": [
            "id,name",
            "1,daily_reward",
            "2,event_reward",
            "3,login_bonus",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "name", type: "string" },
                // reward_group.id を FK として参照する
                { key: 2, name: "reward_group_id", type: "int", reference: "reward_group.id" },
            ],
            primary_key: ["id"],
        }),
        "data/quest.csv": [
            "id,name,reward_group_id",
            "1,first_quest,1",
            "2,second_quest,2",
            "3,third_quest,1",
        ].join("\n"),
    };
}

// =============================================================================
// テストユーティリティ
// =============================================================================

/**
 * Explorerでテーブルを開き、左ペインのEditorTable Locatorを返す。
 * RelationsPanelにもミニEditorTableが表示されるため、左ペインに限定する。
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行・列のデータセルを返す。
 * rowIndex: 0始まり（ヘッダー行を除く）, colIndex: 0始まり（行ヘッダーを除く）
 */
function getDataCell(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex);
    return row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
}

/**
 * FK列のセルをダブルクリックしてドロップダウンを表示し、ドロップダウンリスト Locator を返す。
 * .grid-dropdown コンテナはゼロサイズ（子が全てabsolute）のため、
 * 既存テストと同じく .grid-dropdown-list を使用する。
 * ドロップダウンアイテムが表示されるまで待機する。
 */
async function openFkDropdownAsync(page: Page, table: Locator, rowIndex: number, fkColIndex: number): Promise<Locator> {
    const cell = getDataCell(table, rowIndex, fkColIndex);
    await cell.dblclick();
    // ドロップダウンリストが表示されるまで待機（左ペインに限定）
    const dropdownList = page.locator('.editor-left-pane .grid-dropdown-list');
    await expect(dropdownList).toBeVisible();
    // アイテムが1件以上表示されるまで待機
    await expect(dropdownList.locator('.grid-dropdown-item').first()).toBeVisible();
    return dropdownList;
}

/**
 * 2D AABB 重なり判定: クイックビューとドロップダウンリストが重ならないことを検証する。
 * 水平または垂直のいずれか一方でも分離していれば重なりなしと判定する。
 */
function assertNoAABBOverlap(
    quickViewBox: { x: number; y: number; width: number; height: number },
    dropdownBox: { x: number; y: number; width: number; height: number },
): void {
    const quickViewLeft = quickViewBox.x;
    const quickViewRight = quickViewBox.x + quickViewBox.width;
    const quickViewTop = quickViewBox.y;
    const quickViewBottom = quickViewBox.y + quickViewBox.height;
    const dropdownLeft = dropdownBox.x;
    const dropdownRight = dropdownBox.x + dropdownBox.width;
    const dropdownTop = dropdownBox.y;
    const dropdownBottom = dropdownBox.y + dropdownBox.height;

    const noHorizontalOverlap = quickViewRight <= dropdownLeft || quickViewLeft >= dropdownRight;
    const noVerticalOverlap = quickViewBottom <= dropdownTop || quickViewTop >= dropdownBottom;
    const noOverlap = noHorizontalOverlap || noVerticalOverlap;
    expect(
        noOverlap,
        `クイックビュー（left:${quickViewLeft.toFixed(0)}, right:${quickViewRight.toFixed(0)}, ` +
        `top:${quickViewTop.toFixed(0)}, bottom:${quickViewBottom.toFixed(0)}）が` +
        `ドロップダウンリスト（left:${dropdownLeft.toFixed(0)}, right:${dropdownRight.toFixed(0)}, ` +
        `top:${dropdownTop.toFixed(0)}, bottom:${dropdownBottom.toFixed(0)}）と重なっています`,
    ).toBe(true);
}

// =============================================================================
// テスト
// =============================================================================

test.describe('ドロップダウン クイックビュー', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createQuickViewTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'マウスオーバーで即座にクイックビューパネルが表示される（300msディレイなし）',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            // 最初のドロップダウンアイテムにホバー
            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            // ディレイなしで即座にフェッチ・レンダリングが開始されるため、
            // デフォルトタイムアウト（5秒）内に表示されることを検証する。
            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();
        },
    );

    test(
        'クイックビューに参照先テーブルのHTMLテーブルが表示される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // ミニEditorTableが存在する
            const editorTable = quickView.locator('.editor-table');
            await expect(editorTable).toBeVisible();

            // ヘッダー行が存在する
            const headerRow = editorTable.locator('.editor-table-column-header-row');
            await expect(headerRow).toBeVisible();

            // データ行が1件以上存在する（バッファ空行を除外）
            const dataRows = editorTable.locator('.editor-table-row:not(.editor-table-empty-row)');
            await expect(dataRows.first()).toBeVisible();
        },
    );

    test(
        'クイックビューに参照先テーブルの列名と値が含まれる',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            // 1件目（id=1, daily_reward）にホバー
            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // reward_group テーブルの列名が表示されている
            await expect(quickView.locator('.editor-table-column-header-row')).toContainText('id');
            await expect(quickView.locator('.editor-table-column-header-row')).toContainText('name');

            // id=1 に対応する値が表示されている（バッファ空行・列ヘッダー行を除外したデータ行）
            const dataRows = quickView.locator('.editor-table-row:not(.editor-table-empty-row):not(.editor-table-column-header-row)');
            await expect(dataRows.first()).toContainText('1');
            await expect(dataRows.first()).toContainText('daily_reward');
        },
    );

    test(
        'マウスリーブでクイックビューが非表示になる',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // アイテムからマウスを離す（ドロップダウンリスト外に移動）
            await page.mouse.move(0, 0);

            // クイックビューが非表示になる
            await expect(quickView).not.toBeVisible();
        },
    );

    test(
        '矢印キーでの選択移動でクイックビューが更新される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            // 最初のアイテム（id=1, daily_reward）にホバーしてクイックビューを表示
            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // 1件目の内容が表示されていることを確認（バッファ空行・列ヘッダー行を除外したデータ行）
            await expect(quickView.locator('.editor-table-row:not(.editor-table-empty-row):not(.editor-table-column-header-row)').first()).toContainText('daily_reward');

            // ArrowDown で2件目（id=2, event_reward）に移動
            await page.keyboard.press('ArrowDown');
            // キーボード選択によってクイックビューが即座に更新される（非同期のため再取得して待機）
            await expect(page.locator('body > .dropdown-quick-view .editor-table-row:not(.editor-table-empty-row):not(.editor-table-column-header-row)').first()).toContainText('event_reward');
        },
    );

    test(
        'ドロップダウンを閉じるとクイックビューも消える',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // Escape でドロップダウンを閉じる
            await page.keyboard.press('Escape');

            // ドロップダウンリストが非表示になる
            await expect(dropdown).not.toBeVisible();

            // クイックビューも非表示になる
            await expect(quickView).not.toBeVisible();
        },
    );

    test(
        '素早く別のアイテムへ移動すると最後にホバーしたアイテムのデータが表示される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            const items = dropdown.locator('.grid-dropdown-item');
            const firstItem = items.nth(0);
            const secondItem = items.nth(1);

            // 1件目にホバーしてすぐに2件目に移動する（ディレイ削除後でも非同期レースが起きうる）
            await firstItem.hover();
            await secondItem.hover();

            // ディレイ削除後: 即座に非同期処理が始まるが、最後にホバーした2件目のデータが表示されるべき。
            // クイックビューが表示されるまで待機する。
            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // 2件目（event_reward）のデータが表示されていることを検証する。
            // 1件目（daily_reward）が表示された状態で2件目に移動したとしても、
            // 最終的には2件目のデータに更新されることを確認する。
            await expect(quickView.locator('.editor-table-row:not(.editor-table-empty-row):not(.editor-table-column-header-row)').first()).toContainText('event_reward');
        },
    );

    test(
        'クイックビューはドロップダウンの左右の広い方に表示される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            // ドロップダウンを左寄り（left:100px）に強制配置して右側余白 > 左側余白にする
            await page.evaluate(() => {
                const dropdownEl = document.querySelector('.editor-left-pane .grid-dropdown') as HTMLElement | null;
                if (!dropdownEl) throw new Error('.grid-dropdown が見つかりません');
                dropdownEl.style.position = 'fixed';
                dropdownEl.style.left = '100px';
                dropdownEl.style.top = '200px';
            });

            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // 右側余白が広いため、クイックビューがドロップダウンリストの右側に配置されている
            const listBox = await dropdown.boundingBox();
            const quickViewBox = await quickView.boundingBox();
            if (!listBox || !quickViewBox) {
                throw new Error('boundingBox が取得できません');
            }
            // クイックビューの左端 >= ドロップダウンリストの右端（右側に表示）
            expect(quickViewBox.x).toBeGreaterThanOrEqual(listBox.x + listBox.width - 1);
        },
    );

    test(
        'クイックビューにRelationsPanel風のセクションヘッダーが表示される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // セクションヘッダーが存在し "RELATIONS" テキストを持つ
            const sectionHeader = quickView.locator('.relations-panel-section-header');
            await expect(sectionHeader).toBeVisible();
            await expect(sectionHeader).toHaveText('RELATIONS');
        },
    );

    test(
        'クイックビューにテーブルヘッダー（テーブル名・参照種別タグ・行数）が表示される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // テーブルヘッダーが存在する
            const tableHeader = quickView.locator('.relations-table-header');
            await expect(tableHeader).toBeVisible();

            // テーブル名が表示される（参照先テーブルは reward_group）
            const tableTitle = tableHeader.locator('.relations-table-title');
            await expect(tableTitle).toBeVisible();
            await expect(tableTitle).toContainText('reward_group');

            // N:1 タグが表示される（FK参照先なので N:1）
            const n1Tag = tableHeader.locator('.relations-tag--n1');
            await expect(n1Tag).toBeVisible();

            // 行数が表示される（reward_group は3行）
            const rowCount = tableHeader.locator('.relations-table-row-count');
            await expect(rowCount).toBeVisible();
            await expect(rowCount).toContainText('1');
        },
    );

    test(
        'クイックビューにマウスオーバーすると表示が維持される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            // ドロップダウンアイテムにホバーしてクイックビューを表示する
            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // クイックビューにマウスを移動する（ドロップダウンアイテムから mouseleave が発生する）
            await quickView.hover();

            // クイックビューが表示されたままであることを確認
            await expect(quickView).toBeVisible();
        },
    );

    test(
        'クイックビューからマウスが離れると非表示になる',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            // ドロップダウンアイテムにホバーしてクイックビューを表示する
            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // クイックビューにマウスを移動する
            await quickView.hover();
            await expect(quickView).toBeVisible();

            // クイックビューからマウスを離す（ページ左上の安全な場所に移動）
            await page.mouse.move(0, 0);

            // クイックビューが非表示になる
            await expect(quickView).not.toBeVisible();
        },
    );

    // =========================================================================
    // クイックビュー改修（色味・サイズ・スクロール・ディレイ削除）のテスト
    // =========================================================================

    test(
        'ダークモードでクイックビューのフォント色が --font-color である',
        async ({ page }) => {
            // index.html の body に data-theme="dark" が設定済みのため、ダークテーマが既に適用されている
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // クイックビュー要素自身から CSS 変数の解決済み値と実際の color を同時に取得して比較する
            const actualColor = await quickView.evaluate(el => getComputedStyle(el).color);
            // CSS 変数の値を rgb/rgba 形式に正規化して比較する
            const expectedColor = await quickView.evaluate(el => {
                const varValue = getComputedStyle(el).getPropertyValue('--font-color').trim();
                const tempEl = document.createElement('div');
                tempEl.style.color = varValue;
                el.appendChild(tempEl);
                const computed = getComputedStyle(tempEl).color;
                el.removeChild(tempEl);
                return computed;
            });

            expect(actualColor).toBe(expectedColor);
        },
    );

    test(
        'クイックビューの背景色が --background-sub-color である',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // クイックビュー要素自身から CSS 変数の解決済み値と実際の backgroundColor を同時に取得して比較する。
            // 要素自身から取得することでダークテーマ等の上書きにも対応できる。
            const actualBgColor = await quickView.evaluate(el =>
                getComputedStyle(el).backgroundColor
            );
            // CSS 変数の値を rgb/rgba 形式に正規化して比較する
            const expectedBgColor = await quickView.evaluate(el => {
                const varValue = getComputedStyle(el).getPropertyValue('--background-sub-color').trim();
                const tempEl = document.createElement('div');
                tempEl.style.backgroundColor = varValue;
                el.appendChild(tempEl);
                const computed = getComputedStyle(tempEl).backgroundColor;
                el.removeChild(tempEl);
                return computed;
            });

            expect(actualBgColor).toBe(expectedBgColor);
        },
    );

    test(
        'クイックビューに max-width が設定されていない',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // max-width が none（制限なし）であることを検証する
            const maxWidth = await quickView.evaluate(el => getComputedStyle(el).maxWidth);
            expect(maxWidth).toBe('none');
        },
    );

    test(
        'クイックビューに max-height が設定されており overflow-y が auto である',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // max-height が none 以外（スクロール上限あり）であることを検証する
            const maxHeight = await quickView.evaluate(el => getComputedStyle(el).maxHeight);
            expect(maxHeight).not.toBe('none');

            // overflow-y が auto であることを検証する（ウィンドウからはみ出した場合にスクロール）
            const overflowY = await quickView.evaluate(el => getComputedStyle(el).overflowY);
            expect(overflowY).toBe('auto');
        },
    );

    // =========================================================================
    // FEAT_0027: クイックビュー改修のテスト
    // =========================================================================

    test(
        'クイックビューが body 直下に配置され position:fixed で表示される',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            // 修正後: クイックビューは .grid-dropdown の子ではなく body 直下に配置される
            // body の直接の子要素として .dropdown-quick-view.visible が存在することを検証する
            const bodyDirectChild = page.locator('body > .dropdown-quick-view.visible');
            await expect(bodyDirectChild).toBeVisible();

            // position が fixed であることを検証する（StackingContext の問題を解消するため）
            const position = await bodyDirectChild.evaluate(el => window.getComputedStyle(el).position);
            expect(position).toBe('fixed');
        },
    );

    test(
        'クイックビューがミニEditorTableを使用している',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            // 修正後: body 直下にクイックビューが配置される
            const quickView = page.locator('body > .dropdown-quick-view.visible');
            await expect(quickView).toBeVisible();

            // 静的な <table class="relations-mini-table"> ではなく EditorTable の DOM 構造が存在する
            // EditorTable の特徴的な要素: .editor-table クラスを持つコンテナ
            const editorTable = quickView.locator('.editor-table');
            await expect(editorTable).toBeVisible();

            // EditorTable の列ヘッダー行が存在することを検証する
            const columnHeaderRow = quickView.locator('.editor-table-column-header-row');
            await expect(columnHeaderRow).toBeVisible();

            // 参照先テーブル (reward_group) の列名が EditorTable のヘッダーに表示されていることを検証する
            await expect(columnHeaderRow).toContainText('id');
            await expect(columnHeaderRow).toContainText('name');
        },
    );

    // =========================================================================
    // BUG_0026: クイックビューがプルダウンメニューに被る問題のテスト
    //
    // 不具合内容:
    //   positionElement() でビューポート下端をはみ出す場合に上方向補正するが、
    //   「ドロップダウンリストの top より上に行かない」制約がないため、
    //   クイックビューがドロップダウンリストに重なって操作不能になる。
    //
    // 検証方法:
    //   ドロップダウンリストを画面下端付近に強制配置して上方向補正が発動する状況を作り、
    //   クイックビューの矩形とドロップダウンリストの矩形が重ならないことを検証する。
    // =========================================================================

    test(
        'クイックビューはビューポート下端付近でも　ドロップダウンリストの領域に重ならない',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            // ドロップダウンリスト要素をビューポート下端付近に強制配置して、
            // クイックビューの上方向補正が発動する状況を作る。
            // grid-dropdown-list は position:absolute だが、親 grid-dropdown を fixed に変更することで
            // ビューポート下端付近に配置する。
            await page.evaluate(() => {
                // grid-dropdown コンテナを画面下端付近に強制配置する
                const dropdown = document.querySelector('.editor-left-pane .grid-dropdown') as HTMLElement | null;
                if (!dropdown) throw new Error('.grid-dropdown が見つかりません');
                dropdown.style.position = 'fixed';
                // ビューポート下端から100px上に配置（max-height:200px のリストが下端付近に来る）
                dropdown.style.top = (window.innerHeight - 100) + 'px';
                dropdown.style.left = '200px';
            });

            // アイテムにホバーしてクイックビューを表示させる
            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            // クイックビューとドロップダウンリストの矩形を取得する
            const quickViewBox = await quickView.boundingBox();
            const dropdownBox = await dropdown.boundingBox();
            if (!quickViewBox || !dropdownBox) {
                throw new Error('boundingBox が取得できません');
            }

            // 2D AABB 重なり判定: クイックビューがドロップダウンリストと重ならないことを検証する
            assertNoAABBOverlap(quickViewBox, dropdownBox);
        },
    );

    // =========================================================================
    // BUG_0026 追加: 右端フォールバック時にクイックビューがドロップダウンに被らない
    //
    // シナリオ:
    //   ドロップダウンリストをビューポート右端付近に配置する。
    //   positionElement() はまず右側に配置を試み、はみ出しを検出して左側フォールバックを実行する。
    //   左側にも十分なスペースがない場合、maxWidth 制約によりクイックビューがドロップダウン領域に
    //   水平方向で重ならないよう制限される。
    // =========================================================================

    test(
        '右端フォールバック時にクイックビューはドロップダウンリストの領域に水平方向で被らない',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            // ドロップダウンリストをビューポート右端付近に強制配置する。
            // これにより右側配置でははみ出し、左側フォールバックが発動する。
            // 左側スペースも小さいため maxWidth 制約が発動してドロップダウンに被らないことを検証する。
            await page.evaluate(() => {
                const dropdownEl = document.querySelector('.editor-left-pane .grid-dropdown') as HTMLElement | null;
                if (!dropdownEl) throw new Error('.grid-dropdown が見つかりません');
                dropdownEl.style.position = 'fixed';
                // ビューポート右端 - 200px に配置（右側にはわずかしかスペースがない）
                dropdownEl.style.left = (window.innerWidth - 200) + 'px';
                dropdownEl.style.top = '200px';
            });

            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            const quickViewBox = await quickView.boundingBox();
            const dropdownBox = await dropdown.boundingBox();
            if (!quickViewBox || !dropdownBox) {
                throw new Error('boundingBox が取得できません');
            }

            // 2D AABB 重なり判定: クイックビューがドロップダウンリストと重ならないことを検証する
            assertNoAABBOverlap(quickViewBox, dropdownBox);
        },
    );

    // =========================================================================
    // クイックビュー左右配置切り替えのテスト
    //
    // ドロップダウンリストの左右のビューポート余白を比較し、広い方に配置する。
    // 同値の場合は右側優先。
    // 「ドロップダウンが左寄りのとき右側に配置される」ケースはテスト8で検証済み。
    // =========================================================================

    test(
        'ドロップダウンが右寄りのとき、クイックビューは左側に表示される（左側余白が広い）',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            // ドロップダウンをビューポート右端付近に強制配置する。
            // 右側余白が小さく左側余白が大きいため、左側に配置されるべき。
            await page.evaluate(() => {
                const dropdownEl = document.querySelector('.editor-left-pane .grid-dropdown') as HTMLElement | null;
                if (!dropdownEl) throw new Error('.grid-dropdown が見つかりません');
                dropdownEl.style.position = 'fixed';
                // ビューポート右端 - 200px に配置（左側余白が圧倒的に大きい）
                dropdownEl.style.left = (window.innerWidth - 200) + 'px';
                dropdownEl.style.top = '200px';
            });

            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            const listBox = await dropdown.boundingBox();
            const quickViewBox = await quickView.boundingBox();
            if (!listBox || !quickViewBox) {
                throw new Error('boundingBox が取得できません');
            }

            // クイックビューの右端 <= ドロップダウンリストの左端（左側に配置されている）
            expect(quickViewBox.x + quickViewBox.width).toBeLessThanOrEqual(listBox.x + 1);
        },
    );

    test(
        '左右余白が同じとき、クイックビューは右側に表示される（同値は右優先）',
        async ({ page }) => {
            const table = await openTableAsync(page, 'quest');
            const dropdown = await openFkDropdownAsync(page, table, 0, 2);

            // ドロップダウンリストの幅を取得してビューポート中央に配置する
            const listWidth = await dropdown.evaluate(el => el.getBoundingClientRect().width);

            await page.evaluate((dropdownListWidth: number) => {
                const dropdownEl = document.querySelector('.editor-left-pane .grid-dropdown') as HTMLElement | null;
                if (!dropdownEl) throw new Error('.grid-dropdown が見つかりません');
                dropdownEl.style.position = 'fixed';
                // ドロップダウンリストがビューポート中央に来るように配置する。
                // leftSpace = centerLeft, rightSpace = innerWidth - (centerLeft + listWidth) = centerLeft
                // → 左右余白が等しくなる
                const centerLeft = (window.innerWidth - dropdownListWidth) / 2;
                dropdownEl.style.left = centerLeft + 'px';
                dropdownEl.style.top = '200px';
            }, listWidth);

            const firstItem = dropdown.locator('.grid-dropdown-item').first();
            await firstItem.hover();

            const quickView = page.locator('body > .dropdown-quick-view');
            await expect(quickView).toBeVisible();

            const listBox = await dropdown.boundingBox();
            const quickViewBox = await quickView.boundingBox();
            if (!listBox || !quickViewBox) {
                throw new Error('boundingBox が取得できません');
            }

            // 同値の場合は右側優先: クイックビューの左端 >= ドロップダウンリストの右端
            expect(quickViewBox.x).toBeGreaterThanOrEqual(listBox.x + listBox.width - 1);
        },
    );
});
