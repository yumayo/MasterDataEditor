import {EditorTableDataRow} from "./editor-table-data-row";
import {EditorTableDataColumn} from "./editor-table-data-column";
import {Csv} from "../csv";

export class EditorTableData {

    description: string;

    primaryKey: string;

    header: EditorTableDataColumn[];

    body: EditorTableDataRow[];

    constructor(description: string, primaryKey: string, header: EditorTableDataColumn[], body: EditorTableDataRow[]) {
        this.description = description;
        this.primaryKey = primaryKey;
        this.header = header;
        this.body = body;
    }

    static parse(json: any, csv: Csv) {

        const description = json['description'];

        const primaryKey = json['primary_key'];

        const header = json['header'];
        const columns = [];
        for (let i = 0; i < header.length; ++i) {
            const column = header[i];
            columns.push(new EditorTableDataColumn(column.key, column.name, column.type, column.comment, column.references));
        }

        const body = csv.body;
        const rows = [];
        for (let i = 0; i < body.length; ++i) {
            const row = body[i];
            rows.push(new EditorTableDataRow(row));
        }

        return new EditorTableData(description, primaryKey, columns, rows);
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
