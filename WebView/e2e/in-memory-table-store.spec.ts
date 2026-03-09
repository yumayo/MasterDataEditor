import { test, expect } from '@playwright/test';
import { InMemoryTableStore } from '../src/in-memory-table-store';

// --- テスト用ヘルパー ---

/** テスト用テーブルデータを生成する */
function createTestTable(): { header: string[]; body: string[][] } {
    return {
        header: ['id', 'name', 'value'],
        body: [
            ['1', 'item_a', '100'],
            ['2', 'item_b', '200'],
            ['3', 'item_c', '300'],
        ],
    };
}

// =====================================================
// 1. テーブル登録と取得
// =====================================================
test.describe('テーブル登録と取得', () => {
    test('registerTableで登録したテーブルがgetCsvで取得できる', () => {
        const store = new InMemoryTableStore();
        const { header, body } = createTestTable();
        store.registerTable('enemies', header, body);
        const csv = store.getCsv('enemies');
        // falseではないことを確認
        expect(csv).not.toBe(false);
        if (csv === false) return; // 型ガード
        expect(csv.header).toEqual(['id', 'name', 'value']);
        expect(csv.body).toEqual([
            ['1', 'item_a', '100'],
            ['2', 'item_b', '200'],
            ['3', 'item_c', '300'],
        ]);
    });

    test('registerTable後にhasTableがtrueを返す', () => {
        const store = new InMemoryTableStore();
        const { header, body } = createTestTable();
        store.registerTable('enemies', header, body);
        expect(store.hasTable('enemies')).toBe(true);
    });

    test('getHeaderでヘッダーが取得できる', () => {
        const store = new InMemoryTableStore();
        const { header, body } = createTestTable();
        store.registerTable('enemies', header, body);
        const result = store.getHeader('enemies');
        expect(result).not.toBe(false);
        if (result === false) return;
        expect(result).toEqual(['id', 'name', 'value']);
    });

    test('getRowsでボディが取得できる', () => {
        const store = new InMemoryTableStore();
        const { header, body } = createTestTable();
        store.registerTable('enemies', header, body);
        const result = store.getRows('enemies');
        expect(result).not.toBe(false);
        if (result === false) return;
        expect(result).toEqual([
            ['1', 'item_a', '100'],
            ['2', 'item_b', '200'],
            ['3', 'item_c', '300'],
        ]);
    });
});

// =====================================================
// 2. 参照カウント
// =====================================================
test.describe('参照カウント', () => {
    test('同じテーブルを2回registerしてもデータは1つ（最初のデータが保持される）', () => {
        const store = new InMemoryTableStore();
        const { header, body } = createTestTable();
        store.registerTable('enemies', header, body);
        // 2回目は別データで登録しようとする
        store.registerTable('enemies', ['x', 'y'], [['a', 'b']]);
        // 最初のデータが保持される
        const csv = store.getCsv('enemies');
        expect(csv).not.toBe(false);
        if (csv === false) return;
        expect(csv.header).toEqual(['id', 'name', 'value']);
        expect(csv.body).toEqual([
            ['1', 'item_a', '100'],
            ['2', 'item_b', '200'],
            ['3', 'item_c', '300'],
        ]);
    });

    test('refCount=2の状態で1回unregisterしてもデータは残る', () => {
        const store = new InMemoryTableStore();
        const { header, body } = createTestTable();
        store.registerTable('enemies', header, body);
        store.registerTable('enemies', header, body);
        // 1回目のunregister: refCount 2→1
        store.unregisterTable('enemies');
        expect(store.hasTable('enemies')).toBe(true);
        const csv = store.getCsv('enemies');
        expect(csv).not.toBe(false);
    });

    test('2回unregisterするとデータが削除される', () => {
        const store = new InMemoryTableStore();
        const { header, body } = createTestTable();
        store.registerTable('enemies', header, body);
        store.registerTable('enemies', header, body);
        store.unregisterTable('enemies');
        store.unregisterTable('enemies');
        expect(store.hasTable('enemies')).toBe(false);
    });

    test('unregister後にhasTableがfalseを返す', () => {
        const store = new InMemoryTableStore();
        const { header, body } = createTestTable();
        store.registerTable('enemies', header, body);
        store.unregisterTable('enemies');
        expect(store.hasTable('enemies')).toBe(false);
    });
});

