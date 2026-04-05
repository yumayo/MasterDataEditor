import {ROW_TOTAL_HEIGHT_PX} from "./constant";

/**
 * バーチャルスクロールの制御を担うコントローラー。
 *
 * 方式B（テーブル外スペーサー）を採用する。
 * スペーサー要素は .tab-wrapper の子として .editor-table の前後に配置する。
 * テーブル内 DOM 構造は従来と同一のため getRowCount(), getCellPosition(), nth-child セレクタに影響しない。
 *
 * enabled=false（ミニテーブル）の場合は全メソッドがパススルー動作する。
 */
export class VirtualScrollController {
    /** 表示範囲外に余分にレンダリングするオーバースキャン行数 */
    private static readonly OVERSCAN = 10;

    private readonly tableElement: HTMLElement;
    private readonly scrollContainer: HTMLElement;
    private readonly enabled: boolean;

    /** 総データ行数（バッファ行含む） */
    private totalRowCount: number;

    /** 現在DOMに存在するデータ行の開始インデックス（0始まり） */
    private renderedStart: number;
    /** 現在DOMに存在するデータ行の終了インデックス（排他） */
    private renderedEnd: number;

    /** recalculate の再帰呼び出しを防止するフラグ */
    private isRecalculating: boolean;

    /** 実行時に測定した行の実際の高さ(px)。DPIスケーリングを含む正確な値。初回 recalculate 時に測定する */
    private actualRowHeight: number;

    /** 上部スペーサー要素。enabled=true のみ使用。enabled=false なら false */
    private topSpacer: HTMLElement | false;
    /** 下部スペーサー要素。enabled=true のみ使用。enabled=false なら false */
    private bottomSpacer: HTMLElement | false;

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
    private afterRowsUpdated: (() => void) | false;

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
        this.actualRowHeight = ROW_TOTAL_HEIGHT_PX;
        this.isRecalculating = false;
        this.renderRow = false;
        this.afterRowsUpdated = false;

        // enabled=false（ミニテーブル）では全行がDOMに存在する
        this.renderedStart = 0;
        this.renderedEnd = totalRowCount;

        this.topSpacer = false;
        this.bottomSpacer = false;

