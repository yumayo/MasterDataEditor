import { test, expect } from './fixtures/test';
import { GitDiffTracker } from '../src/diff/git-diff-tracker';

test.describe('GitDiffTracker', () => {
    test('HEAD版CSVでPKが重複している場合は最初の行を比較基準にする', () => {
        const headCsv = [
            'id,name',
            '1,first',
            '1,last',
        ].join('\n');

        const headRowMap = GitDiffTracker.buildHeadRowMap(headCsv, [0], ['id', 'name']);
        const tracker = new GitDiffTracker(headRowMap, [0], false);

        expect(tracker.isCellChanged([['1', 'first']], 0, 1)).toBe(false);
        expect(tracker.isCellChanged([['1', 'last']], 0, 1)).toBe(true);
    });
});
