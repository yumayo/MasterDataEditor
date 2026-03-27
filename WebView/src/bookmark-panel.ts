import {Tab} from "./tab";

/**
 * ブックマークパネル
 * ブックマークしたテーブル行をテーブル名でグルーピング表示する
 * エントリクリックで該当テーブル・行にジャンプする
 *
 * DOMがSSOT: ブックマーク情報はJS配列ではなくDOM要素の data 属性に保持する
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
     * ブックマークを追加する
     * DOMに直接エントリ要素を追加する（JS配列は持たない）
     * 既に同一テーブル名+PK値のブックマークが存在する場合はエラーをスローする
     */
    addBookmark(tableName: string, pkValue: string, displayText: string): void {
        if (this.hasBookmark(tableName, pkValue)) {
            throw new Error(`addBookmark: ブックマークが既に存在します tableName=${tableName} pkValue=${pkValue}`);
        }
        // 該当テーブル名のグループ要素を取得する。存在しなければ新規作成する
        let groupElement = this.contentElement.querySelector<HTMLElement>(`.bookmark-group[data-table-name="${tableName}"]`);
        if (groupElement === null) {
            groupElement = document.createElement('div');
            groupElement.classList.add('bookmark-group');
            groupElement.setAttribute('data-table-name', tableName);
            groupElement.setAttribute('role', 'group');
            // グループヘッダー（テーブル名）
            const groupHeader = document.createElement('div');
            groupHeader.classList.add('bookmark-group-header');
            groupHeader.setAttribute('role', 'heading');
            groupHeader.setAttribute('aria-level', '3');
            groupHeader.textContent = tableName;
            groupElement.appendChild(groupHeader);
            this.contentElement.appendChild(groupElement);
        }
        // エントリ要素を生成する
        const entryElement = document.createElement('div');
        entryElement.classList.add('bookmark-entry');
        entryElement.setAttribute('data-table-name', tableName);
        entryElement.setAttribute('data-pk-value', pkValue);
        entryElement.setAttribute('role', 'button');
        entryElement.setAttribute('tabindex', '0');
        // PK値
        const pkSpan = document.createElement('span');
        pkSpan.classList.add('bookmark-entry-pk');
        pkSpan.textContent = pkValue;
        entryElement.appendChild(pkSpan);
        // 表示列の値
        const displaySpan = document.createElement('span');
        displaySpan.classList.add('bookmark-entry-display');
        displaySpan.textContent = displayText;
        entryElement.appendChild(displaySpan);
        // 削除ボタン（×アイコン）
        const deleteButton = document.createElement('button');
        deleteButton.classList.add('bookmark-entry-delete');
        deleteButton.textContent = '\u00d7'; // × 記号
        deleteButton.setAttribute('aria-label', `${tableName}/${displayText} のブックマークを削除`);
        deleteButton.addEventListener('click', (e) => {
            e.stopPropagation(); // エントリクリックイベントの発火を防ぐ
            this.removeBookmark(tableName, pkValue);
        });
        entryElement.appendChild(deleteButton);
        // エントリクリックで該当テーブル・行にジャンプする
        entryElement.addEventListener('click', () => {
            this.tab.navigateToTableRow(tableName, pkValue);
        });
        // Enter/Space キーでもクリックと同じ動作をする（アクセシビリティ対応）
        entryElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.tab.navigateToTableRow(tableName, pkValue);
            }
        });
        groupElement.appendChild(entryElement);
    }

    /**
     * ブックマークを削除する
     * DOM要素を直接削除する。該当エントリが見つからない場合はエラーをスローする
     * グループ内のエントリが全削除された場合はグループ要素も削除する
     */
    removeBookmark(tableName: string, pkValue: string): void {
        const entryElement = this.contentElement.querySelector<HTMLElement>(`.bookmark-entry[data-table-name="${tableName}"][data-pk-value="${pkValue}"]`);
        if (entryElement === null) {
            throw new Error(`removeBookmark: ブックマークが見つかりません tableName=${tableName} pkValue=${pkValue}`);
        }
        const groupElement = entryElement.parentElement as HTMLElement;
        groupElement.removeChild(entryElement);
        // グループ内にエントリが残っていなければグループ要素も削除する
        // children[0] はグループヘッダーなので、エントリ数は children.length - 1
        if (groupElement.children.length <= 1) {
            this.contentElement.removeChild(groupElement);
        }
    }

    /**
     * 指定テーブル名+PK値のブックマークが存在するか確認する
     * DOMクエリで判定する（JS配列は持たない）
     */
    hasBookmark(tableName: string, pkValue: string): boolean {
        return this.contentElement.querySelector(`.bookmark-entry[data-table-name="${tableName}"][data-pk-value="${pkValue}"]`) !== null;
    }
}
