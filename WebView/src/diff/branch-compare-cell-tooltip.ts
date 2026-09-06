import {EditorTable} from '../editor/editor-table';
import type {NotificationToast} from '../ui/notification';
import type {BranchCompareChanges, DiffChangedCell} from './branch-compare-changes';

/** 変更セルの履歴を、文字選択してコピーできるホバーとして表示する。 */
export class BranchCompareCellTooltip {
    private static nextId = 1;
    private readonly element: HTMLDivElement;
    private readonly events = new AbortController();
    private hideTimerId = 0;
    private activeCell: {element: HTMLElement; cell: DiffChangedCell; table: EditorTable; below: boolean; scrollTop: number; scrollLeft: number; anchorTop: number; anchorLeft: number} | false = false;

    constructor(parent: HTMLElement, changes: BranchCompareChanges, panes: readonly {side: 'left' | 'right'; element: HTMLElement; table: EditorTable}[], notification: NotificationToast) {
        this.element = document.createElement('div');
        this.element.classList.add('branch-compare-cell-tooltip');
        this.element.id = 'branch-compare-cell-tooltip-' + BranchCompareCellTooltip.nextId++;
        this.element.setAttribute('role', 'tooltip');
        this.element.tabIndex = -1;
        this.element.hidden = true;
        parent.appendChild(this.element);

        const signal = this.events.signal;
        const changedCells = new Map(changes.cells.map(cell => [`${cell.row}:${cell.column}`, cell]));
        let titles: ReadonlyMap<string, string> = new Map();
        for (const {side, element: pane, table} of panes) {
            // ペインで受け、仮想スクロールや固定列でセルが再生成されても対応する。
            pane.addEventListener('mouseover', (event: MouseEvent) => {
                if (!(event.target instanceof Element)) return;
                const element = event.target.closest<HTMLElement>('.editor-table-cell');
                if (element === null) return;
                const position = EditorTable.getCellPosition(element, table.getTableElement());
                if (position === null) return;
                const key = `${position.row}:${position.column}`;
                const cell = changedCells.get(key);
                if (!cell || (cell.status !== 'M' && cell.side !== side)) return;
                this.cancelHide();
                if (this.activeCell !== false && this.activeCell.element === element) return;
                this.hide();
                const rect = element.getBoundingClientRect();
                const below = window.innerHeight - rect.bottom - 14 >= Math.min(360, rect.top - 14);
                this.activeCell = {element, cell, table, below, scrollTop: table.getScrollTop(), scrollLeft: table.getScrollLeft(), anchorTop: rect.top, anchorLeft: rect.left};
                const descriptions = element.getAttribute('aria-describedby');
                element.setAttribute('aria-describedby', descriptions ? descriptions + ' ' + this.element.id : this.element.id);
                this.render(titles.get(key) ?? `${cell.row}L:${cell.columnName}\n変更者を取得中…`);
            }, {signal});
            pane.addEventListener('mouseout', (event: MouseEvent) => {
                const current = this.activeCell;
                if (current === false || !(event.target instanceof Node) || !current.element.contains(event.target)) return;
                // boolのSVGなど、同じセルの子要素間の移動は離脱として扱わない。
                if (event.relatedTarget instanceof Node && (current.element.contains(event.relatedTarget) || this.element.contains(event.relatedTarget))) return;
                this.scheduleHide();
            }, {signal});
        }

        this.element.addEventListener('mouseenter', () => { this.cancelHide(); }, {signal});
        this.element.addEventListener('mouseleave', (event: MouseEvent) => {
            if (this.activeCell !== false && event.relatedTarget instanceof Node && this.activeCell.element.contains(event.relatedTarget)) return;
            this.scheduleHide();
        }, {signal});
        this.element.addEventListener('mousedown', () => {
            // グリッドの入力欄からフォーカスを移し、ブラウザ本来の文字選択・コピーを使う。
            // preventDefaultすると文字選択できなくなるので、イベントはそのまま通す。
            this.element.focus({preventScroll: true});
        }, {signal});
        this.element.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            const current = this.activeCell;
            this.hide();
            if (current !== false) current.table.focusTable();
            event.stopPropagation();
        }, {signal});
        parent.ownerDocument.addEventListener('scroll', (event: Event) => {
            // ホバー内の長文スクロールでは閉じない。フォーカス復元も同じ位置のscroll通知を送るため、実際の移動を確認する。
            if (event.target instanceof Node && this.element.contains(event.target)) return;
            const current = this.activeCell;
            if (current === false) return;
            const rect = current.element.getBoundingClientRect();
            if (!current.element.isConnected || current.table.getScrollTop() !== current.scrollTop || current.table.getScrollLeft() !== current.scrollLeft
                || rect.top !== current.anchorTop || rect.left !== current.anchorLeft) this.hide();
        }, {capture: true, signal});
        window.addEventListener('resize', () => { this.hide(); }, {signal});
        window.addEventListener('blur', () => { this.hide(); }, {signal});

        changes.loadCellTitlesAsync().then(loadedTitles => {
            if (signal.aborted) return;
            titles = loadedTitles;
            const current = this.activeCell;
            if (current === false) return;
            const position = EditorTable.getCellPosition(current.element, current.table.getTableElement());
            if (!current.element.isConnected || position?.row !== current.cell.row || position.column !== current.cell.column) {
                this.hide();
                return;
            }
            const title = titles.get(`${current.cell.row}:${current.cell.column}`);
            if (title) this.render(title);
        }).catch((error: unknown) => {
            if (!signal.aborted) notification.showError(error);
        });
    }

    hide(): void {
        this.cancelHide();
        if (this.activeCell !== false) {
            const element = this.activeCell.element;
            const descriptions = (element.getAttribute('aria-describedby') ?? '').split(' ').filter(id => id !== this.element.id).join(' ');
            if (descriptions) element.setAttribute('aria-describedby', descriptions);
            else element.removeAttribute('aria-describedby');
        }
        this.activeCell = false;
        this.element.hidden = true;
        this.element.textContent = '';
    }

    destroy(): void {
        this.events.abort();
        this.hide();
        this.element.remove();
    }

    private render(text: string): void {
        if (this.activeCell === false) return;
        const rect = this.activeCell.element.getBoundingClientRect();
        const availableHeight = this.activeCell.below ? window.innerHeight - rect.bottom - 14 : rect.top - 14;
        this.element.style.maxHeight = Math.max(0, Math.min(360, availableHeight)) + 'px';
        this.element.textContent = text;
        this.element.hidden = false;
        const popup = this.element.getBoundingClientRect();
        this.element.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - popup.width - 8)) + 'px';
        // 表示開始時に選んだ方向で伸ばし、履歴到着時もポインタの下に表示を保つ。
        this.element.style.top = (this.activeCell.below ? rect.bottom + 6 : rect.top - popup.height - 6) + 'px';
    }

    private scheduleHide(): void {
        this.cancelHide();
        // セルとホバーの間の余白をマウスが通過できる猶予を設ける。
        this.hideTimerId = window.setTimeout(() => { this.hide(); }, 250);
    }

    private cancelHide(): void {
        window.clearTimeout(this.hideTimerId);
        this.hideTimerId = 0;
    }
}
