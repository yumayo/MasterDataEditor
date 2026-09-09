/** BLAME の計測値だけを記録する。レスポンス本体を計測ログに複製しない。 */
export interface GitBlameTiming {
    type: 'git_blame_timing';
    requestId: string;
    source: 'host' | 'webview';
    stage: string;
    durationMs: number;
    success: boolean;
    [key: string]: unknown;
}

export interface GitBlameTimingContext {
    requestId: string;
    filename: string;
}

let timingSink: ((timing: GitBlameTiming) => void) | undefined;
let listening = false;

export function configureGitBlameTiming(sink: (timing: GitBlameTiming) => void): void {
    timingSink = sink;
    if (listening) return;
    listening = true;
    window.chrome.webview.addEventListener('message', (event: MessageEvent) => {
        // 自前の小さな計測通知だけを読む。巨大なBLAMEレスポンスの解析を増やさない。
        if (typeof event.data !== 'string' || !event.data.startsWith('{"type":"git_blame_timing",')) return;
        const timing = JSON.parse(event.data) as GitBlameTiming;
        publishTiming(timing);
    });
}

function publishTiming(timing: GitBlameTiming): void {
    console.info(`[BLAME timing] ${JSON.stringify(timing)}`);
    timingSink?.(timing);
}

export function recordGitBlameTiming(requestId: string, stage: string, durationMs: number, metrics: Record<string, unknown> = {}): void {
    publishTiming({type: 'git_blame_timing', requestId, source: 'webview', stage, durationMs, success: true, ...metrics});
}

/** 既存の各受信リスナーが行っている解析を、そのまま個別に計測する。 */
export function parseWebViewMessageWithBlameTiming(json: string, consumer: string): any {
    const startedAt = performance.now();
    const message = JSON.parse(json);
    const durationMs = performance.now() - startedAt;
    if (message?.type === 'git_blame_response') {
        recordGitBlameTiming(message.requestId, 'response_json_parse', durationMs, {consumer, chars: json.length});
    }
    return message;
}
