import {ROW_TOTAL_HEIGHT_PX} from "../core/constant";
import {getLayoutBorderBoxHeightPx} from "../core/layout-metrics";

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
 * 方式B（テーブル内スペーサー）を採用する。
 * topSpacer / bottomSpacer は共にテーブル内に display:table-row として配置する。
 * テーブル高さ = header + topSpacer + frozenRows + viewportRows + bottomSpacer
 *             = header + totalRowCount * rowHeight（常に一定）
 * これによりテーブルが常に全スクロール範囲をカバーし、
 * ヘッダー行は detached layer 側で常時表示される。
 * コンポジタースレッドの非同期スクロール中でも、ビューポートがテーブル外に出ることがなく、
 * ヘッダーや行が消える問題が発生しない。
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

    constructor(
        tableElement: HTMLElement,
        scrollContainer: HTMLElement,
        totalRowCount: number,
        enabled: boolean
    ) {
        this.tableElement = tableElement;
        this.scrollContainer = scrollContainer;
        this.enabled = enabled;
        this.totalRowCount = totalRowCount;
        this.frozenRowCount = 0;
        this.actualRowHeight = ROW_TOTAL_HEIGHT_PX;
        this.actualHeaderHeight = ROW_TOTAL_HEIGHT_PX;
        this.scrollTopCompensationPx = 0;
        this.isRecalculating = false;
        this.renderRow = false;
        this.afterRowsUpdated = false;
        this.syncScrollBoundVisuals = () => {};
        this.hasCompletedInitialRowsUpdate = false;
        this.isHandlingScrollEvent = false;
        this.currentScrollTop = 0;
        this.currentScrollLeft = 0;

        // enabled=false（ミニテーブル）では全行がDOMに存在する
        this.renderedStart = 0;
        this.renderedEnd = totalRowCount;

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
     * topSpacer: テーブル内のヘッダー行直後（children[1]）に display:table-row + table-cell として挿入する。
     * bottomSpacer: テーブル内の末尾に display:table-row + table-cell として追加する。
     * ヘッダー行が既に存在する状態（initialize() のヘッダー追加直後）で呼ぶこと。
     * enabled=false の場合は何もしない。
     */
    attachSpacers(): void {
        if (!this.enabled) return;

        // 上部スペーサー: テーブル内にヘッダー行直後に挿入する（display:table-row）
        // table-row の高さを制御するため、内部に table-cell を配置する
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

        // 下部スペーサー: テーブル内の末尾に追加する（display:table-row）
        // topSpacer と同じ構造でテーブル内に配置することで、テーブル高さが常に
        // header + topSpacer + frozenRows + viewportRows + bottomSpacer = 全コンテンツ高さ となり、
        // どのスクロール位置でもビューポートがテーブル内に収まる。
        // これにより分離ヘッダーとデータ領域のスクロール整合が高速スクロール時にも崩れにくくなる。
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
    }

    /** スクロールイベントハンドラ。同期的に再計算を実行する */
    onScroll(): void {
        if (!this.enabled) return;
        this.currentScrollTop = this.scrollContainer.scrollTop;
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
        this.scrollContainer.scrollTop = 0;
    }

    setScrollTopCompensationPx(value: number): void {
        this.scrollTopCompensationPx = value;
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
        this.measureActualRowHeight();
        const rowHeight = this.actualRowHeight;
        const headerHeight = this.getHeaderHeight();
        // 行の絶対位置を計算する。固定行は detached/transform によりヘッダー直下へ固定表示されるため、
        // 非固定行の表示領域はヘッダー + 固定行の高さ分だけ下にオフセットされる。
        // しかし仮想コンテンツ全体の高さは全行数 * rowHeight で計算するため、
        // 非固定行の絶対位置は headerHeight + dataRowIndex * rowHeight のまま。
        const rowAbsoluteTop = dataRowIndex * rowHeight + headerHeight;
        const rowAbsoluteBottom = rowAbsoluteTop + rowHeight;
        const viewTop = this.scrollContainer.scrollTop + this.scrollTopCompensationPx;
        const viewBottom = viewTop + this.scrollContainer.clientHeight;
        let targetScrollTop = this.scrollContainer.scrollTop + this.scrollTopCompensationPx;
        if (rowAbsoluteTop < viewTop) {
            const frozenHeight = this.frozenRowCount * rowHeight;
            // 内部スクロールでは compensation 済みなので、ヘッダー高さを二重に引かない。
            const topInset = this.scrollTopCompensationPx > 0 ? 0 : headerHeight + frozenHeight;
            targetScrollTop = rowAbsoluteTop - topInset;
        } else if (rowAbsoluteBottom > viewBottom) {
            targetScrollTop = rowAbsoluteBottom - this.scrollContainer.clientHeight;
        }
        const rawTargetScrollTop = Math.max(0, targetScrollTop - this.scrollTopCompensationPx);
        if (rawTargetScrollTop !== this.scrollContainer.scrollTop) {
            this.scrollContainer.scrollTop = rawTargetScrollTop;
            this.recalculate();
            this.syncScrollBoundVisuals(this.scrollContainer.scrollTop, this.scrollContainer.scrollLeft);
            // スペーサーがテーブル内（display:table-row）にあるため、recalculate のDOM操作後に
            // ブラウザの非同期レイアウト再計算で scrollTop がリセットされることがある。
            // rAF 後に scrollTop を再設定して非同期リセットに対応する。
            const container = this.scrollContainer;
            requestAnimationFrame(() => {
                if (container.scrollTop !== rawTargetScrollTop) {
                    container.scrollTop = rawTargetScrollTop;
                    container.dispatchEvent(new Event('scroll'));
                }
            });
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
    }

    // =========================================================================
    // 内部メソッド
    // =========================================================================

    /**
     * ヘッダー行の実際の高さを取得する。
     * ヘッダー行は detached layer と同じ高さを持つため、スクロール位置計算時のオフセットに使用する。
     */
    private getHeaderHeight(): number {
        this.measureHeaderHeight();
        return this.actualHeaderHeight;
    }

    private measureHeaderHeight(): void {
        const headerRow = this.tableElement.children[0] as HTMLElement | null;
        if (headerRow === null) return;
        const measured = getLayoutBorderBoxHeightPx(headerRow);
        if (measured > 0) this.actualHeaderHeight = measured;
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
        // offsetHeight は整数に丸められるため、DPIスケーリング時に実際のレンダリング高さと乖離する。
        // 例: 125%スケーリングでは border 1px が 0.8px にレンダリングされ、行高さが 20.8px になるが
        // offsetHeight は 21 を返す。スペーサー高さ計算にこの誤差が蓄積すると scrollHeight が変動し
        // スクロールバーのつまみ位置がずれる。getBoundingClientRect().height は小数精度を持つ。
        const measured = getLayoutBorderBoxHeightPx(firstDataRow);
        if (measured > 0) this.actualRowHeight = measured;
    }

    /**
     * 表示範囲を再計算し、DOMの行を更新する。
     * scrollContainer の scrollTop を基に、ビューポートに収まるデータ行の範囲を決定する。
     */
    private recalculate(): void {
        if (this.renderRow === false) return;
        if (this.isRecalculating) return;
        this.isRecalculating = true;

        try {
            this.recalculateCore();
        } finally {
            this.isRecalculating = false;
        }
    }

    private recalculateCore(): void {
        // スクロール中は測定済みの値を使う。DOM差し替え後に layout read を挟むと強制レイアウトが連発する。
        if (!this.isHandlingScrollEvent) this.measureActualRowHeight();
        const rowHeight = this.actualRowHeight;
        const previousRenderedStart = this.renderedStart;
        const previousRenderedEnd = this.renderedEnd;

        const scrollTopWithoutCompensation = this.isHandlingScrollEvent ? this.currentScrollTop : this.scrollContainer.scrollTop;
        const scrollTop = scrollTopWithoutCompensation + this.scrollTopCompensationPx;
        const viewportHeight = this.scrollContainer.clientHeight;
        const headerHeight = this.isHandlingScrollEvent ? this.actualHeaderHeight : this.getHeaderHeight();

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

        // スペーサー高さを行の入れ替え「前」に設定する。
        // 行を削除してからスペーサーを設定すると、一時的にコンテンツ高さが激減し
        // ブラウザがscrollTopをクランプしてスクロール位置が0にリセットされる。
        // スペーサーを先に膨らませることで、行削除中もコンテンツ高さを安定させる。
        // topSpacer は固定行の後のギャップを埋めるため、固定行の高さ分を差し引く。
        const savedScrollLeft = this.isHandlingScrollEvent ? this.currentScrollLeft : this.scrollContainer.scrollLeft;

        if (this.topSpacer !== false) {
            this.topSpacer.style.height = `${Math.max(0, (newStart - this.frozenRowCount) * rowHeight)}px`;
        }
        if (this.bottomSpacer !== false) {
            this.bottomSpacer.style.height = `${Math.max(0, (this.totalRowCount - newEnd) * rowHeight)}px`;
        }

        this.updateRenderedRows(newStart, newEnd);

        this.renderedStart = newStart;
        this.renderedEnd = newEnd;

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
                this.tableElement.insertBefore(row, insertRef);
            }

            // 下端に新しい行を追加する（overlapEnd ～ newEnd の行）
            // bottomSpacer の直前に挿入する
            for (let i = overlapEnd; i < newEnd; i++) {
                const row = this.renderRow(i);
                if (bottomRef !== null) {
                    this.tableElement.insertBefore(row, bottomRef);
                } else {
                    this.tableElement.appendChild(row);
                }
            }
        }
    }
}
