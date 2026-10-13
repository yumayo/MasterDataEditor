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
    tool?: string;
}

interface TerminalMockState extends TerminalMockOptions {
    aiInstalled: boolean;
    aiStatusDelayMs: number;
    aiStatusHeld: boolean;
    aiStatusResponses: object[];
    requests: TerminalMockRequest[];
    closeExitCode: number;
    closeExitBeforeResponse: boolean;
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
            aiInstalled: false,
            aiStatusDelayMs: 0,
            aiStatusHeld: false,
            aiStatusResponses: [],
            requests: [],
            closeExitCode: 0,
            closeExitBeforeResponse: false,
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
            if (request.type === 'terminal_ai_status_request') {
                const status = {...response, success: true, data: {installed: state.aiInstalled, cwd: 'C:\\作業 workspace', installationDirectory: 'C:\\User Data\\ai-container'}};
                if (state.aiStatusHeld) state.aiStatusResponses.push(status);
                else window.setTimeout(() => dispatch(status), state.aiStatusDelayMs);
                return;
            }
            if (request.type === 'terminal_start_request' || request.type === 'terminal_ai_start_request' || request.type === 'terminal_ai_install_request') {
                window.setTimeout(() => {
                    if (state.startError !== null) {
                        dispatch({...response, success: false, error: state.startError, stack: 'at MockTerminal.Start()'});
                    } else {
                        if (request.type === 'terminal_ai_install_request') state.aiInstalled = true;
                        dispatch({...response, success: true, data: {shell: request.type === 'terminal_start_request' ? 'Windows PowerShell' : request.tool === 'codex' ? 'Codex · Windows PowerShell' : 'Claude · Windows PowerShell', cwd: 'C:\\workspace'}});
                    }
                }, state.startDelayMs);
                return;
            }
            if (request.type === 'terminal_close_request' && state.closeExitBeforeResponse) {
                dispatch({type: 'terminal_exit', sessionId: request.sessionId, exitCode: state.closeExitCode});
            }
            dispatch({...response, success: true});
            if (request.type === 'terminal_close_request' && !state.closeExitBeforeResponse) {
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

export async function installAiTerminalMockAsync(page: Page, options: TerminalMockOptions & {installed: boolean; statusDelayMs: number}): Promise<void> {
    await installTerminalMockAsync(page, options);
    await page.addInitScript(config => {
        const state = (window as unknown as TerminalMockWindow).__mockTerminal;
        state.aiInstalled = config.installed;
        state.aiStatusDelayMs = config.statusDelayMs;
    }, options);
}

export async function configureTerminalCloseOrderAsync(page: Page, exitBeforeResponse: boolean): Promise<void> {
    await page.evaluate(value => { (window as unknown as TerminalMockWindow).__mockTerminal.closeExitBeforeResponse = value; }, exitBeforeResponse);
}

/** 確認応答の前後を実時間に依存せずテスト側の操作で区切る。 */
export async function holdAiTerminalStatusAsync(page: Page, held: boolean): Promise<void> {
    await page.evaluate(value => {
        const state = (window as unknown as TerminalMockWindow).__mockTerminal;
        state.aiStatusHeld = value;
        if (!value) {
            for (const response of state.aiStatusResponses.splice(0)) state.dispatch(response);
        }
    }, held);
}
