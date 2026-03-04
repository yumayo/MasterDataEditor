import {Command} from "./command";
import {EditorTable} from "./editor-table";
import {SavedViewRowState} from "./view-row-restructure-command";
import {InMemoryTableStore} from "./in-memory-table-store";
import {config} from "./config";

/**
 * InMemoryTableStoreから削除された行の復元情報
 */
interface DeletedStoreRow {
    tableName: string;
    pkValue: string;
    rowData: string[];
    rowIndex: number;
}

/**
 * ビュー行削除コマンド
 *
 * ビュータブでの行削除を処理する。通常テーブルの行削除とは異なり、
 * DOM行の削除に加えてInMemoryTableStoreからの対応行削除を行う。
 * メタデータはDOM属性(data-base-row-index, data-group-infos)として保持される。
 *
 * - パディング行の削除: 結合テーブルの該当レコード1件を削除
 * - リーダー行の削除: ベーステーブルの1行と結合テーブルの対応レコードを削除
 *
 * replaceViewRowsを利用してDOM行を一括管理する。
 */
export class DeleteViewRowCommand implements Command {
    private readonly editorTable: EditorTable;
    private readonly metaIndex: number;
    private readonly store: InMemoryTableStore;
    /** 削除された行の状態（DOM要素）。execute後に設定される */
    private savedRow: SavedViewRowState | false;
    /** InMemoryTableStoreから削除された行データ（Undo復元用） */
    private deletedStoreRows: DeletedStoreRow[];

    constructor(editorTable: EditorTable, rowIndex: number) {
        this.editorTable = editorTable;
        // DOM行インデックスからメタデータインデックスへ変換（ヘッダー行分を引く）
        this.metaIndex = rowIndex - 1;
        this.store = editorTable.getStore();
        this.savedRow = false;
        this.deletedStoreRows = [];
    }

    execute(): void {
        const viewContext = this.editorTable.getViewContext();
        const tableElement = this.editorTable.getTableElement();
        const domIndex = this.metaIndex + 1;
        // DOM行をデタッチして保存（DOM属性にメタデータが保持されるためdomRowのみで十分）
        const domRow = tableElement.children[domIndex] as HTMLElement;
        this.savedRow = { domRow };
        // replaceViewRowsで1行削除・0行挿入（行番号再設定を含む）
        this.editorTable.replaceViewRows(this.metaIndex, 1, []);
        // InMemoryTableStoreから対応する行を削除
        // 各テーブルのPK列を探してPK値を取得し、Storeから該当行を削除する
        this.deletedStoreRows = [];
        const columnMappings = viewContext.columnMappings;
        const deletedTables = new Set<string>();
        for (let colIdx = 0; colIdx < columnMappings.length; ++colIdx) {
            const mapping = columnMappings[colIdx];
            if (deletedTables.has(mapping.tableName)) continue;
            // パディングセルはデータがないのでスキップ（DOMのCSSクラスで判定）
            const cell = domRow.children[colIdx + 1] as HTMLElement;
            if (cell.classList.contains('view-padding-cell')) continue;
            // PK列以外はスキップ
            if (mapping.sourceColumnName !== config.primaryKeyColumnName) continue;
            // DOM行からPK値を取得
            const pkValue = EditorTable.getCellValue(cell);
            if (pkValue === '') continue;
            const result = this.store.removeRowByPk(mapping.tableName, pkValue);
            if (result !== false) {
                this.deletedStoreRows.push({
                    tableName: mapping.tableName, pkValue,
                    rowData: result.rowData, rowIndex: result.rowIndex,
                });
            }
            deletedTables.add(mapping.tableName);
        }
    }

    undo(): void {
        if (this.savedRow === false) return;
        // InMemoryTableStoreに行を復元（削除の逆順で挿入して元の位置に戻す）
        for (let i = this.deletedStoreRows.length - 1; i >= 0; --i) {
            const deleted = this.deletedStoreRows[i];
            this.store.insertRowAt(deleted.tableName, deleted.rowIndex, deleted.rowData);
        }
        // replaceViewRowsで0行削除・1行挿入（DOM行を復元、メタデータはDOM属性で自動復元）
        this.editorTable.replaceViewRows(this.metaIndex, 0, [this.savedRow]);
    }

    redo(): void {
        this.execute();
    }

    getDescription(): string {
        return `DeleteViewRow at meta[${this.metaIndex}]`;
    }
}

/**
 * ビュー複数行削除コマンド
 *
 * 複数のDeleteViewRowCommandをまとめて実行する。
 * 下から上へ削除してインデックスのずれを防止する。
 */
export class DeleteViewRowsCommand implements Command {
    private readonly deleteCommands: DeleteViewRowCommand[];

    constructor(editorTable: EditorTable, startRowIndex: number, count: number) {
        this.deleteCommands = [];
        // 下から上へ削除するためのコマンドを事前作成
        for (let i = count - 1; i >= 0; --i) {
            this.deleteCommands.push(new DeleteViewRowCommand(editorTable, startRowIndex + i));
        }
    }

    execute(): void {
        for (const cmd of this.deleteCommands) {
            cmd.execute();
        }
    }

    undo(): void {
        // 逆順でundo（上から下へ復元）
        for (let i = this.deleteCommands.length - 1; i >= 0; --i) {
            this.deleteCommands[i].undo();
        }
    }

    redo(): void {
        this.execute();
    }

    getDescription(): string {
        return `DeleteViewRows: ${this.deleteCommands.length} rows`;
    }
}
