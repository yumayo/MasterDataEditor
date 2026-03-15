import { test as base, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';

// =============================================================================
// BUG_0021 REDテスト — スキーマのkeyが非連番のときソート・差分ビューがずれる
//
// 不具合の根本原因:
//   スキーマのkeyが非連番（例: 0,3,4,5,7）の場合、
//   ストア列インデックスとDOM列インデックスが一致しない。
//
//   問題1（ソート）: column-sorter.ts computeSortedIndices L174
//     `key.columnIndex`（DOM列インデックス）をそのまま `storeRows[row][key.columnIndex]` に使っている。
//     attack（DOM列1）でソートすると storeRows[row][1]（col1、CSV列1）を参照してしまう。
//     正しくは storeRows[row][3]（attackはCSV列3）を参照すべき。
//
//   問題2（差分ビュー）: diff-tab.ts L80
//     `columnCount = schema.header.length`（=5）でCSV8列データを5列と見なす。
//     changedColumnIndices は CSV列インデックス（0〜7）だが、applyDiffClasses で
//     5列のEditorTableに getCell(row, colIdx+1) すると範囲外→例外→DiffTabコンストラクタが
//     クラッシュ→差分ビュー非表示。
//
// テスト用テーブル構成:
//   スキーマ: item（key: 0=id, 3=attack, 4=defense, 5=recover_hp, 7=special）
//   CSV: 8列（id, col1, col2, attack, defense, recover_hp, xxx, special）
//   DOM列: 0=id, 1=attack, 2=defense, 3=recover_hp, 4=special
//   ストア列: 0=id, 1=col1, 2=col2, 3=attack, 4=defense, 5=recover_hp, 6=xxx, 7=special
// =============================================================================

// =============================================================================
// テスト共通データ
// =============================================================================

/**
 * 非連番keyスキーマ: key=0,3,4,5,7（5列のみ定義し8列CSVの一部だけ表示する）
 * これがBUG_0021の核心: DOM列インデックスとCSV列インデックスが一致しない
 */
const ITEM_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id",            type: "int" },
        { key: 3, name: "attack",        type: "int" },
        { key: 4, name: "defense",       type: "int" },
        { key: 5, name: "recover_hp",    type: "int" },
        { key: 7, name: "special",       type: "string" },
    ],
    primary_key: "id",
});

/**
 * 8列のCSV（スキーマで定義されていない col1, col2, xxx 列を含む）
 * attack（CSV列3）の値: 50, 10, 80
 * recover_hp（CSV列1=DOM列... ではなく CSV列5）の値: 5, 20, 1
 *
 * DOM列1（attack）でソートすると、正しい昇順は: id=2(10), id=1(50), id=3(80)
 * バグ状態: DOM列インデックス1をCSV列1として参照→col1でソート→値 "c1b"等の文字列ソート
 *
 * ソートで明確に検証できるよう attack の値は 50, 10, 80 の順（ランダム）にする
 * col1（CSV列1）の値は意図的に attack とは異なる順序にする（バグ検出のため）
 */
const ITEM_CSV = [
    "id,col1,col2,attack,defense,recover_hp,xxx,special",
    "1,c1a,c2a,50,30,5,x1,fire",
    "2,c1b,c2b,10,40,20,x2,ice",
    "3,c1c,c2c,80,20,1,x3,wind",
].join("\n");

/**
 * HEAD版CSV（差分ビューテスト用）
 * 現在版（ITEM_CSV）と id=1 の recover_hp（CSV列5、インデックス5）が異なる（5→999）
 * changedColumnIndices に 5（≥ schema.header.length=5）が含まれる modified 行を生成する。
 * diff-tab.ts の applyDiffClasses が getCell(row, colIdx+1=6) を呼び、
 * 5列テーブルへの範囲外アクセスでクラッシュすることをテストする。
 */
const HEAD_ITEM_CSV = [
    "id,col1,col2,attack,defense,recover_hp,xxx,special",
    "1,c1a,c2a,50,30,999,x1,fire",
    "2,c1b,c2b,10,40,20,x2,ice",
    "3,c1c,c2c,80,20,1,x3,wind",
].join("\n");

