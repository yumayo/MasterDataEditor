import { test as base } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import {
    MockFileSystem,
    createDefaultFileSystem,
    installMockApiAsync,
} from './mock-api';

const currentDir = dirname(fileURLToPath(import.meta.url));
const dumpRootDir = resolve(currentDir, '../../../.CONTEXT/dump');

/**
 * カスタムフィクスチャの型定義
 *
 * mockFileSystem:
 *   デフォルトのインメモリファイルシステムをセットアップし、
 *   ページ遷移まで完了した状態で提供する。
 *
 * autoDump:
 *   テスト完了後にDOMを自動ダンプする（auto: true で全テスト共通）。
 */
interface MockFixtures {
    mockFileSystem: MockFileSystem;
    autoDump: void;
}

export const test = base.extend<MockFixtures>({
    mockFileSystem: async ({ page }, use) => {
        const fs = createDefaultFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await use(fs);
    },

    // 全テストで自動実行されるDOMダンプフィクスチャ
    autoDump: [async ({ page }, use, testInfo) => {
        await use();

        // テスト完了後にDOMをダンプする
        // specファイル名（拡張子なし）をディレクトリ名、テストタイトルをファイル名に使う
        const specName = basename(testInfo.file, '.spec.ts');
        const testTitle = testInfo.title.replace(/[<>:"/\\|?*]/g, '_');
        const outputDir = resolve(dumpRootDir, specName);
        mkdirSync(outputDir, { recursive: true });

        const html = await page.evaluate(() => {
            // head内のstyleとscriptを除去して軽量化する
            const clone = document.documentElement.cloneNode(true) as HTMLElement;
            const head = clone.querySelector('head');
            if (head) {
                head.querySelectorAll('style, script').forEach(el => el.remove());
            }
            return clone.outerHTML;
        });
        writeFileSync(resolve(outputDir, testTitle + '.html'), html, 'utf-8');
    }, { auto: true }],
});

export { expect } from '@playwright/test';
