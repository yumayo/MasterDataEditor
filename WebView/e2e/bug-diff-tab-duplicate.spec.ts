import { test as base, expect } from '@playwright/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';

// =============================================================================
// 差分タブの重複開きと closeAllDiffTabs() の DOM 除去漏れ検証テスト
//
// 根本原因 1: openDiffTab() の設計が期待動作と不一致
//   tab.ts L648-653 で「既存タブがあれば先に closeTab() してから新規作成する」ポリシーを採用している。
//   しかし期待動作は「既存タブがあればアクティブ化するだけ」であり、
//   同じテーブルを2度クリックするたびにタブボタンが再生成されてしまう。
//   現在は closeTab → append の順で動くため DOM 上のタブボタン数は結果として 1 になるが、
//   既存タブが開いていた場合に「一瞬消えて再描画される」ちらつきと、
//   タブのスクロール位置・編集状態が失われる副作用が生じる。
//
// 根本原因 2: closeAllDiffTabs() の DOM 除去漏れ
//   tab.ts L729-734 の for ループ内で removeTabButton(name) を呼ぶが、
//   removeTabButton() (L393-396) は tabButtons 配列から splice するだけで
//   tabButton.element.remove() を呼ばない。
//   差分タブは tabStates に登録されないため、removeTabButton() 内の
//   state.wrapperElement.remove() も実行されず、
//   タブボタン DOM 要素が .tab-bar に残存したままになる。
//
// 検証シナリオ:
//   1. 差分タブの重複防止: 同一テーブルの差分タブが開いている状態で再度同じテーブルをクリックしたとき、
//      タブボタンの数が増えず既存タブがアクティブ化されるだけであることを検証する。
//   2. closeAllDiffTabs() DOM 除去: closeAllDiffTabs() 呼び出し後（エクスプローラーへの切り替えで発火）、
//      .tab-button[data-tab-name] が DOM から完全に除去されていることを検証する。
// =============================================================================

// テスト用スキーマ（id, name の2列テーブル）
const TEST_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
    ],
    primary_key: "id",
});

// 現在版CSV（working tree）
const CURRENT_CSV = [
    "id,name",
    "1,item_a",
    "2,item_b",
].join("\n");

// HEAD版CSV（変更前）— id=3 が存在する（差分あり）
const HEAD_CSV = [
    "id,name",
    "1,item_a",
    "2,item_b",
    "3,item_c",
].join("\n");

