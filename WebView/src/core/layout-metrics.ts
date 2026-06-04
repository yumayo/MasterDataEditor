export function getEffectiveCssZoom(element: HTMLElement | null): number {
    let zoom = 1;
    for (let current = element; current !== null; current = current.parentElement) {
        const rawZoom = window.getComputedStyle(current).getPropertyValue('zoom');
        if (rawZoom === '' || rawZoom === 'normal') continue;
        const value = Number.parseFloat(rawZoom);
        if (Number.isFinite(value) && value > 0) zoom *= value;
    }
    return zoom;
}

function visualLengthToLayoutPx(value: number, referenceElement: HTMLElement | null): number {
    const zoom = getEffectiveCssZoom(referenceElement);
    return zoom > 0 ? value / zoom : value;
}

export function getLayoutBorderBoxWidthPx(element: HTMLElement): number {
    return visualLengthToLayoutPx(element.getBoundingClientRect().width, element);
}

export function getLayoutBorderBoxHeightPx(element: HTMLElement): number {
    return visualLengthToLayoutPx(element.getBoundingClientRect().height, element);
}

export function getLayoutLeftRelativeToPx(element: HTMLElement, container: HTMLElement): number {
    return visualLengthToLayoutPx(
        element.getBoundingClientRect().left - container.getBoundingClientRect().left,
        container,
    );
}

export function getLayoutRightRelativeToPx(element: HTMLElement, container: HTMLElement): number {
    return visualLengthToLayoutPx(
        element.getBoundingClientRect().right - container.getBoundingClientRect().left,
        container,
    );
}

export function getLayoutTopRelativeToPx(element: HTMLElement, container: HTMLElement): number {
    return visualLengthToLayoutPx(
        element.getBoundingClientRect().top - container.getBoundingClientRect().top,
        container,
    );
}
