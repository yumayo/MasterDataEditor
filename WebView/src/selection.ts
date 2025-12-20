export interface CellPosition {
    row: number;
    column: number;
}

export class Selection {

    element: HTMLElement;

    private backgroundElement1: HTMLElement;
    private backgroundElement2: HTMLElement;

    row: number;

    column: number;

    private anchor: CellPosition;

    private focus: CellPosition;

    private selecting: boolean;

    private tableElement: HTMLElement;

    constructor(tableElement: HTMLElement) {
        this.row = 0;
        this.column = 0;
        this.anchor = { row: 0, column: 0 };
        this.focus = { row: 0, column: 0 };
        this.selecting = false;
        this.tableElement = tableElement;

        const element = document.createElement('div');
        element.classList.add('selection');
        this.element = element;

        const backgroundElement1 = document.createElement('div');
        backgroundElement1.classList.add('selection-background');
        this.backgroundElement1 = backgroundElement1;
        this.element.appendChild(backgroundElement1);

        const backgroundElement2 = document.createElement('div');
        backgroundElement2.classList.add('selection-background');
        this.backgroundElement2 = backgroundElement2;
        this.element.appendChild(backgroundElement2);
    }

    move(row: number, column: number): void {
        this.row = row;
        this.column = column;
        this.anchor = { row, column };
        this.focus = { row, column };
        this.updateRenderer();
    }

    start(row: number, column: number): void {
        this.selecting = true;
        this.row = row;
        this.column = column;
        this.anchor = { row, column };
        this.focus = { row, column };
        this.updateRenderer();
    }

    update(row: number, column: number): void {
        if (!this.selecting) return;

        this.focus = { row, column };
        this.updateRenderer();
    }

    end(): void {
        this.selecting = false;
    }

    isSelecting(): boolean {
        return this.selecting;
    }

    isSingleCell(): boolean {
        return this.anchor.row === this.focus.row && this.anchor.column === this.focus.column;
    }

    getAnchor(): CellPosition {
        return this.anchor;
    }

    getFocus(): CellPosition {
        return this.focus;
    }

    private updateRenderer(): void {
        const startRow = Math.min(this.anchor.row, this.focus.row);
        const startColumn = Math.min(this.anchor.column, this.focus.column);
        const endRow = Math.max(this.anchor.row, this.focus.row);
        const endColumn = Math.max(this.anchor.column, this.focus.column);

        const tableRect = this.tableElement.getBoundingClientRect();

        const startCell = this.tableElement.children[startRow]?.children[startColumn] as HTMLElement | undefined;
        const endCell = this.tableElement.children[endRow]?.children[endColumn] as HTMLElement | undefined;
        const anchorCell = this.tableElement.children[this.anchor.row]?.children[this.anchor.column] as HTMLElement | undefined;

        if (!startCell || !endCell || !anchorCell) {
            this.hideRenderer();
            return;
        }

        const startRect = startCell.getBoundingClientRect();
        const endRect = endCell.getBoundingClientRect();
        const anchorRect = anchorCell.getBoundingClientRect();

        const left = Math.round(startRect.left - tableRect.left - 1);
        const top = Math.round(startRect.top - tableRect.top - 1);
        const width = Math.round(endRect.right - startRect.left - 1);
        const height = Math.round(endRect.bottom - startRect.top - 1);

        this.element.style.left = left + 'px';
        this.element.style.top = top + 'px';
        this.element.style.width = width + 'px';
        this.element.style.height = height + 'px';

        // 背景要素の位置を設定（アンカーセルを除く）
        this.updateBackgroundElements(startRect, endRect, anchorRect);
    }

