import { test, expect } from "./fixtures/test";
import type { Page } from "@playwright/test";
import { installMockApiAsync, MockFileSystem } from "./fixtures/mock-api";

const PERF_TABLE_NAME = "perf_diff";
const PERF_ROW_COUNT = 500;
const PERF_SCHEMA = JSON.stringify({
    header: [
        { key: 0, name: "id", type: "int" },
        { key: 1, name: "name", type: "string" },
        { key: 2, name: "category", type: "string" },
        { key: 3, name: "value", type: "int" },
        { key: 4, name: "flag", type: "string" },
        { key: 5, name: "note", type: "string" },
    ],
    primary_key: ["id"],
});

const GIT_STATUS = {
    changes: [{ path: `data/${PERF_TABLE_NAME}.csv`, tableName: PERF_TABLE_NAME, isNew: false }],
    staged: [] as { path: string; tableName: string; isNew: boolean }[],
};

interface DetachedHeaderMutationCounts {
    columnHeaderLayer: number;
    cornerLayer: number;
}

interface DiffGridStyleWriteCounts {
    gridRowTransformWrites: number;
    gridCellTransformWrites: number;
    gridRowZIndexWrites: number;
    gridCellZIndexWrites: number;
}

function buildHeadCsv(rowCount: number): string {
    const rows = ["id,name,category,value,flag,note"];
    for (let i = 1; i <= rowCount; i++) {
        rows.push([i, `item_${i}`, `group_${i % 8}`, `${i * 10}`, i % 2 === 0 ? "on" : "off", `note_${i}`].join(","));
    }
    return rows.join("\n");
}

function buildCurrentCsv(rowCount: number): string {
    const rows = ["id,name,category,value,flag,note"];
    for (let i = 1; i <= rowCount; i++) {
        const note = i === 240 ? "note_changed_for_diff" : `note_${i}`;
        rows.push([i, `item_${i}`, `group_${i % 8}`, `${i * 10}`, i % 2 === 0 ? "on" : "off", note].join(","));
    }
    return rows.join("\n");
}

function createFileSystem(): MockFileSystem {
    return {
        [`schema/${PERF_TABLE_NAME}.json`]: PERF_SCHEMA,
        [`data/${PERF_TABLE_NAME}.csv`]: buildCurrentCsv(PERF_ROW_COUNT),
    };
}

function createHeadFiles(): Record<string, string> {
    return {
        [`data/${PERF_TABLE_NAME}.csv`]: buildHeadCsv(PERF_ROW_COUNT),
    };
}

async function openDiffTabAsync(page: Page): Promise<void> {
    await page.locator('[data-panel="sourceControl"]').click();
    const changesSection = page.locator(".source-control-changes-section");
    await expect(changesSection).toBeVisible();
    await changesSection.getByText(PERF_TABLE_NAME, { exact: true }).click();
    await expect(page.locator('.diff-tab-wrapper:not([style*="display: none"]) .diff-tab')).toBeVisible();
}

