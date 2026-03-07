import {Command} from "./command";
import {EditorTable} from "./editor-table";
import {SavedViewRowState} from "./view-row-restructure-command";
import {ViewRowGroupInfo, setViewRowMetadata, getBaseRowIndex, getGroupInfos} from "./model/view-row-metadata";
import {findFkColumnIndex, findAllGroupLeadersByFkValue} from "./view-group-query";

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
 * さらに同じFK値を持つ全グループにも同位置に行を挿入する（同期挿入）。
 * グループ境界挿入: 新しいベース行として挿入する（従来動作）。
 *
 * execute: insertRowInternalでDOM行を作成し、DOM属性にメタデータを設定
 * undo: replaceViewRowsで行を削除（主行 + 同期挿入行を全て削除）
 * redo: replaceViewRowsでDOM行を復元（メタデータはDOM属性で自動復元）
 */
export class InsertViewRowCommand implements Command {
    private readonly editorTable: EditorTable;
    /**
     * コンストラクタ時の挿入予定DOMインデックス
     * execute()後に前の兄弟グループが挿入されるとずれるため、
     * actualRowIndexで実際の位置を追跡する
     */
    private readonly rowIndex: number;
    private readonly metaIndex: number;
    /**
     * execute()完了後の主行のDOMインデックス
     * execute()で前方兄弟グループへ同期挿入するとrowIndexからずれるため追跡する。
     * 用途: undo()の兄弟行削除時にfindAllGroupLeadersByFkValueでの主グループ除外に使用。
     * 注意: 兄弟行を全て削除した後の主行位置には使えない（陳腐化するため metaIndex + 1 を使う）。
     */
    private actualRowIndex: number;
    /** 挿入した主行の状態（undo後に保存される） */
    private savedRow: SavedViewRowState | false;
    /**
     * 同一FK値グループへの同期挿入行（undo後に保存される）
     * metaIndexはexecute完了後のDOMでの位置（redo復元に使用）
     * 降順で格納される（後ろのグループ → 前のグループ）
     */
    private savedSiblingRows: Array<{ saved: SavedViewRowState; metaIndex: number }>;
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
        this.actualRowIndex = rowIndex;
        this.savedRow = false;
        this.savedSiblingRows = [];
        const viewContext = editorTable.getViewContext();
        const joins = viewContext.viewDefinition.joins;
        const tableElement = editorTable.getTableElement();
        // グループ内挿入の判定:
        // 1. 前後の行が同じbaseRowIndexを持つ（グループ中間挿入）
        // 2. OR 前行がグループの子行（groupPosition > 0）（グループ末尾挿入）
        //    ← editor-table-view-style.tsのグループリーダー判定の逆パターン
        const rowAbove = tableElement.children[rowIndex - 1] as HTMLElement;
        const rowAtInsert = tableElement.children[rowIndex] as HTMLElement;
        const aboveHasMeta = rowAbove && rowAbove.hasAttribute('data-base-row-index');
        const atInsertHasMeta = rowAtInsert && rowAtInsert.hasAttribute('data-base-row-index');
        const isSameGroup = aboveHasMeta && atInsertHasMeta && getBaseRowIndex(rowAbove) === getBaseRowIndex(rowAtInsert);
        const isAboveChildRow = aboveHasMeta && getGroupInfos(rowAbove).some(g => g.groupPosition > 0);
        if (isSameGroup || isAboveChildRow) {
            // グループ内挿入: グループ中間 or グループ末尾
            this.isWithinGroup = true;
            this.baseRowIndex = getBaseRowIndex(rowAbove);
            // グループ情報を直前行から継承（sourceKeyValue等を保持）
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
        const tableElement = this.editorTable.getTableElement();
        // 新規行のlastSyncedPkを空文字列で初期化（dataset.lastSyncedPkが常にstring型になる）
        const domRow = tableElement.children[this.rowIndex] as HTMLElement;
        domRow.dataset.lastSyncedPk = '';
        // DOM属性にメタデータを設定（DOMがSSOT）
        setViewRowMetadata(domRow, this.baseRowIndex, this.groupInfos);
        const viewContext = this.editorTable.getViewContext();
        const columnMappings = viewContext.columnMappings;
        if (this.isWithinGroup) {
            // グループ内挿入: ベーステーブル列（joinLevel=0）をパディングセルにする
            this.applyPaddingCells(domRow, columnMappings);
            // 主行挿入後、同一FK値を持つ他グループにも同位置に行を同期挿入する
            // 返り値は「前の兄弟グループへの挿入回数」（主行のDOMインデックスがずれる数）
            this.actualRowIndex = this.rowIndex + this.insertIntoSiblingGroups(tableElement, viewContext);
        }
        // ビュー行スタイルを適用
        this.editorTable.view.applyViewRowStylesForRange(this.metaIndex, this.metaIndex + 1, false);
    }

