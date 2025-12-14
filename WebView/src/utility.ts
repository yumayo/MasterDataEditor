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