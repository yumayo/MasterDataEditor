import {test, expect} from '@playwright/test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

test('セル単位の変更者を実Gitの履歴・マージ・リネームから特定する', async () => {
    test.setTimeout(60000);
    const project = fileURLToPath(new URL('./fixtures/git-cell-history/GitCellHistory.Tests.csproj', import.meta.url));
    const {stdout} = await promisify(execFile)('dotnet', ['run', '--project', project, '--verbosity', 'quiet'], {timeout: 55000});
    expect(stdout).toContain('PASS: 13 Git cell history scenarios');
});
