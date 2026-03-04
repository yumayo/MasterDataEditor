import { test, expect } from '@playwright/test';
import { InMemoryTableStore } from '../src/in-memory-table-store';

// =====================================================
// buildAllKeyMaps相当のテスト（InMemoryTableStore.buildKeyMapの組み合わせ）
//
// buildAllKeyMapsはview-table-data-builder.tsに定義されているが、
// 依存先のutility.tsがモジュールスコープでdocument.createElement("canvas")を
// 実行するため、Node.js環境では直接importできない。
// buildAllKeyMapsの本質は「ViewDefinitionの各JOINに対してstore.buildKeyMapを呼ぶ」だけなので、
// InMemoryTableStoreのbuildKeyMapを使って同等のロジックを検証する。
// =====================================================
test.describe('buildAllKeyMaps相当: 複数テーブルに対するbuildKeyMapの組み合わせ', () => {
    test('複数JOINがある場合、それぞれのテーブルに対するkeyMapが構築される', () => {
        const store = new InMemoryTableStore();
        // JOINテーブル1: Skills（EnemyIdでグループ化される）
        store.registerTable('Skills', ['EnemyId', 'SkillName', 'Power'], [
            ['E001', 'Fire', '10'],
            ['E001', 'Ice', '20'],
            ['E002', 'Thunder', '30'],
        ]);
        // JOINテーブル2: DropItems（EnemyIdでグループ化される）
        store.registerTable('DropItems', ['EnemyId', 'ItemName', 'Rate'], [
            ['E001', 'Potion', '50'],
            ['E002', 'Elixir', '10'],
            ['E002', 'Ether', '25'],
        ]);

        // buildAllKeyMaps相当: 各JOINのtargetTable/targetColumnに対してbuildKeyMapを呼ぶ
        const joins = [
            { targetTable: 'Skills', targetColumn: 'EnemyId' },
            { targetTable: 'DropItems', targetColumn: 'EnemyId' },
        ];
        const result = new Map<string, Map<string, string[][]>>();
        for (const join of joins) {
            const keyMap = store.buildKeyMap(join.targetTable, join.targetColumn);
            result.set(join.targetTable, keyMap);
        }

        // 2つのJOINテーブルに対応する2つのエントリが存在する
        expect(result.size).toBe(2);

        // Skills テーブルのkeyMap検証
        const skillsKeyMap = result.get('Skills');
        expect(skillsKeyMap).toBeDefined();
        expect(skillsKeyMap!.size).toBe(2);
        expect(skillsKeyMap!.get('E001')).toEqual([
            ['E001', 'Fire', '10'],
            ['E001', 'Ice', '20'],
        ]);
        expect(skillsKeyMap!.get('E002')).toEqual([
            ['E002', 'Thunder', '30'],
        ]);

        // DropItems テーブルのkeyMap検証
        const dropItemsKeyMap = result.get('DropItems');
        expect(dropItemsKeyMap).toBeDefined();
        expect(dropItemsKeyMap!.size).toBe(2);
        expect(dropItemsKeyMap!.get('E001')).toEqual([
            ['E001', 'Potion', '50'],
        ]);
        expect(dropItemsKeyMap!.get('E002')).toEqual([
            ['E002', 'Elixir', '10'],
            ['E002', 'Ether', '25'],
        ]);
    });
});
