import {EditorTableDataRow} from "./editor-table-data-row";
import {EditorTableDataColumn} from "./editor-table-data-column";
import {Csv} from "../csv";
import {Utility} from "../../core/utility";
import {DynamicReferenceSchema} from "../../references/reference-expression";
import {COLUMN_AUTO_FIT_SAMPLE_ROW_COUNT} from "../../core/constant";

export class EditorTableData {

    description: string | null;

    /** 複合主キー構成列名の配列（単一PKも配列で保持する） */
    primaryKeyColumns: readonly string[];

    header: EditorTableDataColumn[];

    body: EditorTableDataRow[];

    /**
     * スキーマ列（DOM列）インデックス → ストア（CSV）列インデックスのマッピング。
     * DOM列インデックス i に対して columnMapping[i] がCSVの何番目の列かを示す。
     * 対応するCSV列が存在しない場合は -1。
     * 非連番keyスキーマ（key=0,3,4...）ではDOMインデックスとストアインデックスが異なるため、
     * ソート・git差分ハイライト等でストア行にアクセスする際は必ずこのマッピングを介すること。
     */
    columnMapping: readonly number[];

    /** CSV上のデータ行数。通常テーブルでは body を省略する場合があるため別に保持する。 */
    rowCount: number;

    constructor(
        description: string | null, primaryKeyColumns: readonly string[],
        header: EditorTableDataColumn[],
        body: EditorTableDataRow[],
        columnMapping: readonly number[],
        rowCount: number = body.length
    ) {
        this.description = description;
        this.primaryKeyColumns = primaryKeyColumns;
        this.header = header;
        this.body = body;
        this.columnMapping = columnMapping;
        this.rowCount = rowCount;
    }

    /**
     * スキーマJSONとCSVからEditorTableDataを生成する。
     * hasIcons が true の場合、フィルター・ソートアイコンの占有幅を列幅計算に含める。
     * ミニテーブル（アイコンなし）は false を渡すこと。
     */
    static parse(json: Record<string, unknown>, csv: Csv, hasIcons: boolean, options: { materializeBody?: boolean } = {}) {

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

        const header = json['header'] as Array<{key: number; name: string; type: string; comment?: string; reference?: string | DynamicReferenceSchema; default?: number | string | boolean | null; width?: number}>;
        const body = csv.body;
        const columns: EditorTableDataColumn[] = [];
        for (let i = 0; i < header.length; ++i) {
            const column = header[i];
            // スキーマの default フィールドを文字列化して保持する（未指定・null の場合は null → 型デフォルトが使われる）
            const defaultValue = (column.default !== undefined && column.default !== null) ? String(column.default) : null;
            const reference = column.reference !== undefined ? column.reference : null;
            const hasBadge = primaryKeyColumns.includes(column.name) || reference !== null;
            const width = typeof column.width === 'number'
                ? `${Utility.clampColumnWidthPx(column.width, column.name, column.type, hasIcons, hasBadge)}px`
                : Utility.calculateColumnWidth(column.name, column.type, hasIcons, hasBadge);
            columns.push(new EditorTableDataColumn(
                column.key, column.name, column.type,
                column.comment !== undefined ? column.comment : null,
                reference,
                defaultValue,
                width
            ));
        }

        // スキーマの各列がCSVの何番目の列に対応するかのマッピングを構築する
        // CSVにはスキーマにない列が含まれる場合があるため、名前で照合する
        const columnMapping: number[] = [];
        for (const col of columns) {
            const csvIndex = csv.header.indexOf(col.name);
            columnMapping.push(csvIndex);
        }

        // 幅が明示されていない列は、先頭の一定行数を使って初期表示からセル内容に合わせる。
        // 保存済み幅は呼び出し元で schema の width として適用されるため、ここでは上書きしない。
        const autoFitRowCount = Math.min(body.length, COLUMN_AUTO_FIT_SAMPLE_ROW_COUNT);
        for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
            if (typeof header[columnIndex].width === 'number') continue;
            const csvIndex = columnMapping[columnIndex];
            if (csvIndex === -1) continue;

            const column = columns[columnIndex];
            let maxWidth = Number.parseFloat(column.width);
            for (let rowIndex = 0; rowIndex < autoFitRowCount; rowIndex++) {
                const row = body[rowIndex];
                const cellValue = csvIndex < row.length ? row[csvIndex] : '';
                maxWidth = Math.max(maxWidth, Utility.calculateAutoFitCellWidthPx(cellValue));
            }
            column.width = Utility.clampColumnWidth(
                `${maxWidth}px`,
                column.name,
                column.type,
                hasIcons,
                primaryKeyColumns.includes(column.name) || column.reference !== null,
            );
        }

        const shouldMaterializeBody = options.materializeBody ?? true;
        const rows: EditorTableDataRow[] = [];
        if (shouldMaterializeBody) {
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
        }

        return new EditorTableData(
            description, primaryKeyColumns, columns, rows, columnMapping, body.length
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

        const primaryKeyValue: string[] = [...this.primaryKeyColumns];

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
