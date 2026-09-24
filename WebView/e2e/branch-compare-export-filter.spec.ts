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

async function installPageAsync(page: Page, time: string, targetTime: string, currentTime: string): Promise<void> {
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
        ['2', 'between-times', '200', '2027-01-01', ''],
        ['3', 'begins-now', '300', TARGET_TIME, ''],
        ['4', 'unchanged', '400', '', ''],
    ];
    rightRows.push(['5', 'future-new', '500', '2028-01-01', '']);
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
        '.masterdataeditor/settings.json': JSON.stringify({exportValidationDateTime: targetTime}),
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
            __mockGitCellBlame: {
                [right]: {'data/active.csv': [
                    {lineNumber: 2, columnName: 'name', author: '比較先担当', date: '2027-06-01', commitHash: right, commitMessage: '比較先の公開行を更新'},
                    {lineNumber: 5, columnName: 'name', author: '比較先担当', date: '2027-06-01', commitHash: right, commitMessage: '比較先の境界行を更新'},
                ]},
            },
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

test('比較元と比較先それぞれの出力時刻で絞り込み元CSVの履歴行を維持する', async ({page}) => {
    await installPageAsync(page, TIME, TARGET_TIME, '');
    await compareAsync(page, true);
    await expect(names(page)).toHaveText(['active', 'outside', 'added', 'deleted', 'plain']);
    await expect(page.getByRole('combobox', {name: '出力時刻の取得元', exact: true})).toHaveCount(0);
    await expect(page.locator('.branch-compare-export-filter-summary')).toContainText('比較元');
    await expect(page.locator('.branch-compare-export-filter-summary')).toContainText('2026-09-22');
    await expect(page.locator('.branch-compare-export-filter-summary')).toContainText('比較先');
    await expect(page.locator('.branch-compare-export-filter-summary')).toContainText('2027-06-01');
    await page.locator('.branch-compare-file-item').filter({hasText: 'active'}).click();
    const diff = page.locator('.diff-tab:visible');
    const left = diff.locator('.diff-pane-left');
    const right = diff.locator('.diff-pane-right');
    await expect(left).toContainText('before');
    await expect(left).toContainText('ends-now');
    await expect(left).not.toContainText('outside-old');
    await expect(left).not.toContainText('future-old');
    await expect(right).toContainText('outside-new');
    await expect(right).toContainText('between-times');
    await expect(right).toContainText('begins-now');
    await expect(right.locator('.editor-table-cell').filter({hasText: /^after$/})).toHaveCount(0);
    await expect(right).not.toContainText('future-new');
    await expect(left.locator('.editor-table-row')).toHaveCount(4);
    await expect(right.locator('.editor-table-row')).toHaveCount(4);
    // 変更セルは左右どちらから確認しても、比較先の変更履歴を表示する。
    await left.locator('.editor-table-cell').filter({hasText: /^before$/}).hover();
    await expect(page.locator('.branch-compare-cell-tooltip:visible')).toContainText('元CSV 2行');
    await expect(page.locator('.branch-compare-cell-tooltip:visible')).toContainText('比較先担当');
    await right.locator('.editor-table-cell').filter({hasText: /^begins-now$/}).hover();
    await expect(page.locator('.branch-compare-cell-tooltip:visible')).toContainText('元CSV 5行');
    await expect(page.locator('.branch-compare-cell-tooltip:visible')).toContainText('比較先担当');
});

test('追加・削除テーブルと片側の全行が期間外のテーブルにも各リビジョンの出力時刻を使う', async ({page}) => {
    await installPageAsync(page, TIME, TARGET_TIME, '');
    await compareAsync(page, true);
    for (const [table, pane, included, excluded] of [
        ['outside', 'right', 'outside-after', 'outside-before'],
        ['added', 'right', 'added-future', ''],
        ['deleted', 'left', 'deleted-active', ''],
    ] as const) {
        await page.locator('.branch-compare-file-name').filter({hasText: new RegExp('^' + table + '$')}).click();
        const diff = page.locator('.diff-tab:visible');
        await expect(diff.locator('.diff-pane-' + pane)).toContainText(included);
        if (excluded !== '') await expect(diff).not.toContainText(excluded);
    }
});

