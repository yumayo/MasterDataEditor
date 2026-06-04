import {ROW_TOTAL_HEIGHT_PX} from "../core/constant";
import {getLayoutBorderBoxHeightPx, getLayoutBorderBoxWidthPx} from "../core/layout-metrics";

export interface RenderedDataRowRange {
    start: number;
    end: number;
}

export interface RenderedRowsUpdate {
    refreshAllRows: boolean;
    insertedRanges: RenderedDataRowRange[];
    triggeredByScroll: boolean;
    scrollTop: number;
    scrollLeft: number;
}

/**
 * バーチャルスクロールの制御を担うコントローラー。
 *
 * 仮想スクロール有効時は表示中の row div を通常フローから外し、表示範囲の開始行を基準に
 * リベースした小さい top 座標で配置する。
 * topSpacer / bottomSpacer は DOM インデックス互換とスクロール範囲確保のために残す。
 * bottomSpacer の高さ = header + totalRowCount * rowHeight（viewport anchored では 0）
 * これにより行差し替え時にテーブルレイアウトへ大きなギャップ更新を入れず、
 * 各行の座標をブラウザの通常フローではなくこちらで直接管理する。
 *
 * テーブル内 DOM 構造:
 *   [0]=header, [1]=topSpacer, [2..2+frozen)=固定行, [2+frozen..)=ビューポート行, [last]=bottomSpacer
 *
 * enabled=false（ミニテーブル）の場合は全メソッドがパススルー動作する。
 */
export class VirtualScrollController {
    /**
     * 表示範囲外に余分にレンダリングするオーバースキャン行数。
     * WebView2/Chromium ではコンポジタースレッドがメインスレッドより先にスクロール位置を
     * 視覚的に更新するため、レンダリング済み行の外側が一時的に画面に映る。
     * 高速スクロール時に1フレームあたり600-1000pxスクロールすることを想定し、
     * 各方向に40行（約840px）のバッファを確保して空白表示を防止する。
     */
    private static readonly OVERSCAN = 40;
    /** テーブル内データ行の開始インデックス。[0]=header, [1]=topSpacer, [2..]=data rows */
    private static readonly DATA_ROW_START_INDEX = 2;

    private readonly tableElement: HTMLElement;
    private readonly scrollContainer: HTMLElement;
    private readonly enabled: boolean;
    private readonly getHeaderLayoutHeightPx: () => number;

    /** 総データ行数（バッファ行含む） */
    private totalRowCount: number;

    /**
     * 固定行数（0=未固定）。
     * 固定行はスクロール位置に関わらず常にDOMに存在し、topSpacer直後に配置される。
     * updateRenderedRows() の削除対象から除外される。
     */
    private frozenRowCount: number;

    /** 現在DOMに存在するデータ行の開始インデックス（0始まり、固定行を含む） */
    private renderedStart: number;
    /** 現在DOMに存在するデータ行の終了インデックス（排他） */
    private renderedEnd: number;

    /** recalculate の再帰呼び出しを防止するフラグ */
    private isRecalculating: boolean;

    /** 実行時に測定した行の実際の高さ(px)。DPIスケーリングを含む正確な値。初回 recalculate 時に測定する */
    private actualRowHeight: number;
    /** 実行時に測定したヘッダー行の実際の高さ(px)。コメント付き2行ヘッダーを含む */
    private actualHeaderHeight: number;
    /** 右下本文ビューの scrollTop を旧来の全体スクロール座標へ読み替える補正値 */
    private scrollTopCompensationPx: number;

    /** 上部スペーサー要素（セル要素を参照）。enabled=true のみ使用。enabled=false なら false */
    private topSpacer: HTMLElement | false;
    /** 下部スペーサー要素（セル要素を参照）。enabled=true のみ使用。enabled=false なら false */
    private bottomSpacer: HTMLElement | false;
    /** 下部スペーサーの行要素（テーブル内 table-row）。enabled=true のみ使用。enabled=false なら false */
    private bottomSpacerRow: HTMLElement | false;

    /** スクロールイベントリスナー（destroy時の解除用に保持） */
    private readonly scrollListener: (() => void) | false;

    /**
     * 行生成コールバック。データ行インデックスを受け取り、DOM行要素を返す。
     * enabled=true の場合のみ使用。enabled=false なら false。
     * Object.Assign パターンで EditorTable のプロキシが確定した後に connectRenderRow() で設定する。
     */
    private renderRow: ((dataRowIndex: number) => HTMLElement) | false;

    /**
     * 行装飾再適用コールバック。updateRenderedRows 完了後に呼ばれる。
     * 選択クラス、バリデーションエラー、git差分ハイライト等を表示範囲のDOMに再適用する。
     */
    private afterRowsUpdated: ((update: RenderedRowsUpdate) => void) | false;

    /**
     * 行入れ替え有無にかかわらず、スクロール後に同期する表示レイヤー処理。
     * 固定行/列の分離ビューポートやフィルハンドルなど、スクロール位置に依存する処理を登録する。
     */
    private syncScrollBoundVisuals: (scrollTop: number, scrollLeft: number) => void;
    /** 初回 recalculate では既存DOMの装飾を差分計算できないため full refresh を強制する */
    private hasCompletedInitialRowsUpdate: boolean;
    /** 現在の recalculate が scroll イベント起点かどうか */
    private isHandlingScrollEvent: boolean;
    /** 現在処理中の scroll event で先に取得した scrollTop */
    private currentScrollTop: number;
    /** 現在処理中の scroll event で先に取得した scrollLeft */
    private currentScrollLeft: number;
    /** absolute row layout の前回ジオメトリ。変化した時だけ既存行の top を再同期する。 */
    private absoluteRowsLastHeaderHeight: number;
    private absoluteRowsLastRowHeight: number;
    private absoluteRowsLastTotalRowCount: number;
    /** 表示中の行座標を小さい値へリベースするための基準行と、外側レイアウトから与えられる top オフセット。 */
    private absoluteRowsOriginDataRowIndex: number;
    private absoluteRowsLayoutTopOffsetPx: number;
    private absoluteRowsViewportAnchored: boolean;
    /** スクロールバー用DOM高さを圧縮する場合の論理/物理コンテンツ高さ */
    private logicalScrollHeightPx: number;
    private physicalScrollHeightPx: number;
    /** 縦方向の正規スクロール位置。DOM scrollTop は互換用に同期するだけで、表示計算はこの値を使う。 */
    private logicalScrollTopPx: number;
    private absoluteCellBorderBoxWidths: number[];
    private absoluteRowsLastCellWidthsKey: string;