async function beginDetachedHeaderMutationTrackingAsync(page: Page): Promise<void> {
    await page.evaluate(() => {
        type DetachedHeaderMutationWindow = Window & typeof globalThis & {
            __diffDetachedHeaderMutationCounts: DetachedHeaderMutationCounts | null;
            __diffDetachedHeaderMutationObservers: MutationObserver[] | null;
        };

        const trackerWindow = window as DetachedHeaderMutationWindow;
        trackerWindow.__diffDetachedHeaderMutationCounts = null;
        trackerWindow.__diffDetachedHeaderMutationObservers = null;
        if (trackerWindow.__diffDetachedHeaderMutationObservers !== null) {
            for (const observer of trackerWindow.__diffDetachedHeaderMutationObservers) {
                observer.disconnect();
            }
        }

        const leftPane = document.querySelector('.diff-tab-wrapper:not([style*="display: none"]) .diff-pane-left');
        if (!(leftPane instanceof HTMLElement)) throw new Error("差分タブの左ペインが見つかりません");

        const columnHeaderLayer = leftPane.querySelector(".editor-table-detached-column-header-layer");
        if (!(columnHeaderLayer instanceof HTMLElement)) throw new Error("監視対象の column header layer が見つかりません");

        const cornerLayer = leftPane.querySelector(".editor-table-detached-corner-layer");
        if (!(cornerLayer instanceof HTMLElement)) throw new Error("監視対象の corner layer が見つかりません");

        trackerWindow.__diffDetachedHeaderMutationCounts = { columnHeaderLayer: 0, cornerLayer: 0 };

        const createObserver = (key: keyof DetachedHeaderMutationCounts): MutationObserver => new MutationObserver((records) => {
            if (trackerWindow.__diffDetachedHeaderMutationCounts === null) {
                throw new Error("detached header mutation counter が初期化されていません");
            }
            trackerWindow.__diffDetachedHeaderMutationCounts[key] += records.length;
        });

        const columnHeaderObserver = createObserver("columnHeaderLayer");
        const cornerObserver = createObserver("cornerLayer");
        columnHeaderObserver.observe(columnHeaderLayer, { childList: true, subtree: true });
        cornerObserver.observe(cornerLayer, { childList: true, subtree: true });
        trackerWindow.__diffDetachedHeaderMutationObservers = [columnHeaderObserver, cornerObserver];
    });
}

async function getDetachedHeaderMutationCountsAsync(page: Page): Promise<DetachedHeaderMutationCounts> {
    return await page.evaluate(() => {
        type DetachedHeaderMutationWindow = Window & typeof globalThis & {
            __diffDetachedHeaderMutationCounts: DetachedHeaderMutationCounts | null;
        };

        const trackerWindow = window as DetachedHeaderMutationWindow;
        if (!("__diffDetachedHeaderMutationCounts" in trackerWindow)) {
            throw new Error("detached header mutation counter が初期化されていません");
        }
        if (trackerWindow.__diffDetachedHeaderMutationCounts === null) {
            throw new Error("detached header mutation counter が初期化されていません");
        }
        return trackerWindow.__diffDetachedHeaderMutationCounts;
    });
}

async function beginDiffGridStyleWriteTrackingAsync(page: Page): Promise<void> {
    await page.evaluate(() => {
        type DiffGridStyleWriteWindow = Window & typeof globalThis & {
            __diffGridStyleWritePatched: boolean;
            __diffGridStyleWriteCounts: DiffGridStyleWriteCounts | null;
        };

        const trackerWindow = window as DiffGridStyleWriteWindow;
        trackerWindow.__diffGridStyleWritePatched = trackerWindow.__diffGridStyleWritePatched === true;
        trackerWindow.__diffGridStyleWriteCounts = {
            gridRowTransformWrites: 0,
            gridCellTransformWrites: 0,
            gridRowZIndexWrites: 0,
            gridCellZIndexWrites: 0,
        };
        if (trackerWindow.__diffGridStyleWritePatched) return;

        const styleDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "style");
        if (styleDescriptor === undefined || styleDescriptor.get === undefined) {
            throw new Error("HTMLElement.prototype.style getter が取得できません");
        }
        const styleProxyCache = new WeakMap<CSSStyleDeclaration, CSSStyleDeclaration>();
        Object.defineProperty(HTMLElement.prototype, "style", {
            configurable: true,
            enumerable: styleDescriptor.enumerable ?? false,
            get(): CSSStyleDeclaration {
                const style = styleDescriptor.get!.call(this) as CSSStyleDeclaration;
                const cachedProxy = styleProxyCache.get(style);
                if (cachedProxy !== undefined) return cachedProxy;
                const ownerElement = this;
                const styleProxy = new Proxy(style, {
                    get(target, property): unknown {
                        const value = Reflect.get(target, property, target);
                        if (typeof value === "function") return value.bind(target);
                        return value;
                    },
                    set(target, property, value): boolean {
                        if (property !== "transform" && property !== "zIndex") {
                            return Reflect.set(target, property, value, target);
                        }
                        const previousValue = Reflect.get(target, property, target);
                        const didSet = Reflect.set(target, property, value, target);
                        if (!didSet || previousValue === value) return didSet;
                        if (!isTrackedGridOwner(ownerElement)) return didSet;
                        if (trackerWindow.__diffGridStyleWriteCounts === null) {
                            throw new Error("diff grid style write counter が初期化されていません");
                        }
                        if (property === "transform") {
                            if (ownerElement.classList.contains("editor-table-row")) trackerWindow.__diffGridStyleWriteCounts.gridRowTransformWrites += 1;
                            if (ownerElement.classList.contains("editor-table-cell")) trackerWindow.__diffGridStyleWriteCounts.gridCellTransformWrites += 1;
                            return didSet;
                        }
                        if (ownerElement.classList.contains("editor-table-row")) trackerWindow.__diffGridStyleWriteCounts.gridRowZIndexWrites += 1;
                        if (ownerElement.classList.contains("editor-table-cell")) trackerWindow.__diffGridStyleWriteCounts.gridCellZIndexWrites += 1;
                        return didSet;
                    },
                }) as unknown as CSSStyleDeclaration;
                styleProxyCache.set(style, styleProxy);
                return styleProxy;
            },
        });

        const isTrackedGridOwner = (ownerElement: Element | null): ownerElement is HTMLElement => {
            if (!(ownerElement instanceof HTMLElement)) return false;
            const activeLeftPane = document.querySelector('.diff-tab-wrapper:not([style*="display: none"]) .diff-pane-left');
            if (!(activeLeftPane instanceof HTMLElement)) return false;
            if (!activeLeftPane.contains(ownerElement)) return false;
            if (ownerElement.closest(".editor-table-detached-layer") !== null) return false;
            return ownerElement.closest(".editor-table-grid") !== null;
        };

        trackerWindow.__diffGridStyleWritePatched = true;
    });
}

