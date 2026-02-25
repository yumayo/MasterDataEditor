import {EditorTableDataRow} from "./editor-table-data-row";
import {EditorTableDataColumn} from "./editor-table-data-column";
import {Csv} from "../csv";
import {Utility} from "../utility";

export class EditorTableData {

    description: string;

    primaryKey: string;

    header: EditorTableDataColumn[];

    body: EditorTableDataRow[];

    constructor(
        description: string, primaryKey: string,
        header: EditorTableDataColumn[],
        body: EditorTableDataRow[]
    ) {
        this.description = description;
        this.primaryKey = primaryKey;
        this.header = header;
        this.body = body;
    }

    static parse(json: any, csv: Csv) {

        const description = json['description'];

        const primaryKey = json['primary_key'];

        const header = json['header'];
        const columns: EditorTableDataColumn[] = [];
        for (let i = 0; i < header.length; ++i) {
            const column = header[i];
            columns.push(new EditorTableDataColumn(
                column.key, column.name, column.type,
                column.comment, column.reference, column.width ? `${column.width}px` : Utility.calculateColumnWidth(column.name)
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
            description, primaryKey, columns, rows
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

        return {
            json: {
                description: this.description,
                header: this.header.map(x => x.serialize()),
                primary_key: this.primaryKey,
            },
            csv: csv
        }
    }
}
