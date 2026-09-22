import {test, expect} from './fixtures/test';
import type {Page} from '@playwright/test';
import {createDefaultFileSystem, installMockApiAsync, readMockFileAsync} from './fixtures/mock-api';
import {isRowActiveAtExportTime, parseTemporalValue, resolveExportWindowColumns} from '../src/core/export-window';

const TIME = '2026-09-22T12:00:00';
const TARGET_TIME = '2027-06-01T12:00:00';
const LEFT = '1111111';
const RIGHT = '2222222';
const HEADER = ['id', 'name', 'value', 'available_from', 'available_until'];
const SCHEMA = JSON.stringify({header: HEADER.map((name, key) => ({key, name, type: key === 0 || key === 2 ? 'int' : 'string'})), primary_key: ['id']});
const FILES = [
    {tableName: 'active', path: 'data/active.csv', status: 'M'},
    {tableName: 'outside', path: 'data/outside.csv', status: 'M'},
    {tableName: 'added', path: 'data/added.csv', status: 'A'},
    {tableName: 'deleted', path: 'data/deleted.csv', status: 'D'},
    {tableName: 'plain', path: 'data/plain.csv', status: 'M'},
];

function csv(rows: string[][]): string {
    return [HEADER.join(','), ...rows.map(row => row.join(','))].join('\n');
}

async function installPageAsync(page: Page, time: string, currentTime = ''): Promise<void> {
    const leftRows = [
        ['1', 'outside-old', '100', '2027-01-01', ''],
        ['1', 'before', '100', '2026-01-01', '2026-12-31'],
        ['2', 'ends-now', '200', '', TIME],
        ['3', 'future-old', '300', '2027-01-01', ''],
        ['4', 'unchanged', '400', '', ''],
    ];
    const rightRows = [
        ['1', 'outside-new', '100', '2027-01-01', ''],
        ['1', 'after', '150', '2026-01-01', '2026-12-31'],
        ['2', 'future-new', '200', '2027-01-01', ''],
        ['3', 'begins-now', '300', TIME, ''],
        ['4', 'unchanged', '400', '', ''],
    ];
    const reorderedColumns = [4, 1, 0, 2, 3];
    const commits: Record<string, Record<string, string>> = {[LEFT]: {}, [RIGHT]: {}};
    for (const file of FILES) {
        for (const commit of [LEFT, RIGHT]) commits[commit]['schema/' + file.tableName + '.json'] = SCHEMA;
    }
    Object.assign(commits[LEFT], {
        '.masterdataeditor/settings.json': JSON.stringify({exportValidationDateTime: time}),
        'data/active.csv': csv(leftRows),
        'data/outside.csv': csv([['1', 'outside-before', '1', '2027-01-01', '']]),
        'data/deleted.csv': csv([['1', 'deleted-active', '1', '', TIME]]),
        'data/plain.csv': 'id,name,value\n1,plain-before,1',
    });
    Object.assign(commits[RIGHT], {
        '.masterdataeditor/settings.json': JSON.stringify({exportValidationDateTime: TARGET_TIME}),
        'data/active.csv': [reorderedColumns.map(index => HEADER[index]).join(','), ...rightRows.map(row => reorderedColumns.map(index => row[index]).join(','))].join('\n'),
        'data/outside.csv': csv([['1', 'outside-after', '1', '2027-01-01', '']]),
        'data/added.csv': csv([['1', 'added-future', '1', '2027-01-01', '']]),
        'data/plain.csv': 'id,name,value\n1,plain-after,1',
    });
    const fs = createDefaultFileSystem();
    fs['.masterdataeditor/settings.json'] = JSON.stringify({exportValidationDateTime: currentTime, exportBeginDateColumnName: 'available_from', exportEndDateColumnName: 'available_until'});
    for (const file of FILES) {
        fs['schema/' + file.tableName + '.json'] = SCHEMA;
        fs[file.path] = commits[RIGHT][file.path] ?? commits[LEFT][file.path];
    }
    await page.addInitScript(({commits, files, left, right}) => {
        Object.assign(window, {
            __mockGitBranches: [{name: 'main', ref: 'refs/heads/main', kind: 'local'}, {name: 'feature', ref: 'refs/heads/feature', kind: 'local'}],
            __mockGitBranchListError: null,
            __mockGitBranchListDelayMs: 0,
            __mockGitBranchCompare: {leftCommit: left, rightCommit: right, files},
            __mockGitBranchCompareError: null,
            __mockGitBranchCompareDelayMs: 0,
            __mockGitCommitFiles: commits,
            __mockGitShowAtCommitDelays: {},
            __mockGitCellBlame: {[right]: {'data/active.csv': [{lineNumber: 3, columnName: 'name', author: '出力担当', date: '2026-09-22', commitHash: right, commitMessage: '公開行を更新'}]}},
        });
    }, {commits, files: FILES, left: LEFT, right: RIGHT});
    await installMockApiAsync(page, fs);
    await page.goto('/');
    await page.locator('[data-panel="branchCompare"]').click();
}

