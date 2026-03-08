import { test, expect } from '@playwright/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// RelationsPanel 初期表示バグのテスト
//
// 不具合の概要:
//   テーブルを新規に開いたとき、およびタブを切り替えたとき、
//   A1セル（row=0）にフォーカスがあるにもかかわらず RelationsPanel に
//   リレーション情報が表示されない。
//
// 根本原因:
//   tab.ts の activateTabState() で state.selection.resetNotification() を呼んで
//   lastNotifiedRow=-1 にリセットするが、その後 updateRenderer() を呼ばないため、
//   RelationsPanel への通知が一度も発火されないまま表示が放置される。
//
// 期待動作:
//   テーブルを開いた直後 / タブを切り替えた直後に、
//   現在フォーカス行（A1 = row=0）に基づいて RelationsPanel が自動更新される。
//   FK を持つテーブルであれば .relations-panel-content と .relations-table-section が
//   追加操作なしに表示されるべき。
// =============================================================================

/**
 * テスト用ファイルシステムを生成する。
 *
 * テーブル構成:
 *   enemy: id, ja（敵名テーブル）
 *   quest: id, name, enemy_id（クエスト。enemy.id をFKとして参照）
 *
 * quest テーブルを開いた直後に A1（row=0）がフォーカスされ、
 * enemy_id=1 の FK 値に基づいて RelationsPanel に enemy セクションが
 * 自動表示されることを検証する。
 *
 * reference: "enemy.id" にする理由:
 *   resolveRowsByFkValue() は columnName（"id"）で enemy テーブルの行を検索する。
 *   "enemy.id" なら PKルックアップで fkValue="1" → enemy.id=1 の行が1件正しく返る。
 */
function createInitialDisplayTestFileSystem(): MockFileSystem {
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
 * エクスプローラーからテーブルを開き、左ペインのアクティブな EditorTable の Locator を返す。
 * アクティブタブのタイトルが tableName に変わるまで待機することで開放完了を確認する。
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const activeTab = page.locator('.tab-button-active');
    await expect(activeTab).toHaveText(tableName);
    const table = page.locator('.editor-left-pane .editor-table:visible');
    await expect(table).toBeVisible();
    return table;
}

// =============================================================================
// テストスイート1: テーブルを新規に開いた直後の RelationsPanel 自動表示
// =============================================================================

test.describe('テーブルを新規に開いた直後に RelationsPanel が自動表示されること', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createInitialDisplayTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'FK を持つテーブルを開いた直後に行選択操作なしで .relations-panel-content が表示されること',
        async ({ page }) => {
            // quest を開いた直後、A1（row=0, enemy_id=1）にフォーカスがある。
            // activateTabState が RelationsPanel を正しく更新すれば、
            // 追加の行選択操作なしで .relations-panel-content が表示されるべき。
            //
            // バグ修正前: resetNotification() 後に updateRenderer() が呼ばれないため
            //   RelationsPanel は .relations-panel-placeholder のままになり、
            //   このアサーションが失敗して RED になる。
            // バグ修正後: activateTabState() で RelationsPanel への通知を強制発火するため GREEN になる。
            await openTableAsync(page, 'quest');

            const content = page.locator('.relations-panel-content');
            await expect(content).toBeVisible();
        },
    );

    test(
        'FK を持つテーブルを開いた直後に行選択操作なしで enemy テーブルセクションが表示されること',
        async ({ page }) => {
            // quest を開いた直後（A1 = enemy_id=1）に enemy セクションが自動表示されること。
            // バグ修正前: RelationsPanel が更新されないため .relations-table-section が現れない → RED
            // バグ修正後: GREEN
            await openTableAsync(page, 'quest');

            const enemySection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('enemy', { exact: true }),
            });
            await expect(enemySection).toBeVisible();
        },
    );

    test(
        'FK を持つテーブルを開いた直後に行選択操作なしでミニ EditorTable が表示されること',
        async ({ page }) => {
            // quest を開いた直後（A1 = enemy_id=1）に enemy のミニ EditorTable が表示されること。
            // バグ修正前: RelationsPanel が更新されないため .relations-panel .editor-table が現れない → RED
            // バグ修正後: GREEN
            await openTableAsync(page, 'quest');

            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();
        },
    );
});

// =============================================================================
// テストスイート2: タブを切り替えたときの RelationsPanel 自動更新
// =============================================================================

