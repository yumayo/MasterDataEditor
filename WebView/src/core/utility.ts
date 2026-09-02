import {
    CELL_FONT,
    CELL_HORIZONTAL_EXTRA,
    COLUMN_AUTO_FIT_MAX_CHARACTER_COUNT,
    COLUMN_HEADER_FONT,
    HEADER_BADGE_AREA_PX,
    HEADER_ICON_AREA_PX,
    HEADER_LABEL_SAFE_GAP_PX,
    HEADER_SIDE_PADDING_PX,
    MIN_COLUMN_WIDTH_PX,
    REFERENCE_HINT_FONT,
    REFERENCE_HINT_MARGIN_PX,
} from "./constant";

const TYPE_CHARACTER_COUNT_BY_TYPE: Record<string, number> = {
    int: 11,
    long: 20,
    float: 11,
    double: 11,
    bool: 1,
    datetime: 19,
};

export class Utility {

    static canvas: HTMLCanvasElement = document.createElement("canvas");

    /**
     * Uses canvas.measureText to compute and return the width of the given text of given font in pixels.
     *
     * @param {String} text The text to be rendered.
     * @param {String} font The css font descriptor that text is to be rendered with (e.g. "bold 14px verdana").
     *
     * @see https://stackoverflow.com/questions/118241/calculate-text-width-with-javascript/21015393#21015393
     */
    static getTextWidth(text: string, font: string) {

        // re-use canvas object for better performance
        const context = Utility.canvas.getContext("2d");

        if (context === null) {
            return 0;
        }

        context.font = font;
        const metrics = context.measureText(text);
        return metrics.width;
    }

    /**
     * 列ヘッダーの最小幅を計算する。
     *
     * ヘッダーは左から PK/FK バッジ領域、列名領域、フィルター/ソート領域に分かれる。
     * hasBadge / hasIcons が false の場合は通常padding分だけを確保する。
     */
    static calculateColumnHeaderMinWidthPx(columnName: string, hasIcons: boolean, hasBadge: boolean): number {
        const labelWidth = Math.ceil(Utility.getTextWidth(columnName, COLUMN_HEADER_FONT));
        const leftArea = hasBadge ? HEADER_BADGE_AREA_PX : HEADER_SIDE_PADDING_PX;
        const rightArea = hasIcons ? HEADER_ICON_AREA_PX : HEADER_SIDE_PADDING_PX;
        const totalWidth = labelWidth + leftArea + rightArea + HEADER_LABEL_SAFE_GAP_PX;
        return Math.max(totalWidth, MIN_COLUMN_WIDTH_PX);
    }

    static calculateColumnTypeMinWidthPx(columnType: string): number {
        const characterCount = TYPE_CHARACTER_COUNT_BY_TYPE[columnType.trim().toLowerCase()];
        if (characterCount === undefined) return 0;
        const sampleText = '0'.repeat(characterCount);
        return Math.ceil(Utility.getTextWidth(sampleText, CELL_FONT)) + CELL_HORIZONTAL_EXTRA;
    }

    static calculateColumnMinimumWidthPx(columnName: string, columnType: string, hasIcons: boolean, hasBadge: boolean): number {
        const headerWidth = Utility.calculateColumnHeaderMinWidthPx(columnName, hasIcons, hasBadge);
        const typeWidth = Utility.calculateColumnTypeMinWidthPx(columnType);
        return Math.max(headerWidth, typeWidth, MIN_COLUMN_WIDTH_PX);
    }

    static clampColumnWidthPx(widthPx: number, columnName: string, columnType: string, hasIcons: boolean, hasBadge: boolean): number {
        const minimumWidth = Utility.calculateColumnMinimumWidthPx(columnName, columnType, hasIcons, hasBadge);
        if (!Number.isFinite(widthPx)) return minimumWidth;
        return Math.max(Math.ceil(widthPx), minimumWidth);
    }

    /**
     * カラム名と型に応じた列幅を計算する。
     * 保存済み幅がない列の初期幅、および自動フィット時のヘッダー幅として使用する。
     */
    static calculateColumnWidth(columnName: string, columnType: string, hasIcons: boolean, hasBadge: boolean = false): string {
        return `${Utility.calculateColumnMinimumWidthPx(columnName, columnType, hasIcons, hasBadge)}px`;
    }

    /**
     * セル値と参照ヒントを合わせた自動フィット幅を計算する。
     * 極端に長い値で列が過度に拡大しないよう、表示順（参照ヒント→セル値）で
     * 最大文字数までを計測対象とする。文字数はサロゲートペアを分割しないコードポイント単位。
     */
    static calculateAutoFitCellWidthPx(cellValue: string, referenceHint: string | null = null): number {
        let remainingCharacters = COLUMN_AUTO_FIT_MAX_CHARACTER_COUNT;

        let hintWidth = 0;
        if (referenceHint !== null && remainingCharacters > 0) {
            const hintCharacters = Array.from(referenceHint).slice(0, remainingCharacters);
            remainingCharacters -= hintCharacters.length;
            if (hintCharacters.length > 0) {
                hintWidth = Utility.getTextWidth(hintCharacters.join(''), REFERENCE_HINT_FONT) + REFERENCE_HINT_MARGIN_PX;
            }
        }

        const valueCharacters = Array.from(cellValue).slice(0, remainingCharacters);
        const valueWidth = Utility.getTextWidth(valueCharacters.join(''), CELL_FONT);
        return Math.ceil(valueWidth + hintWidth) + CELL_HORIZONTAL_EXTRA;
    }

    static clampColumnWidth(width: string, columnName: string, columnType: string, hasIcons: boolean, hasBadge: boolean): string {
        return `${Utility.clampColumnWidthPx(parseFloat(width), columnName, columnType, hasIcons, hasBadge)}px`;
    }

    static getCssStyle(element: HTMLElement, prop: string) {
        return window.getComputedStyle(element, null).getPropertyValue(prop);
    }

    static getCanvasFont(el = document.body) {
        const fontWeight = Utility.getCssStyle(el, 'font-weight') || 'normal';
        const fontSize = Utility.getCssStyle(el, 'font-size') || '16px';
        const fontFamily = Utility.getCssStyle(el, 'font-family') || 'Times New Roman';

        return `${fontWeight} ${fontSize} ${fontFamily}`;
    }
}
