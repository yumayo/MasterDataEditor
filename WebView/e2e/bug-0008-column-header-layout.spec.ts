import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// BUG_0008: テーブルの列ヘッダーが縦方向に積み重なってしまう不具合の回帰テスト
//
// 根本原因:
//   editor-table.css の .editor-table-column-header に
//   `display: flex; flex-direction: column;` が設定されており、
//   `display: table-cell` を上書きしてヘッダーセルがテーブルセルとして機能しなくなっていた。
//
// 修正内容:
//   `display: flex` を削除し `vertical-align: middle` に変更。
//   子 span に `display: block` を追加。
//
// 検証方針:
//   ヘッダー行の各セルの getBoundingClientRect().top がほぼ同一であることを確認する。
//   縦に積み重なっていた場合、各セルの top 値が大きく異なる（列数×セル高さ分ズレる）。
//   同一行にあるセルは top 値が一致するはずであり、許容誤差は 5px 以内とする。
// =============================================================================

/**
 * テスト用ファイルシステムを生成する
 * 複数列（id / name / attack / defense）を持つ item テーブル（comment なし）
 */
function createFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            primary_key: "id",
            header: [
                { key: 0, name: "id",      type: "int" },
                { key: 1, name: "name",    type: "string" },
                { key: 2, name: "attack",  type: "int" },
                { key: 3, name: "defense", type: "int" },
            ],
        }),
        "data/item.csv": [
            "id,name,attack,defense",
            "1,Sword,50,10",
            "2,Shield,5,80",
        ].join("\n"),
    };
}

/**
 * エクスプローラーからテーブルを開き、左ペインの EditorTable Locator を返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    // RelationsPanel にもミニテーブルが出るため左ペインに限定する
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/**
 * ヘッダー行の全列ヘッダーセルの getBoundingClientRect を取得する
 * コーナーセル（.editor-table-corner-cell）は除外し、列ヘッダーセルのみを対象とする
 */
async function getColumnHeaderRectsAsync(table: Locator): Promise<{ top: number; left: number; width: number; height: number }[]> {
    // ヘッダー行から列ヘッダーセル（コーナーセルを除く）を全取得する
    const headerRow = table.locator('.editor-table-column-header-row');
    const headers = headerRow.locator('.editor-table-column-header');
    const count = await headers.count();

    const rects: { top: number; left: number; width: number; height: number }[] = [];
    for (let i = 0; i < count; i++) {
        const rect = await headers.nth(i).evaluate((el: Element) => {
            const r = el.getBoundingClientRect();
            return { top: r.top, left: r.left, width: r.width, height: r.height };
        });
        rects.push(rect);
    }
    return rects;
}

/**
 * comment 付きスキーマのファイルシステムを生成する
 * 各列に comment を持つ item_with_comment テーブル
 * .column-header-comment と .column-header-name の 2行レイアウト検証に使用する
 */
function createFileSystemWithComment(): MockFileSystem {
    return {
        "schema/item_with_comment.json": JSON.stringify({
            primary_key: "id",
            header: [
                { key: 0, name: "id",      type: "int",    comment: "識別子" },
                { key: 1, name: "attack",  type: "int",    comment: "攻撃力" },
                { key: 2, name: "defense", type: "int",    comment: "防御力" },
            ],
        }),
        "data/item_with_comment.csv": "id,attack,defense\n1,50,10\n2,5,80",
    };
}

// =============================================================================
// テスト本体
// =============================================================================
test.describe('BUG_0008: テーブルのヘッダーレイアウト', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');
    });

    // ---------------------------------------------------------------------------
    // テスト1: 全列ヘッダーが同一の Y 座標に並ぶこと（横方向レイアウト）
    // ---------------------------------------------------------------------------
    test(
        'テーブルのヘッダーが横方向に並んでいること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            // ヘッダー行が DOM に出現するまで待機する
            const headerRow = table.locator('.editor-table-column-header-row');
            await expect(headerRow).toBeVisible();

            // 各列ヘッダーセルの矩形情報を取得する
            const rects = await getColumnHeaderRectsAsync(table);

            // 列ヘッダーが存在することを確認する（id / name / attack / defense の 4 列）
            expect(rects.length).toBeGreaterThanOrEqual(4);

            // 全列ヘッダーの top 値が先頭セルの top とほぼ同一（±5px）であることを確認する。
            // display: flex; flex-direction: column が有効だと各セルが縦積みになるため
            // top 値が大きくズレる（1セルあたり約20～30px以上差が生じる）。
            const baseTop = rects[0].top;
            for (let i = 1; i < rects.length; i++) {
                const diff = Math.abs(rects[i].top - baseTop);
                expect(diff, `列ヘッダー[${i}] の top=${rects[i].top} が基準 top=${baseTop} から ${diff}px ズレています（±5px 以内を期待）`).toBeLessThanOrEqual(5);
            }
        },
    );

    // ---------------------------------------------------------------------------
    // テスト2: 各列ヘッダーが左から右へ順に並ぶこと（left 値が単調増加）
    // ---------------------------------------------------------------------------
    test(
        '列ヘッダーが左から右へ順に並んでいること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            const headerRow = table.locator('.editor-table-column-header-row');
            await expect(headerRow).toBeVisible();

            const rects = await getColumnHeaderRectsAsync(table);
            expect(rects.length).toBeGreaterThanOrEqual(4);

            // 各列ヘッダーの left 値が前の列より大きいことを確認する。
            // 縦積みになっていると left 値は変わらず top 値が増加してしまう。
            for (let i = 1; i < rects.length; i++) {
                expect(rects[i].left, `列ヘッダー[${i}].left=${rects[i].left} は列ヘッダー[${i - 1}].left=${rects[i - 1].left} より大きい必要があります`).toBeGreaterThan(rects[i - 1].left);
            }
        },
    );

    // ---------------------------------------------------------------------------
    // テスト3: ヘッダー行の高さが不自然に大きくないこと
    //
    // 縦積みのバグが発生していると、ヘッダー行の高さが
    // 「列数 × 1セルの高さ」になってしまう（4列なら100px超）。
    // 正常時はヘッダー行の高さは単行分（約30px 前後）に収まるはず。
    // ---------------------------------------------------------------------------
    test(
        'ヘッダー行の高さが単行分（100px 未満）に収まっていること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');

            const headerRow = table.locator('.editor-table-column-header-row');
            await expect(headerRow).toBeVisible();

            // ヘッダー行全体の高さを取得する
            const rowHeight = await headerRow.evaluate((el: Element) => el.getBoundingClientRect().height);

            // 正常時は1行分なので100px以内に収まるはず。
            // 縦積みバグ発生時は 4列 × 約25px = 100px 超になる。
            expect(rowHeight, `ヘッダー行の高さ ${rowHeight}px が異常に大きい（100px 未満を期待）`).toBeLessThan(100);
        },
    );

    // ---------------------------------------------------------------------------
    // テスト4: 列ヘッダーセルの display が table-cell であること
    //
    // `display: flex` のような上書きが入ると table-cell が無効になり
    // テーブルレイアウトが崩れる。getComputedStyle で直接検証する。
    // ---------------------------------------------------------------------------
    test(
        '列ヘッダーセルの display が table-cell であること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item');
            const headers = table.locator('.editor-table-column-header-row .editor-table-column-header');
            const count = await headers.count();

            // 全列ヘッダーセルの算出 display 値が table-cell であることを確認する。
            // display: inline-block や flex が混入した場合にこのテストで検出できる。
            for (let i = 0; i < count; i++) {
                const display = await headers.nth(i).evaluate(
                    (el: Element) => getComputedStyle(el).display
                );
                expect(display, `列ヘッダー[${i}] の display="${display}" が table-cell ではありません`).toBe('table-cell');
            }
        },
    );
});