async function compareAsync(page: Page, filtered: boolean): Promise<void> {
    await page.getByRole('checkbox', {name: '出力時刻でフィルタ', exact: true}).setChecked(filtered);
    await page.locator('.branch-compare-base-input').fill('main');
    await page.locator('.branch-compare-target-input').fill('feature');
    await page.locator('.branch-compare-button').click();
    await expect(page.locator('.branch-compare-results')).toHaveAttribute('aria-busy', 'false');
}

const names = (page: Page) => page.locator('.branch-compare-file-item:visible .branch-compare-file-name');

test('出力期間は両端を含み、空欄は無期限、不正な期間は対象外、期間列のないテーブルは全行を扱う', () => {
    const time = parseTemporalValue(TIME);
    if (time.kind !== 'valid') throw new Error('テストの時刻が不正です');
    const columns = resolveExportWindowColumns(['start', 'end'], 'start', 'end');
    for (const [begin, end, active] of [
        ['', '', true], [TIME, '', true], ['', TIME, true], [TIME, TIME, true],
        ['2026-09-22T12:00:01', '', false], ['', '2026-09-22T11:59:59', false],
        ['invalid', '', false], ['2027-01-01', '2026-01-01', false],
    ] as const) expect(isRowActiveAtExportTime([begin, end], columns, time.ms)).toBe(active);
    expect(isRowActiveAtExportTime(['value'], resolveExportWindowColumns(['name'], 'start', 'end'), time.ms)).toBe(true);
});

test('出力時刻の差分が残るテーブルだけ表示し、左右を独立して絞り込み元CSVの履歴行を維持する', async ({page}) => {
    await installPageAsync(page, TIME);
    await compareAsync(page, true);
    await expect(names(page)).toHaveText(['active', 'deleted', 'plain']);
    await page.locator('.branch-compare-file-item').filter({hasText: 'active'}).click();
    const diff = page.locator('.diff-tab:visible');
    await expect(diff).toBeVisible();
    await expect(diff.locator('.diff-pane-left')).toContainText('before');
    await expect(diff.locator('.diff-pane-right')).toContainText('after');
    await expect(diff.locator('.diff-pane-left')).toContainText('ends-now');
    await expect(diff.locator('.diff-pane-right')).toContainText('begins-now');
    await expect(diff).not.toContainText('outside-');
    await expect(diff).not.toContainText('future-');
    await expect(diff.locator('.diff-pane-left .editor-table-row')).toHaveCount(4);
    await expect(diff.locator('.diff-pane-right .editor-table-row')).toHaveCount(4);
    await diff.locator('.diff-pane-right .editor-table-cell').filter({hasText: /^after$/}).hover();
    await expect(page.locator('.branch-compare-cell-tooltip:visible')).toContainText('元CSV 3行');
    await expect(page.locator('.branch-compare-cell-tooltip:visible')).toContainText('出力担当');
});

