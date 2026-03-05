import {EditorTableView} from "./editor-table-view";
import {EditorTable} from "./editor-table";
import {Selection, CellRange} from "./selection";
import {getBaseRowIndex, getGroupInfos} from "./model/view-row-metadata";
import {findFkColumnIndex, countGroupChildren} from "./view-group-query";

/**
 * ビュー行スタイルモジュール
 *
 * 責務:
 * - パディングセルのスタイル適用
 * - グループリーダー行のスタイル適用
 * - 折りたたみトグルの配置と動作
 */
export class EditorTableViewStyle {
    private readonly view: EditorTableView;
    private readonly table: EditorTable;
    private readonly selection: Selection;

    constructor(view: EditorTableView, table: EditorTable, selection: Selection) {
        this.view = view;
        this.table = table;
        this.selection = selection;
    }

    /**
     * 指定メタデータ範囲のビュー行スタイルを適用する
     * パディング・グループリーダー・折りたたみトグルを設定する
     */
    applyViewRowStylesForRange(startMetaIdx: number, endMetaIdx: number, applyPadding: boolean): void {
        if (!this.view.hasViewContext()) return;
        const viewContext = this.view.getViewContext();
        const tableElement = this.table.getTableElement();
        for (let metaIdx = startMetaIdx; metaIdx < endMetaIdx; metaIdx++) {
            const domRowIndex = metaIdx + 1;
            const rowElement = tableElement.children[domRowIndex] as HTMLElement;
            if (!rowElement) continue;
            // DOM属性がない行（空行）はスキップする（getGroupInfosの不正呼び出しを防止）
            if (!rowElement.hasAttribute('data-base-row-index')) continue;
            const baseRowIdx = getBaseRowIndex(rowElement);
            const groupInfos = getGroupInfos(rowElement);
            // パディングセルのスタイル適用（初期レンダリング時のみ）
            // paddingはDOM行のセルにview-padding-cellクラスとして設定済み、
            // ここではbuildAndInsertExpandedViewRowsでまだ設定されていない初期構築時に適用する
            if (applyPadding) {
                // パディング情報はExpandedRowResultのpadding配列からDOM生成時に設定される
                // ここではview-padding-cellクラスが付与されたセルのtextContentをクリアする
                for (let colIdx = 0; colIdx < rowElement.children.length - 1; colIdx++) {
                    const cellElement = rowElement.children[colIdx + 1] as HTMLElement;
                    if (!cellElement) continue;
                    if (cellElement.classList.contains('view-padding-cell')) {
                        cellElement.textContent = '';
                    }
                }
            }
            // グループリーダー行の判定（DOM属性ベース）
            const isBaseGroupLeader = groupInfos.length === 0
                || groupInfos.every(g => g.groupPosition === 0);
            if (isBaseGroupLeader && metaIdx > 0) {
                const prevRowElement = tableElement.children[metaIdx] as HTMLElement;
                if (prevRowElement && getBaseRowIndex(prevRowElement) !== baseRowIdx) {
                    rowElement.classList.add('view-group-leader-row');
                }
            }
            // 折りたたみトグルの配置
            for (const groupInfo of groupInfos) {
                if (groupInfo.groupPosition !== 0 || groupInfo.groupSize <= 1) continue;
                const fkColIdx = findFkColumnIndex(viewContext.viewDefinition, viewContext.columnMappings, groupInfo.sourceTable);
                if (fkColIdx < 0) continue;
                const cellElement = rowElement.children[fkColIdx + 1] as HTMLElement;
                if (!cellElement) continue;
                // 既存のトグルがあれば除去（重複防止）
                const existingToggle = cellElement.querySelector('.view-collapse-toggle');
                if (existingToggle) existingToggle.remove();
                const toggle = document.createElement('span');
                toggle.classList.add('view-collapse-toggle');
                toggle.textContent = '▼';
                toggle.dataset.targetTable = groupInfo.sourceTable;
                toggle.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                });
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // data-rowをそのままDOM行インデックスとして使用（DOM属性ベース）
                    const currentDomRowIndex = Number((toggle.closest('[data-row]') as HTMLElement).dataset.row);
                    const currentTargetTable = toggle.dataset.targetTable!;
                    this.toggleCollapseGroup(currentDomRowIndex, currentTargetTable, toggle);
                });
                toggle.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                });
                cellElement.insertBefore(toggle, cellElement.firstChild);
            }
        }
    }

    /**
     * グループの折りたたみ/展開をトグルする（ステートレス: DOM属性ベース）
     * 表示状態の変更のみでデータ変更を伴わないため、Undo/Redo対象外
     */
    private toggleCollapseGroup(leaderDomRowIndex: number, targetTable: string, toggle: HTMLElement): void {
        const viewContext = this.view.getViewContext();
        const tableElement = this.table.getTableElement();
        // 事前条件: DOM行インデックスの範囲チェック
        if (leaderDomRowIndex < 1 || leaderDomRowIndex >= tableElement.children.length) {
            throw new Error(`トグルのDOM行インデックスが範囲外です: ${leaderDomRowIndex}`);
        }
        // FK列のcompositeインデックスをViewDefinitionから算出（ステートレス）
        const fkColIdx = findFkColumnIndex(viewContext.viewDefinition, viewContext.columnMappings, targetTable);
        if (fkColIdx < 0) {
            throw new Error(`トグルの対象テーブルのFK列が見つかりません: targetTable=${targetTable}`);
        }
        // FK列のDOMセルインデックス（行ヘッダー分+1）
        const fkCellDomIndex = fkColIdx + 1;
        // 子行数をDOMから算出（view-group-queryに委譲）
        const childCount = countGroupChildren(tableElement, leaderDomRowIndex, fkCellDomIndex);
        const isCollapsed = toggle.textContent === '▶';
        if (isCollapsed) {
            // 展開: 子行を表示する
            toggle.textContent = '▼';
            for (let i = 1; i <= childCount; i++) {
                const rowElement = tableElement.children[leaderDomRowIndex + i] as HTMLElement;
                rowElement.style.display = '';
            }
            // 折りたたみ時に縮小された選択範囲がそのままであれば復元する
            const savedOriginal = toggle.dataset.savedOriginal;
            const savedCollapsed = toggle.dataset.savedCollapsed;
            if (savedOriginal && savedCollapsed) {
                const original = this.parseCellRangeFromDataAttr(savedOriginal);
                const collapsed = this.parseCellRangeFromDataAttr(savedCollapsed);
                const current = this.selection.getSelectionRange();
                if (current.startRow === collapsed.startRow
                    && current.startColumn === collapsed.startColumn
                    && current.endRow === collapsed.endRow
                    && current.endColumn === collapsed.endColumn) {
                    this.selection.setRange(original.startRow, original.startColumn, original.endRow, original.endColumn);
                }
                toggle.removeAttribute('data-saved-original');
                toggle.removeAttribute('data-saved-collapsed');
            }
        } else {
            // 折りたたみ: 子行を非表示にする
            toggle.textContent = '▶';
            for (let i = 1; i <= childCount; i++) {
                const rowElement = tableElement.children[leaderDomRowIndex + i] as HTMLElement;
                rowElement.style.display = 'none';
            }
            // 非表示になった行と選択範囲が重なる場合、選択範囲を縮小する
            if (childCount > 0) {
                const firstHiddenDomRow = leaderDomRowIndex + 1;
                const lastHiddenDomRow = leaderDomRowIndex + childCount;
                const range = this.selection.getSelectionRange();
                let startRow = range.startRow;
                let endRow = range.endRow;
                let adjusted = false;
                if (endRow >= firstHiddenDomRow && endRow <= lastHiddenDomRow) {
                    endRow = firstHiddenDomRow - 1;
                    adjusted = true;
                }
                if (startRow >= firstHiddenDomRow && startRow <= lastHiddenDomRow) {
                    startRow = lastHiddenDomRow + 1;
                    adjusted = true;
                }
                if (adjusted) {
                    if (startRow > endRow) {
                        startRow = leaderDomRowIndex;
                        endRow = leaderDomRowIndex;
                    }
                    // 縮小前の選択範囲と縮小後の選択範囲をtoggleのdata属性に保存（展開時の復元用）
                    toggle.dataset.savedOriginal = `${range.startRow},${range.startColumn},${range.endRow},${range.endColumn}`;
                    toggle.dataset.savedCollapsed = `${startRow},${range.startColumn},${endRow},${range.endColumn}`;
                    this.selection.setRange(startRow, range.startColumn, endRow, range.endColumn);
                }
            }
        }
        // 行の表示/非表示が変わったので選択範囲の描画を再計算する
        this.selection.updateRendererAfterResize();
    }

    /**
     * data属性のカンマ区切り文字列をCellRangeに変換する
     * toggleCollapseGroupの展開・折りたたみ両方で使用する共通パーサー
     */
    private parseCellRangeFromDataAttr(value: string): CellRange {
        const parts = value.split(',').map(Number);
        return { startRow: parts[0], startColumn: parts[1], endRow: parts[2], endColumn: parts[3] };
    }
}
