import { test as base, expect } from '@playwright/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';

// =============================================================================
// 複数差分タブの独立管理バグ検証テスト
//
// 根本原因:
//   Tab クラスの差分タブ管理が単一フィールド（this.diffTab, this.diffTabTableName）で
//   行われているため、2つ目の差分タブを開くと1つ目のフィールドが上書きされる。
//
//   結果として以下の不具合が発生する:
//   A) openDiffTab() で2つ目のタブを開くと this.diffTab が上書きされ、
//      1つ目のDiffTabのwrapperElementが destroy() されずDOMに残留する。
//   B) enableTabButton(通常テーブル) での this.diffTab.hide() が最後の1つにしか呼ばれず、
//      先に開いた差分タブのwrapperElementが表示されたまま残る。
//   C) activateDiffTab() で this.diffTab.show() を呼ぶが、タブ名に関わらず
//      「最後に生成したDiffTab」を指すため、1つ目の差分タブに切り替えても
//      2つ目の差分内容（=this.diffTab）が表示される。
//
// 検証シナリオ:
//   1. 複数差分タブの独立表示:
//      quest_reward と shop_product の2テーブルをそれぞれ1行削除→保存→
//      gitソースコントロールから両方の差分タブを開く→
//      各差分タブに切り替えた時に、そのテーブルの差分のみが表示されていること
//   2. 通常タブ切替時の差分非表示:
//      差分タブを2つ開いた後、通常テーブルを開いたとき
//      両方の差分タブが非表示（display:none）になっていること
// =============================================================================

// テスト用スキーマ（quest_reward: id, group_id, name の3列テーブル）
const QUEST_REWARD_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "group_id", type: "int" },
        { key: 2, name: "name", type: "string" },
    ],
    primary_key: "id",
});

// quest_reward 現在版（working tree）— id=1 の行を削除した状態
const CURRENT_QUEST_REWARD_CSV = [
    "id,group_id,name",
    "2,1,gold_medium",
    "3,2,item_potion",
].join("\n");

// quest_reward HEAD版（変更前）— id=1 が存在する
const HEAD_QUEST_REWARD_CSV = [
    "id,group_id,name",
    "1,1,gold_small",
    "2,1,gold_medium",
    "3,2,item_potion",
].join("\n");

// テスト用スキーマ（shop_product: id, shop_id, item の3列テーブル）
const SHOP_PRODUCT_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "shop_id", type: "int" },
        { key: 2, name: "item", type: "string" },
    ],
    primary_key: "id",
});

// shop_product 現在版（working tree）— id=1 の行を削除した状態
const CURRENT_SHOP_PRODUCT_CSV = [
    "id,shop_id,item",
    "2,1,Shield",
    "3,2,Potion",
].join("\n");

// shop_product HEAD版（変更前）— id=1 が存在する
const HEAD_SHOP_PRODUCT_CSV = [
    "id,shop_id,item",
    "1,1,Sword",
    "2,1,Shield",
    "3,2,Potion",
].join("\n");

