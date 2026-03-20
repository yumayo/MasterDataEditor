import {test, expect} from './fixtures/test';
import {determineDisplayColumnName, isDisplayColumn} from '../src/config';

/**
 * determineDisplayColumnName / isDisplayColumn の単体テスト
 *
 * config.referenceDisplayColumnPriority は ["ja", "comment"] として設定されている前提。
 * これらの共通関数により表示列決定ロジックが5箇所から1箇所に集約される。
 */

// =============================================================================
// determineDisplayColumnName
// =============================================================================
test.describe('determineDisplayColumnName', () => {

    test('優先度リストに含まれる列が見つかる場合、その列名を返す', () => {
        const columnNames = ['id', 'name', 'ja', 'value'];
        expect(determineDisplayColumnName(columnNames)).toBe('ja');
    });

    test('優先度リストに含まれない列のみの場合、空文字列を返す', () => {
        const columnNames = ['id', 'name', 'value', 'type'];
        expect(determineDisplayColumnName(columnNames)).toBe('');
    });

    test('複数の優先度列がある場合、より優先度の高い方を返す', () => {
        // config.json: ["ja", "comment"] なので "ja" が "comment" より優先度が高い
        const columnNames = ['id', 'comment', 'ja', 'value'];
        expect(determineDisplayColumnName(columnNames)).toBe('ja');
    });

    test('最優先列がなく次の優先度列がある場合、その列名を返す', () => {
        // "ja" がなく "comment" がある場合
        const columnNames = ['id', 'comment', 'name'];
        expect(determineDisplayColumnName(columnNames)).toBe('comment');
    });

    test('空の列名配列の場合、空文字列を返す', () => {
        expect(determineDisplayColumnName([])).toBe('');
    });
});

// =============================================================================
// isDisplayColumn
// =============================================================================
test.describe('isDisplayColumn', () => {

    test('優先度リストに含まれる列名の場合、true を返す', () => {
        expect(isDisplayColumn('ja')).toBe(true);
        expect(isDisplayColumn('comment')).toBe(true);
    });

    test('優先度リストに含まれない列名の場合、false を返す', () => {
        expect(isDisplayColumn('id')).toBe(false);
        expect(isDisplayColumn('name')).toBe(false);
        expect(isDisplayColumn('')).toBe(false);
    });
});
