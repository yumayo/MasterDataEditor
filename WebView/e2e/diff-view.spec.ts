import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { Page } from '@playwright/test';

// =============================================================================
// diff-tab リサイズハンドル テスト
//
// 検証要件:
//   1. diff-tab を開いたとき .diff-resize-handle が存在すること
//   2. ドラッグ操作で左右ペインの幅が変わること
//   3. ドラッグ後、左ペイン（.diff-pane-left）の flex-basis がパーセンテージで設定されること
//   4. 最小20%〜最大80%の範囲にクランプされること
// =============================================================================

// テスト用スキーマ（id, name の2列テーブル）
const QUEST_REWARD_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
    ],
    primary_key: ["id"],
});

// 現在版CSV（working tree）— id=1 の name を変更した状態
const CURRENT_QUEST_REWARD_CSV = [
    "id,name",
    "1,reward_modified",
    "2,reward_b",
].join("\n");

// HEAD版CSV（変更前）
const HEAD_QUEST_REWARD_CSV = [
    "id,name",
    "1,reward_original",
    "2,reward_b",
].join("\n");

// git status レスポンス（quest_reward が変更あり）
const GIT_STATUS = {
    changes: [{ path: "data/quest_reward.csv", tableName: "quest_reward", isNew: false }],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

// HEAD版ファイルマップ
const HEAD_FILES: Record<string, string> = {
    "data/quest_reward.csv": HEAD_QUEST_REWARD_CSV,
};

function createDiffViewFileSystem(): MockFileSystem {
    return {
        "schema/quest_reward.json": QUEST_REWARD_SCHEMA,
        "data/quest_reward.csv": CURRENT_QUEST_REWARD_CSV,
    };
}

// フィクスチャ型定義
interface DiffViewFixtures {
    /** git差分状態をセットアップした状態でページを開く */
    diffViewPage: void;
}

/**
 * diff-viewリサイズテスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<DiffViewFixtures>({
    diffViewPage: async ({ page }, use) => {
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createDiffViewFileSystem());
        await page.goto('/');
        await use();
    },
});

/**
 * diff-tabを開いてLocatorを返すヘルパー
 */
async function openDiffTabAsync(page: Page): Promise<void> {
    await page.locator('[data-panel="sourceControl"]').click();
    const changesSection = page.locator('.source-control-changes-section');
    await expect(changesSection.getByText('quest_reward')).toBeVisible();
    await changesSection.getByText('quest_reward').click();
    await expect(page.locator('.diff-tab')).toBeVisible();
}

/**
 * .diff-resize-handle をX軸方向に指定ピクセルドラッグするヘルパー
 * deltaX > 0 → 右ドラッグ（左ペイン拡大）
 * deltaX < 0 → 左ドラッグ（左ペイン縮小）
 */
async function dragDiffResizeHandleAsync(page: Page, deltaX: number): Promise<void> {
    const handle = page.locator('.diff-resize-handle');
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('.diff-resize-handle の boundingBox が取得できません');
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + deltaX, startY);
    await page.mouse.up();
}

// =============================================================================
// テスト群
// =============================================================================