async function getDiffGridStyleWriteCountsAsync(page: Page): Promise<DiffGridStyleWriteCounts> {
    return await page.evaluate(() => {
        type DiffGridStyleWriteWindow = Window & typeof globalThis & {
            __diffGridStyleWriteCounts: DiffGridStyleWriteCounts | null;
        };

        const trackerWindow = window as DiffGridStyleWriteWindow;
        if (trackerWindow.__diffGridStyleWriteCounts === null) {
            throw new Error("diff grid style write counter が初期化されていません");
        }
        return trackerWindow.__diffGridStyleWriteCounts;
    });
}

async function getFirstRenderedRowIndexAsync(page: Page): Promise<number> {
    return await page.evaluate(() => {
        const firstRenderedRow = document.querySelector('.diff-tab-wrapper:not([style*="display: none"]) .diff-pane-left .editor-table-grid .editor-table-row[data-row-index]');
        if (!(firstRenderedRow instanceof HTMLElement)) throw new Error("左ペインの先頭描画行が見つかりません");
        const rowIndexText = firstRenderedRow.dataset.rowIndex;
        if (typeof rowIndexText !== "string") throw new Error("左ペインの先頭描画行に data-row-index がありません");
        return Number(rowIndexText);
    });
}

async function getDetachedRowHeaderIndicesAsync(page: Page): Promise<number[]> {
    return await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.diff-tab-wrapper:not([style*="display: none"]) .diff-pane-left .editor-table-detached-row-header-layer .editor-table-detached-row'))
            .map(row => {
                if (!(row instanceof HTMLElement)) throw new Error("detached row header が HTMLElement ではありません");
                const rowIndexText = row.dataset.rowIndex;
                if (typeof rowIndexText !== "string") throw new Error("detached row header に data-row-index がありません");
                return Number(rowIndexText);
            });
    });
}