test('通常比較からモードを切り替えると自動再比較し、名前フィルタとクリアを併用できる', async ({page}) => {
    await installPageAsync(page, TIME);
    await compareAsync(page, false);
    await expect(names(page)).toHaveCount(5);
    const mode = page.getByRole('checkbox', {name: '出力時刻でフィルタ'});
    await mode.check();
    await expect(names(page)).toHaveText(['active', 'deleted', 'plain']);
    await page.getByRole('textbox', {name: 'テーブル名でフィルタ', exact: true}).fill('active');
    await expect(names(page)).toHaveText(['active']);
    await expect(names(page).locator('.search-highlight')).toHaveText('active');
    await mode.uncheck();
    await expect(page.locator('.branch-compare-file-item')).toHaveCount(5);
    await expect(names(page)).toHaveText(['active']);
    await page.getByRole('button', {name: 'テーブル名フィルタをクリア'}).click();
    await expect(names(page)).toHaveCount(5);
});

test('比較元の時刻が未設定なら案内を表示し、比較先の時刻と通常比較に切り替えられる', async ({page}) => {
    await installPageAsync(page, '');
    await compareAsync(page, true);
    const mode = page.getByRole('checkbox', {name: '出力時刻でフィルタ'});
    await expect(names(page)).toHaveCount(0);
    await expect(page.locator('.branch-compare-export-filter-summary')).toContainText('比較元のリビジョンに有効な出力フィルター時刻が設定されていません');
    await page.getByRole('combobox', {name: '出力時刻の取得元', exact: true}).selectOption('target');
    await page.locator('.branch-compare-button').click();
    await expect(names(page)).toHaveText(['active', 'outside', 'added', 'plain']);
    await mode.uncheck();
    await expect(names(page)).toHaveCount(5);
    await expect(page.locator('.branch-compare-button')).toBeEnabled();
});

test('出力比較モードと開いたタブの時刻を保存し、再起動しても絞り込みを復元する', async ({page}) => {
    await installPageAsync(page, TIME);
    await compareAsync(page, true);
    await expect(names(page)).toHaveText(['active', 'deleted', 'plain']);
    await page.locator('.branch-compare-file-item').filter({hasText: 'active'}).click();
    await expect(page.locator('.diff-tab:visible')).toBeVisible();
    await expect.poll(async () => {
        const raw = await readMockFileAsync(page, 'user:ui-state.json');
        if (typeof raw !== 'string') return null;
        const state = JSON.parse(raw);
        return {mode: state.sidebar.branchCompare.exportFilterEnabled, filter: state.tabs.open.find((tab: {diff?: {exportFilter?: object}}) => tab.diff?.exportFilter)?.diff.exportFilter};
    }).toEqual({mode: true, filter: {dateTime: TIME, beginColumnName: 'available_from', endColumnName: 'available_until'}});
    await page.reload();
    await expect(page.getByRole('checkbox', {name: '出力時刻でフィルタ'})).toBeChecked();
    await expect(names(page)).toHaveText(['active', 'deleted', 'plain']);
    await expect(page.locator('.diff-tab:visible')).toContainText('after');
    await expect(page.locator('.diff-tab:visible')).not.toContainText('outside-');
});