    constructor(
        tableElement: HTMLElement,
        scrollContainer: HTMLElement,
        totalRowCount: number,
        enabled: boolean,
        getHeaderLayoutHeightPx: () => number = () => ROW_TOTAL_HEIGHT_PX
    ) {
        this.tableElement = tableElement;
        this.scrollContainer = scrollContainer;
        this.enabled = enabled;
        this.getHeaderLayoutHeightPx = getHeaderLayoutHeightPx;
        this.totalRowCount = totalRowCount;
        this.frozenRowCount = 0;
        this.actualRowHeight = ROW_TOTAL_HEIGHT_PX;
        this.actualHeaderHeight = this.resolveHeaderLayoutHeightPx();
        this.scrollTopCompensationPx = 0;
        this.isRecalculating = false;
        this.renderRow = false;
        this.afterRowsUpdated = false;
        this.syncScrollBoundVisuals = () => {};
        this.hasCompletedInitialRowsUpdate = false;
        this.isHandlingScrollEvent = false;
        this.currentScrollTop = 0;
        this.currentScrollLeft = 0;
        this.absoluteRowsLastHeaderHeight = -1;
        this.absoluteRowsLastRowHeight = -1;
        this.absoluteRowsLastTotalRowCount = -1;
        this.absoluteRowsOriginDataRowIndex = 0;
        this.absoluteRowsLayoutTopOffsetPx = 0;
        this.absoluteRowsViewportAnchored = false;
        this.logicalScrollHeightPx = 0;
        this.physicalScrollHeightPx = 0;
        this.logicalScrollTopPx = 0;
        this.absoluteCellBorderBoxWidths = [];
        this.absoluteRowsLastCellWidthsKey = '';

        // enabled=true では初期DOMにデータ行が存在しないため、初回 recalculate で必ず生成する。
        // enabled=false（ミニテーブル）では全行がDOMに存在する。
        this.renderedStart = 0;
        this.renderedEnd = enabled ? 0 : totalRowCount;

        this.topSpacer = false;
        this.bottomSpacer = false;
        this.bottomSpacerRow = false;

        if (enabled) {
            this.scrollListener = () => this.onScroll();
            this.scrollContainer.addEventListener('scroll', this.scrollListener, { passive: true });
        } else {
            this.scrollListener = false;
        }
    }

    /**
     * 行生成コールバックを設定する。
     * Object.Assign パターンで EditorTable のプロキシが確定した後、
     * initializeModules() 内で正しい this を持つコールバックを渡すこと。
     * enabled=false の場合は呼ばなくてよい（renderRow は使用されない）。
     */
    connectRenderRow(
        renderRow: (dataRowIndex: number) => HTMLElement,
        afterRowsUpdated: (update: RenderedRowsUpdate) => void,
        syncScrollBoundVisuals: (scrollTop: number, scrollLeft: number) => void
    ): void {
        this.renderRow = renderRow;
        this.afterRowsUpdated = afterRowsUpdated;
        this.syncScrollBoundVisuals = syncScrollBoundVisuals;
    }

    /**
     * スペーサー要素を生成し配置する。
     * topSpacer: DOM インデックス互換のためヘッダー行直後（children[1]）に挿入する。
     * bottomSpacer: スクロール範囲確保のためテーブル内の末尾に追加する。
     * ヘッダー行が既に存在する状態（initialize() のヘッダー追加直後）で呼ぶこと。
     * enabled=false の場合は何もしない。
     */
    attachSpacers(): void {
        if (!this.enabled) return;
        this.tableElement.classList.add('editor-table-grid--absolute-rows');
        this.positionHeaderRow();

        // 上部スペーサー: 既存の children インデックス互換のためヘッダー行直後に置く。
        const topRow = document.createElement('div');
        topRow.classList.add('virtual-scroll-top-spacer');
        const topCell = document.createElement('div');
        topCell.classList.add('virtual-scroll-top-spacer-cell');
        topCell.style.height = '0px';
        topRow.appendChild(topCell);
        // ヘッダー行（children[0]）の直後に挿入する
        const headerRow = this.tableElement.children[0];
        if (headerRow.nextSibling !== null) {
            this.tableElement.insertBefore(topRow, headerRow.nextSibling);
        } else {
            this.tableElement.appendChild(topRow);
        }
        // topSpacer はセル要素を参照する（高さ制御のため）
        this.topSpacer = topCell;

        // 下部スペーサー: absolute 行が通常フローから外れるため、スクロール範囲だけをここで確保する。
        const bottomRow = document.createElement('div');
        bottomRow.classList.add('virtual-scroll-bottom-spacer');
        const bottomCell = document.createElement('div');
        bottomCell.classList.add('virtual-scroll-bottom-spacer-cell');
        bottomCell.style.height = '0px';
        bottomRow.appendChild(bottomCell);
        this.tableElement.appendChild(bottomRow);
        // bottomSpacer はセル要素を参照する（高さ制御のため）
        this.bottomSpacer = bottomCell;
        this.bottomSpacerRow = bottomRow;
        this.syncAbsoluteRowGeometry();
    }

    /** スクロールイベントハンドラ。同期的に再計算を実行する */
    onScroll(): void {
        if (!this.enabled) return;
        this.syncLogicalScrollTopFromPhysicalIfNeeded();
        this.currentScrollTop = this.getLogicalScrollTop();
        this.currentScrollLeft = this.scrollContainer.scrollLeft;
        this.isHandlingScrollEvent = true;
        try {
            this.recalculate();
        } finally {
            this.isHandlingScrollEvent = false;
        }
        this.syncScrollBoundVisuals(this.currentScrollTop, this.currentScrollLeft);
    }

    handlesScrollEvents(): boolean {
        return this.enabled;
    }

    /** 総行数が変化した際に呼ぶ */
    updateTotalRowCount(count: number): void {
        this.totalRowCount = count;
        this.syncAbsoluteRowGeometry();
        if (!this.enabled) {
            // ミニテーブルでは renderedEnd も同期する
            this.renderedEnd = count;
        }
    }

