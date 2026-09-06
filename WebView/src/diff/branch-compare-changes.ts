import {gitCellBlameAsync} from '../app/api';
import {Csv} from '../data/csv';
import type {DiffBuildResult} from './diff-build-result';

export interface DiffChangedCell {
    /** 差分グリッドと同じ1始まりの行番号・列番号。 */
    row: number;
    column: number;
    columnName: string;
    side: 'left' | 'right';
    status: 'A' | 'M' | 'D';
    /** ヘッダーを含む元CSVの行番号。 */
    lineNumber: number;
}

/** 固定コミット間の変更セルを元CSVに対応付け、セルホバー用の履歴を取得する。 */
export class BranchCompareChanges {
    readonly cells: DiffChangedCell[];
    private readonly path: string;
    private readonly leftCommit: string;
    private readonly rightCommit: string;
    private readonly primaryKey: readonly string[];

    constructor(path: string, leftCommit: string, rightCommit: string, schemaJson: string, leftCsvText: string, rightCsvText: string, diff: DiffBuildResult) {
        this.path = path;
        this.leftCommit = leftCommit;
        this.rightCommit = rightCommit;
        const schema = JSON.parse(schemaJson) as {header: Array<{name: string}>; primary_key: string[]};
        this.primaryKey = schema.primary_key;
        this.cells = [];

        let leftRows: string[][];
        let rightRows: string[][];
        let leftOriginalRows: Int32Array;
        let rightOriginalRows: Int32Array;
        let leftHeader: readonly string[];
        let rightHeader: readonly string[];
        if (diff.mode === 'full') {
            if (!diff.leftRows || !diff.rightRows || !diff.leftOriginalRowIndices || !diff.rightOriginalRowIndices) throw new Error('通常差分の行情報がありません');
            leftRows = diff.leftRows;
            rightRows = diff.rightRows;
            leftOriginalRows = diff.leftOriginalRowIndices;
            rightOriginalRows = diff.rightOriginalRowIndices;
            leftHeader = diff.displayHeader;
            rightHeader = diff.displayHeader;
        } else {
            if (!diff.leftRowSourceIndices || !diff.rightRowSourceIndices) throw new Error('大規模差分の行情報がありません');
            const leftCsv = new Csv();
            const rightCsv = new Csv();
            leftCsv.load(leftCsvText);
            rightCsv.load(rightCsvText);
            leftRows = leftCsv.body;
            rightRows = rightCsv.body;
            leftOriginalRows = diff.leftRowSourceIndices;
            rightOriginalRows = diff.rightRowSourceIndices;
            leftHeader = leftCsv.header;
            rightHeader = rightCsv.header;
        }
        const deletedRows = new Set(diff.leftDeletedRowIndices);
        const addedRows = new Set(diff.rightAddedRowIndices);
        // スキーマ順が表示列順。CSV列順が異なる場合も名前で照合する。
        const columns = schema.header.map((column, index) => ({
            name: column.name, column: index + 1,
            displayed: diff.displayHeader.includes(column.name),
            left: leftHeader.indexOf(column.name), right: rightHeader.indexOf(column.name),
        })).filter(column => column.displayed);
        for (let row = 0; row < leftOriginalRows.length; row++) {
            const deleted = deletedRows.has(row);
            const added = addedRows.has(row);
            const left = leftRows[diff.mode === 'full' ? row : leftOriginalRows[row]];
            const right = rightRows[diff.mode === 'full' ? row : rightOriginalRows[row]];
            for (const column of columns) {
                if (!deleted && !added && (left?.[column.left] ?? '') === (right?.[column.right] ?? '')) continue;
                this.cells.push({
                    row: row + 1, column: column.column, columnName: column.name,
                    side: deleted ? 'left' : 'right', status: deleted ? 'D' : added ? 'A' : 'M',
                    lineNumber: (deleted ? leftOriginalRows[row] : rightOriginalRows[row]) + 2,
                });
            }
        }
    }

    async loadCellTitlesAsync(): Promise<ReadonlyMap<string, string>> {
        const sides = [...new Set(this.cells.map(cell => cell.side))];
        const results = await Promise.allSettled(sides.map(side => {
            const targets = this.cells.filter(cell => cell.side === side).map(cell => ({lineNumber: cell.lineNumber, columnName: cell.columnName}));
            return side === 'left'
                ? gitCellBlameAsync(this.path, this.leftCommit, this.primaryKey, targets, this.rightCommit)
                : gitCellBlameAsync(this.path, this.rightCommit, this.primaryKey, targets);
        }));
        const titles = new Map<string, string>();
        for (const [index, side] of sides.entries()) {
            const result = results[index];
            const entries = new Map(result.status === 'fulfilled' ? result.value.map(entry => [JSON.stringify([entry.lineNumber, entry.columnName]), entry]) : []);
            for (const cell of this.cells) {
                if (cell.side !== side) continue;
                const entry = entries.get(JSON.stringify([cell.lineNumber, cell.columnName]));
                const sourceLabel = side === 'left' ? '削除した人' : '比較先の最終変更者';
                const title = `${cell.row}L:${cell.columnName}（元CSV ${cell.lineNumber}行）\n${sourceLabel}: ${entry?.author || '履歴から特定できませんでした'}`
                    + (entry ? `\n${entry.date}\n${entry.commitHash}\n${entry.commitMessage}` : '');
                titles.set(`${cell.row}:${cell.column}`, title);
            }
        }
        return titles;
    }
}
