import type {Page} from '@playwright/test';
import type {TableViewSettings} from '../../src/app/table-view-settings';
import {readMockFileAsync} from './mock-api';

/** 未保存はnullとし、解除済みの0・空配列・空オブジェクトと区別してpollを継続する。 */
export async function readMockTableViewSettingsAsync(page: Page, tableName: string): Promise<TableViewSettings | null> {
    const text = await readMockFileAsync(page, 'user:table-view-settings.json');
    if (typeof text !== 'string') return null;
    const state = JSON.parse(text) as {tables: Record<string, TableViewSettings>};
    return Object.hasOwn(state.tables, tableName) ? state.tables[tableName] : null;
}
