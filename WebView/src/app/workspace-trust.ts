import {readWorkspaceTrustAsync, invalidateGitStatusCache, invalidateGitShowCache} from './api';

export const WORKSPACE_TRUST_CHANGED = 'workspace-trust-changed';
let trusted = false;

/** 信頼を変更できるのは WPF の確認画面だけ。WebViewは現在の状態を表示する。 */
export function isWorkspaceTrusted(): boolean { return trusted; }

export async function initializeWorkspaceTrustAsync(): Promise<void> {
    let receivedChange = false;
    window.chrome.webview.addEventListener('message', (event: MessageEvent) => {
        const message: unknown = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'workspace_trust_changed' || !('trusted' in message) || typeof message.trusted !== 'boolean') return;
        receivedChange = true;
        trusted = message.trusted;
        invalidateGitStatusCache();
        invalidateGitShowCache();
        window.dispatchEvent(new Event(WORKSPACE_TRUST_CHANGED));
    });
    const state = await readWorkspaceTrustAsync();
    // 照会を待つ間の信頼解除を、古い照会結果で巻き戻さない。
    if (!receivedChange) trusted = state.trusted === true;
}
