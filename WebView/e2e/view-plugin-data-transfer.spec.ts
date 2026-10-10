import {test, expect} from './fixtures/test';
import type {Page, Locator} from '@playwright/test';
import type {EditorAPI} from '../src/editor-api/editor-api-types';
import type {ViewPluginAPI} from '../src/plugins/master-data-editor-view-plugin';
import {createDefaultFileSystem, installMockApiAsync, type MockFileSystem} from './fixtures/mock-api';

interface TransferStats {rows: number; largestMessageRows: number; rpcRows: number; messages: number;}
interface PerformanceStats {largeReads: number; copiedRows: number; heartbeatTicks: number; longestGapMs: number; timer: number;}

const LARGE_ROW_COUNT = 100000;
const syncPlugin = `window.masterDataEditor.registerViewPlugin({
    id: 'probe', apiVersion: 2, title: 'Data Probe',
    render(container, api) {
        container.classList.add('data-probe');
        container.textContent = '同期データの確認';
        const selected = api.events.onRowSelected(event => { container.dataset.selected = String(event.rowIndex); });
        return {dispose: () => selected.dispose()};
    }
});`;

function createFileSystem(code: string): MockFileSystem {
    const fs = createDefaultFileSystem();
    fs['plugins/views/probe.js'] = code;
    return fs;
}

/** 全配列を走査・文字列化せず、実際にiframeへ届いた行配列の長さだけを集計する。 */
async function installTransferProbeAsync(page: Page): Promise<void> {
    await page.addInitScript(() => {
        if (window === window.top) return;
        const stats = {rows: 0, largestMessageRows: 0, rpcRows: 0, messages: 0};
        (window as unknown as {__viewTransfer: TransferStats}).__viewTransfer = stats;
        function countRows(value: unknown, depth: number): number {
            if (depth === 0 || typeof value !== 'object' || value === null || Array.isArray(value)) return 0;
            let count = 0;
            for (const [name, child] of Object.entries(value)) {
                if (name === 'rows' && Array.isArray(child)) count += child.length;
                else count += countRows(child, depth - 1);
            }
            return count;
        }
        window.addEventListener('message', event => {
            if (event.source !== parent || typeof event.data !== 'object' || event.data === null) return;
            const rows = countRows(event.data, 8);
            stats.rows += rows;
            stats.largestMessageRows = Math.max(stats.largestMessageRows, rows);
            if (event.data.type === 'rpcResult') stats.rpcRows += rows;
            stats.messages++;
        });
    });
}

async function readTransferStatsAsync(body: Locator): Promise<TransferStats> {
    return body.evaluate(element => (element.ownerDocument.defaultView as unknown as {__viewTransfer: TransferStats}).__viewTransfer);
}

async function readRowsAsync(body: Locator): Promise<string[][] | null> {
    return body.evaluate(element => (element.ownerDocument.defaultView as unknown as {masterDataEditor: {api: ViewPluginAPI}}).masterDataEditor.api.data.getRows('test'));
}

