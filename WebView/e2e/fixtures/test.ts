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
        // ブラウザ側の未キャッチ例外とエラーログを収集する
        const pageErrors: string[] = [];
        // ブラウザ側の全コンソール出力を収集する（console.log含む）
        const consoleLogs: string[] = [];
        page.on('pageerror', err => pageErrors.push(`[EXCEPTION] ${err.message}\n${err.stack}`));
        page.on('console', msg => {
            consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
            if (msg.type() === 'error') pageErrors.push(`[console.error] ${msg.text()}`);
        });

        await use();

        // テスト完了後にDOMをダンプする
        // specファイル名（拡張子なし）をディレクトリ名、テストタイトルをファイル名に使う
        const specName = basename(testInfo.file, '.spec.ts');
        const testTitle = testInfo.title.replace(/[<>:"/\\|?*]/g, '_');
        const outputDir = resolve(dumpRootDir, specName);
        mkdirSync(outputDir, { recursive: true });

        // テスト失敗時にブラウザ側エラーをファイルに出力する（原因特定を迅速にするため）
        if (testInfo.status !== testInfo.expectedStatus && pageErrors.length > 0) {
            writeFileSync(resolve(outputDir, testTitle + '.errors.log'), pageErrors.join('\n'), 'utf-8');
        }
        // ブラウザ側のコンソール出力を常にファイルに出力する（テスト成功/失敗問わず）
        if (consoleLogs.length > 0) {
            writeFileSync(resolve(outputDir, testTitle + '.console.log'), consoleLogs.join('\n'), 'utf-8');
        }

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

        // スクリーンショットも保存する
        await page.screenshot({ path: resolve(outputDir, testTitle + '.png'), fullPage: true });
    }, { auto: true }],
});

export { expect } from '@playwright/test';
