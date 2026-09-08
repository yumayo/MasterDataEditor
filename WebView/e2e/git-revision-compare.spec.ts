import {test, expect} from '@playwright/test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

test('実Gitでブランチ・コミットIDの比較と不正な比較対象の拒否を検証する', async () => {
    test.setTimeout(60000);
    const project = fileURLToPath(new URL('./fixtures/git-revision-compare/GitRevisionCompare.Tests.csproj', import.meta.url));
    const {stdout} = await promisify(execFile)('dotnet', ['run', '--project', project, '--verbosity', 'quiet'], {timeout: 55000});
    expect(stdout).toContain('PASS: Git revision compare scenarios');
});
