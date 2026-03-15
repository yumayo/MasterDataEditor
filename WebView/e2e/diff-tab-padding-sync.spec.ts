import { test as base, expect } from './fixtures/test';
import { MockFileSystem, installMockApiAsync } from './fixtures/mock-api';

// =============================================================================
// 差分ビュー（DiffTab）でのパディング行同期テスト — FEAT_0018
//
// 根本原因（RED の理由）:
//   差分ビューの右ペインで行を挿入または削除した場合、左ペインのパディング行（diff-row-empty）と
//   削除マーク（diff-row-deleted）を同期する実装が存在しない。
//   現在の DiffTab は差分表示時の初期クラス付与のみ行い、右ペインでの行操作に連動した
//   左ペイン更新ロジックを持っていない。
//
// 要件:
//   1. 右ペインで行挿入時: 左ペインの同一位置にパディング行（diff-row-empty）が挿入され行数が同期する
//   2. 右ペインで行削除時:
//      - 右ペインのDOMを削除せず、パディング行（diff-row-empty）に変換すること
//      - 左ペインの同一位置の行に diff-row-deleted クラスが付与されること
//   3. 上記の操作が Undo/Redo に対応すること
// =============================================================================

// テスト用スキーマ（item: id, name, value の3列テーブル）
const ITEM_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
        { key: 2, name: "value", type: "int" },
    ],
    primary_key: "id",
});

// 現在版CSV（working tree）— id=1 の value が変更されており、id=3 は存在しない（削除済み）
const CURRENT_ITEM_CSV = [
    "id,name,value",
    "1,sword,150",
    "2,shield,200",
].join("\n");

// HEAD版CSV（変更前）— id=1〜3 の全行が存在する
const HEAD_ITEM_CSV = [
    "id,name,value",
    "1,sword,100",
    "2,shield,200",
    "3,potion,50",
].join("\n");

