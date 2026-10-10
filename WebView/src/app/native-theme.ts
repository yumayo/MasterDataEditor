/** WebViewで使用中の固定色だけを渡す。ネイティブの資源名や任意のCSSは公開しない。 */
export function notifyNativeTheme(themeRoot: HTMLElement): void {
    const style = getComputedStyle(themeRoot);
    const context = document.createElement('canvas').getContext('2d');
    if (context === null) throw new Error('ネイティブ画面のテーマ色を変換できません');
    const variables = {
        background: '--background-color', surface: '--background-sub-color', foreground: '--font-color',
        secondaryForeground: '--secondary-font-color', border: '--border-color', hover: '--hover-color',
        pressed: '--hover-color-strong', focus: '--focus-border',
    };
    const palette = Object.fromEntries(Object.entries(variables).map(([name, variable]) => {
        const value = style.getPropertyValue(variable).trim();
        // 無効なfillStyleは以前の値を残すため、異なる初期値から同じ色に解決することを確認する。
        context.fillStyle = '#000000';
        context.fillStyle = value;
        const normalized = context.fillStyle;
        context.fillStyle = '#ffffff';
        context.fillStyle = value;
        if (context.fillStyle !== normalized) throw new Error(`テーマ色が不正です: ${variable}`);
        const hex = /^#([0-9a-f]{6})$/i.exec(normalized);
        if (hex !== null) {
            return [name, [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16), 255]];
        }
        const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(normalized);
        if (rgba === null) throw new Error(`テーマ色をRGBAへ変換できません: ${variable}`);
        // ピクセル描画を経由すると半透明色のRGBが丸められるため、正規化文字列から取り出す。
        const alpha = rgba.length > 4 && typeof rgba[4] === 'string' ? Math.round(Number(rgba[4]) * 255) : 255;
        return [name, [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), alpha]];
    }));
    window.chrome.webview.postMessage(JSON.stringify({type: 'native_theme_changed', palette}));
}
