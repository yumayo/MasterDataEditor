import type {Editor} from '../editor/editor';
import type {GitBranchCompareFile} from '../app/api';
import type {DiffBuildResult} from '../diff/diff-build-result';
import type {UiStoredBranchCompareListTab, UiScrollPosition} from '../app/ui-state';
import './branch-compare-list-tab.css';

export interface BranchCompareListSection {
    file: GitBranchCompareFile;
    diff: DiffBuildResult;
}

/** 読み取り専用の差分一覧。各テーブルは自然な高さで並べ、縦スクロールを共有する。 */
export class BranchCompareListTab {
    private readonly wrapper: HTMLElement;
    private readonly scroller: HTMLElement;
    private savedScroll: UiScrollPosition = {scrollTop: 0, scrollLeft: 0};
    private uiStateChangeListener: (() => void) | false = false;

    constructor(editor: Editor, metadata: UiStoredBranchCompareListTab, sections: BranchCompareListSection[]) {
        this.wrapper = document.createElement('div');
        this.wrapper.classList.add('branch-compare-list-tab');
        this.wrapper.style.display = 'none';
        const summary = document.createElement('div');
        summary.classList.add('branch-compare-list-summary');
        const title = document.createElement('strong');
        title.textContent = '差分一覧 · ' + sections.length + ' テーブル';
        const revisions = document.createElement('div');
        revisions.textContent = metadata.leftLabel + ' (' + metadata.leftCommit.slice(0, 7) + ') ↔ ' + metadata.rightLabel + ' (' + metadata.rightCommit.slice(0, 7) + ')';
        const note = document.createElement('div');
        note.classList.add('branch-compare-list-note');
        note.textContent = '読み取り専用 · 変更箇所の前後5行を表示';
        summary.append(title, revisions, note);
        if (metadata.exportFilter) {
            const filter = document.createElement('div');
            filter.classList.add('branch-compare-list-note');
            filter.textContent = '出力時刻: ' + metadata.exportFilter.leftDateTime.replace('T', ' ') + ' ↔ ' + metadata.exportFilter.rightDateTime.replace('T', ' ');
            summary.appendChild(filter);
        }
        this.scroller = document.createElement('div');
        this.scroller.classList.add('branch-compare-list-scroll');
        this.scroller.tabIndex = 0;
        this.scroller.setAttribute('role', 'region');
        this.scroller.setAttribute('aria-label', '全テーブルの差分一覧');
        this.scroller.addEventListener('scroll', () => {
            if (this.wrapper.style.display === 'none') return;
            this.savedScroll = {scrollTop: this.scroller.scrollTop, scrollLeft: this.scroller.scrollLeft};
            if (this.uiStateChangeListener !== false) this.uiStateChangeListener();
        });
        for (const {file, diff} of sections) {
            const leftRows = diff.leftRows;
            const rightRows = diff.rightRows;
            const leftIndices = diff.leftOriginalRowIndices;
            const rightIndices = diff.rightOriginalRowIndices;
            const gaps = diff.omittedRows;
            if (!leftRows || !rightRows || !leftIndices || !rightIndices || !gaps) throw new Error('一覧用の差分データがありません: ' + file.path);
            const section = document.createElement('section');
            section.classList.add('branch-compare-list-section');
            section.dataset.path = file.path;
            section.dataset.status = file.status;
            const heading = document.createElement('h2');
            const status = document.createElement('span');
            status.classList.add('branch-compare-list-status');
            status.textContent = file.status + ' ' + ({M: '変更', A: '追加', D: '削除'}[file.status]);
            heading.append(status, document.createTextNode(file.tableName));
            const path = document.createElement('div');
            path.classList.add('branch-compare-list-path');
            path.textContent = file.path;
            section.append(heading, path);
            const table = document.createElement('table');
            table.setAttribute('aria-label', file.tableName + ' の差分');
            table.style.minWidth = Math.max(680, diff.displayHeader.length * 180 + 88) + 'px';
            const head = table.createTHead();
            const labels = head.insertRow();
            for (const [side, label] of [['left', metadata.leftLabel], ['right', metadata.rightLabel]]) {
                const cell = document.createElement('th');
                cell.colSpan = diff.displayHeader.length + 1;
                cell.scope = 'colgroup';
                cell.classList.add('branch-compare-list-' + side);
                cell.textContent = (side === 'left' ? '比較元: ' : '比較先: ') + label;
                labels.appendChild(cell);
            }
            const columns = head.insertRow();
            for (const side of ['left', 'right']) {
                for (const [index, name] of ['行', ...diff.displayHeader].entries()) {
                    const cell = document.createElement('th');
                    cell.scope = 'col';
                    cell.textContent = name;
                    if (index === 0) cell.classList.add('branch-compare-list-line', 'branch-compare-list-' + side);
                    columns.appendChild(cell);
                }
            }
            const body = table.createTBody();
            const omitted = new Map(gaps.map(gap => [gap.beforeRow, gap.count]));
            const leftModified = new Set(diff.leftModifiedCells.map(cell => cell.row + ':' + cell.col));
            const rightModified = new Set(diff.rightModifiedCells.map(cell => cell.row + ':' + cell.col));
            const addedRows = new Set(diff.rightAddedRowIndices);
            const deletedRows = new Set(diff.leftDeletedRowIndices);
            for (let rowIndex = 0; rowIndex <= leftRows.length; rowIndex++) {
                const count = omitted.get(rowIndex);
                if (typeof count === 'number') {
                    const row = body.insertRow();
                    row.classList.add('branch-compare-list-gap');
                    const cell = row.insertCell();
                    cell.colSpan = (diff.displayHeader.length + 1) * 2;
                    cell.textContent = count + ' 行を省略';
                }
                if (rowIndex === leftRows.length) continue;
                const row = body.insertRow();
                for (const side of ['left', 'right']) {
                    const originalIndex = (side === 'left' ? leftIndices : rightIndices)[rowIndex];
                    const values = (side === 'left' ? leftRows : rightRows)[rowIndex];
                    const wholeRowChanged = side === 'left' ? deletedRows.has(rowIndex) : addedRows.has(rowIndex);
                    const modified = side === 'left' ? leftModified : rightModified;
                    for (let col = -1; col < diff.displayHeader.length; col++) {
                        const cell = row.insertCell();
                        cell.textContent = originalIndex < 0 ? '' : col < 0 ? String(originalIndex + 1) : values[col];
                        if (col < 0) cell.classList.add('branch-compare-list-line', 'branch-compare-list-' + side);
                        if (originalIndex < 0) cell.classList.add('branch-compare-list-empty');
                        else if (wholeRowChanged || modified.has(rowIndex + ':' + col)) cell.classList.add(side === 'left' ? 'branch-compare-list-deleted' : 'branch-compare-list-added');
                    }
                }
            }
            if (leftRows.length === 0) {
                const cell = body.insertRow().insertCell();
                cell.colSpan = (diff.displayHeader.length + 1) * 2;
                cell.classList.add('branch-compare-list-note');
                cell.textContent = '行データの差分はありません';
            }
            section.appendChild(table);
            this.scroller.appendChild(section);
        }
        this.wrapper.append(summary, this.scroller);
        editor.appendChild(this.wrapper);
    }

    connectUiStateChangeListener(listener: () => void): void { this.uiStateChangeListener = listener; }

    getScrollPosition(): UiScrollPosition { return {...this.savedScroll}; }

    restoreScrollPosition(scrollTop: number, scrollLeft: number): void {
        this.savedScroll = {scrollTop, scrollLeft};
        this.scroller.scrollTop = scrollTop;
        this.scroller.scrollLeft = scrollLeft;
    }

    show(): void {
        this.wrapper.style.display = 'flex';
        this.restoreScrollPosition(this.savedScroll.scrollTop, this.savedScroll.scrollLeft);
    }

    hide(): void { this.wrapper.style.display = 'none'; }

    destroy(): void { this.wrapper.remove(); }
}
