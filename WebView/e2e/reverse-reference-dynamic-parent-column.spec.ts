import { test, expect } from './fixtures/test';
import { Page, Locator } from '@playwright/test';
import { installMockApiAsync, MockFileSystem } from './fixtures/mock-api';
import { enableRelationsPanelAsync } from './fixtures/test-utils';

// =============================================================================
// 動的参照の逆参照で parentColumnName が動的解決されることを検証するテスト
//
// バグの概要:
//   reverse-reference-resolver.ts の動的参照グループ化ループ（376-420行目）で、
//   mergeGroups の parentColumnName 引数に parentPkColumnName（親テーブルのPK列名）を
//   固定で渡している。
//
//   本来は中間テーブルの targetColumn（expr.targetColumn = "column"列）の値を
//   行ごとに読み取って動的に解決すべきである。
//
//   例: table.csv の column 列に "code" と入っている場合、
//       逆参照マップの parentColumnName は "code" になるべきだが、
//       現状は親テーブルのPK列名 "id" が固定で使われてしまう。
//
// テーブル構成:
//   table: id, master, column
//     - id=1, master="monster", column="code"
//       → monsterテーブルの参照先列名は "code"（PK列 "id" ではない）
//
//   monster: id(PK), code, name
//     - id=1, code=M001, name=スライム
//     - id=2, code=M002, name=ドラゴン
//
//   gacha_item: id, table_id(→table.id), record_id(動的参照)
//     - record_id の動的参照: { destTable: "master", destColumn: "column" }
//       → table.csv の column 列の値（"code"）が参照先列名になる
//       → monster.code の値でマッチする
//     - id=1, table_id=1, record_id=M001
//     - id=2, table_id=1, record_id=M002
//
// 検証シナリオ:
//   monster テーブルを開いたとき、gacha_item からの逆参照ヒントが表示される。
//   逆参照マップの parentColumnName が "code" に動的解決されていれば、
//   monster.code の値（M001, M002）でルックアップされる。
//
//   バグ修正前: parentColumnName = "id"（PK列名固定）
//     → monster.id の値（1, 2）でルックアップされる
//     → gacha_item.record_id の値（"M001", "M002"）と一致しないため逆参照が空になる
//   バグ修正後: parentColumnName = "code"（targetColumn動的解決）
//     → monster.code の値（M001, M002）でルックアップされる
//     → gacha_item.record_id の値と正しくマッチする
//
// テスト2: RelationsPanel でのフィルタリング検証
//   monster テーブルの行を選択したとき、右パネルの gacha_item 1:N セクションに
//   正しい行が表示されること。動的参照の1:Nでは childColumnName が空（FK列名を
//   特定できない）ためコンテキスト要素は表示されない。代わりに行数で検証する。
//
//   monster 行1（id=1, code=M001）を選択:
//     バグ修正前: parentColumnName="id" → monster.id="1" でルックアップ → マッチせず → 0件
//     バグ修正後: parentColumnName="code" → monster.code="M001" でルックアップ → 1件
// =============================================================================

/**
 * テスト用のファイルシステムを生成する
 *
 * PK列名 "id" ではなく非PK列 "code" が targetColumn として動的解決される構成。
 * これにより parentPkColumnName 固定バグが露見する。
 */
function createTestFileSystem(): MockFileSystem {
    return {
        "schema/table.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                { key: 1, name: "master", type: "string" },
                // destColumn 動的解決用: 参照先テーブルで使用するカラム名を格納する列
                // "code" が入る → monster テーブルの code 列を参照先とする
                { key: 2, name: "column", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/table.csv": [
            "id,master,column",
            // column="code": monster テーブルの参照先列名は "code"（PK列 "id" ではない）
            "1,monster,code",
        ].join("\n"),
        "schema/monster.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                // code 列が動的参照の実際の参照先（PK列 "id" ではない）
                { key: 1, name: "code", type: "string" },
                { key: 2, name: "name", type: "string" },
            ],
            primary_key: ["id"],
        }),
        "data/monster.csv": [
            "id,code,name",
            "1,M001,スライム",
            "2,M002,ドラゴン",
        ].join("\n"),
        "schema/gacha_item.json": JSON.stringify({
            header: [
                { key: 0, name: "id", type: "int" },
                // table.id への単純参照（どのテーブルかを指定する列）
                { key: 1, name: "table_id", type: "int", reference: "table.id" },
                // 動的参照: table_id の値で table テーブルを検索し、
                //   master カラムの値（"monster"）→ テーブル名
                //   column カラムの値（"code"）→ 参照先列名
                // を動的に解決する
                {
                    key: 2, name: "record_id", type: "string",
                    reference: {
                        sourceTable: "table",
                        sourceMatchColumn: "id",
                        sourceMatchValue: "table_id",
                        destTable: "master",
                        destColumn: "column",
                    },
                },
                // 逆参照ヒント表示のための表示列（config.referenceDisplayColumnPriority = ["ja","comment"]）
                { key: 3, name: "comment", type: "string" },
            ],
            primary_key: ["id"],
        }),
        // gacha_item の record_id には monster.code の値を格納する
        // （monster.id ではなく monster.code で参照する）
        // comment 列は逆参照ヒント表示用（表示テキストがないとヒントが非表示になる）
        "data/gacha_item.csv": [
            "id,table_id,record_id,comment",
            "1,1,M001,ガチャ1",
            "2,1,M002,ガチャ2",
        ].join("\n"),
    };
}

