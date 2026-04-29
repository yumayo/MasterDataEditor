import {Tab} from "../tabs/tab";
import {writeFileAsync} from "../app/api";
import {BOOKMARKS_FILE} from "../config/userdata-path";

/**
 * ブックマークエントリの永続化データ型
 */
export interface BookmarkEntry {
    tableName: string;
    rowKey: string;
    columnName: string;
    label: string;
    createdAt: string; // ISO 8601
}

/**
 * ブックマークパネル
 * ブックマークしたセルをテーブル名でグルーピング表示する
 * エントリクリックで該当テーブル・セルにジャンプする
 *
 * DOMがSSOT: ブックマーク情報はJS配列ではなくDOM要素の data 属性に保持する
 *
 * エントリDOM構造:
 *   <span.bookmark-entry-column>列名: </span>
 *   <span.bookmark-entry-display>セル値</span>
 *   <span.bookmark-entry-pk-suffix> (PK値)</span>
 *   <button.bookmark-entry-delete>×</button>
 *
 * 全体テキスト例: "name: Sword (1)×"
 * テスト: toHaveText(/name:\s*Sword\s*\(1\)/) → "name: Sword (1)" にマッチ
 */
export class BookmarkPanel {
    private readonly element: HTMLElement;
    private readonly contentElement: HTMLElement;
    private readonly tab: Tab;

