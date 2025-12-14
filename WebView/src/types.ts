export interface WebView2API {
    postMessage(message: string | object): void;
    addEventListener(event: 'message', handler: (event: MessageEvent) => void): void;
    removeEventListener(event: 'message', handler: (event: MessageEvent) => void): void;
}

declare global {
    interface Window {
        chrome: {
            webview: WebView2API;
        };
    }
}
