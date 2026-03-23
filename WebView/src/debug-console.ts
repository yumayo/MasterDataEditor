import {ResizeHandle} from "./resize-handle";

/**
 * DEBUGコンソール
 *
 * バックグラウンドタスクの発行履歴（ラベル・経過時間・成否）を最大1000件表示する。
 * 画面下段に表示され、ValidationPanelと同様のパネル構造を持つ。
 * ステータスバーの DEBUG ボタンクリックで表示/非表示をトグルする。
 *
 * 1000件超過時は先頭エントリと対応するDOM行を同時に削除して上限を維持する。
 * 新規エントリ追加時はリストの末尾へ自動スクロールする。
 */
export class DebugConsole {

    private readonly element: HTMLElement;
    private readonly list: HTMLElement;
    private readonly resizeHandle: ResizeHandle;
    /** ログエントリの件数カウンター（DOM先頭削除と同期して管理） */
    private entryCount: number;

    private static readonly MAX_ENTRIES = 1000;

    constructor() {
        this.entryCount = 0;

        const panel = document.createElement('div');
        panel.classList.add('debug-console');
        panel.style.display = 'none';
        this.element = panel;

        // 縦方向リサイズハンドル（ValidationPanelと同じパターン）
        this.resizeHandle = new ResizeHandle('vertical', (delta: number): number => {
            const currentHeight = this.element.getBoundingClientRect().height;
            const newHeight = Math.max(80, currentHeight - delta);
            this.element.style.height = `${newHeight}px`;
            return currentHeight - newHeight;
        });
        this.resizeHandle.prependTo(this.element);

        // タイトルバー
        const header = document.createElement('div');
        header.classList.add('debug-console-header');
        const title = document.createElement('span');
        title.textContent = 'DEBUG CONSOLE';
        header.appendChild(title);

        // クリアボタン（ゴミ箱アイコン）
        const clearBtn = document.createElement('div');
        clearBtn.classList.add('debug-console-action');
        clearBtn.setAttribute('role', 'button');
        clearBtn.setAttribute('tabindex', '0');
        clearBtn.setAttribute('title', 'ログをクリア');
        clearBtn.setAttribute('aria-label', 'ログをクリア');
        clearBtn.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M6 2h4l1 1H5L6 2zM4 4h8v9l-1 1H5l-1-1V4zm2 2v6h1V6H6zm3 0v6h1V6H9z"/></svg>`;
        clearBtn.addEventListener('click', () => { this.clear(); });
        clearBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.clear(); });
        header.appendChild(clearBtn);

        // 閉じるボタン（ValidationPanelと同じアイコン）
        const closeBtn = document.createElement('div');
        closeBtn.classList.add('debug-console-action');
        closeBtn.setAttribute('role', 'button');
        closeBtn.setAttribute('tabindex', '0');
        closeBtn.setAttribute('title', 'DEBUGコンソールを閉じる');
        closeBtn.setAttribute('aria-label', 'DEBUGコンソールを閉じる');
        closeBtn.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 8.707l3.646 3.647.708-.708L8.707 8l3.647-3.646-.708-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708z"/></svg>`;
        closeBtn.addEventListener('click', () => { this.element.style.display = 'none'; });
        closeBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.element.style.display = 'none'; });
        header.appendChild(closeBtn);

        panel.appendChild(header);

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
        // 上限超過時は先頭行（最古）を削除する
        if (this.entryCount >= DebugConsole.MAX_ENTRIES) {
            if (this.list.firstChild) {
                this.list.removeChild(this.list.firstChild);
            }
            this.entryCount--;
        }
        this.list.appendChild(this.createRow(label, durationMs, status));
        this.entryCount++;
        // 最新行が常に見えるようにスクロールする
        this.list.scrollTop = this.list.scrollHeight;
    }

    /**
     * パネルの表示/非表示をトグルする（ステータスバーの DEBUG ボタンから呼ばれる）
     */
    toggleVisibility(): void {
        if (this.element.style.display === 'none') {
            this.element.style.display = '';
        } else {
            this.element.style.display = 'none';
        }
    }

    /**
     * パネルを親要素に追加する（Editor から呼ばれる）
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    private clear(): void {
        while (this.list.firstChild) {
            this.list.removeChild(this.list.firstChild);
        }
        this.entryCount = 0;
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