// =====================================================
// 3. 存在しないテーブル
// =====================================================
test.describe('存在しないテーブル', () => {
    test('未登録テーブルにgetCsvがfalseを返す', () => {
        const store = new InMemoryTableStore();
        expect(store.getCsv('nonexistent')).toBe(false);
    });

    test('未登録テーブルにhasTableがfalseを返す', () => {
        const store = new InMemoryTableStore();
        expect(store.hasTable('nonexistent')).toBe(false);
    });

    test('未登録テーブルにgetHeaderがfalseを返す', () => {
        const store = new InMemoryTableStore();
        expect(store.getHeader('nonexistent')).toBe(false);
    });

    test('未登録テーブルにgetRowsがfalseを返す', () => {
        const store = new InMemoryTableStore();
        expect(store.getRows('nonexistent')).toBe(false);
    });
});

// =====================================================
// 4. セル更新
// =====================================================
test.describe('セル更新', () => {
    test('updateCellValueByRowIndexで特定セルの値が更新される', () => {
        const store = new InMemoryTableStore();
        const { header, body } = createTestTable();
        store.registerTable('enemies', header, body);
        // 行インデックス0のname列（列インデックス1）を"item_x"に更新
        store.updateCellValueByRowIndex('enemies', 0, 1, 'item_x');
        const rows = store.getRows('enemies');
        expect(rows).not.toBe(false);
        if (rows === false) return;
        expect(rows[0][1]).toBe('item_x');
    });

    test('updateCellValueByRowIndex更新後にgetCsvで取得した値が反映されている', () => {
        const store = new InMemoryTableStore();
        const { header, body } = createTestTable();
        store.registerTable('enemies', header, body);
        // 行インデックス1のvalue列（列インデックス2）を"999"に更新
        store.updateCellValueByRowIndex('enemies', 1, 2, '999');
        const csv = store.getCsv('enemies');
        expect(csv).not.toBe(false);
        if (csv === false) return;
        expect(csv.body[1][2]).toBe('999');
    });

    test('updateCellValueByRowIndex更新後にgetRowsで取得した値が反映されている', () => {
        const store = new InMemoryTableStore();
        const { header, body } = createTestTable();
        store.registerTable('enemies', header, body);
        // 行インデックス2のid列（列インデックス0）を"42"に更新
        store.updateCellValueByRowIndex('enemies', 2, 0, '42');
        const rows = store.getRows('enemies');
        expect(rows).not.toBe(false);
        if (rows === false) return;
        expect(rows[2][0]).toBe('42');
    });

    test('updateCellValueByRowIndexで範囲外インデックスを指定してもエラーを起こさない', () => {
        const store = new InMemoryTableStore();
        const { header, body } = createTestTable();
        store.registerTable('enemies', header, body);
        // 範囲外の行インデックスを指定してもエラーにならない
        expect(() => store.updateCellValueByRowIndex('enemies', 99, 0, 'value')).not.toThrow();
        // 範囲外の列インデックスを指定してもエラーにならない
        expect(() => store.updateCellValueByRowIndex('enemies', 0, 99, 'value')).not.toThrow();
        // 既存データが破壊されていないことを確認
        const rows = store.getRows('enemies');
        expect(rows).not.toBe(false);
        if (rows === false) return;
        expect(rows).toEqual([
            ['1', 'item_a', '100'],
            ['2', 'item_b', '200'],
            ['3', 'item_c', '300'],
        ]);
    });

    test('PK重複テーブルでupdateCellValueByRowIndexが正しい行を更新する', () => {
        const store = new InMemoryTableStore();
        // PK重複テーブル（id=1が2行）
        store.registerTable('items', ['id', 'name'], [
            ['1', 'item_a'],
            ['1', 'item_b'],
            ['2', 'item_c'],
        ]);
        // 行インデックス=1（2行目）のname列を更新する
        // PKベース検索なら誤って1行目（id=1の最初のヒット）を更新するが、
        // インデックスベースなら正しく2行目を更新する
        store.updateCellValueByRowIndex('items', 1, 1, 'item_b_edited');
        const rows = store.getRows('items');
        expect(rows).not.toBe(false);
        if (rows === false) return;
        expect(rows[0][1]).toBe('item_a');    // 1行目は変化しない
        expect(rows[1][1]).toBe('item_b_edited');  // 2行目が更新される
    });
});