test('取得元は比較元が初期値で、比較先に切り替えると再比較し、作業中の設定時刻には影響されない', async ({page}) => {
    await installPageAsync(page, TIME);
    await compareAsync(page, true);
    const source = page.getByRole('combobox', {name: '出力時刻の取得元', exact: true});
    await expect(source).toHaveValue('base');
    await expect(names(page)).toHaveText(['active', 'deleted', 'plain']);
    await page.locator('.branch-compare-file-item').filter({hasText: 'active'}).click();
    await expect(page.locator('.diff-tab:visible')).toBeVisible();
    await page.locator('.activity-bar-settings').click();
    await page.locator('.settings-scope-tab[data-scope="workspace"]').click();
    const input = page.locator('.settings-export-validation-datetime-input');
    await input.fill('2028-01-01T12:00:00');
    await input.blur();
    await expect(page.locator('.branch-compare-export-filter-summary')).toContainText('2026-09-22');
    await expect(names(page)).toHaveText(['active', 'deleted', 'plain']);
    await source.selectOption('target');
    await expect(names(page)).toHaveText(['active', 'outside', 'added', 'plain']);
    await expect(page.locator('.branch-compare-export-filter-summary')).toContainText('2027-06-01');
    await page.locator('.tab-button').filter({hasText: '[出力 ' + TIME + ']'}).click();
    await expect(page.locator('.diff-tab:visible')).toContainText('after');
    await expect(page.locator('.diff-tab:visible')).not.toContainText('outside-');
    await expect(page.locator('.branch-compare-file-item-active')).toHaveCount(0);
    await page.locator('.branch-compare-file-item').filter({hasText: 'active'}).click();
    await expect(page.locator('.diff-tab:visible')).toContainText('outside-new');
    await expect(page.locator('.diff-tab:visible')).not.toContainText('after');
    await expect.poll(async () => {
        const raw = await readMockFileAsync(page, 'user:ui-state.json');
        return typeof raw === 'string' ? JSON.parse(raw).sidebar.branchCompare.exportFilterSource : null;
    }).toBe('target');
    await page.reload();
    await expect(source).toHaveValue('target');
    await expect(names(page)).toHaveText(['active', 'outside', 'added', 'plain']);
    await expect(page.locator('.branch-compare-export-filter-summary')).toContainText('2027-06-01');
});

test('現在の設定を選ぶと設定時刻で再比較し、時刻変更を反映して選択を復元する', async ({page}) => {
    await installPageAsync(page, TIME, TARGET_TIME);
    await compareAsync(page, true);
    await expect(names(page)).toHaveText(['active', 'deleted', 'plain']);
    await page.evaluate(() => {
        const mock = window as unknown as {__mockGitCommitFiles: Record<string, Record<string, string>>};
        for (const files of Object.values(mock.__mockGitCommitFiles)) delete files['.masterdataeditor/settings.json'];
    });
    const source = page.getByRole('combobox', {name: '出力時刻の取得元', exact: true});
    await source.selectOption({label: '現在の設定'});
    await expect(names(page)).toHaveText(['active', 'outside', 'added', 'plain']);
    await expect(page.locator('.branch-compare-export-filter-summary')).toContainText('2027-06-01');
    await page.locator('.branch-compare-file-item').filter({hasText: 'active'}).click();
    await expect(page.locator('.diff-tab:visible')).toContainText('outside-new');
    await page.locator('.activity-bar-settings').click();
    await page.locator('.settings-scope-tab[data-scope="workspace"]').click();
    const input = page.locator('.settings-export-validation-datetime-input');
    await input.fill(TIME);
    await input.blur();
    await expect(names(page)).toHaveText(['active', 'deleted', 'plain']);
    await expect(page.locator('.branch-compare-export-filter-summary')).toContainText('2026-09-22');
    await page.locator('.tab-button').filter({hasText: '[出力 ' + TARGET_TIME + ']'}).click();
    await expect(page.locator('.diff-tab:visible')).toContainText('outside-new');
    await expect(page.locator('.branch-compare-file-item-active')).toHaveCount(0);
    await expect.poll(async () => {
        const raw = await readMockFileAsync(page, 'user:ui-state.json');
        return typeof raw === 'string' ? JSON.parse(raw).sidebar.branchCompare.exportFilterSource : null;
    }).toBe('current');
    await page.reload();
    await expect(source).toHaveValue('current');
    await expect(names(page)).toHaveText(['active', 'deleted', 'plain']);
    await expect(page.locator('.branch-compare-export-filter-summary')).toContainText('2026-09-22');
    await expect(page.locator('.notification-toast-error')).toHaveCount(0);
});