test('無関係な10万行が常駐していても100件の参照表示RPCで全データを繰り返し転送しない', async ({page}) => {
    test.setTimeout(60000);
    const fs = createFileSystem(`window.masterDataEditor.registerViewPlugin({
        id: 'probe', apiVersion: 2, title: 'Data Probe',
        async render(container, api) {
            container.classList.add('data-probe');
            const initialRows = api.data.getRows('large');
            container.dataset.initialCount = String(api.data.getRowCount('large'));
            container.dataset.initialRows = String(initialRows === null ? -1 : initialRows.length);
            container.dataset.initialLast = initialRows === null ? '' : initialRows[initialRows.length - 1][1];
            container.dataset.initialHeader = (api.data.getHeader('large') || []).join(',');
            container.dataset.initialNamed = String(api.data.getTableNames().includes('large'));
            container.dataset.beforeLate = String(api.data.getRows('late') === null);
            await api.data.readTableDataAsync('late');
            container.dataset.afterLate = String(api.data.getRowCount('late'));
            await api.tables.get('late_records').readRecordsAsync();
            container.dataset.afterRecords = String(api.data.getRowCount('late_records'));
            const names = await Promise.all(Array.from({length: 100}, (_, index) =>
                api.data.getReferenceDisplayTextAsync('product', 'lookup_id', '', String(index + 1))));
            container.dataset.referenceCount = String(names.filter(value => value !== null).length);
            container.textContent = names.map(value => value === null ? '?' : value.displayText).join(' / ');
            container.dataset.ready = 'yes';
        }
    });`);
    fs['schema/lookup.json'] = JSON.stringify({header: [{key: 0, name: 'id', type: 'int'}, {key: 1, name: 'ja', type: 'string'}], primary_key: ['id']});
    fs['schema/product.json'] = JSON.stringify({header: [{key: 0, name: 'id', type: 'int'}, {key: 1, name: 'lookup_id', type: 'int', reference: 'lookup.id'}], primary_key: ['id']});
    fs['data/lookup.csv'] = 'id,ja\n' + Array.from({length: 100}, (_, index) => `${index + 1},商品${index + 1}`).join('\n');
    fs['data/product.csv'] = 'id,lookup_id\n' + Array.from({length: 100}, (_, index) => `${index + 1},${index + 1}`).join('\n');
    // schemaへ登録せず、Viewが初めて非同期APIを呼んだ時にストアへ入る表。
    fs['data/late.csv'] = 'id,name\n1,late_a\n2,late_b';
    fs['data/late_records.csv'] = 'id,name\n1,record_a\n2,record_b';
    await installMockApiAsync(page, fs, true);
    await installTransferProbeAsync(page);
    await page.goto('/');
    await page.locator('.activity-bar-item[data-panel="views"]').click();
    await expect(page.locator('.view-plugin-item[data-plugin-id="probe"]')).toBeVisible();

    await page.evaluate(async rowCount => {
        const target = window as unknown as {editorApi: EditorAPI; __mockFs: MockFileSystem; __viewPerformance: PerformanceStats};
        // mockFsの保存容量を増やさず実ストアを大きくする。準備時間はView表示の計測から除外する。
        target.__mockFs['data/large.csv'] = 'id,payload\n' + Array.from({length: rowCount}, (_, index) => `${index},unrelated_${index}`).join('\n');
        try { await target.editorApi.data.readTableDataAsync('large'); }
        finally { delete target.__mockFs['data/large.csv']; }
        if (target.editorApi.data.getRowCount('large') !== rowCount) throw new Error('大容量テーブルを常駐できませんでした');
        const stats: PerformanceStats = {largeReads: 0, copiedRows: 0, heartbeatTicks: 0, longestGapMs: 0, timer: 0};
        const original = target.editorApi.data.getRows.bind(target.editorApi.data);
        target.editorApi.data.getRows = name => {
            const rows = original(name);
            if (name === 'large') { stats.largeReads++; stats.copiedRows += rows === null ? 0 : rows.length; }
            return rows;
        };
        let previous = performance.now();
        stats.timer = window.setInterval(() => {
            const now = performance.now();
            stats.longestGapMs = Math.max(stats.longestGapMs, now - previous);
            stats.heartbeatTicks++;
            previous = now;
        }, 16);
        target.__viewPerformance = stats;
    }, LARGE_ROW_COUNT);

    // 登録の検出だけで大表の内容を読む必要はない。
    await page.locator('.view-plugin-reload-button').click();
    await expect(page.locator('.view-plugin-reload-button')).toBeEnabled();
    const registrationCopies = await page.evaluate(() => (window as unknown as {__viewPerformance: PerformanceStats}).__viewPerformance.copiedRows);
    await page.locator('.view-plugin-item[data-plugin-id="probe"]').click();
    const body = page.frameLocator('.view-plugin-tab-root[data-view-plugin-id="probe"] iframe').locator('body');
    const root = body.locator('.data-probe');
    await expect(root).toHaveAttribute('data-ready', 'yes', {timeout: 20000});
    await expect(root).toHaveAttribute('data-reference-count', '100');
    await expect(root).toHaveAttribute('data-initial-count', String(LARGE_ROW_COUNT));
    await expect(root).toHaveAttribute('data-initial-rows', String(LARGE_ROW_COUNT));
    await expect(root).toHaveAttribute('data-initial-last', 'unrelated_99999');
    await expect(root).toHaveAttribute('data-initial-header', 'id,payload');
    await expect(root).toHaveAttribute('data-initial-named', 'true');
    await expect(root).toHaveAttribute('data-before-late', 'true');
    await expect(root).toHaveAttribute('data-after-late', '2');
    await expect(root).toHaveAttribute('data-after-records', '2');

    const transfer = await readTransferStatsAsync(body);
    const performanceStats = await page.evaluate(() => {
        const stats = (window as unknown as {__viewPerformance: PerformanceStats}).__viewPerformance;
        clearInterval(stats.timer);
        return stats;
    });
    console.log('[View transfer]', {registrationCopies, ...performanceStats, ...transfer});
    // 描画だけでなく転送量を制約し、速いマシンで偶然成功する全件コピーを見逃さない。
    expect(registrationCopies).toBe(0);
    expect(performanceStats.largeReads).toBeLessThanOrEqual(1);
    expect(performanceStats.copiedRows).toBeLessThanOrEqual(LARGE_ROW_COUNT);
    expect(transfer.rows).toBeLessThanOrEqual(LARGE_ROW_COUNT + 1000);
    expect(transfer.rpcRows).toBeLessThan(1000);
    expect(transfer.largestMessageRows).toBeLessThan(LARGE_ROW_COUNT);
});