// git status レスポンス（item が changes 状態）
const GIT_STATUS = {
    changes: [{ path: "data/item.csv", tableName: "item", isNew: false }],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

// HEAD版ファイルマップ
const HEAD_FILES: Record<string, string> = {
    "data/item.csv": HEAD_ITEM_CSV,
};

function createPaddingSyncFileSystem(): MockFileSystem {
    return {
        "schema/item.json": ITEM_SCHEMA,
        "data/item.csv": CURRENT_ITEM_CSV,
    };
}

// フィクスチャ型定義
interface DiffTabPaddingSyncFixtures {
    /** git差分状態をセットアップした状態でページを開き、差分タブを表示するフィクスチャ */
    diffTabPaddingSyncPage: void;
}

/**
 * 差分タブパディング同期テスト用フィクスチャ
 * addInitScript は goto より前に実行する必要があるため、
 * installMockApiAsync より前に __mockGitStatus / __mockGitHeadFiles を設定する
 */
const test = base.extend<DiffTabPaddingSyncFixtures>({
    diffTabPaddingSyncPage: async ({ page }, use) => {
        await page.addInitScript((args: {
            status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
            headFiles: Record<string, string>;
        }) => {
            (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
            (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
        }, { status: GIT_STATUS, headFiles: HEAD_FILES });

        await installMockApiAsync(page, createPaddingSyncFileSystem());
        await page.goto('/');
        await use();
    },
});

// テスト本体 -------------------------------------------------------------------

test.describe('差分ビューのパディング行同期', () => {

    // -------------------------------------------------------------------------
    // テスト1: 右ペインで行を挿入すると左ペインにパディング行が挿入される
    //
    // 初期状態:
    //   - HEAD: [id=1(modified), id=2(unchanged), id=3(deleted)]
    //   - Current: [id=1(modified), id=2(unchanged)]
    //   差分表示では3行構成（左: [1(modified),2,3(deleted)], 右: [1(modified),2,empty]）
    //
    // 操作: 右ペインの1行目の行ヘッダーを右クリック →「上に行を挿入」
    //
    // 期待:
    //   - 左ペインと右ペインの行数が一致すること（挿入後も同期が保たれる）
    //   - 右ペインの挿入位置（インデックス0）に新しい行が存在すること
    //   - 左ペインの挿入位置（インデックス0）に diff-row-empty クラスのパディング行が存在すること
    //
    // なぜ失敗するか（RED の理由）:
    //   右ペインで行を挿入しても DiffTab は左ペインへの同期処理を持たないため、
    //   左ペインの行数が変わらず行数不一致になる。
    //   また、左ペインに diff-row-empty のパディング行が追加されない。
    // -------------------------------------------------------------------------
    test(
        '右ペインで行を挿入すると左ペインの同一位置にパディング行（diff-row-empty）が挿入されること',
        async ({ page, diffTabPaddingSyncPage: _diffTabPaddingSyncPage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();

            // item の差分タブを開く
            await changesSection.getByText('item').click();
            const diffTab = page.locator('.diff-tab-wrapper:not([style*="display: none"]) .diff-tab');
            await expect(diffTab).toBeVisible();

            // 左右ペインの初期行数を確認する
            const leftPane = diffTab.locator('.diff-pane-left');
            const rightPane = diffTab.locator('.diff-pane-right');
            await expect(leftPane.locator('.editor-table')).toBeVisible();
            await expect(rightPane.locator('.editor-table')).toBeVisible();

            const leftTable = leftPane.locator('.editor-table');
            const rightTable = rightPane.locator('.editor-table');

            // 初期行数を取得する（列ヘッダー行 + データ行の合計。nth(0) が列ヘッダー行、nth(1) からデータ行）
            const initialLeftRowCount = await leftTable.locator('.editor-table-row').count();
            const initialRightRowCount = await rightTable.locator('.editor-table-row').count();
            expect(initialLeftRowCount).toBe(initialRightRowCount);

            // 右ペインの1行目（インデックス0のデータ行）の行ヘッダーを右クリックする
            // .editor-table-row-header はデータ行のみに付くクラスで、コーナーセルは editor-table-corner-cell
            // のため nth(0) がデータ1行目（ヘッダー行の左端セルは別クラス）
            const rightRowHeader = rightTable.locator('.editor-table-row-header').nth(0);
            await rightRowHeader.click({ button: 'right' });

            // コンテキストメニューから「上に行を挿入」を選択する
            const contextMenu = page.locator('.context-menu.visible');
            await expect(contextMenu).toBeVisible();
            await contextMenu.locator('.context-menu-item', { hasText: '上に行を挿入' }).click();

            // 挿入後: 右ペインの行数が1増加していること
            const afterRightRowCount = await rightTable.locator('.editor-table-row').count();
            expect(afterRightRowCount).toBe(initialRightRowCount + 1);

            // 左ペインの行数も右ペインと一致すること（パディング行が挿入されて同期される）
            // 現行実装では左ペインに同期処理がないため、このアサーションが失敗してREDになる
            const afterLeftRowCount = await leftTable.locator('.editor-table-row').count();
            expect(afterLeftRowCount).toBe(afterRightRowCount);

            // 左ペインの挿入位置（データ1行目 = .editor-table-row の nth(1)）に diff-row-empty クラスが付いていること
            // nth(0) が列ヘッダー行（editor-table-column-header-row）、nth(1) がデータ1行目
            const firstLeftDataRow = leftTable.locator('.editor-table-row').nth(1);
            await expect(firstLeftDataRow).toHaveClass(/diff-row-empty/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト2: 右ペインで行を削除するとDOMは残りパディング行になり、左ペインに削除マークが付く
    //
    // 初期状態:
    //   - HEAD: [id=1(modified), id=2(unchanged), id=3(deleted)]
    //   - Current: [id=1(modified), id=2(unchanged)]
    //   差分表示では3行構成（左: [1(modified),2,3(deleted)], 右: [1(modified),2,empty]）
    //
    // 操作: 右ペインの1行目（id=1のデータ行）の行ヘッダーを右クリック →「行を削除」
    //
    // 期待:
    //   - 右ペインのDOM行数が変化しないこと（削除されずDOMに残る）
    //   - 削除された右ペインの行に diff-row-empty クラスが付くこと（パディング行へ変換）
    //   - 左ペインの同一位置の行（1行目データ行）に diff-row-deleted クラスが付くこと
    //   - 左右ペインの行数が一致し続けること
    //
    // なぜ失敗するか（RED の理由）:
    //   通常テーブルの行削除コマンドはDOMから行を削除する。
    //   差分ビューでは行削除のセマンティクスが異なり、DOMをパディング行に変換する必要があるが、
    //   この特別処理が実装されていない。左ペインへの diff-row-deleted クラス付与も存在しない。
    // -------------------------------------------------------------------------
    test(
        '右ペインで行を削除するとDOMから行が消えずパディング行（diff-row-empty）に変換され、左ペインに削除マーク（diff-row-deleted）が付くこと',
        async ({ page, diffTabPaddingSyncPage: _diffTabPaddingSyncPage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();

            // item の差分タブを開く
            await changesSection.getByText('item').click();
            const diffTab = page.locator('.diff-tab-wrapper:not([style*="display: none"]) .diff-tab');
            await expect(diffTab).toBeVisible();

            const leftPane = diffTab.locator('.diff-pane-left');
            const rightPane = diffTab.locator('.diff-pane-right');
            const leftTable = leftPane.locator('.editor-table');
            const rightTable = rightPane.locator('.editor-table');

            // 初期行数を記録する（ヘッダー行含む全行数）
            const initialRowCount = await rightTable.locator('.editor-table-row').count();

            // 右ペインの1行目データ行（id=1、変更された行）の行ヘッダーを右クリックする
            // .editor-table-row-header はデータ行専用クラス（コーナーセルは editor-table-corner-cell）
            // のため nth(0) がデータ1行目
            const firstRightRowHeader = rightTable.locator('.editor-table-row-header').nth(0);
            await firstRightRowHeader.click({ button: 'right' });

            // コンテキストメニューから「行を削除」を選択する
            const contextMenu = page.locator('.context-menu.visible');
            await expect(contextMenu).toBeVisible();
            await contextMenu.locator('.context-menu-item', { hasText: '行を削除' }).click();

            // 右ペインのDOM行数が変化しないこと（行削除ではなくパディング行への変換）
            // 現行実装では通常の行削除コマンドがDOMを削除するため、このアサーションが失敗してREDになる
            const afterRightRowCount = await rightTable.locator('.editor-table-row').count();
            expect(afterRightRowCount).toBe(initialRowCount);

            // 右ペインの削除された行（1行目データ行）が diff-row-empty クラスを持つこと
            // 現行実装ではDOMが削除されてこの行は存在しなくなるため、失敗してREDになる
            const firstRightDataRow = rightTable.locator('.editor-table-row').nth(1);
            await expect(firstRightDataRow).toHaveClass(/diff-row-empty/);

            // 左ペインの同一位置（1行目データ行）に diff-row-deleted クラスが付くこと
            // 現行実装では左ペインへの同期処理がないため、このアサーションが失敗してREDになる
            const firstLeftDataRow = leftTable.locator('.editor-table-row').nth(1);
            await expect(firstLeftDataRow).toHaveClass(/diff-row-deleted/);

            // 左右ペインの行数が一致し続けること
            const afterLeftRowCount = await leftTable.locator('.editor-table-row').count();
            expect(afterLeftRowCount).toBe(afterRightRowCount);
        },
    );

    // -------------------------------------------------------------------------
    // テスト3: Undo/Redo 対応 — 右ペイン行挿入のUndo/Redo
    //
    // 初期状態:
    //   差分タブを開いた初期状態
    //
    // 操作:
    //   1. 右ペインの1行目に行を挿入（上に挿入）
    //   2. 右ペインのセルをクリックしてフォーカスを確保
    //   3. Ctrl+Z でUndoする
    //   4. Ctrl+Shift+Z でRedoする
    //
    // 期待:
    //   - 行挿入後: 左ペインにパディング行（diff-row-empty）が追加されること
    //   - Undo後: 左ペインのパディング行が消えること（行数が元に戻ること）
    //   - Redo後: 左ペインにパディング行が再挿入されること
    //
    // なぜ失敗するか（RED の理由）:
    //   同期処理自体が実装されていないため、テスト1と同様に行挿入時のパディング行同期が失敗する。
    //   さらに Undo/Redo でのパディング行の追加・削除も実装されていない。
    // -------------------------------------------------------------------------
    test(
        '右ペインで行を挿入してUndo/Redoすると左ペインのパディング行も連動して追加・削除されること',
        async ({ page, diffTabPaddingSyncPage: _diffTabPaddingSyncPage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();

            // item の差分タブを開く
            await changesSection.getByText('item').click();
            const diffTab = page.locator('.diff-tab-wrapper:not([style*="display: none"]) .diff-tab');
            await expect(diffTab).toBeVisible();

            const leftPane = diffTab.locator('.diff-pane-left');
            const rightPane = diffTab.locator('.diff-pane-right');
            const leftTable = leftPane.locator('.editor-table');
            const rightTable = rightPane.locator('.editor-table');

            // 初期行数を記録する（ヘッダー行含む全行数）
            const initialLeftRowCount = await leftTable.locator('.editor-table-row').count();
            const initialRightRowCount = await rightTable.locator('.editor-table-row').count();
            expect(initialLeftRowCount).toBe(initialRightRowCount);

            // 右ペインの1行目に行を上に挿入する
            // .editor-table-row-header はデータ行専用クラスのため nth(0) がデータ1行目
            const firstRightRowHeader = rightTable.locator('.editor-table-row-header').nth(0);
            await firstRightRowHeader.click({ button: 'right' });
            const contextMenu = page.locator('.context-menu.visible');
            await expect(contextMenu).toBeVisible();
            await contextMenu.locator('.context-menu-item', { hasText: '上に行を挿入' }).click();

            // 行挿入後: 左ペインのパディング行が追加されていること（テスト1と同じ検証）
            // 現行実装ではこのアサーションが失敗してREDになる
            const afterInsertLeftRowCount = await leftTable.locator('.editor-table-row').count();
            expect(afterInsertLeftRowCount).toBe(initialLeftRowCount + 1);
            const firstLeftDataRowAfterInsert = leftTable.locator('.editor-table-row').nth(1);
            await expect(firstLeftDataRowAfterInsert).toHaveClass(/diff-row-empty/);

            // 右ペインのセルをクリックしてフォーカスを確保してからUndoする
            const firstRightDataCell = rightTable.locator('.editor-table-row').nth(1)
                .locator('.editor-table-cell:not(.editor-table-row-header)').first();
            await firstRightDataCell.click();
            await page.keyboard.press('Control+z');

            // Undo後: 左ペインの行数が初期状態に戻ること
            // 現行実装では同期処理がないため、このアサーションが失敗してREDになる
            const afterUndoLeftRowCount = await leftTable.locator('.editor-table-row').count();
            expect(afterUndoLeftRowCount).toBe(initialLeftRowCount);

            // Undo後: 挿入位置にパディング行がなくなること（元の行に戻る）
            const firstLeftDataRowAfterUndo = leftTable.locator('.editor-table-row').nth(1);
            await expect(firstLeftDataRowAfterUndo).not.toHaveClass(/diff-row-empty/);

            // Redo前に右ペインのセルをクリックしてフォーカスを確保する
            // Undoで挿入行が削除されると、クリック済みのセルがDOMから除去されフォーカスが失われるため
            const rightCellBeforeRedo = rightTable.locator('.editor-table-row').nth(1)
                .locator('.editor-table-cell:not(.editor-table-row-header)').first();
            await rightCellBeforeRedo.click();

            // Redo: Ctrl+Y でやり直す（Ctrl+Yはアクティブなハンドラに直接届く）
            await page.keyboard.press('Control+y');

            // Redo後: 左ペインに再びパディング行が挿入されること
            // toHaveCount はPlaywright auto-retrying assertionのため、DOMの更新を待機する
            await expect(leftTable.locator('.editor-table-row')).toHaveCount(initialLeftRowCount + 1);
            const firstLeftDataRowAfterRedo = leftTable.locator('.editor-table-row').nth(1);
            await expect(firstLeftDataRowAfterRedo).toHaveClass(/diff-row-empty/);
        },
    );

    // -------------------------------------------------------------------------
    // テスト4: 行削除のUndo/Redo
    //
    // 初期状態:
    //   差分タブを開いた初期状態（3行: id=1(modified), id=2(unchanged), empty/padding）
    //
    // 操作:
    //   1. 右ペインの1行目（id=1のデータ行）を削除
    //   2. 右ペインのセルをクリックしてフォーカスを確保
    //   3. Ctrl+Z でUndo
    //   4. 再びフォーカスを確保して Ctrl+Y でRedo
    //
    // 期待:
    //   - 行削除後: 右ペインが diff-row-empty、左ペインに diff-row-deleted が付く（行数不変）
    //   - Undo後: 右ペインが元のデータ行に戻り diff-row-empty が消える、左ペインの diff-row-deleted が除去される
    //   - Redo後: 再び行削除状態になる（右ペインが diff-row-empty、左ペインに diff-row-deleted）
    //
    // なぜ失敗するか（RED の理由）:
    //   DeleteRowCommand.undo() が insertRowInternal → notifyRightPaneRowInserted を呼ぶが、
    //   現行実装では notifyRightPaneRowInserted がパディング行を追加してしまい、DOM行が重複する。
    //   また左ペインの diff-row-deleted も除去されない。
    // -------------------------------------------------------------------------
    test(
        '右ペインで行を削除してUndo/Redoすると左右ペインの状態が正しく復元されること',
        async ({ page, diffTabPaddingSyncPage: _diffTabPaddingSyncPage }) => {
            // ソース管理パネルを開く
            await page.locator('[data-panel="sourceControl"]').click();

            const changesSection = page.locator('.source-control-changes-section');
            await expect(changesSection).toBeVisible();

            // item の差分タブを開く
            await changesSection.getByText('item').click();
            const diffTab = page.locator('.diff-tab-wrapper:not([style*="display: none"]) .diff-tab');
            await expect(diffTab).toBeVisible();

            const leftPane = diffTab.locator('.diff-pane-left');
            const rightPane = diffTab.locator('.diff-pane-right');
            const leftTable = leftPane.locator('.editor-table');
            const rightTable = rightPane.locator('.editor-table');

            // 初期行数を記録する（ヘッダー行含む全行数）
            const initialRowCount = await rightTable.locator('.editor-table-row').count();

            // 右ペインの1行目データ行（id=1、変更された行）の行ヘッダーを右クリックして削除する
            const firstRightRowHeader = rightTable.locator('.editor-table-row-header').nth(0);
            await firstRightRowHeader.click({ button: 'right' });
            const contextMenu = page.locator('.context-menu.visible');
            await expect(contextMenu).toBeVisible();
            await contextMenu.locator('.context-menu-item', { hasText: '行を削除' }).click();

            // 削除後: 右ペインの行数が変化しないこと（パディング行変換のためDOM行は残る）
            const afterDeleteRightRowCount = await rightTable.locator('.editor-table-row').count();
            expect(afterDeleteRightRowCount).toBe(initialRowCount);

            // 削除後: 右ペインの1行目データ行が diff-row-empty になっていること
            const firstRightDataRowAfterDelete = rightTable.locator('.editor-table-row').nth(1);
            await expect(firstRightDataRowAfterDelete).toHaveClass(/diff-row-empty/);

            // 削除後: 左ペインの1行目データ行に diff-row-deleted が付いていること
            const firstLeftDataRowAfterDelete = leftTable.locator('.editor-table-row').nth(1);
            await expect(firstLeftDataRowAfterDelete).toHaveClass(/diff-row-deleted/);

            // 左右ペインの行数が一致していること
            const afterDeleteLeftRowCount = await leftTable.locator('.editor-table-row').count();
            expect(afterDeleteLeftRowCount).toBe(afterDeleteRightRowCount);

            // 右ペインの2行目データ行をクリックしてフォーカスを確保してからUndoする
            const secondRightDataCell = rightTable.locator('.editor-table-row').nth(2)
                .locator('.editor-table-cell:not(.editor-table-row-header)').first();
            await secondRightDataCell.click();
            await page.keyboard.press('Control+z');

            // Undo後: 右ペインの1行目データ行が diff-row-empty でなくなっていること（データが復元）
            // toHaveCount はPlaywright auto-retrying assertionのため、DOMの更新を待機する
            await expect(rightTable.locator('.editor-table-row')).toHaveCount(initialRowCount);
            const firstRightDataRowAfterUndo = rightTable.locator('.editor-table-row').nth(1);
            await expect(firstRightDataRowAfterUndo).not.toHaveClass(/diff-row-empty/);

            // Undo後: 左ペインの1行目データ行の diff-row-deleted が除去されていること
            const firstLeftDataRowAfterUndo = leftTable.locator('.editor-table-row').nth(1);
            await expect(firstLeftDataRowAfterUndo).not.toHaveClass(/diff-row-deleted/);

            // Undo後: 左右ペインの行数が一致していること
            const afterUndoLeftRowCount = await leftTable.locator('.editor-table-row').count();
            const afterUndoRightRowCount = await rightTable.locator('.editor-table-row').count();
            expect(afterUndoLeftRowCount).toBe(afterUndoRightRowCount);

            // 右ペインのセルをクリックしてフォーカスを確保してからRedoする
            const rightCellBeforeRedo = rightTable.locator('.editor-table-row').nth(1)
                .locator('.editor-table-cell:not(.editor-table-row-header)').first();
            await rightCellBeforeRedo.click();
            await page.keyboard.press('Control+y');

            // Redo後: 再び行削除状態になること（右ペインが diff-row-empty、左ペインに diff-row-deleted）
            await expect(rightTable.locator('.editor-table-row')).toHaveCount(initialRowCount);
            const firstRightDataRowAfterRedo = rightTable.locator('.editor-table-row').nth(1);
            await expect(firstRightDataRowAfterRedo).toHaveClass(/diff-row-empty/);
            const firstLeftDataRowAfterRedo = leftTable.locator('.editor-table-row').nth(1);
            await expect(firstLeftDataRowAfterRedo).toHaveClass(/diff-row-deleted/);

            // Redo後: 左右ペインの行数が一致していること
            const afterRedoLeftRowCount = await leftTable.locator('.editor-table-row').count();
            const afterRedoRightRowCount = await rightTable.locator('.editor-table-row').count();
            expect(afterRedoLeftRowCount).toBe(afterRedoRightRowCount);
        },
    );

});
