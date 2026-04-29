/**
 * ScrollbarMarkerTrack — 右側スクロールバー上にエラー・git変更・差分マーカーを描画する
 *
 * Canvas ベースでスクロール viewport のオーバーレイ親要素に配置し、右端スクロールバー上に重ねて表示する。
 * 行のピクセル座標からマーカー比率を算出し、縦方向の位置へ反映する。
 *
 * 描画レーン（幅を3分割）:
 *   第1レーン: git変更（緑）、差分追加（緑）、差分削除（赤）
 *   第3レーン: バリデーションエラー（赤）
 */

/** マーカー描画エントリ: トラック全高に対する比率で開始位置とサイズを表す */
export interface MarkerEntry {
    /** マーカー開始位置の比率（0〜1）。0 が上端、1 が下端 */
    readonly start: number;
    /** マーカーのサイズ比率（0〜1）。トラック上で占める高さ */
    readonly size: number;
}

/** マーカー描画色: git変更・差分追加（緑） */
export const MARKER_COLOR_GIT_CHANGED = 'rgba(81, 184, 81, 0.8)';
/** マーカー描画色: エラー・差分削除（赤） */
export const MARKER_COLOR_ERROR = 'rgba(255, 60, 60, 0.8)';

/** トラックの太さ（主軸に直交する方向のCSSピクセル数） */
const TRACK_THICKNESS = 14;

export class ScrollbarMarkerTrack {

    private readonly canvas: HTMLCanvasElement;
    private readonly resizeObserver: ResizeObserver;
    private scrollContainer: HTMLElement;
    private errorMarkers: ReadonlyArray<MarkerEntry>;
    private gitChangedMarkers: ReadonlyArray<MarkerEntry>;
    /** 差分ビュー専用: 削除行マーカー（赤、第1レーン） */
    private diffDeletedMarkers: ReadonlyArray<MarkerEntry>;
    /** 差分ビュー専用: 追加・変更行マーカー（緑、第1レーン） */
    private diffAddedMarkers: ReadonlyArray<MarkerEntry>;

    constructor(parentElement: HTMLElement, scrollContainer: HTMLElement, cssClass: string) {
        this.errorMarkers = [];
        this.gitChangedMarkers = [];
        this.diffDeletedMarkers = [];
        this.diffAddedMarkers = [];
        this.scrollContainer = scrollContainer;

        const canvas = document.createElement('canvas');
        canvas.classList.add(cssClass);
        parentElement.appendChild(canvas);
        this.canvas = canvas;

        // コンテナリサイズ時に canvas サイズを同期して再描画する。
        // clientHeight をトラック長、TRACK_THICKNESS を太さに設定する。
        this.resizeObserver = new ResizeObserver(() => { this.resizeCanvas(); });
        this.resizeObserver.observe(scrollContainer);
        this.resizeCanvas();
    }

    /**
     * 通常テーブル用: エラーとgit変更のマーカーを更新して再描画する。
     * 各マーカーは主軸方向の比率（0〜1）で位置とサイズを保持する。
     */
    updateNormal(errorMarkers: ReadonlyArray<MarkerEntry>, gitChangedMarkers: ReadonlyArray<MarkerEntry>): void {
        this.errorMarkers = errorMarkers;
        this.gitChangedMarkers = gitChangedMarkers;
        this.diffDeletedMarkers = [];
        this.diffAddedMarkers = [];
        this.redraw();
    }

    /**
     * 差分ビュー用: 削除行と追加・変更行のマーカーを更新して再描画する。
     * 削除マーカーは赤、追加・変更マーカーは緑で、いずれも第1レーンに描画する。
     */
    updateDiff(diffDeletedMarkers: ReadonlyArray<MarkerEntry>, diffAddedMarkers: ReadonlyArray<MarkerEntry>): void {
        this.errorMarkers = [];
        this.gitChangedMarkers = [];
        this.diffDeletedMarkers = diffDeletedMarkers;
        this.diffAddedMarkers = diffAddedMarkers;
        this.redraw();
    }

    /** 全マーカーをクリアする（タブ非アクティブ化時） */
    clear(): void {
        this.errorMarkers = [];
        this.gitChangedMarkers = [];
        this.diffDeletedMarkers = [];
        this.diffAddedMarkers = [];
        this.redraw();
    }

    /**
     * canvas を指定した親要素に再追加し、監視対象のスクロールコンテナを必要に応じて差し替える。
     */
    reattach(parentElement: HTMLElement, scrollContainer: HTMLElement): void {
        parentElement.appendChild(this.canvas);
        if (this.scrollContainer !== scrollContainer) {
            this.resizeObserver.disconnect();
            this.scrollContainer = scrollContainer;
            this.resizeObserver.observe(scrollContainer);
        }
        this.resizeCanvas();
    }

    /** ResizeObserver を解放する */
    destroy(): void {
        this.resizeObserver.disconnect();
    }

    private resizeCanvas(): void {
        const dpr = window.devicePixelRatio;
        const trackLength = this.scrollContainer.clientHeight;
        this.canvas.width = Math.round(TRACK_THICKNESS * dpr);
        this.canvas.height = Math.round(Math.max(0, trackLength) * dpr);
        // CSS height を明示設定（dpr > 1 でのずれ防止）
        this.canvas.style.height = `${Math.max(0, trackLength)}px`;
        this.redraw();
    }

    /**
     * canvas にマーカーを描画する。
     * 幅を3分割し、第1レーンにgit変更/差分、第3レーンにエラーを描画する。
     */
    private redraw(): void {
        const ctx = this.canvas.getContext('2d');
        if (ctx === null) return;
        const w = this.canvas.width;
        const h = this.canvas.height;
        ctx.clearRect(0, 0, w, h);
        const laneSize = Math.floor(w / 3);
        this.drawVerticalMarkers(ctx, 0, laneSize, h, this.gitChangedMarkers, MARKER_COLOR_GIT_CHANGED);
        this.drawVerticalMarkers(ctx, 0, laneSize, h, this.diffAddedMarkers, MARKER_COLOR_GIT_CHANGED);
        this.drawVerticalMarkers(ctx, 0, laneSize, h, this.diffDeletedMarkers, MARKER_COLOR_ERROR);
        this.drawVerticalMarkers(ctx, w - laneSize, laneSize, h, this.errorMarkers, MARKER_COLOR_ERROR);
    }

    /** 垂直方向にマーカーを描画する（x固定、yが主軸） */
    private drawVerticalMarkers(
        ctx: CanvasRenderingContext2D, x: number, markerWidth: number, canvasHeight: number,
        markers: ReadonlyArray<MarkerEntry>, color: string
    ): void {
        if (markers.length === 0) return;
        ctx.fillStyle = color;
        for (const marker of markers) {
            const y = marker.start * canvasHeight;
            const height = Math.max(2, marker.size * canvasHeight);
            ctx.fillRect(x, y, markerWidth, height);
        }
    }

}