        if (enabled) {
            this.scrollListener = () => this.onScroll();
            this.scrollContainer.addEventListener('scroll', this.scrollListener);
        } else {
            this.scrollListener = false;
        }
    }

    /**
     * 行生成コールバックを設定する。
     * Object.Assign パターンで EditorTable のプロキシが確定し���後、
     * initializeModules() 内で正しい this を持つコールバックを渡すこと。
     * enabled=false の場合は呼ばなくてよい（renderRow は使用されない）。
     */
    connectRenderRow(renderRow: (dataRowIndex: number) => HTMLElement, afterRowsUpdated: () => void): void {
        this.renderRow = renderRow;
        this.afterRowsUpdated = afterRowsUpdated;
    }

    /**
     * スペーサー要素を生成し、テーブル要素の前後に配置する。
     * tableElement が親要素に追加された後（appendTo 完了後）に呼ぶこと。
     * enabled=false の場合は何もしない。
     */
    attachSpacers(): void {
        if (!this.enabled) return;
        const parent = this.tableElement.parentElement;
        if (parent === null) return;

        // 上部スペーサー: テーブル要素の直前に挿入
        const top = document.createElement('div');
        top.classList.add('virtual-scroll-top-spacer');
        top.style.height = '0px';
        parent.insertBefore(top, this.tableElement);
        this.topSpacer = top;

        // 下部スペーサー: テーブル要素の直後に挿入（filterRowCountElement の前）
        const bottom = document.createElement('div');
        bottom.classList.add('virtual-scroll-bottom-spacer');
        bottom.style.height = '0px';
        // tableElement の直後に挿入する（nextSibling が存在すればその前に、なければ末尾に追加）
        const nextSibling = this.tableElement.nextElementSibling;
        if (nextSibling !== null) {
            parent.insertBefore(bottom, nextSibling);
        } else {
            parent.appendChild(bottom);
        }
        this.bottomSpacer = bottom;
    }

    /** スクロールイベントハンドラ。同期的に再計算を実行する */
    onScroll(): void {
        if (!this.enabled) return;
        this.recalculate();
    }

    /** 総行数が変化した際に呼ぶ */
    updateTotalRowCount(count: number): void {
        this.totalRowCount = count;
        if (!this.enabled) {
            // ミニテーブルでは renderedEnd も同期する
            this.renderedEnd = count;
        }
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
        // 既存のデータ行をすべて削除する（ヘッダー行は残す）
        while (this.tableElement.children.length > 1) {
            this.tableElement.removeChild(this.tableElement.lastChild as Node);
        }
        // renderedStart/renderedEnd を「何も描画されていない」状態にリセットする
        this.renderedStart = 0;
        this.renderedEnd = 0;
        // recalculate がビューポートに基づいて正しい範囲を描画する
        this.recalculate();
    }

    /**
     * 現在の表示範囲 [start, end) を返す。
     * enabled=false では常に [0, totalRowCount) を返す（全行表示中）。
     */
    getRenderedRange(): { start: number; end: number } {
        return { start: this.renderedStart, end: this.renderedEnd };
    }

    /**
     * 論理データ行インデックス（0始まり）をDOMの子要素インデックスに変換する。
     * enabled=false: 常に dataRowIndex + 1 を返す（従来通り）。
     * enabled=true: 表示範囲内なら dataRowIndex - renderedStart + 1、範囲外なら null。
     * +1 はヘッダー行分のオフセット。
     */
    dataRowToDomIndex(dataRowIndex: number): number | null {
        if (!this.enabled) return dataRowIndex + 1;
        if (dataRowIndex < this.renderedStart || dataRowIndex >= this.renderedEnd) return null;
        return dataRowIndex - this.renderedStart + 1;
    }

    /**
     * DOMの子要素インデックスがスペーサー行かどうかを判定する。
     * 方式Bではスペーサーがテーブル外にあるため常にfalse。
     */
    isSpacerIndex(_domChildIndex: number): boolean {
        return false;
    }

    /**
     * スペーサー行の数を返す。
     * 方式Bではスペーサーがテーブル外にあるため常に0。
     */
    spacerCount(): number {
        return 0;
    }

    /**
     * データ行をテーブル末尾に追加する。
     * 方式Bではスペーサーがテーブル外にあるため単純な appendChild。
     * 行追加による renderedEnd の更新は notifyRowAppended() で行うこと。
     */
    appendDataRow(row: HTMLElement): void {
        this.tableElement.appendChild(row);
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
        // ヘッダー行の高さを考慮したスクロール位置を計算
        this.measureActualRowHeight();
        const rowHeight = this.actualRowHeight;
        const headerHeight = this.getHeaderHeight();
        const rowTop = dataRowIndex * rowHeight;
        const rowBottom = rowTop + rowHeight;
        const viewTop = this.scrollContainer.scrollTop - this.getTopSpacerParentOffset();
        const viewBottom = viewTop + this.scrollContainer.clientHeight;
        if (rowTop + headerHeight < viewTop) {
            // 上方向にスクロール
            this.scrollContainer.scrollTop = rowTop + this.getTopSpacerParentOffset();
        } else if (rowBottom + headerHeight > viewBottom) {
            // 下方向にスクロール
            this.scrollContainer.scrollTop = rowBottom + headerHeight - this.scrollContainer.clientHeight + this.getTopSpacerParentOffset();
        }
        // スクロール後に再計算
        this.recalculate();
    }

    /** DOM破棄 */
    destroy(): void {
        if (this.scrollListener !== false) {
            this.scrollContainer.removeEventListener('scroll', this.scrollListener);
        }
        if (this.topSpacer !== false) {
            this.topSpacer.remove();
        }
        if (this.bottomSpacer !== false) {
            this.bottomSpacer.remove();
        }
    }

    // =========================================================================
    // 内部メソッド
    // =========================================================================

    /**
     * ヘッダー行の実際の高さを取得する。
     * ヘッダー行は sticky なので、スクロール位置計算時にオフセットとして使用する。
     */
    private getHeaderHeight(): number {
        const headerRow = this.tableElement.children[0] as HTMLElement;
        if (!headerRow) return ROW_TOTAL_HEIGHT_PX;
        return headerRow.offsetHeight;
    }

    /**
     * DOMに存在するデータ行の実際の高さを測定して actualRowHeight を更新する。
     * DPIスケーリングや将来的なCSS変更にも対応するため、定数ではなく実測値を使う。
     * データ行がDOMに存在しない場合は前回の値（初期値はROW_TOTAL_HEIGHT_PX）を維持する。
     */
    private measureActualRowHeight(): void {
        // children[0] はヘッダー行、children[1] が最初のデータ行
        if (this.tableElement.children.length < 2) return;
        const firstDataRow = this.tableElement.children[1] as HTMLElement;
        if (!firstDataRow) return;
        const measured = firstDataRow.offsetHeight;
        if (measured > 0) this.actualRowHeight = measured;
    }

    /**
     * topSpacer の親要素内でのオフセット（topSpacer 自身の高さ）を取得する。
     * scrollTop にはスペーサーの高さが含まれるため、データ行の位置計算に必要。
     */
    private getTopSpacerParentOffset(): number {
        if (this.topSpacer === false) return 0;
        return this.topSpacer.offsetHeight;
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
        // 実行時の行高さを測定する（DPIスケーリング対応）
        this.measureActualRowHeight();
        const rowHeight = this.actualRowHeight;

        const scrollTop = this.scrollContainer.scrollTop;
        const viewportHeight = this.scrollContainer.clientHeight;

        // 方式B（テーブル外スペーサー）では、scrollTop は topSpacer + テーブル + bottomSpacer
        // 全体の中での位置を示す。scrollTop / rowHeight で先頭行を直接算出できる。
        const firstVisibleRow = Math.max(0, Math.floor(scrollTop / rowHeight));
        const visibleRowCount = Math.ceil(viewportHeight / rowHeight) + 1;
        const lastVisibleRow = firstVisibleRow + visibleRowCount;

        const newStart = Math.max(0, firstVisibleRow - VirtualScrollController.OVERSCAN);
        const newEnd = Math.min(this.totalRowCount, lastVisibleRow + VirtualScrollController.OVERSCAN);

        if (newStart === this.renderedStart && newEnd === this.renderedEnd) return;

        // スペーサー高さを行の入れ替え「前」に設定する。
        // 行を削除してからスペーサーを設定すると、一時的にコンテンツ高さが激減し
        // ブラウザがscrollTopをクランプしてスクロール位置が0にリセットされる。
        // スペーサーを先に膨らませることで、行削除中もコンテンツ高さを安定させる。
        const savedScrollTop = scrollTop;
        const savedScrollLeft = this.scrollContainer.scrollLeft;

        if (this.topSpacer !== false) {
            this.topSpacer.style.height = `${newStart * rowHeight}px`;
        }
        if (this.bottomSpacer !== false) {
            this.bottomSpacer.style.height = `${Math.max(0, (this.totalRowCount - newEnd) * rowHeight)}px`;
        }

        this.updateRenderedRows(newStart, newEnd);

        this.renderedStart = newStart;
        this.renderedEnd = newEnd;

        // 行の入れ替え後に装飾（選択クラス、バリデーション、git差分等）を再適用する
        if (this.afterRowsUpdated !== false) {
            this.afterRowsUpdated();
        }

        // DOM操作でブラウザがスクロール位置をリセットした場合に復元する
        if (this.scrollContainer.scrollTop !== savedScrollTop) {
            this.scrollContainer.scrollTop = savedScrollTop;
        }
        if (this.scrollContainer.scrollLeft !== savedScrollLeft) {
            this.scrollContainer.scrollLeft = savedScrollLeft;
        }
    }

    /**
     * DOMのデータ行を新しい表示範囲に更新する。
     * 既存の行との差分を効率的に計算し、不要な行を削除、新しい行を生成する。
     */
    private updateRenderedRows(newStart: number, newEnd: number): void {
        if (this.renderRow === false) return;

        // 現在の範囲と新しい範囲の重複部分を計算する
        const overlapStart = Math.max(this.renderedStart, newStart);
        const overlapEnd = Math.min(this.renderedEnd, newEnd);

        if (overlapStart >= overlapEnd) {
            // 重複なし: 全行を入れ替える
            // 既存のデータ行をすべて削除する（ヘッダー行は残す）
            while (this.tableElement.children.length > 1) {
                this.tableElement.removeChild(this.tableElement.lastChild as Node);
            }
            // 新しい範囲の行をすべて生成する
            for (let i = newStart; i < newEnd; i++) {
                const row = this.renderRow(i);
                this.tableElement.appendChild(row);
            }
        } else {
            // 重複あり: 差分のみ更新する

            // 上端の不要な行を削除する（renderedStart ～ overlapStart の行）
            const removeTopCount = overlapStart - this.renderedStart;
            for (let i = 0; i < removeTopCount; i++) {
                // children[1] がデータ行の先頭（children[0] はヘッダー行）
                const row = this.tableElement.children[1];
                if (row) this.tableElement.removeChild(row);
            }

            // 下端の不要な行を削除する（overlapEnd ～ renderedEnd の行）
            const removeBottomCount = this.renderedEnd - overlapEnd;
            for (let i = 0; i < removeBottomCount; i++) {
                const row = this.tableElement.lastChild;
                if (row) this.tableElement.removeChild(row);
            }

            // 上端に新しい行を挿入する（newStart ～ overlapStart の行）
            // ヘッダー行の次（children[1]）に順番に挿入する
            const headerRow = this.tableElement.children[0];
            const insertRef = headerRow.nextSibling;
            for (let i = newStart; i < overlapStart; i++) {
                const row = this.renderRow(i);
                this.tableElement.insertBefore(row, insertRef);
            }

            // 下端に新しい行を追加する（overlapEnd ～ newEnd の行）
            for (let i = overlapEnd; i < newEnd; i++) {
                const row = this.renderRow(i);
                this.tableElement.appendChild(row);
            }
        }
    }
}