test('現在の設定の時刻が空欄なら案内し、設定すると比較できる', async ({page}) => {
    await installPageAsync(page, TIME);
    await page.getByRole('checkbox', {name: '出力時刻でフィルタ'}).check();
    const source = page.getByRole('combobox', {name: '出力時刻の取得元', exact: true});
    await source.selectOption('current');
    await page.locator('.branch-compare-base-input').fill('main');
    await page.locator('.branch-compare-target-input').fill('feature');
    await expect(page.locator('.branch-compare-button')).toBeDisabled();
    await expect(page.locator('.branch-compare-export-filter-summary')).toContainText('設定画面で出力フィルター時刻を設定してください');
    await source.selectOption('base');
    await expect(page.locator('.branch-compare-button')).toBeEnabled();
    await source.selectOption('current');
    await page.locator('.activity-bar-settings').click();
    await page.locator('.settings-scope-tab[data-scope="workspace"]').click();
    const input = page.locator('.settings-export-validation-datetime-input');
    await input.fill(TIME);
    await input.blur();
    await expect(page.locator('.branch-compare-button')).toBeEnabled();
    await page.locator('.branch-compare-button').click();
    await expect(names(page)).toHaveText(['active', 'deleted', 'plain']);
});

test('入れ替え後は選択した側の新しいリビジョンから時刻を取得する', async ({page}) => {
    await installPageAsync(page, TIME);
    await compareAsync(page, true);
    await page.evaluate(() => {
        const mock = window as unknown as {__mockGitBranchCompare: {leftCommit: string; rightCommit: string; files: {status: string}[]}};
        const result = mock.__mockGitBranchCompare;
        [result.leftCommit, result.rightCommit] = [result.rightCommit, result.leftCommit];
        for (const file of result.files) file.status = file.status === 'A' ? 'D' : file.status === 'D' ? 'A' : 'M';
    });
    await page.getByRole('button', {name: '入れ替え', exact: true}).click();
    await expect(page.getByRole('combobox', {name: '出力時刻の取得元', exact: true})).toHaveValue('base');
    await expect(page.locator('.branch-compare-export-filter-summary')).not.toContainText('2026-09-22');
    await page.locator('.branch-compare-button').click();
    await expect(names(page)).toHaveText(['active', 'outside', 'added', 'plain']);
    await expect(page.locator('.branch-compare-export-filter-summary')).toContainText('2027-06-01');
});

for (const [title, settings, message] of [
    ['ファイルなし', null, '設定ファイル（.masterdataeditor/settings.json）を読み込めませんでした'],
    ['JSON破損', '{invalid', '設定ファイルが正しいJSONではありません'],
    ['値が不正', '{"exportValidationDateTime":"invalid"}', '有効な出力フィルター時刻が設定されていません'],
] as const) {
    test('リビジョンの時刻取得エラーを明示する: ' + title, async ({page}) => {
        await installPageAsync(page, TIME);
        await page.evaluate(({left, settings}) => {
            const mock = window as unknown as {__mockGitCommitFiles: Record<string, Record<string, string>>};
            if (settings === null) delete mock.__mockGitCommitFiles[left]['.masterdataeditor/settings.json'];
            else mock.__mockGitCommitFiles[left]['.masterdataeditor/settings.json'] = settings;
        }, {left: LEFT, settings});
        await compareAsync(page, true);
        await expect(names(page)).toHaveCount(0);
        await expect(page.locator('.branch-compare-export-filter-summary')).toContainText('比較元のリビジョン');
        await expect(page.locator('.branch-compare-export-filter-summary')).toContainText(message);
    });
}

