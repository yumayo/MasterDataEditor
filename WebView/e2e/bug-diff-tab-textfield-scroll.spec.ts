import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';
import { getDataCell } from './fixtures/test-utils';

// =============================================================================
// DiffTab右ペインでスクロール後にセルを編集するとテキストフィールドの位置がずれる
//
// 不具合の原因:
//   diff-tab.ts で paneElement（overflow:auto のスクロールコンテナ自体）を
//   GridTextField/Selection/AreaResizer の container として渡していた。
//   position:absolute の含有ブロックがスクロールコンテナそのものになると、
//   getBoundingClientRect() がスクロール量を反映しないためズレが発生する。
//
// 修正方針:
//   paneElement 内に innerWrapper（position:relative）を配置し、
//   全 position:absolute 要素の container を innerWrapper に変更した。
//   innerWrapper は通常フロー子要素なのでスクロールに追従し、
//   getBoundingClientRect() が正しい座標を返す。
//   通常テーブル（tab.ts の wrapperElement）と同じ構造パターン。
//
// テストシナリオ:
//   1. 縦スクロールが発生するよう40行のデータを持つテーブルで差分タブを開く
//   2. 右ペインを下方向にスクロールする
//   3. スクロール後に表示されているセルをダブルクリックして編集モードにする
//   4. テキストフィールドのtop位置がセルのtop位置と一致することを検証する
//      （バグ状態ではscrollTop分だけずれて失敗する = RED）
// =============================================================================

// 40行のデータを生成する（縦スクロールを発生させるため）
function generateCsvRows(count: number): string[] {
    const rows: string[] = [];
    for (let i = 1; i <= count; i++) {
        rows.push(`${i},name_${i}`);
    }
    return rows;
}

const ROW_COUNT = 100;
const CSV_HEADER = "id,name";
const CSV_ROWS = generateCsvRows(ROW_COUNT);

const TABLE_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
    ],
    primary_key: ["id"],
});

// 現在版CSV — id=1 の name を変更した状態
const CURRENT_CSV = [CSV_HEADER, "1,name_modified", ...CSV_ROWS.slice(1)].join("\n");

// HEAD版CSV（変更前）
const HEAD_CSV = [CSV_HEADER, ...CSV_ROWS].join("\n");