    /**
     * 固定行数を設定する。
     * 固定行はスクロール位置に関わらず常にDOMに存在し、updateRenderedRows() で削除されない。
     * EditorTable.freezeRows() / unfreezeRows() から呼ばれる。
     * enabled=false（ミニテーブル）の場合は設定のみ保持する（全行がDOMに存在するため動作に影響なし）。
     *
     * renderedStart が frozenRowCount 未満の場合は引き上げる。
     * 固定行はビューポート行とは別にDOMに常駐するため、ビューポート行の管理範囲から除外する。
     * これにより updateRenderedRows() が固定行を誤って削除することを防ぐ。
     */
    setFrozenRowCount(count: number): void {
        const previousFrozenRowCount = this.frozenRowCount;
        this.frozenRowCount = count;
        if (!this.enabled) return;
        if (this.renderRow === false) return;
        if (previousFrozenRowCount !== count) {
            // 固定行とビューポート行の境界が変わると、旧固定行DOMを残したままの差分更新では
            // 同じ論理行が通常行として再挿入され、解除後に二重表示が起こる。
            this.forceFullRerender();
            return;
        }
        if (this.renderedStart < count) {
            this.renderedStart = count;
        }
    }

    /**
     * scrollContainer の scrollTop を 0 にリセットする。
     * フィルター適用後にコンテンツ高さが大幅に縮小した場合、
     * scrollTop がコンテンツ高さを超えた位置に留まると recalculateCore() で
     * firstVisibleRow > totalRowCount となり何も描画されなくなる。
     * enabled=false（ミニテーブル）の場合は何もしない。
     */
    resetScrollTop(): void {
        if (!this.enabled) return;
        this.setLogicalScrollTop(0);
    }

    setScrollContentHeightPx(logicalHeightPx: number, physicalHeightPx: number): void {
        const previousLogicalScrollTop = this.getLogicalScrollTop();
        this.logicalScrollHeightPx = Math.max(0, logicalHeightPx);
        this.physicalScrollHeightPx = Math.max(0, physicalHeightPx);
        this.logicalScrollTopPx = this.clampLogicalScrollTop(previousLogicalScrollTop);
        this.syncPhysicalScrollTopFromLogical();
    }

    getLogicalScrollTop(): number {
        if (this.enabled) return this.clampLogicalScrollTop(this.logicalScrollTopPx);
        return this.mapPhysicalScrollTopToLogical(this.scrollContainer.scrollTop);
    }

    mapPhysicalScrollTopToLogical(physicalScrollTop: number): number {
        const { logicalMaxScrollTop, physicalMaxScrollTop } = this.getVerticalScrollMaxes();
        if (logicalMaxScrollTop <= physicalMaxScrollTop || physicalMaxScrollTop <= 0) {
            return Math.min(logicalMaxScrollTop, Math.max(0, physicalScrollTop));
        }
        const clampedPhysicalScrollTop = Math.min(physicalMaxScrollTop, Math.max(0, physicalScrollTop));
        return clampedPhysicalScrollTop * (logicalMaxScrollTop / physicalMaxScrollTop);
    }

    getPhysicalScrollTop(logicalScrollTop: number): number {
        const { logicalMaxScrollTop, physicalMaxScrollTop } = this.getVerticalScrollMaxes();
        if (logicalMaxScrollTop <= 0) return 0;
        if (physicalMaxScrollTop <= 0) return 0;
        if (logicalMaxScrollTop <= physicalMaxScrollTop) {
            return Math.min(physicalMaxScrollTop, Math.max(0, logicalScrollTop));
        }
        return Math.min(physicalMaxScrollTop, Math.max(0, logicalScrollTop) * (physicalMaxScrollTop / logicalMaxScrollTop));
    }

    setLogicalScrollTop(logicalScrollTop: number, triggeredByScrollInput: boolean = false): boolean {
        if (!this.enabled) {
            const nextPhysicalScrollTop = Math.max(0, logicalScrollTop);
            const changed = Math.abs(this.scrollContainer.scrollTop - nextPhysicalScrollTop) > 0.001;
            if (changed) this.scrollContainer.scrollTop = nextPhysicalScrollTop;
            return changed;
        }
        const nextLogicalScrollTop = this.clampLogicalScrollTop(logicalScrollTop);
        const changed = Math.abs(this.logicalScrollTopPx - nextLogicalScrollTop) > 0.001;
        this.logicalScrollTopPx = nextLogicalScrollTop;
        this.syncPhysicalScrollTopFromLogical();
        if (changed) this.recalculate(triggeredByScrollInput);
        return changed;
    }

    setPhysicalScrollTop(physicalScrollTop: number, triggeredByScrollInput: boolean = false): boolean {
        const nextLogicalScrollTop = this.mapPhysicalScrollTopToLogical(physicalScrollTop);
        const changed = this.setLogicalScrollTop(nextLogicalScrollTop, triggeredByScrollInput);
        const nextPhysicalScrollTop = this.getPhysicalScrollTop(this.logicalScrollTopPx);
        if (Math.abs(this.scrollContainer.scrollTop - nextPhysicalScrollTop) > 1) {
            this.scrollContainer.scrollTop = nextPhysicalScrollTop;
        }
        return changed;
    }

    getLogicalScrollHeightPx(): number {
        return this.logicalScrollHeightPx > 0 ? this.logicalScrollHeightPx : this.scrollContainer.scrollHeight;
    }

    getLogicalMaxScrollTop(): number {
        return this.getVerticalScrollMaxes().logicalMaxScrollTop;
    }

    usesCompressedVerticalScroll(): boolean {
        const { logicalMaxScrollTop, physicalMaxScrollTop } = this.getVerticalScrollMaxes();
        return logicalMaxScrollTop > physicalMaxScrollTop;
    }

    setScrollTopCompensationPx(value: number): void {
        this.scrollTopCompensationPx = value;
    }

    /**
     * absolute rows の親グリッドに適用するレイアウト由来の top オフセットを設定する。
     * EditorTableLayout の quadrant layout では固定ヘッダー分だけ上へずらす必要がある。
     */
    setAbsoluteRowsLayoutTopOffsetPx(value: number): void {
        if (this.absoluteRowsLayoutTopOffsetPx === value) return;
        this.absoluteRowsLayoutTopOffsetPx = value;
        this.syncAbsoluteRowsContainerTop();
    }

    /**
     * true の場合、行グリッドはスクロール内容ではなくビューポート直下のオーバーレイとして配置される。
     * 親グリッドの top から scrollTop を差し引き、親・子の両方をビューポート近傍の座標に保つ。
     */
    setAbsoluteRowsViewportAnchored(enabled: boolean): void {
        if (this.absoluteRowsViewportAnchored === enabled) return;
        this.absoluteRowsViewportAnchored = enabled;
        this.syncAbsoluteRowGeometry();
    }

    /** 表示範囲を強制再計算する（行挿入/削除/ソート/フィルター後） */
    forceRecalculate(): void {
        if (!this.enabled) return;
        this.recalculate();
    }

