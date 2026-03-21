import { test as base, expect, type Page } from './fixtures/test';
import type { Locator } from '@playwright/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { getDataCell } from './fixtures/test-utils';

// =============================================================================
// git差分ビューで日本語列が左ペイン（HEAD版）で正しく表示されるテスト
//
// 根本原因:
//   GitCommandHelper.cs の ProcessStartInfo に StandardOutputEncoding が
//   設定されていなかったため、git show HEAD:path のUTF-8出力が
//   Windows既定のCP932（Shift-JIS）として誤読され、差分ビューの左ペイン
//   （変更前）で日本語が文字化けしていた。
//
// 修正内容:
//   StandardOutputEncoding = System.Text.Encoding.UTF8 を追加し、
//   StandardErrorEncoding = System.Text.Encoding.UTF8 も追加した。
//
// 検証シナリオ:
//   1. 日本語を含むテーブルを用意し、HEAD版も日本語を含む状態にする
//   2. 差分タブを開く
//   3. 左ペイン（HEAD版）の日本語セルが文字化けせず正しく表示されること
//   4. 右ペイン（現在版）の日本語セルも正しく表示されること
// =============================================================================

// テスト用スキーマ（id, name, description の3列テーブル — nameとdescriptionに日本語を使用）
const MONSTER_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
        { key: 2, name: "description", type: "string" },
    ],
    primary_key: ["id"],
});

// 現在版CSV（working tree）— id=1 の description を日本語で変更した状態
const CURRENT_MONSTER_CSV = [
    "id,name,description",
    "1,スライム,弱い魔物。初心者向け。",
    "2,ドラゴン,最強の魔物",
    "3,ゴブリン,群れで襲ってくる",
].join("\n");

// HEAD版CSV（変更前）— id=1 の description が変更前の日本語
const HEAD_MONSTER_CSV = [
    "id,name,description",
    "1,スライム,最も弱い魔物",
    "2,ドラゴン,最強の魔物",
    "3,ゴブリン,群れで襲ってくる",
].join("\n");

