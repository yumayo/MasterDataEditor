/**
 * DEBUGコンソール
 *
 * BottomPanel の DEBUG CONSOLE タブのコンテンツとして表示される。
 * タイトルバー・ResizeHandle・閉じるボタンは BottomPanel が担当するため、
 * このクラスはログリストの管理と表示のみを担う。
 *
 * バックグラウンドタスクの発行履歴（ラベル・経過時間・成否）を最大1000件表示する。
 * 1000件超過時は先頭エントリ（最古のもの）を削除して上限を維持する。
 * 新規エントリ追加時はリスト末尾へ自動スクロールする。
 */
export class DebugConsole {

    private readonly element: HTMLElement;
    private readonly list: HTMLElement;
    /** ログエントリの件数カウンター（DOM先頭削除と同期して管理） */
    private entryCount: number;

    private static readonly MAX_ENTRIES = 1000;

    constructor() {
        this.entryCount = 0;

        const panel = document.createElement('div');
        panel.classList.add('debug-console');
        panel.style.display = 'none';
        this.element = panel;

        // カラムヘッダー行
        const columnHeader = document.createElement('div');
        columnHeader.classList.add('debug-console-column-header');
        columnHeader.innerHTML = `<span class="debug-console-col-time">時刻</span><span class="debug-console-col-label">API</span><span class="debug-console-col-duration">時間</span><span class="debug-console-col-status">結果</span>`;
        panel.appendChild(columnHeader);

        // ログリスト（スクロール可能エリア）
        const list = document.createElement('div');
        list.classList.add('debug-console-list');
        panel.appendChild(list);
        this.list = list;
    }

    /**
     * ログエントリを1件追加する。
     * 1000件を超えた場合は先頭エントリ（最古のもの）を削除する。
     * パネルが非表示でもエントリは蓄積される。
     * 追加後はリスト末尾へ自動スクロールする。
     */
    appendEntry(label: string, durationMs: number, status: 'success' | 'error'): void {
        if (this.entryCount >= DebugConsole.MAX_ENTRIES) {
            if (this.list.firstChild) {
                this.list.removeChild(this.list.firstChild);
            }
            this.entryCount--;
        }
        this.list.appendChild(this.createRow(label, durationMs, status));
        this.entryCount++;
        this.list.scrollTop = this.list.scrollHeight;
    }

    /**
     * ログを全件クリアする（BottomPanel のクリアボタンから呼ばれる）
     */
    clear(): void {
        while (this.list.firstChild) {
            this.list.removeChild(this.list.firstChild);
        }
        this.entryCount = 0;
    }

    /**
     * 表示/非表示を切り替える（BottomPanel から呼ばれる）
     */
    setVisible(visible: boolean): void {
        this.element.style.display = visible ? '' : 'none';
    }

    /**
     * パネルを親要素に追加する（BottomPanel から呼ばれる）
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    private createRow(label: string, durationMs: number, status: 'success' | 'error'): HTMLElement {
        const row = document.createElement('div');
        row.classList.add('debug-console-row', status === 'success' ? 'debug-console-row-success' : 'debug-console-row-error');

        const timeSpan = document.createElement('span');
        timeSpan.classList.add('debug-console-col-time');
        timeSpan.textContent = this.formatTimestamp(new Date());
        row.appendChild(timeSpan);

        const labelSpan = document.createElement('span');
        labelSpan.classList.add('debug-console-col-label');
        labelSpan.textContent = label;
        row.appendChild(labelSpan);

        const durationSpan = document.createElement('span');
        durationSpan.classList.add('debug-console-col-duration');
        durationSpan.textContent = `${durationMs}ms`;
        row.appendChild(durationSpan);

        const statusSpan = document.createElement('span');
        statusSpan.classList.add('debug-console-col-status');
        statusSpan.textContent = status === 'success' ? '✓' : '✗';
        row.appendChild(statusSpan);

        return row;
    }

    private formatTimestamp(date: Date): string {
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        const s = String(date.getSeconds()).padStart(2, '0');
        const ms = String(date.getMilliseconds()).padStart(3, '0');
        return `${h}:${m}:${s}.${ms}`;
    }
}