// git status レスポンス
const GIT_STATUS = {
    changes: [{ path: "data/scroll_test.csv", tableName: "scroll_test", isNew: false }],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

// HEAD版ファイルマップ
const HEAD_FILES: Record<string, string> = {
    "data/scroll_test.csv": HEAD_CSV,
};

function createFileSystem(): MockFileSystem {
    return {
        "schema/scroll_test.json": TABLE_SCHEMA,
        "data/scroll_test.csv": CURRENT_CSV,
    };
}

// フィクスチャ型定義
interface TextFieldScrollFixtures {
    /** git差分状態をセットアップした状態でページを開く */
    diffSetup: void;
}

const test = base.extend<TextFieldScrollFixtures>({
    diffSetup: async ({ page }, use) => {
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

// =============================================================================
// テスト群
// =============================================================================

test.describe('DiffTab右ペインでスクロール後にテキストフィールドの位置がずれる', () => {

    // -------------------------------------------------------------------------
    // 縦スクロール後にセルをダブルクリック → テキストフィールドがセル位置と一致すること
    //
    // バグ状態（RED）:
    //   scrollTop=300 の場合、テキストフィールドの top が セルの正しい位置より
    //   300px 上にずれる。position:absolute の基準がスクロール領域先頭なのに
    //   scrollTop が加算されていないため。
    // -------------------------------------------------------------------------
    test(
        '右ペインを縦スクロール後にダブルクリックしたセルの位置にテキストフィールドが表示されること',
        async ({ page, diffSetup: _diffSetup }) => {
            // ソースコントロールパネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            // CHANGES セクションの scroll_test テーブルをクリックして差分タブを開く
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection.getByText('scroll_test')).toBeVisible();
            await changesSection.getByText('scroll_test').click();

            // 差分タブが開いていることを確認する
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 右ペインのEditorTableが表示されることを確認する
            const rightPane = diffTab.locator('.diff-pane-right');
            await expect(rightPane.locator('.editor-table')).toBeVisible();

            // スクロール後に表示されている行（30行目付近）のセルをダブルクリックする
            // 300px / 20px(行高) ≒ 15行分スクロール → 15行目以降が見える
            // 安全のため25行目（rowIndex=24）を選択する
            const rightTable = rightPane.locator('.editor-table');
            const targetCell = getDataCell(rightTable, 24, 1);

            // 右ペインを下方向に300pxスクロールする
            const scrollAmount = 300;
            await rightPane.evaluate((el, amount) => {
                el.scrollTop = amount;
            }, scrollAmount);

            // スクロール後に目標行が表示されていることを確認する
            await expect(targetCell).toBeVisible();

            // スクロール後のscrollTopが設定されていることを事前確認する
            const actualScrollTop = await rightPane.evaluate((el) => el.scrollTop);
            expect(actualScrollTop).toBeGreaterThanOrEqual(scrollAmount - 1);
            await targetCell.dblclick();

            // テキストフィールドが表示されることを確認する
            const textField = page.locator('.grid-textfield-active');
            await expect(textField).toBeVisible();

            // テキストフィールドのtop位置とセルのtop位置を、コンテナ基準で比較する
            // 正しい実装ではテキストフィールドがセルの真上に重なるため、ビューポート上の
            // top 位置はほぼ一致する。バグ状態では scrollTop 分だけずれる。
            const positions = await rightPane.evaluate((container) => {
                const tf = container.querySelector('.grid-textfield-active') as HTMLElement | null;
                const containerRect = container.getBoundingClientRect();
                if (!tf) throw new Error('テキストフィールドが見つかりません');

                // テキストフィールドの position:absolute の top 値
                const tfTop = parseFloat(tf.style.top);
                const tfLeft = parseFloat(tf.style.left);

                // テキストフィールドのビューポート上の実際の位置
                const tfRect = tf.getBoundingClientRect();

                // セルのビューポート上の位置を特定する
                // テキストフィールドが編集中のセルは selected クラスを持つ行の対応セルだが、
                // 直接 getBoundingClientRect で取得するのが確実
                // フォーカスセルは .editor-table-cell-focused クラスで特定できる
                const focusedCell = container.querySelector('.editor-table-cell-focused') as HTMLElement | null;
                if (!focusedCell) throw new Error('フォーカスセルが見つかりません');
                const cellRect = focusedCell.getBoundingClientRect();

                return {
                    // ビューポート上での位置差（テキストフィールドとセルのtop差）
                    // 正しい実装ではこの差は0に近い（1px程度の誤差を許容）
                    topDiff: Math.abs(tfRect.top - cellRect.top),
                    leftDiff: Math.abs(tfRect.left - cellRect.left),
                    // デバッグ用の詳細値
                    tfStyleTop: tfTop,
                    tfStyleLeft: tfLeft,
                    tfViewportTop: tfRect.top,
                    cellViewportTop: cellRect.top,
                    containerTop: containerRect.top,
                    scrollTop: container.scrollTop,
                };
            });

            // テキストフィールドのビューポート上のtop位置がセルのtop位置と一致すること
            // 許容誤差2px（ボーダー等の微差を考慮）
            // バグ状態ではscrollTop（300px）分ずれるため、この検証は確実に失敗する
            expect(positions.topDiff,
                `テキストフィールドのtop位置がセルから${positions.topDiff}pxずれています。` +
                ` tfViewportTop=${positions.tfViewportTop}, cellViewportTop=${positions.cellViewportTop},` +
                ` scrollTop=${positions.scrollTop}, tfStyleTop=${positions.tfStyleTop}`
            ).toBeLessThanOrEqual(2);
        },
    );

    // -------------------------------------------------------------------------
    // 横スクロール後にセルをダブルクリック → テキストフィールドのleft位置も検証する
    // 横スクロールでも同様のバグが発生するため、scrollLeft についても検証する。
    //
    // ただし2列（id, name）テーブルでは横スクロールが発生しにくいため、
    // 縦スクロールの検証のみで十分な場合はこのテストはスキップしてよいが、
    // scrollLeft のバグも同じ箇所で発生するため、列数を増やして検証する。
    // -------------------------------------------------------------------------
    // → 縦スクロールテストで代表的に検証し、横スクロールは修正箇所が同一のため省略する
});