// =====================================================
// 5. 行操作
// =====================================================
test.describe('行操作', () => {
    test('appendRowで行が末尾に追加される', () => {
        const store = new InMemoryTableStore();
        const { header, body } = createTestTable();
        store.registerTable('enemies', header, body);
        store.appendRow('enemies', ['4', 'item_d', '400']);
        const rows = store.getRows('enemies');
        expect(rows).not.toBe(false);
        if (rows === false) return;
        expect(rows.length).toBe(4);
        expect(rows[3]).toEqual(['4', 'item_d', '400']);
    });

    test('removeRowで指定行が削除される', () => {
        const store = new InMemoryTableStore();
        const { header, body } = createTestTable();
        store.registerTable('enemies', header, body);
        // 行1("item_b")を削除
        store.removeRow('enemies', 1);
        const rows = store.getRows('enemies');
        expect(rows).not.toBe(false);
        if (rows === false) return;
        expect(rows.length).toBe(2);
        expect(rows[0]).toEqual(['1', 'item_a', '100']);
        expect(rows[1]).toEqual(['3', 'item_c', '300']);
    });

    test('replaceAllRowsで全行が置換される', () => {
        const store = new InMemoryTableStore();
        const { header, body } = createTestTable();
        store.registerTable('enemies', header, body);
        const newRows = [
            ['10', 'new_a', '1000'],
            ['20', 'new_b', '2000'],
        ];
        store.replaceAllRows('enemies', newRows);
        const rows = store.getRows('enemies');
        expect(rows).not.toBe(false);
        if (rows === false) return;
        expect(rows.length).toBe(2);
        expect(rows).toEqual(newRows);
    });

    test('存在しない行インデックスへのremoveRowがエラーを起こさない', () => {
        const store = new InMemoryTableStore();
        const { header, body } = createTestTable();
        store.registerTable('enemies', header, body);
        // 行数3のテーブルに対して範囲外インデックスを指定してもエラーにならない
        expect(() => store.removeRow('enemies', 10)).not.toThrow();
        // 負のインデックスでもエラーにならず、データが破壊されない
        expect(() => store.removeRow('enemies', -1)).not.toThrow();
        // 既存データが破壊されていないことを確認
        const rows = store.getRows('enemies');
        expect(rows).not.toBe(false);
        if (rows === false) return;
        expect(rows).toEqual([
            ['1', 'item_a', '100'],
            ['2', 'item_b', '200'],
            ['3', 'item_c', '300'],
        ]);
    });
});

// =====================================================
// 6. buildKeyMap（キー列によるグループ化マップ構築）
// =====================================================
test.describe('buildKeyMap', () => {
    test('指定キー列の値で行がグループ化される', () => {
        const store = new InMemoryTableStore();
        store.registerTable('Skills', ['EnemyId', 'SkillName', 'Power'], [
            ['E001', 'Fire', '10'],
            ['E001', 'Ice', '20'],
            ['E002', 'Thunder', '30'],
        ]);
        const keyMap = store.buildKeyMap('Skills', 'EnemyId');
        // E001には2行、E002には1行がグループ化される
        expect(keyMap.size).toBe(2);
        expect(keyMap.get('E001')).toEqual([
            ['E001', 'Fire', '10'],
            ['E001', 'Ice', '20'],
        ]);
        expect(keyMap.get('E002')).toEqual([
            ['E002', 'Thunder', '30'],
        ]);
    });

    test('存在しない列名の場合は空のMapを返す', () => {
        const store = new InMemoryTableStore();
        store.registerTable('Skills', ['EnemyId', 'SkillName', 'Power'], [
            ['E001', 'Fire', '10'],
        ]);
        const keyMap = store.buildKeyMap('Skills', 'NonExistent');
        expect(keyMap.size).toBe(0);
    });

    test('テーブルのrowsが空の場合は空のMapを返す', () => {
        const store = new InMemoryTableStore();
        store.registerTable('Skills', ['EnemyId', 'SkillName', 'Power'], []);
        const keyMap = store.buildKeyMap('Skills', 'EnemyId');
        expect(keyMap.size).toBe(0);
    });
});
