import {EditorTable} from "./editor-table";
import {BLAME_COLUMN_WIDTH_PX, ROW_HEADER_WIDTH_PX} from "../core/constant";
import {RenderedRowsUpdate} from "./virtual-scroll-controller";

/**
 * 固定行列・detached layer・quadrant layout の表示同期を担当する。
 *
 * EditorTable から段階的に剥がしている途中のため、Proxy で既存ファサードへフォールバックする。
 * 移動したメソッドの本文は基本的に元のまま保ち、挙動変更を避ける。
 */
export class EditorTableLayout {
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

    getHeaderRowHeightPx(): number {
        return this.virtualScroll.getActualHeaderHeightPx();
    }

    getDataRowHeightPx(): number {
        return this.virtualScroll.getActualRowHeightPx();
    }

    getColumnLayoutWidthPx(columnIndex: number): number {
        const column = this.tableData.header[columnIndex];
        if (!column) throw new Error(`列定義が見つかりません: columnIndex=${columnIndex}`);
        return parseFloat(column.width);
    }

    getRenderedDataColumnWidthPx(columnIndex: number): number {
        const start = this.getRenderedDataBoundaryOffsetPx(columnIndex);
        const end = this.getRenderedDataBoundaryOffsetPx(columnIndex + 1);
        const width = end - start;
        return width > 0 ? width : this.getColumnLayoutWidthPx(columnIndex);
    }

    /**
     * 列ヘッダーの実レイアウトから、データ列先頭を基準にした境界位置を返す。
     * コメント付きヘッダーでは padding / badge / icon により schema.width より実幅が広がるため、
     * 4領域分割の境界は render 後の offset 位置をSSOTにする。
     */
    getRenderedDataBoundaryOffsetPx(dataColumnExclusiveEnd: number): number {
        if (dataColumnExclusiveEnd <= 0) return 0;
        const headerRow = this.getRowElement(0);
        if (headerRow !== null) {
            const firstDataCell = headerRow.children[this.dataColumnOffset()];
            if (firstDataCell instanceof HTMLElement) {
                if (dataColumnExclusiveEnd < this.getColumnCount()) {
                    const boundaryCell = headerRow.children[this.dataColumnOffset() + dataColumnExclusiveEnd];
                    if (boundaryCell instanceof HTMLElement) {
                        const renderedWidth = boundaryCell.offsetLeft - firstDataCell.offsetLeft;
                        if (renderedWidth > 0) return renderedWidth;
                    }
                } else {
                    const lastDataCell = headerRow.children[headerRow.children.length - 1];
                    if (lastDataCell instanceof HTMLElement) {
                        const renderedWidth = (lastDataCell.offsetLeft + lastDataCell.offsetWidth) - firstDataCell.offsetLeft;
                        if (renderedWidth > 0) return renderedWidth;
                    }
                }
            }
        }
        let width = 0;
        for (let dataColumnIndex = 0; dataColumnIndex < Math.min(dataColumnExclusiveEnd, this.getColumnCount()); dataColumnIndex++) {
            width += this.getColumnLayoutWidthPx(dataColumnIndex);
        }
        return width;
    }

    getDetachedPrefixWidthPx(): number {
        const headerRow = this.getRowElement(0);
        if (!headerRow) {
            return ROW_HEADER_WIDTH_PX + (this.isBlameVisible ? BLAME_COLUMN_WIDTH_PX : 0);
        }
        const firstDataCell = headerRow.children[this.dataColumnOffset()] as HTMLElement | null;
        if (!firstDataCell) {
            return ROW_HEADER_WIDTH_PX + (this.isBlameVisible ? BLAME_COLUMN_WIDTH_PX : 0);
        }
        return firstDataCell.offsetLeft;
    }

    getDataAreaWidthPx(): number {
        return this.getRenderedDataBoundaryOffsetPx(this.getColumnCount());
    }

    getFrozenColumnAreaWidthPx(): number {
        return this.getRenderedDataBoundaryOffsetPx(this.frozenColumnCount);
    }

    getFixedLeftWidthPx(): number {
        return this.getDetachedPrefixWidthPx() + this.getFrozenColumnAreaWidthPx();
    }

    getFixedTopHeightPx(): number {
        return this.getHeaderRowHeightPx() + (this.frozenRowCount * this.getDataRowHeightPx());
    }

    getLogicalRowIndexFromElement(rowElement: HTMLElement): number | null {
        if (rowElement.classList.contains('editor-table-column-header-row')
            || rowElement.classList.contains('editor-table-source-column-header-row')) return 0;
        const rowIndexText = rowElement.dataset.rowIndex;
        if (rowIndexText === undefined) return null;
        return Number(rowIndexText) + 1;
    }

