import {Command} from "./command";
import {EditorTable} from "./editor-table";
import {SavedViewRowState} from "./view-row-restructure-command";
import {ViewRowMetadata, ViewRowGroupInfo} from "./model/view-row-metadata";

/**
 * ビュー行挿入コマンド
 *
 * ビュータブでの行挿入を処理する。
 * DOM行の挿入に加えてrowMetadataの同期更新を行う。
 * InMemoryTableStoreへの行追加はLazy Store挿入戦略により、
 * PK列に値が設定された時点でpropagateJoinedColumnToSourceTableが担う。
 *
 * execute: insertRowInternalでDOM行を作成し、rowMetadataに挿入
 * undo: replaceViewRowsで行とmetadataを削除
 * redo: replaceViewRowsで行とmetadataを復元
 */
export class InsertViewRowCommand implements Command {
    private readonly editorTable: EditorTable;
    private readonly rowIndex: number;
    private readonly metaIndex: number;
    /** 挿入した行の状態（undo後に保存される） */
    private savedRow: SavedViewRowState | false;
    /** 挿入するメタデータ */
    private readonly metadata: ViewRowMetadata;

    constructor(editorTable: EditorTable, rowIndex: number) {
        this.editorTable = editorTable;
        // DOM行インデックスからメタデータインデックスへ変換（ヘッダー行分を引く）
        this.metaIndex = rowIndex - 1;
        this.rowIndex = rowIndex;
        this.savedRow = false;
        // 新規行のメタデータを構築
        const viewContext = editorTable.getViewContext();
        const joins = viewContext.viewDefinition.joins;
        const columnCount = viewContext.columnMappings.length;
        const groupInfos: ViewRowGroupInfo[] = joins.map(j => ({
            groupPosition: 0, groupSize: 1,
            sourceTable: j.targetTable, sourceKeyValue: '',
        }));
        this.metadata = {
            baseRowIndex: this.metaIndex,
            groupInfos,
            paddingColumns: new Array(columnCount).fill(false),
        };
    }

    execute(): void {
        // DOM行を作成してテーブルに挿入
        this.editorTable.insertRowInternal(this.rowIndex);
        // 新規行のlastSyncedPkを空文字列で初期化（dataset.lastSyncedPkが常にstring型になる）
        const domRow = this.editorTable.getTableElement().children[this.rowIndex] as HTMLElement;
        domRow.dataset.lastSyncedPk = '';
        // rowMetadataにメタデータを挿入
        const viewContext = this.editorTable.getViewContext();
        viewContext.rowMetadata.splice(this.metaIndex, 0, this.metadata);
        // ビュー行スタイルを適用（パディング指定なし: 新規行は全列が非パディング）
        this.editorTable.applyViewRowStylesForRange(this.metaIndex, this.metaIndex + 1, false);
    }

    undo(): void {
        const viewContext = this.editorTable.getViewContext();
        const tableElement = this.editorTable.getTableElement();
        // DOM行をデタッチして保存（redo用）
        const domRow = tableElement.children[this.rowIndex] as HTMLElement;
        this.savedRow = { domRow, metadata: viewContext.rowMetadata[this.metaIndex] };
        // replaceViewRowsで1行削除・0行挿入（rowMetadata同期・行番号再設定を含む）
        this.editorTable.replaceViewRows(this.metaIndex, 1, []);
    }

    redo(): void {
        if (this.savedRow === false) {
            this.execute();
            return;
        }
        // replaceViewRowsで0行削除・1行挿入（DOM行とrowMetadataを復元）
        this.editorTable.replaceViewRows(this.metaIndex, 0, [this.savedRow]);
    }

    getDescription(): string {
        return `InsertViewRow at meta[${this.metaIndex}]`;
    }
}

/**
 * ビュー複数行挿入コマンド
 *
 * 複数のInsertViewRowCommandをまとめて実行する。
 * 上から下へ挿入してインデックスのずれを防止する。
 */
export class InsertViewRowsCommand implements Command {
    private readonly insertCommands: InsertViewRowCommand[];

    constructor(editorTable: EditorTable, startRowIndex: number, count: number) {
        this.insertCommands = [];
        // 上から下へ挿入するためのコマンドを事前作成
        for (let i = 0; i < count; ++i) {
            this.insertCommands.push(new InsertViewRowCommand(editorTable, startRowIndex));
        }
    }

    execute(): void {
        for (const cmd of this.insertCommands) {
            cmd.execute();
        }
    }

    undo(): void {
        // 逆順でundo（下から上へ削除）
        for (let i = this.insertCommands.length - 1; i >= 0; --i) {
            this.insertCommands[i].undo();
        }
    }

    redo(): void {
        for (const cmd of this.insertCommands) {
            cmd.redo();
        }
    }

    getDescription(): string {
        return `InsertViewRows: ${this.insertCommands.length} rows`;
    }
}
