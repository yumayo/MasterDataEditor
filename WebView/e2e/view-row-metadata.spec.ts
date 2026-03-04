import { test, expect } from '@playwright/test';
import { ViewRowGroupInfo } from '../src/model/view-row-metadata';
import { setViewRowMetadata, getBaseRowIndex, getGroupInfos } from '../src/model/view-row-metadata';

// --- テスト用ヘルパー ---

/**
 * DOM属性のget/setを持つ簡易モック
 * テスト環境(Node.js)にはDOMが存在しないため、HTMLElementの最小インターフェースを再現する
 */
function createMockElement(): HTMLElement {
    const attrs: Record<string, string> = {};
    return {
        setAttribute(name: string, value: string) { attrs[name] = value; },
        getAttribute(name: string) { return attrs[name] ?? ''; },
    } as unknown as HTMLElement;
}

// =====================================================
// setViewRowMetadata / getBaseRowIndex / getGroupInfos
// =====================================================
test.describe('DOM属性ユーティリティ: setViewRowMetadata / getBaseRowIndex / getGroupInfos', () => {

    test('setで設定した値をgetBaseRowIndexとgetGroupInfosで正しく読み取れる', () => {
        const el = createMockElement();
        const groupInfos: ViewRowGroupInfo[] = [
            { groupPosition: 0, groupSize: 3, sourceTable: 'Skills', sourceKeyValue: 'E001' },
        ];
        setViewRowMetadata(el, 5, groupInfos);
        expect(getBaseRowIndex(el)).toBe(5);
        expect(getGroupInfos(el)).toEqual([
            { groupPosition: 0, groupSize: 3, sourceTable: 'Skills', sourceKeyValue: 'E001' },
        ]);
    });

    test('複数のgroupInfosが正しくシリアライズ/デシリアライズされる', () => {
        const el = createMockElement();
        const groupInfos: ViewRowGroupInfo[] = [
            { groupPosition: 0, groupSize: 2, sourceTable: 'Skills', sourceKeyValue: 'E001' },
            { groupPosition: 1, groupSize: 3, sourceTable: 'DropItems', sourceKeyValue: 'E002' },
        ];
        setViewRowMetadata(el, 10, groupInfos);
        expect(getBaseRowIndex(el)).toBe(10);
        const result = getGroupInfos(el);
        expect(result.length).toBe(2);
        expect(result[0]).toEqual({ groupPosition: 0, groupSize: 2, sourceTable: 'Skills', sourceKeyValue: 'E001' });
        expect(result[1]).toEqual({ groupPosition: 1, groupSize: 3, sourceTable: 'DropItems', sourceKeyValue: 'E002' });
    });

    test('空のgroupInfosが正しく動作する', () => {
        const el = createMockElement();
        const groupInfos: ViewRowGroupInfo[] = [];
        setViewRowMetadata(el, 0, groupInfos);
        expect(getBaseRowIndex(el)).toBe(0);
        expect(getGroupInfos(el)).toEqual([]);
    });
});