    /**
     * 表示中の全データ行を破棄して再レンダリングする。
     * storeRowIndices が変更された後（ソート・フィルター等）に呼ぶ。
     * renderedStart/renderedEnd を無効化して recalculate を再実行することで
     * 全行が renderRow コールバック経由で新しい storeRowIndices に基づいて再生成される。
     * enabled=false（ミニテーブル）の場合は何もしない。
     */
    forceFullRerender(): void {
        if (!this.enabled) return;
        if (this.renderRow === false) return;
        // 既存のデータ行をすべて削除する（ヘッダー行 + topSpacer + bottomSpacer は残す）
        // bottomSpacer はテーブル末尾にあるため、一旦退避してから行を削除し、最後に再追加する
        if (this.bottomSpacerRow !== false) {
            this.bottomSpacerRow.remove();
        }
        while (this.tableElement.children.length > VirtualScrollController.DATA_ROW_START_INDEX) {
            this.tableElement.removeChild(this.tableElement.lastChild as Node);
        }
        // 固定行を再生成してDOMに配置する（常にtopSpacer直後に存在する必要がある）
        for (let i = 0; i < this.frozenRowCount; i++) {
            const row = this.renderRow(i);
            this.positionDataRow(row, i);
            this.tableElement.appendChild(row);
        }
        // bottomSpacer をテーブル末尾に再追加する
        if (this.bottomSpacerRow !== false) {
            this.tableElement.appendChild(this.bottomSpacerRow);
        }
        // renderedStart/renderedEnd を固定行の直後にリセットする
        // （固定行は既にDOMに存在するが renderedStart/renderedEnd の管理対象は非固定行のみ）
        this.renderedStart = this.frozenRowCount;
        this.renderedEnd = this.frozenRowCount;
        // recalculate がビューポートに基づいて正しい範囲を描画する
        this.recalculate();
    }

    /**
     * 現在のビューポート行の表示範囲 [start, end) を返す。
     * 固定行（0〜frozenRowCount-1）はこの範囲に含まれないが、常にDOMに存在する。
     * enabled=false では常に [0, totalRowCount) を返す（全行表示中）。
     */
    getRenderedRange(): { start: number; end: number } {
        return { start: this.renderedStart, end: this.renderedEnd };
    }

    /**
     * 論理データ行インデックス（0始まり）をDOMの子要素インデックスに変換する。
     * enabled=false: 常に dataRowIndex + 1 を返す（ヘッダー行分のオフセット）。
     * enabled=true:
     *   固定行（0 <= dataRowIndex < frozenRowCount）: DATA_ROW_START_INDEX + dataRowIndex（常にDOM上に存在）
     *   非固定行（renderedStart <= dataRowIndex < renderedEnd）:
     *     dataRowIndex - renderedStart + DATA_ROW_START_INDEX + frozenRowCount
     *   上記以外（表示範囲外）: null
     */
    dataRowToDomIndex(dataRowIndex: number): number | null {
        if (!this.enabled) return dataRowIndex + 1;
        // 固定行は常にDOMに存在する（topSpacer直後に配置）
        if (dataRowIndex < this.frozenRowCount) {
            return dataRowIndex + VirtualScrollController.DATA_ROW_START_INDEX;
        }
        // 非固定行: ビューポート範囲内のみDOMに存在
        if (dataRowIndex < this.renderedStart || dataRowIndex >= this.renderedEnd) return null;
        return dataRowIndex - this.renderedStart + VirtualScrollController.DATA_ROW_START_INDEX + this.frozenRowCount;
    }

    /**
     * DOMの子要素インデックスがスペーサー行かどうかを判定する。
     * enabled=true: children[1] が topSpacer、最終要素が bottomSpacer なので true を返す。
     * enabled=false: topSpacer は挿入されないため常に false。
     */
    isSpacerIndex(domChildIndex: number): boolean {
        if (!this.enabled) return false;
        if (domChildIndex === 1) return true;
        // bottomSpacer はテーブルの最終要素
        if (this.bottomSpacerRow !== false && domChildIndex === this.tableElement.children.length - 1) return true;
        return false;
    }

    /**
     * データ行の前に配置されたスペーサー行の数を返す。
     * getDataRowChildOffset() 等のインデックス計算に使用する。
     * bottomSpacer はデータ行の後ろにあるためここには含めない。
     * enabled=true: topSpacer のみ = 1。
     * enabled=false: スペーサーなしのため 0。
     */
    spacerCount(): number {
        return this.enabled ? 1 : 0;
    }

    /**
     * テーブル内の全スペーサー行の数を返す（topSpacer + bottomSpacer）。
     * children.length からデータ行数を算出する際に使用する。
     * enabled=true: 2。
     * enabled=false: 0。
     */
    totalSpacerCount(): number {
        return this.enabled ? 2 : 0;
    }

    refreshMeasuredGeometry(): void {
        this.measureHeaderHeight();
        this.measureActualRowHeight();
        if (this.syncAbsoluteRowGeometry()) this.positionExistingRows();
    }

    getActualRowHeightPx(): number {
        return this.actualRowHeight;
    }

    getActualHeaderHeightPx(): number {
        return this.actualHeaderHeight;
    }

    /**
     * テーブル内のデータ行が終わる children インデックス（排他）を返す。
     * bottomSpacer がテーブル末尾にある場合、その直前のインデックスまでをデータ行範囲とする。
     * enabled=true: children.length - 1（bottomSpacer を除外）
     * enabled=false: children.length（スペーサーなし）
     *
     * children を走査してデータ行のみ処理する場合のループ終了条件として使用する。
     * for (let i = getDataRowChildOffset(); i < getDataRowEndChildIndex(); i++) { ... }
     */
    getDataRowEndChildIndex(): number {
        if (!this.enabled) return this.tableElement.children.length;
        return this.tableElement.children.length - 1;
    }

    /**
     * データ行をテーブルに追加する。
     * bottomSpacer がテーブル末尾にあるため、bottomSpacer の直前に挿入する。
     * 行追加による renderedEnd の更新は notifyRowAppended() で行うこと。
     */
    appendDataRow(row: HTMLElement): void {
        this.positionDataRowFromDataset(row);
        if (this.bottomSpacerRow !== false) {
            this.tableElement.insertBefore(row, this.bottomSpacerRow);
        } else {
            this.tableElement.appendChild(row);
        }
    }

    /**
     * DOMに新しい行が追加されたことを通知する。
     * renderedEnd をインクリメントして dataRowToDomIndex のインデックス変換を正しく保つ。
     * 既存行の再配置（ソート・ドラッグ移動等）では呼ばないこと。
     */
    notifyRowAppended(): void {
        this.renderedEnd++;
    }

