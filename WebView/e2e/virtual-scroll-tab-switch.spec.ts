import { test, expect } from './fixtures/test';
import type { Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';

// =============================================================================
// バーチャルスクロール タブ切替テスト
//
// 仮想スクロールが有効になるサイズのテーブルを2つ開き、タブを切り替えたとき
// restoreBookmarkMarks() がDOM外の行にアクセスしてクラッシュしないことを検証する。
// また、タブ切替後にスクロール可能範囲が正しく維持されることを検証する。
// =============================================================================

function generateCsv(prefix: string, rowCount: number): string {
    const rows = ['id,name,value'];
    for (let i = 1; i <= rowCount; i++) {
        rows.push(`${i},${prefix}_${i},${i * 10}`);
    }
    return rows.join('\n');
}

function createFileSystem(): MockFileSystem {
    return {
        'schema/weapon.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
        }),
        'schema/enemy.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
        }),
        'data/weapon.csv': generateCsv('weapon', 100),
        'data/enemy.csv': generateCsv('enemy', 100),
    };
}

/** ブックマーク付きファイルシステム（weapon 80行目にブックマーク設定済み） */
function createFileSystemWithBookmark(): MockFileSystem {
    const fs = createFileSystem();
    fs['user:bookmarks.json'] = JSON.stringify([
        { tableName: 'weapon', rowKey: '80', columnName: 'name', label: 'weapon_80', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    return fs;
}

/** 1000行テーブルのファイルシステム（スクロール領域の縮小バグ検証用） */
function createLargeFileSystem(): MockFileSystem {
    return {
        'schema/weapon.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
        }),
        'schema/enemy.json': JSON.stringify({
            header: [
                { key: 0, name: 'id', type: 'int' },
                { key: 1, name: 'name', type: 'string' },
                { key: 2, name: 'value', type: 'int' },
            ],
            primary_key: ['id'],
        }),
        'data/weapon.csv': generateCsv('weapon', 1000),
        'data/enemy.csv': generateCsv('enemy', 1000),
    };
}

/** 横・縦スクロールが両方発生する1000行テーブルのファイルシステム */
function createWideLargeFileSystem(): MockFileSystem {
    const columns = ['id', 'name', 'value', 'hp', 'mp', 'attack', 'defense', 'speed', 'critical', 'resist', 'cost', 'memo'];
    const schema = JSON.stringify({
        header: columns.map((name, index) => ({
            key: index,
            name,
            type: index === 1 || index === 11 ? 'string' : 'int',
            width: 220,
        })),
        primary_key: ['id'],
    });
    const buildCsv = (prefix: string): string => {
        const rows = [columns.join(',')];
        for (let i = 1; i <= 1000; i++) {
            rows.push([
                i,
                `${prefix}_${i}`,
                i * 10,
                i * 20,
                i * 7,
                i * 3,
                i * 4,
                i * 5,
                i % 100,
                (i * 2) % 100,
                i * 11,
                `${prefix}_memo_${i}`,
            ].join(','));
        }
        return rows.join('\n');
    };
    return {
        'schema/weapon.json': schema,
        'schema/enemy.json': schema,
        'data/weapon.csv': buildCsv('weapon'),
        'data/enemy.csv': buildCsv('enemy'),
    };
}

interface HorizontalScrollSnapshot {
    scrollLeft: number;
    scrollTop: number;
    scrollWidth: number;
    clientWidth: number;
    maxScrollLeft: number;
    viewportLeft: number;
    contentLeft: number;
    overflowX: string;
    scrollbarWidthStyle: string;
}

async function getHorizontalScrollSnapshotAsync(viewport: Locator): Promise<HorizontalScrollSnapshot> {
    return viewport.evaluate((element) => {
        const content = element.querySelector('.editor-table-main-content') as HTMLElement | null;
        const viewportRect = element.getBoundingClientRect();
        const contentRect = content?.getBoundingClientRect() ?? viewportRect;
        const style = getComputedStyle(element);
        return {
            scrollLeft: element.scrollLeft,
            scrollTop: element.scrollTop,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            maxScrollLeft: Math.max(0, element.scrollWidth - element.clientWidth),
            viewportLeft: viewportRect.left,
            contentLeft: contentRect.left,
            overflowX: style.overflowX,
            scrollbarWidthStyle: style.getPropertyValue('scrollbar-width'),
        };
    });
}

function expectHorizontalScrollApplied(snapshot: HorizontalScrollSnapshot, expectedScrollLeft: number, context: string): void {
    expect(snapshot.scrollWidth, `${context}: 横スクロール可能なコンテンツ幅がありません`).toBeGreaterThan(snapshot.clientWidth + 100);
    expect(snapshot.maxScrollLeft, `${context}: 横スクロール可能範囲が不足しています`).toBeGreaterThan(100);
    expect(snapshot.overflowX, `${context}: 横スクロール可能なoverflow設定ではありません`).toMatch(/auto|scroll/);
    expect(snapshot.scrollbarWidthStyle, `${context}: スクロールバーがCSSで非表示にされています`).not.toBe('none');
    expect(snapshot.contentLeft, `${context}: コンテンツが横スクロール位置に応じて移動していません`).toBeLessThan(snapshot.viewportLeft - 50);
    expect(snapshot.scrollLeft, `${context}: 横スクロール位置が復元されていません`).toBe(expectedScrollLeft);
}

test.describe('バーチャルスクロール タブ切替', () => {
    test('仮想スクロール有効テーブル2つを開いてタブ切替してもクラッシュしない', async ({ page }) => {
        // ブラウザ側の未キャッチ例外を収集する
        const pageErrors: Error[] = [];
        page.on('pageerror', (error) => pageErrors.push(error));

        const fs = createFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        // 1つ目のテーブルを開く
        await page.locator('#explorer .explorer-file').getByText('weapon', { exact: true }).click();
        const weaponTable = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="weapon"] .editor-table');
        await expect(weaponTable).toBeVisible();

        // 2つ目のテーブルを開く
        await page.locator('#explorer .explorer-file').getByText('enemy', { exact: true }).click();
        const enemyTable = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="enemy"] .editor-table');
        await expect(enemyTable).toBeVisible();

        // 1つ目のタブに戻す（ここで restoreBookmarkMarks がDOM外の行にアクセスしてクラッシュしていた）
        await page.locator('.tab-button').getByText('weapon', { exact: true }).click();

        // クラッシュせずにテーブルが表示されていること
        await expect(weaponTable).toBeVisible();
        // テーブルにデータ行が表示されていること（仮想スクロールにより全行ではなく一部のみ）
        const rows = weaponTable.locator('.editor-table-row:not(.editor-table-column-header-row)');
        const rowCount = await rows.count();
        expect(rowCount, 'データ行が存在すること').toBeGreaterThan(0);

        // さらにもう一度切り替えても問題ないこと
        await page.locator('.tab-button').getByText('enemy', { exact: true }).click();
        await expect(enemyTable).toBeVisible();

        // ブラウザ側で未キャッチ例外が発生していないこと
        expect(pageErrors, '未キャッチ例外が発生していないこと').toHaveLength(0);
    });

    test('仮想スクロールで後方の行にスクロールしたときブックマークが復元される', async ({ page }) => {
        const fs = createFileSystemWithBookmark();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        // weapon テーブルを開く
        await page.locator('#explorer .explorer-file').getByText('weapon', { exact: true }).click();
        const weaponTable = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="weapon"] .editor-table');
        await expect(weaponTable).toBeVisible();

        // 初期表示では80行目はDOMに存在しないため、ブックマーク属性は見えない
        const initialBookmarked = await weaponTable.locator('[data-bookmarked]').count();
        expect(initialBookmarked, '初期表示ではDOM外のブックマークは表示されない').toBe(0);

        // 80行目付近までスクロールする（行の高さは20px）
        const scrollContainer = page.locator('.editor-left-pane');
        await scrollContainer.evaluate((el) => { el.scrollTop = 79 * 20; });
        await page.waitForTimeout(300);

        // スクロール後、80行目のブックマーク属性が復元されていること
        const afterScrollBookmarked = await weaponTable.locator('[data-bookmarked]').count();
        expect(afterScrollBookmarked, 'スクロール後にブックマークが復元されること').toBeGreaterThan(0);
    });

    test('1000行テーブル2つを開いてタブ切替後もスクロール可能範囲が維持される', async ({ page }) => {
        const pageErrors: Error[] = [];
        page.on('pageerror', (error) => pageErrors.push(error));

        const fs = createLargeFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        // 1つ目のテーブル（1000行）を開く
        await page.locator('#explorer .explorer-file').getByText('weapon', { exact: true }).click();
        const weaponTable = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="weapon"] .editor-table');
        await expect(weaponTable).toBeVisible();

        // 初期表示時のスクロール可能範囲を記録する
        const scrollContainer = page.locator('.editor-left-pane');
        const initialScrollHeight = await scrollContainer.evaluate((el) => el.scrollHeight);
        const clientHeight = await scrollContainer.evaluate((el) => el.clientHeight);
        console.log(`初期表示: scrollHeight=${initialScrollHeight}, clientHeight=${clientHeight}`);
        // 1000行 × 20px = 20000px以上のコンテンツ高さが必要
        expect(initialScrollHeight, '初期表示のスクロール高さが1000行分の大半をカバーすること').toBeGreaterThan(15000);

        // 2つ目のテーブル（1000行）を開く
        await page.locator('#explorer .explorer-file').getByText('enemy', { exact: true }).click();
        const enemyTable = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="enemy"] .editor-table');
        await expect(enemyTable).toBeVisible();

        // 1つ目のタブに戻す
        await page.locator('.tab-button').getByText('weapon', { exact: true }).click();
        await expect(weaponTable).toBeVisible();

        // タブ切替直後にスクロールしてrecalculateを発火させる
        await scrollContainer.evaluate((el) => { el.scrollTop = 100; });
        await page.waitForTimeout(200);

        // スクロール直後のスクロール可能範囲を確認
        const afterSmallScroll = await scrollContainer.evaluate((el) => el.scrollHeight);
        console.log(`タブ切替＋小スクロール後: scrollHeight=${afterSmallScroll}`);
        expect(afterSmallScroll, 'タブ切替+小スクロール後のスクロール高さが維持されること').toBeGreaterThan(initialScrollHeight * 0.8);

        // 900行目付近（末尾付近）まで大きくスクロールできること
        // バグ発生時: totalRowCount が縮小し、scrollTop をこの値に設定しても到達できない
        await scrollContainer.evaluate((el) => { el.scrollTop = 900 * 20; });
        await page.waitForTimeout(300);

        // スクロール後も scrollHeight が維持されていること
        const afterLargeScroll = await scrollContainer.evaluate((el) => el.scrollHeight);
        const actualScrollTop = await scrollContainer.evaluate((el) => el.scrollTop);
        console.log(`タブ切替＋大スクロール後: scrollHeight=${afterLargeScroll}, scrollTop=${actualScrollTop}`);
        expect(afterLargeScroll, '末尾付近スクロール後もスクロール高さが維持されること').toBeGreaterThan(initialScrollHeight * 0.8);
        // scrollTop が目標値（900*21=18900）の近傍に到達できること
        expect(actualScrollTop, '900行目付近までスクロールできること').toBeGreaterThan(15000);

        // ブラウザ側で未キャッチ例外が発生していないこと
        expect(pageErrors, '未キャッチ例外が発生していないこと').toHaveLength(0);
    });

    test('テーブルAをスクロール後に既存のテーブルBタブに切替えると先頭行から表示される', async ({ page }) => {
        const pageErrors: Error[] = [];
        page.on('pageerror', (error) => pageErrors.push(error));

        const fs = createLargeFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        // テーブルA（weapon 1000行）を開く
        await page.locator('#explorer .explorer-file').getByText('weapon', { exact: true }).click();
        const weaponTable = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="weapon"] .editor-table');
        await expect(weaponTable).toBeVisible();

        // テーブルB（enemy 1000行）を開く（この時点でBはスクロール位置0で表示）
        await page.locator('#explorer .explorer-file').getByText('enemy', { exact: true }).click();
        const enemyTable = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="enemy"] .editor-table');
        await expect(enemyTable).toBeVisible();

        // テーブルAのタブに戻す
        await page.locator('.tab-button').getByText('weapon', { exact: true }).click();
        await expect(weaponTable).toBeVisible();

        // テーブルAを500行目付近までスクロールする
        const scrollContainer = page.locator('.editor-left-pane');
        await scrollContainer.evaluate((el) => { el.scrollTop = 500 * 20; });
        await page.waitForTimeout(300);

        const scrollTopA = await scrollContainer.evaluate((el) => el.scrollTop);
        console.log(`テーブルAスクロール後: scrollTop=${scrollTopA}`);
        expect(scrollTopA, 'テーブルAで500行目付近にスクロールされていること').toBeGreaterThan(5000);

        // テーブルBのタブに切替える（既存タブ）
        await page.locator('.tab-button').getByText('enemy', { exact: true }).click();
        await expect(enemyTable).toBeVisible();
        await page.waitForTimeout(300);

        // テーブルBは先頭行（id=1）から表示されるべき（Aのスクロール位置に影響されない）
        const firstVisibleId = await enemyTable.evaluate((table) => {
            const rows = table.querySelectorAll('.editor-table-row:not(.editor-table-column-header-row)');
            if (rows.length === 0) return null;
            const firstRow = rows[0];
            const cells = firstRow.querySelectorAll('.editor-table-cell:not(.editor-table-row-header)');
            if (cells.length === 0) return null;
            return cells[0].textContent;
        });
        console.log(`テーブルB先頭行のid: ${firstVisibleId}`);
        expect(firstVisibleId, 'テーブルBは先頭行（id=1）から表示されるべき').toBe('1');

        // スクロール位置が先頭付近であること（テーブルBのsavedScrollTopは0のはず）
        const scrollTopB = await scrollContainer.evaluate((el) => el.scrollTop);
        console.log(`テーブルB表示後: scrollTop=${scrollTopB}`);
        expect(scrollTopB, 'テーブルBのスクロール位置は先頭付近であること').toBeLessThan(100);

        // ブラウザ側で未キャッチ例外が発生していないこと
        expect(pageErrors, '未キャッチ例外が発生していないこと').toHaveLength(0);
    });

    test('横スクロール済みの既存タブへ戻っても横位置が維持される', async ({ page }) => {
        const pageErrors: Error[] = [];
        page.on('pageerror', (error) => pageErrors.push(error));

        const fs = createWideLargeFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('weapon', { exact: true }).click();
        const weaponViewport = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="weapon"] .editor-table-main-viewport');
        await expect(weaponViewport).toBeVisible();

        await page.locator('#explorer .explorer-file').getByText('enemy', { exact: true }).click();
        const enemyViewport = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="enemy"] .editor-table-main-viewport');
        await expect(enemyViewport).toBeVisible();

        await page.locator('.tab-button').getByText('weapon', { exact: true }).click();
        await expect(weaponViewport).toBeVisible();
        await weaponViewport.evaluate((element) => {
            element.scrollLeft = 640;
            element.scrollTop = 8400;
            element.dispatchEvent(new Event('scroll'));
        });
        const before = await getHorizontalScrollSnapshotAsync(weaponViewport);
        expectHorizontalScrollApplied(before, before.scrollLeft, 'テスト前提');
        expect(before.scrollTop, 'テスト前提: 縦スクロール位置を設定できること').toBeGreaterThan(0);

        await page.locator('.tab-button').getByText('weapon', { exact: true }).click();
        await expect(weaponViewport).toBeVisible();
        const afterActiveTabClick = await getHorizontalScrollSnapshotAsync(weaponViewport);
        expect(afterActiveTabClick.scrollTop, `アクティブタブ再クリック後に縦スクロール位置が復元されていません: before=${before.scrollTop}, after=${afterActiveTabClick.scrollTop}`).toBe(before.scrollTop);
        expectHorizontalScrollApplied(afterActiveTabClick, before.scrollLeft, 'アクティブタブ再クリック後');

        await page.locator('.tab-button').getByText('enemy', { exact: true }).click();
        await expect(enemyViewport).toBeVisible();

        await page.locator('.tab-button').getByText('weapon', { exact: true }).click();
        await expect(weaponViewport).toBeVisible();
        await page.waitForTimeout(300);

        const after = await getHorizontalScrollSnapshotAsync(weaponViewport);

        expect(after.scrollTop, `縦スクロール位置が復元されていません: before=${before.scrollTop}, after=${after.scrollTop}`).toBeGreaterThan(0);
        expectHorizontalScrollApplied(after, before.scrollLeft, 'タブクリック復帰後');

        await page.locator('.tab-button').getByText('enemy', { exact: true }).click();
        await expect(enemyViewport).toBeVisible();
        await page.evaluate(() => { history.back(); });
        await expect(weaponViewport).toBeVisible();
        await page.waitForTimeout(300);

        const afterBack = await getHorizontalScrollSnapshotAsync(weaponViewport);

        expect(afterBack.scrollTop, `戻るボタン後に縦スクロール位置が復元されていません: before=${before.scrollTop}, after=${afterBack.scrollTop}`).toBeGreaterThan(0);
        expectHorizontalScrollApplied(afterBack, before.scrollLeft, '戻るボタン復帰後');
        expect(pageErrors, '未キャッチ例外が発生していないこと').toHaveLength(0);
    });

    test('フォームビュー表示中の既存タブへ戻っても横位置が維持される', async ({ page }) => {
        const pageErrors: Error[] = [];
        page.on('pageerror', (error) => pageErrors.push(error));

        const fs = createWideLargeFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');

        await page.locator('#explorer .explorer-file').getByText('weapon', { exact: true }).click();
        const weaponViewport = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="weapon"] .editor-table-main-viewport');
        await expect(weaponViewport).toBeVisible();

        await page.locator('#toolbar .toolbar-button-form-toggle').click();
        await expect(page.locator('.form-panel')).toBeVisible();

        await weaponViewport.evaluate((element) => {
            element.scrollLeft = element.scrollWidth;
            element.scrollTop = 8400;
            element.dispatchEvent(new Event('scroll'));
        });
        const before = await getHorizontalScrollSnapshotAsync(weaponViewport);
        expectHorizontalScrollApplied(before, before.scrollLeft, 'フォームビュー表示中のテスト前提');
        expect(before.scrollTop, 'テスト前提: フォームビュー表示中に縦スクロール位置を設定できること').toBeGreaterThan(0);

        await page.locator('.tab-button').getByText('weapon', { exact: true }).click();
        await expect(weaponViewport).toBeVisible();
        await expect(page.locator('.form-panel')).toBeVisible();
        const afterActiveTabClick = await getHorizontalScrollSnapshotAsync(weaponViewport);
        expect(afterActiveTabClick.scrollTop, `フォームビュー表示中のアクティブタブ再クリック後に縦スクロール位置が復元されていません: before=${before.scrollTop}, after=${afterActiveTabClick.scrollTop}`).toBe(before.scrollTop);
        expectHorizontalScrollApplied(afterActiveTabClick, before.scrollLeft, 'フォームビュー表示中のアクティブタブ再クリック後');

        await page.locator('#explorer .explorer-file').getByText('enemy', { exact: true }).click();
        const enemyViewport = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="enemy"] .editor-table-main-viewport');
        await expect(enemyViewport).toBeVisible();
        await expect(page.locator('.form-panel')).toHaveCount(0);

        await page.locator('.tab-button').getByText('weapon', { exact: true }).click();
        await expect(weaponViewport).toBeVisible();
        await expect(page.locator('.form-panel')).toBeVisible();
        await page.waitForTimeout(500);

        const afterClick = await getHorizontalScrollSnapshotAsync(weaponViewport);

        expect(afterClick.scrollTop, `フォームビュー復元後に縦スクロール位置が復元されていません: before=${before.scrollTop}, after=${afterClick.scrollTop}`).toBeGreaterThan(0);
        expectHorizontalScrollApplied(afterClick, before.scrollLeft, 'フォームビューのタブクリック復帰後');

        await page.locator('.tab-button').getByText('enemy', { exact: true }).click();
        await expect(enemyViewport).toBeVisible();
        await expect(page.locator('.form-panel')).toHaveCount(0);

        await page.evaluate(() => { history.back(); });
        await expect(weaponViewport).toBeVisible();
        await expect(page.locator('.form-panel')).toBeVisible();
        await page.waitForTimeout(500);

        const afterBack = await getHorizontalScrollSnapshotAsync(weaponViewport);

        expect(afterBack.scrollTop, `フォームビューの戻る復元後に縦スクロール位置が復元されていません: before=${before.scrollTop}, after=${afterBack.scrollTop}`).toBeGreaterThan(0);
        expectHorizontalScrollApplied(afterBack, before.scrollLeft, 'フォームビューの戻る復帰後');

        await page.evaluate(() => { history.back(); });
        await expect(enemyViewport).toBeVisible();
        await expect(page.locator('.form-panel')).toHaveCount(0);

        await page.evaluate(() => { history.forward(); });
        await expect(weaponViewport).toBeVisible();
        await expect(page.locator('.form-panel')).toBeVisible();
        await page.waitForTimeout(500);

        const afterForward = await getHorizontalScrollSnapshotAsync(weaponViewport);

        expect(afterForward.scrollTop, `フォームビューの進む復元後に縦スクロール位置が復元されていません: before=${before.scrollTop}, after=${afterForward.scrollTop}`).toBeGreaterThan(0);
        expectHorizontalScrollApplied(afterForward, before.scrollLeft, 'フォームビューの進む復帰後');
        expect(pageErrors, '未キャッチ例外が発生していないこと').toHaveLength(0);
    });
});
