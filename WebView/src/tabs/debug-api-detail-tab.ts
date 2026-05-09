import type {DebugConsoleEntryDetail} from "../panels/debug-console";

interface PayloadView {
    lineNumbers: HTMLElement;
    code: HTMLElement;
}

export class DebugApiDetailTab {
    private readonly element: HTMLElement;
    private readonly titleElement: HTMLElement;
    private readonly metaElement: HTMLElement;
    private readonly requestView: PayloadView;
    private readonly responseView: PayloadView;

    constructor(detail: DebugConsoleEntryDetail) {
        const element = document.createElement('div');
        element.classList.add('debug-api-detail-tab');
        this.element = element;

        const header = document.createElement('div');
        header.classList.add('debug-api-detail-header');
        element.appendChild(header);

        const title = document.createElement('div');
        title.classList.add('debug-api-detail-title');
        header.appendChild(title);
        this.titleElement = title;

        const meta = document.createElement('div');
        meta.classList.add('debug-api-detail-meta');
        header.appendChild(meta);
        this.metaElement = meta;

        const body = document.createElement('div');
        body.classList.add('debug-api-detail-body');
        element.appendChild(body);

        const requestSection = this.createSection('Request');
        body.appendChild(requestSection.section);
        this.requestView = requestSection.view;

        const responseSection = this.createSection('Response');
        body.appendChild(responseSection.section);
        this.responseView = responseSection.view;

        this.update(detail);
    }

    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    show(): void {
        this.element.style.display = '';
    }

    hide(): void {
        this.element.style.display = 'none';
    }

    remove(): void {
        this.element.remove();
    }

    update(detail: DebugConsoleEntryDetail): void {
        this.titleElement.textContent = detail.apiName;
        this.titleElement.title = detail.apiName;
        this.renderMeta(detail);
        this.renderPayload(this.requestView, this.formatPayload(detail.request));
        this.renderPayload(this.responseView, this.formatPayload(detail.response ?? { success: false, error: detail.error ?? 'No response' }));
    }

    private createSection(title: string): { section: HTMLElement; view: PayloadView } {
        const section = document.createElement('section');
        section.classList.add('debug-api-detail-section');

        const heading = document.createElement('div');
        heading.classList.add('debug-api-detail-section-title');
        heading.textContent = title;
        section.appendChild(heading);

        const container = document.createElement('div');
        container.classList.add('debug-api-detail-pre');

        const lineNumbers = document.createElement('div');
        lineNumbers.classList.add('debug-api-detail-line-numbers');
        lineNumbers.setAttribute('aria-hidden', 'true');
        container.appendChild(lineNumbers);

        const code = document.createElement('pre');
        code.classList.add('debug-api-detail-code');
        container.appendChild(code);

        section.appendChild(container);

        return { section, view: { lineNumbers, code } };
    }

    private renderMeta(detail: DebugConsoleEntryDetail): void {
        while (this.metaElement.firstChild) {
            this.metaElement.removeChild(this.metaElement.firstChild);
        }
        this.appendMeta('requestId=' + (detail.requestId ?? ''));
        this.appendMeta('status=' + (detail.status ?? ''));
        if (detail.durationUs !== undefined) {
            this.appendMeta('duration=' + (detail.durationUs / 1000).toFixed(1) + 'ms');
        }
        if (detail.caller !== undefined) {
            this.appendMeta('caller=' + detail.caller);
        }
    }

    private appendMeta(text: string): void {
        const span = document.createElement('span');
        span.textContent = text;
        span.title = text;
        this.metaElement.appendChild(span);
    }

    private renderPayload(view: PayloadView, value: string): void {
        const normalizedValue = value.replace(/\r\n?/g, '\n');
        const lineCount = normalizedValue.split('\n').length;
        const lineNumbers = Array.from({ length: lineCount }, (_, index) => String(index + 1)).join('\n');
        view.lineNumbers.textContent = lineNumbers;
        view.lineNumbers.style.setProperty('--debug-api-detail-line-number-width', `${Math.max(4, String(lineCount).length)}ch`);
        view.code.textContent = normalizedValue;
    }

    private formatPayload(value: unknown): string {
        if (typeof value === 'string') return value;
        try {
            return JSON.stringify(value, null, 2);
        } catch (error) {
            return String(error);
        }
    }
}