    /**
     * DOMから行が削除されたことを通知する。
     * renderedEnd をデクリメントして dataRowToDomIndex のインデックス変換を正しく保つ。
     */
    notifyRowRemoved(): void {
        if (this.renderedEnd > this.renderedStart) this.renderedEnd--;
    }

    /**
     * 指定データ行インデックスがビューポートに含まれるようスクロールする。
     * enabled=false の場合は何もしない（従来のスクロール処理に委譲）。
     */
    ensureRowVisible(dataRowIndex: number): void {
        if (!this.enabled) return;
        // 固定行は常に表示されているためスクロール不要
        if (dataRowIndex < this.frozenRowCount) return;
        const currentLogicalScrollTop = this.getLogicalScrollTop();
        const targetLogicalScrollTop = this.getLogicalScrollTopForRowVisible(dataRowIndex, currentLogicalScrollTop);
        if (Math.abs(targetLogicalScrollTop - currentLogicalScrollTop) > 0.5) {
            this.setLogicalScrollTop(targetLogicalScrollTop);
            this.syncScrollBoundVisuals(targetLogicalScrollTop, this.scrollContainer.scrollLeft);
        } else {
            this.recalculate();
        }
    }

    centerRowVertically(dataRowIndex: number): void {
        if (!this.enabled) return;
        if (dataRowIndex < this.frozenRowCount) return;
        this.measureActualRowHeight();
        const rowHeight = this.actualRowHeight;
        const headerHeight = this.getHeaderHeight();
        const rowCenter = headerHeight + (dataRowIndex * rowHeight) + (rowHeight / 2);
        const targetLogicalScrollTop = this.clampLogicalScrollTop(
            rowCenter - (this.scrollContainer.clientHeight / 2) - this.scrollTopCompensationPx
        );
        if (this.setLogicalScrollTop(targetLogicalScrollTop)) {
            this.syncScrollBoundVisuals(targetLogicalScrollTop, this.scrollContainer.scrollLeft);
        } else {
            this.recalculate();
        }
    }

    /** DOM破棄 */
    destroy(): void {
        if (this.scrollListener !== false) {
            this.scrollContainer.removeEventListener('scroll', this.scrollListener);
        }
        if (this.topSpacer !== false) {
            // topSpacer はセル要素（.virtual-scroll-top-spacer-cell）を指すため、
            // 親の行要素（.virtual-scroll-top-spacer）ごと削除する
            const topRow = this.topSpacer.parentElement;
            if (topRow !== null) topRow.remove();
        }
        if (this.bottomSpacerRow !== false) {
            this.bottomSpacerRow.remove();
        }
        this.tableElement.classList.remove('editor-table-grid--absolute-rows');
    }

    // =========================================================================
    // 内部メソッド
    // =========================================================================

    private clampLogicalScrollTop(logicalScrollTop: number): number {
        return Math.min(this.getVerticalScrollMaxes().logicalMaxScrollTop, Math.max(0, logicalScrollTop));
    }

    private syncPhysicalScrollTopFromLogical(): void {
        const nextPhysicalScrollTop = this.getPhysicalScrollTop(this.logicalScrollTopPx);
        if (!this.isHandlingScrollEvent && Math.abs(this.scrollContainer.scrollTop - nextPhysicalScrollTop) > 1) {
            this.scrollContainer.scrollTop = nextPhysicalScrollTop;
        }
    }

    private syncLogicalScrollTopFromPhysicalIfNeeded(): void {
        if (!this.enabled) return;
        const physicalScrollTop = this.scrollContainer.scrollTop;
        const expectedPhysicalScrollTop = this.getPhysicalScrollTop(this.logicalScrollTopPx);
        if (Math.abs(physicalScrollTop - expectedPhysicalScrollTop) <= 1) return;
        this.logicalScrollTopPx = this.clampLogicalScrollTop(this.mapPhysicalScrollTopToLogical(physicalScrollTop));
    }

    private getLogicalScrollTopForRowVisible(dataRowIndex: number, currentLogicalScrollTop: number): number {
        this.measureActualRowHeight();
        const rowHeight = this.actualRowHeight;
        const headerHeight = this.getHeaderHeight();
        // 行の絶対位置を計算する。固定行は detached/transform によりヘッダー直下へ固定表示されるため、
        // 非固定行の表示領域はヘッダー + 固定行の高さ分だけ下にオフセットされる。
        // しかし仮想コンテンツ全体の高さは全行数 * rowHeight で計算するため、
        // 非固定行の絶対位置は headerHeight + dataRowIndex * rowHeight のまま。
        const rowAbsoluteTop = dataRowIndex * rowHeight + headerHeight;
        const rowAbsoluteBottom = rowAbsoluteTop + rowHeight;
        const viewTop = currentLogicalScrollTop + this.scrollTopCompensationPx;
        const viewBottom = viewTop + this.scrollContainer.clientHeight;
        let targetScrollTop = currentLogicalScrollTop + this.scrollTopCompensationPx;
        if (rowAbsoluteTop < viewTop) {
            const frozenHeight = this.frozenRowCount * rowHeight;
            // 内部スクロールでは compensation 済みなので、ヘッダー高さを二重に引かない。
            const topInset = this.scrollTopCompensationPx > 0 ? 0 : headerHeight + frozenHeight;
            targetScrollTop = rowAbsoluteTop - topInset;
        } else if (rowAbsoluteBottom > viewBottom) {
            targetScrollTop = rowAbsoluteBottom - this.scrollContainer.clientHeight;
        }
        return this.clampLogicalScrollTop(targetScrollTop - this.scrollTopCompensationPx);
    }

    private getVerticalScrollMaxes(): { logicalMaxScrollTop: number; physicalMaxScrollTop: number } {
        const logicalHeight = this.logicalScrollHeightPx > 0 ? this.logicalScrollHeightPx : this.scrollContainer.scrollHeight;
        const physicalHeight = this.physicalScrollHeightPx > 0 ? this.physicalScrollHeightPx : this.scrollContainer.scrollHeight;
        return {
            logicalMaxScrollTop: Math.max(0, logicalHeight - this.scrollContainer.clientHeight),
            physicalMaxScrollTop: Math.max(0, physicalHeight - this.scrollContainer.clientHeight),
        };
    }

    private usesAbsoluteRowLayout(): boolean {
        return this.enabled;
    }

    private setInlineTopIfChanged(element: HTMLElement, top: string): void {
        if (element.style.top === top) return;
        element.style.top = top;
    }

    private formatTopPx(value: number): string {
        return `${value}px`;
    }

