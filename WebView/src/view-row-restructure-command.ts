import {Command} from "./command";
import {EditorTable} from "./editor-table";
import {ViewRowMetadata, ViewRowGroupInfo} from "./model/view-row-metadata";

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
 *
 * MetadataExpansionCommandによるダミーメタデータ拡張後は、
 * domStartIndex = metaStartIndex + 1 の前提が常に成立するため、
 * DOM位置はreplaceViewRows内部で計算する。
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

/**
 * メタデータ範囲外へのペースト時に、ペースト先行のダミーメタデータを事前追加するコマンド
 *
 * FK再構築（restructureNewBaseRow）がメタデータ配列長を超えた位置にspliceすると
 * DOM位置とメタデータ位置が一致しなくなる問題を防ぐ。
 * ペースト先の最大行までダミーメタデータを追加し、FK再構築が通常のメタデータ範囲内処理で
 * 正しく動作できるようにする。
 *
 * execute: ダミーメタデータをrowMetadata末尾に追加
 * undo: 追加分を切り詰めて元の長さに戻す
 */
export class MetadataExpansionCommand implements Command {
    private readonly editorTable: EditorTable;
    /** 拡張前のメタデータ配列長 */
    private readonly originalLength: number;
    /** 追加するダミーメタデータの配列 */
    private readonly dummyMetadata: ViewRowMetadata[];

    constructor(editorTable: EditorTable, originalLength: number, dummyMetadata: ViewRowMetadata[]) {
        this.editorTable = editorTable;
        this.originalLength = originalLength;
        this.dummyMetadata = dummyMetadata;
    }

    execute(): void {
        const viewContext = this.editorTable.getViewContext();
        viewContext.rowMetadata.push(...this.dummyMetadata);
    }

    undo(): void {
        const viewContext = this.editorTable.getViewContext();
        viewContext.rowMetadata.length = this.originalLength;
    }

    redo(): void {
        this.execute();
    }

    getDescription(): string {
        return `MetadataExpansion: +${this.dummyMetadata.length} entries (original: ${this.originalLength})`;
    }
}

/**
 * ペースト先のメタデータ範囲外行にダミーメタデータを生成する
 *
 * @param editorTable エディタテーブル
 * @param maxDestRow ペースト先の最大DOM行インデックス（1始まり）。DOM行インデックスNの行はメタデータインデックスN-1に対応し、メタデータ配列はN個必要
 * @returns MetadataExpansionCommand、拡張不要な場合はfalse
 */
export function createMetadataExpansionCommand(
    editorTable: EditorTable, maxDestRow: number
): MetadataExpansionCommand | false {
    const viewContext = editorTable.getViewContext();
    const currentLength = viewContext.rowMetadata.length;
    const requiredLength = maxDestRow; // DOM行N → メタデータインデックスN-1、N行目まで必要なのでN個
    if (requiredLength <= currentLength) return false;
    const columnCount = viewContext.columnMappings.length;
    const joins = viewContext.viewDefinition.joins;
    const dummyMetadata: ViewRowMetadata[] = [];
    for (let i = currentLength; i < requiredLength; i++) {
        const groupInfos: ViewRowGroupInfo[] = joins.map(j => ({
            groupPosition: 0, groupSize: 1,
            sourceTable: j.targetTable, sourceKeyValue: '',
        }));
        dummyMetadata.push({
            baseRowIndex: i,
            groupInfos,
            paddingColumns: new Array(columnCount).fill(false),
        });
    }
    return new MetadataExpansionCommand(editorTable, currentLength, dummyMetadata);
}
