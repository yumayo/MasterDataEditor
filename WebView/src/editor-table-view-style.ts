import {EditorTableView} from "./editor-table-view";
import {EditorTable} from "./editor-table";
import {Selection} from "./selection";

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
        const rowMetadata = viewContext.rowMetadata;
        const columnMappings = viewContext.columnMappings;
        for (let metaIdx = startMetaIdx; metaIdx < endMetaIdx; metaIdx++) {
            const meta = rowMetadata[metaIdx];
            const domRowIndex = metaIdx + 1;
            const rowElement = tableElement.children[domRowIndex] as HTMLElement;
            if (!rowElement) continue;
            // パディングセルのスタイル適用（初期レンダリング時のみ）
            if (applyPadding) {
                for (let colIdx = 0; colIdx < meta.paddingColumns.length; colIdx++) {
                    if (!meta.paddingColumns[colIdx]) continue;
                    const cellElement = rowElement.children[colIdx + 1] as HTMLElement;
                    if (!cellElement) continue;
                    cellElement.classList.add('view-padding-cell');
                    cellElement.textContent = '';
                }
            }
            // グループリーダー行の判定
            const isBaseGroupLeader = meta.groupInfos.length === 0
                || meta.groupInfos.every(g => g.groupPosition === 0);
            if (isBaseGroupLeader && metaIdx > 0) {
                const prevMeta = rowMetadata[metaIdx - 1];
                if (prevMeta.baseRowIndex !== meta.baseRowIndex) {
                    rowElement.classList.add('view-group-leader-row');
                }
            }
            // 折りたたみトグルの配置
            for (const groupInfo of meta.groupInfos) {
                if (groupInfo.groupPosition !== 0 || groupInfo.groupSize <= 1) continue;
                const joinDef = viewContext.viewDefinition.joins.find(j => j.targetTable === groupInfo.sourceTable);
                if (!joinDef) continue;
                const sourceTableName = joinDef.sourceTable === ''
                    ? viewContext.viewDefinition.baseTable : joinDef.sourceTable;
                const sourceColIdx = columnMappings.findIndex(
                    m => m.tableName === sourceTableName && m.sourceColumnName === joinDef.sourceColumn
                );
                if (sourceColIdx < 0) continue;
                const cellElement = rowElement.children[sourceColIdx + 1] as HTMLElement;
                if (!cellElement) continue;
                // 既存のトグルがあれば除去（重複防止）
                const existingToggle = cellElement.querySelector('.view-collapse-toggle');
                if (existingToggle) existingToggle.remove();
                const toggle = document.createElement('span');
                toggle.classList.add('view-collapse-toggle');
                toggle.textContent = '▼';
                toggle.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                });
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleCollapseGroup(metaIdx, groupInfo.sourceTable, toggle);
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
     * グループの折りたたみ/展開をトグルする
     * 表示状態の変更のみでデータ変更を伴わないため、Undo/Redo対象外
     */
    private toggleCollapseGroup(leaderMetaIndex: number, targetTable: string, toggle: HTMLElement): void {
        const viewContext = this.view.getViewContext();
        const rowMetadata = viewContext.rowMetadata;
        const leaderMeta = rowMetadata[leaderMetaIndex];
        // このグループのgroupInfoを特定
        const groupInfoIndex = leaderMeta.groupInfos.findIndex(g => g.sourceTable === targetTable);
        if (groupInfoIndex === -1) return;
        const isCollapsed = toggle.textContent === '▶';
        if (isCollapsed) {
            // 展開: 子行を表示する
            toggle.textContent = '▼';
            this.setGroupRowsVisibility(leaderMetaIndex, targetTable, groupInfoIndex, true);
        } else {
            // 折りたたみ: 子行を非表示にする
            toggle.textContent = '▶';
            this.setGroupRowsVisibility(leaderMetaIndex, targetTable, groupInfoIndex, false);
        }
        // 行の表示/非表示が変わったので選択範囲の描画を再計算する
        this.selection.updateRendererAfterResize();
    }

    /**
     * グループの子行の表示/非表示を設定する
     */
    private setGroupRowsVisibility(
        leaderMetaIndex: number, targetTable: string, groupInfoIndex: number, visible: boolean
    ): void {
        const viewContext = this.view.getViewContext();
        const tableElement = this.table.getTableElement();
        const rowMetadata = viewContext.rowMetadata;
        const leaderMeta = rowMetadata[leaderMetaIndex];
        const leaderGroupInfo = leaderMeta.groupInfos[groupInfoIndex];
        // リーダー行以降の同一グループの行を探す
        for (let i = leaderMetaIndex + 1; i < rowMetadata.length; i++) {
            const meta = rowMetadata[i];
            // ベース行が変わったらグループ終了
            if (meta.baseRowIndex !== leaderMeta.baseRowIndex) break;
            // このレベルのgroupInfoが同じキー値を持つか判定
            if (groupInfoIndex >= meta.groupInfos.length) break;
            const groupInfo = meta.groupInfos[groupInfoIndex];
            if (groupInfo.sourceTable !== targetTable) break;
            if (groupInfo.sourceKeyValue !== leaderGroupInfo.sourceKeyValue) break;
            const domRowIndex = i + 1;
            const rowElement = tableElement.children[domRowIndex] as HTMLElement;
            if (!rowElement) continue;
            rowElement.style.display = visible ? '' : 'none';
        }
    }
}
