import {ValidationPanel} from "../panels/validation-panel";

/**
 * エラーセルホバー時のツールチップ表示クラス
 *
 * .cell-error クラスを持つセルにマウスホバーすると 500ms 後にツールチップを表示する。
 * ツールチップには ValidationPanel から取得したエラーメッセージを改行区切りで表示する。
 *
 * DOM配置: document.body 直下に固定配置し、position:fixed でビューポート座標を使用する。
 * シングルトン設計: main.ts が1つだけ生成し、全 EditorTable が共有する。
 *
 * Undo/Redo 不要（ツールチップは読み取り専用の一時的UI。データ変更を伴わない）。
 */
export class ErrorTooltip {
    /** ツールチップのDOM要素（document.body 直下に配置） */
    private readonly element: HTMLDivElement;
    /** ホバー開始から表示までのディレイタイマーID（0 = タイマーなし） */
    private showTimerId: number;
    /** ホバー中のセル要素（タイマー発火時の一致判定用）。ホバー中でなければ false */
    private hoveredCell: HTMLElement | false;
    /** バリデーションパネル（エラーメッセージの取得元） */
    private readonly validationPanel: ValidationPanel;

    /** ツールチップ表示までのディレイ（ミリ秒） */
    private static readonly SHOW_DELAY_MS = 500;

    constructor(validationPanel: ValidationPanel) {
        this.validationPanel = validationPanel;
        this.showTimerId = 0;
        this.hoveredCell = false;

        this.element = document.createElement('div');
        this.element.classList.add('error-tooltip');
        document.body.appendChild(this.element);
    }

    /**
     * エラーセルにマウスが入った時に呼ばれる。
     * 500ms のディレイ後にツールチップを表示する。
     *
     * @param cell ホバー中のセル要素
     * @param tableName テーブル名（ValidationPanel へのクエリ用）
     * @param storeRowIndex ストア行インデックス（0始まり）
     * @param storeColumnIndex ストア列インデックス（0始まり）
     */
    showAfterDelay(cell: HTMLElement, tableName: string, storeRowIndex: number, storeColumnIndex: number): void {
        // 前回のタイマーが残存していればキャンセルする
        this.cancelTimer();
        this.hoveredCell = cell;

        this.showTimerId = window.setTimeout(() => {
            this.showTimerId = 0;
            // タイマー発火時にまだ同じセルにホバー中かを確認する
            if (this.hoveredCell !== cell) return;
            // ValidationPanel からセル位置に対応するエラーを取得する
            const errors = this.validationPanel.getErrorsForCell(tableName, storeRowIndex, storeColumnIndex);
            if (errors.length === 0) return;
            // エラーメッセージを改行区切りで結合してツールチップに表示する
            this.element.textContent = errors.map(e => e.message).join('\n');
            // ツールチップの表示位置をセルの下端に配置する（画面下端に近い場合はセルの上端）
            const cellRect = cell.getBoundingClientRect();
            const tooltipHeight = this.element.offsetHeight;
            let top = cellRect.bottom + 4;
            if (top + tooltipHeight > window.innerHeight) {
                top = cellRect.top - tooltipHeight - 4;
                if (top < 0) top = 0;
            }
            let left = cellRect.left;
            const tooltipWidth = this.element.offsetWidth;
            if (left + tooltipWidth > window.innerWidth) {
                left = Math.max(0, window.innerWidth - tooltipWidth);
            }
            this.element.style.top = top + 'px';
            this.element.style.left = left + 'px';
            this.element.classList.add('visible');
        }, ErrorTooltip.SHOW_DELAY_MS);
    }

    /**
     * セルからマウスが離れた時に呼ばれる。
     * ディレイタイマーをキャンセルし、表示中のツールチップを非表示にする。
     */
    hide(): void {
        this.cancelTimer();
        this.hoveredCell = false;
        this.element.classList.remove('visible');
    }

    /**
     * ディレイタイマーをキャンセルする。
     */
    private cancelTimer(): void {
        if (this.showTimerId !== 0) {
            window.clearTimeout(this.showTimerId);
            this.showTimerId = 0;
        }
    }
}
