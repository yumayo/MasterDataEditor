import {EditorTable} from "./editor-table";
import {Selection} from "./selection";
import {History} from "./history";
import {MoveRowCommand} from "./command";

/**
 * 行ドラッグ移動コントローラー
 *
 * 責務:
 * - 行ヘッダーの mousedown から5px以上のドラッグを検出する
 * - ドラッグ中はインジケーター（水平線）で挿入先を表示する
 * - mouseup で MoveRowCommand を実行して行を移動する
 *
 * インジケーターは position:fixed で body に追加する。
 * これにより wrapperElement の position:relative やスクロールコンテナの座標系に依存しない。
 * getBoundingClientRect() がビューポート座標を返すため、そのまま top に設定できる。
 *
 * ライフサイクル:
 * - EditorTable の initializeModules() で生成される
 * - 行ヘッダー生成時に onRowHeaderMouseDown() が mousedown リスナーから呼ばれる
 * - document レベルの mousemove/mouseup リスナーはドラッグ開始〜終了の間だけ有効
 */
export class RowDragController {
    private readonly table: EditorTable;
    private readonly selection: Selection;
    private readonly history: History;
    /** ドラッグ開始の閾値（px） */
    private static readonly DRAG_THRESHOLD = 5;
    /** ドラッグ中かどうか */
    private isDragging: boolean;
    /** mousedown 時点のY座標（閾値判定用） */
    private startY: number;
    /** ドラッグ元のDOMデータ行インデックス（0始まり） */
    private fromDomDataRowIndex: number;
    /** ドラッグ候補（mousedown後、閾値到達前の状態） */
    private isPending: boolean;
    /** インジケーター要素（position:fixed でbodyに追加、ドラッグ中のみ表示） */
    private readonly indicator: HTMLElement;
    /** 現在のインジケーター位置（DOMデータ行インデックス、fromを抜いた後のインデックス） */
    private currentInsertIndex: number;
    /** document.mousemove ハンドラ */
    private readonly onMouseMove: (e: MouseEvent) => void;
    /** document.mouseup ハンドラ */
    private readonly onMouseUp: () => void;

    constructor(table: EditorTable, selection: Selection, history: History) {
        this.table = table;
        this.selection = selection;
        this.history = history;
        this.isDragging = false;
        this.isPending = false;
        this.startY = 0;
        this.fromDomDataRowIndex = 0;
        this.currentInsertIndex = 0;
        // インジケーター要素を生成（position:fixed で body に追加し、非表示で待機）
        this.indicator = document.createElement('div');
        this.indicator.classList.add('row-drag-indicator');
        this.indicator.style.display = 'none';
        document.body.appendChild(this.indicator);
        // document レベルのイベントハンドラをバインド
        this.onMouseMove = (e: MouseEvent) => this.handleMouseMove(e.clientY);
        this.onMouseUp = () => this.handleMouseUp();
    }

    /**
     * 旧インスタンス破棄時にインジケーター要素をDOMから除去する。
     * initializeModules() で再作成される際に呼ばれる。
     */
    destroy(): void {
        this.indicator.remove();
    }

    /**
     * 行ヘッダーの mousedown から呼ばれる。
     * ドラッグ候補状態にして、document レベルの mousemove/mouseup を登録する。
     */
    onRowHeaderMouseDown(domDataRowIndex: number, startY: number): void {
        this.fromDomDataRowIndex = domDataRowIndex;
        this.startY = startY;
        this.isPending = true;
        this.isDragging = false;
        document.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('mouseup', this.onMouseUp);
    }

    /**
     * document.mousemove ハンドラ。
     * 閾値を超えたらドラッグ開始し、インジケーターを表示・更新する。
     */
    private handleMouseMove(clientY: number): void {
        if (this.isPending) {
            // 閾値判定
            if (Math.abs(clientY - this.startY) < RowDragController.DRAG_THRESHOLD) return;
            // ドラッグ開始
            this.isPending = false;
            this.isDragging = true;
            this.indicator.style.display = '';
            document.body.style.cursor = 'grabbing';
        }
        if (!this.isDragging) return;
        // マウス位置から挿入先インデックスを計算してインジケーターを配置する
        this.updateIndicatorPosition(clientY);
    }

    /**
     * document.mouseup ハンドラ。
     * ドラッグ中であれば MoveRowCommand を実行して行を移動する。
     */
    private handleMouseUp(): void {
        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('mouseup', this.onMouseUp);
        document.body.style.cursor = '';
        this.indicator.style.display = 'none';
        if (this.isDragging) {
            this.isDragging = false;
            const from = this.fromDomDataRowIndex;
            const to = this.currentInsertIndex;
            // from と to が等しい場合は移動なし（同じ位置への移動）
            if (from !== to) {
                const command = new MoveRowCommand(this.table, from, to);
                const copyRange = this.selection.getCopyRange();
                const anchor = this.selection.getAnchor();
                this.history.executeCommand(command, {startRow: anchor.row, startColumn: anchor.column, endRow: anchor.row, endColumn: anchor.column}, copyRange);
            }
        }
        this.isPending = false;
    }

    /**
     * マウスY座標から挿入先インデックスを計算し、インジケーターを配置する。
     *
     * インジケーターは position:fixed なので、ビューポート座標をそのまま top に設定する。
     * left/right はテーブル要素の水平範囲と一致させる。
     */
    private updateIndicatorPosition(clientY: number): void {
        const tableElement = this.table.getTableElement();
        const storeRowCount = this.table.getStoreRowIndices().length;
        // テーブル要素の水平範囲をインジケーターに適用する
        const tableRect = tableElement.getBoundingClientRect();
        this.indicator.style.left = tableRect.left + 'px';
        this.indicator.style.width = tableRect.width + 'px';
        // 各行の矩形を走査して、マウス位置に最も近い行間を特定する
        // 行のDOM要素は children[1] 〜 children[storeRowCount]（列ヘッダーが [0]）
        let insertIndex = 0;
        for (let i = 0; i < storeRowCount; i++) {
            const rowElement = tableElement.children[i + 1] as HTMLElement;
            const rect = rowElement.getBoundingClientRect();
            const rowMidY = rect.top + rect.height / 2;
            if (clientY > rowMidY) {
                insertIndex = i + 1;
            }
        }
        // fromを抜いた後のインデックスに変換する
        if (insertIndex > this.fromDomDataRowIndex) {
            this.currentInsertIndex = insertIndex - 1;
        } else {
            this.currentInsertIndex = insertIndex;
        }
        // インジケーターの top 位置をビューポート座標で設定する
        let indicatorTop: number;
        if (insertIndex < storeRowCount) {
            const targetRow = tableElement.children[insertIndex + 1] as HTMLElement;
            const targetRect = targetRow.getBoundingClientRect();
            indicatorTop = targetRect.top;
        } else {
            // 最終行の下端
            const lastRow = tableElement.children[storeRowCount] as HTMLElement;
            const lastRect = lastRow.getBoundingClientRect();
            indicatorTop = lastRect.bottom;
        }
        this.indicator.style.top = indicatorTop + 'px';
    }
}
