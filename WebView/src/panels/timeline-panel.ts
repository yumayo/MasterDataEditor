import {gitLogAsync, LogEntry} from "../app/api";

/**
 * タイムラインパネル
 * サイドバーに配置し、アクティブテーブルの git log ベースのコミット履歴を表示する。
 * 各コミットエントリはメッセージ・著者・日付の3要素で構成される。
 * エントリクリック時にコールバックを発火し、差分タブの表示を起動する。
 */
export class TimelinePanel {
    private readonly element: HTMLElement;
    private readonly entriesContainer: HTMLElement;
    /** エントリクリック時のコールバック（テーブル名・選択コミット・1つ前のコミット（なければnull）を渡す） */
    private readonly onEntryClick: (tableName: string, entry: LogEntry, prevEntry: LogEntry | null) => void;
    /** loadLogAsync の競合状態を防ぐリクエストID */
    private currentRequestId: number;
    /** 現在表示中のテーブル名（loadLogAsync で設定される） */
    private currentTableName: string;

    constructor(onEntryClick: (tableName: string, entry: LogEntry, prevEntry: LogEntry | null) => void) {
        this.onEntryClick = onEntryClick;
        this.currentRequestId = 0;
        this.currentTableName = '';

        this.element = document.createElement('div');
        this.element.classList.add('timeline-panel');

        // パネルヘッダー
        const header = document.createElement('div');
        header.classList.add('sidebar-panel-header');
        header.textContent = 'TIMELINE';
        this.element.appendChild(header);

        // エントリ一覧コンテナ（アクセシビリティのためリストロールを付与）
        this.entriesContainer = document.createElement('div');
        this.entriesContainer.classList.add('timeline-entries');
        this.entriesContainer.setAttribute('role', 'list');
        this.element.appendChild(this.entriesContainer);
    }

    /**
     * パネルを親要素に追加する
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    /**
     * パネルを表示する
     */
    show(): void {
        this.element.classList.add('sidebar-panel-active');
    }

    /**
     * パネルを非表示にする
     */
    hide(): void {
        this.element.classList.remove('sidebar-panel-active');
    }

    /**
     * パネルが表示中かを返す
     */
    isVisible(): boolean {
        return this.element.classList.contains('sidebar-panel-active');
    }

    /**
     * 指定テーブルの git log を取得してエントリ一覧を描画する
     * タブ切り替え時やパネル表示時にアクティブテーブル名で呼ばれる
     */
    async loadLogAsync(tableName: string): Promise<void> {
        this.currentTableName = tableName;
        const requestId = ++this.currentRequestId;
        const entries = await gitLogAsync('data/' + tableName + '.csv', 20);
        // 非同期中に別のリクエストが発行された場合は描画をスキップする
        if (requestId !== this.currentRequestId) return;
        this.renderEntries(entries);
    }

    /**
     * git log エントリをDOMに描画する
     * 既存のエントリを全消去してから新規に構築する
     */
    private renderEntries(entries: LogEntry[]): void {
        this.entriesContainer.innerHTML = '';
        // git log が0件の場合は空状態メッセージを表示する
        if (entries.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.classList.add('timeline-empty-message');
            emptyMessage.textContent = '変更履歴がありません';
            this.entriesContainer.appendChild(emptyMessage);
            return;
        }
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const entryElement = document.createElement('div');
            entryElement.classList.add('timeline-entry');
            entryElement.setAttribute('role', 'listitem');

            const messageElement = document.createElement('div');
            messageElement.classList.add('timeline-entry-message');
            messageElement.textContent = entry.message;
            entryElement.appendChild(messageElement);

            const authorElement = document.createElement('div');
            authorElement.classList.add('timeline-entry-author');
            authorElement.textContent = entry.author;
            entryElement.appendChild(authorElement);

            const dateElement = document.createElement('div');
            dateElement.classList.add('timeline-entry-date');
            dateElement.textContent = entry.date;
            entryElement.appendChild(dateElement);

            // エントリクリックで差分タブを開く（選択状態の切り替えも行う）
            // git log は新しい順なので、entries[i+1] がこのファイルの1つ前のコミット
            const prevEntry = i + 1 < entries.length ? entries[i + 1] : null;
            entryElement.addEventListener('click', () => {
                // 既存の選択状態を全て解除してからクリックされたエントリを選択する
                const previousSelected = this.entriesContainer.querySelectorAll('.timeline-entry-selected');
                for (let j = 0; j < previousSelected.length; j++) {
                    previousSelected[j].classList.remove('timeline-entry-selected');
                }
                entryElement.classList.add('timeline-entry-selected');
                this.onEntryClick(this.currentTableName, entry, prevEntry);
            });

            this.entriesContainer.appendChild(entryElement);
        }
    }
}
