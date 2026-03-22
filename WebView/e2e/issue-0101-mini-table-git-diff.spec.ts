import { test as base, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { getDataCell } from './fixtures/test-utils';

// =============================================================================
// ISSUE_0101: メインテーブルで編集した差分がミニテーブル・クイックビューに反映されない
//
// 不具合の概要:
//   メインテーブル（左ペイン）でセルを編集した後、そのテーブルを参照しているテーブルを
//   開いてRelationsパネルのミニテーブルに表示させると、gitの差分を示す緑色の背景
//   （cell-git-changed CSSクラス）が表示されない。
//
// 修正内容:
//   tab.ts の createMiniEditorTable() 末尾で refreshGitDiffAsync() を
//   fire-and-forget で呼ぶことにより、ミニテーブルでも GitDiffTracker が構築され
//   git差分ハイライトが正しく適用されるようになった。
// =============================================================================

// テスト共通データ ---------------------------------------------------------------

/**
 * enemy テーブルスキーマ（id, ja の2列）
 */
const ENEMY_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "ja", type: "string" },
    ],
    primary_key: ["id"],
});

/**
 * quest テーブルスキーマ（enemy.id を FK として参照する）
 */
const QUEST_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
        { key: 2, name: "enemy_id", type: "int", reference: "enemy.id" },
    ],
    primary_key: ["id"],
});

/**
 * 現在版 enemy CSV（working tree）
 *   id=1: ja が "スライム" → "スライムLv2" に変更
 *   id=2: 変更なし
 */
const CURRENT_ENEMY_CSV = [
    "id,ja",
    "1,スライムLv2",
    "2,ドラゴン",
].join("\n");

/**
 * HEAD版 enemy CSV（git show HEAD:data/enemy.csv）
 *   id=1: ja=スライム
 *   id=2: 変更なし
 */
const HEAD_ENEMY_CSV = [
    "id,ja",
    "1,スライム",
    "2,ドラゴン",
].join("\n");

/**
 * quest CSV（enemy_id=1 と enemy_id=2 を参照する2行）
 */
const QUEST_CSV = [
    "id,name,enemy_id",
    "1,first_quest,1",
    "2,second_quest,2",
].join("\n");

/**
 * git status レスポンス
 * enemy テーブルのみ変更がある（quest は clean）
 */
const GIT_STATUS = {
    changes: [
        { path: "data/enemy.csv", tableName: "enemy", isNew: false },
    ],
    staged: [],
};

/**
 * HEAD版ファイルマップ（git show でアクセスされるファイル）
 */
const HEAD_FILES: Record<string, string> = {
    "data/enemy.csv": HEAD_ENEMY_CSV,
};

/**
 * テスト用ファイルシステムを生成する
 *
 * テーブル構成:
 *   enemy: id, ja（敵名テーブル。id=1 の ja が HEAD版から変更されている）
 *   quest: id, name, enemy_id（クエスト。enemy.id を FK として参照）
 *
 * quest テーブルを開いて行を選択すると、RelationsPanel に enemy のミニテーブルが表示される。
 * enemy の id=1 行の ja 列は HEAD版から変更されているため、ミニテーブルでも
 * cell-git-changed が表示されるべき。
 */
function createMiniTableGitDiffFileSystem(): MockFileSystem {
    return {
        "schema/enemy.json": ENEMY_SCHEMA,
        "data/enemy.csv": CURRENT_ENEMY_CSV,
        "schema/quest.json": QUEST_SCHEMA,
        "data/quest.csv": QUEST_CSV,
    };
}

// フィクスチャ型定義 -------------------------------------------------------------

interface MiniTableGitDiffFixtures {
    /** git status と HEAD ファイルをセットアップした状態でページを開く */
    miniTableGitDiffPage: void;
}