test('同期データAPIがGUI編集とUndoRedoと行の追加削除に追従する', async ({page}) => {
    await installMockApiAsync(page, createFileSystem(syncPlugin), true);
    await page.goto('/');
    await page.locator('.activity-bar-item[data-panel="views"]').click();
    await page.locator('.view-plugin-item[data-plugin-id="probe"]').click();
    const body = page.frameLocator('.view-plugin-tab-root[data-view-plugin-id="probe"] iframe').locator('body');
    await expect(body.locator('.data-probe')).toBeVisible();
    await expect.poll(() => readRowsAsync(body)).toEqual([['1', 'item_a', '100'], ['2', 'item_b', '200'], ['3', 'item_c', '300']]);
    // 利用側が表示用に並べ替えても、以後のrowIndex差分が別レコードに適用されない。
    await body.evaluate(element => {
        const api = (element.ownerDocument.defaultView as unknown as {masterDataEditor: {api: ViewPluginAPI}}).masterDataEditor.api;
        const rows = api.data.getRows('test');
        if (rows === null) throw new Error('同期データがありません');
        rows.reverse();
        rows[0][1] = 'plugin-local';
        api.data.getHeader('test')?.reverse();
    });
    await expect.poll(() => readRowsAsync(body)).toEqual([['1', 'item_a', '100'], ['2', 'item_b', '200'], ['3', 'item_c', '300']]);

    await page.locator('.activity-bar-item[data-panel="files"]').click();
    await page.locator('#explorer .explorer-file-name', {hasText: /^test$/}).click();
    const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="test"] .editor-table');
    await expect(table).toBeVisible();
    const nameCell = table.locator('.editor-table-row').first().locator('.editor-table-cell:not(.editor-table-row-header)').nth(1);
    await nameCell.dblclick();
    await expect(page.locator('.grid-textfield-active')).toBeVisible();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText('edited');
    await page.keyboard.press('Enter');
    await expect.poll(() => readRowsAsync(body)).toEqual([['1', 'edited', '100'], ['2', 'item_b', '200'], ['3', 'item_c', '300']]);
    await page.keyboard.press('Control+z');
    await expect.poll(() => readRowsAsync(body)).toEqual([['1', 'item_a', '100'], ['2', 'item_b', '200'], ['3', 'item_c', '300']]);
    await page.keyboard.press('Control+y');
    await expect.poll(() => readRowsAsync(body)).toEqual([['1', 'edited', '100'], ['2', 'item_b', '200'], ['3', 'item_c', '300']]);

    await table.locator('.editor-table-row-header').nth(1).click({button: 'right'});
    await page.locator('.context-menu.visible .context-menu-item', {hasText: '上に行を挿入'}).click();
    await expect.poll(() => readRowsAsync(body)).toEqual([['1', 'edited', '100'], ['', '', ''], ['2', 'item_b', '200'], ['3', 'item_c', '300']]);
    await table.locator('.editor-table-row-header').nth(1).click({button: 'right'});
    await page.locator('.context-menu.visible .context-menu-item', {hasText: '行を削除'}).click();
    await expect.poll(() => readRowsAsync(body)).toEqual([['1', 'edited', '100'], ['2', 'item_b', '200'], ['3', 'item_c', '300']]);
});

