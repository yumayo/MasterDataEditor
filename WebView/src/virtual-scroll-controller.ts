/**
 * バーチャルスクロールの制御を担うコントローラー。
 *
 * Phase 1: スペーサー行なし、全行DOM存在。クラスとAPIの骨格のみ。
 *          enabled=true でも DOM 構造は従来と同一（スペーサー行を追加しない）。
 *          Phase 2 でスペーサー行追加・行の動的追加/削除を実装する。
 *
 * enabled=false（ミニテーブル）の場合は将来的にもスペーサー行を追加しない。
 */
export class VirtualScrollController {
    private readonly tableElement: HTMLElement;
    private readonly scrollContainer: HTMLElement;

    /** 総データ行数（バッファ行含む） */
    private totalRowCount: number;

    /** スクロールイベントリスナー（destroy時の解除用に保持） */
    private readonly scrollListener: (() => void) | false;

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

        if (enabled) {
            this.scrollListener = () => this.onScroll();
            this.scrollContainer.addEventListener('scroll', this.scrollListener);
        } else {
            this.scrollListener = false;
        }
    }

    /** スクロールイベントハンドラ（Phase 2 で実装） */
    onScroll(): void {
        // Phase 1: 何もしない
    }

    /** 総行数が変化した際に呼ぶ */
    updateTotalRowCount(count: number): void {
        this.totalRowCount = count;
    }

    /** 表示範囲を強制再計算する（Phase 2 で実装） */
    forceRecalculate(): void {
        // Phase 1: 何もしない
    }

    /**
     * 現在の表示範囲 [start, end) を返す。
     * Phase 1 では常に [0, totalRowCount) を返す（全行表示中）。
     */
    getRenderedRange(): { start: number; end: number } {
        return { start: 0, end: this.totalRowCount };
    }

    /**
     * 論理データ行インデックス（0始まり）をDOMの子要素インデックスに変換する。
     * Phase 1: スペーサー行がないため、常に dataRowIndex + 1 を返す。
     * Phase 2: 表示範囲外ならnullを返す。
     */
    dataRowToDomIndex(dataRowIndex: number): number | null {
        // Phase 1: スペーサー行なし。DOM構造は [ヘッダー(0), dataRow0(1), dataRow1(2), ...]
        return dataRowIndex + 1;
    }

    /**
     * DOMの子要素インデックスがスペーサー行かどうかを判定する。
     * Phase 1: スペーサー行がないため常にfalse。
     */
    isSpacerIndex(_domChildIndex: number): boolean {
        // Phase 1: スペーサー行なし
        return false;
    }

    /**
     * スペーサー行の数を返す。
     * Phase 1: スペーサー行なしのため0。
     */
    spacerCount(): number {
        // Phase 1: スペーサー行なし
        return 0;
    }

    /**
     * データ行をテーブル末尾に追加する。
     * Phase 1: 単純な appendChild。
     * Phase 2: bottomSpacerの手前に挿入する。
     */
    appendDataRow(row: HTMLElement): void {
        this.tableElement.appendChild(row);
    }

    /** DOM破棄 */
    destroy(): void {
        if (this.scrollListener !== false) {
            this.scrollContainer.removeEventListener('scroll', this.scrollListener);
        }
    }
}