// =============================================================================
// comment 付き 2行ヘッダーのレイアウト検証
//
// .column-header-comment と .column-header-name に display: block を追加した変更が
// 正しく機能するかを検証する。
// - comment 付きヘッダーセルも横方向に並んでいること（Y 座標がほぼ同一）
// - セル内で .column-header-comment が .column-header-name より上に位置すること
// =============================================================================
test.describe('BUG_0008: comment 付き 2行ヘッダーのレイアウト', () => {
    test.beforeEach(async ({ page }) => {
        await installMockApiAsync(page, createFileSystemWithComment());
        await page.goto('/');
    });

    // ---------------------------------------------------------------------------
    // テスト5: comment 付きヘッダーセルが横方向に並んでいること
    //
    // comment が入って 2行レイアウトになっても、各セルの Y 座標（top）は
    // 同一行にあるため一致するはず。
    // ---------------------------------------------------------------------------
    test(
        'comment 付きヘッダーセルが横方向に並んでいること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item_with_comment');
            const headerRow = table.locator('.editor-table-column-header-row');
            await expect(headerRow).toBeVisible();

            const rects = await getColumnHeaderRectsAsync(table);
            // id / attack / defense の 3列が存在することを確認する
            expect(rects.length).toBeGreaterThanOrEqual(3);

            // comment 付きの 2行レイアウトでも全列ヘッダーが同一の Y 座標に並ぶことを確認する
            const baseTop = rects[0].top;
            for (let i = 1; i < rects.length; i++) {
                const diff = Math.abs(rects[i].top - baseTop);
                expect(diff, `comment 付き列ヘッダー[${i}] の top=${rects[i].top} が基準 top=${baseTop} から ${diff}px ズレています（±5px 以内を期待）`).toBeLessThanOrEqual(5);
            }
        },
    );

    // ---------------------------------------------------------------------------
    // テスト6: セル内で .column-header-name が .column-header-comment より上に位置すること
    //         （FEAT_0049 で name が上段、comment が下段に変更された）
    //
    // display: block が機能していれば name は comment の上に縦に並ぶ。
    // flex-direction 等の不正なスタイルが入ると縦並びが崩れる可能性がある。
    // ---------------------------------------------------------------------------
    test(
        'セル内で name が comment より上に表示されていること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'item_with_comment');
            const headerRow = table.locator('.editor-table-column-header-row');
            await expect(headerRow).toBeVisible();

            const headers = headerRow.locator('.editor-table-column-header');
            const count = await headers.count();
            // comment 付き列が存在することを前提とする
            expect(count).toBeGreaterThanOrEqual(1);

            // 各列ヘッダーセルで name の bottom <= comment の top を検証する
            for (let i = 0; i < count; i++) {
                const header = headers.nth(i);
                const nameEl = header.locator('.column-header-name');
                const commentEl = header.locator('.column-header-comment');

                // name 要素と comment 要素が存在するセルのみ検証する
                const nameCount = await nameEl.count();
                const commentCount = await commentEl.count();
                if (nameCount === 0 || commentCount === 0) { continue; }

                const nameBottom = await nameEl.evaluate((el: Element) => el.getBoundingClientRect().bottom);
                const commentTop = await commentEl.evaluate((el: Element) => el.getBoundingClientRect().top);

                // name の下端が comment の上端以下（つまり name が comment より上）であることを確認する
                expect(nameBottom, `列ヘッダー[${i}] で name.bottom=${nameBottom} が comment.top=${commentTop} より下になっています（name が comment の上にあるべき）`).toBeLessThanOrEqual(commentTop + 2);
            }
        },
    );
});