// =============================================================================
// テストユーティリティ
// =============================================================================

/**
 * テーブルをエクスプローラーから開き、左ペインのLocatorを返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    await page.locator('#explorer').getByText(tableName, { exact: true }).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/**
 * テーブルのデータ行（バッファ空行を除く）の指定列のテキスト一覧を取得する
 * colIndex: 0始まり（行ヘッダーを除く）
 */
async function getColumnValuesAsync(table: Locator, colIndex: number): Promise<string[]> {
    const dataRows = table.locator('.editor-table-row:not(.editor-table-empty-row)');
    const count = await dataRows.count();
    const values: string[] = [];
    // nth(0) はヘッダー行（editor-table-column-header-row）なのでスキップ
    for (let i = 1; i < count; i++) {
        const cell = dataRows.nth(i).locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
        values.push(await cell.innerText());
    }
    return values;
}

/**
 * 指定した列ヘッダーのソートインジケーターをクリックする
 * colIndex: 0始まり（行ヘッダー列を除く）
 */
async function clickSortIndicatorAsync(table: Locator, colIndex: number): Promise<void> {
    const headerRow = table.locator('.editor-table-column-header-row');
    const headerCell = headerRow.locator('.editor-table-column-header').nth(colIndex);
    const sortIndicator = headerCell.locator('.sort-indicator');
    await sortIndicator.click();
}

// =============================================================================
// フィクスチャ
// =============================================================================

interface Bug0021Fixtures {
    /** 非連番keyスキーマのitemテーブルをそのまま開いた状態 */
    nonSeqKeyPage: void;
    /** 非連番keyスキーマで差分ビュー検証用（git status + HEAD版ファイルあり） */
    nonSeqKeyDiffPage: void;
}

/**
 * ソートテスト用フィクスチャ: git statusなし（通常の編集シナリオ）
 */
const test = base.extend<Bug0021Fixtures>({
    nonSeqKeyPage: async ({ page }, use) => {
        const fs: MockFileSystem = {
            "schema/item.json": ITEM_SCHEMA,
            "data/item.csv": ITEM_CSV,
        };
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await use();
    },

    nonSeqKeyDiffPage: async ({ page }, use) => {
        // 差分ビューテスト用: HEAD版とgit statusをセットアップする
        // HEAD版と現在版ではid=1行のrecover_hp（CSV列5）が異なる（999→5）。
        // これにより buildDiffRows が kind='modified' かつ changedColumnIndices={5} のDiffRowを生成する。
        // changedColumnIndices=5 は schema.header.length=5 以上なので、applyDiffClasses が
        // 5列テーブルに getCell(row, 6) を呼び出して範囲外アクセスでクラッシュする。
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: object[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, {
            status: {
                changes: [{ path: "data/item.csv", tableName: "item", isNew: false }],
                staged: [],
            },
            headFiles: { "data/item.csv": HEAD_ITEM_CSV },
        });

        const fs: MockFileSystem = {
            "schema/item.json": ITEM_SCHEMA,
            "data/item.csv": ITEM_CSV,
        };
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await use();
    },
});

// =============================================================================
// テストケース
// =============================================================================

