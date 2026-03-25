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
 *
 * カラムヘッダーの右端ハンドルをドラッグすることで各列の幅を変更できる。
 * ドラッグ中はリスト全体のセルを即時更新する（Undo不要のデバッグ機能のためシンプル実装）。
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
        // tabindex を付与してフォーカス可能にする。grid-textfield の onFocusout で
        // relatedTarget が null にならず、デバッグコンソールへのフォーカス移動を判定できる。
        panel.setAttribute('tabindex', '-1');
        this.element = panel;

        // カラムヘッダー行（各セルは個別生成してリサイズハンドルを付与）
        const columnHeader = document.createElement('div');
        columnHeader.classList.add('debug-console-column-header');

        const timeHeader = this.createHeaderCell('時刻', 'debug-console-col-time');
        const callerHeader = this.createHeaderCell('呼び出し元', 'debug-console-col-caller');
        const labelHeader = this.createHeaderCell('API', 'debug-console-col-label');
        const durationHeader = this.createHeaderCell('時間', 'debug-console-col-duration');
        const statusHeader = this.createHeaderCell('結果', 'debug-console-col-status');

        // label 列は flex:1 で自動調整されるためリサイズ対象外
        this.setupColumnResize(timeHeader, 'debug-console-col-time');
        this.setupColumnResize(callerHeader, 'debug-console-col-caller');
        this.setupColumnResize(durationHeader, 'debug-console-col-duration');

        columnHeader.appendChild(timeHeader);
        columnHeader.appendChild(callerHeader);
        columnHeader.appendChild(labelHeader);
        columnHeader.appendChild(durationHeader);
        columnHeader.appendChild(statusHeader);
        panel.appendChild(columnHeader);

        // ログリスト（スクロール可能エリア）
        const list = document.createElement('div');
        list.classList.add('debug-console-list');
        panel.appendChild(list);
        this.list = list;
    }

    /**
     * ログエントリを1件追加する。経過時間はマイクロ秒単位で受け取り、自動フォーマットする。
     * 1000件を超えた場合は先頭エントリ（最古のもの）を削除する。
     * パネルが非表示でもエントリは蓄積される。
     * 追加後はリスト末尾へ自動スクロールする。
     * @param durationUs 経過時間（マイクロ秒）
     * @param caller 呼び出し元情報（"filename.ts:行番号" 形式）
     */
    appendEntry(label: string, durationUs: number, status: 'success' | 'error', caller: string): void {
        if (this.entryCount >= DebugConsole.MAX_ENTRIES) {
            if (this.list.firstChild) {
                this.list.removeChild(this.list.firstChild);
            }
            this.entryCount--;
        }
        this.list.appendChild(this.createRow(label, this.formatDuration(durationUs), status, caller));
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

    private createHeaderCell(text: string, colClass: string): HTMLElement {
        const span = document.createElement('span');
        span.classList.add(colClass);
        span.textContent = text;
        return span;
    }

    /**
     * ヘッダーセルの右端にリサイズハンドルを設置する。
     * ドラッグ中は colClass を持つ全セル（ヘッダー＋ログ行）の width を即時更新する。
     * ドラッグ確定はなく mousemove のたびにリアルタイム反映する。
     */
    private setupColumnResize(headerCell: HTMLElement, colClass: string): void {
        const handle = document.createElement('div');
        handle.classList.add('debug-console-col-resize-handle');
        headerCell.appendChild(handle);

        let startX = 0;
        let startWidth = 0;

        const onMouseMove = (e: MouseEvent) => {
            const newWidth = Math.max(40, startWidth + (e.clientX - startX));
            this.element.querySelectorAll<HTMLElement>(`.${colClass}`).forEach(el => {
                el.style.width = `${newWidth}px`;
            });
        };

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startX = e.clientX;
            // style.width が設定済みの場合はそれを使い、未設定なら getBoundingClientRect で実幅を取得
            startWidth = headerCell.style.width ? parseFloat(headerCell.style.width) : headerCell.getBoundingClientRect().width;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    private createRow(label: string, durationText: string, status: 'success' | 'error', caller: string): HTMLElement {
        const row = document.createElement('div');
        row.classList.add('debug-console-row', status === 'success' ? 'debug-console-row-success' : 'debug-console-row-error');

        const timeSpan = document.createElement('span');
        timeSpan.classList.add('debug-console-col-time');
        timeSpan.textContent = this.formatTimestamp(new Date());
        // ヘッダーで変更済みの幅をログ行にも引き継ぐ
        const currentTimeWidth = this.element.querySelector<HTMLElement>('.debug-console-col-time')?.style.width;
        if (currentTimeWidth) timeSpan.style.width = currentTimeWidth;
        row.appendChild(timeSpan);

        const callerSpan = document.createElement('span');
        callerSpan.classList.add('debug-console-col-caller');
        callerSpan.textContent = caller;
        callerSpan.title = caller;
        const currentCallerWidth = this.element.querySelector<HTMLElement>('.debug-console-col-caller')?.style.width;
        if (currentCallerWidth) callerSpan.style.width = currentCallerWidth;
        row.appendChild(callerSpan);

        const labelSpan = document.createElement('span');
        labelSpan.classList.add('debug-console-col-label');
        labelSpan.textContent = label;
        row.appendChild(labelSpan);

        const durationSpan = document.createElement('span');
        durationSpan.classList.add('debug-console-col-duration');
        durationSpan.textContent = durationText;
        const currentDurationWidth = this.element.querySelector<HTMLElement>('.debug-console-col-duration')?.style.width;
        if (currentDurationWidth) durationSpan.style.width = currentDurationWidth;
        row.appendChild(durationSpan);

        const statusSpan = document.createElement('span');
        statusSpan.classList.add('debug-console-col-status');
        statusSpan.textContent = status === 'success' ? '✓' : '✗';
        row.appendChild(statusSpan);

        return row;
    }

    /** マイクロ秒値をms単位にフォーマットする（小数点第一位表示） */
    private formatDuration(us: number): string {
        return `${(us / 1000).toFixed(1)}ms`;
    }

    private formatTimestamp(date: Date): string {
        const Y = date.getFullYear();
        const M = String(date.getMonth() + 1).padStart(2, '0');
        const D = String(date.getDate()).padStart(2, '0');
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        const s = String(date.getSeconds()).padStart(2, '0');
        const ms = String(date.getMilliseconds()).padStart(3, '0');
        return `${Y}-${M}-${D} ${h}:${m}:${s}.${ms}`;
    }
}
