import {
    getEffectiveCssZoom,
    getLayoutBorderBoxHeightPx,
    getLayoutBorderBoxWidthPx,
    getLayoutLeftRelativeToPx,
    getLayoutRightRelativeToPx,
    getLayoutTopRelativeToPx,
} from "../core/layout-metrics";
import {EditorTable} from "./editor-table";
import {BLAME_COLUMN_WIDTH_PX} from "../core/constant";

interface GridLinePixelMetrics {
    devicePixelRatio: number;
    cssZoom: number;
    originLeft: number;
    originTop: number;
    hairlineWidth: number;
}

/**
 * EditorTable のセル境界線を CSS border ではなく独立した 1px div で描画する。
 *
 * セル内容は textContent で頻繁に置き換えられるため、線はセル内ではなく各表示レイヤー上の
 * オーバーレイとして描画する。仮想スクロール中の行 top / 固定行列の detached layer に追従する。
 */
export class EditorTableGridLines {
    [key: string]: any;

    constructor(table: EditorTable) {
        return new Proxy(this, {
            get: (target, property, receiver) => {
                if (property in target) return Reflect.get(target, property, receiver);
                return Reflect.get(table as any, property);
            },
            set: (target, property, value, receiver) => {
                if (property in target) return Reflect.set(target, property, value, receiver);
                (table as any)[property] = value;
                return true;
            },
        });
    }

    refresh(): void {
        this.clearDetachedLineGroups();
        if (this.usesInternalMainViewport) {
            this.refreshInternalMainLayer();
        } else {
            this.refreshLegacyMainLayer();
        }
        this.refreshDetachedLineGroup(this.detachedCornerLayer);
        this.refreshDetachedLineGroup(this.detachedColumnHeaderLayer);
        this.refreshDetachedLineGroup(this.detachedFrozenCornerDataLayer);
        this.refreshDetachedLineGroup(this.detachedFrozenRowDataLayer);
        this.refreshDetachedLineGroup(this.detachedRowHeaderLayer);
    }

    private refreshInternalMainLayer(): void {
        this.gridLineMainLayer.replaceChildren();
        const fragment = document.createDocumentFragment();
        const rows = this.getRenderedRowElements() as HTMLElement[];
        const fixedLeftColumnCount = this.dataColumnOffset() + this.frozenColumnCount;
        const clipWidth = this.bottomRightPane.clientWidth;
        const clipHeight = this.bottomRightPane.clientHeight;
        const pixelMetrics = this.getPixelMetrics(this.gridLineMainLayer);
        const targetRows: HTMLElement[] = [];
        for (const row of rows) {
            const logicalRowIndex = this.getLogicalRowIndexFromElement(row);
            if (logicalRowIndex === null || logicalRowIndex === 0 || logicalRowIndex <= this.frozenRowCount) continue;
            targetRows.push(row);
        }
        this.appendGridLines(fragment, targetRows, this.gridLineMainLayer, fixedLeftColumnCount, clipWidth, clipHeight, pixelMetrics);
        this.gridLineMainLayer.appendChild(fragment);
    }

    private refreshLegacyMainLayer(): void {
        this.gridLineMainLayer.replaceChildren();
        const fragment = document.createDocumentFragment();
        const rows = this.getRenderedRowElements() as HTMLElement[];
        const clipWidth = this.element.scrollWidth;
        const clipHeight = this.element.scrollHeight;
        const pixelMetrics = this.getPixelMetrics(this.gridLineMainLayer);
        this.appendGridLines(fragment, rows, this.gridLineMainLayer, 0, clipWidth, clipHeight, pixelMetrics);
        this.gridLineMainLayer.appendChild(fragment);
    }

    private refreshDetachedLineGroup(layer: HTMLElement): void {
        const rows = this.getDetachedRows(layer);
        if (rows.length === 0) return;
        const group = document.createElement('div');
        group.classList.add('editor-table-grid-line-group');
        const fragment = document.createDocumentFragment();
        const pixelMetrics = this.getPixelMetrics(layer);
        this.appendGridLines(fragment, rows, layer, 0, 0, 0, pixelMetrics);
        group.appendChild(fragment);
        layer.appendChild(group);
    }

