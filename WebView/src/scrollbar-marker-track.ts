/**
 * ScrollbarMarkerTrack — スクロールバー右端にエラー・git変更マーカーを描画する
 *
 * Canvas ベースで .editor-left-slot の右端に配置し、スクロールバー上に重ねて表示する。
 * マーカー位置は行のピクセル座標（offsetTop / scrollHeight）で計算し、
 * スクロールバーのthumb位置と正確に一致させる。
 * git変更（緑）は左1/3、エラー（赤）は右1/3に描画する。
 */
export class ScrollbarMarkerTrack {

    private readonly canvas: HTMLCanvasElement;
    private readonly resizeObserver: ResizeObserver;
    /** スクロールコンテナ（.editor-left-pane）— clientHeight で垂直スクロールバートラック高さを取得 */
    private readonly scrollContainer: HTMLElement;
    /** マーカー描画データ: 各マーカーの位置（0〜1の比率）と高さ比率 */
    private errorMarkers: ReadonlyArray<MarkerEntry>;
    private gitChangedMarkers: ReadonlyArray<MarkerEntry>;

    constructor(parentElement: HTMLElement, scrollContainer: HTMLElement) {
        this.errorMarkers = [];
        this.gitChangedMarkers = [];
        this.scrollContainer = scrollContainer;

        // canvas要素を作成して親要素に追加する
        const canvas = document.createElement('canvas');
        canvas.classList.add('scrollbar-marker-track');
        parentElement.appendChild(canvas);
        this.canvas = canvas;

        // コンテナリサイズ時に canvas サイズを同期して再描画する。
        // スクロールコンテナの clientHeight（水平スクロールバーを除く表示領域高さ）を使うことで、
        // 垂直スクロールバートラックの高さと正確に一致させる。
        this.resizeObserver = new ResizeObserver(() => {
            const trackHeight = this.scrollContainer.clientHeight;
            const dpr = window.devicePixelRatio;
            this.canvas.width = Math.round(14 * dpr);
            this.canvas.height = Math.round(Math.max(0, trackHeight) * dpr);
            // CSS height を明示的に設定する。canvas.height は物理ピクセル（trackHeight × dpr）だが、
            // CSS height を指定しないとブラウザは属性値をそのまま CSS ピクセルとして扱うため、
            // dpr > 1 の環境で canvas が dpr 倍の高さで表示されマーカー位置がずれる。
            this.canvas.style.height = `${Math.max(0, trackHeight)}px`;
            this.redraw();
        });
        this.resizeObserver.observe(scrollContainer);
    }

    /**
     * マーカーデータを一括更新して再描画する。
     * 各マーカーは scrollHeight に対する比率（0〜1）で位置と高さを保持する。
     */
    update(errorMarkers: ReadonlyArray<MarkerEntry>, gitChangedMarkers: ReadonlyArray<MarkerEntry>): void {
        this.errorMarkers = errorMarkers;
        this.gitChangedMarkers = gitChangedMarkers;
        this.redraw();
    }

    /** 全マーカーをクリアする（タブ非アクティブ化時） */
    clear(): void {
        this.errorMarkers = [];
        this.gitChangedMarkers = [];
        this.redraw();
    }

    /**
     * canvas を指定した親要素に再追加する。
     * Editor.setVisiblePanes() 等で leftSlot の子要素が全クリアされた後に呼ばれる。
     */
    reattach(parentElement: HTMLElement): void {
        parentElement.appendChild(this.canvas);
    }

    /** ResizeObserver を解放する */
    destroy(): void {
        this.resizeObserver.disconnect();
    }

    /**
     * canvas にマーカーを描画する。
     * git変更（緑）は左1/3、エラー（赤）は右1/3に描画する。
     */
    private redraw(): void {
        const ctx = this.canvas.getContext('2d');
        if (ctx === null) return;
        const w = this.canvas.width;
        const h = this.canvas.height;
        ctx.clearRect(0, 0, w, h);
        const thirdW = Math.floor(w / 3);
        // git変更マーカー（緑）を左1/3に描画する
        this.drawMarkers(ctx, 0, thirdW, h, this.gitChangedMarkers, 'rgba(81, 184, 81, 0.8)');
        // エラーマーカー（赤）を右1/3に描画する
        this.drawMarkers(ctx, w - thirdW, thirdW, h, this.errorMarkers, 'rgba(255, 60, 60, 0.8)');
    }

    /** 指定色でマーカーを描画する */
    private drawMarkers(
        ctx: CanvasRenderingContext2D, x: number, markerWidth: number, canvasHeight: number,
        markers: ReadonlyArray<MarkerEntry>, color: string
    ): void {
        if (markers.length === 0) return;
        ctx.fillStyle = color;
        for (const marker of markers) {
            const y = marker.top * canvasHeight;
            const height = Math.max(2, marker.height * canvasHeight);
            ctx.fillRect(x, y, markerWidth, height);
        }
    }
}

/** マーカー描画エントリ: scrollHeight に対する比率で位置と高さを表す */
export interface MarkerEntry {
    /** マーカー上端の比率（0〜1） */
    readonly top: number;
    /** マーカーの高さ比率（0〜1） */
    readonly height: number;
}