    private syncAbsoluteRowsContainerTop(rowHeight: number = this.actualRowHeight): void {
        if (!this.usesAbsoluteRowLayout()) return;
        const scrollTop = this.absoluteRowsViewportAnchored
            ? (this.isHandlingScrollEvent ? this.currentScrollTop : this.getLogicalScrollTop())
            : 0;
        this.setInlineTopIfChanged(
            this.tableElement,
            this.formatTopPx(this.absoluteRowsLayoutTopOffsetPx + (this.absoluteRowsOriginDataRowIndex * rowHeight) - scrollTop)
        );
    }

    private setAbsoluteRowsOriginDataRowIndex(dataRowIndex: number, rowHeight: number = this.actualRowHeight): boolean {
        const nextOrigin = Math.max(this.frozenRowCount, dataRowIndex);
        const changed = this.absoluteRowsOriginDataRowIndex !== nextOrigin;
        this.absoluteRowsOriginDataRowIndex = nextOrigin;
        this.syncAbsoluteRowsContainerTop(rowHeight);
        return changed;
    }

    private positionHeaderRow(): void {
        if (!this.usesAbsoluteRowLayout()) return;
        const headerRow = this.tableElement.children[0] as HTMLElement | null;
        if (headerRow === null) return;
        this.setInlineTopIfChanged(headerRow, '0px');
    }

    private getDataRowTopPx(dataRowIndex: number, headerHeight: number = this.actualHeaderHeight, rowHeight: number = this.actualRowHeight): number {
        if (dataRowIndex < this.frozenRowCount) {
            return headerHeight + (dataRowIndex * rowHeight);
        }
        return headerHeight + ((dataRowIndex - this.absoluteRowsOriginDataRowIndex) * rowHeight);
    }

    private positionDataRow(row: HTMLElement, dataRowIndex: number, headerHeight: number = this.actualHeaderHeight, rowHeight: number = this.actualRowHeight): void {
        if (!this.usesAbsoluteRowLayout()) return;
        this.applyAbsoluteCellWidths(row);
        this.setInlineTopIfChanged(row, this.formatTopPx(this.getDataRowTopPx(dataRowIndex, headerHeight, rowHeight)));
    }

    private positionDataRowFromDataset(row: HTMLElement): void {
        if (!this.usesAbsoluteRowLayout()) return;
        const dataRowIndexText = row.dataset.rowIndex;
        if (dataRowIndexText === undefined) return;
        const dataRowIndex = Number(dataRowIndexText);
        if (!Number.isFinite(dataRowIndex)) return;
        this.positionDataRow(row, dataRowIndex);
    }

    private positionExistingRows(headerHeight: number = this.actualHeaderHeight, rowHeight: number = this.actualRowHeight): void {
        if (!this.usesAbsoluteRowLayout()) return;
        this.positionHeaderRow();
        for (let index = VirtualScrollController.DATA_ROW_START_INDEX; index < this.tableElement.children.length; index++) {
            const row = this.tableElement.children[index] as HTMLElement | null;
            if (row === null || row === this.bottomSpacerRow) continue;
            if (row.classList.contains('virtual-scroll-top-spacer') || row.classList.contains('virtual-scroll-bottom-spacer')) continue;
            const dataRowIndexText = row.dataset.rowIndex;
            if (dataRowIndexText === undefined) continue;
            const dataRowIndex = Number(dataRowIndexText);
            if (!Number.isFinite(dataRowIndex)) continue;
            this.positionDataRow(row, dataRowIndex, headerHeight, rowHeight);
        }
    }

    private syncAbsoluteRowGeometry(headerHeight: number = this.actualHeaderHeight, rowHeight: number = this.actualRowHeight): boolean {
        if (!this.usesAbsoluteRowLayout()) return false;
        this.positionHeaderRow();
        this.syncAbsoluteRowsContainerTop(rowHeight);
        const cellWidthsChanged = (!this.isHandlingScrollEvent || this.absoluteCellBorderBoxWidths.length === 0)
            ? this.syncAbsoluteCellWidthCache()
            : false;

        if (this.topSpacer !== false && this.topSpacer.style.height !== '0px') {
            this.topSpacer.style.height = '0px';
        }
        if (this.bottomSpacer !== false) {
            const contentHeight = this.absoluteRowsViewportAnchored
                ? 0
                : Math.max(0, headerHeight + (this.totalRowCount * rowHeight));
            const height = `${contentHeight}px`;
            if (this.bottomSpacer.style.height !== height) this.bottomSpacer.style.height = height;
        }

        const changed = this.absoluteRowsLastHeaderHeight !== headerHeight
            || this.absoluteRowsLastRowHeight !== rowHeight
            || this.absoluteRowsLastTotalRowCount !== this.totalRowCount
            || cellWidthsChanged;
        this.absoluteRowsLastHeaderHeight = headerHeight;
        this.absoluteRowsLastRowHeight = rowHeight;
        this.absoluteRowsLastTotalRowCount = this.totalRowCount;
        return changed;
    }

    private syncAbsoluteCellWidthCache(): boolean {
        if (!this.usesAbsoluteRowLayout()) return false;
        const headerRow = this.tableElement.children[0] as HTMLElement | null;
        if (headerRow === null) return false;
        const widths: number[] = [];
        for (let index = 0; index < headerRow.children.length; index++) {
            const cell = headerRow.children[index] as HTMLElement | null;
            widths.push(cell === null ? 0 : this.getConfiguredCellWidthPx(cell));
        }
        const key = widths.map(width => width.toFixed(3)).join(',');
        if (key === this.absoluteRowsLastCellWidthsKey) return false;
        this.absoluteCellBorderBoxWidths = widths;
        this.absoluteRowsLastCellWidthsKey = key;
        return true;
    }

    private applyAbsoluteCellWidths(row: HTMLElement): void {
        if (!this.usesAbsoluteRowLayout()) return;
        if (this.absoluteCellBorderBoxWidths.length === 0) this.syncAbsoluteCellWidthCache();
        const count = Math.min(row.children.length, this.absoluteCellBorderBoxWidths.length);
        for (let index = 0; index < count; index++) {
            const width = this.absoluteCellBorderBoxWidths[index];
            if (width <= 0) continue;
            const cell = row.children[index] as HTMLElement | null;
            if (cell === null) continue;
            const widthPx = `${width}px`;
            if (cell.style.width !== widthPx) cell.style.width = widthPx;
            if (cell.style.minWidth !== widthPx) cell.style.minWidth = widthPx;
            if (cell.style.maxWidth !== widthPx) cell.style.maxWidth = widthPx;
        }
    }

