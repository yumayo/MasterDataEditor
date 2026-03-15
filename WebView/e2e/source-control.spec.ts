import { test as base, expect } from '@playwright/test';
import {
    MockFileSystem,
    installMockApiAsync,
} from './fixtures/mock-api';

// =============================================================================
// ソース管理（git差分表示）テスト — FEAT_0005 / FEAT_0008
//
// FEAT_0005: アクティビティバーにgitブランチアイコン、CHANGESパネル表示
// FEAT_0008: 差分ビューのEditorTable化
//
// 実装すべき機能（FEAT_0008）:
//   1. CHANGESのテーブルをクリックすると独立した差分タブが開く（.diff-view でなく）
//   2. 差分タブの左右ペインにそれぞれ .editor-table が表示される（EditorTableベース）
//   3. changes状態: 左ペイン（HEAD版）は読み取り専用、右ペイン（現在版）は編集可能
//   4. staged状態: 左ペイン・右ペインともに読み取り専用
//   5. 「変更前」「変更後」ラベル（.diff-view-label-before 等）が表示されない
//   6. 差分行はIDソートでなくCSVファイルの行順で表示される
//   7. 左ペインをスクロールすると右ペインも同じ位置にスクロールする（双方向）
//   8. アクティビティバーのソース管理SVGアイコンが正しく表示される
//
// RED状態の理由（FEAT_0008）:
//   - 差分ビューが EditorTable ベースでなく DiffView クラスベースのため
//   - .diff-tab / .diff-pane-left / .diff-pane-right のDOMが存在しない
//   - 左ペインがEditorTableの読み取り専用として実装されていない
//   - staged状態の完全読み取り専用が実装されていない
//   - 行ファイル順表示が実装されていない（現在はPKソート）
//   - スクロール同期が実装されていない
// =============================================================================

// テスト共通データ ----------------------------------------------------------------

/**
 * 差分テスト用スキーマ
 * id, name, value の3列テーブル
 */
const TEST_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
        { key: 2, name: "value", type: "int" },
    ],
    primary_key: "id",
});

/**
 * 現在のCSV（working tree）
 *   id=1: value が 100→150 に変更
 *   id=2: 変更なし
 *   id=3: 削除された
 *   id=4: 新規追加
 */
const CURRENT_CSV = [
    "id,name,value",
    "1,item_a,150",
    "2,item_b,200",
    "4,item_d,400",
].join("\n");

/**
 * HEAD版CSV（変更前）
 *   id=1: value=100
 *   id=2: 変更なし
 *   id=3: 存在する（削除前）
 */
const HEAD_CSV = [
    "id,name,value",
    "1,item_a,100",
    "2,item_b,200",
    "3,item_c,300",
].join("\n");

/**
 * git status レスポンス（changes）
 */