    constructor(tab: Tab) {
        this.tab = tab;

        // パネルルート
        this.element = document.createElement('div');
        this.element.classList.add('sidebar-panel', 'bookmark-panel');

        // ヘッダー
        const headerElement = document.createElement('div');
        headerElement.classList.add('sidebar-panel-header');
        headerElement.textContent = 'BOOKMARKS';
        this.element.appendChild(headerElement);

        // コンテンツ領域
        this.contentElement = document.createElement('div');
        this.contentElement.classList.add('bookmark-panel-content');
        this.element.appendChild(this.contentElement);
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
     * セルレベルでブックマークを追加する
     * DOMに直接エントリ要素を追加する（JS配列は持たない）
     * 既に同一テーブル名+PK値+列名のブックマークが存在する場合はエラーをスローする
     */
    addBookmark(tableName: string, rowKey: string, columnName: string, label: string): void {
        if (this.hasBookmark(tableName, rowKey, columnName)) {
            throw new Error(`addBookmark: ブックマークが既に存在します tableName=${tableName} rowKey=${rowKey} columnName=${columnName}`);
        }
        this.appendEntryElement(tableName, rowKey, columnName, label, new Date().toISOString());
        // 永続化
        this.persistAsync().catch((e: unknown) => { console.error('[BookmarkPanel] persistAsync failed:', e); });
    }

    /**
     * セルレベルでブックマークを削除する
     * DOM要素を直接削除する。該当エントリが見つからない場合はエラーをスローする
     * グループ内のエントリが全削除された場合はグループ要素も削除する
     */
    removeBookmark(tableName: string, rowKey: string, columnName: string): void {
        const entryElement = this.findEntryElement(tableName, rowKey, columnName);
        if (entryElement === null) {
            throw new Error(`removeBookmark: ブックマークが見つかりません tableName=${tableName} rowKey=${rowKey} columnName=${columnName}`);
        }
        const groupElement = entryElement.parentElement as HTMLElement;
        groupElement.removeChild(entryElement);
        // グループ内にエントリが残っていなければグループ要素も削除する
        // children[0] はグループヘッダーなので、エントリ数は children.length - 1
        if (groupElement.children.length <= 1) {
            this.contentElement.removeChild(groupElement);
        }
        // 永続化
        this.persistAsync().catch((e: unknown) => { console.error('[BookmarkPanel] persistAsync failed:', e); });
    }

    /**
     * 指定テーブル名+PK値+列名のブックマークが存在するか確認する
     * DOMクエリで判定する（JS配列は持たない）
     */
    hasBookmark(tableName: string, rowKey: string, columnName: string): boolean {
        return this.findEntryElement(tableName, rowKey, columnName) !== null;
    }

    /**
     * 指定テーブル名+PK値で（列名問わず）ブックマークが1件以上存在するか確認する
     * PK列の右クリック時に、行内のいずれかのセルがブックマーク済みかを判定するために使用する
     */
    hasBookmarkForRow(tableName: string, rowKey: string): boolean {
        // CSSセレクタインジェクション防止: querySelectorAll + getAttribute 比較方式
        const entries = this.contentElement.querySelectorAll<HTMLElement>('.bookmark-entry');
        for (let i = 0; i < entries.length; i++) {
            if (entries[i].getAttribute('data-table-name') === tableName && entries[i].getAttribute('data-pk-value') === rowKey) return true;
        }
        return false;
    }

    /**
     * 指定テーブル名+PK値の全ブックマークを削除する（行レベル一括削除）
     * PK列右クリックの「ブックマークを解除」で使用する
     */
    removeBookmarksForRow(tableName: string, rowKey: string): void {
        // CSSセレクタインジェクション防止: querySelectorAll + getAttribute 比較方式で対象を収集
        const allEntries = this.contentElement.querySelectorAll<HTMLElement>('.bookmark-entry');
        const matched: HTMLElement[] = [];
        for (let i = 0; i < allEntries.length; i++) {
            if (allEntries[i].getAttribute('data-table-name') === tableName && allEntries[i].getAttribute('data-pk-value') === rowKey) {
                matched.push(allEntries[i]);
            }
        }
        // 末尾から削除してインデックスずれを防ぐ
        for (let i = matched.length - 1; i >= 0; i--) {
            const entryElement = matched[i];
            const groupElement = entryElement.parentElement as HTMLElement;
            groupElement.removeChild(entryElement);
            if (groupElement.children.length <= 1) {
                this.contentElement.removeChild(groupElement);
            }
        }
        // 永続化
        this.persistAsync().catch((e: unknown) => { console.error('[BookmarkPanel] persistAsync failed:', e); });
    }

    /**
     * DOMからブックマーク配列を生成する（永続化・コマンドパレット用）
     */
    serializeBookmarks(): BookmarkEntry[] {
        const entries: BookmarkEntry[] = [];
        const entryElements = this.contentElement.querySelectorAll<HTMLElement>('.bookmark-entry');
        for (let i = 0; i < entryElements.length; i++) {
            const el = entryElements[i];
            // 修正8: getAttribute の null を throw で防御する（DOM構造が正しければ null にはならない）
            const tName = el.getAttribute('data-table-name');
            if (tName === null) throw new Error('[BookmarkPanel.serializeBookmarks] data-table-name 属性が null');
            const rKey = el.getAttribute('data-pk-value');
            if (rKey === null) throw new Error('[BookmarkPanel.serializeBookmarks] data-pk-value 属性が null');
            const cName = el.getAttribute('data-column-name');
            if (cName === null) throw new Error('[BookmarkPanel.serializeBookmarks] data-column-name 属性が null');
            const cAt = el.getAttribute('data-created-at');
            if (cAt === null) throw new Error('[BookmarkPanel.serializeBookmarks] data-created-at 属性が null');
            // extractLabel をインライン展開（修正4: 1箇所のみ使用のため）
            const displaySpan = el.querySelector('.bookmark-entry-display');
            const label = displaySpan !== null && displaySpan.textContent !== null ? displaySpan.textContent : '';
            entries.push({ tableName: tName, rowKey: rKey, columnName: cName, label, createdAt: cAt });
        }
        return entries;
    }

    /**
     * 配列からDOMを復元する（起動時読み込み用）
     * 既存エントリは全てクリアして上書きする
     */
    restoreBookmarks(entries: BookmarkEntry[]): void {
        // 既存のグループ・エントリをすべて削除する
        while (this.contentElement.firstChild) {
            this.contentElement.removeChild(this.contentElement.firstChild);
        }
        // 各エントリを復元する（addBookmark を使うと永続化が走るため、直接DOMを構築する）
        for (const entry of entries) {
            this.appendEntryElement(entry.tableName, entry.rowKey, entry.columnName, entry.label, entry.createdAt);
        }
    }

    /**
     * エントリ要素をDOMクエリで検索する
     * CSSセレクタインジェクション防止: querySelectorAll + getAttribute 比較方式
     */
    private findEntryElement(tableName: string, rowKey: string, columnName: string): HTMLElement | null {
        const entries = this.contentElement.querySelectorAll<HTMLElement>('.bookmark-entry');
        for (let i = 0; i < entries.length; i++) {
            const el = entries[i];
            if (el.getAttribute('data-table-name') === tableName && el.getAttribute('data-pk-value') === rowKey && el.getAttribute('data-column-name') === columnName) return el;
        }
        return null;
    }

    /**
     * ブックマークを userdata/bookmarks.json に永続化する
     */
    private async persistAsync(): Promise<void> {
        const entries = this.serializeBookmarks();
        await writeFileAsync(BOOKMARKS_FILE, JSON.stringify(entries));
    }

    /**
     * グループ要素を取得または新規作成する
     * CSSセレクタインジェクション防止: querySelectorAll + getAttribute 比較方式
     */
    private getOrCreateGroupElement(tableName: string): HTMLElement {
        let groupElement: HTMLElement | null = null;
        const groups = this.contentElement.querySelectorAll<HTMLElement>('.bookmark-group');
        for (let i = 0; i < groups.length; i++) {
            if (groups[i].getAttribute('data-table-name') === tableName) { groupElement = groups[i]; break; }
        }
        if (groupElement === null) {
            groupElement = document.createElement('div');
            groupElement.classList.add('bookmark-group');
            groupElement.setAttribute('data-table-name', tableName);
            groupElement.setAttribute('role', 'group');
            const groupHeader = document.createElement('div');
            groupHeader.classList.add('bookmark-group-header');
            groupHeader.setAttribute('role', 'heading');
            groupHeader.setAttribute('aria-level', '3');
            groupHeader.textContent = tableName;
            groupElement.appendChild(groupHeader);
            this.contentElement.appendChild(groupElement);
        }
        return groupElement;
    }

    /**
     * エントリDOM要素を構築してグループに追加する（addBookmark/restoreBookmarks共用）
     */
    private appendEntryElement(tableName: string, rowKey: string, columnName: string, label: string, createdAt: string): void {
        const groupElement = this.getOrCreateGroupElement(tableName);
        const entryElement = document.createElement('div');
        entryElement.classList.add('bookmark-entry');
        entryElement.setAttribute('data-table-name', tableName);
        entryElement.setAttribute('data-pk-value', rowKey);
        entryElement.setAttribute('data-column-name', columnName);
        entryElement.setAttribute('data-created-at', createdAt);
        entryElement.setAttribute('role', 'button');
        entryElement.setAttribute('tabindex', '0');
        // 列名プレフィクス（例: "name: "）
        const columnSpan = document.createElement('span');
        columnSpan.classList.add('bookmark-entry-column');
        columnSpan.textContent = columnName + ': ';
        entryElement.appendChild(columnSpan);
        // セル値/ラベル（テスト互換: .bookmark-entry-display セレクタで "Sword" を取得可能にする）
        const displaySpan = document.createElement('span');
        displaySpan.classList.add('bookmark-entry-display');
        displaySpan.textContent = label;
        entryElement.appendChild(displaySpan);
        // PK値サフィックス（例: " (1)"）— 全体テキストに "name: Sword (1)" を含めるため
        const pkSuffix = document.createElement('span');
        pkSuffix.classList.add('bookmark-entry-pk-suffix');
        pkSuffix.textContent = ' (' + rowKey + ')';
        entryElement.appendChild(pkSuffix);
        // 削除ボタン（×アイコン）
        const deleteButton = document.createElement('button');
        deleteButton.classList.add('bookmark-entry-delete');
        deleteButton.textContent = '\u00d7';
        deleteButton.setAttribute('aria-label', `${tableName}/${columnName}: ${label} のブックマークを削除`);
        deleteButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeBookmark(tableName, rowKey, columnName);
        });
        entryElement.appendChild(deleteButton);
        // クリックでジャンプ
        entryElement.addEventListener('click', () => {
            this.navigateToBookmark(tableName, rowKey, columnName);
        });
        entryElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.navigateToBookmark(tableName, rowKey, columnName);
            }
        });
        groupElement.appendChild(entryElement);
    }

    /**
     * ブックマーク先のテーブル・セルにジャンプする
     * Tab.navigateToBookmarkAsync に委譲する（command-palette.ts と共通ロジック）
     */
    private navigateToBookmark(tableName: string, rowKey: string, columnName: string): void {
        this.tab.navigateToBookmark(tableName, rowKey, columnName);
    }
}