// git status レスポンス（monster が変更あり）
const GIT_STATUS = {
    changes: [{ path: "data/monster.csv", tableName: "monster", isNew: false }],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

// HEAD版ファイルマップ
const HEAD_FILES: Record<string, string> = {
    "data/monster.csv": HEAD_MONSTER_CSV,
};

function createFileSystem(): MockFileSystem {
    return {
        "schema/monster.json": MONSTER_SCHEMA,
        "data/monster.csv": CURRENT_MONSTER_CSV,
    };
}

// フィクスチャ型定義
interface DiffTabJapaneseFixtures {
    /** 日本語テーブルのgit差分状態をセットアップした状態でページを開く */
    diffTabJapanesePage: void;
}

/**
 * 日本語差分ビューテスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<DiffTabJapaneseFixtures>({
    diffTabJapanesePage: async ({ page }, use) => {
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createFileSystem());
        await page.goto('/');
        await use();
    },
});

// ソースコントロールパネルを開いてmonsterの差分タブを表示する共通処理
async function openMonsterDiffTabAsync(page: Page): Promise<{ leftTable: Locator; rightTable: Locator }> {
    await page.locator('[data-panel="sourceControl"]').click();
    const changesSection = page.locator('.source-control-changes-section');
    await expect(changesSection.getByText('monster')).toBeVisible();
    await changesSection.getByText('monster').click();
    const diffTab = page.locator('.diff-tab');
    await expect(diffTab).toBeVisible();
    const leftTable = diffTab.locator('.diff-pane-left .editor-table');
    await expect(leftTable).toBeVisible();
    const rightTable = diffTab.locator('.diff-pane-right .editor-table');
    await expect(rightTable).toBeVisible();
    return { leftTable, rightTable };
}

// テスト本体 -------------------------------------------------------------------

test.describe('git差分ビューでの日本語表示', () => {

    // -------------------------------------------------------------------------
    // テスト1: 左ペイン（HEAD版）の日本語セルが文字化けせず正しく表示される
    //
    // HEAD版のCSVに日本語データが含まれている場合、git show で取得した内容が
    // UTF-8として正しくデコードされ、差分ビューの左ペインに正確に表示されること。
    //
    // C#側の StandardOutputEncoding = UTF8 が未設定の場合、CP932で誤読されて
    // 文字化け（例: "最も弱い魔物" → "譛€繧よ弱縺„魔迚ｩ"）が発生する。
    // -------------------------------------------------------------------------
    test(
        'git差分ビューで日本語列が左ペインで正しく表示される',
        async ({ page, diffTabJapanesePage: _diffTabJapanesePage }) => {
            const { leftTable } = await openMonsterDiffTabAsync(page);

            // 左ペインのid=1行（row 0）のname列（col 1）が日本語で正しく表示されること
            // HEAD版: "スライム" — 文字化けしていないことを検証する
            const leftNameCell = getDataCell(leftTable, 0, 1);
            await expect(leftNameCell).toHaveText('スライム');

            // 左ペインのid=1行（row 0）のdescription列（col 2）が日本語で正しく表示されること
            // HEAD版: "最も弱い魔物" — CP932誤読の場合ここが文字化けする
            const leftDescCell = getDataCell(leftTable, 0, 2);
            await expect(leftDescCell).toHaveText('最も弱い魔物');

            // 変更がないid=2行（row 1）の日本語も正しく表示されること
            const leftName2 = getDataCell(leftTable, 1, 1);
            await expect(leftName2).toHaveText('ドラゴン');

            const leftDesc2 = getDataCell(leftTable, 1, 2);
            await expect(leftDesc2).toHaveText('最強の魔物');

            // id=3行（row 2）も確認する
            const leftName3 = getDataCell(leftTable, 2, 1);
            await expect(leftName3).toHaveText('ゴブリン');

            const leftDesc3 = getDataCell(leftTable, 2, 2);
            await expect(leftDesc3).toHaveText('群れで襲ってくる');
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: 右ペイン（現在版）の日本語セルも正しく表示される
    //
    // 右ペインはファイルシステムから直接読み込んだ現在版を表示するため、
    // git showの文字化け問題とは無関係だが、日本語の表示に問題がないことを
    // 合わせて検証する。
    // -------------------------------------------------------------------------
    test(
        'git差分ビューで日本語列が右ペインで正しく表示される',
        async ({ page, diffTabJapanesePage: _diffTabJapanesePage }) => {
            const { rightTable } = await openMonsterDiffTabAsync(page);

            // 右ペインのid=1行（row 0）のname列（col 1）が日本語で正しく表示されること
            const rightNameCell = getDataCell(rightTable, 0, 1);
            await expect(rightNameCell).toHaveText('スライム');

            // 右ペインのid=1行（row 0）のdescription列（col 2）が現在版の日本語で表示されること
            // 現在版: "弱い魔物。初心者向け。"
            const rightDescCell = getDataCell(rightTable, 0, 2);
            await expect(rightDescCell).toHaveText('弱い魔物。初心者向け。');

            // id=2行の日本語も正しいこと
            const rightName2 = getDataCell(rightTable, 1, 1);
            await expect(rightName2).toHaveText('ドラゴン');

            const rightDesc2 = getDataCell(rightTable, 1, 2);
            await expect(rightDesc2).toHaveText('最強の魔物');
        },
    );

    // -------------------------------------------------------------------------
    // テスト3: 左ペインと右ペインで変更されたセルにdiff-cell-addedとdiff-cell-deletedが
    //          正しく付与されること（日本語値の比較が正しく動作すること）
    //
    // HEAD版: "最も弱い魔物", 現在版: "弱い魔物。初心者向け。" で値が異なるため、
    // 右ペインのセルに diff-cell-added、左ペインのセルに diff-cell-deleted が付くこと。
    // 日本語値の文字列比較が文字化けで誤動作しないことの補強テスト。
    // -------------------------------------------------------------------------
    test(
        '日本語セルの変更箇所に diff-cell-added/deleted が正しく付与されること',
        async ({ page, diffTabJapanesePage: _diffTabJapanesePage }) => {
            const { leftTable, rightTable } = await openMonsterDiffTabAsync(page);

            // id=1, description列（col 2）: HEAD版と現在版で値が異なる
            // 左ペインのセルに diff-cell-deleted が付与されること
            const leftDescCell = getDataCell(leftTable, 0, 2);
            await expect(leftDescCell).toHaveClass(/diff-cell-deleted/);

            // 右ペインのセルに diff-cell-added が付与されること
            const rightDescCell = getDataCell(rightTable, 0, 2);
            await expect(rightDescCell).toHaveClass(/diff-cell-added/);

            // id=2, name列（col 1）: HEAD版と現在版で値が同じ "ドラゴン"
            // diff-cell-added/deleted が付与されないこと
            const leftName2 = getDataCell(leftTable, 1, 1);
            await expect(leftName2).not.toHaveClass(/diff-cell-deleted/);

            const rightName2 = getDataCell(rightTable, 1, 1);
            await expect(rightName2).not.toHaveClass(/diff-cell-added/);
        },
    );

});
