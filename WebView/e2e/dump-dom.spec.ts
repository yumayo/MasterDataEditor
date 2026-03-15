import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { test } from './fixtures/test';

const currentDir = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(currentDir, '../../.CONTEXT/dump');

/** セクション定義: セレクタとファイル名の対応 */
const sections = [
    { selector: '#explorer', file: 'explorer.html' },
    { selector: '#tab', file: 'tab.html' },
    { selector: '#editor', file: 'editor.html' },
] as const;

/**
 * DOMをセクション別に .CONTEXT/dump/ へダンプするテスト。
 * AIがレビュー用に実際のDOM構造を確認するために使用する。
 */
test('DOMダンプ: セクション別のDOM構造を .CONTEXT/dump/ へ出力する', async ({ page, mockFileSystem }) => {
    // Explorerでテーブルをクリックしてエディタを開く
    await page.locator('#explorer').getByText('test').click();
    // EditorTableが描画されるまで待機
    await page.locator('.editor-table').waitFor({ state: 'visible' });

    // 前回の残骸を削除してからディレクトリを再作成
    rmSync(outputDir, { recursive: true, force: true });
    mkdirSync(outputDir, { recursive: true });

    // 各セクションのouterHTMLを取得して書き出し
    for (const section of sections) {
        const html = await page.evaluate(
            (sel) => document.querySelector(sel)?.outerHTML ?? '<!-- not found -->',
            section.selector,
        );
        writeFileSync(resolve(outputDir, section.file), html, 'utf-8');
    }
});
