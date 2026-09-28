export type PopupSide = 'above' | 'below';

interface PopupPlacementOptions {
    side: PopupSide | 'auto';
    maxWidth: number;
    maxHeight: number;
    gap: number;
}

/** 固定配置のポップアップを画面内へ収める。返した表示方向を再指定すると本文更新時も向きを維持できる。 */
export function placePopupInViewport(element: HTMLElement, anchor: {left: number; top: number; bottom: number}, options: PopupPlacementOptions): PopupSide {
    const margin = 8;
    const scrollTop = element.scrollTop;
    const scrollLeft = element.scrollLeft;
    const widthLimit = Math.max(0, window.innerWidth - margin * 2);
    const heightLimit = Math.max(0, window.innerHeight - margin * 2);
    element.style.maxWidth = Math.min(options.maxWidth, widthLimit) + 'px';
    element.style.maxHeight = Math.min(options.maxHeight, heightLimit) + 'px';

    // 幅を先に制限して折り返し後の高さを測り、下側へ入らないときは余裕のある側へ開く。
    const naturalHeight = element.getBoundingClientRect().height;
    const above = Math.max(0, anchor.top - options.gap - margin);
    const below = Math.max(0, window.innerHeight - anchor.bottom - options.gap - margin);
    const side = options.side === 'auto' ? (naturalHeight <= below || below >= above ? 'below' : 'above') : options.side;
    const availableHeight = side === 'below' ? below : above;
    element.style.maxHeight = Math.min(options.maxHeight, heightLimit, availableHeight) + 'px';

    const popup = element.getBoundingClientRect();
    const top = side === 'below' ? anchor.bottom + options.gap : anchor.top - popup.height - options.gap;
    element.style.left = Math.max(margin, Math.min(anchor.left, window.innerWidth - popup.width - margin)) + 'px';
    element.style.top = Math.max(margin, Math.min(top, window.innerHeight - popup.height - margin)) + 'px';
    // 計測中に一時的に高さを広げても、本文を読んでいる位置を失わない。
    element.scrollTop = scrollTop;
    element.scrollLeft = scrollLeft;
    return side;
}
