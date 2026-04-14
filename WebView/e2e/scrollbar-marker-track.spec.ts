import { test as base, expect } from './fixtures/test';
import type { Page, Locator } from '@playwright/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';

// =============================================================================
// ScrollbarMarkerTrack テスト
//
// スクロールバー上にエラー（赤）とgit変更（緑）のマーカーを描画する機能の検証。
// canvas のピクセル色を Y 座標を区間分割して検証し、マーカーが正しい位置に描画されるか確認する。
//
// テストケース:
//   1. canvas要素の存在: テーブルを開いたとき .scrollbar-marker-track が存在する
//   2. 水平トラック廃止: 通常テーブルを開いても .horizontal-scrollbar-marker-track は存在しない
//   3. エラーマーカー位置: 100行テーブルの末尾にPK重複エラーを置き、マーカーが下部に描画される
//   4. git変更マーカー位置: 100行テーブルの末尾に変更行を置き、マーカーが下部に描画される
//   5. マーカーなし: エラーもgit変更もない場合は透明
//   6. タブ切り替え: 別テーブルに切り替えるとマーカーが変わる
//   7. ValidationPanel競合: enemy を先に開き、item でPK重複を作って即戻っても赤マーカーは再出現しない
//   8. 非アクティブタブclose競合: enemy を閉じても、アクティブ item の赤マーカーは消えない
// =============================================================================

// テストデータ -------------------------------------------------------------------

/** 100行のCSVデータを生成する（各行: id, name） */
function generateCsvRows(rowCount: number): string[] {
    const rows = ['id,name'];
    for (let i = 1; i <= rowCount; i++) {
        rows.push(`${i},item_${i}`);
    }
    return rows;
}

/** 100行のCSVデータを生成する（各行: id, name, value） */
function generateCsvRowsWithValue(rowCount: number): string[] {
    const rows = ['id,name,value'];
    for (let i = 1; i <= rowCount; i++) {
        rows.push(`${i},item_${i},${i * 100}`);
    }
    return rows;
}

/** PK重複がないクリーンな100行テーブル */
function createCleanFileSystem(): MockFileSystem {
    return {
        'schema/item.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
            ],
            primary_key: ['id'],
        }),
        'data/item.csv': generateCsvRows(100).join('\n'),
    };
}

/**
 * 100行テーブルの末尾付近（行98,99）にPK重複があるテーブル。
 * id=98 が2行存在する（行98と行99のidを同じ値にする）。
 * マーカーはスクロールバー下部（98%付近）に描画されるべき。
 */
function createDuplicatePkFileSystem(): MockFileSystem {
    const rows = generateCsvRows(100);
    // 行99（0始まりで99行目）の id を 98 に変更してPK重複を作る
    rows[99] = '98,item_99_dup';
    return {
        'schema/item.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
            ],
            primary_key: ['id'],
        }),
        'data/item.csv': rows.join('\n'),
    };
}

/** タブ切り替えテスト用: item（100行・PK重複あり）+ enemy（クリーン） */
function createTwoTableFileSystem(): MockFileSystem {
    const itemRows = generateCsvRows(100);
    itemRows[99] = '98,item_99_dup';
    return {
        'schema/item.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
            ],
            primary_key: ['id'],
        }),
        'data/item.csv': itemRows.join('\n'),
        'schema/enemy.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'ja', type: 'string' },
            ],
            primary_key: ['id'],
        }),
        'data/enemy.csv': [
            'id,ja',
            '1,slime',
            '2,dragon',
        ].join('\n'),
    };
}

/** ValidationPanel競合テスト用: item / enemy ともに初期状態はクリーン */
function createTwoCleanTableFileSystem(): MockFileSystem {
    return {
        'schema/item.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
            ],
            primary_key: ['id'],
        }),
        'data/item.csv': generateCsvRows(100).join('\n'),
        'schema/enemy.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'ja', type: 'string' },
            ],
            primary_key: ['id'],
        }),
        'data/enemy.csv': [
            'id,ja',
            '1,slime',
            '2,dragon',
        ].join('\n'),
    };
}

/**
 * git変更テスト用: 100行テーブルの末尾行（id=100）の value を変更。
 * マーカーはスクロールバー最下部に描画されるべき。
 */
const GIT_TEST_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: 'id', type: 'int' },
        { key: 1, name: 'name', type: 'string' },
        { key: 2, name: 'value', type: 'int' },
    ],
    primary_key: ['id'],
});

