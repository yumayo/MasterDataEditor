import {test, expect} from './fixtures/test';
import {Page, Locator} from '@playwright/test';
import {installMockApiAsync, MockFileSystem, readMockFileAsync} from './fixtures/mock-api';

const ER_DIAGRAM_LAYOUT_FILE = 'userdata/er-diagram-layout.json';

// =============================================================================
// ER図機能テスト
//
// アクティビティバーの ER 図アイコンをクリックするとエディター領域に
// 「ER Diagram」タブが開き、SVG キャンバスでテーブル間のリレーションを
// ノード・エッジとして描画する。設定タブ（openSettingsTab）と同じパターン。
//
// テストデータ構成:
//   item: id(PK), name, weapon_id(FK→weapon.id) — 単純参照
//   weapon: id(PK), name, type — 被参照テーブル
//   quest: id(PK), name, reward_type(動的参照→reward_config経由) — 動的参照
//   reward_config: id(PK), reward_type, target_table, target_column — 中間テーブル
// =============================================================================

/**
 * ER図テスト用のファイルシステムを生成する
 *
 * 4テーブル構成:
 *   item → weapon（単純参照: weapon_id → weapon.id）
 *   quest → reward_config（動的参照: reward_type 経由）
 */
function createErDiagramTestFileSystem(): MockFileSystem {
    return {
        "schema/item.json": JSON.stringify({
            description: "アイテム",
            primary_key: ["id"],
            header: [
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "name", type: "string"},
                {key: 2, name: "weapon_id", type: "int", reference: "weapon.id"},
            ],
        }),
        "data/item.csv": [
            "id,name,weapon_id",
            "1,Iron Sword,1",
            "2,Steel Sword,2",
        ].join("\n"),
        "schema/weapon.json": JSON.stringify({
            description: "武器",
            primary_key: ["id"],
            header: [
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "name", type: "string"},
                {key: 2, name: "type", type: "string"},
            ],
        }),
        "data/weapon.csv": [
            "id,name,type",
            "1,Short Sword,sword",
            "2,Long Sword,sword",
        ].join("\n"),
        "schema/quest.json": JSON.stringify({
            description: "クエスト",
            primary_key: ["id"],
            header: [
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "name", type: "string"},
                {key: 2, name: "reward_type", type: "int", reference: {
                    sourceTable: "reward_config",
                    sourceMatchColumn: "id",
                    sourceMatchValue: "reward_type",
                    destTable: "target_table",
                    destColumn: "target_column",
                }},
            ],
        }),
        "data/quest.csv": [
            "id,name,reward_type",
            "1,Dragon Quest,1",
            "2,Final Quest,2",
        ].join("\n"),
        "schema/reward_config.json": JSON.stringify({
            description: "報酬設定",
            primary_key: ["id"],
            header: [
                {key: 0, name: "id", type: "int"},
                {key: 1, name: "reward_type", type: "string"},
                {key: 2, name: "target_table", type: "string"},
                {key: 3, name: "target_column", type: "string"},
            ],
        }),
        "data/reward_config.csv": [
            "id,reward_type,target_table,target_column",
            "1,weapon,weapon,id",
            "2,item,item,id",
        ].join("\n"),
    };
}

function createErDiagramTestFileSystemWithSavedLayout(savedLayout: object): MockFileSystem {
    const fs = createErDiagramTestFileSystem();
    fs[ER_DIAGRAM_LAYOUT_FILE] = JSON.stringify(savedLayout);
    return fs;
}

/**
 * アクティビティバーのER図アイコンをクリックしてER図タブを開く
 */
async function openErDiagramAsync(page: Page): Promise<void> {
    await page.locator('.activity-bar-item[data-panel="erDiagram"]').click();
}

/**
 * ER図タブ内のSVGキャンバスを取得する
 */
function getErDiagramSvg(page: Page): Locator {
    return page.locator('.er-diagram-svg');
}

/**
 * テーブルを開いてエディターテーブルが表示されるまで待機する
 */