test('左右が同じ出力時刻なら期間外だけに差分のあるテーブルを隠し、名前フィルタを併用できる', async ({page}) => {
    await installPageAsync(page, TIME, TIME, '');
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

test('左右とも全行が出力時刻より未来のテーブルは追加・削除も含めて表示しない', async ({page}) => {
    await installPageAsync(page, TIME, TARGET_TIME, '');
    await page.evaluate(({left, right, header}) => {
        const mock = window as unknown as {__mockGitCommitFiles: Record<string, Record<string, string>>; __mockGitBranchCompare: {files: {tableName: string; path: string; status: string}[]}};
        for (const commit of [left, right]) {
            for (const file of mock.__mockGitBranchCompare.files) {
                if ((commit === left && file.status === 'A') || (commit === right && file.status === 'D')) continue;
                mock.__mockGitCommitFiles[commit][file.path] = header.join(',') + '\n1,future-' + commit + ',100,2028-01-01,';
            }
        }
    }, {left: LEFT, right: RIGHT, header: HEADER});
    await compareAsync(page, true);
    await expect(names(page)).toHaveCount(0);
    await expect(page.locator('.branch-compare-empty-message:visible')).toHaveText('出力対象に差分のあるテーブルはありません');
});

test('出力比較モードと左右の時刻を保存し、再起動しても絞り込みを復元する', async ({page}) => {
    await installPageAsync(page, TIME, TARGET_TIME, '');
    await compareAsync(page, true);
    await page.locator('.branch-compare-file-item').filter({hasText: 'active'}).click();
    await expect(page.locator('.diff-tab:visible')).toBeVisible();
    await expect.poll(async () => {
        const raw = await readMockFileAsync(page, 'user:ui-state.json');
        if (typeof raw !== 'string') return null;
        const state = JSON.parse(raw);
        return {mode: state.sidebar.branchCompare.exportFilterEnabled, filter: state.tabs.open.find((tab: {diff?: {exportFilter?: object}}) => tab.diff?.exportFilter)?.diff.exportFilter, hasSource: 'exportFilterSource' in state.sidebar.branchCompare};
    }).toEqual({mode: true, filter: {leftDateTime: TIME, rightDateTime: TARGET_TIME, beginColumnName: 'available_from', endColumnName: 'available_until'}, hasSource: false});
    await page.reload();
    await expect(page.getByRole('checkbox', {name: '出力時刻でフィルタ'})).toBeChecked();
    await expect(names(page)).toHaveText(['active', 'outside', 'added', 'deleted', 'plain']);
    await expect(page.locator('.diff-tab:visible .diff-pane-left')).toContainText('before');
    await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('outside-new');
    await expect(page.locator('.diff-tab:visible')).not.toContainText('future-new');
});

test('作業中の設定時刻を変更しても比較一覧と開いたタブは左右のコミット時刻を維持する', async ({page}) => {
    await installPageAsync(page, TIME, TARGET_TIME, '2028-01-01T12:00:00');
    await compareAsync(page, true);
    await page.locator('.branch-compare-file-item').filter({hasText: 'active'}).click();
    await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('outside-new');
    await page.locator('.activity-bar-settings').click();
    await page.locator('.settings-scope-tab[data-scope="workspace"]').click();
    const input = page.locator('.settings-export-validation-datetime-input');
    await input.fill('2030-01-01T12:00:00');
    await input.blur();
    await expect(page.locator('.branch-compare-export-filter-summary')).toContainText('2026-09-22');
    await expect(page.locator('.branch-compare-export-filter-summary')).toContainText('2027-06-01');
    await expect(names(page)).toHaveText(['active', 'outside', 'added', 'deleted', 'plain']);
    await page.locator('.tab-button').filter({hasText: 'active'}).click();
    await expect(page.locator('.diff-tab:visible .diff-pane-left')).toContainText('before');
    await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('outside-new');
    await expect(page.locator('.diff-tab:visible')).not.toContainText('future-new');
    await expect(page.locator('.branch-compare-file-item-active')).toHaveCount(1);
    await expect(page.getByRole('combobox', {name: '出力時刻の取得元', exact: true})).toHaveCount(0);
});

test('旧形式の単一出力時刻は復元せず、比較を実行し直すと左右の時刻を使う', async ({page}) => {
    await installPageAsync(page, TIME, TARGET_TIME, '');
    await compareAsync(page, true);
    await page.locator('.branch-compare-file-item').filter({hasText: 'active'}).click();
    await expect.poll(async () => {
        const raw = await readMockFileAsync(page, 'user:ui-state.json');
        return typeof raw === 'string' && JSON.parse(raw).tabs.open.some((tab: {diff?: {exportFilter?: object}}) => tab.diff?.exportFilter);
    }).toBe(true);
    await page.evaluate(time => {
        const mock = window as unknown as {__mockFs: Record<string, string>};
        const state = JSON.parse(mock.__mockFs['user:ui-state.json']);
        state.sidebar.branchCompare.exportFilterSource = 'current';
        for (const tab of state.tabs.open) {
            if (tab.diff?.exportFilter) tab.diff.exportFilter = {dateTime: time, beginColumnName: 'available_from', endColumnName: 'available_until'};
        }
        mock.__mockFs['user:ui-state.json'] = JSON.stringify(state);
        sessionStorage.setItem('__mockFs', JSON.stringify(mock.__mockFs));
    }, TIME);
    await page.reload();
    await expect(names(page)).toHaveText(['active', 'outside', 'added', 'deleted', 'plain']);
    await expect(page.locator('.diff-tab')).toHaveCount(0);
    await expect(page.getByRole('combobox', {name: '出力時刻の取得元', exact: true})).toHaveCount(0);
    await page.locator('.branch-compare-file-item').filter({hasText: 'active'}).click();
    await expect(page.locator('.diff-tab:visible .diff-pane-left')).toContainText('before');
    await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('outside-new');
    await expect(page.locator('.notification-toast-error')).toHaveCount(0);
});

test('入れ替え後は左右それぞれの新しいリビジョンの出力時刻を使う', async ({page}) => {
    await installPageAsync(page, TIME, TARGET_TIME, '');
    await compareAsync(page, true);
    await page.evaluate(() => {
        const mock = window as unknown as {__mockGitBranchCompare: {leftCommit: string; rightCommit: string; files: {status: string}[]}};
        const result = mock.__mockGitBranchCompare;
        [result.leftCommit, result.rightCommit] = [result.rightCommit, result.leftCommit];
        for (const file of result.files) file.status = file.status === 'A' ? 'D' : file.status === 'D' ? 'A' : 'M';
    });
    await page.getByRole('button', {name: '入れ替え', exact: true}).click();
    await page.locator('.branch-compare-button').click();
    await expect(names(page)).toHaveText(['active', 'outside', 'added', 'deleted', 'plain']);
    await expect(page.locator('.branch-compare-export-filter-summary')).toContainText(/比較元.*2027-06-01[\s\S]*比較先.*2026-09-22/);
    await page.locator('.branch-compare-file-item').filter({hasText: 'active'}).click();
    await expect(page.locator('.diff-tab:visible .diff-pane-left')).toContainText('outside-new');
    await expect(page.locator('.diff-tab:visible .diff-pane-right')).toContainText('before');
    await expect(page.locator('.diff-tab:visible')).not.toContainText('future-');
    await expect.poll(async () => {
        const raw = await readMockFileAsync(page, 'user:ui-state.json');
        if (typeof raw !== 'string') return null;
        return JSON.parse(raw).tabs.open.find((tab: {diff?: {exportFilter?: object}}) => tab.diff?.exportFilter)?.diff.exportFilter;
    }).toEqual({leftDateTime: TARGET_TIME, rightDateTime: TIME, beginColumnName: 'available_from', endColumnName: 'available_until'});
});

for (const [side, commit] of [['比較元', LEFT], ['比較先', RIGHT]] as const) {
    for (const [title, settings, message] of [
        ['ファイルなし', null, '設定ファイル（.masterdataeditor/settings.json）を読み込めませんでした'],
        ['JSON破損', '{invalid', '設定ファイルが正しいJSONではありません'],
        ['値が不正', '{"exportValidationDateTime":"invalid"}', '有効な出力フィルター時刻が設定されていません'],
        ['時刻が未設定', '{"exportValidationDateTime":""}', '有効な出力フィルター時刻が設定されていません'],
    ] as const) {
        test(side + 'の時刻取得エラーを明示し通常比較に戻せる: ' + title, async ({page}) => {
            await installPageAsync(page, TIME, TARGET_TIME, TIME);
            await page.evaluate(({commit, settings}) => {
                const mock = window as unknown as {__mockGitCommitFiles: Record<string, Record<string, string>>};
                if (settings === null) delete mock.__mockGitCommitFiles[commit]['.masterdataeditor/settings.json'];
                else mock.__mockGitCommitFiles[commit]['.masterdataeditor/settings.json'] = settings;
            }, {commit, settings});
            await compareAsync(page, true);
            await expect(names(page)).toHaveCount(0);
            await expect(page.locator('.branch-compare-export-filter-summary')).toContainText(side + 'のリビジョン');
            await expect(page.locator('.branch-compare-export-filter-summary')).toContainText(message);
            await page.getByRole('checkbox', {name: '出力時刻でフィルタ'}).uncheck();
            await expect(page.locator('.branch-compare-button')).toBeEnabled();
            await page.locator('.branch-compare-button').click();
            await expect(names(page)).toHaveCount(5);
        });
    }
}

for (const [side, commit] of [['比較元', LEFT], ['比較先', RIGHT]] as const) {
    test(side + 'の時刻の取得中にモードを解除しても遅れて届く結果で上書きしない', async ({page}) => {
        await installPageAsync(page, TIME, TIME, '');
        await compareAsync(page, false);
        await page.evaluate(commit => {
            Object.assign(window, {__mockGitShowAtCommitDelays: {[commit + ':.masterdataeditor/settings.json']: 700}});
        }, commit);
        const mode = page.getByRole('checkbox', {name: '出力時刻でフィルタ'});
        await mode.check();
        await expect(page.locator('.branch-compare-results')).toHaveAttribute('aria-busy', 'true');
        await mode.uncheck();
        await expect(names(page)).toHaveCount(5);
        await page.waitForTimeout(850);
        await expect(names(page)).toHaveCount(5);
        await expect(page.locator('.branch-compare-export-filter-summary')).toBeHidden();
        await expect(page.locator('.notification-toast-error')).toHaveCount(0);
    });
}

test('出力比較中にモードを解除すると遅れて届く旧結果で一覧を上書きしない', async ({page}) => {
    await installPageAsync(page, TIME, TIME, '');
    await compareAsync(page, false);
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
    test(`大規模な出力比較で左右別の元CSVの行対応を保ち、変更${changed ? 'あり' : 'なし'}を判定する`, async ({page}) => {
        await installPageAsync(page, TIME, TARGET_TIME, '');
        await page.evaluate(({left, right, header, changed}) => {
            const mock = window as unknown as {__mockGitCommitFiles: Record<string, Record<string, string>>; __mockGitBranchCompare: {files: object[]}; __exportDiffResults: object[]};
            const rows = Array.from({length: 50005}, (_, index) => `${index},row,100,,`);
            // 左の除外行は右の時刻なら有効になる。左右の時刻を共用すると変更なし判定が崩れる。
            rows[0] = '0,excluded-before,100,2027-01-01,';
            mock.__mockGitCommitFiles[left]['data/active.csv'] = header.join(',') + '\n' + rows.join('\n');
            rows[0] = rows[1];
            rows[1] = '0,excluded-after,100,2028-01-01,';
            if (changed) rows[50004] = '50004,last-changed,150,,';
            mock.__mockGitCommitFiles[right]['data/active.csv'] = header.join(',') + '\n' + rows.join('\n');
            mock.__mockGitBranchCompare.files = [{path: 'data/active.csv', tableName: 'active', status: 'M'}];
            mock.__exportDiffResults = [];
            const NativeWorker = window.Worker;
            window.Worker = new Proxy(NativeWorker, {construct(Target, args) {
                const worker = Reflect.construct(Target, args) as Worker;
                worker.addEventListener('message', (event: MessageEvent) => {
                    const data = event.data.data;
                    if (data?.mode === 'indexed') mock.__exportDiffResults.push({mode: data.mode, hasChanges: data.hasChanges, leftFirst: data.leftRowSourceIndices[0], rightFirst: data.rightRowSourceIndices[0], leftLast: data.leftRowSourceIndices.at(-1), rightLast: data.rightRowSourceIndices.at(-1)});
                });
                return worker;
            }});
        }, {left: LEFT, right: RIGHT, header: HEADER, changed});
        await compareAsync(page, true);
        await expect(names(page)).toHaveCount(changed ? 1 : 0);
        await expect.poll(() => page.evaluate(() => (window as unknown as {__exportDiffResults: object[]}).__exportDiffResults)).toEqual([{mode: 'indexed', hasChanges: changed, leftFirst: 1, rightFirst: 0, leftLast: 50004, rightLast: 50004}]);
        if (!changed) await expect(page.locator('.branch-compare-empty-message:visible')).toHaveText('出力対象に差分のあるテーブルはありません');
    });
}


test('差分一覧は左右の固定出力時刻で絞り込み、列順と元行番号を保ち再起動後も同じ条件を表示する', async ({page}) => {
    await installPageAsync(page, TIME, TARGET_TIME, '');
    await compareAsync(page, true);
    await page.getByRole('button', {name: '一覧で表示', exact: true}).click();
    const list = page.locator('.branch-compare-list-tab:visible');
    await expect(list.locator('.branch-compare-list-section')).toHaveCount(5);
    const active = list.locator('.branch-compare-list-section[data-path="data/active.csv"]');
    for (const included of ['before', 'outside-new', 'between-times', 'begins-now']) {
        await expect(active.getByText(included, {exact: true})).toHaveCount(1);
    }
    for (const excluded of ['outside-old', 'after', 'future-old', 'future-new']) {
        await expect(active.getByText(excluded, {exact: true})).toHaveCount(0);
    }
    await expect(active.locator('thead tr').last().locator('th')).toHaveText(['行', 'available_until', 'name', 'id', 'value', 'available_from', '行', 'available_until', 'name', 'id', 'value', 'available_from']);
    await expect(active.getByText('before', {exact: true}).locator('..').locator('.branch-compare-list-line').first()).toHaveText('2');
    await expect.poll(async () => {
        const raw = await readMockFileAsync(page, 'user:ui-state.json');
        if (typeof raw !== 'string') return null;
        const state = JSON.parse(raw);
        return state.tabs.open.find((tab: {diff: {kind: string; exportFilter: object} | null}) => tab.diff?.kind === 'branchCompareList')?.diff.exportFilter;
    }).toEqual({leftDateTime: TIME, rightDateTime: TARGET_TIME, beginColumnName: 'available_from', endColumnName: 'available_until'});
    await page.reload();
    await expect(list.locator('.branch-compare-list-section')).toHaveCount(5);
    await expect(active.getByText('outside-new', {exact: true})).toHaveCount(1);
    await expect(active.getByText('after', {exact: true})).toHaveCount(0);
    await page.getByRole('button', {name: '一覧で表示', exact: true}).click();
    await expect(page.locator('.tab-button')).toHaveCount(1);
});
