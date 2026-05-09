/**
 * 差分ビュー
 * HEAD版CSVと現在版CSVの差分を左右2ペインで表示する読み取り専用ビュー
 */
import {buildDiffRows, DiffRow} from "./diff-rows";

/**
 * スキーマJSON
 */
interface SchemaJson {
    primary_key: string[];
}

/**
 * 差分ビュー
 * DiffView はコンストラクタ完了時に差分計算とDOMが確定する（生焼けオブジェクト不可）
 */
export class DiffView {
    private readonly element: HTMLElement;

    constructor(tableName: string, schemaJson: string, headCsv: string, currentCsv: string) {
        // スキーマをパースしてPK列名（配列）を特定する
        const schema = JSON.parse(schemaJson) as SchemaJson;
        const primaryKeyNames: readonly string[] = schema.primary_key;

        const { diffRows, displayHeader } = buildDiffRows(headCsv, currentCsv, primaryKeyNames);

        // ルート要素を構築する
        this.element = document.createElement('div');
        this.element.classList.add('diff-view');

        // 左ペイン（変更前）を構築する
        const leftPane = document.createElement('div');
        leftPane.classList.add('diff-view-pane-before');

        const leftLabel = document.createElement('div');
        leftLabel.classList.add('diff-view-label-before');
        leftLabel.textContent = `${tableName} (変更前)`;
        leftPane.appendChild(leftLabel);

        // 右ペイン（変更後）を構築する
        const rightPane = document.createElement('div');
        rightPane.classList.add('diff-view-pane-after');

        const rightLabel = document.createElement('div');
        rightLabel.classList.add('diff-view-label-after');
        rightLabel.textContent = `${tableName} (変更後)`;
        rightPane.appendChild(rightLabel);

        // 列ヘッダー行を追加する
        leftPane.appendChild(this.buildHeaderRow(displayHeader));
        rightPane.appendChild(this.buildHeaderRow(displayHeader));

        // 各差分行をレンダリングする
        for (const row of diffRows) {
            const { leftRow, rightRow } = this.buildDiffRowPair(row, displayHeader);
            leftPane.appendChild(leftRow);
            rightPane.appendChild(rightRow);
        }

        this.element.appendChild(leftPane);
        this.element.appendChild(rightPane);
    }

    /**
     * 差分ビューを親要素に追加する
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    /**
     * 差分ビューを親要素から取り外す
     */
    detach(): void {
        if (this.element.parentElement !== null) {
            this.element.parentElement.removeChild(this.element);
        }
    }

    /**
     * 列ヘッダー行のDOM要素を構築する
     */
    private buildHeaderRow(columns: string[]): HTMLElement {
        const row = document.createElement('div');
        row.classList.add('diff-header-row');
        for (const colName of columns) {
            const cell = document.createElement('div');
            cell.classList.add('diff-cell');
            cell.textContent = colName;
            row.appendChild(cell);
        }
        return row;
    }

    /**
     * 差分行の左右ペアを構築する
     * 左: HEAD版、右: 現在版
     * discriminated union により kind に応じて型が確定するため as キャスト不要
     */
    private buildDiffRowPair(
        row: DiffRow,
        columns: string[]
    ): { leftRow: HTMLElement; rightRow: HTMLElement } {
        if (row.kind === 'deleted') {
            // 削除行: 左にデータ行(.diff-row-deleted)、右に空白行(.diff-row-empty)
            const leftRow = this.buildDataRow(row.headValues, columns, new Set(), 'deleted');
            const rightRow = document.createElement('div');
            rightRow.classList.add('diff-row-empty');
            return { leftRow, rightRow };
        }

        if (row.kind === 'added') {
            // 追加行: 左に空白行(.diff-row-empty)、右にデータ行（全セルに.diff-cell-added）
            const leftRow = document.createElement('div');
            leftRow.classList.add('diff-row-empty');
            const rightRow = this.buildDataRow(row.currentValues, columns, new Set(), 'added');
            return { leftRow, rightRow };
        }

        if (row.kind === 'modified') {
            // 変更行: 左はHEAD版（変更セルに.diff-cell-deleted）、右は現在版（変更セルに.diff-cell-added）
            const leftRow = this.buildDataRow(row.headValues, columns, row.changedColumnIndices, 'deleted-cell');
            const rightRow = this.buildDataRow(row.currentValues, columns, row.changedColumnIndices, 'added-cell');
            return { leftRow, rightRow };
        }

        // unchanged: 左右ともに通常行
        const leftRow = this.buildDataRow(row.headValues, columns, new Set(), 'none');
        const rightRow = this.buildDataRow(row.currentValues, columns, new Set(), 'none');
        return { leftRow, rightRow };
    }

    /**
     * データ行のDOM要素を構築する
     * highlightMode で行全体またはセル単位のハイライトを制御する
     */
    private buildDataRow(
        values: string[],
        columns: string[],
        changedIndices: Set<number>,
        highlightMode: 'deleted' | 'added' | 'deleted-cell' | 'added-cell' | 'none'
    ): HTMLElement {
        const row = document.createElement('div');
        row.classList.add('diff-row');

        if (highlightMode === 'deleted') {
            row.classList.add('diff-row-deleted');
        }

        for (let i = 0; i < columns.length; i++) {
            const cell = document.createElement('div');
            cell.classList.add('diff-cell');
            // 配列長チェックで範囲外アクセスを回避する（undefined を使わない）
            cell.textContent = i < values.length ? values[i] : '';

            // 追加行は全セルに diff-cell-added を付与する（行クラスではなくセルクラスで統一）
            if (highlightMode === 'added') {
                cell.classList.add('diff-cell-added');
            } else if (highlightMode === 'deleted-cell' && changedIndices.has(i)) {
                cell.classList.add('diff-cell-deleted');
            } else if (highlightMode === 'added-cell' && changedIndices.has(i)) {
                cell.classList.add('diff-cell-added');
            }

            row.appendChild(cell);
        }

        return row;
    }
}