test.describe("git差分ビューの detached header スクロール再構築", () => {
    test(
        "差分タブを縦スクロールしても左ペインの静的 detached header レイヤーに childList mutation が発生しないこと",
        async ({ page }) => {
            await page.setViewportSize({ width: 1400, height: 900 });
            await page.addInitScript((args: {
                status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
                headFiles: Record<string, string>;
            }) => {
                (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
                (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
            }, { status: GIT_STATUS, headFiles: createHeadFiles() });

            await installMockApiAsync(page, createFileSystem());
            await page.goto("/");
            await openDiffTabAsync(page);

            const diffTab = page.locator('.diff-tab-wrapper:not([style*="display: none"]) .diff-tab');
            const leftPane = diffTab.locator(".diff-pane-left");
            await expect(leftPane).toBeVisible();
            await expect.poll(async () => await leftPane.locator(".editor-table-detached-column-header-layer").count()).toBe(1);
            await expect.poll(async () => await leftPane.locator(".editor-table-detached-corner-layer").count()).toBe(1);
            await expect.poll(async () => await leftPane.locator(".editor-table-detached-column-header-layer .editor-table-column-header").count()).toBeGreaterThan(0);
            await expect.poll(async () => await leftPane.locator(".editor-table-detached-corner-layer .editor-table-corner-cell").count()).toBeGreaterThan(0);

            await page.waitForTimeout(100);
            const initialFirstRenderedRowIndex = await getFirstRenderedRowIndexAsync(page);
            await beginDetachedHeaderMutationTrackingAsync(page);

            await leftPane.evaluate((element) => {
                element.scrollTop = 7200;
            });

            await expect.poll(async () => getFirstRenderedRowIndexAsync(page)).toBeGreaterThan(initialFirstRenderedRowIndex + 40);
            await expect.poll(async () => {
                const indices = await getDetachedRowHeaderIndicesAsync(page);
                if (indices.length < 4) return false;
                for (let i = 1; i < indices.length; i++) {
                    if (indices[i] <= indices[i - 1]) return false;
                }
                return true;
            }).toBe(true);
            await page.waitForTimeout(50);
            await expect.poll(async () => (await getDetachedHeaderMutationCountsAsync(page)).columnHeaderLayer).toBe(0);
            await expect.poll(async () => (await getDetachedHeaderMutationCountsAsync(page)).cornerLayer).toBe(0);
        },
    );

    test(
        "差分タブで固定なしスクロール中に左ペイン本文グリッドの transform と z-index を書き換えないこと",
        async ({ page }) => {
            await page.setViewportSize({ width: 1400, height: 900 });
            await page.addInitScript((args: {
                status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
                headFiles: Record<string, string>;
            }) => {
                (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
                (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
            }, { status: GIT_STATUS, headFiles: createHeadFiles() });

            await installMockApiAsync(page, createFileSystem());
            await page.goto("/");
            await openDiffTabAsync(page);

            const diffTab = page.locator('.diff-tab-wrapper:not([style*="display: none"]) .diff-tab');
            const leftPane = diffTab.locator(".diff-pane-left");
            await expect(leftPane).toBeVisible();
            await page.waitForTimeout(100);

            const initialFirstRenderedRowIndex = await getFirstRenderedRowIndexAsync(page);
            await beginDiffGridStyleWriteTrackingAsync(page);

            await leftPane.evaluate((element) => {
                element.scrollTop = 7200;
                element.scrollLeft = 240;
            });

            await expect.poll(async () => await getFirstRenderedRowIndexAsync(page)).toBeGreaterThan(initialFirstRenderedRowIndex + 40);
            await page.waitForTimeout(50);
            const counts = await getDiffGridStyleWriteCountsAsync(page);
            expect(counts.gridRowTransformWrites).toBe(0);
            expect(counts.gridCellTransformWrites).toBe(0);
            expect(counts.gridRowZIndexWrites).toBe(0);
            expect(counts.gridCellZIndexWrites).toBe(0);
        },
    );

    test(
        "差分タブで左ペインの選択を更新しても静的 detached header レイヤーに childList mutation が発生しないこと",
        async ({ page }) => {
            await page.setViewportSize({ width: 1400, height: 900 });
            await page.addInitScript((args: {
                status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
                headFiles: Record<string, string>;
            }) => {
                (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
                (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
            }, { status: GIT_STATUS, headFiles: createHeadFiles() });

            await installMockApiAsync(page, createFileSystem());
            await page.goto("/");
            await openDiffTabAsync(page);

            const diffTab = page.locator('.diff-tab-wrapper:not([style*="display: none"]) .diff-tab');
            const leftPane = diffTab.locator(".diff-pane-left");
            await expect(leftPane).toBeVisible();
            await beginDetachedHeaderMutationTrackingAsync(page);

            const targetCell = leftPane.locator('.editor-table-grid .editor-table-row[data-row-index="5"] .editor-table-cell[data-col="2"]');
            await expect(targetCell).toBeVisible();
            await targetCell.click();

            await expect(targetCell).toHaveClass(/editor-table-cell-focused/);
            await page.waitForTimeout(50);
            await expect.poll(async () => (await getDetachedHeaderMutationCountsAsync(page)).columnHeaderLayer).toBe(0);
            await expect.poll(async () => (await getDetachedHeaderMutationCountsAsync(page)).cornerLayer).toBe(0);
        },
    );

    test(
        "差分タブで広い選択範囲のままスクロールしても新しく表示された行ヘッダーの選択状態が維持されること",
        async ({ page }) => {
            await page.setViewportSize({ width: 1400, height: 900 });
            await page.addInitScript((args: {
                status: { changes: { path: string; tableName: string; isNew: boolean }[]; staged: { path: string; tableName: string; isNew: boolean }[] };
                headFiles: Record<string, string>;
            }) => {
                (window as unknown as { __mockGitStatus: object }).__mockGitStatus = args.status;
                (window as unknown as { __mockGitHeadFiles: Record<string, string> }).__mockGitHeadFiles = args.headFiles;
            }, { status: GIT_STATUS, headFiles: createHeadFiles() });

            await installMockApiAsync(page, createFileSystem());
            await page.goto("/");
            await openDiffTabAsync(page);

            const diffTab = page.locator('.diff-tab-wrapper:not([style*="display: none"]) .diff-tab');
            const rightPane = diffTab.locator(".diff-pane-right");
            await expect(rightPane).toBeVisible();
            const startCell = rightPane.locator('.editor-table-grid .editor-table-row[data-row-index="20"] .editor-table-cell[data-col="1"]');
            await expect(startCell).toBeVisible();
            await startCell.click();

            await rightPane.evaluate((element, targetRowIndex) => {
                const firstRow = element.querySelector('.editor-table-grid .editor-table-row[data-row-index="0"]');
                const secondRow = element.querySelector('.editor-table-grid .editor-table-row[data-row-index="1"]');
                if (!(firstRow instanceof HTMLElement) || !(secondRow instanceof HTMLElement)) {
                    throw new Error("行高計算用の先頭行が見つかりません");
                }
                const rowHeight = secondRow.offsetTop - firstRow.offsetTop;
                element.scrollTop = targetRowIndex * rowHeight;
            }, 200);
            const rangeEndCell = rightPane.locator('.editor-table-grid .editor-table-row[data-row-index="200"] .editor-table-cell[data-col="1"]');
            await expect(rangeEndCell).toBeVisible();
            await page.keyboard.down("Shift");
            await rangeEndCell.click();
            await page.keyboard.up("Shift");

            const targetSourceRowHeader = rightPane.locator('.editor-table-grid .editor-table-row[data-row-index="200"] .editor-table-row-header');
            const targetDetachedRowHeader = rightPane.locator('.editor-table-detached-row-header-layer .editor-table-detached-row[data-row-index="200"] .editor-table-row-header');
            const targetSourceCell = rightPane.locator('.editor-table-grid .editor-table-row[data-row-index="200"] .editor-table-cell[data-col="1"]');

            await expect(targetSourceRowHeader).toBeVisible();
            await expect(targetDetachedRowHeader).toBeVisible();
            await expect(targetSourceRowHeader).toHaveClass(/selected/);
            await expect(targetDetachedRowHeader).toHaveClass(/selected/);
            await expect(targetSourceCell).toHaveClass(/sel-bg/);
        },
    );
});
