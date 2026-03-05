import {Command} from "./command";
import {EditorTable} from "./editor-table";
import {SavedViewRowState} from "./view-row-restructure-command";
import {ViewRowGroupInfo, setViewRowMetadata, getBaseRowIndex, getGroupInfos} from "./model/view-row-metadata";

/**
 * ビュー行挿入コマンド
 *
 * ビュータブでの行挿入を処理する。
 * DOM行の挿入に加えてDOM属性へのメタデータ設定を行う。
 * InMemoryTableStoreへの行追加はLazy Store挿入戦略により、
 * PK列に値が設定された時点でpropagateJoinedColumnToSourceTableが担う。
 *
 * グループ内挿入: 挿入位置の前後の行が同じbaseRowIndexを持つ場合、
 * ベーステーブル列をパディングセルにし、JOIN列のみ編集可能にする。
 * グループ境界挿入: 新しいベース行として挿入する（従来動作）。
 *
 * execute: insertRowInternalでDOM行を作成し、DOM属性にメタデータを設定
 * undo: replaceViewRowsで行を削除
 * redo: replaceViewRowsでDOM行を復元（メタデータはDOM属性で自動復元）
 */
export class InsertViewRowCommand implements Command {
    private readonly editorTable: EditorTable;
    private readonly rowIndex: number;
    private readonly metaIndex: number;
    /** 挿入した行の状態（undo後に保存される） */
    private savedRow: SavedViewRowState | false;
    /** 挿入するグループ情報 */
    private readonly groupInfos: ViewRowGroupInfo[];
    /** グループ内挿入かどうか */
    private readonly isWithinGroup: boolean;
    /** 設定するbaseRowIndex（グループ内: グループのbaseRowIndex、境界: metaIndex） */
    private readonly baseRowIndex: number;

    constructor(editorTable: EditorTable, rowIndex: number) {
        this.editorTable = editorTable;
        this.metaIndex = rowIndex - 1;
        this.rowIndex = rowIndex;
        this.savedRow = false;
        const viewContext = editorTable.getViewContext();
        const joins = viewContext.viewDefinition.joins;
        const tableElement = editorTable.getTableElement();
        // グループ内挿入の判定: 挿入位置の前後の行が同じbaseRowIndexを持つか
        const rowAbove = tableElement.children[rowIndex - 1] as HTMLElement;
        const rowAtInsert = tableElement.children[rowIndex] as HTMLElement;
        const aboveHasMeta = rowAbove && rowAbove.hasAttribute('data-base-row-index');
        const atInsertHasMeta = rowAtInsert && rowAtInsert.hasAttribute('data-base-row-index');
        if (aboveHasMeta && atInsertHasMeta && getBaseRowIndex(rowAbove) === getBaseRowIndex(rowAtInsert)) {
            // グループ内挿入: 前後の行が同じグループに属する
            this.isWithinGroup = true;
            this.baseRowIndex = getBaseRowIndex(rowAbove);
            // グループ情報を隣接行から継承（sourceKeyValue等を保持）
            const neighborGroupInfos = getGroupInfos(rowAbove);
            this.groupInfos = neighborGroupInfos.map(g => ({
                groupPosition: g.groupPosition + 1,
                groupSize: g.groupSize,
                sourceTable: g.sourceTable,
                sourceKeyValue: g.sourceKeyValue,
            }));
        } else {
            // グループ境界挿入: 新しいベース行
            this.isWithinGroup = false;
            this.baseRowIndex = this.metaIndex;
            this.groupInfos = joins.map(j => ({
                groupPosition: 0, groupSize: 1,
                sourceTable: j.targetTable, sourceKeyValue: '',
            }));
        }
    }

    execute(): void {
        // DOM行を作成してテーブルに挿入
        this.editorTable.insertRowInternal(this.rowIndex);
        // 新規行のlastSyncedPkを空文字列で初期化（dataset.lastSyncedPkが常にstring型になる）
        const domRow = this.editorTable.getTableElement().children[this.rowIndex] as HTMLElement;
        domRow.dataset.lastSyncedPk = '';
        // DOM属性にメタデータを設定（DOMがSSOT）
        setViewRowMetadata(domRow, this.baseRowIndex, this.groupInfos);
        if (this.isWithinGroup) {
            // グループ内挿入: ベーステーブル列（joinLevel=0）をパディングセルにする
            const columnMappings = this.editorTable.getViewContext().columnMappings;
            for (let colIdx = 0; colIdx < columnMappings.length; colIdx++) {
                if (columnMappings[colIdx].joinLevel !== 0) continue;
                const cell = domRow.children[colIdx + 1] as HTMLElement;
                cell.classList.add('view-padding-cell');
                cell.textContent = '';
            }
        }
        // ビュー行スタイルを適用
        this.editorTable.view.applyViewRowStylesForRange(this.metaIndex, this.metaIndex + 1, false);
    }

    undo(): void {
        const tableElement = this.editorTable.getTableElement();
        // DOM行をデタッチして保存（redo用）
        const domRow = tableElement.children[this.rowIndex] as HTMLElement;
        this.savedRow = { domRow };
        // replaceViewRowsで1行削除・0行挿入（行番号再設定を含む）
        this.editorTable.view.replaceViewRows(this.metaIndex, 1, []);
    }

    redo(): void {
        if (this.savedRow === false) {
            this.execute();
            return;
        }
        // replaceViewRowsで0行削除・1行挿入（DOM行を復元、メタデータはDOM属性で自動復元）
        this.editorTable.view.replaceViewRows(this.metaIndex, 0, [this.savedRow]);
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
