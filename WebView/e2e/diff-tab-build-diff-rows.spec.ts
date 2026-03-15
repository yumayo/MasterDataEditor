import { test, expect } from '@playwright/test';
import { buildDiffRows, DiffRow } from '../src/diff-rows';

// =============================================================================
// buildDiffRows ユニットテスト
//
// 検証対象: diff-rows.ts の buildDiffRows() 関数
// 不具合: 削除された行が元の位置ではなく末尾に配置される
//
// 期待する動作:
//   削除行は「元のHEAD版における位置」に配置されるべきである。
//   例）HEAD=[id=1, id=2, id=3, id=4] で id=1 を削除した場合、
//       結果は [id=1(deleted), id=2, id=3, id=4] であり、
//       [id=2, id=3, id=4, id=1(deleted)] ではない。
// =============================================================================

/** テスト用の4行CSVを生成する */
function makeCsv(rows: string[][]): string {
    const header = 'id,name';
    const lines = rows.map(r => r.join(','));
    return [header, ...lines].join('\n');
}

test.describe('buildDiffRows — 削除行の位置検証', () => {

    // -------------------------------------------------------------------------
    // テスト1: 先頭行を削除した場合
    // HEAD=[id=1,id=2,id=3,id=4], Current=[id=2,id=3,id=4]
    // 期待: 削除行(id=1) がインデックス0に来ること
    // -------------------------------------------------------------------------
    test('先頭行(id=1)を削除した場合、削除行がインデックス0に配置されること', () => {
        const headCsv = makeCsv([['1', 'a'], ['2', 'b'], ['3', 'c'], ['4', 'd']]);
        const currentCsv = makeCsv([['2', 'b'], ['3', 'c'], ['4', 'd']]);

        const { diffRows } = buildDiffRows(headCsv, currentCsv, ['id']);

        // 合計4行（削除1 + unchanged3）
        expect(diffRows).toHaveLength(4);

        // インデックス0は削除行(id=1)でなければならない
        expect(diffRows[0].kind).toBe('deleted');
        expect((diffRows[0] as Extract<DiffRow, { kind: 'deleted' }>).headValues[0]).toBe('1');

        // 以降はunchanged
        expect(diffRows[1].kind).toBe('unchanged');
        expect(diffRows[2].kind).toBe('unchanged');
        expect(diffRows[3].kind).toBe('unchanged');
    });

    // -------------------------------------------------------------------------
    // テスト2: 中間行を削除した場合
    // HEAD=[id=1,id=2,id=3,id=4], Current=[id=1,id=3,id=4]
    // 期待: 削除行(id=2) がインデックス1に来ること
    // -------------------------------------------------------------------------
    test('中間行(id=2)を削除した場合、削除行がインデックス1に配置されること', () => {
        const headCsv = makeCsv([['1', 'a'], ['2', 'b'], ['3', 'c'], ['4', 'd']]);
        const currentCsv = makeCsv([['1', 'a'], ['3', 'c'], ['4', 'd']]);

        const { diffRows } = buildDiffRows(headCsv, currentCsv, ['id']);

        // 合計4行（unchanged1 + 削除1 + unchanged2）
        expect(diffRows).toHaveLength(4);

        // インデックス0はunchanged(id=1)
        expect(diffRows[0].kind).toBe('unchanged');
        expect((diffRows[0] as Extract<DiffRow, { kind: 'unchanged' }>).headValues[0]).toBe('1');

        // インデックス1は削除行(id=2)でなければならない
        expect(diffRows[1].kind).toBe('deleted');
        expect((diffRows[1] as Extract<DiffRow, { kind: 'deleted' }>).headValues[0]).toBe('2');

        // 以降はunchanged
        expect(diffRows[2].kind).toBe('unchanged');
        expect(diffRows[3].kind).toBe('unchanged');
    });

    // -------------------------------------------------------------------------
    // テスト3: 末尾行を削除した場合
    // HEAD=[id=1,id=2,id=3,id=4], Current=[id=1,id=2,id=3]
    // 期待: 削除行(id=4) がインデックス3に来ること
    // -------------------------------------------------------------------------
    test('末尾行(id=4)を削除した場合、削除行がインデックス3に配置されること', () => {
        const headCsv = makeCsv([['1', 'a'], ['2', 'b'], ['3', 'c'], ['4', 'd']]);
        const currentCsv = makeCsv([['1', 'a'], ['2', 'b'], ['3', 'c']]);

        const { diffRows } = buildDiffRows(headCsv, currentCsv, ['id']);

        // 合計4行（unchanged3 + 削除1）
        expect(diffRows).toHaveLength(4);

        // インデックス0〜2はunchanged
        expect(diffRows[0].kind).toBe('unchanged');
        expect(diffRows[1].kind).toBe('unchanged');
        expect(diffRows[2].kind).toBe('unchanged');

        // インデックス3は削除行(id=4)でなければならない
        // ※末尾削除は現在の実装でも末尾に来るため、このケースはGREEN
        //   しかし先頭・中間削除のREDテストとセットで一貫したアルゴリズム検証を行う
        expect(diffRows[3].kind).toBe('deleted');
        expect((diffRows[3] as Extract<DiffRow, { kind: 'deleted' }>).headValues[0]).toBe('4');
    });

});