/**
 * エクスプローラーからテーブルを開き、左ペインの EditorTable の Locator を返す
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, { exact: true }).click();
    const activeTab = page.locator('.tab-button-active');
    await expect(activeTab).toHaveText(tableName);
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

/**
 * 指定した行ヘッダーをクリックして行を選択する
 * rowIndex: 0始まり（ヘッダー行を除く）
 */
async function selectRowAsync(table: Locator, rowIndex: number): Promise<void> {
    const header = table.locator('.editor-table-row-header').nth(rowIndex);
    await header.click();
}

/**
 * 指定した行・列の逆参照ヒント要素の Locator を返す
 * rowIndex: 0始まり（ヘッダー行を除く）
 * colIndex: 0始まり（行ヘッダーを除く）
 */
function getReverseReferenceHint(table: Locator, rowIndex: number, colIndex: number): Locator {
    const row = table.locator('.editor-table-row').nth(rowIndex);
    const cell = row.locator('.editor-table-cell:not(.editor-table-row-header)').nth(colIndex);
    return cell.locator('.cell-reverse-reference-hint');
}

// =============================================================================
// テスト1: 逆参照ヒントが動的解決された parentColumnName で正しくマッチすること
//
// monster テーブルを開くと、gacha_item からの逆参照ヒントがPK列（id列）に表示される。
// 動的参照の parentColumnName が "code"（targetColumn 動的解決）であれば、
// monster.code の値でマップをルックアップし、gacha_item.record_id とマッチして逆参照が成立する。
// 逆参照ヒントの表示先は常にPK列セル（updateReverseReferenceHints の仕様）。
//
// バグ修正前: parentColumnName = "id" 固定
//   → 逆参照マップのキーが monster.id の値（"1", "2"）になる
//   → gacha_item.record_id は "M001", "M002" なのでマッチしない
//   → 逆参照ヒントが表示されない → テスト RED
//
// バグ修正後: parentColumnName = "code" 動的解決
//   → 逆参照マップのキーが monster.code の値（"M001", "M002"）になる
//   → gacha_item.record_id の値とマッチし逆参照が成立する
//   → PK列セルに逆参照ヒントが表示される → テスト GREEN
// =============================================================================
test.describe('動的参照の逆参照で parentColumnName が動的解決されPK列にヒントが表示されること', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test(
        'monster テーブルのPK列に逆参照ヒントが表示されること' +
        '（parentColumnName が "code" に動的解決され、code 値でマッチすること）',
        async ({ page }) => {
            const table = await openTableAsync(page, 'monster');

            // 逆参照ヒントはPK列（id列, colIndex=0）に表示される（updateReverseReferenceHints の仕様）。
            // ただし parentColumnName="code" で逆参照マップが構築されているため、
            // 各行の code 列の値（M001, M002）でルックアップされる。
            // code 値でマッチする gacha_item のエントリが見つかれば、PK列セルにヒントが描画される。
            //
            // バグ修正前: parentColumnName="id" → monster.id="1","2" でルックアップ
            //   → gacha_item.record_id="M001","M002" とマッチしない → 逆参照ヒントが表示されない
            // バグ修正後: parentColumnName="code" → monster.code="M001","M002" でルックアップ
            //   → gacha_item.record_id とマッチし、逆参照ヒントが表示される
            const hintRow0 = getReverseReferenceHint(table, 0, 0);
            await expect(hintRow0).toBeVisible({ timeout: 5000 });

            // monster id=2 のPK列にも逆参照ヒントが表示されること
            const hintRow1 = getReverseReferenceHint(table, 1, 0);
            await expect(hintRow1).toBeVisible({ timeout: 5000 });
        },
    );
});