async function openTableAsync(page: Page, tableName: string): Promise<Locator> {
    const explorer = page.locator('#explorer');
    await explorer.getByText(tableName, {exact: true}).click();
    const table = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="${tableName}"] .editor-table`);
    await expect(table).toBeVisible();
    return table;
}

async function waitForErDiagramLayoutWriteAsync(page: Page): Promise<void> {
    await page.waitForFunction(
        (path: string) => typeof (window as unknown as { __mockFs: Record<string, string> }).__mockFs[path] === 'string',
        ER_DIAGRAM_LAYOUT_FILE,
        {timeout: 5000}
    );
}

test.describe('ER図機能', () => {
    test.beforeEach(async ({page}) => {
        const fs = createErDiagramTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
    });

    test('アクティビティバーにerDiagramアイコンが表示される', async ({page}) => {
        // erDiagram アイコンが存在すること
        const erDiagramIcon = page.locator('.activity-bar-item[data-panel="erDiagram"]');
        await expect(erDiagramIcon).toBeVisible();
        // BOOKMARKS と SOURCE CONTROL の間に配置されていることを検証する
        const items = page.locator('.activity-bar .activity-bar-item:not(.activity-bar-settings)');
        const panelNames: string[] = [];
        const count = await items.count();
        for (let i = 0; i < count; i++) {
            const panel = await items.nth(i).getAttribute('data-panel');
            if (panel) panelNames.push(panel);
        }
        const erDiagramIndex = panelNames.indexOf('erDiagram');
        const bookmarksIndex = panelNames.indexOf('bookmarks');
        const sourceControlIndex = panelNames.indexOf('sourceControl');
        expect(erDiagramIndex).toBeGreaterThan(bookmarksIndex);
        expect(erDiagramIndex).toBeLessThan(sourceControlIndex);
    });

    test('erDiagramアイコンクリックでER図タブが開く', async ({page}) => {
        await openErDiagramAsync(page);
        // 「ER Diagram」タブがタブバーに追加されていること
        const tabButton = page.locator('.tab-button', {hasText: 'ER Diagram'});
        await expect(tabButton).toBeVisible();
        // SVG キャンバスが表示されること
        const svg = getErDiagramSvg(page);
        await expect(svg).toBeVisible();
    });

    test('テーブルがノードとして表示される', async ({page}) => {
        await openErDiagramAsync(page);
        const svg = getErDiagramSvg(page);
        // 4テーブル分のノードが表示されること（item, weapon, quest, reward_config）
        const nodes = svg.locator('.er-node');
        await expect(nodes).toHaveCount(4);
        // 各ノードにテーブル名が表示されること
        const nodeNames: string[] = [];
        const nodeCount = await nodes.count();
        for (let i = 0; i < nodeCount; i++) {
            const title = await nodes.nth(i).locator('.er-node-title').textContent();
            if (title) nodeNames.push(title.trim());
        }
        expect(nodeNames).toContain('item');
        expect(nodeNames).toContain('weapon');
        expect(nodeNames).toContain('quest');
        expect(nodeNames).toContain('reward_config');
        // item ノードの列一覧を検証する
        const itemNode = svg.locator('.er-node', {has: page.locator('.er-node-title', {hasText: 'item'})});
        const itemColumns = itemNode.locator('.er-node-column');
        await expect(itemColumns).toHaveCount(3); // id, name, weapon_id
        // PK列（id）に pk クラスが付与されること
        const pkColumn = itemNode.locator('.er-node-column-pk');
        await expect(pkColumn).toHaveCount(1);
        await expect(pkColumn).toHaveText(/id/);
        // FK列（weapon_id）に fk クラスが付与されること
        const fkColumn = itemNode.locator('.er-node-column-fk');
        await expect(fkColumn).toHaveCount(1);
        await expect(fkColumn).toHaveText(/weapon_id/);
    });

    test('単純参照が実線エッジで表示される', async ({page}) => {
        await openErDiagramAsync(page);
        const svg = getErDiagramSvg(page);
        // item → weapon のエッジが存在すること（buildAsync 完了を auto-retry で待機する）
        const itemWeaponEdge = svg.locator('.er-edge-simple[data-from="item"][data-to="weapon"]');
        await expect(itemWeaponEdge).toHaveCount(1);
    });

    test('動的参照が破線エッジで表示される', async ({page}) => {
        await openErDiagramAsync(page);
        const svg = getErDiagramSvg(page);
        // 動的参照はCSVデータから実テーブルに解決される
        // quest.reward_type → weapon.id（reward_config の target_table=weapon 行から解決）
        const questWeaponEdge = svg.locator('.er-edge-dynamic[data-from="quest"][data-to="weapon"]');
        await expect(questWeaponEdge).toHaveCount(1);
        // quest.reward_type → item.id（reward_config の target_table=item 行から解決）
        const questItemEdge = svg.locator('.er-edge-dynamic[data-from="quest"][data-to="item"]');
        await expect(questItemEdge).toHaveCount(1);
    });

    test('ノードクリックで該当テーブルがタブで開く', async ({page}) => {
        await openErDiagramAsync(page);
        const svg = getErDiagramSvg(page);
        // weapon ノードをクリックする
        const weaponNode = svg.locator('.er-node', {has: page.locator('.er-node-title', {hasText: 'weapon'})});
        await weaponNode.click();
        // weapon テーブルがエディター領域でタブとして開かれること
        const weaponTable = page.locator(`.editor-left-pane .tab-wrapper[data-tab-name="weapon"] .editor-table`);
        await expect(weaponTable).toBeVisible();
        // タブバーに weapon タブが追加されていること
        const weaponTabButton = page.locator('.tab-button', {hasText: 'weapon'});
        await expect(weaponTabButton).toBeVisible();
    });

    test('凡例が表示される', async ({page}) => {
        await openErDiagramAsync(page);
        // 凡例はHTML要素としてコンテナ左上に固定配置される（SVG内ではない）
        const legend = page.locator('.er-diagram-container .er-legend');
        await expect(legend).toBeVisible();
        // 「単純参照」の説明が表示されること
        await expect(legend).toContainText('単純参照');
        // 「動的参照」の説明が表示されること
        await expect(legend).toContainText('動的参照');
    });

    test('ノード選択で関連エッジがハイライトされる', async ({page}) => {
        await openErDiagramAsync(page);
        const svg = getErDiagramSvg(page);
        // item ノードをクリックして選択する
        const itemNode = svg.locator('.er-node', {has: page.locator('.er-node-title', {hasText: 'item'})});
        await itemNode.click();
        // item ノードに selected クラスが付与されること
        await expect(itemNode).toHaveClass(/er-node-selected/);
        // item に関連するエッジ（item → weapon）に highlighted クラスが付与されること
        const highlightedEdges = svg.locator('.er-edge-highlighted');
        const highlightedCount = await highlightedEdges.count();
        expect(highlightedCount).toBeGreaterThanOrEqual(1);
        // item → weapon のエッジがハイライトされていること
        const itemWeaponEdge = svg.locator('.er-edge-simple[data-from="item"][data-to="weapon"]');
        await expect(itemWeaponEdge).toHaveClass(/er-edge-highlighted/);
    });
});

test.describe('ER図レイアウト永続化', () => {
    test('ズーム操作後にuserdata/er-diagram-layout.jsonへ保存される', async ({page}) => {
        const fs = createErDiagramTestFileSystem();
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await openErDiagramAsync(page);

        const svg = getErDiagramSvg(page);
        await svg.hover();
        await page.mouse.wheel(0, 240);
        await waitForErDiagramLayoutWriteAsync(page);

        const layoutJson = await readMockFileAsync(page, ER_DIAGRAM_LAYOUT_FILE);
        const layout = JSON.parse(layoutJson) as {viewBox: {x: number; y: number; w: number; h: number}};
        expect(layout.viewBox.w).toBeGreaterThan(0);
        expect(layout.viewBox.h).toBeGreaterThan(0);
    });

    test('userdata/er-diagram-layout.jsonが存在すれば起動時にviewBoxを復元する', async ({page}) => {
        const fs = createErDiagramTestFileSystemWithSavedLayout({
            nodes: {},
            viewBox: {x: 10, y: 20, w: 333, h: 444},
        });
        await installMockApiAsync(page, fs);
        await page.goto('/');
        await openErDiagramAsync(page);

        await expect(getErDiagramSvg(page)).toHaveAttribute('viewBox', '10 20 333 444');
    });

});