test.describe('タブを切り替えたときに RelationsPanel が自動更新されること', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createInitialDisplayTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'quest タブを開いた後 enemy タブを開き、再び quest タブに戻ると .relations-panel-content が表示されること',
        async ({ page }) => {
            // quest を開く（FK あり → RelationsPanel に enemy セクションが表示されるべき）
            await openTableAsync(page, 'quest');

            // enemy を開く（FK なし → RelationsPanel はプレースホルダー状態になる可能性がある）
            await openTableAsync(page, 'enemy');

            // 再び quest タブに戻る
            // タブボタンをクリックして quest をアクティブ化する
            const questTabButton = page.locator('.tab-button').getByText('quest', { exact: true });
            await questTabButton.click();
            await expect(page.locator('.tab-button-active')).toHaveText('quest');

            // quest に戻った直後、A1（row=0, enemy_id=1）にフォーカスがあるはず。
            // activateTabState が RelationsPanel を正しく更新すれば、
            // 追加の行選択操作なしで .relations-panel-content が表示されるべき。
            //
            // バグ修正前: resetNotification() 後に updateRenderer() が呼ばれないため
            //   RelationsPanel は enemy タブ表示中の状態のまま（または enemy の状態で更新後に
            //   quest 用コンテンツが表示されない）→ このアサーションが失敗して RED になる。
            // バグ修正後: activateTabState() で RelationsPanel への通知を強制発火するため GREEN になる。
            const content = page.locator('.relations-panel-content');
            await expect(content).toBeVisible();
        },
    );

    test(
        'タブを切り替えて quest に戻ったとき、行選択操作なしで enemy テーブルセクションが表示されること',
        async ({ page }) => {
            // quest を開く
            await openTableAsync(page, 'quest');

            // enemy を開いてタブを切り替える
            await openTableAsync(page, 'enemy');

            // quest タブに戻る
            const questTabButton = page.locator('.tab-button').getByText('quest', { exact: true });
            await questTabButton.click();
            await expect(page.locator('.tab-button-active')).toHaveText('quest');

            // quest 戻り直後に enemy セクションが自動表示されること。
            // バグ修正前: RelationsPanel が更新されないため .relations-table-section が現れない → RED
            // バグ修正後: GREEN
            const enemySection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('enemy', { exact: true }),
            });
            await expect(enemySection).toBeVisible();
        },
    );

    test(
        'quest タブから enemy タブに切り替えると RelationsPanel がプレースホルダーまたは enemy 用コンテンツになること',
        async ({ page }) => {
            // quest を開いて行を選択してコンテンツ表示を安定させる
            const questTable = await openTableAsync(page, 'quest');
            // 行ヘッダーをクリックして行選択を明示的に行う
            await questTable.locator('.editor-table-row-header').first().click();
            const questContent = page.locator('.relations-panel-content');
            await expect(questContent).toBeVisible();

            // enemy タブを開く（enemy は FK を持たないため RelationsPanel の状態が変わる）
            await openTableAsync(page, 'enemy');

            // enemy は FK を参照する列を持たない（参照される側）。
            // タブ切り替え後に RelationsPanel が quest 用の enemy セクションを
            // 表示し続けていないことを確認する（古いコンテンツが残っていないこと）。
            //
            // enemy テーブルは 1:N として quest から参照されているため、
            // activateTabState が正しく RelationsPanel を更新すれば、
            // enemy の A1 行に対する RelationsPanel コンテンツが表示されるべき。
            // ただし 1:N セクションが表示されるかどうかはバグ修正の範囲次第なので、
            // ここでは「quest の N:1 enemy セクション（.relations-tag--n1）が
            // 消えていること」のみを確認する。
            //
            // バグ修正前: enemy タブに切り替えた後も quest 用の N:1 セクションが残る可能性がある。
            //   または RelationsPanel が全く更新されず quest 用のまま表示される。
            // バグ修正後: enemy タブの行に基づいて RelationsPanel が更新される。
            const enemyTabActive = page.locator('.tab-button-active');
            await expect(enemyTabActive).toHaveText('enemy');

            // enemy テーブルにはFK列がないため N:1 タグ（.relations-tag--n1）は存在しないはず
            // （enemy は参照される側であり、quest から参照するFK列を持たない）
            const n1Tag = page.locator('.relations-panel .relations-tag--n1');
            await expect(n1Tag).toHaveCount(0);
        },
    );
});
