import { test as base } from '@playwright/test';
import {
    MockFileSystem,
    createDefaultFileSystem,
    installMockApiAsync,
} from './mock-api';

/**
 * カスタムフィクスチャの型定義
 *
 * mockFileSystem:
 *   デフォルトのインメモリファイルシステムをセットアップし、
 *   ページ遷移まで完了した状態で提供する。
 */
interface MockFixtures {
    mockFileSystem: MockFileSystem;
}

export const test = base.extend<MockFixtures>({
    mockFileSystem: async ({ page }, use) => {
        const fs = createDefaultFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await use(fs);
    },
});

export { expect } from '@playwright/test';