function createGitCurrentCsv(): string {
    const rows = generateCsvRowsWithValue(100);
    // 最終行の value を変更する（10000→99999）
    rows[100] = '100,item_100,99999';
    return rows.join('\n');
}

const GIT_HEAD_CSV = generateCsvRowsWithValue(100).join('\n');

const GIT_STATUS = {
    changes: [
        { path: 'data/item.csv', tableName: 'item', isNew: false },
    ],
    staged: [],
};

const GIT_HEAD_FILES: Record<string, string> = {
    'data/item.csv': GIT_HEAD_CSV,
};

function createGitChangeFileSystem(): MockFileSystem {
    return {
        'schema/item.json': GIT_TEST_SCHEMA,
        'data/item.csv': createGitCurrentCsv(),
    };
}

// ヘルパー関数 -------------------------------------------------------------------

/** エクスプローラーからテーブルを開いてLocatorを返す */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    await page.locator('#explorer .explorer-file').getByText(tableName, { exact: true }).click();
    const table = page.locator('.editor-left-slot .editor-table:visible').first();
    await expect(table).toBeVisible();
    return table;
}

/**
 * canvas を上半分（0%〜50%）と下半分（50%〜100%）に分割して各区間の色を検出する。
 * スクロールバー領域全体を100%としたマーカー位置の検証に使用する。
 */
async function detectMarkerPositionsAsync(page: Page): Promise<{
    upper: { hasRed: boolean; hasGreen: boolean };
    lower: { hasRed: boolean; hasGreen: boolean };
}> {
    return await page.evaluate(() => {
        const canvas = document.querySelector('.scrollbar-marker-track') as HTMLCanvasElement;
        if (!canvas) return {
            upper: { hasRed: false, hasGreen: false },
            lower: { hasRed: false, hasGreen: false },
        };
        const ctx = canvas.getContext('2d');
        if (!ctx) return {
            upper: { hasRed: false, hasGreen: false },
            lower: { hasRed: false, hasGreen: false },
        };
        const w = canvas.width;
        const h = canvas.height;
        if (h === 0) return {
            upper: { hasRed: false, hasGreen: false },
            lower: { hasRed: false, hasGreen: false },
        };
        const midY = Math.floor(h / 2);

        function scanRegion(startY: number, endY: number): { hasRed: boolean; hasGreen: boolean } {
            const regionHeight = endY - startY;
            if (regionHeight <= 0) return { hasRed: false, hasGreen: false };
            const imageData = ctx!.getImageData(0, startY, w, regionHeight);
            let hasRed = false;
            let hasGreen = false;
            for (let i = 0; i < imageData.data.length; i += 4) {
                const r = imageData.data[i];
                const g = imageData.data[i + 1];
                const a = imageData.data[i + 3];
                if (a > 0 && r > 200 && g < 100) hasRed = true;
                if (a > 0 && g > 100 && r < 150) hasGreen = true;
            }
            return { hasRed, hasGreen };
        }

        return {
            upper: scanRegion(0, midY),
            lower: scanRegion(midY, h),
        };
    });
}

// =============================================================================
// git変更マーカー用フィクスチャ
// =============================================================================

interface GitMarkerFixtures {
    gitMarkerPage: void;
}