const GIT_STATUS = {
    changes: [{ path: "data/test.csv", tableName: "test", isNew: false }],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

/**
 * git status レスポンス（staged — 左右ともに読み取り専用）
 */
const GIT_STATUS_STAGED = {
    changes: [] as { path: string; tableName: string; isNew: boolean }[],
    staged: [{ path: "data/test.csv", tableName: "test", isNew: false }],
};

/**
 * HEAD版ファイルマップ
 */
const HEAD_FILES: Record<string, string> = {
    "data/test.csv": HEAD_CSV,
};

/**
 * テスト用ファイルシステム（スキーマ + 現在のCSV）
 */
function createSourceControlFileSystem(): MockFileSystem {
    return {
        "schema/test.json": TEST_SCHEMA,
        "data/test.csv": CURRENT_CSV,
    };
}

// スクロール同期テスト専用フィクスチャ -----------------------------------------

/**
 * スクロール同期テスト用のCSVデータを生成する（50行）。
 * 左右ペインがスクロール可能になるよう十分な行数を確保する。
 */
function generateScrollTestData(): { headCsv: string; currentCsv: string } {
    const lines = ['id,name,value'];
    for (let i = 1; i <= 50; i++) {
        lines.push(`${i},item_${i},${i * 100}`);
    }
    const csv = lines.join('\n');
    return { headCsv: csv, currentCsv: csv };
}

const SCROLL_TEST_DATA = generateScrollTestData();

/**
 * スクロール同期テスト用のファイルシステム（50行のデータ）
 */
function createScrollTestFileSystem(): MockFileSystem {
    return {
        "schema/test.json": TEST_SCHEMA,
        "data/test.csv": SCROLL_TEST_DATA.currentCsv,
    };
}

// フィクスチャ型定義 -----------------------------------------------------------

interface SourceControlFixtures {
    /** gitステータスとHEADファイルをセットアップした状態でページを開く（changes） */
    sourceControlPage: void;
    /** staged状態でページを開く */
    sourceControlStagedPage: void;
    /** スクロール同期テスト用（50行データ、changes状態） */
    scrollSyncPage: void;
}

/**
 * ソース管理テスト用フィクスチャ（changes状態）
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync の前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<SourceControlFixtures>({
    sourceControlPage: async ({ page }, use) => {
        // gitモックデータを window に設定する（installMockApiAsync より前に実行が必須）
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createSourceControlFileSystem());
        await page.goto('/');
        await use();
    },

    sourceControlStagedPage: async ({ page }, use) => {
        // staged状態のgitモックデータを window に設定する
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS_STAGED, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createSourceControlFileSystem());
        await page.goto('/');
        await use();
    },

    scrollSyncPage: async ({ page }, use) => {
        // スクロール同期テスト用：50行データ + changes状態でモックを設定する
        const scrollHeadFiles: Record<string, string> = { "data/test.csv": SCROLL_TEST_DATA.headCsv };
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: scrollHeadFiles });

        await installMockApiAsync(page, createScrollTestFileSystem());
        await page.goto('/');
        await use();
    },
});

// テスト本体 -------------------------------------------------------------------

test.describe('ソース管理パネル', () => {

    // -------------------------------------------------------------------------
    // テスト1: アクティビティバーにソース管理アイコンが表示される
    // -------------------------------------------------------------------------
    test(
        'アクティビティバーにソース管理アイコン（[data-panel="sourceControl"]）が存在すること',
        async ({ page, sourceControlPage: _sourceControlPage }) => {
            // data-panel="sourceControl" のアイコンボタンが存在することを確認する
            const sourceControlButton = page.locator('[data-panel="sourceControl"]');
            await expect(sourceControlButton).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: ソース管理アイコンをクリックするとパネルが表示される
    // -------------------------------------------------------------------------
    test(
        'ソース管理アイコンをクリックすると .source-control-panel が表示され CHANGES・STAGED セクションが見えること',
        async ({ page, sourceControlPage: _sourceControlPage }) => {
            const sourceControlButton = page.locator('[data-panel="sourceControl"]');
            await sourceControlButton.click();

            // .source-control-panel が表示されることを確認する
            const panel = page.locator('.source-control-panel');
            await expect(panel).toBeVisible();

            // CHANGES・STAGED セクションヘッダーが存在することを確認する
            await expect(panel.getByText('CHANGES')).toBeVisible();
            await expect(panel.getByText('STAGED')).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト3: 変更のあるテーブルが CHANGES セクションに表示される
    // -------------------------------------------------------------------------
    test(
        '変更のあるテーブル名が CHANGES セクションにリスト表示されること',
        async ({ page, sourceControlPage: _sourceControlPage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // CHANGES セクションにテーブル名 "test" が表示されることを確認する
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();
            await expect(changesSection.getByText('test')).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト4: テーブルをクリックすると差分タブ（EditorTableベース）が開く
    // -------------------------------------------------------------------------
    test(
        'CHANGESセクションのテーブル名をクリックすると差分タブが開き、左右ペインに .editor-table が表示されること',
        async ({ page, sourceControlPage: _sourceControlPage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // CHANGES セクションのテーブル名をクリックする
            await page.locator('.source-control-changes-section').getByText('test').click();

            // 旧 .diff-view が表示されていないことを確認する（EditorTable化により廃止）
            // FEAT_0008: 差分ビューはEditorTableベースに変更される
            await expect(page.locator('.diff-view-label-before')).not.toBeVisible();
            await expect(page.locator('.diff-view-label-after')).not.toBeVisible();

            // 差分タブが開いていることを確認する
            // FEAT_0008: 差分タブは独立したタブとして開く
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 左ペイン（HEAD版）に .editor-table が表示されることを確認する
            const leftPane = diffTab.locator('.diff-pane-left');
            await expect(leftPane.locator('.editor-table')).toBeVisible();

            // 右ペイン（現在版）に .editor-table が表示されることを確認する
            const rightPane = diffTab.locator('.diff-pane-right');
            await expect(rightPane.locator('.editor-table')).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト5: セル変更の差分表示（左赤・右緑）
    // -------------------------------------------------------------------------
    test(
        'セル値が変更された行は左ペインが赤背景（.diff-cell-deleted）・右ペインが緑背景（.diff-cell-added）になること',
        async ({ page, sourceControlPage: _sourceControlPage }) => {
            // id=1 の value が 100→150 に変更されている
            await page.locator('[data-panel="sourceControl"]').click();
            await page.locator('.source-control-changes-section').getByText('test').click();

            const diffTab = page.locator('.diff-tab');
            const leftPane = diffTab.locator('.diff-pane-left');
            const rightPane = diffTab.locator('.diff-pane-right');

            // 左ペインのEditorTable内に .diff-cell-deleted クラスを持つセルが存在することを確認する
            // FEAT_0008: EditorTableのセルに差分クラスが付与される（RED: 未実装）
            await expect(leftPane.locator('.editor-table .diff-cell-deleted').first()).toBeVisible();

            // 右ペインのEditorTable内に .diff-cell-added クラスを持つセルが存在することを確認する
            await expect(rightPane.locator('.editor-table .diff-cell-added').first()).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト6: 行削除の差分表示（左赤のみ）
    // -------------------------------------------------------------------------
    test(
        '削除された行は左ペインに赤背景行（.diff-row-deleted）・右ペインに空白行（.diff-row-empty）が表示されること',
        async ({ page, sourceControlPage: _sourceControlPage }) => {
            // id=3 が HEAD版にのみ存在する（削除された行）
            await page.locator('[data-panel="sourceControl"]').click();
            await page.locator('.source-control-changes-section').getByText('test').click();

            const diffTab = page.locator('.diff-tab');
            const leftPane = diffTab.locator('.diff-pane-left');
            const rightPane = diffTab.locator('.diff-pane-right');

            // 左ペインに削除行（.diff-row-deleted）が存在することを確認する
            // FEAT_0008: EditorTableの行レベルで差分クラスが付与される（RED: 未実装）
            await expect(leftPane.locator('.diff-row-deleted').first()).toBeVisible();

            // 右ペインに対応する空白行（.diff-row-empty）が存在することを確認する
            await expect(rightPane.locator('.diff-row-empty').first()).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト7: 行追加の差分表示（右緑のみ）
    // -------------------------------------------------------------------------
    test(
        '追加された行は右ペインに緑背景行（.diff-row-added）・左ペインに空白行（.diff-row-empty）が表示されること',
        async ({ page, sourceControlPage: _sourceControlPage }) => {
            // id=4 が現在版にのみ存在する（新規追加行）
            await page.locator('[data-panel="sourceControl"]').click();
            await page.locator('.source-control-changes-section').getByText('test').click();

            const diffTab = page.locator('.diff-tab');
            const leftPane = diffTab.locator('.diff-pane-left');
            const rightPane = diffTab.locator('.diff-pane-right');

            // 右ペインに追加行（.diff-row-added）が存在することを確認する
            // FEAT_0008: EditorTableの行レベルで差分クラスが付与される（RED: 未実装）
            await expect(rightPane.locator('.diff-row-added').first()).toBeVisible();

            // 左ペインに対応する空白行（.diff-row-empty）が存在することを確認する
            await expect(leftPane.locator('.diff-row-empty').first()).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト8: changes状態 — 左ペイン（HEAD版）は読み取り専用、右ペイン（現在版）は編集可能
    // -------------------------------------------------------------------------
    test(
        'changes状態では左ペイン（HEAD版）のセルをダブルクリックしても編集モードにならないこと',
        async ({ page, sourceControlPage: _sourceControlPage }) => {
            await page.locator('[data-panel="sourceControl"]').click();
            await page.locator('.source-control-changes-section').getByText('test').click();

            const diffTab = page.locator('.diff-tab');
            const leftPane = diffTab.locator('.diff-pane-left');

            // 左ペイン（HEAD版）の最初のデータセルをダブルクリックする
            // FEAT_0008: 左ペインは読み取り専用（RED: 未実装）
            const firstDataRow = leftPane.locator('.editor-table .editor-table-row').nth(1);
            const firstCell = firstDataRow.locator('.editor-table-cell:not(.editor-table-row-header)').first();
            await firstCell.dblclick();

            // 編集フィールド（テキスト入力）が出現しないことを確認する
            await expect(page.locator('.grid-textfield-active')).not.toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト9: changes状態 — 右ペイン（現在版）は編集可能
    // -------------------------------------------------------------------------
    test(
        'changes状態では右ペイン（現在版）のセルをダブルクリックすると編集モードになること',
        async ({ page, sourceControlPage: _sourceControlPage }) => {
            await page.locator('[data-panel="sourceControl"]').click();
            await page.locator('.source-control-changes-section').getByText('test').click();

            const diffTab = page.locator('.diff-tab');
            const rightPane = diffTab.locator('.diff-pane-right');

            // 右ペイン（現在版）の最初のデータセルをダブルクリックする
            // FEAT_0008: 右ペインは編集可能（RED: 未実装）
            const firstDataRow = rightPane.locator('.editor-table .editor-table-row').nth(1);
            const firstCell = firstDataRow.locator('.editor-table-cell:not(.editor-table-row-header)').first();
            await firstCell.dblclick();

            // 編集フィールド（テキスト入力）が出現することを確認する
            await expect(page.locator('.grid-textfield-active')).toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト10: staged状態 — 左ペイン・右ペインともに読み取り専用
    // -------------------------------------------------------------------------
    test(
        'staged状態では左ペイン・右ペインともにセルをダブルクリックしても編集モードにならないこと',
        async ({ page, sourceControlStagedPage: _sourceControlStagedPage }) => {
            await page.locator('[data-panel="sourceControl"]').click();

            // STAGED セクションのテーブル名をクリックする
            // FEAT_0008: staged状態の差分タブも EditorTable ベース（RED: 未実装）
            const stagedSection = page.locator('.source-control-staged-section');
            await stagedSection.getByText('test').click();

            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 左ペインの最初のデータセルをダブルクリックする
            const leftPane = diffTab.locator('.diff-pane-left');
            const leftFirstCell = leftPane.locator('.editor-table .editor-table-row').nth(1)
                .locator('.editor-table-cell:not(.editor-table-row-header)').first();
            await leftFirstCell.dblclick();
            await expect(page.locator('.grid-textfield-active')).not.toBeVisible();

            // 右ペインの最初のデータセルをダブルクリックする
            const rightPane = diffTab.locator('.diff-pane-right');
            const rightFirstCell = rightPane.locator('.editor-table .editor-table-row').nth(1)
                .locator('.editor-table-cell:not(.editor-table-row-header)').first();
            await rightFirstCell.dblclick();
            await expect(page.locator('.grid-textfield-active')).not.toBeVisible();
        },
    );

    // -------------------------------------------------------------------------
    // テスト11: ファイル順表示（IDソートではなくCSV行順）
    // -------------------------------------------------------------------------
    test(
        '差分の行はIDでソートされず、CSVファイルの行順で表示されること',
        async ({ page, sourceControlPage: _sourceControlPage }) => {
            // HEAD版CSV行順: id=1, id=2, id=3
            // 現在版CSV行順: id=1, id=2, id=4
            // ファイル順表示なら: row0=id=1（変更）, row1=id=2（変更なし）, row2=id=3（削除）/id=4（追加）
            await page.locator('[data-panel="sourceControl"]').click();
            await page.locator('.source-control-changes-section').getByText('test').click();

            const diffTab = page.locator('.diff-tab');
            const rightPane = diffTab.locator('.diff-pane-right');

            // 右ペイン（現在版）のデータ行を取得する（ヘッダーを除く）
            // CSV行順（id=1, id=2, id=4の順）で表示され、削除行（id=3）の位置には空行が挿入される
            const dataRows = rightPane.locator('.editor-table .editor-table-row:not(:first-child)');
            // 新アルゴリズムでは削除行（id=3）を元の位置（index=2）に配置し、右ペインは空行（diff-row-empty）となる
            // index=0: id=1（変更あり、diff-row-modified）
            // index=1: id=2（変更なし）
            // index=2: 空行（diff-row-empty）— 左ペインの id=3 削除行に対応する右ペインの埋め合わせ行
            // index=3: id=4（追加行、diff-row-added）
            const thirdDataRow = dataRows.nth(2);
            await expect(thirdDataRow).toHaveClass(/diff-row-empty/);
            const fourthDataRow = dataRows.nth(3);
            await expect(fourthDataRow).toHaveClass(/diff-row-added/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト12: スクロール同期 — 左ペインをスクロールすると右ペインも動く
    // -------------------------------------------------------------------------
    test(
        '左ペインをスクロールすると右ペインも同じ位置にスクロールされること',
        async ({ page, scrollSyncPage: _scrollSyncPage }) => {
            // 50行データでパネルを開く（スクロール可能な行数を確保するため専用フィクスチャ使用）
            await page.locator('[data-panel="sourceControl"]').click();
            await page.locator('.source-control-changes-section').getByText('test').click();

            const diffTab = page.locator('.diff-tab');
            const leftPaneEl = diffTab.locator('.diff-pane-left');

            // 左ペインを scrollTop=50 にスクロールさせる
            // FEAT_0008: スクロール同期（RED: 未実装）
            await leftPaneEl.evaluate((el) => { el.scrollTop = 50; });

            // scrollイベントの伝搬を待ち、右ペインのスクロール位置が同期されることを確認する
            await page.waitForFunction(
                (selector) => {
                    const el = document.querySelector(selector);
                    return el !== null && (el as HTMLElement).scrollTop === 50;
                },
                '.diff-tab .diff-pane-right',
                { timeout: 2000 },
            );
            const rightScrollTop = await diffTab.locator('.diff-pane-right').evaluate((el) => el.scrollTop);
            expect(rightScrollTop).toBe(50);
        },
    );

    // -------------------------------------------------------------------------
    // テスト13: スクロール同期 — 右ペインをスクロールすると左ペインも動く
    // -------------------------------------------------------------------------
    test(
        '右ペインをスクロールすると左ペインも同じ位置にスクロールされること',
        async ({ page, scrollSyncPage: _scrollSyncPage }) => {
            // 50行データでパネルを開く（スクロール可能な行数を確保するため専用フィクスチャ使用）
            await page.locator('[data-panel="sourceControl"]').click();
            await page.locator('.source-control-changes-section').getByText('test').click();

            const diffTab = page.locator('.diff-tab');
            const rightPaneEl = diffTab.locator('.diff-pane-right');

            // 右ペインを scrollTop=80 にスクロールさせる
            // FEAT_0008: スクロール同期（RED: 未実装）
            await rightPaneEl.evaluate((el) => { el.scrollTop = 80; });

            // scrollイベントの伝搬を待ち、左ペインのスクロール位置が同期されることを確認する
            await page.waitForFunction(
                (selector) => {
                    const el = document.querySelector(selector);
                    return el !== null && (el as HTMLElement).scrollTop === 80;
                },
                '.diff-tab .diff-pane-left',
                { timeout: 2000 },
            );
            const leftScrollTop = await diffTab.locator('.diff-pane-left').evaluate((el) => el.scrollTop);
            expect(leftScrollTop).toBe(80);
        },
    );

    // -------------------------------------------------------------------------
    // テスト14: Git SVGアイコンが正しく表示される（崩れなし）
    // -------------------------------------------------------------------------
    test(
        'アクティビティバーのソース管理アイコンがSVG要素として正しくレンダリングされていること',
        async ({ page, sourceControlPage: _sourceControlPage }) => {
            const sourceControlButton = page.locator('[data-panel="sourceControl"]');
            await expect(sourceControlButton).toBeVisible();

            // ボタン内にSVG要素が存在することを確認する
            const svgEl = sourceControlButton.locator('svg');
            await expect(svgEl).toBeVisible();

            // SVGの width・height 属性が設定されていることを確認する（崩れ判定）
            // FEAT_0008: SVGアイコンが正しく表示される（RED: 崩れている場合はwidth/heightが0になる）
            const svgWidth = await svgEl.evaluate((el) => el.getAttribute('width'));
            const svgHeight = await svgEl.evaluate((el) => el.getAttribute('height'));
            expect(svgWidth).not.toBeNull();
            expect(svgHeight).not.toBeNull();
            expect(Number(svgWidth)).toBeGreaterThan(0);
            expect(Number(svgHeight)).toBeGreaterThan(0);

            // SVG内部にpath要素が存在することを確認する（空SVGでないこと）
            const pathEl = svgEl.locator('path');
            await expect(pathEl.first()).toBeVisible();
        },
    );

});
