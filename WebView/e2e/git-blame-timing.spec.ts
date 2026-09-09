import {test, expect} from './fixtures/test';
import {createDefaultFileSystem, installMockApiAsync} from './fixtures/mock-api';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import type {GitBlameTiming} from '../src/app/git-blame-timing';

test('BLAMEの段階別計測で解析・ログ・表示の時間を同じrequestIdで確認できる', async ({page}) => {
    const timings: GitBlameTiming[] = [];
    page.on('console', message => {
        if (message.text().startsWith('[BLAME timing] ')) timings.push(JSON.parse(message.text().slice('[BLAME timing] '.length)));
    });
    await page.addInitScript(() => {
        const target = window as unknown as Record<string, unknown>;
        target.__mockGitBlame = {'data/test.csv': [1, 2, 3].map(i => ({
            lineNumber: i + 1, author: `author_${i}`, date: '2026-09-09', commitHash: 'aaa1111', commitMessage: 'initial',
        }))};
        target.__mockGitBlameTimings = [{stage: 'git_command_and_read_stdout', durationMs: 12.5}];
        // 実時間の長さを制御し、計測区間にJSON処理が含まれることを確認する。
        const parse = JSON.parse;
        JSON.parse = function (text, reviver) {
            if (text.startsWith('{"type":"git_blame_response",')) {
                const start = performance.now();
                while (performance.now() - start < 15) { /* 解析負荷 */ }
            }
            return parse(text, reviver);
        };
        const stringify = JSON.stringify;
        JSON.stringify = function (value, ...args) {
            if (value?.type === 'git_blame_response') {
                const start = performance.now();
                while (performance.now() - start < 10) { /* シリアライズ負荷 */ }
            }
            return stringify(value, ...args);
        } as typeof JSON.stringify;
    });
    await installMockApiAsync(page, createDefaultFileSystem());
    await page.goto('/');
    await page.locator('#explorer').getByText('test', {exact: true}).click();
    const table = page.locator('.editor-left-pane .editor-table');
    await table.locator('.editor-table-detached-row-header-layer .editor-table-row-header').first().click({button: 'right'});
    await page.locator('.context-menu.visible').getByText('変更履歴を表示', {exact: true}).click();
    await expect(table.locator('.editor-table-detached-row-header-layer .blame-author').first()).toHaveText('author_1');
    await expect.poll(() => timings.some(timing => timing.stage === 'show_total')).toBe(true);

    const requestId = timings[0].requestId;
    expect(new Set(timings.map(timing => timing.requestId))).toEqual(new Set([requestId]));
    expect(timings.filter(timing => timing.source === 'host')).toEqual([
        expect.objectContaining({stage: 'git_command_and_read_stdout', durationMs: 12.5}),
    ]);
    const parses = timings.filter(timing => timing.stage === 'response_json_parse');
    expect(parses.map(timing => timing.consumer)).toEqual(expect.arrayContaining(['sidebar', `api:git_blame#${requestId}`]));
    for (const timing of parses) expect(timing.durationMs).toBeGreaterThanOrEqual(14);
    expect(timings.find(timing => timing.stage === 'response_log_json_stringify')!.durationMs).toBeGreaterThanOrEqual(9);
    for (const stage of ['request_to_response_event_total', 'response_console_info_call', 'prepare_rendered_rows', 'index_entries', 'insert_blame_cells', 'update_selection', 'refresh_layout']) {
        expect(timings.some(timing => timing.stage === stage), stage).toBe(true);
    }
    for (const timing of timings) {
        expect(Number.isFinite(timing.durationMs)).toBe(true);
        expect(timing.durationMs).toBeGreaterThanOrEqual(0);
        expect(timing).not.toHaveProperty('data');
    }

    await page.locator('.status-bar-badge').click();
    await page.locator('.bottom-panel-tab', {hasText: 'DEBUG CONSOLE'}).click();
    const profileRow = page.locator('.debug-console-row').filter({
        has: page.locator('.debug-console-col-label', {hasText: `git_blame [insert_blame_cells] #${requestId}`}),
    });
    await profileRow.click();
    const detail = page.locator('.debug-api-detail-tab');
    await expect(detail).toContainText('"entryCount": 3');
    await expect(detail).toContainText('"renderedRows": 4');
    await expect(detail).toContainText('"filename": "data/test.csv"');
    await expect(detail).not.toContainText('author_1');
});

test('C#の実Git BLAMEで解析前後の計測を記録し、結果とエラーを保持する', async () => {
    test.setTimeout(60000);
    const project = fileURLToPath(new URL('./fixtures/git-blame-timing/GitBlameTiming.Tests.csproj', import.meta.url));
    const {stdout} = await promisify(execFile)('dotnet', ['run', '--project', project, '--verbosity', 'quiet'], {timeout: 55000});
    expect(stdout).toContain('PASS: Git blame timing');
});