    /**
     * ヘッダー行の実際の高さを取得する。
     * ヘッダー行は detached layer と同じ高さを持つため、スクロール位置計算時のオフセットに使用する。
     */
    private getHeaderHeight(): number {
        this.measureHeaderHeight();
        return this.actualHeaderHeight;
    }

    private getConfiguredCellWidthPx(cell: HTMLElement): number {
        const inlineWidth = this.parsePx(cell.style.width);
        if (inlineWidth > 0) return inlineWidth;
        const inlineMinWidth = this.parsePx(cell.style.minWidth);
        if (inlineMinWidth > 0) return inlineMinWidth;
        return getLayoutBorderBoxWidthPx(cell);
    }

    private parsePx(value: string): number {
        if (value.trim() === '') return 0;
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    private resolveHeaderLayoutHeightPx(): number {
        const height = this.getHeaderLayoutHeightPx();
        return Number.isFinite(height) && height > 0 ? height : ROW_TOTAL_HEIGHT_PX;
    }

    private measureHeaderHeight(): void {
        this.actualHeaderHeight = this.resolveHeaderLayoutHeightPx();
    }

    /**
     * DOMに存在するデータ行の実際の高さを測定して actualRowHeight を更新する。
     * DPIスケーリングや将来的なCSS変更にも対応するため、定数ではなく実測値を使う。
     * データ行がDOMに存在しない場合は前回の値（初期値はROW_TOTAL_HEIGHT_PX）を維持する。
     */
    private measureActualRowHeight(): void {
        // enabled=true: children[0]=header, [1]=topSpacer, [2]=最初のデータ行
        // enabled=false: children[0]=header, [1]=最初のデータ行
        const dataStart = this.enabled ? VirtualScrollController.DATA_ROW_START_INDEX : 1;
        if (this.tableElement.children.length <= dataStart) return;
        const firstDataRow = this.tableElement.children[dataStart] as HTMLElement;
        if (!firstDataRow) return;
        // スペーサー行を測定しないようにする
        if (firstDataRow.classList.contains('virtual-scroll-bottom-spacer')) return;
        const measured = getLayoutBorderBoxHeightPx(firstDataRow);
        if (measured > 0) this.actualRowHeight = measured;
    }

    /**
     * 表示範囲を再計算し、DOMの行を更新する。
     * scrollContainer の scrollTop を基に、ビューポートに収まるデータ行の範囲を決定する。
     */
    private recalculate(triggeredByScrollInput: boolean = false): void {
        if (this.renderRow === false) return;
        if (this.isRecalculating) return;
        this.isRecalculating = true;
        const previousIsHandlingScrollEvent = this.isHandlingScrollEvent;
        const previousScrollTop = this.currentScrollTop;
        const previousScrollLeft = this.currentScrollLeft;

        if (triggeredByScrollInput && !this.isHandlingScrollEvent) {
            this.currentScrollTop = this.getLogicalScrollTop();
            this.currentScrollLeft = this.scrollContainer.scrollLeft;
            this.isHandlingScrollEvent = true;
        }

        try {
            this.recalculateCore();
        } finally {
            this.isHandlingScrollEvent = previousIsHandlingScrollEvent;
            this.currentScrollTop = previousScrollTop;
            this.currentScrollLeft = previousScrollLeft;
            this.isRecalculating = false;
        }
    }

    private recalculateCore(): void {
        // スクロール中は測定済みの値を使う。DOM差し替え後に layout read を挟むと強制レイアウトが連発する。
        if (!this.isHandlingScrollEvent) this.measureActualRowHeight();
        const rowHeight = this.actualRowHeight;
        const previousRenderedStart = this.renderedStart;
        const previousRenderedEnd = this.renderedEnd;

        const scrollTopWithoutCompensation = this.isHandlingScrollEvent ? this.currentScrollTop : this.getLogicalScrollTop();
        const scrollTop = scrollTopWithoutCompensation + this.scrollTopCompensationPx;
        const viewportHeight = this.scrollContainer.clientHeight;
        const headerHeight = this.isHandlingScrollEvent ? this.actualHeaderHeight : this.getHeaderHeight();
        const absoluteGeometryChanged = this.syncAbsoluteRowGeometry(headerHeight, rowHeight);
        if (absoluteGeometryChanged) this.positionExistingRows(headerHeight, rowHeight);

        // topSpacer がテーブル内にあるため、scrollTop にはヘッダー高さが含まれる。
        // 固定行は transform でヘッダー直下に固定表示されるため、
        // データ行領域のスクロールオフセットからは固定行の高さも除外する。
        const frozenHeight = this.frozenRowCount * rowHeight;
        const dataAreaScrollTop = Math.max(0, scrollTop - headerHeight - frozenHeight);
        const firstVisibleRow = Math.max(0, Math.floor(dataAreaScrollTop / rowHeight));
        const visibleRowCount = Math.ceil(viewportHeight / rowHeight) + 1;
        const lastVisibleRow = firstVisibleRow + visibleRowCount;

        // 非固定行の表示範囲を計算する。固定行はDOMに常駐するため表示範囲に含めない。
        // firstVisibleRow は固定行を除いた相対インデックスなので、frozenRowCount を加算して
        // 全体のデータ行インデックスに変換する。
        const newStart = Math.max(this.frozenRowCount, firstVisibleRow + this.frozenRowCount - VirtualScrollController.OVERSCAN);
        const newEnd = Math.min(this.totalRowCount, lastVisibleRow + this.frozenRowCount + VirtualScrollController.OVERSCAN);

        if (newStart === this.renderedStart && newEnd === this.renderedEnd) return;
        const originChanged = this.setAbsoluteRowsOriginDataRowIndex(newStart, rowHeight);

        // スペーサー高さを行の入れ替え「前」に設定する。
        // 行を削除してからスペーサーを設定すると、一時的にコンテンツ高さが激減し
        // ブラウザがscrollTopをクランプしてスクロール位置が0にリセットされる。
        // スペーサーを先に膨らませることで、行削除中もコンテンツ高さを安定させる。
        // topSpacer は固定行の後のギャップを埋めるため、固定行の高さ分を差し引く。
        const savedScrollLeft = this.isHandlingScrollEvent ? this.currentScrollLeft : this.scrollContainer.scrollLeft;

        if (this.usesAbsoluteRowLayout()) {
            this.syncAbsoluteRowGeometry(headerHeight, rowHeight);
        } else {
            if (this.topSpacer !== false) {
                this.topSpacer.style.height = `${Math.max(0, (newStart - this.frozenRowCount) * rowHeight)}px`;
            }
            if (this.bottomSpacer !== false) {
                this.bottomSpacer.style.height = `${Math.max(0, (this.totalRowCount - newEnd) * rowHeight)}px`;
            }
        }

        this.updateRenderedRows(newStart, newEnd);

        this.renderedStart = newStart;
        this.renderedEnd = newEnd;
        if (originChanged || absoluteGeometryChanged) this.positionExistingRows(headerHeight, rowHeight);

        // 行の入れ替え後に装飾（選択クラス、バリデーション、git差分等）を再適用する
        if (this.afterRowsUpdated !== false) {
            this.afterRowsUpdated(
                this.createRenderedRowsUpdate(previousRenderedStart, previousRenderedEnd, newStart, newEnd, scrollTopWithoutCompensation, savedScrollLeft)
            );
            this.hasCompletedInitialRowsUpdate = true;
        }

        // scrollTop は復元しない。
        // スペーサー高さを行の入れ替え「前」に設定しているため、コンテンツ高さは安定しており
        // DOM操作後のscrollTopドリフトは発生しない。
        // scrollLeft は水平スクロールにコンポジタの先行が影響しにくいため復元を維持する。
        if (this.scrollContainer.scrollLeft !== savedScrollLeft) {
            this.scrollContainer.scrollLeft = savedScrollLeft;
        }
    }

    private createRenderedRowsUpdate(
        previousStart: number,
        previousEnd: number,
        newStart: number,
        newEnd: number,
        scrollTop: number,
        scrollLeft: number
    ): RenderedRowsUpdate {
        if (!this.hasCompletedInitialRowsUpdate) {
            return {
                refreshAllRows: true,
                insertedRanges: [{ start: newStart, end: newEnd }],
                triggeredByScroll: this.isHandlingScrollEvent,
                scrollTop,
                scrollLeft,
            };
        }
        const overlapStart = Math.max(previousStart, newStart);
        const overlapEnd = Math.min(previousEnd, newEnd);
        if (overlapStart >= overlapEnd) {
            return {
                refreshAllRows: true,
                insertedRanges: [{ start: newStart, end: newEnd }],
                triggeredByScroll: this.isHandlingScrollEvent,
                scrollTop,
                scrollLeft,
            };
        }
        const insertedRanges: RenderedDataRowRange[] = [];
        if (newStart < overlapStart) insertedRanges.push({ start: newStart, end: overlapStart });
        if (overlapEnd < newEnd) insertedRanges.push({ start: overlapEnd, end: newEnd });
        return {
            refreshAllRows: false,
            insertedRanges,
            triggeredByScroll: this.isHandlingScrollEvent,
            scrollTop,
            scrollLeft,
        };
    }

    /**
     * DOMのデータ行を新しい表示範囲に更新する。
     * 既存の行との差分を効率的に計算し、不要な行を削除、新しい行を生成する。
     *
     * 固定行（frozenRowCount > 0）がある場合:
     *   DOM構造: [0]=header, [1]=topSpacer, [2..2+frozen)=固定行, [2+frozen..)=ビューポート行, [last]=bottomSpacer
     *   固定行は常にDOMに存在し、この関数では操作しない。
     *   renderedStart/renderedEnd は frozenRowCount 以上の値で呼ばれる。
     *   ビューポート行の操作は viewportStart (= dataStart + frozenRowCount) から行う。
     *   bottomSpacer は常にテーブル末尾に存在し、ビューポート行の追加/削除はその直前で行う。
     */
    private updateRenderedRows(newStart: number, newEnd: number): void {
        if (this.renderRow === false) return;

        // ビューポート行のDOM開始位置（固定行の直後）
        const viewportDomStart = VirtualScrollController.DATA_ROW_START_INDEX + this.frozenRowCount;
        // bottomSpacer の参照（ビューポート行はこの直前に挿入する）
        const bottomRef = this.bottomSpacerRow !== false ? this.bottomSpacerRow : null;

        // 現在の範囲と新しい範囲の重複部分を計算する
        const overlapStart = Math.max(this.renderedStart, newStart);
        const overlapEnd = Math.min(this.renderedEnd, newEnd);

        if (overlapStart >= overlapEnd) {
            // 重複なし: ビューポート行を全入れ替え（固定行とスペーサーは残す）
            // bottomSpacer の直前にある全ビューポート行を削除する
            while (this.tableElement.children[viewportDomStart] !== bottomRef &&
                   this.tableElement.children.length > viewportDomStart) {
                const child = this.tableElement.children[viewportDomStart];
                if (child === this.bottomSpacerRow) break;
                this.tableElement.removeChild(child);
            }
            // 新しい範囲の行をすべて生成する（bottomSpacer の直前に挿入）
            for (let i = newStart; i < newEnd; i++) {
                const row = this.renderRow(i);
                this.positionDataRow(row, i);
                if (bottomRef !== null) {
                    this.tableElement.insertBefore(row, bottomRef);
                } else {
                    this.tableElement.appendChild(row);
                }
            }
        } else {
            // 重複あり: 差分のみ更新する

            // 上端の不要な行を削除する（renderedStart ～ overlapStart の行）
            const removeTopCount = overlapStart - this.renderedStart;
            for (let i = 0; i < removeTopCount; i++) {
                // viewportDomStart がビューポート行の先頭（固定行の直後）
                const row = this.tableElement.children[viewportDomStart];
                if (row && row !== this.bottomSpacerRow) this.tableElement.removeChild(row);
            }

            // 下端の不要な行を削除する（overlapEnd ～ renderedEnd の行）
            const removeBottomCount = this.renderedEnd - overlapEnd;
            for (let i = 0; i < removeBottomCount; i++) {
                // bottomSpacer の直前の要素を削除する
                if (bottomRef !== null && bottomRef.previousSibling !== null) {
                    const row = bottomRef.previousSibling;
                    this.tableElement.removeChild(row);
                }
            }

            // 上端に新しい行を挿入する（newStart ～ overlapStart の行）
            // ビューポート行の先頭に挿入する
            const insertRef = this.tableElement.children[viewportDomStart];
            for (let i = newStart; i < overlapStart; i++) {
                const row = this.renderRow(i);
                this.positionDataRow(row, i);
                this.tableElement.insertBefore(row, insertRef);
            }

            // 下端に新しい行を追加する（overlapEnd ～ newEnd の行）
            // bottomSpacer の直前に挿入する
            for (let i = overlapEnd; i < newEnd; i++) {
                const row = this.renderRow(i);
                this.positionDataRow(row, i);
                if (bottomRef !== null) {
                    this.tableElement.insertBefore(row, bottomRef);
                } else {
                    this.tableElement.appendChild(row);
                }
            }
        }
    }
}