    /**
     * 同一FK値を持つ他グループにも同位置に行を挿入する
     *
     * 主行挿入後にこのメソッドが呼ばれる。主行が this.rowIndex に既に挿入済みなので、
     * リーダー行の検索はその状態のDOMで行う。
     *
     * 挿入順序: 後ろのグループ（DOMインデックスが大きい）から先に挿入する。
     * こうすることで後ろのグループへの挿入が前のグループのインデックスに影響しない。
     *
     * 前の兄弟グループへの挿入: 主行（this.rowIndex）より前にあるグループを挿入すると
     * 主行のDOMインデックスが+1ずれる。その数を返り値として返すことで
     * execute()側でactualRowIndexを更新できる。
     *
     * @returns 主行より前にある兄弟グループへの挿入回数（actualRowIndex補正用）
     */
    private insertIntoSiblingGroups(tableElement: HTMLElement, viewContext: ReturnType<EditorTable['getViewContext']>): number {
        const columnMappings = viewContext.columnMappings;
        // FK値: groupInfos[0].sourceKeyValueに格納されている
        const fkValue = this.groupInfos[0].sourceKeyValue;
        if (fkValue === '') return 0;
        // FK列のDOMインデックスを解決する（joinLevel=0のFK元列のデータインデックス + 1）
        const fkColumnDataIndex = findFkColumnIndex(viewContext.viewDefinition, columnMappings, this.groupInfos[0].sourceTable);
        if (fkColumnDataIndex === -1) return 0;
        const fkDomColumn = fkColumnDataIndex + 1;
        // 主行挿入後のリーダー行DOMインデックスを取得
        // 主行はthis.rowIndexに挿入済みなので、groupPositionだけ上に遡るとリーダー行がある
        const groupPosition = this.groupInfos[0].groupPosition;
        const mainLeaderDomRow = this.rowIndex - groupPosition;
        // 同一FK値を持つ他グループのリーダー行を昇順で取得（主グループは除外）
        const siblingLeaderDomRows = findAllGroupLeadersByFkValue(tableElement, fkDomColumn, fkValue, mainLeaderDomRow);
        let insertedBeforeMain = 0;
        // DOMインデックスのずれを防ぐため降順（後ろ→前）で挿入する
        for (let i = siblingLeaderDomRows.length - 1; i >= 0; i--) {
            const leaderDomRow = siblingLeaderDomRows[i];
            const insertDomIndex = leaderDomRow + groupPosition;
            // 兄弟グループのベース行インデックスをリーダー行から取得
            const leaderElement = tableElement.children[leaderDomRow] as HTMLElement;
            const siblingBaseRowIndex = getBaseRowIndex(leaderElement);
            this.editorTable.insertRowInternal(insertDomIndex);
            const newDomRow = tableElement.children[insertDomIndex] as HTMLElement;
            newDomRow.dataset.lastSyncedPk = '';
            // グループ情報は主行と同じgroupPositionで、baseRowIndexは兄弟グループのもの
            const siblingGroupInfos: ViewRowGroupInfo[] = this.groupInfos.map(g => ({ ...g }));
            setViewRowMetadata(newDomRow, siblingBaseRowIndex, siblingGroupInfos);
            this.applyPaddingCells(newDomRow, columnMappings);
            const siblingMetaIndex = insertDomIndex - 1;
            this.editorTable.view.applyViewRowStylesForRange(siblingMetaIndex, siblingMetaIndex + 1, false);
            // 主行より前に挿入した場合、主行のDOMインデックスがずれるのでカウント
            if (insertDomIndex <= this.rowIndex) insertedBeforeMain++;
        }
        return insertedBeforeMain;
    }

