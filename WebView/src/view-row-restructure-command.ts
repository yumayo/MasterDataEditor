import {Command} from "./command";
import {EditorTable} from "./editor-table";
import {ViewRowMetadata} from "./model/view-row-metadata";

/**
 * 保存されたビュー行の状態（Undo/Redo用）
 * DOM要素とメタデータをペアで保持する
 */
export interface SavedViewRowState {
    /** DOM行要素（デタッチされた状態で保持） */
    domRow: HTMLElement;
    /** 行のメタデータ */
    metadata: ViewRowMetadata;
}

/**
 * ビュー行の再構築コマンド
 *
 * FK値変更時に展開行数が変わった場合に使用される。
 * 古い展開行と新しい展開行をDOM要素ごと保存し、
 * execute/undo/redoで入れ替えることで完全な状態復元を実現する。
 */
export class ViewRowRestructureCommand implements Command {
    private readonly editorTable: EditorTable;
    private readonly oldRows: SavedViewRowState[];
    private readonly newRows: SavedViewRowState[];
    private readonly metaStartIndex: number;

    constructor(
        editorTable: EditorTable, oldRows: SavedViewRowState[],
        newRows: SavedViewRowState[], metaStartIndex: number
    ) {
        this.editorTable = editorTable;
        this.oldRows = oldRows;
        this.newRows = newRows;
        this.metaStartIndex = metaStartIndex;
    }

    execute(): void {
        this.editorTable.replaceViewRows(this.metaStartIndex, this.oldRows.length, this.newRows);
    }

    undo(): void {
        this.editorTable.replaceViewRows(this.metaStartIndex, this.newRows.length, this.oldRows);
    }

    redo(): void {
        this.execute();
    }

    getDescription(): string {
        return `ViewRowRestructure: ${this.oldRows.length} -> ${this.newRows.length} rows at meta[${this.metaStartIndex}]`;
    }
}
