import {findFilesAsync, readFileAsync} from "./api";
import {config} from "./config";
import {Csv} from "./csv";
import {EditorTable} from "./editor-table";
import {
    parseReferenceExpression,
    isSimpleReference
} from "./reference-expression";

/**
 * 逆参照の1エントリ
 * あるPK値を参照している子テーブル1つ分の情報
 */
export interface ReverseReferenceEntry {
    /** 子テーブル名 */
    childTableName: string;
    /** 子行の表示テキスト一覧 */
    displayTexts: string[];
}

/**
 * 逆参照マップ
 * キー: 親テーブルのPK値
 * 値: そのPK値を参照しているエントリの配列
 */
export type ReverseReferenceMap =
    Map<string, ReverseReferenceEntry[]>;

/**
 * 逆参照を解決するクラス
 *
 * 親テーブルを開いたとき、どの子テーブルから参照されているかを
 * 発見し、PK値ごとにグループ化したマップを構築する。
 */
export class ReverseReferenceResolver {

    /** タブで開かれているEditorTableの参照（インメモリデータ優先取得用） */
    private readonly openEditorTables: Map<string, EditorTable>;

    constructor(openEditorTables: Map<string, EditorTable>) {
        this.openEditorTables = openEditorTables;
    }

    /**
     * タブで開かれているテーブルのインメモリデータからCsvを構築する
     * DOMから現在の値を読み取るため、未保存の編集内容も反映される
     * 開かれていなければ結果なしを返す
     */
    private getInMemoryCsv(tableName: string): Csv | false {
        const editorTable = this.openEditorTables.get(tableName);
        if (!editorTable) return false;

        const columnCount = editorTable.getColumnCount();
        const rowCount = editorTable.getRowCount();

        const csv = new Csv();

        // 列ヘッダーをDOMから取得
        const header: string[] = [];
        for (let c = 0; c < columnCount; c++) {
            header.push(editorTable.getColumnHeaderValue(c));
        }
        csv.header = header;

        // データ行をDOMから取得（セル編集はDOMのみ更新されるため）
        const body: string[][] = [];
        for (let r = 1; r < rowCount; r++) {
            const rowData: string[] = [];
            for (let c = 1; c <= columnCount; c++) {
                rowData.push(editorTable.getCellValueAt(r, c));
            }
            if (rowData.length > 0 && rowData[0] !== '') {
                body.push(rowData);
            } else {
                break;
            }
        }
        csv.body = body;
        return csv;
    }

    /**
     * 指定テーブルを参照している全子テーブルを走査し、
     * 逆参照マップを構築する
     * @param tableName 親テーブル名
     */
    async resolveAsync(
        tableName: string
    ): Promise<ReverseReferenceMap> {
        const map: ReverseReferenceMap = new Map();

        // 全スキーマファイルを列挙
        const schemaFiles =
            await findFilesAsync("schema");

        // 各スキーマを読み込み、tableName を参照している列を探す
        const childPromises: Promise<void>[] = [];
        for (const file of schemaFiles) {
            if (file.type !== 'file') continue;
            // .json 拡張子のみ対象
            if (!file.name.endsWith('.json')) continue;

            const childTableName =
                file.name.replace('.json', '');
            // 自分自身は除外
            if (childTableName === tableName) continue;

            childPromises.push(
                this.processChildTableAsync(
                    childTableName,
                    tableName,
                    map
                )
            );
        }

        await Promise.all(childPromises);
        return map;
    }