    /**
     * DOM行のベーステーブル列（joinLevel=0）をパディングセルにする
     */
    private applyPaddingCells(domRow: HTMLElement, columnMappings: ReturnType<EditorTable['getViewContext']>['columnMappings']): void {
        for (let colIdx = 0; colIdx < columnMappings.length; colIdx++) {
            if (columnMappings[colIdx].joinLevel !== 0) continue;
            const cell = domRow.children[colIdx + 1] as HTMLElement;
            cell.classList.add('view-padding-cell');
            cell.textContent = '';
        }
    }

    undo(): void {
        const tableElement = this.editorTable.getTableElement();
        this.savedSiblingRows = [];
        if (this.isWithinGroup) {
            // 同期挿入行を特定して削除する
            // 後ろのグループから削除するとDOMインデックスのずれが起きないため、
            // findAllGroupLeadersByFkValueが返す昇順リストを降順で処理する
            const viewContext = this.editorTable.getViewContext();
            const fkValue = this.groupInfos[0].sourceKeyValue;
            if (fkValue !== '') {
                const fkColumnDataIndex = findFkColumnIndex(viewContext.viewDefinition, viewContext.columnMappings, this.groupInfos[0].sourceTable);
                if (fkColumnDataIndex !== -1) {
                    const fkDomColumn = fkColumnDataIndex + 1;
                    const groupPosition = this.groupInfos[0].groupPosition;
                    // undo()開始時点のDOMはexecute()完了直後と同一の形状なのでactualRowIndexは有効。
                    // ただし兄弟行を削除するとDOMが変化するため、削除後の主行キャプチャにはmetaIndex + 1を使う。
                    const mainLeaderDomRow = this.actualRowIndex - groupPosition;
                    const siblingLeaderDomRows = findAllGroupLeadersByFkValue(tableElement, fkDomColumn, fkValue, mainLeaderDomRow);
                    // 降順で削除（後ろのグループから）
                    for (let i = siblingLeaderDomRows.length - 1; i >= 0; i--) {
                        const leaderDomRow = siblingLeaderDomRows[i];
                        const insertedDomIndex = leaderDomRow + groupPosition;
                        const insertedRow = tableElement.children[insertedDomIndex] as HTMLElement;
                        const siblingMetaIndex = insertedDomIndex - 1;
                        // DOM行をデタッチして保存（redo復元用）
                        this.savedSiblingRows.push({ saved: { domRow: insertedRow }, metaIndex: siblingMetaIndex });
                        this.editorTable.view.replaceViewRows(siblingMetaIndex, 1, []);
                    }
                }
            }
        }
        // 主行をデタッチして保存（redo用）
        // DOMをSSOTとし、actualRowIndexに依存しない動的な位置特定を行う。
        // 兄弟行を全て削除した後のDOMでは、主行は元のrowIndex（= metaIndex + 1）の位置に戻っている。
        // actualRowIndexはexecute()後に前方の兄弟グループ挿入でずれているため、
        // 前方兄弟を降順の後半（最後に）削除した時点でactualRowIndexは陳腐化している。
        const domRow = tableElement.children[this.metaIndex + 1] as HTMLElement;
        this.savedRow = { domRow };
        // replaceViewRowsで1行削除・0行挿入（行番号再設定を含む）
        this.editorTable.view.replaceViewRows(this.metaIndex, 1, []);
    }

    redo(): void {
        if (this.savedRow === false) {
            this.execute();
            return;
        }
        // 主行を復元する（metaIndex=this.metaIndexの位置）
        this.editorTable.view.replaceViewRows(this.metaIndex, 0, [this.savedRow]);
        // 同期挿入行を復元する
        // savedSiblingRowsはundo時に降順削除（後ろのグループ→前のグループ）で格納されている
        // redo時は昇順（前のグループ→後ろのグループ）で復元する
        // savedSiblingRowsのmetaIndexは「execute完了後のDOMでのSS新行の位置」であり、
        // 主行復元後のDOMも同じ形状になるため補正は不要
        for (let i = this.savedSiblingRows.length - 1; i >= 0; i--) {
            const sibling = this.savedSiblingRows[i];
            this.editorTable.view.replaceViewRows(sibling.metaIndex, 0, [sibling.saved]);
        }
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