test('時刻の取得中に比較先へ切り替えても遅れて届く比較元の時刻で上書きしない', async ({page}) => {
    await installPageAsync(page, TIME);
    await compareAsync(page, false);
    await page.evaluate(() => {
        Object.assign(window, {__mockGitShowAtCommitDelays: {'1111111:.masterdataeditor/settings.json': 700}});
    });
    await page.getByRole('checkbox', {name: '出力時刻でフィルタ'}).check();
    await expect(page.locator('.branch-compare-results')).toHaveAttribute('aria-busy', 'true');
    await page.getByRole('combobox', {name: '出力時刻の取得元', exact: true}).selectOption('target');
    await expect(names(page)).toHaveText(['active', 'outside', 'added', 'plain']);
    await page.waitForTimeout(850);
    await expect(names(page)).toHaveText(['active', 'outside', 'added', 'plain']);
    await expect(page.locator('.branch-compare-export-filter-summary')).toContainText('2027-06-01');
    await expect(page.locator('.notification-toast-error')).toHaveCount(0);
});

test('出力比較中にモードを解除すると遅れて届く旧結果で一覧を上書きしない', async ({page}) => {
    await installPageAsync(page, TIME);
    await compareAsync(page, false);
    await expect(names(page)).toHaveCount(5);
    await page.evaluate(() => {
        Object.assign(window, {__mockGitShowAtCommitDelays: {'1111111:data/active.csv': 700}});
    });
    const mode = page.getByRole('checkbox', {name: '出力時刻でフィルタ'});
    await mode.check();
    await expect(page.locator('.branch-compare-results')).toHaveAttribute('aria-busy', 'true');
    await mode.uncheck();
    await expect(names(page)).toHaveCount(5);
    await page.waitForTimeout(850);
    await expect(names(page)).toHaveCount(5);
    await expect(page.locator('.notification-toast-error')).toHaveCount(0);
});

for (const changed of [false, true]) {
    test(`大規模な出力比較で元CSVの行対応を保ち、変更${changed ? 'あり' : 'なし'}を判定する`, async ({page}) => {
        await installPageAsync(page, TIME);
        await page.evaluate(({left, right, header, changed}) => {
            const mock = window as unknown as {__mockGitCommitFiles: Record<string, Record<string, string>>; __mockGitBranchCompare: {files: object[]}; __exportDiffResults: object[]};
            const rows = Array.from({length: 50005}, (_, index) => `${index},row,100,,`);
            rows[0] = '0,excluded-before,100,2027-01-01,';
            mock.__mockGitCommitFiles[left]['data/active.csv'] = header.join(',') + '\n' + rows.join('\n');
            rows[0] = '0,excluded-after,100,2027-01-01,';
            if (changed) rows[50004] = '50004,last-changed,150,,';
            mock.__mockGitCommitFiles[right]['data/active.csv'] = header.join(',') + '\n' + rows.join('\n');
            mock.__mockGitBranchCompare.files = [{path: 'data/active.csv', tableName: 'active', status: 'M'}];
            mock.__exportDiffResults = [];
            const NativeWorker = window.Worker;
            window.Worker = new Proxy(NativeWorker, {construct(Target, args) {
                const worker = Reflect.construct(Target, args) as Worker;
                worker.addEventListener('message', (event: MessageEvent) => {
                    const data = event.data.data;
                    if (data?.mode === 'indexed') mock.__exportDiffResults.push({mode: data.mode, hasChanges: data.hasChanges, first: data.rightRowSourceIndices[0], last: data.rightRowSourceIndices.at(-1)});
                });
                return worker;
            }});
        }, {left: LEFT, right: RIGHT, header: HEADER, changed});
        await compareAsync(page, true);
        await expect(names(page)).toHaveCount(changed ? 1 : 0);
        await expect.poll(() => page.evaluate(() => (window as unknown as {__exportDiffResults: object[]}).__exportDiffResults)).toEqual([{mode: 'indexed', hasChanges: changed, first: 1, last: 50004}]);
        if (!changed) await expect(page.locator('.branch-compare-empty-message:visible')).toHaveText('出力対象に差分のあるテーブルはありません');
    });
}
