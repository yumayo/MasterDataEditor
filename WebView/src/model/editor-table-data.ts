import {EditorTableDataRow} from "./editor-table-data-row";
import {EditorTableDataColumn} from "./editor-table-data-column";
import {Csv} from "../csv";
import {Utility} from "../utility";

export class EditorTableData {

    description: string | null;

    /** 複合主キー構成列名の配列（単一PKも配列で保持する） */
    primaryKeyColumns: readonly string[];

    header: EditorTableDataColumn[];

    body: EditorTableDataRow[];

    constructor(
        description: string | null, primaryKeyColumns: readonly string[],
        header: EditorTableDataColumn[],
        body: EditorTableDataRow[]
    ) {
        this.description = description;
        this.primaryKeyColumns = primaryKeyColumns;
        this.header = header;
        this.body = body;
    }

    /**
     * スキーマJSONとCSVからEditorTableDataを生成する。
     * hasIcons が true の場合、フィルター・ソートアイコンの占有幅を列幅計算に含める。
     * ミニテーブル（アイコンなし）は false を渡すこと。
     */
    static parse(json: Record<string, unknown>, csv: Csv, hasIcons: boolean) {

        const description = json['description'] !== undefined ? json['description'] as string : null;

        // primary_key は文字列（単一PK）または文字列配列（複合PK）のどちらでもよい
        const rawPrimaryKey = json['primary_key'];
        if (typeof rawPrimaryKey !== 'string' && !Array.isArray(rawPrimaryKey)) {
            throw new Error('[EditorTableData.parse] primary_key がスキーマに存在しないか、不正な型です');
        }
        const primaryKeyColumns: readonly string[] = Array.isArray(rawPrimaryKey)
            ? (rawPrimaryKey as string[])
            : [rawPrimaryKey];
        if (primaryKeyColumns.length === 0) {
            throw new Error('[EditorTableData.parse] primary_key が空です');
        }

        const header = json['header'] as Array<{key: number; name: string; type: string; comment?: string; reference?: string; width?: number}>;
        const columns: EditorTableDataColumn[] = [];
        for (let i = 0; i < header.length; ++i) {
            const column = header[i];
            columns.push(new EditorTableDataColumn(
                column.key, column.name, column.type,
                column.comment !== undefined ? column.comment : null,
                column.reference !== undefined ? column.reference : null,
                column.width ? `${column.width}px` : Utility.calculateColumnWidth(column.name, hasIcons)
            ));
        }

        // スキーマの各列がCSVの何番目の列に対応するかのマッピングを構築する
        // CSVにはスキーマにない列が含まれる場合があるため、名前で照合する
        const columnMapping: number[] = [];
        for (const col of columns) {
            const csvIndex = csv.header.indexOf(col.name);
            columnMapping.push(csvIndex);
        }

        const body = csv.body;
        const rows: EditorTableDataRow[] = [];
        for (let i = 0; i < body.length; ++i) {
            const csvRow = body[i];
            // スキーマの列順に並べ替えた値を作成
            const mappedValues: string[] = [];
            for (const csvIndex of columnMapping) {
                if (csvIndex !== -1 && csvIndex < csvRow.length) {
                    mappedValues.push(csvRow[csvIndex]);
                } else {
                    mappedValues.push('');
                }
            }
            rows.push(
                new EditorTableDataRow(mappedValues)
            );
        }

        return new EditorTableData(
            description, primaryKeyColumns, columns, rows
        );
    }

    serialize() {

        const csv = new Csv();
        csv.header = this.header.map(x => x.name);

        const bodyRows: string[][] = [];
        for (const row of this.body) {
            const serialized = row.serialize();
            if (serialized.length > 0 && serialized[0] !== '') {
                bodyRows.push(serialized);
            } else {
                break;
            }
        }
        csv.body = bodyRows;

        // 単一PKは文字列形式に戻してスキーマを汚染しない（後方互換）
        const primaryKeyValue: string | string[] = this.primaryKeyColumns.length === 1
            ? this.primaryKeyColumns[0]
            : [...this.primaryKeyColumns];

        return {
            json: {
                // description が null の場合はキー自体を出力しない（元スキーマに存在しないキーを汚染しない）
                ...(this.description !== null ? { description: this.description } : {}),
                header: this.header.map(x => x.serialize()),
                primary_key: primaryKeyValue,
            },
            csv: csv
        }
    }
}