    private appendGridLines(
        fragment: DocumentFragment,
        rows: HTMLElement[],
        lineContainer: HTMLElement,
        startCellIndex: number,
        clipWidth: number,
        clipHeight: number,
        pixelMetrics: GridLinePixelMetrics
    ): void {
        const templateRow = rows.find(row => row.children.length > startCellIndex);
        if (templateRow === undefined) return;
        const boundaries = this.getColumnBoundaries(templateRow, lineContainer);
        if (boundaries.length <= startCellIndex + 1) return;
        const lineStartX = boundaries[startCellIndex];
        const lineEndX = boundaries[boundaries.length - 1];
        const lineWidth = lineEndX - lineStartX;
        if (lineWidth <= 0) return;

        let minTop = Number.POSITIVE_INFINITY;
        let maxBottom = Number.NEGATIVE_INFINITY;
        for (const row of rows) {
            const rowHeight = this.getRowHeight(row);
            if (rowHeight <= 0) continue;
            const rowTop = getLayoutTopRelativeToPx(row, lineContainer);
            minTop = Math.min(minTop, rowTop);
            maxBottom = Math.max(maxBottom, rowTop + rowHeight);
            this.appendLine(
                fragment,
                'editor-table-grid-line-horizontal',
                lineStartX,
                rowTop + rowHeight - pixelMetrics.hairlineWidth,
                lineWidth,
                pixelMetrics.hairlineWidth,
                clipWidth,
                clipHeight,
                pixelMetrics
            );
        }
        if (!Number.isFinite(minTop) || !Number.isFinite(maxBottom) || maxBottom <= minTop) return;
        for (let index = startCellIndex + 1; index < boundaries.length; index++) {
            this.appendLine(
                fragment,
                'editor-table-grid-line-vertical',
                boundaries[index] - pixelMetrics.hairlineWidth,
                minTop,
                pixelMetrics.hairlineWidth,
                maxBottom - minTop,
                clipWidth,
                clipHeight,
                pixelMetrics
            );
        }
    }

    private getColumnBoundaries(row: HTMLElement, lineContainer: HTMLElement): number[] {
        const configuredBoundaries = this.getConfiguredColumnBoundaries(row, lineContainer);
        if (configuredBoundaries !== null) return configuredBoundaries;

        const firstCell = Array.from(row.children).find(child => child instanceof HTMLElement) as HTMLElement | undefined;
        if (firstCell === undefined) return [];
        const boundaries: number[] = [getLayoutLeftRelativeToPx(firstCell, lineContainer)];
        for (const child of Array.from(row.children)) {
            if (!(child instanceof HTMLElement)) continue;
            const cellWidth = this.getCellWidth(child);
            if (cellWidth <= 0) continue;
            boundaries.push(getLayoutRightRelativeToPx(child, lineContainer));
        }
        return boundaries;
    }