// git status レスポンス（両テーブルが changes 状態）
const GIT_STATUS = {
    changes: [
        { path: "data/quest_reward.csv", tableName: "quest_reward", isNew: false },
        { path: "data/shop_product.csv", tableName: "shop_product", isNew: false },
    ],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

// HEAD版ファイルマップ（両テーブル）
const HEAD_FILES: Record<string, string> = {
    "data/quest_reward.csv": HEAD_QUEST_REWARD_CSV,
    "data/shop_product.csv": HEAD_SHOP_PRODUCT_CSV,
};

// テスト用ファイルシステム（2テーブル分のスキーマ＋現在版CSV）
function createDiffTabPerFileFileSystem(): MockFileSystem {
    return {
        "schema/quest_reward.json": QUEST_REWARD_SCHEMA,
        "data/quest_reward.csv": CURRENT_QUEST_REWARD_CSV,
        "schema/shop_product.json": SHOP_PRODUCT_SCHEMA,
        "data/shop_product.csv": CURRENT_SHOP_PRODUCT_CSV,
    };
}

// フィクスチャ型定義
interface DiffTabPerFileFixtures {
    /** git差分状態（2テーブル）をセットアップした状態でページを開く */
    diffTabPerFilePage: void;
}

/**
 * 複数差分タブバグ検証テスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<DiffTabPerFileFixtures>({
    diffTabPerFilePage: async ({ page }, use) => {
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createDiffTabPerFileFileSystem());
        await page.goto('/');
        await use();
    },
});

// テスト本体 -------------------------------------------------------------------

test.describe('複数差分タブの独立管理', () => {

    // -------------------------------------------------------------------------
    // テスト1: quest_rewardの差分タブにはquest_rewardの削除行のみ表示されること
    //
    // 検証手順:
    //   1. ソース管理パネルを開く
    //   2. quest_reward の差分タブを開く
    //   3. shop_product の差分タブを開く
    //   4. quest_reward の差分タブに切り替える
    //   5. 左ペインに quest_reward の削除行（id=1, gold_small）が表示されること
    //   6. shop_product の削除行（id=1, Sword）は左ペインに表示されないこと
    //
    // なぜ失敗するか（RED の理由）:
    //   shop_product の差分タブを開くと this.diffTab が shop_product の DiffTab に上書きされる。
    //   quest_reward タブに切り替えると activateDiffTab() が this.diffTab.show() を呼ぶが、
    //   this.diffTab は shop_product の DiffTab を指しているため shop_product の差分が表示される。
    // -------------------------------------------------------------------------
    test(
        'quest_reward差分タブに切り替えたとき、quest_rewardの削除行（gold_small）のみが表示されること',
        async ({ page, diffTabPerFilePage: _diffTabPerFilePage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();

            // 1つ目: quest_reward の差分タブを開く
            await changesSection.getByText('quest_reward').click();
            const questDiffTabButton = page.locator('.tab-button', { hasText: '差分: quest_reward' });
            await expect(questDiffTabButton).toBeVisible();

            // 2つ目: shop_product の差分タブを開く（this.diffTab が上書きされるバグが発生する）
            await page.locator('[data-panel="sourceControl"]').click();
            await changesSection.getByText('shop_product').click();
            const shopDiffTabButton = page.locator('.tab-button', { hasText: '差分: shop_product' });
            await expect(shopDiffTabButton).toBeVisible();

            // quest_reward の差分タブに切り替える
            await questDiffTabButton.click();

            // 差分タブが表示されていることを確認する（複数の.diff-tabが存在するため表示中wrapperで絞り込む）
            const diffTab = page.locator('.diff-tab-wrapper:not([style*="display: none"]) .diff-tab');
            await expect(diffTab).toBeVisible();

            // 左ペイン（HEAD版）に quest_reward の削除行が表示されること
            // HEAD版には id=1（gold_small）が存在し、現在版では削除されている
            // 削除行は .diff-row-deleted クラスを持つ行として表示される
            const leftPane = diffTab.locator('.diff-pane-left');
            await expect(leftPane).toBeVisible();

            // quest_reward の削除行（gold_small）が左ペインに表示されること
            // 現行バグでは shop_product の差分タブが表示されるため gold_small が見えない
            const deletedRow = leftPane.locator('.diff-row-deleted');
            await expect(deletedRow).toBeVisible();

            // 削除行のセル内容が quest_reward の行（gold_small）であることを確認する
            // shop_product の削除行（Sword）は表示されないはず
            const deletedCells = deletedRow.locator('.editor-table-cell:not(.editor-table-row-header)');
            // 3列目（nameカラム, インデックス=2）の値が gold_small であること
            await expect(deletedCells.nth(2)).toHaveText('gold_small');
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: shop_productの差分タブが表示中に、quest_rewardのwrapperElementが残留しないこと
    //
    // 検証手順:
    //   1. ソース管理パネルを開く
    //   2. quest_reward の差分タブを開く
    //   3. shop_product の差分タブを開く（shop_product がアクティブ）
    //   4. 左ペインに shop_product の削除行（id=1, Sword）が表示されること
    //   5. 表示されている .diff-tab-wrapper が1つだけであること（quest_rewardのwrapperが残留しないこと）
    //
    // なぜ失敗するか（RED の理由）:
    //   openDiffTab() で2つ目のタブを開くと this.diffTab が上書きされ、
    //   1つ目の DiffTab（quest_reward）の wrapperElement が destroy() されずDOMに残留する。
    //   さらに 2つ目の差分タブを開く際に closeTab(quest_reward) が呼ばれず
    //   1つ目の wrapperElement が display:'' のまま残るため、
    //   表示されている .diff-tab-wrapper が2つ存在してしまう。
    // -------------------------------------------------------------------------
    test(
        'shop_product差分タブ表示中は、quest_rewardのwrapperElementが残留せず表示中の差分タブは1つであること',
        async ({ page, diffTabPerFilePage: _diffTabPerFilePage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();

            // quest_reward の差分タブを開く（1つ目）
            await changesSection.getByText('quest_reward').click();
            await expect(page.locator('.tab-button', { hasText: '差分: quest_reward' })).toBeVisible();

            // shop_product の差分タブを開く（2つ目 = アクティブ）
            // この時点で this.diffTab が shop_product の DiffTab に上書きされ、
            // quest_reward の wrapperElement が残留するバグが発生する
            await page.locator('[data-panel="sourceControl"]').click();
            await changesSection.getByText('shop_product').click();
            await expect(page.locator('.tab-button', { hasText: '差分: shop_product' })).toBeVisible();

            // 表示されている .diff-tab-wrapper が1つだけであること
            // 正しい実装では quest_reward の wrapperElement が非表示（または削除）になるはず
            // 現行バグでは quest_reward の wrapperElement が display:'' のまま残留し2つ見える
            const visibleDiffTabWrappers = page.locator('.diff-tab-wrapper:not([style*="display: none"])');
            await expect(visibleDiffTabWrappers).toHaveCount(1);

            // 表示されている差分タブが shop_product の内容であることを確認する
            const leftPane = page.locator('.diff-tab-wrapper:not([style*="display: none"]) .diff-pane-left');
            const deletedRow = leftPane.locator('.diff-row-deleted');
            await expect(deletedRow).toBeVisible();

            // 削除行の3列目（itemカラム）が Sword（shop_product の削除行）であること
            const deletedCells = deletedRow.locator('.editor-table-cell:not(.editor-table-row-header)');
            await expect(deletedCells.nth(2)).toHaveText('Sword');
        },
    );

    // -------------------------------------------------------------------------
    // テスト3: 通常タブ切替時に全差分タブが非表示になること
    //
    // 検証手順:
    //   1. ソース管理パネルを開く
    //   2. quest_reward の差分タブを開く
    //   3. shop_product の差分タブを開く
    //   4. エクスプローラーから quest_reward テーブルを通常タブで開く
    //   5. 差分タブのwrapperElement（.diff-tab-wrapper）がすべて非表示になっていること
    //
    // なぜ失敗するか（RED の理由）:
    //   enableTabButton(通常テーブル) では this.diffTab.hide() を1回しか呼ばない。
    //   this.diffTab は最後に生成されたDiffTab（shop_product）を指すため、
    //   1つ目のDiffTab（quest_reward）の wrapperElement は表示されたままになる。
    // -------------------------------------------------------------------------
    test(
        '2つの差分タブを開いた後に通常テーブルタブを開くと、全差分タブのwrapperElementが非表示になること',
        async ({ page, diffTabPerFilePage: _diffTabPerFilePage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();

            // quest_reward の差分タブを開く（1つ目）
            await changesSection.getByText('quest_reward').click();
            await expect(page.locator('.tab-button', { hasText: '差分: quest_reward' })).toBeVisible();

            // shop_product の差分タブを開く（2つ目）
            await page.locator('[data-panel="sourceControl"]').click();
            await changesSection.getByText('shop_product').click();
            await expect(page.locator('.tab-button', { hasText: '差分: shop_product' })).toBeVisible();

            // 通常タブ切替前: 差分タブが表示されていることを確認する（複数の.diff-tabが存在するため表示中wrapperで絞り込む）
            await expect(page.locator('.diff-tab-wrapper:not([style*="display: none"]) .diff-tab')).toBeVisible();

            // エクスプローラーパネルに切り替えてから quest_reward テーブルを通常タブとして開く
            await page.locator('[data-panel="files"]').click();
            await page.locator('#explorer .explorer-file').getByText('quest_reward', { exact: true }).click();
            // 通常テーブルタブが開いていることを確認する
            const normalTable = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="quest_reward"] .editor-table`);
            await expect(normalTable).toBeVisible();

            // 全差分タブのwrapperElement（.diff-tab-wrapper）が存在しないこと
            // エクスプローラーパネルに切り替えた時点で closeAllDiffTabs() が呼ばれ、
            // 全差分タブが destroy() で破棄されるため DOM から消える
            await expect(page.locator('.diff-tab-wrapper')).toHaveCount(0);
        },
    );

    // -------------------------------------------------------------------------
    // テスト4: quest_reward差分タブがアクティブなとき、quest_rewardの差分内容が表示されること
    //          （shop_productとの切り替えを繰り返したあとも正しく表示されること）
    //
    // 検証手順:
    //   1. ソース管理パネルを開く
    //   2. quest_reward の差分タブを開く
    //   3. shop_product の差分タブを開く（shop_product がアクティブ）
    //   4. quest_reward の差分タブに切り替える
    //   5. 再度 shop_product の差分タブに切り替える
    //   6. 再度 quest_reward の差分タブに切り替える
    //   7. 左ペインの削除行が quest_reward の gold_small であること
    //      （shop_product の Sword は表示されていないこと）
    //
    // なぜ失敗するか（RED の理由）:
    //   activateDiffTab() は this.diffTab.show() を呼ぶが this.diffTab は単一フィールド。
    //   どの差分タブを切り替えても「最後に生成したDiffTab（shop_product）」が show() される。
    //   quest_reward タブが active でも shop_product の差分が左ペインに表示されてしまう。
    // -------------------------------------------------------------------------
    test(
        '差分タブをshop_product→quest_reward→shop_product→quest_rewardと切り替えた後も、quest_rewardの削除行（gold_small）が正しく表示されること',
        async ({ page, diffTabPerFilePage: _diffTabPerFilePage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();

            // quest_reward の差分タブを開く（1つ目）
            await changesSection.getByText('quest_reward').click();
            await expect(page.locator('.tab-button', { hasText: '差分: quest_reward' })).toBeVisible();

            // shop_product の差分タブを開く（2つ目、アクティブになる）
            await page.locator('[data-panel="sourceControl"]').click();
            await changesSection.getByText('shop_product').click();
            await expect(page.locator('.tab-button', { hasText: '差分: shop_product' })).toBeVisible();

            // quest_reward タブに切り替える（1回目）
            await page.locator('.tab-button', { hasText: '差分: quest_reward' }).click();

            // shop_product タブに切り替える
            await page.locator('.tab-button', { hasText: '差分: shop_product' }).click();

            // quest_reward タブに切り替える（2回目）
            await page.locator('.tab-button', { hasText: '差分: quest_reward' }).click();

            // quest_reward 差分タブの内容が表示されていること
            // 現行バグでは activateDiffTab() が shop_product の DiffTab.show() を呼ぶため
            // quest_reward タブが active でも shop_product の差分内容が表示される
            const visibleWrapper = page.locator('.diff-tab-wrapper:not([style*="display: none"])');
            await expect(visibleWrapper).toHaveCount(1);

            const leftPane = visibleWrapper.locator('.diff-pane-left');
            const deletedRow = leftPane.locator('.diff-row-deleted');
            await expect(deletedRow).toBeVisible();

            // 削除行の3列目（name/itemカラム）が gold_small（quest_reward の削除行）であること
            // 現行バグでは shop_product の DiffTab が表示されるため Sword が見えてしまう
            const deletedCells = deletedRow.locator('.editor-table-cell:not(.editor-table-row-header)');
            await expect(deletedCells.nth(2)).toHaveText('gold_small');
        },
    );

});