    private updateBackgroundElements(startRect: DOMRect, endRect: DOMRect, anchorRect: DOMRect): void {
        // アンカーが左上の場合:
        //   bg1: アンカーの下から範囲の最下部まで（アンカーと同じ列幅）
        //   bg2: アンカーの右隣から範囲の右下まで
        // アンカーが右上の場合:
        //   bg1: アンカーの下から範囲の最下部まで（アンカーと同じ列幅）
        //   bg2: 範囲の左端からアンカーの左隣まで
        // アンカーが左下の場合:
        //   bg1: アンカーの上から範囲の最上部まで（アンカーと同じ列幅）
        //   bg2: アンカーの右隣から範囲の右下まで
        // アンカーが右下の場合:
        //   bg1: アンカーの上から範囲の最上部まで（アンカーと同じ列幅）
        //   bg2: 範囲の左端からアンカーの左隣まで

        // アンカーの位置判定はセル座標で行う（浮動小数点誤差を避ける）
        const isAnchorTop = this.anchor.row <= this.focus.row;
        const isAnchorLeft = this.anchor.column <= this.focus.column;

        // 座標計算は最後にまとめて整数化する
        const anchorLeftPx = Math.floor(anchorRect.left - startRect.left);
        const anchorTopPx = Math.floor(anchorRect.top - startRect.top);
        const anchorWidth = Math.ceil(anchorRect.width);
        const anchorHeight = Math.ceil(anchorRect.height);
        const totalWidth = Math.ceil(endRect.right - startRect.left);
        const totalHeight = Math.ceil(endRect.bottom - startRect.top);

        // 単一セルの場合は背景を非表示
        if (this.isSingleCell()) {
            this.backgroundElement1.style.display = 'none';
            this.backgroundElement2.style.display = 'none';
            return;
        }

        this.backgroundElement1.style.display = 'block';
        this.backgroundElement2.style.display = 'block';

        if (isAnchorTop && isAnchorLeft) {
            // アンカーが左上
            // bg1: アンカーの下から最下部まで（アンカー列）
            this.backgroundElement1.style.left = '0px';
            this.backgroundElement1.style.top = anchorHeight + 'px';
            this.backgroundElement1.style.width = anchorWidth + 'px';
            this.backgroundElement1.style.height = (totalHeight - anchorHeight) + 'px';
            // bg2: アンカーの右隣から右下まで
            this.backgroundElement2.style.left = anchorWidth + 'px';
            this.backgroundElement2.style.top = '0px';
            this.backgroundElement2.style.width = (totalWidth - anchorWidth) + 'px';
            this.backgroundElement2.style.height = totalHeight + 'px';
        } else if (isAnchorTop && !isAnchorLeft) {
            // アンカーが右上
            // bg1: アンカーの下から最下部まで（アンカー列）
            this.backgroundElement1.style.left = anchorLeftPx + 'px';
            this.backgroundElement1.style.top = anchorHeight + 'px';
            this.backgroundElement1.style.width = anchorWidth + 'px';
            this.backgroundElement1.style.height = (totalHeight - anchorHeight) + 'px';
            // bg2: 左端からアンカーの左隣まで
            this.backgroundElement2.style.left = '0px';
            this.backgroundElement2.style.top = '0px';
            this.backgroundElement2.style.width = anchorLeftPx + 'px';
            this.backgroundElement2.style.height = totalHeight + 'px';
        } else if (!isAnchorTop && isAnchorLeft) {
            // アンカーが左下
            // bg1: 最上部からアンカーの上まで（アンカー列）
            this.backgroundElement1.style.left = '0px';
            this.backgroundElement1.style.top = '0px';
            this.backgroundElement1.style.width = anchorWidth + 'px';
            this.backgroundElement1.style.height = anchorTopPx + 'px';
            // bg2: アンカーの右隣から右下まで
            this.backgroundElement2.style.left = anchorWidth + 'px';
            this.backgroundElement2.style.top = '0px';
            this.backgroundElement2.style.width = (totalWidth - anchorWidth) + 'px';
            this.backgroundElement2.style.height = totalHeight + 'px';
        } else {
            // アンカーが右下
            // bg1: 最上部からアンカーの上まで（アンカー列）
            this.backgroundElement1.style.left = anchorLeftPx + 'px';
            this.backgroundElement1.style.top = '0px';
            this.backgroundElement1.style.width = anchorWidth + 'px';
            this.backgroundElement1.style.height = anchorTopPx + 'px';
            // bg2: 左端からアンカーの左隣まで
            this.backgroundElement2.style.left = '0px';
            this.backgroundElement2.style.top = '0px';
            this.backgroundElement2.style.width = anchorLeftPx + 'px';
            this.backgroundElement2.style.height = totalHeight + 'px';
        }
    }

    private hideRenderer(): void {
        this.element.style.left = '-99999px';
        this.element.style.top = '-99999px';
        this.element.style.width = '0px';
        this.element.style.height = '0px';
        this.element.classList.remove('selection-active');
    }
}