    private getConfiguredColumnBoundaries(row: HTMLElement, lineContainer: HTMLElement): number[] | null {
        const cells = Array.from(row.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
        if (cells.length === 0) return null;
        if (cells.some(cell => cell.style.transform.trim() !== '')) return null;
        const firstCell = cells[0];
        const boundaries: number[] = [getLayoutLeftRelativeToPx(firstCell, lineContainer)];
        for (const cell of cells) {
            const cellWidth = this.getConfiguredCellWidthPx(cell);
            if (cellWidth <= 0) return null;
            boundaries.push(boundaries[boundaries.length - 1] + cellWidth);
        }
        return boundaries;
    }

    private appendLine(
        fragment: DocumentFragment,
        className: string,
        left: number,
        top: number,
        width: number,
        height: number,
        clipWidth: number,
        clipHeight: number,
        pixelMetrics: GridLinePixelMetrics
    ): void {
        const isVerticalLine = className.includes('vertical');
        const snappedLeft = this.snapCssPxToDevicePixel(left, pixelMetrics.originLeft, pixelMetrics);
        const snappedTop = this.snapCssPxToDevicePixel(top, pixelMetrics.originTop, pixelMetrics);
        const snappedRight = this.snapCssPxToDevicePixel(left + width, pixelMetrics.originLeft, pixelMetrics);
        const snappedBottom = this.snapCssPxToDevicePixel(top + height, pixelMetrics.originTop, pixelMetrics);
        const snappedWidth = isVerticalLine
            ? pixelMetrics.hairlineWidth
            : Math.max(pixelMetrics.hairlineWidth, snappedRight - snappedLeft);
        const snappedHeight = isVerticalLine
            ? Math.max(pixelMetrics.hairlineWidth, snappedBottom - snappedTop)
            : pixelMetrics.hairlineWidth;
        if (clipWidth > 0 && (snappedLeft + snappedWidth < 0 || snappedLeft > clipWidth)) return;
        if (clipHeight > 0 && (snappedTop + snappedHeight < 0 || snappedTop > clipHeight)) return;
        const line = document.createElement('div');
        line.classList.add('editor-table-grid-line', className);
        line.style.left = `${snappedLeft}px`;
        line.style.top = `${snappedTop}px`;
        line.style.width = `${snappedWidth}px`;
        line.style.height = `${snappedHeight}px`;
        fragment.appendChild(line);
    }

    private getPixelMetrics(container: HTMLElement): GridLinePixelMetrics {
        const rect = container.getBoundingClientRect();
        const devicePixelRatio = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
            ? window.devicePixelRatio
            : 1;
        const cssZoom = getEffectiveCssZoom(container);
        const effectiveZoom = cssZoom > 0 ? cssZoom : 1;
        return {
            devicePixelRatio,
            cssZoom: effectiveZoom,
            originLeft: rect.left,
            originTop: rect.top,
            hairlineWidth: 1 / (devicePixelRatio * effectiveZoom),
        };
    }

    private snapCssPxToDevicePixel(value: number, visualOrigin: number, metrics: GridLinePixelMetrics): number {
        const visualValue = visualOrigin + (value * metrics.cssZoom);
        const snappedVisualValue = Math.round(visualValue * metrics.devicePixelRatio) / metrics.devicePixelRatio;
        return (snappedVisualValue - visualOrigin) / metrics.cssZoom;
    }

    private getDetachedRows(layer: HTMLElement): HTMLElement[] {
        const rows: HTMLElement[] = [];
        for (const child of Array.from(layer.children)) {
            if (!(child instanceof HTMLElement)) continue;
            if (!child.classList.contains('editor-table-detached-row')) continue;
            rows.push(child);
        }
        return rows;
    }

    private clearDetachedLineGroups(): void {
        const layers: HTMLElement[] = [
            this.detachedCornerLayer,
            this.detachedColumnHeaderLayer,
            this.detachedFrozenCornerDataLayer,
            this.detachedFrozenRowDataLayer,
            this.detachedRowHeaderLayer,
        ];
        for (const layer of layers) {
            for (const child of Array.from(layer.children)) {
                if (child instanceof HTMLElement && child.classList.contains('editor-table-grid-line-group')) child.remove();
            }
        }
    }

    private getCellWidth(cell: HTMLElement): number {
        const configuredWidth = this.getConfiguredCellWidthPx(cell);
        if (configuredWidth > 0) return configuredWidth;
        const inlineWidth = this.parsePx(cell.style.width);
        if (inlineWidth > 0) return inlineWidth;
        const inlineMinWidth = this.parsePx(cell.style.minWidth);
        if (inlineMinWidth > 0) return inlineMinWidth;
        const measured = getLayoutBorderBoxWidthPx(cell);
        return measured > 0 ? measured : 0;
    }

    private getConfiguredCellWidthPx(cell: HTMLElement): number {
        if (cell.classList.contains('blame-cell') || cell.classList.contains('blame-column-header')) {
            return BLAME_COLUMN_WIDTH_PX;
        }
        if (cell.classList.contains('editor-table-row-header') || cell.classList.contains('editor-table-corner-cell')) {
            return this.getRowHeaderLayoutWidthPx();
        }
        const dataColumnIndex = Number(cell.dataset.col);
        if (Number.isInteger(dataColumnIndex) && dataColumnIndex >= 0 && dataColumnIndex < this.getColumnCount()) {
            return this.getColumnLayoutWidthPx(dataColumnIndex);
        }
        return 0;
    }

    private getRowHeight(row: HTMLElement): number {
        if (this.isHeaderGridRow(row)) return this.getHeaderLayoutHeightPx();
        let height = this.parsePx(row.style.height);
        if (height > 0) return height;
        for (const child of Array.from(row.children)) {
            if (!(child instanceof HTMLElement)) continue;
            height = Math.max(height, this.parsePx(child.style.height), this.parsePx(child.style.minHeight));
        }
        if (height > 0) return height;
        const measured = getLayoutBorderBoxHeightPx(row);
        return measured > 0 ? measured : 0;
    }

    private isHeaderGridRow(row: HTMLElement): boolean {
        if (row.classList.contains('editor-table-column-header-row')) return true;
        if (row.classList.contains('editor-table-source-column-header-row')) return true;
        return row.parentElement === this.detachedCornerLayer && row.classList.contains('editor-table-detached-row');
    }

    private parsePx(value: string): number {
        if (value.trim() === '') return 0;
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
}