/**
 * ミニテーブル git diff テスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<MiniTableGitDiffFixtures>({
    miniTableGitDiffPage: async ({ page }, use) => {
        // git モックデータを window に設定する（installMockApiAsync より前に実行が必須）
        await page.addInitScript((args: {
            status: {
                changes: { path: string; tableName: string; isNew: boolean }[];
                staged: { path: string; tableName: string; isNew: boolean }[];
            };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as {
                __mockGitHeadFiles: Record<string, string>;
            }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createMiniTableGitDiffFileSystem());
        await page.goto('/');
        await use();
    },
});

// テストユーティリティ -----------------------------------------------------------

/**
 * エクスプローラーからテーブルを開き、左ペインの EditorTable Locator を返す。
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    await page.locator('#explorer .explorer-file').getByText(tableName, { exact: true }).click();
    const table = page.locator(
        `.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`,
    );
    await expect(table).toBeVisible();
    return table;
}

// テスト本体 -------------------------------------------------------------------

test.describe('ISSUE_0101: ミニテーブルのgit差分ハイライト', () => {

    // -------------------------------------------------------------------------
    // テスト1: メインテーブルで変更があるセルがミニテーブルでも cell-git-changed になる
    // -------------------------------------------------------------------------
    test(
        'RelationsPanel のミニテーブルで、HEAD版から変更されたセルに .cell-git-changed が付与されること',
        async ({ page, miniTableGitDiffPage: _ }) => {
            // まず enemy テーブルを開いて、git diff ハイライトが正しく適用されることを確認する
            // （通常テーブルでは refreshGitDiffAsync() が呼ばれるため GREEN になるはず）
            const enemyTable = await openTableAsync(page, 'enemy');

            // enemy テーブルの id=1, ja列（row=0, col=1）は HEAD版から変更されている
            const enemyJaCell = getDataCell(enemyTable, 0, 1);
            await expect(enemyJaCell).toHaveClass(/cell-git-changed/);

            // quest テーブルを開く（enemy を FK参照している）
            await openTableAsync(page, 'quest');

            // quest の1行目（enemy_id=1）の行で RelationsPanel に enemy ミニテーブルが表示される
            // テーブルオープン直後に A1 が選択されるため、自動的に RelationsPanel が更新される
            const relationsContent = page.locator('.relations-panel-content');
            await expect(relationsContent).toBeVisible();

            // RelationsPanel 内の enemy ミニテーブルを取得する
            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();

            // ミニテーブル内の enemy id=1 の ja列（row=0, col=1）に cell-git-changed が付与されることを検証する
            const miniJaCell = getDataCell(miniTable, 0, 1);
            await expect(miniJaCell).toHaveClass(/cell-git-changed/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: ミニテーブルで変更がないセルには cell-git-changed が付与されない
    // -------------------------------------------------------------------------
    test(
        'RelationsPanel のミニテーブルで、HEAD版と同じ値のセルには .cell-git-changed が付与されないこと',
        async ({ page, miniTableGitDiffPage: _ }) => {
            // quest テーブルを開く（enemy_id=1 で RelationsPanel に enemy ミニテーブルが表示される）
            await openTableAsync(page, 'quest');

            const relationsContent = page.locator('.relations-panel-content');
            await expect(relationsContent).toBeVisible();

            // RelationsPanel 内の enemy ミニテーブルを取得する
            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();

            // enemy id=1 の id列（row=0, col=0）は HEAD版と同じ値 "1" のため cell-git-changed が付与されないこと
            // テスト1と組み合わせて、変更セルにクラスが付与される＋未変更セルには付与されないという両面を検証する
            const miniIdCell = getDataCell(miniTable, 0, 0);
            await expect(miniIdCell).not.toHaveClass(/cell-git-changed/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト3: quest の2行目（enemy_id=2）を選択して表示される enemy id=2 のミニテーブル
    //          enemy id=2 は HEAD版から変更なし → cell-git-changed が付与されないこと
    // -------------------------------------------------------------------------
    test(
        '変更がない enemy 行のミニテーブルでは全セルに .cell-git-changed が付与されないこと',
        async ({ page, miniTableGitDiffPage: _ }) => {
            // quest テーブルを開く
            const questTable = await openTableAsync(page, 'quest');

            // quest の2行目（enemy_id=2）の行ヘッダーをクリックして行を選択する
            const rowHeader = questTable.locator('.editor-table-row-header').nth(1);
            await rowHeader.click();

            const relationsContent = page.locator('.relations-panel-content');
            await expect(relationsContent).toBeVisible();

            // RelationsPanel 内の enemy ミニテーブルを取得する
            const miniTable = page.locator('.relations-panel .editor-table').first();
            await expect(miniTable).toBeVisible();

            // enemy id=2 は HEAD版から変更なし → 全セルに cell-git-changed が付与されないこと
            const miniIdCell = getDataCell(miniTable, 0, 0);
            const miniJaCell = getDataCell(miniTable, 0, 1);
            await expect(miniIdCell).not.toHaveClass(/cell-git-changed/);
            await expect(miniJaCell).not.toHaveClass(/cell-git-changed/);
        },
    );

});