    /**
     * 子テーブル1つを処理し、逆参照マップにマージする
     */
    private async processChildTableAsync(
        childTableName: string,
        parentTableName: string,
        map: ReverseReferenceMap
    ): Promise<void> {
        // スキーマを読み込む
        const schemaText = await readFileAsync(
            `schema/${childTableName}.json`
        );
        const schema = JSON.parse(schemaText);
        if (!schema.header
            || !Array.isArray(schema.header)) {
            return;
        }

        // parentTableName を参照しているFK列を探す
        const fkColumns: Array<{
            columnName: string;
            index: number;
        }> = [];
        for (
            const col of schema.header as Array<{
                name: string;
                reference?: string;
            }>
        ) {
            if (!col.reference) continue;
            const expr =
                parseReferenceExpression(col.reference);
            // 単純参照かつ参照先が parentTableName の場合
            if (isSimpleReference(expr)
                && expr.tableName === parentTableName) {
                fkColumns.push({
                    columnName: col.name,
                    index: -1, // CSVヘッダーで後から解決
                });
            }
        }

        if (fkColumns.length === 0) return;

        // タブで開かれていればインメモリデータを優先、なければCSVファイルから読み込む
        const inMemoryCsv = this.getInMemoryCsv(childTableName);
        let csv: Csv;
        if (inMemoryCsv !== false) {
            csv = inMemoryCsv;
        } else {
            const csvText = await readFileAsync(
                `data/${childTableName}.csv`
            );
            csv = new Csv();
            csv.load(csvText);
        }

        // FK列のインデックスを解決
        for (const fk of fkColumns) {
            fk.index =
                csv.header.indexOf(fk.columnName);
        }

        // 表示列を決定
        // referenceDisplayColumnPriority に該当する列がない
        // テーブルは逆参照ヒントの対象外とする
        const displayColumnIndex =
            this.determineDisplayColumnIndex(
                schema.header, csv.header
            );
        if (displayColumnIndex === -1) return;

        // FK値でグループ化し、表示テキストを収集
        for (const fk of fkColumns) {
            if (fk.index === -1) continue;

            // FK値 → 表示テキスト配列
            const groups =
                new Map<string, string[]>();

            for (const row of csv.body) {
                const fkValue = row[fk.index];
                if (fkValue === ''
                    || fkValue === undefined) {
                    continue;
                }

                const displayText =
                    row[displayColumnIndex] ?? '';

                let list = groups.get(fkValue);
                if (!list) {
                    list = [];
                    groups.set(fkValue, list);
                }
                list.push(displayText);
            }

            // マップにマージ
            groups.forEach(
                (displayTexts, parentPkValue) => {
                    let entries =
                        map.get(parentPkValue);
                    if (!entries) {
                        entries = [];
                        map.set(
                            parentPkValue, entries
                        );
                    }
                    entries.push({
                        childTableName,
                        displayTexts,
                    });
                }
            );
        }
    }

    /**
     * スキーマヘッダーとCSVヘッダーから表示列のインデックスを決定する
     */
    private determineDisplayColumnIndex(
        schemaHeader: Array<{ name: string }>,
        csvHeader: string[]
    ): number {
        const columnNames =
            schemaHeader.map(h => h.name);

        for (
            const priority
            of config.referenceDisplayColumnPriority
        ) {
            if (columnNames.includes(priority)) {
                return csvHeader.indexOf(priority);
            }
        }
        return -1;
    }
}

/**
 * 逆参照マップからセルに表示するヒントテキストを生成する
 *
 * 表示仕様:
 * - 1件: "← 子の表示名"
 * - 2件以上: "← テーブル名(件数)"
 * - 複数テーブル: カンマ区切り
 *
 * @param entries PK値に対応する逆参照エントリ配列
 */
export function formatReverseReferenceHint(
    entries: ReverseReferenceEntry[]
): string {
    const parts: string[] = [];

    for (const entry of entries) {
        const count = entry.displayTexts.length;
        if (count === 1 && entry.displayTexts[0] !== '') {
            // 1件かつ表示テキストがある場合: 表示名を使う
            parts.push(entry.displayTexts[0]);
        } else {
            // 2件以上、または表示テキストが空: テーブル名(件数)
            parts.push(
                `${entry.childTableName}(${count})`
            );
        }
    }

    return parts.join(', ');
}