test.describe('BUG_0021: 非連番keyスキーマでのソート・差分ビューずれ', () => {

    // -------------------------------------------------------------------------
    // テストケース1: ソート — 非連番keyテーブルでattack列ソートが正しい列の値で行われること
    //
    // 検証方法:
    //   attack（DOM列1、CSV列3）のソートインジケーターをクリックする。
    //   正しい実装: attack列の値（10, 50, 80）で昇順ソート → id列は 2, 1, 3 の順
    //   バグ状態: DOM列インデックス1をCSV列1（col1）として参照 → c1a, c1b, c1c の文字列ソート
    //
    // col1（CSV列1）の値は c1a, c1b, c1c（既にソート済みに見える順序）
    // attack（CSV列3）の値は 50, 10, 80（バラバラな順序）
    // そのためDOMに表示されるid列の並び順を見れば、どちらの列でソートされたか判定できる:
    //   正しい昇順: attack昇順(10,50,80) → id列: 2, 1, 3
    //   バグ昇順: col1昇順(c1a,c1b,c1c) → id列: 1, 2, 3（元の順のまま変わらない）
    // -------------------------------------------------------------------------
    test(
        '非連番keyスキーマのattack列（DOM列1=CSV列3）を昇順ソートするとattackの値順に並ぶこと',
        async ({ page, nonSeqKeyPage: _nonSeqKeyPage }) => {
            const table = await openTableAsync(page, 'item');

            // ソート前: id列の順序は 1, 2, 3（CSV登録順）
            const beforeSort = await getColumnValuesAsync(table, 0);
            expect(beforeSort).toEqual(['1', '2', '3']);

            // attack列（DOM列インデックス1）を昇順ソートする
            await clickSortIndicatorAsync(table, 1);

            // attack値の昇順: id=2(attack=10) < id=1(attack=50) < id=3(attack=80)
            // 正しいソート後のid列: ['2', '1', '3']
            // バグ状態ではcol1列（c1a < c1b < c1c）でソートされるためid列: ['1', '2', '3'] のまま
            const afterSort = await getColumnValuesAsync(table, 0);
            expect(afterSort).toEqual(['2', '1', '3']);

            // attack列（DOM列1）の値が実際に昇順になっていることを確認する
            const attackValues = await getColumnValuesAsync(table, 1);
            expect(attackValues).toEqual(['10', '50', '80']);
        },
    );

    // -------------------------------------------------------------------------
    // テストケース2: 差分ビュー — 非連番keyテーブルで差分ビューが表示されること
    //
    // 検証方法:
    //   itemテーブル（非連番keyスキーマ）について、HEAD版（recover_hp=999）と
    //   現在版（recover_hp=5）の差分を開いたとき、差分タブが正常に表示されることを確認する。
    //
    //   バグ状態:
    //     diff-tab.ts: `columnCount = schema.header.length`（=5）
    //     buildDiffRows が id=1行について kind='modified', changedColumnIndices={5} を生成する。
    //     applyDiffClasses で 5列のEditorTableに getCell(row, colIdx+1=6) を呼び出すと
    //     範囲外アクセスで例外クラッシュ→DiffTabコンストラクタが失敗→差分ビュー非表示。
    //
    //   HEAD版と現在版の差分:
    //     modified: id=1（recover_hp: 999→5）、recover_hpのCSV列インデックス=5
    //     unchanged: id=2, id=3
    //
    //   schema.header.length=5のため、changedColumnIndex=5 は DOM列数を超えており、
    //   getCell(row, 6) が5列テーブルへの範囲外アクセスとなりクラッシュする。
    // -------------------------------------------------------------------------
    test(
        '非連番keyスキーマのitemsテーブルで差分ビューを開くとクラッシュせず差分タブが表示されること',
        async ({ page, nonSeqKeyDiffPage: _nonSeqKeyDiffPage }) => {
            // ソース管理パネルを開く
            const sourceControlButton = page.locator('[data-panel="sourceControl"]');
            await expect(sourceControlButton).toBeVisible();
            await sourceControlButton.click();

            // CHANGES セクションに item テーブルが表示されることを確認する
            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();
            await expect(changesSection.getByText('item')).toBeVisible();

            // item テーブルの差分をクリックして差分タブを開く
            await changesSection.getByText('item').click();

            // 差分タブが表示されることを確認する
            // バグ状態: applyDiffClasses の範囲外アクセスで例外→DiffTabコンストラクタがクラッシュ→.diff-tab が存在しない
            const diffTab = page.locator('.diff-tab');
            await expect(diffTab).toBeVisible();

            // 左ペイン（HEAD版）と右ペイン（現在版）のEditorTableが表示されることを確認する
            const leftPane = diffTab.locator('.diff-pane-left');
            await expect(leftPane.locator('.editor-table')).toBeVisible();

            const rightPane = diffTab.locator('.diff-pane-right');
            await expect(rightPane.locator('.editor-table')).toBeVisible();
        },
    );

});
