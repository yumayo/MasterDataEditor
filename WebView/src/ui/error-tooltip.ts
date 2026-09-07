import type {EditorTable} from '../editor/editor-table';
import type {ValidationPanel} from '../panels/validation-panel';
import {CellTooltip} from './cell-tooltip';

/** 全 EditorTable で共有し、バリデーションエラーを選択・コピーできる形で表示する。 */
export class ErrorTooltip {
    private readonly tooltip = new CellTooltip(document.body, 'error-tooltip');

    constructor(private readonly validationPanel: ValidationPanel) {}

    showAfterDelay(cell: HTMLElement, table: EditorTable, tableName: string, storeRowIndex: number, storeColumnIndex: number): void {
        this.tooltip.showAfterDelay(cell, table, () => this.validationPanel
            .getErrorsForCell(tableName, storeRowIndex, storeColumnIndex).map(error => error.message).join('\n'));
    }

    leaveCell(cell: HTMLElement, relatedTarget: EventTarget | null): void {
        this.tooltip.leaveCell(cell, relatedTarget);
    }

    hide(): void {
        this.tooltip.hide();
    }
}
