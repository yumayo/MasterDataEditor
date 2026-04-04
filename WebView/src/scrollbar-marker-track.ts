/**
 * ScrollbarMarkerTrack — スクロールバー上にエラー・git変更・差分マーカーを描画する
 *
 * Canvas ベースで .editor-left-slot に配置し、スクロールバー上に重ねて表示する。
 * 軸方向（vertical / horizontal）はコンストラクタで指定し、同じクラスで垂直・水平の両方を扱う。
 *
 * 垂直トラック: .editor-left-slot の右端に配置。行のピクセル座標からマーカー比率を算出。
 * 水平トラック: .editor-left-slot の下端に配置。テーブル幅を100%としたマーカー比率をペイン全幅にマッピング。
 *
 * 描画レーン（主軸に直交する方向を3分割）:
 *   第1レーン: git変更（緑）、差分追加（緑）、差分削除（赤）
 *   第3レーン: バリデーションエラー（赤）
 */

/** マーカー描画エントリ: 描画軸に対する比率で開始位置とサイズを表す */
export interface MarkerEntry {
    /** マーカー開始位置の比率（0〜1）。垂直トラックでは上端、水平トラックでは左端 */
    readonly start: number;
    /** マーカーのサイズ比率（0〜1）。垂直トラックでは高さ、水平トラックでは幅 */
    readonly size: number;
}

/** マーカー描画色: git変更・差分追加（緑） */
export const MARKER_COLOR_GIT_CHANGED = 'rgba(81, 184, 81, 0.8)';
/** マーカー描画色: エラー・差分削除（赤） */
export const MARKER_COLOR_ERROR = 'rgba(255, 60, 60, 0.8)';

/** トラックの軸方向 */
export type MarkerTrackAxis = 'vertical' | 'horizontal';

/** トラックの太さ（主軸に直交する方向のCSSピクセル数） */
const TRACK_THICKNESS = 14;

export class ScrollbarMarkerTrack {

    private readonly canvas: HTMLCanvasElement;
    private readonly resizeObserver: ResizeObserver;
    private readonly scrollContainer: HTMLElement;
    private readonly axis: MarkerTrackAxis;
    private errorMarkers: ReadonlyArray<MarkerEntry>;
    private gitChangedMarkers: ReadonlyArray<MarkerEntry>;
    /** 差分ビュー専用: 削除行マーカー（赤、第1レーン） */
    private diffDeletedMarkers: ReadonlyArray<MarkerEntry>;
    /** 差分ビュー専用: 追加・変更行マーカー（緑、第1レーン） */
    private diffAddedMarkers: ReadonlyArray<MarkerEntry>;

    constructor(parentElement: HTMLElement, scrollContainer: HTMLElement, axis: MarkerTrackAxis, cssClass: string) {
        this.errorMarkers = [];
        this.gitChangedMarkers = [];
        this.diffDeletedMarkers = [];
        this.diffAddedMarkers = [];
        this.scrollContainer = scrollContainer;
        this.axis = axis;

        const canvas = document.createElement('canvas');
        canvas.classList.add(cssClass);
        parentElement.appendChild(canvas);
        this.canvas = canvas;

        // コンテナリサイズ時に canvas サイズを同期して再描画する。
        // 垂直: clientHeight をトラック長、TRACK_THICKNESS を太さに設定。
        // 水平: clientWidth をトラック長、TRACK_THICKNESS を太さに設定。
        this.resizeObserver = new ResizeObserver(() => {
            const dpr = window.devicePixelRatio;
            if (this.axis === 'vertical') {
                const trackLength = this.scrollContainer.clientHeight;
                this.canvas.width = Math.round(TRACK_THICKNESS * dpr);
                this.canvas.height = Math.round(Math.max(0, trackLength) * dpr);
                // CSS height を明示設定（dpr > 1 でのずれ防止）
                this.canvas.style.height = `${Math.max(0, trackLength)}px`;
            } else {
                const trackLength = this.scrollContainer.clientWidth;
                this.canvas.width = Math.round(Math.max(0, trackLength) * dpr);
                this.canvas.height = Math.round(TRACK_THICKNESS * dpr);
                // CSS width を明示設定（dpr > 1 でのずれ防止）
                this.canvas.style.width = `${Math.max(0, trackLength)}px`;
            }
            this.redraw();
        });
        this.resizeObserver.observe(scrollContainer);
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
     * canvas を指定した親要素に再追加する。
     * Editor.setVisiblePanes() 等で leftSlot の子要素が全クリアされた後に呼ばれる。
     */
    reattach(parentElement: HTMLElement): void {
        parentElement.appendChild(this.canvas);
    }

    /**
     * スクロールコンテナの主軸方向のスクロール可能サイズを返す。
     * 垂直トラックでは scrollHeight、水平トラックでは scrollWidth。
     * EditorTable がマーカー位置の比率計算に使用する。
     */
    getScrollLength(): number {
        if (this.axis === 'vertical') return this.scrollContainer.scrollHeight;
        return this.scrollContainer.scrollWidth;
    }

    /** ResizeObserver を解放する */
    destroy(): void {
        this.resizeObserver.disconnect();
    }

    /**
     * canvas にマーカーを描画する。
     * 主軸に直交する方向を3分割し、第1レーンにgit変更/差分、第3レーンにエラーを描画する。
     */
    private redraw(): void {
        const ctx = this.canvas.getContext('2d');
        if (ctx === null) return;
        const w = this.canvas.width;
        const h = this.canvas.height;
        ctx.clearRect(0, 0, w, h);
        if (this.axis === 'vertical') {
            // 垂直: 直交方向=幅を3分割、主軸=高さ
            const laneSize = Math.floor(w / 3);
            this.drawVerticalMarkers(ctx, 0, laneSize, h, this.gitChangedMarkers, MARKER_COLOR_GIT_CHANGED);
            this.drawVerticalMarkers(ctx, 0, laneSize, h, this.diffAddedMarkers, MARKER_COLOR_GIT_CHANGED);
            this.drawVerticalMarkers(ctx, 0, laneSize, h, this.diffDeletedMarkers, MARKER_COLOR_ERROR);
            this.drawVerticalMarkers(ctx, w - laneSize, laneSize, h, this.errorMarkers, MARKER_COLOR_ERROR);
        } else {
            // 水平: 直交方向=高さを3分割、主軸=幅
            const laneSize = Math.floor(h / 3);
            this.drawHorizontalMarkers(ctx, 0, laneSize, w, this.gitChangedMarkers, MARKER_COLOR_GIT_CHANGED);
            this.drawHorizontalMarkers(ctx, 0, laneSize, w, this.diffAddedMarkers, MARKER_COLOR_GIT_CHANGED);
            this.drawHorizontalMarkers(ctx, 0, laneSize, w, this.diffDeletedMarkers, MARKER_COLOR_ERROR);
            this.drawHorizontalMarkers(ctx, h - laneSize, laneSize, w, this.errorMarkers, MARKER_COLOR_ERROR);
        }
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

    /** 水平方向にマーカーを描画する（y固定、xが主軸） */
    private drawHorizontalMarkers(
        ctx: CanvasRenderingContext2D, y: number, markerHeight: number, canvasWidth: number,
        markers: ReadonlyArray<MarkerEntry>, color: string
    ): void {
        if (markers.length === 0) return;
        ctx.fillStyle = color;
        for (const marker of markers) {
            const x = marker.start * canvasWidth;
            const width = Math.max(2, marker.size * canvasWidth);
            ctx.fillRect(x, y, width, markerHeight);
        }
    }
}
