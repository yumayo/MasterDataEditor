import {EditorTable} from "./editor-table";
import {Selection} from "./selection";
import {History} from "./history";
import {MoveRowCommand} from "./command";

/** 行ヘッダードラッグの操作モード */
type RowDragMode = 'move' | 'select';

/**
 * 行ドラッグコントローラー
 *
 * 責務:
 * - 選択済み行ヘッダーのドラッグ → 行移動（5px閾値、インジケーター表示）
 * - 未選択行ヘッダーのドラッグ → 複数行選択（通過した行を選択範囲に追加）
 * - 選択済み行ヘッダーのクリック（5px未満でmouseup）→ その行のみ選択
 *
 * mousedown 時に対象行が選択済みか（.selected クラス）を確認してモードを決定する。
 * このハンドラは createRowHeaderClickHandler より先に登録されるため、
 * selectRow() で .selected が付与される前の状態を正確に判定できる。
 * moveモードでは stopImmediatePropagation で後続の selectRow を抑制し、
 * 複数行選択を維持したままドラッグ移動を可能にする。
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
    /** ドラッグ中かどうか（moveモードでのみ使用） */
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
    /** mousedown時に決定される操作モード（選択済み行ならmove、未選択行ならselect） */
    private mode: RowDragMode;
    /** selectモードで選択ドラッグを開始済みかどうか */
    private isSelectionDragging: boolean;

    constructor(table: EditorTable, selection: Selection, history: History) {
        this.table = table;
        this.selection = selection;
        this.history = history;
        this.isDragging = false;
        this.isPending = false;
        this.startY = 0;
        this.fromDomDataRowIndex = 0;
        this.currentInsertIndex = 0;
        this.mode = 'move';
        this.isSelectionDragging = false;
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
     * 対象行が選択済みかを判定し、moveモードまたはselectモードでドラッグを開始する。
     *
     * - 選択済み行 → moveモード: stopImmediatePropagation で後続の selectRow を抑制する。
     *   mouseup時に5px未満ならクリックとして扱い selectRow を呼ぶ。
     * - 未選択行 → selectモード: 後続の createRowHeaderClickHandler が selectRow を呼ぶ。
     *   ドラッグで通過した行を選択範囲に追加する。
     */
    onRowHeaderMouseDown(domDataRowIndex: number, startY: number, rowHeaderElement: HTMLElement, event: MouseEvent): void {
        const isSelected = rowHeaderElement.classList.contains('selected');
        // 末尾の入力待機用バッファ行はストアに存在しないため、移動対象にしない。
        const isMovableRow = domDataRowIndex >= 0 && domDataRowIndex < this.table.getStoreRowIndices().length;
        this.mode = isSelected && isMovableRow ? 'move' : 'select';
        this.fromDomDataRowIndex = domDataRowIndex;
        // 前回のドラッグ位置を引き継がない。挿入位置を計算できない場合も
        // mouseup で別の位置へ移動しないよう、移動元で初期化する。
        this.currentInsertIndex = domDataRowIndex;
        this.startY = startY;
        this.isPending = true;
        this.isDragging = false;
        this.isSelectionDragging = false;
        if (this.mode === 'move') {
            // moveモード: 後続の createRowHeaderClickHandler（selectRow）を抑制する。
            // mousedown時点では複数行選択を維持し、mouseup時にクリック判定する。
            // submitAndHide はセル編集の確定のため呼ぶ
            this.table.getHandler().submitAndHide();
            event.stopImmediatePropagation();
        }
        document.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('mouseup', this.onMouseUp);
    }

    /**
     * document.mousemove ハンドラ。
     * moveモード: 閾値を超えたらドラッグ開始し、インジケーターを表示・更新する。
     * selectモード: 閾値を超えたら行選択ドラッグを開始し、通過する行を選択範囲に追加する。
     */
    private handleMouseMove(clientY: number): void {
        if (this.isPending) {
            // 閾値判定
            if (Math.abs(clientY - this.startY) < RowDragController.DRAG_THRESHOLD) return;
            this.isPending = false;
            if (this.mode === 'move') {
                // moveモード: ドラッグ開始
                this.isDragging = true;
                this.indicator.style.display = '';
                document.body.style.cursor = 'grabbing';
            } else {
                // selectモード: 選択ドラッグ開始（selectRowはmousedownのclickHandlerで既に呼ばれている）
                this.isSelectionDragging = true;
            }
        }
        if (this.mode === 'move') {
            if (!this.isDragging) return;
            // マウス位置から挿入先インデックスを計算してインジケーターを配置する
            this.updateIndicatorPosition(clientY);
        } else {
            if (!this.isSelectionDragging) return;
            // マウス位置から行インデックスを算出して選択範囲を拡張する
            // updateRow は Selection の行番号体系（1始まり）を使うため +1 する
            const rowIndex = this.getRowIndexFromClientY(clientY);
            this.selection.updateRow(rowIndex + 1);
        }
    }

    /**
     * document.mouseup ハンドラ。
     * moveモード + ドラッグ中: MoveRowCommand を実行して行を移動する。
     * moveモード + ドラッグ未開始（5px未満クリック）: selectRow でその行のみ選択する。
     * selectモード: 選択を確定する（行移動は実行しない）。
     */
    private handleMouseUp(): void {
        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('mouseup', this.onMouseUp);
        document.body.style.cursor = '';
        this.indicator.style.display = 'none';
        if (this.mode === 'move') {
            if (this.isDragging) {
                // moveモード: ドラッグ完了 → 行移動を実行する
                this.isDragging = false;
                const from = this.fromDomDataRowIndex;
                const to = this.currentInsertIndex;
                const storeRowCount = this.table.getStoreRowIndices().length;
                const isValidMove =
                    from >= 0 && from < storeRowCount &&
                    to >= 0 && to < storeRowCount &&
                    from !== to;
                // 同じ位置への移動や、バッファ行などストア範囲外の移動は履歴に積まない。
                if (isValidMove) {
                    const command = new MoveRowCommand(this.table, from, to);
                    const copyRange = this.selection.getCopyRange();
                    const anchor = this.selection.getAnchor();
                    this.history.executeCommand(command, {startRow: anchor.row, startColumn: anchor.column, endRow: anchor.row, endColumn: anchor.column}, copyRange);
                    // 移動後は移動先の行を選択状態にする（to は fromを抜いた後の0始まりインデックス）
                    this.selection.selectRow(to + 1);
                }
            } else if (this.isPending) {
                // moveモード + 5px未満: クリック操作として扱い、その行のみを選択する
                // （mousedown時に stopImmediatePropagation で selectRow を抑制していたため、ここで呼ぶ）
                // domDataRowIndex は0始まり、Selection の行番号は1始まり
                this.selection.selectRow(this.fromDomDataRowIndex + 1);
                this.selection.end();
            }
        } else {
            // selectモード: 選択ドラッグを終了する（Selection.end() で selecting フラグを落とす）
            this.selection.end();
            this.isSelectionDragging = false;
        }
        this.isPending = false;
    }

    /**
     * マウスY座標からDOMデータ行インデックス（0始まり）を算出する。
     * テーブル範囲外の場合は最も近い端の行を返す。
     * storeRowCount === 0 の場合は行ヘッダーが存在しないためドラッグ自体が発生し得ない。
     */
    private getRowIndexFromClientY(clientY: number): number {
        const storeRowCount = this.table.getStoreRowIndices().length;
        if (storeRowCount === 0) throw new Error('行が存在しないテーブルではドラッグ操作は発生し得ない');
        const renderedRows = this.getRenderedStoreRows(storeRowCount);
        if (renderedRows.length === 0) throw new Error('ドラッグ対象の描画済み行が存在しません');

        // 各行の矩形を走査し、マウス位置を含む行を返す。
        // 行間やテーブル範囲外では、画面上で最も近い描画済み行を選ぶ。
        let nearestRowIndex = renderedRows[0].rowIndex;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const renderedRow of renderedRows) {
            const rect = renderedRow.element.getBoundingClientRect();
            if (clientY >= rect.top && clientY < rect.bottom) return renderedRow.rowIndex;
            const distance = clientY < rect.top ? rect.top - clientY : clientY - rect.bottom;
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestRowIndex = renderedRow.rowIndex;
            }
        }
        return nearestRowIndex;
    }

    /**
     * 現在DOMに描画されている実データ行と、その論理行インデックスを返す。
     *
     * 仮想スクロール中は全ストア行の一部しかDOMに存在しないため、
     * childrenの相対位置ではなく data-row-index を正準の行番号として使う。
     * 末尾のバッファ行は storeRowCount と同じインデックスを持つため除外する。
     */
    private getRenderedStoreRows(storeRowCount: number): Array<{element: HTMLElement; rowIndex: number}> {
        const tableElement = this.table.getTableElement();
        const startChildIndex = this.table.getDataRowChildOffset();
        const endChildIndex = this.table.getDataRowEndChildIndex();
        const rowHeaderColumn = this.table.dataColumnOffset() - 1;
        const renderedRows: Array<{element: HTMLElement; rowIndex: number}> = [];
        for (let childIndex = startChildIndex; childIndex < endChildIndex; childIndex++) {
            const rowElement = tableElement.children[childIndex];
            if (!(rowElement instanceof HTMLElement)) continue;
            const rowIndexText = rowElement.dataset.rowIndex;
            if (rowIndexText === undefined) continue;
            const rowIndex = Number(rowIndexText);
            if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= storeRowCount) continue;
            // 固定行の行ヘッダーは元グリッドとは別のレイヤーに表示される。
            // マウスと同じ座標系で計算するため、画面上の行ヘッダーを優先する。
            const visibleRowHeader = this.table.getVisibleCellOrNull(rowIndex + 1, rowHeaderColumn);
            renderedRows.push({element: visibleRowHeader ?? rowElement, rowIndex});
        }
        return renderedRows;
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
        const renderedRows = this.getRenderedStoreRows(storeRowCount);
        if (renderedRows.length === 0) return;
        // absolute row layout の gridElement は内容幅を持たない場合があるため、
        // インジケーターの水平範囲は可視テーブルルートから取得する。
        const tableRoot = tableElement.closest('.editor-table') as HTMLElement | null;
        const tableRect = (tableRoot ?? tableElement).getBoundingClientRect();
        this.indicator.style.left = tableRect.left + 'px';
        this.indicator.style.width = tableRect.width + 'px';
        // 現在描画されている行の矩形を走査して、マウス位置に最も近い行間を特定する。
        // insertIndex は移動元を抜く前の論理挿入位置。
        let insertIndex = renderedRows[renderedRows.length - 1].rowIndex + 1;
        let indicatorTop = renderedRows[renderedRows.length - 1].element.getBoundingClientRect().bottom;
        for (const renderedRow of renderedRows) {
            const rect = renderedRow.element.getBoundingClientRect();
            const rowMidY = rect.top + rect.height / 2;
            if (clientY > rowMidY) continue;
            insertIndex = renderedRow.rowIndex;
            indicatorTop = rect.top;
            break;
        }
        // fromを抜いた後のインデックスに変換する
        if (insertIndex > this.fromDomDataRowIndex) {
            this.currentInsertIndex = insertIndex - 1;
        } else {
            this.currentInsertIndex = insertIndex;
        }
        // 移動元を抜いた後の有効な挿入範囲に制限する。
        this.currentInsertIndex = Math.max(0, Math.min(storeRowCount - 1, this.currentInsertIndex));
        // インジケーターの top 位置をビューポート座標で設定する
        this.indicator.style.top = indicatorTop + 'px';
    }
}
