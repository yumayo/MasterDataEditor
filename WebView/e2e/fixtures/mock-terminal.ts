import type {Page} from '@playwright/test';

export interface TerminalMockOptions {
    startError: string | null;
    startDelayMs: number;
}

export interface TerminalMockRequest {
    type: string;
    requestId?: string;
    outputId?: string;
    sessionId: string;
    cols?: number;
    rows?: number;
    data?: string;
}

interface TerminalMockState extends TerminalMockOptions {
    requests: TerminalMockRequest[];
    closeExitCode: number;
    dispatch(data: object): void;
}

interface TerminalMockWindow {
    __mockTerminal: TerminalMockState;
    __mockTerminalHandle(request: TerminalMockRequest, dispatch: (data: object) => void): void;
}

/** シェルの実行を伴わず、WebView2の端末通信だけを再現する。 */
export async function installTerminalMockAsync(page: Page, options: TerminalMockOptions): Promise<void> {
    await page.addInitScript((config: TerminalMockOptions) => {
        const mockWindow = window as unknown as TerminalMockWindow;
        mockWindow.__mockTerminal = {
            ...config,
            requests: [],
            closeExitCode: 0,
            dispatch(): void { throw new Error('ターミナルの初回リクエストがまだありません'); },
        };
        mockWindow.__mockTerminalHandle = (request, dispatch) => {
            const state = mockWindow.__mockTerminal;
            state.dispatch = dispatch;
            state.requests.push(request);
            if (request.type === 'terminal_output_ack') return;
            const response = {
                type: request.type.replace(/_request$/, '_response'),
                requestId: request.requestId,
                sessionId: request.sessionId,
            };
            if (request.type === 'terminal_start_request') {
                window.setTimeout(() => {
                    if (state.startError !== null) {
                        dispatch({...response, success: false, error: state.startError, stack: 'at MockTerminal.Start()'});
                    } else {
                        dispatch({...response, success: true, data: {shell: 'Windows PowerShell', cwd: 'C:\\workspace'}});
                    }
                }, state.startDelayMs);
                return;
            }
            dispatch({...response, success: true});
            if (request.type === 'terminal_close_request') {
                // 要求応答のawait継続が先に実行される、ネイティブ側のイベント順序を再現する。
                window.setTimeout(() => dispatch({type: 'terminal_exit', sessionId: request.sessionId, exitCode: state.closeExitCode}), 0);
            }
        };
    }, options);
}

export async function readTerminalRequestsAsync(page: Page, type: string): Promise<TerminalMockRequest[]> {
    return page.evaluate(requestType => (window as unknown as TerminalMockWindow).__mockTerminal.requests.filter(request => request.type === requestType), type);
}

export async function dispatchTerminalEventAsync(page: Page, event: object): Promise<void> {
    await page.evaluate(payload => {
        const state = (window as unknown as TerminalMockWindow).__mockTerminal;
        const output = 'type' in payload && payload.type === 'terminal_output' && !('outputId' in payload)
            ? {...payload, outputId: crypto.randomUUID()} : payload;
        state.dispatch(output);
    }, event);
}

export async function clearTerminalStartErrorAsync(page: Page): Promise<void> {
    await page.evaluate(() => { (window as unknown as TerminalMockWindow).__mockTerminal.startError = null; });
}

export async function configureTerminalCloseExitAsync(page: Page, exitCode: number): Promise<void> {
    await page.evaluate(code => { (window as unknown as TerminalMockWindow).__mockTerminal.closeExitCode = code; }, exitCode);
}