test('行選択とテーマ変更では未変更のテーブル行を再転送しない', async ({page}) => {
    await installMockApiAsync(page, createFileSystem(syncPlugin), true);
    await installTransferProbeAsync(page);
    await page.goto('/');
    await page.locator('.activity-bar-item[data-panel="views"]').click();
    await page.locator('.view-plugin-item[data-plugin-id="probe"]').click();
    const body = page.frameLocator('.view-plugin-tab-root[data-view-plugin-id="probe"] iframe').locator('body');
    const root = body.locator('.data-probe');
    await expect(root).toBeVisible();
    await page.locator('.activity-bar-item[data-panel="files"]').click();
    await page.locator('#explorer .explorer-file-name', {hasText: /^test$/}).click();
    const table = page.locator('.editor-left-pane .tab-wrapper[data-tab-name="test"] .editor-table');
    await expect(table).toBeVisible();
    const before = await readTransferStatsAsync(body);
    await table.locator('.editor-table-row').nth(1).locator('.editor-table-cell:not(.editor-table-row-header)').first().click();
    await expect(root).toHaveAttribute('data-selected', '1');
    await page.evaluate(() => { document.body.dataset.theme = 'light'; });
    const color = await page.locator('body').evaluate(element => getComputedStyle(element).getPropertyValue('--background-color').trim());
    await expect.poll(() => body.evaluate(element => getComputedStyle(element).getPropertyValue('--background-color').trim())).toBe(color);
    expect((await readTransferStatsAsync(body)).rows - before.rows).toBe(0);
});

test('Viewの起動がタイムアウトしたらiframeを回収してエラーを通知する', async ({page}) => {
    const fs = createFileSystem(`window.masterDataEditor.registerViewPlugin({
        id: 'probe', apiVersion: 2, title: 'Data Probe',
        async render(container) {
            container.classList.add('waiting-probe');
            container.textContent = '起動待機中';
            await new Promise(() => {});
        }
    });`);
    await installMockApiAsync(page, fs, true);
    await page.goto('/');
    await page.locator('.activity-bar-item[data-panel="views"]').click();
    await expect(page.locator('.view-plugin-item[data-plugin-id="probe"]')).toBeVisible();
    await page.clock.install();
    await page.locator('.view-plugin-item[data-plugin-id="probe"]').click();
    await expect(page.frameLocator('.view-plugin-tab-root[data-view-plugin-id="probe"] iframe').locator('.waiting-probe')).toBeVisible();
    await page.clock.fastForward(15001);
    await expect(page.locator('.view-plugin-tab-root[data-view-plugin-id="probe"] iframe')).toHaveCount(0);
    await expect(page.locator('.notification-toast-error')).toContainText('タイムアウト');
});