    forwardClonedCellPointerInteractions(cloneCell: HTMLElement, sourceCell: HTMLElement): void {
        const relayEvent = (event: MouseEvent, type: 'mousedown' | 'dblclick' | 'contextmenu') => {
            const forwarded = new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                button: event.button,
                buttons: event.buttons,
                clientX: event.clientX,
                clientY: event.clientY,
                ctrlKey: event.ctrlKey,
                shiftKey: event.shiftKey,
                altKey: event.altKey,
                metaKey: event.metaKey,
            });
            sourceCell.dispatchEvent(forwarded);
            event.preventDefault();
            event.stopPropagation();
        };
        cloneCell.addEventListener('mousedown', (event) => relayEvent(event, 'mousedown'));
        cloneCell.addEventListener('dblclick', (event) => relayEvent(event, 'dblclick'));
        cloneCell.addEventListener('contextmenu', (event) => relayEvent(event, 'contextmenu'));
    }

    cloneDetachedCell(sourceCell: HTMLElement): HTMLElement {
        const cloneCell = sourceCell.cloneNode(true) as HTMLElement;
        cloneCell.style.visibility = '';
        cloneCell.style.flex = '0 0 auto';
        {
            // detached layer は flex レイアウトなので、table レイアウトで確定した実幅をそのまま引き継ぐ。
            const computedStyle = window.getComputedStyle(sourceCell);
            const renderedWidth = sourceCell.getBoundingClientRect().width;
            const width = computedStyle.boxSizing === 'border-box'
                ? renderedWidth
                : renderedWidth
                    - parseFloat(computedStyle.paddingLeft)
                    - parseFloat(computedStyle.paddingRight)
                    - parseFloat(computedStyle.borderLeftWidth)
                    - parseFloat(computedStyle.borderRightWidth);
            if (width > 0) {
                cloneCell.style.width = `${width}px`;
                cloneCell.style.minWidth = `${width}px`;
                cloneCell.style.maxWidth = `${width}px`;
            }
        }
        if (cloneCell.classList.contains('editor-table-column-header')) {
            cloneCell.addEventListener('mousedown', this.contextMenuHandler.createColumnHeaderClickHandler(cloneCell));
            cloneCell.addEventListener('contextmenu', this.contextMenuHandler.createColumnHeaderContextMenuHandler(cloneCell));
            const resizeHandle = cloneCell.querySelector('.column-resize-handle') as HTMLElement | null;
            if (resizeHandle !== null) {
                const columnIndexText = cloneCell.dataset.columnIndex;
                if (columnIndexText === undefined) throw new Error('分離列ヘッダーに columnIndex がありません');
                this.areaResizer.setupColumnResizeHandle(resizeHandle, cloneCell, Number(columnIndexText));
            }
            const filterIcon = cloneCell.querySelector('.filter-icon') as HTMLElement | null;
            if (filterIcon !== null) {
                filterIcon.addEventListener('mousedown', (e) => { e.stopPropagation(); });
                filterIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const headerCell = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
                    const colIdx = Number(headerCell.dataset.columnIndex);
                    this.openFilterDropdown(colIdx, e.currentTarget as HTMLElement);
                });
            }
            const sortIndicator = cloneCell.querySelector('.sort-indicator') as HTMLElement | null;
            if (sortIndicator !== null) {
                sortIndicator.addEventListener('mousedown', (e) => { e.stopPropagation(); });
                sortIndicator.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const headerCell = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
                    const colIdx = Number(headerCell.dataset.columnIndex);
                    this.applySortForColumn(colIdx);
                });
            }
        }
        if (cloneCell.classList.contains('editor-table-row-header')) {
            cloneCell.addEventListener('mousedown', (e: MouseEvent) => {
                if (e.button !== 0) return;
                const rowIndexText = cloneCell.dataset.rowIndex;
                if (rowIndexText === undefined) throw new Error('分離行ヘッダーに rowIndex がありません');
                this.getRowDragController().onRowHeaderMouseDown(Number(rowIndexText), e.clientY, cloneCell, e);
            });
            cloneCell.addEventListener('mousedown', this.contextMenuHandler.createRowHeaderClickHandler(cloneCell));
            cloneCell.addEventListener('contextmenu', this.contextMenuHandler.createRowHeaderContextMenuHandler(cloneCell));
        }
        if (cloneCell.classList.contains('editor-table-corner-cell')) {
            cloneCell.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                this.handler.submitAndHide();
                this.selection.selectAll();
            });
        }
        if (!cloneCell.classList.contains('editor-table-column-header')
            && !cloneCell.classList.contains('editor-table-row-header')
            && !cloneCell.classList.contains('editor-table-corner-cell')) {
            this.forwardClonedCellPointerInteractions(cloneCell, sourceCell);
        }
        return cloneCell;
    }

    syncDetachedCellVisualState(sourceCell: HTMLElement, detachedCell: HTMLElement): void {
        if (detachedCell.innerHTML !== sourceCell.innerHTML) {
            const replacement = this.cloneDetachedCell(sourceCell);
            detachedCell.replaceWith(replacement);
            detachedCell = replacement;
        }
        detachedCell.className = sourceCell.className;
        if (sourceCell.hasAttribute('data-bookmarked')) {
            detachedCell.setAttribute('data-bookmarked', '');
        } else {
            detachedCell.removeAttribute('data-bookmarked');
        }
    }

    syncDetachedRowVisualState(sourceRow: HTMLElement, detachedRow: HTMLElement): void {
        detachedRow.classList.toggle('freeze-row', sourceRow.classList.contains('freeze-row'));
        detachedRow.classList.toggle('freeze-row-border', sourceRow.classList.contains('freeze-row-border'));
    }

    refreshDetachedHeaderLayers(): void {
        this.virtualScroll.refreshMeasuredGeometry();
        if (this.usesInternalMainViewport) {
            this.refreshQuadrantPaneLayers();
            return;
        }
        const renderedRows = this.getRenderedRowElements();
        for (const renderedRow of renderedRows) {
            const cellCount = renderedRow.children.length;
            if (renderedRow.classList.contains('editor-table-column-header-row')
                || renderedRow.classList.contains('editor-table-source-column-header-row')) {
                for (let col = 0; col < cellCount; col++) {
                    (renderedRow.children[col] as HTMLElement).style.visibility = '';
                }
                continue;
            }
            for (let col = 0; col < Math.min(this.dataColumnOffset(), cellCount); col++) {
                (renderedRow.children[col] as HTMLElement).style.visibility = '';
            }
        }
        this.detachedColumnHeaderLayer.replaceChildren();
        this.detachedRowHeaderLayer.replaceChildren();
        this.detachedFrozenRowBackgroundLayer.replaceChildren();
        this.detachedCornerLayer.replaceChildren();
        this.detachedFrozenRowDataLayer.replaceChildren();

        const headerRow = this.getRowElement(0);
        if (headerRow === null) return;
        const prefixWidth = this.getDetachedPrefixWidthPx();
        const dataAreaWidth = this.getDataAreaWidthPx();
        const headerHeight = this.getHeaderRowHeightPx();
        const rowHeight = this.getDataRowHeightPx();
        this.detachedColumnHeaderLayer.style.top = `${this.detachedHeaderTopOffset}px`;
        this.detachedFrozenRowBackgroundLayer.style.top = `${this.detachedHeaderTopOffset}px`;
        this.detachedCornerLayer.style.top = `${this.detachedHeaderTopOffset}px`;
        this.detachedColumnHeaderLayer.style.left = `${prefixWidth}px`;
        this.detachedFrozenRowBackgroundLayer.style.left = `${prefixWidth}px`;
        this.detachedFrozenRowDataLayer.style.left = `${prefixWidth}px`;
        this.detachedFrozenRowBackgroundLayer.style.width = `${dataAreaWidth}px`;
        this.detachedFrozenRowDataLayer.style.width = `${dataAreaWidth}px`;
        this.detachedRowHeaderLayer.style.width = `${prefixWidth}px`;
        this.detachedCornerLayer.style.width = `${prefixWidth}px`;
        this.detachedColumnHeaderLayer.style.height = `${headerHeight}px`;
        this.detachedFrozenRowBackgroundLayer.style.height = `${this.frozenRowCount * rowHeight}px`;
        this.detachedFrozenRowDataLayer.style.top = `${this.detachedHeaderTopOffset}px`;
        this.detachedFrozenRowDataLayer.style.height = `${this.frozenRowCount * rowHeight}px`;
        this.detachedCornerLayer.style.height = `${headerHeight}px`;

        for (let i = 0; i < headerRow.children.length; i++) {
            (headerRow.children[i] as HTMLElement).style.visibility = 'hidden';
        }

        const detachedCornerRow = document.createElement('div');
        detachedCornerRow.classList.add('editor-table-detached-row');
        detachedCornerRow.style.top = '0px';
        for (let col = 0; col < this.dataColumnOffset(); col++) {
            const sourceCell = headerRow.children[col] as HTMLElement | null;
            if (sourceCell === null) continue;
            detachedCornerRow.appendChild(this.cloneDetachedCell(sourceCell));
        }
        this.detachedCornerLayer.appendChild(detachedCornerRow);

        const detachedHeaderRow = document.createElement('div');
        detachedHeaderRow.classList.add('editor-table-detached-row', 'editor-table-column-header-row');
        detachedHeaderRow.style.top = '0px';
        for (let col = this.dataColumnOffset(); col < headerRow.children.length; col++) {
            const sourceCell = headerRow.children[col] as HTMLElement | null;
            if (sourceCell === null) continue;
            detachedHeaderRow.appendChild(this.cloneDetachedCell(sourceCell));
        }
        this.detachedColumnHeaderLayer.appendChild(detachedHeaderRow);

        const dataRowEnd = this.getDataRowEndChildIndex();
        for (let childIndex = this.getDataRowChildOffset(); childIndex < dataRowEnd; childIndex++) {
            if (this.virtualScroll.isSpacerIndex(childIndex)) continue;
            const rowElement = this.gridElement.children[childIndex] as HTMLElement | null;
            if (rowElement === null) continue;
            const detachedRow = document.createElement('div');
            detachedRow.classList.add('editor-table-detached-row');
            const rowHeader = rowElement.querySelector('.editor-table-row-header') as HTMLElement | null;
            if (rowHeader !== null) {
                const rowIndexText = rowHeader.dataset.rowIndex;
                if (rowIndexText !== undefined) {
                    detachedRow.dataset.rowIndex = rowIndexText;
                    const logicalRowIndex = Number(rowIndexText) + 1;
                    detachedRow.style.top = logicalRowIndex <= this.frozenRowCount
                        ? `${headerHeight + ((logicalRowIndex - 1) * rowHeight)}px`
                        : `${rowElement.offsetTop}px`;
                    if (logicalRowIndex <= this.frozenRowCount) {
                        const backgroundPlate = document.createElement('div');
                        backgroundPlate.classList.add('editor-table-detached-frozen-row-background');
                        if (logicalRowIndex === this.frozenRowCount) backgroundPlate.classList.add('freeze-row-border');
                        backgroundPlate.dataset.rowIndex = rowIndexText;
                        backgroundPlate.style.top = `${headerHeight + ((logicalRowIndex - 1) * rowHeight)}px`;
                        backgroundPlate.style.width = `${dataAreaWidth}px`;
                        this.detachedFrozenRowBackgroundLayer.appendChild(backgroundPlate);

                        const detachedDataRow = document.createElement('div');
                        detachedDataRow.classList.add('editor-table-detached-row', 'freeze-row');
                        if (logicalRowIndex === this.frozenRowCount) detachedDataRow.classList.add('freeze-row-border');
                        detachedDataRow.dataset.rowIndex = rowIndexText;
                        detachedDataRow.style.top = `${headerHeight + ((logicalRowIndex - 1) * rowHeight)}px`;
                        for (let col = this.dataColumnOffset(); col < rowElement.children.length; col++) {
                            const sourceCell = rowElement.children[col] as HTMLElement | null;
                            if (sourceCell === null) continue;
                            detachedDataRow.appendChild(this.cloneDetachedCell(sourceCell));
                        }
                        this.detachedFrozenRowDataLayer.appendChild(detachedDataRow);
                    }
                }
            }
            if (detachedRow.style.top === '') detachedRow.style.top = `${rowElement.offsetTop}px`;
            if (rowElement.classList.contains('freeze-row')) detachedRow.classList.add('freeze-row');
            if (rowElement.classList.contains('freeze-row-border')) detachedRow.classList.add('freeze-row-border');
            for (let col = 0; col < this.dataColumnOffset(); col++) {
                const sourceCell = rowElement.children[col] as HTMLElement | null;
                if (sourceCell === null) continue;
                sourceCell.style.visibility = 'hidden';
                const detachedCell = this.cloneDetachedCell(sourceCell);
                const rowIndexText = detachedRow.dataset.rowIndex;
                if (rowIndexText !== undefined && (Number(rowIndexText) + 1) <= this.frozenRowCount) {
                    detachedCell.style.zIndex = 'var(--z-index-freeze-corner)';
                }
                detachedRow.appendChild(detachedCell);
            }
            this.detachedRowHeaderLayer.appendChild(detachedRow);
        }
        this.syncDetachedHeaderScrollOffset();
    }

    refreshQuadrantPaneLayers(): void {
        this.virtualScroll.refreshMeasuredGeometry();
        this.detachedColumnHeaderLayer.replaceChildren();
        this.detachedRowHeaderLayer.replaceChildren();
        this.detachedFrozenRowBackgroundLayer.replaceChildren();
        this.detachedCornerLayer.replaceChildren();
        this.detachedFrozenRowDataLayer.replaceChildren();
        this.detachedFrozenCornerDataLayer.replaceChildren();

        const headerRow = this.getRowElement(0);
        if (headerRow === null) return;
        const fixedLeftColumnCount = this.dataColumnOffset() + this.frozenColumnCount;
        const actualFixedLeftWidth = this.getFixedLeftWidthPx();
        const availableWidth = this.element.clientWidth > 0 ? this.element.clientWidth : actualFixedLeftWidth;
        const visibleFixedLeftWidth = Math.min(actualFixedLeftWidth, Math.max(0, availableWidth - 1));
        const fixedTopHeight = this.getFixedTopHeightPx();
        const rowHeight = this.getDataRowHeightPx();
        this.virtualScroll.setScrollTopCompensationPx(fixedTopHeight);
        const frozenColumnWidth = this.getFrozenColumnAreaWidthPx();
        const dataAreaWidth = this.getDataAreaWidthPx();
        const mainContentWidth = Math.max(0, dataAreaWidth - frozenColumnWidth);
        const mainContentHeight = Math.max(0, (this.getLogicalRowCount() - 1 - this.frozenRowCount) * rowHeight);
        const paneTop = this.detachedHeaderTopOffset;

        this.topLeftPane.style.top = `${paneTop}px`;
        this.topLeftPane.style.left = '0px';
        this.topLeftPane.style.width = `${visibleFixedLeftWidth}px`;
        this.topLeftPane.style.height = `${fixedTopHeight}px`;
        this.topRightPane.style.top = `${paneTop}px`;
        this.topRightPane.style.left = `${visibleFixedLeftWidth}px`;
        this.topRightPane.style.height = `${fixedTopHeight}px`;
        this.bottomLeftPane.style.top = `${paneTop + fixedTopHeight}px`;
        this.bottomLeftPane.style.left = '0px';
        this.bottomLeftPane.style.width = `${visibleFixedLeftWidth}px`;
        this.bottomRightPane.style.top = `${paneTop + fixedTopHeight}px`;
        this.bottomRightPane.style.left = `${visibleFixedLeftWidth}px`;
        this.bottomRightPane.style.right = '0px';
        this.bottomRightPane.style.bottom = '0px';
        this.topLeftContent.style.width = `${actualFixedLeftWidth}px`;
        this.topLeftContent.style.height = `${fixedTopHeight}px`;
        this.topRightContent.style.width = `${mainContentWidth}px`;
        this.topRightContent.style.height = `${fixedTopHeight}px`;
        this.leftBottomContent.style.width = `${actualFixedLeftWidth}px`;
        this.leftBottomContent.style.height = `${mainContentHeight}px`;
        this.mainContent.style.width = `${mainContentWidth}px`;
        this.mainContent.style.height = `${mainContentHeight}px`;
        this.gridElement.style.position = 'absolute';
        this.gridElement.style.left = `${-actualFixedLeftWidth}px`;
        this.gridElement.style.top = `${-fixedTopHeight}px`;

        // 右下だけが実スクロール担当なので、そこで消費されるガター幅・高さを
        // 右上ヘッダー領域と左下行ヘッダー領域にも反映して見た目の列幅・行高を揃える。
        const mainViewportScrollbarWidth = Math.max(0, this.scrollContainer.offsetWidth - this.scrollContainer.clientWidth);
        const mainViewportScrollbarHeight = Math.max(0, this.scrollContainer.offsetHeight - this.scrollContainer.clientHeight);
        this.topRightPane.style.right = `${mainViewportScrollbarWidth}px`;
        this.bottomLeftPane.style.bottom = `${mainViewportScrollbarHeight}px`;

        const detachedCornerRow = document.createElement('div');
        detachedCornerRow.classList.add('editor-table-detached-row');
        detachedCornerRow.style.top = '0px';
        for (let col = 0; col < Math.min(fixedLeftColumnCount, headerRow.children.length); col++) {
            const sourceCell = headerRow.children[col] as HTMLElement | null;
            if (sourceCell === null) continue;
            detachedCornerRow.appendChild(this.cloneDetachedCell(sourceCell));
        }
        this.detachedCornerLayer.appendChild(detachedCornerRow);

        const detachedHeaderRow = document.createElement('div');
        detachedHeaderRow.classList.add('editor-table-detached-row', 'editor-table-column-header-row');
        detachedHeaderRow.style.top = '0px';
        for (let col = fixedLeftColumnCount; col < headerRow.children.length; col++) {
            const sourceCell = headerRow.children[col] as HTMLElement | null;
            if (sourceCell === null) continue;
            detachedHeaderRow.appendChild(this.cloneDetachedCell(sourceCell));
        }
        this.detachedColumnHeaderLayer.appendChild(detachedHeaderRow);

        const renderedRows = this.getRenderedRowElements();
        for (const rowElement of renderedRows) {
            const logicalRowIndex = this.getLogicalRowIndexFromElement(rowElement);
            if (logicalRowIndex === null || logicalRowIndex === 0) continue;
            const rowHeader = rowElement.querySelector('.editor-table-row-header') as HTMLElement | null;
            if (rowHeader === null) continue;
            const rowIndexText = rowHeader.dataset.rowIndex;
            if (rowIndexText === undefined) continue;
            const rowTop = this.getQuadrantViewportRowTopPx(logicalRowIndex);

            if (logicalRowIndex <= this.frozenRowCount) {
                const backgroundPlate = document.createElement('div');
                backgroundPlate.classList.add('editor-table-detached-frozen-row-background');
                if (logicalRowIndex === this.frozenRowCount) backgroundPlate.classList.add('freeze-row-border');
                backgroundPlate.dataset.rowIndex = rowIndexText;
                backgroundPlate.style.top = `${rowTop}px`;
                backgroundPlate.style.width = `${mainContentWidth}px`;
                this.detachedFrozenRowBackgroundLayer.appendChild(backgroundPlate);

                const frozenCornerRow = document.createElement('div');
                frozenCornerRow.classList.add('editor-table-detached-row', 'freeze-row');
                if (logicalRowIndex === this.frozenRowCount) frozenCornerRow.classList.add('freeze-row-border');
                frozenCornerRow.dataset.rowIndex = rowIndexText;
                frozenCornerRow.style.top = `${rowTop}px`;
                for (let col = 0; col < Math.min(fixedLeftColumnCount, rowElement.children.length); col++) {
                    const sourceCell = rowElement.children[col] as HTMLElement | null;
                    if (sourceCell === null) continue;
                    frozenCornerRow.appendChild(this.cloneDetachedCell(sourceCell));
                }
                this.detachedFrozenCornerDataLayer.appendChild(frozenCornerRow);

                const frozenDataRow = document.createElement('div');
                frozenDataRow.classList.add('editor-table-detached-row', 'freeze-row');
                if (logicalRowIndex === this.frozenRowCount) frozenDataRow.classList.add('freeze-row-border');
                frozenDataRow.dataset.rowIndex = rowIndexText;
                frozenDataRow.style.top = `${rowTop}px`;
                for (let col = fixedLeftColumnCount; col < rowElement.children.length; col++) {
                    const sourceCell = rowElement.children[col] as HTMLElement | null;
                    if (sourceCell === null) continue;
                    frozenDataRow.appendChild(this.cloneDetachedCell(sourceCell));
                }
                this.detachedFrozenRowDataLayer.appendChild(frozenDataRow);
                continue;
            }
        }
        this.refreshQuadrantViewportRowHeaders(null);
        this.emitScrollMetricsChanged();
    }

    refreshQuadrantViewportRowHeaders(update: RenderedRowsUpdate | null): void {
        if (!this.usesInternalMainViewport) return;
        const scrollTop = update !== null ? update.scrollTop : this.scrollContainer.scrollTop;
        const scrollLeft = update !== null ? update.scrollLeft : this.scrollContainer.scrollLeft;
        const fixedLeftColumnCount = this.dataColumnOffset() + this.frozenColumnCount;
        const rebuildAll = (): void => {
            const renderedRows = this.getRenderedRowElements();
            const fragment = document.createDocumentFragment();
            for (const rowElement of renderedRows) {
                const rowHeader = rowElement.querySelector('.editor-table-row-header') as HTMLElement | null;
                if (rowHeader === null) continue;
                const rowIndexText = rowHeader.dataset.rowIndex;
                if (rowIndexText === undefined) continue;
                const logicalRowIndex = Number(rowIndexText) + 1;
                if (logicalRowIndex <= this.frozenRowCount) continue;
                const detachedLeftRow = document.createElement('div');
                detachedLeftRow.classList.add('editor-table-detached-row');
                detachedLeftRow.dataset.rowIndex = rowIndexText;
                detachedLeftRow.style.top = `${this.getQuadrantViewportRowTopPx(logicalRowIndex)}px`;
                for (let col = 0; col < Math.min(fixedLeftColumnCount, rowElement.children.length); col++) {
                    const sourceCell = rowElement.children[col] as HTMLElement | null;
                    if (sourceCell === null) continue;
                    detachedLeftRow.appendChild(this.cloneDetachedCell(sourceCell));
                }
                fragment.appendChild(detachedLeftRow);
            }
            this.detachedRowHeaderLayer.replaceChildren(fragment);
            this.syncDetachedHeaderScrollOffsetWithPositions(scrollTop, scrollLeft);
        };
        if (update === null || update.refreshAllRows || this.detachedRowHeaderLayer.childElementCount === 0) {
            rebuildAll();
            return;
        }
        const renderedRows = this.getRenderedRowElements();
        let firstNonFrozenSourceRow: HTMLElement | null = null;
        let lastNonFrozenSourceRow: HTMLElement | null = null;
        for (const rowElement of renderedRows) {
            const logicalRowIndex = this.getLogicalRowIndexFromElement(rowElement);
            if (logicalRowIndex === null || logicalRowIndex <= this.frozenRowCount) continue;
            if (firstNonFrozenSourceRow === null) firstNonFrozenSourceRow = rowElement;
            lastNonFrozenSourceRow = rowElement;
        }
        if (firstNonFrozenSourceRow === null || lastNonFrozenSourceRow === null) {
            rebuildAll();
            return;
        }
        const firstSourceRowHeader = firstNonFrozenSourceRow.querySelector('.editor-table-row-header') as HTMLElement | null;
        const lastSourceRowHeader = lastNonFrozenSourceRow.querySelector('.editor-table-row-header') as HTMLElement | null;
        if (firstSourceRowHeader === null || lastSourceRowHeader === null) {
            rebuildAll();
            return;
        }
        const firstCurrentRowIndexText = firstSourceRowHeader.dataset.rowIndex;
        const lastCurrentRowIndexText = lastSourceRowHeader.dataset.rowIndex;
        if (firstCurrentRowIndexText === undefined || lastCurrentRowIndexText === undefined) {
            rebuildAll();
            return;
        }
        const firstCurrentRowIndex = Number(firstCurrentRowIndexText);
        const lastCurrentRowIndex = Number(lastCurrentRowIndexText);
        while (this.detachedRowHeaderLayer.firstElementChild instanceof HTMLElement) {
            const firstDetachedRow = this.detachedRowHeaderLayer.firstElementChild;
            const rowIndexText = firstDetachedRow.dataset.rowIndex;
            if (rowIndexText !== undefined && Number(rowIndexText) >= firstCurrentRowIndex) break;
            this.detachedRowHeaderLayer.removeChild(firstDetachedRow);
        }
        while (this.detachedRowHeaderLayer.lastElementChild instanceof HTMLElement) {
            const lastDetachedRow = this.detachedRowHeaderLayer.lastElementChild;
            const rowIndexText = lastDetachedRow.dataset.rowIndex;
            if (rowIndexText !== undefined && Number(rowIndexText) <= lastCurrentRowIndex) break;
            this.detachedRowHeaderLayer.removeChild(lastDetachedRow);
        }
        for (const insertedRange of update.insertedRanges) {
            if (insertedRange.start >= insertedRange.end) continue;
            const fragment = document.createDocumentFragment();
            for (let dataRowIndex = insertedRange.start; dataRowIndex < insertedRange.end; dataRowIndex++) {
                const logicalRowIndex = dataRowIndex + 1;
                if (logicalRowIndex <= this.frozenRowCount) continue;
                const sourceRow = this.getRowElement(logicalRowIndex);
                if (sourceRow === null) continue;
                const rowHeader = sourceRow.querySelector('.editor-table-row-header') as HTMLElement | null;
                if (rowHeader === null) continue;
                const rowIndexText = rowHeader.dataset.rowIndex;
                if (rowIndexText === undefined) continue;
                const detachedLeftRow = document.createElement('div');
                detachedLeftRow.classList.add('editor-table-detached-row');
                detachedLeftRow.dataset.rowIndex = rowIndexText;
                detachedLeftRow.style.top = `${this.getQuadrantViewportRowTopPx(logicalRowIndex)}px`;
                for (let col = 0; col < Math.min(fixedLeftColumnCount, sourceRow.children.length); col++) {
                    const sourceCell = sourceRow.children[col] as HTMLElement | null;
                    if (sourceCell === null) continue;
                    detachedLeftRow.appendChild(this.cloneDetachedCell(sourceCell));
                }
                fragment.appendChild(detachedLeftRow);
            }
            if (insertedRange.start <= firstCurrentRowIndex) {
                this.detachedRowHeaderLayer.insertBefore(fragment, this.detachedRowHeaderLayer.firstChild);
                continue;
            }
            this.detachedRowHeaderLayer.appendChild(fragment);
        }
        this.syncDetachedHeaderScrollOffsetWithPositions(scrollTop, scrollLeft);
    }

    /** legacy detached-layer 用: row header clone の top 座標を旧 full rebuild と同じ規則で返す */
    getDetachedViewportRowTopPx(sourceRow: HTMLElement, logicalRowIndex: number): string {
        if (logicalRowIndex <= this.frozenRowCount) {
            return `${this.getHeaderRowHeightPx() + ((logicalRowIndex - 1) * this.getDataRowHeightPx())}px`;
        }
        return `${sourceRow.offsetTop}px`;
    }

    /** legacy detached-layer 用: 行ヘッダー clone を1行分生成する */
    createDetachedViewportRowClone(sourceRow: HTMLElement): HTMLElement | null {
        const rowHeader = sourceRow.querySelector('.editor-table-row-header') as HTMLElement | null;
        if (rowHeader === null) return null;
        const rowIndexText = rowHeader.dataset.rowIndex;
        if (rowIndexText === undefined) return null;
        const logicalRowIndex = Number(rowIndexText) + 1;
        const detachedRow = document.createElement('div');
        detachedRow.classList.add('editor-table-detached-row');
        detachedRow.dataset.rowIndex = rowIndexText;
        detachedRow.style.top = this.getDetachedViewportRowTopPx(sourceRow, logicalRowIndex);
        this.syncDetachedRowVisualState(sourceRow, detachedRow);
        const prefixColumnCount = Math.min(this.dataColumnOffset(), sourceRow.children.length);
        for (let col = 0; col < prefixColumnCount; col++) {
            const sourceCell = sourceRow.children[col] as HTMLElement | null;
            if (sourceCell === null) continue;
            detachedRow.appendChild(this.cloneDetachedCell(sourceCell));
        }
        return detachedRow;
    }

    /** legacy detached-layer 用: 表示中の row header clone の見た目だけを同期する */
    syncDetachedViewportRowHeaderStates(): void {
        if (this.usesInternalMainViewport) return;
        const prefixColumnCount = this.dataColumnOffset();
        const detachedViewportRows = this.detachedRowHeaderLayer.children;
        for (let rowIndex = 0; rowIndex < detachedViewportRows.length; rowIndex++) {
            const detachedRow = detachedViewportRows[rowIndex] as HTMLElement;
            const rowIndexText = detachedRow.dataset.rowIndex;
            if (rowIndexText === undefined) continue;
            const sourceRow = this.getRowElement(Number(rowIndexText) + 1);
            if (sourceRow === null) continue;
            detachedRow.style.top = this.getDetachedViewportRowTopPx(sourceRow, Number(rowIndexText) + 1);
            this.syncDetachedRowVisualState(sourceRow, detachedRow);
            const syncCount = Math.min(prefixColumnCount, sourceRow.children.length, detachedRow.children.length);
            for (let col = 0; col < syncCount; col++) {
                this.syncDetachedCellVisualState(sourceRow.children[col] as HTMLElement, detachedRow.children[col] as HTMLElement);
            }
        }
    }

    /** legacy detached-layer 用: 静的レイヤーを壊さず、表示中 row header のみ差分更新する */
    refreshDetachedViewportRowHeaders(update: RenderedRowsUpdate | null): void {
        if (this.usesInternalMainViewport) return;
        const scrollTop = update !== null ? update.scrollTop : this.scrollContainer.scrollTop;
        const scrollLeft = update !== null ? update.scrollLeft : this.scrollContainer.scrollLeft;
        const rebuildAll = (): void => {
            const renderedRows = this.getRenderedRowElements();
            const fragment = document.createDocumentFragment();
            for (const rowElement of renderedRows) {
                const logicalRowIndex = this.getLogicalRowIndexFromElement(rowElement);
                if (logicalRowIndex === null || logicalRowIndex === 0) continue;
                const detachedRow = this.createDetachedViewportRowClone(rowElement);
                if (detachedRow !== null) fragment.appendChild(detachedRow);
            }
            this.detachedRowHeaderLayer.replaceChildren(fragment);
            this.syncDetachedHeaderScrollOffsetWithPositions(scrollTop, scrollLeft);
        };
        if (update === null || update.refreshAllRows || this.detachedRowHeaderLayer.childElementCount === 0) {
            rebuildAll();
            return;
        }
        const renderedRows = this.getRenderedRowElements();
        let firstSourceRow: HTMLElement | null = null;
        let lastSourceRow: HTMLElement | null = null;
        for (const rowElement of renderedRows) {
            const logicalRowIndex = this.getLogicalRowIndexFromElement(rowElement);
            if (logicalRowIndex === null || logicalRowIndex <= this.frozenRowCount) continue;
            if (firstSourceRow === null) firstSourceRow = rowElement;
            lastSourceRow = rowElement;
        }
        if (firstSourceRow === null || lastSourceRow === null) {
            rebuildAll();
            return;
        }
        const firstSourceRowHeader = firstSourceRow.querySelector('.editor-table-row-header') as HTMLElement | null;
        const lastSourceRowHeader = lastSourceRow.querySelector('.editor-table-row-header') as HTMLElement | null;
        if (firstSourceRowHeader === null || lastSourceRowHeader === null) {
            rebuildAll();
            return;
        }
        const firstCurrentRowIndexText = firstSourceRowHeader.dataset.rowIndex;
        const lastCurrentRowIndexText = lastSourceRowHeader.dataset.rowIndex;
        if (firstCurrentRowIndexText === undefined || lastCurrentRowIndexText === undefined) {
            rebuildAll();
            return;
        }
        const firstCurrentRowIndex = Number(firstCurrentRowIndexText);
        const lastCurrentRowIndex = Number(lastCurrentRowIndexText);
        while (this.detachedRowHeaderLayer.firstElementChild instanceof HTMLElement) {
            const firstDetachedRow = this.detachedRowHeaderLayer.firstElementChild;
            const rowIndexText = firstDetachedRow.dataset.rowIndex;
            if (rowIndexText !== undefined && (Number(rowIndexText) < this.frozenRowCount || Number(rowIndexText) >= firstCurrentRowIndex)) break;
            this.detachedRowHeaderLayer.removeChild(firstDetachedRow);
        }
        while (this.detachedRowHeaderLayer.lastElementChild instanceof HTMLElement) {
            const lastDetachedRow = this.detachedRowHeaderLayer.lastElementChild;
            const rowIndexText = lastDetachedRow.dataset.rowIndex;
            if (rowIndexText !== undefined && Number(rowIndexText) <= lastCurrentRowIndex) break;
            this.detachedRowHeaderLayer.removeChild(lastDetachedRow);
        }
        for (const insertedRange of update.insertedRanges) {
            if (insertedRange.start >= insertedRange.end) continue;
            const fragment = document.createDocumentFragment();
            for (let dataRowIndex = insertedRange.start; dataRowIndex < insertedRange.end; dataRowIndex++) {
                const sourceRow = this.getRowElement(dataRowIndex + 1);
                if (sourceRow === null) continue;
                const detachedRow = this.createDetachedViewportRowClone(sourceRow);
                if (detachedRow !== null) fragment.appendChild(detachedRow);
            }
            if (insertedRange.start <= firstCurrentRowIndex) {
                let firstViewportDetachedRow: Element | null = null;
                for (let childIndex = 0; childIndex < this.detachedRowHeaderLayer.children.length; childIndex++) {
                    const child = this.detachedRowHeaderLayer.children[childIndex] as HTMLElement;
                    const rowIndexText = child.dataset.rowIndex;
                    if (rowIndexText === undefined) continue;
                    if (Number(rowIndexText) < this.frozenRowCount) continue;
                    firstViewportDetachedRow = child;
                    break;
                }
                if (firstViewportDetachedRow === null) {
                    this.detachedRowHeaderLayer.appendChild(fragment);
                } else {
                    this.detachedRowHeaderLayer.insertBefore(fragment, firstViewportDetachedRow);
                }
                continue;
            }
            this.detachedRowHeaderLayer.appendChild(fragment);
        }
        this.syncDetachedHeaderScrollOffsetWithPositions(scrollTop, scrollLeft);
    }

    /** legacy detached-layer 用: static clone の選択状態だけを同期する */
    syncDetachedLegacyStaticCellStates(): void {
        if (this.usesInternalMainViewport) return;
        const headerRow = this.getRowElement(0);
        if (headerRow === null) return;
        const prefixColumnCount = this.dataColumnOffset();
        const detachedCornerRow = this.detachedCornerLayer.firstElementChild as HTMLElement | null;
        if (detachedCornerRow !== null) {
            const syncCount = Math.min(prefixColumnCount, headerRow.children.length, detachedCornerRow.children.length);
            for (let col = 0; col < syncCount; col++) {
                this.syncDetachedCellVisualState(headerRow.children[col] as HTMLElement, detachedCornerRow.children[col] as HTMLElement);
            }
        }
        const detachedHeaderRow = this.detachedColumnHeaderLayer.firstElementChild as HTMLElement | null;
        if (detachedHeaderRow !== null) {
            const availableColumnCount = Math.min(headerRow.children.length - prefixColumnCount, detachedHeaderRow.children.length);
            for (let col = 0; col < availableColumnCount; col++) {
                const detachedChild = detachedHeaderRow.children[col] as HTMLElement | undefined;
                if (detachedChild === undefined) continue;
                this.syncDetachedCellVisualState(
                    headerRow.children[prefixColumnCount + col] as HTMLElement,
                    detachedChild
                );
            }
        }
        for (let logicalRowIndex = 1; logicalRowIndex <= this.frozenRowCount; logicalRowIndex++) {
            const sourceRow = this.getRowElement(logicalRowIndex);
            if (sourceRow === null) continue;
            const dataRowIndex = logicalRowIndex - 1;
            const detachedFrozenDataRow =
                this.detachedFrozenRowDataLayer.querySelector(`.editor-table-detached-row[data-row-index="${dataRowIndex}"]`) as HTMLElement | null;
            if (detachedFrozenDataRow === null) continue;
            this.syncDetachedRowVisualState(sourceRow, detachedFrozenDataRow);
            const syncCount = Math.min(sourceRow.children.length - prefixColumnCount, detachedFrozenDataRow.children.length);
            for (let col = 0; col < syncCount; col++) {
                this.syncDetachedCellVisualState(
                    sourceRow.children[prefixColumnCount + col] as HTMLElement,
                    detachedFrozenDataRow.children[col] as HTMLElement
                );
            }
        }
    }

    syncQuadrantStaticCellStates(): void {
        if (!this.usesInternalMainViewport) return;
        const headerRow = this.getRowElement(0);
        if (headerRow === null) return;
        const fixedLeftColumnCount = this.dataColumnOffset() + this.frozenColumnCount;
        const detachedCornerRow = this.detachedCornerLayer.firstElementChild as HTMLElement | null;
        if (detachedCornerRow !== null) {
            const syncCount = Math.min(fixedLeftColumnCount, headerRow.children.length, detachedCornerRow.children.length);
            for (let col = 0; col < syncCount; col++) {
                this.syncDetachedCellVisualState(headerRow.children[col] as HTMLElement, detachedCornerRow.children[col] as HTMLElement);
            }
        }
        const detachedHeaderRow = this.detachedColumnHeaderLayer.firstElementChild as HTMLElement | null;
        if (detachedHeaderRow !== null) {
            const availableColumnCount = Math.min(headerRow.children.length - fixedLeftColumnCount, detachedHeaderRow.children.length);
            for (let col = 0; col < availableColumnCount; col++) {
                const detachedChild = detachedHeaderRow.children[col] as HTMLElement | undefined;
                if (detachedChild === undefined) continue;
                this.syncDetachedCellVisualState(
                    headerRow.children[fixedLeftColumnCount + col] as HTMLElement,
                    detachedChild
                );
            }
        }
        const detachedViewportRows = this.detachedRowHeaderLayer.children;
        for (let rowIndex = 0; rowIndex < detachedViewportRows.length; rowIndex++) {
            const detachedRow = detachedViewportRows[rowIndex] as HTMLElement;
            const rowIndexText = detachedRow.dataset.rowIndex;
            if (rowIndexText === undefined) continue;
            const sourceRow = this.getRowElement(Number(rowIndexText) + 1);
            if (sourceRow === null) continue;
            this.syncDetachedRowVisualState(sourceRow, detachedRow);
            const syncCount = Math.min(fixedLeftColumnCount, sourceRow.children.length, detachedRow.children.length);
            for (let col = 0; col < syncCount; col++) {
                this.syncDetachedCellVisualState(sourceRow.children[col] as HTMLElement, detachedRow.children[col] as HTMLElement);
            }
        }
        for (let logicalRowIndex = 1; logicalRowIndex <= this.frozenRowCount; logicalRowIndex++) {
            const sourceRow = this.getRowElement(logicalRowIndex);
            if (sourceRow === null) continue;
            const dataRowIndex = logicalRowIndex - 1;
            const detachedFrozenCornerRow =
                this.detachedFrozenCornerDataLayer.querySelector(`.editor-table-detached-row[data-row-index="${dataRowIndex}"]`) as HTMLElement | null;
            if (detachedFrozenCornerRow !== null) {
                this.syncDetachedRowVisualState(sourceRow, detachedFrozenCornerRow);
                const syncCount = Math.min(fixedLeftColumnCount, sourceRow.children.length, detachedFrozenCornerRow.children.length);
                for (let col = 0; col < syncCount; col++) {
                    this.syncDetachedCellVisualState(sourceRow.children[col] as HTMLElement, detachedFrozenCornerRow.children[col] as HTMLElement);
                }
            }
            const detachedFrozenDataRow =
                this.detachedFrozenRowDataLayer.querySelector(`.editor-table-detached-row[data-row-index="${dataRowIndex}"]`) as HTMLElement | null;
            if (detachedFrozenDataRow !== null) {
                this.syncDetachedRowVisualState(sourceRow, detachedFrozenDataRow);
                const syncCount = Math.min(sourceRow.children.length - fixedLeftColumnCount, detachedFrozenDataRow.children.length);
                for (let col = 0; col < syncCount; col++) {
                    this.syncDetachedCellVisualState(
                        sourceRow.children[fixedLeftColumnCount + col] as HTMLElement,
                        detachedFrozenDataRow.children[col] as HTMLElement
                    );
                }
            }
        }
    }

    syncDetachedHeaderScrollOffset(): void {
        this.syncDetachedHeaderScrollOffsetWithPositions(this.scrollContainer.scrollTop, this.scrollContainer.scrollLeft);
    }

    setInlineTransformIfChanged(element: HTMLElement, transform: string): void {
        if (element.style.transform === transform) return;
        element.style.transform = transform;
    }

    setInlineZIndexIfChanged(element: HTMLElement, zIndex: string): void {
        if (element.style.zIndex === zIndex) return;
        element.style.zIndex = zIndex;
    }

    syncDetachedHeaderScrollOffsetWithPositions(scrollTop: number, scrollLeft: number): void {
        if (this.usesInternalMainViewport) {
            this.topRightViewport.scrollLeft = scrollLeft;
            this.leftBottomViewport.scrollTop = scrollTop;
            return;
        }
        this.virtualScroll.setScrollTopCompensationPx(0);
        this.setInlineTransformIfChanged(this.detachedColumnHeaderLayer, `translateY(${scrollTop}px)`);
        this.setInlineTransformIfChanged(this.detachedRowHeaderLayer, `translateX(${scrollLeft}px)`);
        this.setInlineTransformIfChanged(this.detachedFrozenRowBackgroundLayer, `translateY(${scrollTop}px)`);
        this.setInlineTransformIfChanged(this.detachedCornerLayer, `translate(${scrollLeft}px, ${scrollTop}px)`);
        this.setInlineTransformIfChanged(this.detachedFrozenRowDataLayer, `translateY(${scrollTop}px)`);
        const detachedHeaderRow = this.detachedColumnHeaderLayer.firstElementChild as HTMLElement | null;
        if (detachedHeaderRow !== null && this.frozenColumnCount > 0) {
            const frozenColumnTransform = `translateX(${scrollLeft}px)`;
            const syncCount = Math.min(this.frozenColumnCount, detachedHeaderRow.children.length);
            for (let col = 0; col < syncCount; col++) {
                const headerCell = detachedHeaderRow.children[col] as HTMLElement;
                this.setInlineTransformIfChanged(headerCell, frozenColumnTransform);
            }
        }
        if (this.frozenColumnCount > 0) {
            const detachedFrozenDataRows = this.detachedFrozenRowDataLayer.children;
            const frozenColumnTransform = `translateX(${scrollLeft}px)`;
            for (let rowIndex = 0; rowIndex < detachedFrozenDataRows.length; rowIndex++) {
                const detachedDataRow = detachedFrozenDataRows[rowIndex] as HTMLElement;
                const syncCount = Math.min(this.frozenColumnCount, detachedDataRow.children.length);
                for (let col = 0; col < syncCount; col++) {
                    const cell = detachedDataRow.children[col] as HTMLElement;
                    this.setInlineTransformIfChanged(cell, frozenColumnTransform);
                }
            }
        }
        if (this.frozenRowCount > 0) {
            const detachedRows = this.detachedRowHeaderLayer.children;
            const frozenRowTransform = `translateY(${scrollTop}px)`;
            for (let i = 0; i < detachedRows.length; i++) {
                const detachedRow = detachedRows[i] as HTMLElement;
                const rowIndexText = detachedRow.dataset.rowIndex;
                if (rowIndexText === undefined) continue;
                const logicalRowIndex = Number(rowIndexText) + 1;
                if (logicalRowIndex > this.frozenRowCount) continue;
                this.setInlineTransformIfChanged(detachedRow, frozenRowTransform);
            }
        }
    }

    syncScrollBoundVisuals(): void {
        this.syncScrollBoundVisualsWithPositions(this.scrollContainer.scrollTop, this.scrollContainer.scrollLeft);
    }

    syncScrollBoundVisualsWithPositions(scrollTop: number, scrollLeft: number): void {
        this.syncDetachedHeaderScrollOffsetWithPositions(scrollTop, scrollLeft);
        this.syncFreezeTransforms(scrollTop, scrollLeft);
        this.onScrollForFrozenFillHandle();
        this.emitScrollMetricsChanged();
    }

    refreshDetachedHeaderLayout(): void {
        this.refreshDetachedHeaderLayers();
        this.syncScrollBoundVisuals();
    }

    syncDetachedVisualState(): void {
        if (this.usesInternalMainViewport) {
            this.syncQuadrantStaticCellStates();
            return;
        }
        this.syncDetachedLegacyStaticCellStates();
        this.syncDetachedViewportRowHeaderStates();
        this.syncScrollBoundVisuals();
    }

    setDetachedHeaderTopOffset(offsetPx: number): void {
        this.detachedHeaderTopOffset = offsetPx;
        this.refreshDetachedHeaderLayout();
    }

    refreshFreezeVisualState(): void {
        // 固定数変更や構造変更では、既存DOMに残った古い固定クラスを一度すべて落とす。
        this.syncFreezeStateCssClasses();
        this.clearAllFreezeStyles();
        this.applyFreezeVisualStateToRenderedRows();
        this.refreshDetachedHeaderLayout();
    }

    syncFreezeStateCssClasses(): void {
        this.element.classList.toggle('editor-table--has-frozen-columns', this.frozenColumnCount > 0);
        this.element.classList.toggle('editor-table--has-frozen-rows', this.frozenRowCount > 0);
    }

    getQuadrantViewportRowTopPx(logicalRowIndex: number): number {
        const rowHeight = this.getDataRowHeightPx();
        if (logicalRowIndex <= this.frozenRowCount) {
            return this.getHeaderRowHeightPx() + ((logicalRowIndex - 1) * rowHeight);
        }
        return (logicalRowIndex - 1 - this.frozenRowCount) * rowHeight;
    }

    applyFreezeVisualStateToRenderedRows(): void {
        // 仮想スクロール時は差し替えられた行だけが新規DOMになるため、ここでは add-only で十分。
        // 全掃除を入れると可視行・可視セルすべてに class remove が走り、スクロールコストが跳ね上がる。
        const renderedRows = this.getRenderedRowElements();
        const dataColumnOffset = this.dataColumnOffset();
        for (const rowElement of renderedRows) {
            const logicalRowIndex = this.getLogicalRowIndexFromElement(rowElement);
            const isHeaderRow = logicalRowIndex === 0;
            const isFrozenRow = logicalRowIndex !== null && logicalRowIndex > 0 && logicalRowIndex <= this.frozenRowCount;
            if (isFrozenRow) {
                rowElement.classList.add('freeze-row');
                if (logicalRowIndex === this.frozenRowCount) rowElement.classList.add('freeze-row-border');
                const cellCount = rowElement.children.length;
                for (let col = dataColumnOffset; col < cellCount; col++) {
                    rowElement.children[col].classList.add('freeze-cell');
                }
            }
            if (this.frozenColumnCount === 0) continue;
            for (let dataColIndex = 0; dataColIndex < this.frozenColumnCount; dataColIndex++) {
                const cell = rowElement.children[dataColIndex + dataColumnOffset] as HTMLElement | null;
                if (cell === null) continue;
                if (dataColIndex === this.frozenColumnCount - 1) cell.classList.add('freeze-column-border');
                if (!isHeaderRow) cell.classList.add('freeze-cell');
            }
        }
    }

    syncFreezeTransforms(scrollTop: number, scrollLeft: number): void {
        if (this.usesInternalMainViewport) return;
        if (this.frozenRowCount === 0 && this.frozenColumnCount === 0) return;
        const renderedRows = this.getRenderedRowElements();
        const dataColumnOffset = this.dataColumnOffset();
        const rowHeight = this.getDataRowHeightPx();
        const frozenColumnTransform = `translate(${scrollLeft}px, 0px)`;
        for (const rowElement of renderedRows) {
            const logicalRowIndex = this.getLogicalRowIndexFromElement(rowElement);
            const isFrozenRow = logicalRowIndex !== null && logicalRowIndex > 0 && logicalRowIndex <= this.frozenRowCount;
            const frozenRowTranslateY = isFrozenRow
                ? scrollTop + this.getHeaderRowHeightPx() + ((logicalRowIndex - 1) * rowHeight) - rowElement.offsetTop
                : 0;
            const cellCount = rowElement.children.length;
            if (isFrozenRow) {
                const frozenRowOnlyTransform = `translate(0px, ${frozenRowTranslateY}px)`;
                const frozenCornerTransform = `translate(${scrollLeft}px, ${frozenRowTranslateY}px)`;
                for (let col = 0; col < cellCount; col++) {
                    const cell = rowElement.children[col] as HTMLElement;
                    const dataColIndex = col - dataColumnOffset;
                    const isFrozenColumn = dataColIndex >= 0 && dataColIndex < this.frozenColumnCount;
                    this.setInlineTransformIfChanged(cell, isFrozenColumn ? frozenCornerTransform : frozenRowOnlyTransform);
                    this.setInlineZIndexIfChanged(cell, isFrozenColumn ? 'var(--z-index-freeze-corner)' : 'var(--z-index-freeze-row)');
                }
                continue;
            }
            if (this.frozenColumnCount === 0) continue;
            const frozenColumnEnd = Math.min(cellCount, dataColumnOffset + this.frozenColumnCount);
            for (let col = dataColumnOffset; col < frozenColumnEnd; col++) {
                const cell = rowElement.children[col] as HTMLElement;
                this.setInlineTransformIfChanged(cell, frozenColumnTransform);
                this.setInlineZIndexIfChanged(cell, 'var(--z-index-freeze-column)');
            }
        }
    }

    /**
     * DOM列インデックス（0始まり）をストア（CSV）列インデックスに変換して返す。
     * 対応するCSV列が存在しない場合、または範囲外の場合は -1 を返す。
     * ColumnSorter・ColumnFilter・FilterDropdown などが columnMapping に直接触れないようにするファサード。
     */

}
