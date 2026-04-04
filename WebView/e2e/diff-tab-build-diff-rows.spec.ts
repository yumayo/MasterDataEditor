import { test, expect } from './fixtures/test';
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

// =============================================================================
// 列追加・削除・並べ替え時の列名ベースマッチング検証
//
// 現状のバグ: セル比較がインデックスベースのため、列が追加されると
//   「ズレた位置の値同士」を比較してしまい、誤った差分が表示される。
// 修正後: 列名ベースでマッチングするため、列の挿入位置に関係なく
//   同名列の値を正しく比較できる。
// =============================================================================

test.describe('buildDiffRows — 列追加・削除時の列名マッチング', () => {

    /** カスタムヘッダーでCSVを組み立てるヘルパー */
    function makeCsvWithHeader(header: string, rows: string[][]): string {
        const lines = rows.map(r => r.join(','));
        return [header, ...lines].join('\n');
    }

    // -------------------------------------------------------------------------
    // テスト1: 列追加（データ変更なし）
    // HEAD: id,name,description / Current: id,name,end_at,description
    // 列名ベースで比較すれば name, description は変更なし、end_at のみ差分
    // -------------------------------------------------------------------------
    test('列追加（データ変更なし）— 新規列のみが差分として検出されること', () => {
        const headCsv = makeCsvWithHeader('id,name,description', [
            ['1', 'a', 'desc1'],
            ['2', 'b', 'desc2'],
        ]);
        const currentCsv = makeCsvWithHeader('id,name,end_at,description', [
            ['1', 'a', '2026-01-01', 'desc1'],
            ['2', 'b', '2026-02-01', 'desc2'],
        ]);

        const { diffRows, displayHeader, newColumnIndices } = buildDiffRows(headCsv, currentCsv, ['id']);

        // displayHeader は current.header を採用する
        expect(displayHeader).toEqual(['id', 'name', 'end_at', 'description']);

        // 2行とも modified（end_at 列のみ差分: HEAD側は空文字、Current側は日付値）
        expect(diffRows).toHaveLength(2);
        expect(diffRows[0].kind).toBe('modified');
        expect(diffRows[1].kind).toBe('modified');

        // end_at の displayHeader 上のインデックスは 2
        const endAtIndex = displayHeader.indexOf('end_at');
        expect(endAtIndex).toBe(2);

        // 1行目: changedColumnIndices は end_at(=2) のみ含む
        const row0 = diffRows[0] as Extract<DiffRow, { kind: 'modified' }>;
        expect(row0.changedColumnIndices.has(endAtIndex)).toBe(true);
        expect(row0.changedColumnIndices.size).toBe(1);
        // name(=1), description(=3) は変更なしなので含まれない
        expect(row0.changedColumnIndices.has(1)).toBe(false);
        expect(row0.changedColumnIndices.has(3)).toBe(false);

        // 2行目も同様
        const row1 = diffRows[1] as Extract<DiffRow, { kind: 'modified' }>;
        expect(row1.changedColumnIndices.has(endAtIndex)).toBe(true);
        expect(row1.changedColumnIndices.size).toBe(1);

        // newColumnIndices: end_at（displayHeader上のindex 2）は新規列
        expect(newColumnIndices.has(2)).toBe(true);
        expect(newColumnIndices.size).toBe(1);
    });

    // -------------------------------------------------------------------------
    // テスト2: 列追加 + 既存列のデータ変更
    // HEAD: id,name,description / Current: id,name,end_at,description
    // description の値も変更されているケース
    // -------------------------------------------------------------------------
    test('列追加 + 既存列のデータ変更 — 新規列と変更列のみが差分として検出されること', () => {
        const headCsv = makeCsvWithHeader('id,name,description', [
            ['1', 'a', 'old_desc'],
        ]);
        const currentCsv = makeCsvWithHeader('id,name,end_at,description', [
            ['1', 'a', '2026-01-01', 'new_desc'],
        ]);

        const { diffRows, displayHeader } = buildDiffRows(headCsv, currentCsv, ['id']);

        expect(diffRows).toHaveLength(1);
        expect(diffRows[0].kind).toBe('modified');

        const row = diffRows[0] as Extract<DiffRow, { kind: 'modified' }>;

        // end_at(index 2) と description(index 3) のみ差分
        const endAtIndex = displayHeader.indexOf('end_at');
        const descIndex = displayHeader.indexOf('description');
        expect(endAtIndex).toBe(2);
        expect(descIndex).toBe(3);

        expect(row.changedColumnIndices.has(endAtIndex)).toBe(true);
        expect(row.changedColumnIndices.has(descIndex)).toBe(true);
        expect(row.changedColumnIndices.size).toBe(2);

        // id(index 0), name(index 1) は含まれない
        expect(row.changedColumnIndices.has(0)).toBe(false);
        expect(row.changedColumnIndices.has(1)).toBe(false);
    });

    // -------------------------------------------------------------------------
    // テスト3: 列順序変更（データ変更なし）
    // HEAD: id,name,description / Current: id,description,name
    // 列名ベースで比較すると全値が一致するため unchanged になるべき
    // -------------------------------------------------------------------------
    test('列順序変更（データ変更なし）— 列名ベースで一致するため unchanged になること', () => {
        const headCsv = makeCsvWithHeader('id,name,description', [
            ['1', 'a', 'desc1'],
        ]);
        const currentCsv = makeCsvWithHeader('id,description,name', [
            ['1', 'desc1', 'a'],
        ]);

        const { diffRows, displayHeader, newColumnIndices } = buildDiffRows(headCsv, currentCsv, ['id']);

        // displayHeader は current.header を採用する
        expect(displayHeader).toEqual(['id', 'description', 'name']);

        // 列名ベースで比較すると全値が一致するので unchanged
        expect(diffRows).toHaveLength(1);
        expect(diffRows[0].kind).toBe('unchanged');

        // 列順序変更のみなので新規列はない
        expect(newColumnIndices.size).toBe(0);
    });

});