test.describe('diff-tab リサイズハンドル', () => {

    // -------------------------------------------------------------------------
    // テスト1: .diff-resize-handle が存在すること
    //
    // プロダクションコードにリサイズハンドルのDOM生成がないため RED になる
    // -------------------------------------------------------------------------
    test(
        'diff-tabを開いたとき .diff-resize-handle が存在すること',
        async ({ page, diffViewPage: _diffViewPage }) => {
            await openDiffTabAsync(page);

            const handle = page.locator('.diff-resize-handle');
            await expect(handle).toHaveCount(1);
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: ドラッグ操作で左右ペインの幅が変わること
    //
    // ハンドルを右に100pxドラッグすると左ペインが広がること（幅増加）を確認する
    // プロダクションコードにドラッグリサイズ処理がないため RED になる
    // -------------------------------------------------------------------------
    test(
        'リサイズハンドルを右にドラッグすると左ペインの幅が増加すること',
        async ({ page, diffViewPage: _diffViewPage }) => {
            await openDiffTabAsync(page);

            // ドラッグ前の左ペイン幅を取得する
            const beforeWidth = await page.evaluate(() => {
                const el = document.querySelector('.diff-pane-left') as HTMLElement | null;
                if (!el) throw new Error('.diff-pane-left が見つかりません');
                return el.getBoundingClientRect().width;
            });

            // ハンドルを右に100pxドラッグ（左ペイン拡大方向）
            await dragDiffResizeHandleAsync(page, 100);

            // ドラッグ後の左ペイン幅が増加していることを確認する
            const afterWidth = await page.evaluate(() => {
                const el = document.querySelector('.diff-pane-left') as HTMLElement | null;
                if (!el) throw new Error('.diff-pane-left が見つかりません');
                return el.getBoundingClientRect().width;
            });

            expect(afterWidth).toBeGreaterThan(beforeWidth);
        },
    );

    // -------------------------------------------------------------------------
    // テスト3: ドラッグ後の flex-basis がパーセンテージで設定されること
    //
    // px ではなく % で設定されることで、ウィンドウリサイズ後もプロポーションが維持される。
    // RelationsPanelのリサイズ（.editor-right-slot）と同パターン。
    // プロダクションコードに flex-basis のパーセンテージ設定処理がないため RED になる
    // -------------------------------------------------------------------------
    test(
        'リサイズハンドルをドラッグした後、左ペイン（.diff-pane-left）のflex-basisがパーセンテージで設定されること',
        async ({ page, diffViewPage: _diffViewPage }) => {
            await openDiffTabAsync(page);

            // ハンドルを右に80pxドラッグ
            await dragDiffResizeHandleAsync(page, 80);

            // ドラッグ後の .diff-pane-left の style.flexBasis を確認する
            const flexBasis = await page.evaluate(() => {
                const el = document.querySelector('.diff-pane-left') as HTMLElement | null;
                if (!el) throw new Error('.diff-pane-left が見つかりません');
                return el.style.flexBasis;
            });

            // flex-basis がパーセンテージで設定されていることを確認する
            expect(flexBasis).toContain('%');
            expect(flexBasis).not.toContain('px');
        },
    );

    // -------------------------------------------------------------------------
    // テスト4-a: 最小クランプ — 左に大きくドラッグしても20%未満にならないこと
    //
    // ハンドルを左に2000pxドラッグ（左ペインをほぼゼロにしようとする）しても、
    // flex-basis が20%以上に保たれることを確認する。
    // プロダクションコードにクランプ処理がないため RED になる
    // -------------------------------------------------------------------------
    test(
        'リサイズハンドルを左に大きくドラッグしても左ペインのflex-basisが20%を下回らないこと',
        async ({ page, diffViewPage: _diffViewPage }) => {
            await openDiffTabAsync(page);

            // 左に2000px（コンテナ幅を超える量）ドラッグして左ペインを最小化しようとする
            await dragDiffResizeHandleAsync(page, -2000);

            const flexBasis = await page.evaluate(() => {
                const el = document.querySelector('.diff-pane-left') as HTMLElement | null;
                if (!el) throw new Error('.diff-pane-left が見つかりません');
                return el.style.flexBasis;
            });

            // flex-basis が % で設定されていることを確認する
            expect(flexBasis).toContain('%');
            // 数値を取り出してクランプ下限を確認する
            const value = parseFloat(flexBasis);
            expect(value).toBeGreaterThanOrEqual(20);
        },
    );

    // -------------------------------------------------------------------------
    // テスト4-b: 最大クランプ — 右に大きくドラッグしても80%を超えないこと
    //
    // ハンドルを右に2000pxドラッグ（左ペインを最大化しようとする）しても、
    // flex-basis が80%以下に保たれることを確認する。
    // プロダクションコードにクランプ処理がないため RED になる
    // -------------------------------------------------------------------------
    test(
        'リサイズハンドルを右に大きくドラッグしても左ペインのflex-basisが80%を超えないこと',
        async ({ page, diffViewPage: _diffViewPage }) => {
            await openDiffTabAsync(page);

            // 右に2000px（コンテナ幅を超える量）ドラッグして左ペインを最大化しようとする
            await dragDiffResizeHandleAsync(page, 2000);

            const flexBasis = await page.evaluate(() => {
                const el = document.querySelector('.diff-pane-left') as HTMLElement | null;
                if (!el) throw new Error('.diff-pane-left が見つかりません');
                return el.style.flexBasis;
            });

            // flex-basis が % で設定されていることを確認する
            expect(flexBasis).toContain('%');
            // 数値を取り出してクランプ上限を確認する
            const value = parseFloat(flexBasis);
            expect(value).toBeLessThanOrEqual(80);
        },
    );

});