const gitTest = base.extend<GitMarkerFixtures>({
    gitMarkerPage: async ({ page }, use) => {
        await page.addInitScript((args: {
            status: {
                changes: { path: string; tableName: string; isNew: boolean }[];
                staged: { path: string; tableName: string; isNew: boolean }[];
            };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as {
                __mockGitHeadFiles: Record<string, string>;
            }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: GIT_HEAD_FILES });

        await installMockApiAsync(page, createGitChangeFileSystem());
        await page.goto('/');
        await use();
    },
});

// テスト本体 -------------------------------------------------------------------

base.describe('ScrollbarMarkerTrack', () => {

    // -------------------------------------------------------------------------
    // テスト1: canvas要素の存在
    // -------------------------------------------------------------------------
    base(
        'テーブルを開いたとき .scrollbar-marker-track canvas が .editor-left-slot 内に存在する',
        async ({ page }) => {
            await installMockApiAsync(page, createCleanFileSystem());
            await page.goto('/');
            await openTableAsync(page, 'item');
            const canvas = page.locator('.editor-left-slot .scrollbar-marker-track');
            await expect(canvas).toBeAttached();
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: 水平スクロールマーカーは廃止されている
    // -------------------------------------------------------------------------
    base(
        '通常テーブルを開いたとき .horizontal-scrollbar-marker-track は存在しない',
        async ({ page }) => {
            await installMockApiAsync(page, createCleanFileSystem());
            await page.goto('/');
            await openTableAsync(page, 'item');
            const horizontalCanvas = page.locator('.editor-left-slot .horizontal-scrollbar-marker-track');
            await expect(horizontalCanvas).toHaveCount(0);
        },
    );

    // -------------------------------------------------------------------------
    // テスト3: エラーマーカーが正しい位置に描画される
    // 100行テーブルの行98,99にPK重複 → マーカーは下半分に描画、上半分には描画されない
    // -------------------------------------------------------------------------
    base(
        'PK重複エラーのマーカーがスクロールバー下部に描画される',
        async ({ page }) => {
            await installMockApiAsync(page, createDuplicatePkFileSystem());
            await page.goto('/');
            await openTableAsync(page, 'item');
            // バリデーション実行完了を待つ。
            // バーチャルスクロールにより98-99行目はDOMに存在しないため .cell-error は使えない。
            // スクロールバーマーカー（ストアベースで描画される）が出現するまでポーリングする。
            await expect.poll(
                async () => {
                    const p = await detectMarkerPositionsAsync(page);
                    return p.lower.hasRed;
                },
                { timeout: 5000 },
            ).toBe(true);
            // マーカーが下半分にのみ存在することを検証する
            const positions = await detectMarkerPositionsAsync(page);
            expect(positions.upper.hasRed).toBe(false);
            expect(positions.lower.hasRed).toBe(true);
        },
    );

    // -------------------------------------------------------------------------
    // テスト5: マーカーなし（エラーもgit変更もないクリーンな状態）
    // -------------------------------------------------------------------------
    base(
        'エラーもgit変更もない場合は canvas が透明である',
        async ({ page }) => {
            await installMockApiAsync(page, createCleanFileSystem());
            await page.goto('/');
            await openTableAsync(page, 'item');
            await page.waitForTimeout(500);
            const positions = await detectMarkerPositionsAsync(page);
            expect(positions.upper.hasRed).toBe(false);
            expect(positions.upper.hasGreen).toBe(false);
            expect(positions.lower.hasRed).toBe(false);
            expect(positions.lower.hasGreen).toBe(false);
        },
    );

    // -------------------------------------------------------------------------
    // テスト6: タブ切り替えでマーカーが更新される
    // -------------------------------------------------------------------------
    base(
        'タブ切り替えでマーカーが変わる（エラーありテーブル→クリーンテーブル）',
        async ({ page }) => {
            await installMockApiAsync(page, createTwoTableFileSystem());
            await page.goto('/');
            // item テーブル（PK重複あり）を開く
            await openTableAsync(page, 'item');
            // バリデーション完了を待つ（スクロールバーマーカーが描画されるまでポーリング）
            await expect.poll(
                async () => {
                    const p = await detectMarkerPositionsAsync(page);
                    return p.lower.hasRed;
                },
                { timeout: 5000 },
            ).toBe(true);
            const positionsWithError = await detectMarkerPositionsAsync(page);
            expect(positionsWithError.lower.hasRed).toBe(true);
            // enemy テーブル（エラーなし）に切り替える
            await openTableAsync(page, 'enemy');
            await expect.poll(
                async () => {
                    const p = await detectMarkerPositionsAsync(page);
                    return p.upper.hasRed || p.lower.hasRed;
                },
                { timeout: 5000 },
            ).toBe(false);
        },
    );

    // -------------------------------------------------------------------------
    // テスト7: enemy を先に開いた順序でも、非アクティブ item から赤マーカーを再描画しない
    // -------------------------------------------------------------------------
    base(
        'enemy を先に開き、item でPK重複を作って即戻っても、待機後に enemy 側の右側マーカーへ赤が出ない',
        async ({ page }) => {
            await installMockApiAsync(page, createTwoCleanTableFileSystem());
            await page.goto('/');
            // openEditorTables の反復順を enemy -> item に固定する。
            await openTableAsync(page, 'enemy');
            const itemTable = await openTableAsync(page, 'item');
            // item の2行目idを1に変更してPK重複を作る。Enterではなく enemy クリックで確定し、
            // setTimeout(0) の遅延バリデーションが enemy 復帰後に流れる順序を踏む。
            const secondItemPkCell = itemTable.locator('.editor-table-row').nth(2)
                .locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
            await expect(secondItemPkCell).toBeVisible();
            await secondItemPkCell.dblclick();
            const editField = page.locator('.grid-textfield-active');
            await expect(editField).toBeVisible();
            await page.keyboard.press('Control+a');
            await page.keyboard.insertText('1');
            await page.locator('#explorer .explorer-file').getByText('enemy', { exact: true }).click();
            const enemyTable = page.locator('.editor-left-slot .tab-wrapper[data-tab-name="enemy"] .editor-table');
            await expect(enemyTable).toBeVisible();
            // item の遅延バリデーション完了後でも、敵側の共有右側マーカーに赤が出ないことを期待する。
            await expect(page.locator('.status-bar-badge-count')).toHaveText('2', { timeout: 5000 });
            const positions = await detectMarkerPositionsAsync(page);
            expect(positions.upper.hasRed).toBe(false);
            expect(positions.lower.hasRed).toBe(false);
        },
    );

    // -------------------------------------------------------------------------
    // テスト8: 非アクティブな enemy タブを閉じても、アクティブ item の赤マーカーは消えない
    // -------------------------------------------------------------------------
    base(
        'item に赤マーカーが出ている状態で非アクティブな enemy タブを閉じても、item 側の右側マーカーが残る',
        async ({ page }) => {
            await installMockApiAsync(page, createTwoCleanTableFileSystem());
            await page.goto('/');
            await openTableAsync(page, 'enemy');
            const itemTable = await openTableAsync(page, 'item');

            // item の2行目idを1に変更して、item をアクティブのままPK重複を発生させる。
            const secondItemPkCell = itemTable.locator('.editor-table-row').nth(2)
                .locator('.editor-table-cell:not(.editor-table-row-header)').nth(0);
            await expect(secondItemPkCell).toBeVisible();
            await secondItemPkCell.dblclick();
            const editField = page.locator('.grid-textfield-active');
            await expect(editField).toBeVisible();
            await page.keyboard.press('Control+a');
            await page.keyboard.insertText('1');
            await page.keyboard.press('Enter');

            // 先に item 側の赤マーカーが出ていることを固定する。
            await expect.poll(
                async () => {
                    const positions = await detectMarkerPositionsAsync(page);
                    return positions.upper.hasRed;
                },
                { timeout: 5000 },
            ).toBe(true);

            const enemyTabButton = page.locator('.tab-button').filter({
                has: page.locator('.tab-button-name', { hasText: 'enemy' }),
            }).first();
            await enemyTabButton.locator('.tab-button-close').click();
            await expect(enemyTabButton).toHaveCount(0);
            await expect(page.locator('.tab-button-active')).toContainText('item');

            // 期待動作: 非アクティブ tab の close では共有右側マーカーは消えない。
            const positionsAfterClose = await detectMarkerPositionsAsync(page);
            expect(positionsAfterClose.upper.hasRed).toBe(true);
        },
    );
});

// git変更マーカーのテスト
gitTest.describe('ScrollbarMarkerTrack git変更', () => {
    // -------------------------------------------------------------------------
    // テスト4: git変更マーカーが正しい位置に描画される
    // 100行テーブルの最終行のみ変更 → マーカーは下半分に描画、上半分には描画されない
    // -------------------------------------------------------------------------
    gitTest(
        'git変更マーカーがスクロールバー下部に描画される',
        async ({ page, gitMarkerPage: _gitMarkerPage }) => {
            await openTableAsync(page, 'item');
            // git差分ハイライトの適用を待つ。
            // バーチャルスクロールにより最終行はDOMに存在しないため .cell-git-changed は使えない。
            // スクロールバーマーカー（ストアベースで描画される）が出現するまでポーリングする。
            await expect.poll(
                async () => {
                    const p = await detectMarkerPositionsAsync(page);
                    return p.lower.hasGreen;
                },
                { timeout: 5000 },
            ).toBe(true);
            // マーカーが下半分にのみ存在することを検証する
            const positions = await detectMarkerPositionsAsync(page);
            expect(positions.upper.hasGreen).toBe(false);
            expect(positions.lower.hasGreen).toBe(true);
        },
    );
});