for (const action of ['edit', 'revoke'] as const) {
    test(action === 'edit' ? '初期転送中のセル編集と行挿入削除を完全な同期データとして公開する' : '初期転送中の信頼解除でiframeと残りの転送を破棄する', async ({page}) => {
        const rowCount = 20000;
        const fs = createFileSystem(syncPlugin);
        fs['data/test.csv'] = 'id,name,value\n' + Array.from({length: rowCount}, (_, index) => `${index + 1},item_${index + 1},${index}`).join('\n');
        await installMockApiAsync(page, fs, true);
        // 最初のchunk受信そのものをトリガーにし、固定時間待ちで転送との競合を作らない。
        await page.addInitScript(() => {
            if (window === window.top) return;
            let first = true;
            window.addEventListener('message', event => {
                if (event.source !== parent || event.data?.type !== 'tableRows' || event.data.tableName !== 'test') return;
                const api = (window as unknown as {masterDataEditor: {api: ViewPluginAPI}}).masterDataEditor.api;
                parent.postMessage({type: 'test-transfer-chunk', first, rows: event.data.rows.length, published: api.data.getRowCount('test')}, '*');
                first = false;
            });
        });
        await page.goto('/');
        await page.locator('#explorer .explorer-file-name', {hasText: /^test$/}).click();
        await expect(page.locator('.editor-left-pane .tab-wrapper[data-tab-name="test"] .editor-table')).toBeVisible();
        await page.evaluate(operation => {
            const target = window as unknown as {editorApi: EditorAPI; __changeWorkspaceTrustForTest(value: boolean): void; __chunkProbe: {rows: number; triggered: boolean; published: number | null; succeeded: boolean}};
            const stats = {rows: 0, triggered: false, published: null as number | null, succeeded: false};
            target.__chunkProbe = stats;
            window.addEventListener('message', event => {
                if (event.data?.type !== 'test-transfer-chunk') return;
                stats.rows += event.data.rows;
                if (!event.data.first || stats.triggered) return;
                stats.triggered = true;
                stats.published = event.data.published;
                if (operation === 'revoke') {
                    target.__changeWorkspaceTrustForTest(false);
                    stats.succeeded = true;
                } else {
                    const api = target.editorApi.edit;
                    const edited = api.setCellValue('test', 0, 1, 'during-transfer');
                    const inserted = api.insertRow('test', 1);
                    const removed = api.deleteRow('test', 3);
                    stats.succeeded = edited && inserted && removed;
                }
            });
        }, action);
        await page.locator('.activity-bar-item[data-panel="views"]').click();
        await page.locator('.view-plugin-item[data-plugin-id="probe"]').click();
        await expect.poll(() => page.evaluate(() => (window as unknown as {__chunkProbe: {succeeded: boolean}}).__chunkProbe.succeeded)).toBe(true);
        const stats = await page.evaluate(() => (window as unknown as {__chunkProbe: {rows: number; published: number | null}}).__chunkProbe);
        expect(stats.published).toBeNull(); // staging中の不完全な表を同期APIから見せない。
        if (action === 'revoke') {
            await expect(page.locator('.view-plugin-tab-root iframe')).toHaveCount(0);
            expect(stats.rows).toBeLessThan(rowCount);
            const stoppedRows = await page.evaluate(async () => {
                await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
                return (window as unknown as {__chunkProbe: {rows: number}}).__chunkProbe.rows;
            });
            expect(stoppedRows).toBe(stats.rows);
        } else {
            const body = page.frameLocator('.view-plugin-tab-root[data-view-plugin-id="probe"] iframe').locator('body');
            // ホスト同期編集APIは通常表へフォーカスを戻すため、非表示でも起動完了と同期内容を検証する。
            await expect(body.locator('.data-probe')).toBeAttached();
            const rows = await readRowsAsync(body);
            expect(rows).not.toBeNull();
            expect(rows!.length).toBe(rowCount);
            expect(rows!.slice(0, 4)).toEqual([['1', 'during-transfer', '0'], ['', '', ''], ['2', 'item_2', '1'], ['4', 'item_4', '3']]);
            expect(rows![rowCount - 1]).toEqual(['20000', 'item_20000', '19999']);
        }
    });
}