// =============================================================================
// テスト2: RelationsPanel のフィルタリング検証
//
// monster テーブルの行を選択したとき、右パネルの gacha_item 1:N セクションに
// 正しい行が表示されること。動的参照の1:Nでは childColumnName が空（FK列名を
// 特定できない）ためコンテキスト要素は表示されない。代わりに行数で検証する。
//
// monster 行1（id=1, code=M001）を選択:
//   バグ修正前: parentColumnName="id" → monster.id="1" でルックアップ → マッチせず → 0件
//   バグ修正後: parentColumnName="code" → monster.code="M001" でルックアップ → 1件
// =============================================================================
test.describe('RelationsPanel で動的参照の parentColumnName が動的解決され正しい行が表示されること', () => {
    test.beforeEach(async ({ page }) => {
        const fs = createTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await enableRelationsPanelAsync(page);
    });

    test(
        'monster 行1（code=M001）選択時、gacha_item 1:N セクションに正しい行が表示されること' +
        '（parentColumnName が "code" に動的解決され、code=M001 でフィルタされること）',
        async ({ page }) => {
            const table = await openTableAsync(page, 'monster');
            // 行1（id=1, code=M001）を選択する
            await selectRowAsync(table, 0);

            // gacha_item セクションが表示されるまで待機する
            const gachaItemSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('gacha_item', { exact: true }),
            });
            await expect(gachaItemSection).toBeVisible({ timeout: 5000 });

            // 1:N タグが表示されていることを確認する
            await expect(gachaItemSection.locator('.relations-tag--1n')).toBeVisible();

            // 動的参照の1:Nでは childColumnName が空（FK列名を特定できない）ため
            // コンテキスト要素は表示されない。代わりに行数で正しいフィルタリングを検証する。
            // code=M001 に対応する gacha_item は id=1 の1件のみ
            // バグ修正前: parentColumnName="id" → monster.id="1" でルックアップ
            //   → record_id="1" の行はないためセクション自体が表示されないか0件
            // バグ修正後: parentColumnName="code" → monster.code="M001" でルックアップ
            //   → record_id="M001" の gacha_item 行（id=1）が正しく1件表示される
            const rowCountEl = gachaItemSection.locator('.relations-table-row-count');
            await expect(rowCountEl).toHaveText('1 rows');
        },
    );

    test(
        'monster 行2（code=M002）選択時、gacha_item 1:N セクションに正しい行が表示されること' +
        '（code=M002 でフィルタされること）',
        async ({ page }) => {
            const table = await openTableAsync(page, 'monster');
            // 行2（id=2, code=M002）を選択する
            await selectRowAsync(table, 1);

            const gachaItemSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('gacha_item', { exact: true }),
            });
            await expect(gachaItemSection).toBeVisible({ timeout: 5000 });
            await expect(gachaItemSection.locator('.relations-tag--1n')).toBeVisible();

            // code=M002 に対応する gacha_item は id=2 の1件のみ
            // バグ修正前: parentColumnName="id" → monster.id="2" → マッチせず → 0件
            // バグ修正後: parentColumnName="code" → monster.code="M002" → 1件
            const rowCountEl = gachaItemSection.locator('.relations-table-row-count');
            await expect(rowCountEl).toHaveText('1 rows');
        },
    );

    test(
        'monster 行1 選択時、gacha_item 1:N ミニテーブルに record_id=M001 の行のみ表示されること',
        async ({ page }) => {
            const table = await openTableAsync(page, 'monster');
            // 行1（id=1, code=M001）を選択する
            await selectRowAsync(table, 0);

            const gachaItemSection = page.locator('.relations-table-section').filter({
                has: page.locator('.relations-table-title').getByText('gacha_item', { exact: true }),
            });
            await expect(gachaItemSection).toBeVisible({ timeout: 5000 });

            // ミニテーブルが表示されるまで待機する
            const miniTable = gachaItemSection.locator('.editor-table');
            await expect(miniTable).toBeVisible();

            // code=M001 に対応する gacha_item は id=1 の1件のみ
            // バグ修正前: parentColumnName="id" → fkValue="1" でルックアップ
            //   → record_id="1" の行を探すがマッチしない（record_id は "M001"）
            //   → 0件表示になるか、あるいはセクション自体が表示されない
            // バグ修正後: parentColumnName="code" → fkValue="M001" でルックアップ
            //   → record_id="M001" の行（id=1）が正しく1件表示される
            const rowCountEl = gachaItemSection.locator('.relations-table-row-count');
            await expect(rowCountEl).toHaveText('1 rows');
        },
    );
});
