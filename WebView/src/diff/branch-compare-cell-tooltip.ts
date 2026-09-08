import {EditorTable} from '../editor/editor-table';
import {CellTooltip} from '../ui/cell-tooltip';
import type {NotificationToast} from '../ui/notification';
import type {BranchCompareChanges} from './branch-compare-changes';

/** 変更セルの履歴を、文字選択してコピーできるホバーとして表示する。 */
export class BranchCompareCellTooltip {
    private readonly tooltip: CellTooltip;
    private readonly events = new AbortController();

    constructor(parent: HTMLElement, changes: BranchCompareChanges, panes: readonly {side: 'left' | 'right'; element: HTMLElement; table: EditorTable}[], notification: NotificationToast) {
        this.tooltip = new CellTooltip(parent, 'branch-compare-cell-tooltip');
        const signal = this.events.signal;
        const changedCells = new Map(changes.cells.map(cell => [`${cell.row}:${cell.column}`, cell]));
        let titles: ReadonlyMap<string, string> = new Map();
        for (const {side, element: pane, table} of panes) {
            // ペインで受け、仮想スクロールや固定列でセルが再生成されても対応する。
            // 表示待ちの間は、セル内を移動したマウスの位置も反映する。
            pane.addEventListener('mousemove', (event: MouseEvent) => {
                if (!(event.target instanceof Element)) return;
                const element = event.target.closest<HTMLElement>('.editor-table-cell');
                if (element === null) return;
                const position = EditorTable.getCellPosition(element, table.getTableElement());
                if (position === null) return;
                const key = `${position.row}:${position.column}`;
                const cell = changedCells.get(key);
                if (!cell || (cell.status !== 'M' && cell.side !== side)) return;
                this.tooltip.showAfterDelay(element, table, () => {
                    const current = EditorTable.getCellPosition(element, table.getTableElement());
                    if (current?.row !== cell.row || current.column !== cell.column) return '';
                    return titles.get(key) ?? `${cell.row}L:${cell.columnName}\n変更者を取得中…`;
                }, {x: event.clientX, y: event.clientY});
            }, {signal});
            pane.addEventListener('mouseout', (event: MouseEvent) => {
                if (!(event.target instanceof Element)) return;
                const element = event.target.closest<HTMLElement>('.editor-table-cell');
                if (element !== null) this.tooltip.leaveCell(element, event.relatedTarget);
            }, {signal});
        }

        changes.loadCellTitlesAsync().then(loadedTitles => {
            if (signal.aborted) return;
            titles = loadedTitles;
            this.tooltip.refresh();
        }).catch((error: unknown) => {
            if (!signal.aborted) notification.showError(error);
        });
    }

    hide(): void {
        this.tooltip.hide();
    }

    destroy(): void {
        this.events.abort();
        this.tooltip.destroy();
    }
}
