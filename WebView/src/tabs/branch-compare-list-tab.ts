import type {Editor} from '../editor/editor';
import type {GitBranchCompareFile} from '../app/api';
import type {DiffBuildResult} from '../diff/diff-build-result';
import type {UiStoredBranchCompareListTab, UiScrollPosition} from '../app/ui-state';
import type {InMemoryTableStore} from '../data/in-memory-table-store';
import type {LargeFileSettings} from '../settings/settings-schema';
import type {Tab} from './tab';
import type {DiffTab} from './diff-tab';
import './branch-compare-list-tab.css';

export interface BranchCompareListSection {
    file: GitBranchCompareFile;
    diff: DiffBuildResult;
    schemaJson: string;
}

interface ListSectionView {
    body: HTMLElement;
    diffs: DiffTab[];
}

/** Git差分の共通グリッドを連続配置し、見出しと縦スクロールだけを一覧で管理する。 */
export class BranchCompareListTab {
    private static nextListId = 1;
    private readonly wrapper: HTMLElement;
    private readonly scroller: HTMLElement;
    private readonly sections: ListSectionView[] = [];
    private readonly diffs: DiffTab[] = [];
    private savedScroll: UiScrollPosition = {scrollTop: 0, scrollLeft: 0};
    private uiStateChangeListener: (() => void) | false = false;

    constructor(editor: Editor, tab: Tab, store: InMemoryTableStore, metadata: UiStoredBranchCompareListTab, sections: BranchCompareListSection[], identity: string) {
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
        this.scroller.addEventListener('wheel', (event: WheelEvent) => {
            if (event.ctrlKey || event.shiftKey || event.deltaY === 0) return;
            // 内側の固定セル・差分ペインが縦wheelを消費する前に、外側へ1度だけ適用する。
            const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? this.scroller.clientHeight : 1;
            this.scroller.scrollTop += event.deltaY * scale;
            if (event.deltaX !== 0) {
                for (const diff of this.diffs) if (diff.scrollHorizontallyAt(event.target, event.deltaX * scale)) break;
            }
            event.preventDefault();
            event.stopPropagation();
        }, {capture: true, passive: false});
        this.wrapper.append(summary, this.scroller);
        editor.appendChild(this.wrapper);
        const listId = BranchCompareListTab.nextListId++;
        try {
            for (const [sectionIndex, data] of sections.entries()) {
                const {file, diff} = data;
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
                heading.classList.add('branch-compare-list-heading');
                const toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.classList.add('branch-compare-list-toggle');
                toggle.setAttribute('aria-expanded', 'true');
                const chevron = document.createElement('span');
                chevron.classList.add('branch-compare-list-chevron');
                chevron.textContent = '▾';
                chevron.setAttribute('aria-hidden', 'true');
                const status = document.createElement('span');
                status.classList.add('branch-compare-list-status');
                status.textContent = file.status + ' ' + ({M: '変更', A: '追加', D: '削除'}[file.status]);
                const name = document.createElement('span');
                name.classList.add('branch-compare-list-name');
                name.textContent = file.tableName;
                const path = document.createElement('span');
                path.classList.add('branch-compare-list-path');
                path.textContent = file.path;
                toggle.append(chevron, status, name, path);
                heading.appendChild(toggle);
                const body = document.createElement('div');
                body.classList.add('branch-compare-list-body');
                body.id = 'branch-compare-list-' + listId + '-section-' + sectionIndex;
                toggle.setAttribute('aria-controls', body.id);
                section.append(heading, body);
                this.scroller.appendChild(section);
                const view: ListSectionView = {body, diffs: []};
                this.sections.push(view);
                toggle.addEventListener('click', () => {
                    const oldTop = heading.getBoundingClientRect().top;
                    const collapse = !body.hidden;
                    if (collapse) for (const child of view.diffs) child.hide();
                    body.hidden = collapse;
                    toggle.setAttribute('aria-expanded', String(!collapse));
                    chevron.textContent = collapse ? '▸' : '▾';
                    if (!collapse) for (const child of view.diffs) child.show();
                    // 表の高さが変わっても、操作した見出しを可能な範囲で同じ画面位置に保つ。
                    this.scroller.scrollTop += heading.getBoundingClientRect().top - oldTop;
                });
                const omitted = new Map(gaps.map(gap => [gap.beforeRow, gap.count]));
                const boundaries = [...new Set([0, ...gaps.map(gap => gap.beforeRow), leftRows.length])].sort((a, b) => a - b);
                for (const [boundaryIndex, start] of boundaries.entries()) {
                    const count = omitted.get(start);
                    if (typeof count === 'number') {
                        const gap = document.createElement('div');
                        gap.classList.add('branch-compare-list-gap');
                        gap.textContent = count + ' 行を省略';
                        body.appendChild(gap);
                    }
                    if (boundaryIndex === boundaries.length - 1 && leftRows.length !== 0) continue;
                    const end = leftRows.length === 0 ? 0 : boundaries[boundaryIndex + 1];
                    const shiftRows = (rows: number[]): number[] => rows.filter(row => row >= start && row < end).map(row => row - start);
                    const shiftCells = (cells: Array<{row: number; col: number}>): Array<{row: number; col: number}> => cells.filter(cell => cell.row >= start && cell.row < end).map(cell => ({row: cell.row - start, col: cell.col}));
                    const hunk: DiffBuildResult = {
                        mode: 'full', hasChanges: diff.hasChanges, displayHeader: diff.displayHeader, newColumnIndices: diff.newColumnIndices,
                        leftRows: leftRows.slice(start, end), rightRows: rightRows.slice(start, end),
                        leftOriginalRowIndices: leftIndices.slice(start, end), rightOriginalRowIndices: rightIndices.slice(start, end),
                        leftEmptyRowIndices: shiftRows(diff.leftEmptyRowIndices), rightEmptyRowIndices: shiftRows(diff.rightEmptyRowIndices),
                        leftDeletedRowIndices: shiftRows(diff.leftDeletedRowIndices), rightAddedRowIndices: shiftRows(diff.rightAddedRowIndices),
                        leftModifiedCells: shiftCells(diff.leftModifiedCells), rightModifiedCells: shiftCells(diff.rightModifiedCells),
                    };
                    const child = tab.createEmbeddedBranchCompareDiff(identity, data, hunk, start, body, metadata);
                    view.diffs.push(child);
                    this.diffs.push(child);
                }
                if (leftRows.length === 0) {
                    const empty = document.createElement('div');
                    empty.classList.add('branch-compare-list-note');
                    empty.textContent = '行データの差分はありません';
                    body.appendChild(empty);
                }
            }
        } catch (error: unknown) {
            this.destroy(store);
            throw error;
        }
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
        for (const section of this.sections) if (!section.body.hidden) for (const diff of section.diffs) diff.show();
        this.restoreScrollPosition(this.savedScroll.scrollTop, this.savedScroll.scrollLeft);
    }

    hide(): void {
        for (const diff of this.diffs) diff.hide();
        this.wrapper.style.display = 'none';
    }

    refreshLayoutAfterResize(): void {
        for (const section of this.sections) if (!section.body.hidden) for (const diff of section.diffs) diff.refreshLayoutAfterResize();
    }

    setLargeFileSettings(settings: LargeFileSettings): void { for (const diff of this.diffs) diff.setLargeFileSettings(settings); }
    openFindBar(target: EventTarget | null): boolean { return this.diffs.some(diff => diff.openFindBar(target)); }

    destroy(store: InMemoryTableStore): void {
        for (const diff of this.diffs) diff.destroy(store);
        this.wrapper.remove();
    }
}
