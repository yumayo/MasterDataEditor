import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** サーバーのリッスンポート */
const PORT = 3000;

/** WebViewディレクトリのパス */
const WEBVIEW_DIR = '/app/WebView';

/** テスト実行リクエストの型 */
type TestRequest = {
    readonly args: ReadonlyArray<string>;
};

/** テスト実行結果の型 */
type TestResult = {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
};

/** ヘルスチェック結果の型 */
type HealthResult = {
    readonly status: string;
};

/** エラー結果の型 */
type ErrorResult = {
    readonly error: string;
};

type JsonBody = TestResult | HealthResult | ErrorResult;

/** テスト実行中フラグ（同時実行を防止する） */
let isTestRunning = false;

/** リクエストボディを文字列として読み取る */
function readBodyAsync(request: IncomingMessage): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const chunks: Array<Buffer> = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        request.on('error', reject);
    });
}

/** Playwrightテストを実行する */
function executePlaywrightAsync(args: ReadonlyArray<string>): Promise<TestResult> {
    return new Promise<TestResult>((resolve) => {
        const child = spawn('npx', ['playwright', 'test', ...args], {
            cwd: WEBVIEW_DIR,
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
        child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

        child.on('close', (code) => {
            const exitCode = typeof code === 'number' ? code : 1;
            resolve({ exitCode, stdout, stderr });
        });
    });
}

/** JSONレスポンスを送信する */
function sendJson(response: ServerResponse, statusCode: number, body: JsonBody): void {
    response.writeHead(statusCode, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
}

/** POST /test — Playwrightテストを実行する */
async function handleTestAsync(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (isTestRunning) {
        sendJson(response, 409, { error: 'テスト実行中です' });
        return;
    }

    isTestRunning = true;

    try {
        const body = await readBodyAsync(request);
        const testRequest: TestRequest = body.length > 0 ? JSON.parse(body) : { args: [] };
        const result = await executePlaywrightAsync(testRequest.args);

        sendJson(response, 200, result);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        sendJson(response, 500, { error: message });
    } finally {
        isTestRunning = false;
    }
}

/** リクエストをルーティングする */
function routeRequest(request: IncomingMessage, response: ServerResponse): void {
    const method = request.method;
    const url = request.url;

    if (url === '/health' && method === 'GET') {
        sendJson(response, 200, { status: 'ok' });
        return;
    }

    if (url === '/test' && method === 'POST') {
        handleTestAsync(request, response).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : 'Unknown error';
            sendJson(response, 500, { error: message });
        });
        return;
    }

    sendJson(response, 404, { error: 'Not Found' });
}

const server = createServer(routeRequest);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Playwright test server listening on port ${PORT}`);
});