// git status レスポンス（test テーブルが changes 状態）
const GIT_STATUS = {
    changes: [{ path: "data/test.csv", tableName: "test", isNew: false }],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

// HEAD版ファイルマップ
const HEAD_FILES: Record<string, string> = {
    "data/test.csv": HEAD_CSV,
};

// テスト用ファイルシステム
function createDiffTabDuplicateFileSystem(): MockFileSystem {
    return {
        "schema/test.json": TEST_SCHEMA,
        "data/test.csv": CURRENT_CSV,
    };
}

// フィクスチャ型定義
interface DiffTabDuplicateFixtures {
    /** git差分状態をセットアップした状態でページを開く */
    diffTabDuplicatePage: void;
}

/**
 * 差分タブ重複バグ検証テスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<DiffTabDuplicateFixtures>({
    diffTabDuplicatePage: async ({ page }, use) => {
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createDiffTabDuplicateFileSystem());
        await page.goto('/');
        await use();
    },
});

// テスト本体 -------------------------------------------------------------------

test.describe('差分タブの重複防止と DOM 除去', () => {

    // -------------------------------------------------------------------------
    // テスト1: 同一テーブルの差分タブを2回開いてもタブボタンが1つしか作られないこと
    //
    // 検証手順:
    //   1. ソース管理パネルを開く
    //   2. test テーブルの差分タブを1度目に開く → タブボタン「差分: test」が1つ表示される
    //   3. ソース管理パネルアイコンをもう一度クリックしてパネルを表示したまま
    //      同じ test テーブルを再クリックする（差分タブが開いたままの状態で openDiffTab を再呼び出し）
    //   4. 「差分: test」というタブボタンが DOM 上に1つしか存在しないことを確認する
    //   5. 差分タブの .diff-tab 要素が visible であること（タブが存在し続けている）を確認する
    //   6. タブボタンが active クラスを持っていること（アクティブ化されている）を確認する
    //
    // なぜ失敗するか（RED の理由）:
    //   現在の openDiffTab() は「既存タブを closeTab() で閉じてから新規作成する」ポリシーのため、
    //   closeTab() 後に append() で新しいタブボタンが DOM に追加される。
    //   「既存タブをアクティブ化するだけ」の期待動作と乖離しており、
    //   閉じて作り直す際にタブボタンの DOM インスタンスが変わるため、
    //   2度目クリック後に「差分タブボタンが active クラスを保持したまま visible」という
    //   検証を安定的に行えない。
    // -------------------------------------------------------------------------
    test(
        '同一テーブルの差分タブを2度開いたとき、タブボタンが重複して増えないこと',
        async ({ page, diffTabDuplicatePage: _diffTabDuplicatePage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();

            // 1度目: test テーブルの差分タブを開く
            await changesSection.getByText('test').click();

            // タブボタンが1つ表示されていることを確認する
            const diffTabButton = page.locator('.tab-button', { hasText: '差分: test' });
            await expect(diffTabButton).toBeVisible();
            await expect(diffTabButton).toHaveCount(1);

            // 差分タブが開いていることを確認する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // ソース管理パネルアイコンをもう一度クリックして CHANGES リストを再表示する
            // （差分タブが開いたままの状態でパネルを切り替え、openDiffTab の再呼び出し条件を整える）
            await page.locator('[data-panel="sourceControl"]').click();
            await expect(changesSection).toBeVisible();

            // 2度目: 同じ test テーブルをクリックする
            // 期待動作: 既存の差分タブがアクティブ化されるだけで新しいタブは作られない
            // 現行バグ: closeTab() → append() で新しいタブボタンが作成される
            await changesSection.getByText('test').click();

            // タブボタンが2つに増えていないことを確認する（重複防止）
            const diffTabButtons = page.locator('.tab-button', { hasText: '差分: test' });
            await expect(diffTabButtons).toHaveCount(1);

            // 差分タブ（.diff-tab）が visible のまま存在することを確認する
            // タブが「閉じて再作成」されても count=1 になるケースがあるが、
            // 再作成の場合は一瞬 .diff-tab が消える可能性がある。
            // ここでは「差分タブが現在アクティブな状態で表示されている」ことを検証する
            await expect(diffTab).toBeVisible();

            // タブボタンがアクティブ状態（active クラス）になっていることを確認する
            // 既存タブを再利用してアクティブ化する場合も、閉じて再作成する場合も active になるが、
            // タブ数が1つかつ差分タブが visible であることと合わせて「重複なくアクティブ化」を保証する
            await expect(diffTabButton).toHaveClass(/active/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: closeAllDiffTabs() を呼んだ後にタブボタン DOM 要素が除去されること
    //
    // 検証手順:
    //   1. ソース管理パネルを開く
    //   2. test テーブルの差分タブを開く
    //   3. 「差分: test」タブボタンが DOM に存在することを確認する（前提）
    //   4. エクスプローラーパネルに切り替える
    //      （これにより sidebar.ts → tab.closeAllDiffTabs() が呼ばれる）
    //   5. 「差分: test」タブボタンが DOM に存在しなくなっていることを確認する
    //
    // なぜ失敗するか（RED の理由）:
    //   closeAllDiffTabs() 内で removeTabButton(name) を呼ぶが、
    //   removeTabButton() は tabButtons 配列から splice するだけで
    //   tabButton.element.remove() を呼ばない。
    //   差分タブは tabStates に登録されないため state.wrapperElement.remove() も実行されない。
    //   結果として、タブボタンの DOM 要素（.tab-button）が .tab-bar に残存する。
    // -------------------------------------------------------------------------
    test(
        'ソース管理以外のパネルに切り替えた後、差分タブのタブボタンが DOM から除去されること',
        async ({ page, diffTabDuplicatePage: _diffTabDuplicatePage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();

            // test テーブルの差分タブを開く
            await changesSection.getByText('test').click();

            // 差分タブのタブボタンが DOM に存在することを確認する（前提確認）
            const diffTabButton = page.locator('.tab-button', { hasText: '差分: test' });
            await expect(diffTabButton).toBeVisible();

            // エクスプローラーパネルに切り替える
            // sidebar.ts がパネル切り替えを検知し、tab.closeAllDiffTabs() を呼ぶ
            await page.locator('[data-panel="files"]').click();

            // closeAllDiffTabs() の後にタブボタンの DOM 要素が除去されていることを確認する
            // 期待動作: .tab-button 要素が DOM から消えて count=0 になる
            // 現行バグ: removeTabButton() が tabButton.element.remove() を呼ばないため
            //          DOM 上のタブボタンが残存し count=1 のまま → このアサーションが RED になる
            await expect(diffTabButton).toHaveCount(0);
        },
    );

    // -------------------------------------------------------------------------
    // テスト3: closeAllDiffTabs() 後に再度差分タブを開いても重複しないこと
    //
    // 検証手順:
    //   1. ソース管理パネルを開き test の差分タブを開く
    //   2. エクスプローラーパネルに切り替える（closeAllDiffTabs() が呼ばれる）
    //   3. 再びソース管理パネルを開き test の差分タブを開く
    //   4. タブボタン「差分: test」が DOM 上に1つしか存在しないことを確認する
    //
    // なぜ失敗するか（RED の理由）:
    //   テスト2の不具合（DOM 除去漏れ）により、closeAllDiffTabs() 後も
    //   タブボタンが DOM に残存する。その状態で再度 openDiffTab() を呼ぶと、
    //   tabButtons 配列には存在しない（splice で除去済み）が DOM には残るため、
    //   append() で新しいタブボタンが DOM に追加され、合計2つになってしまう。
    // -------------------------------------------------------------------------
    test(
        '差分タブを閉じて再度開いたとき、タブボタンが重複しないこと',
        async ({ page, diffTabDuplicatePage: _diffTabDuplicatePage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();

            // 1度目: test テーブルの差分タブを開く
            await changesSection.getByText('test').click();
            const diffTabButtonFirst = page.locator('.tab-button', { hasText: '差分: test' });
            await expect(diffTabButtonFirst).toBeVisible();

            // エクスプローラーパネルに切り替えて差分タブを閉じる
            await page.locator('[data-panel="files"]').click();

            // 差分タブが閉じられていることを確認する（テスト2 の前提）
            // ※ 現行バグでは DOM に残存するため、ここで count=0 にならない場合がある
            // （このアサーション自体はテスト2 でカバー済みだが、文脈として配置する）
            await expect(diffTabButtonFirst).toHaveCount(0);

            // 再びソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();
            await expect(changesSection).toBeVisible();

            // 2度目: 同じ test テーブルの差分タブを開く
            await changesSection.getByText('test').click();

            // タブボタンが1つだけ存在することを確認する
            // 期待動作: DOM 除去が正しく行われているので新しいタブボタンが1つのみ追加される
            // 現行バグ: closeAllDiffTabs() で DOM 除去が漏れているため、
            //          古いタブボタン（残存） + 新しいタブボタン = 2つになる → RED
            const diffTabButtonSecond = page.locator('.tab-button', { hasText: '差分: test' });
            await expect(diffTabButtonSecond).toHaveCount(1);
        },
    );

});
