import {EditorTable} from "./editor-table";
import {Selection} from "./selection";
import {ScrollViewportController} from "./scroll-viewport-controller";
import {clamp} from "../core/helper";

interface SelectionViewportRect {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

export class SelectionDragController {
    private tableElement: HTMLElement;
    private selection: Selection;
    private scrollBinding: ScrollViewportController;
    private mousemoveHandler: (e: MouseEvent) => void;
    private mouseupHandler: () => void;
    private activated = false;
    private autoScrollActive = false;
    private autoScrollFrameId = 0;
    private lastMouseX = 0;
    private lastMouseY = 0;

    constructor(
        tableElement: HTMLElement,
        selection: Selection,
        scrollBinding: ScrollViewportController
    ) {
        this.tableElement = tableElement;
        this.selection = selection;
        this.scrollBinding = scrollBinding;

        this.mousemoveHandler = (e: MouseEvent) => {
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
            const isActive = selection.isSelectingColumn() || selection.isSelectingRow() || selection.isSelecting();
            if (isActive) {
                // 選択クラス更新後の再計測を避け、同じイベント内では表示領域の測定を共有する。
                const viewport = this.getSelectionViewportRect();
                this.updateSelectionFromPoint(e.clientX, e.clientY, viewport);
                const delta = this.getAutoScrollDelta(e.clientX, e.clientY, viewport);
                if (delta.x !== 0 || delta.y !== 0) {
                    this.startAutoScroll();
                } else {
                    this.stopAutoScroll();
                }
            } else {
                this.stopAutoScroll();
            }
        };

        this.mouseupHandler = () => {
            this.selection.end();
            this.stopAutoScroll();
        };
    }

    activate(): void {
        if (this.activated) return;
        this.activated = true;
        window.addEventListener('mousemove', this.mousemoveHandler);
        window.addEventListener('mouseup', this.mouseupHandler);
    }

    deactivate(): void {
        if (!this.activated) return;
        this.activated = false;
        window.removeEventListener('mousemove', this.mousemoveHandler);
        window.removeEventListener('mouseup', this.mouseupHandler);
        this.stopAutoScroll();
    }

    stopAutoScrollForInput(): void {
        this.stopAutoScroll();
    }

    private updateSelectionFromPoint(clientX: number, clientY: number, viewport: SelectionViewportRect): void {
        if (viewport.right <= viewport.left || viewport.bottom <= viewport.top) return;

        const clampedX = clamp(clientX, viewport.left, viewport.right - 1);
        const clampedY = clamp(clientY, viewport.top, viewport.bottom - 1);
        const elements = document.elementsFromPoint(clampedX, clampedY);
        for (const element of elements) {
            if (!(element instanceof HTMLElement)) continue;
            if (!element.classList.contains('editor-table-cell')) continue;
            const position = EditorTable.getCellPosition(element, this.tableElement);
            if (!position) return;
            if (this.selection.isSelectingColumn()) {
                this.selection.updateColumn(position.column);
            } else if (this.selection.isSelectingRow()) {
                this.selection.updateRow(position.row);
            } else if (this.selection.isSelecting()) {
                this.selection.extendSelection(position.row, position.column);
            }
            return;
        }
    }

    private startAutoScroll(): void {
        if (this.autoScrollActive) return;
        this.autoScrollActive = true;
        this.autoScrollFrameId = window.requestAnimationFrame(() => {
            this.handleAutoScrollFrame();
        });
    }

    private handleAutoScrollFrame(): void {
        if (!this.autoScrollActive) return;
        if (!this.selection.isSelectingColumn() && !this.selection.isSelectingRow() && !this.selection.isSelecting()) {
            this.stopAutoScroll();
            return;
        }
        const delta = this.getAutoScrollDelta(this.lastMouseX, this.lastMouseY, this.getSelectionViewportRect());
        if (delta.x === 0 && delta.y === 0) {
            this.stopAutoScroll();
            return;
        }
        const scrollTop = this.scrollBinding.getScrollTop();
        const scrollLeft = this.scrollBinding.getScrollLeft();
        this.scrollBinding.setScrollPosition(scrollTop + delta.y, scrollLeft + delta.x);
        // スクロールで行と表示領域が変わるため、スクロール後の座標を読み直す。
        this.updateSelectionFromPoint(this.lastMouseX, this.lastMouseY, this.getSelectionViewportRect());
        this.autoScrollFrameId = window.requestAnimationFrame(() => {
            this.handleAutoScrollFrame();
        });
    }

    private stopAutoScroll(): void {
        if (!this.autoScrollActive) return;
        this.autoScrollActive = false;
        if (this.autoScrollFrameId !== 0) {
            window.cancelAnimationFrame(this.autoScrollFrameId);
            this.autoScrollFrameId = 0;
        }
    }

    private getAutoScrollDelta(clientX: number, clientY: number, viewport: SelectionViewportRect): { x: number; y: number } {
        if (viewport.right <= viewport.left || viewport.bottom <= viewport.top) {
            return { x: 0, y: 0 };
        }

        let deltaX = 0;
        let deltaY = 0;

        if (clientX < viewport.left) {
            deltaX = -this.getAutoScrollSpeed(viewport.left - clientX);
        } else if (clientX > viewport.right) {
            deltaX = this.getAutoScrollSpeed(clientX - viewport.right);
        }

        if (clientY < viewport.top) {
            deltaY = -this.getAutoScrollSpeed(viewport.top - clientY);
        } else if (clientY > viewport.bottom) {
            deltaY = this.getAutoScrollSpeed(clientY - viewport.bottom);
        }

        return { x: deltaX, y: deltaY };
    }

    private getAutoScrollSpeed(distance: number): number {
        const maxSpeed = 24;
        const minSpeed = 6;
        const scaled = Math.ceil(distance / 8);
        return Math.min(maxSpeed, Math.max(minSpeed, scaled));
    }

    private getSelectionViewportRect(): SelectionViewportRect {
        const containerRect = this.scrollBinding.getBoundingClientRect();
        const { scrollbarWidth, scrollbarHeight } = this.scrollBinding.getScrollbarSize();
        // 全列が固定されたときも、本文内の非表示sourceヘッダーを境界判定に使わない。
        const rightHeader = this.tableElement.querySelector<HTMLElement>('.editor-table-pane-frozen-right-top .editor-table-column-header');
        const columnHeader = rightHeader ?? this.tableElement.querySelector<HTMLElement>(
            '.editor-table-pane-top-left .editor-table-column-header, .editor-table-pane-top-right .editor-table-column-header, .editor-table-detached-column-header-layer .editor-table-column-header, .editor-table-grid .editor-table-column-header'
        );
        const rowHeader = this.tableElement.querySelector<HTMLElement>(
            '.editor-table-pane-top-left .editor-table-row-header, .editor-table-pane-bottom-left .editor-table-row-header, .editor-table-detached-row-header-layer .editor-table-row-header, .editor-table-grid .editor-table-row-header'
        );
        const top = columnHeader !== null ? columnHeader.getBoundingClientRect().bottom : containerRect.top;
        const left = rowHeader !== null ? rowHeader.getBoundingClientRect().right : containerRect.left;

        const rightPane = this.tableElement.querySelector<HTMLElement>('.editor-table-pane-frozen-right-bottom');
        const right = rightPane !== null && rightPane.clientWidth > 0 ? rightPane.getBoundingClientRect().right : containerRect.right - scrollbarWidth;
        return {
            top,
            bottom: containerRect.bottom - scrollbarHeight,
            left,
            right
        };
    }

}
