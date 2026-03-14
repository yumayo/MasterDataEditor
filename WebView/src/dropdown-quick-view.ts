import {ReferenceDataCache} from "./reference-data-cache";

/**
 * ドロップダウンのクイックビューパネルを管理するクラス。
 *
 * FK列のドロップダウンアイテムにホバーすると、300ms後に参照先テーブルの
 * 関連データをHTMLテーブルとして表示する。キーボード選択時はディレイなし即時表示。
 */
export class DropdownQuickView {
    /** クイックビューのルート要素 */
    private readonly element: HTMLDivElement;
    /** ドロップダウンリスト要素（位置決め基準） */
    private readonly dropdownListElement: HTMLElement;
    /** .grid-dropdown コンテナ要素（位置決め基準・!アサーション排除のため明示保持） */
    private readonly containerElement: HTMLElement;
    /** ホバーディレイタイマーID（0 = タイマーなし。window.setTimeoutは常に正の値を返す） */
    private hoverTimerId: number = 0;
    /** レースコンディション防止用リクエストID */
    private currentPreviewRequestId: number = 0;
    /** IDをキーとしたプレビューキャッシュ */
    private readonly previewCache: Map<string, { header: string[]; row: string[] }>;
    /** 参照データキャッシュへの参照 */
    private readonly referenceDataCache: ReferenceDataCache;

    constructor(containerElement: HTMLElement, dropdownListElement: HTMLElement, referenceDataCache: ReferenceDataCache) {
        this.containerElement = containerElement;
        this.dropdownListElement = dropdownListElement;
        this.referenceDataCache = referenceDataCache;
        this.previewCache = new Map();

        // クイックビューのDOM要素を構築してコンテナに追加
        this.element = document.createElement('div');
        this.element.classList.add('dropdown-quick-view');
        containerElement.appendChild(this.element);
    }

    /**
     * アイテムホバー開始時に呼ぶ（300msディレイ付き）。
     * 300ms以内に別アイテムへ移動した場合、前のタイマーをキャンセルする。
     * @param tableName 参照先テーブル名
     * @param itemId ホバー中のアイテムID
     * @param anchorElement 位置決め基準となるアイテム要素
     */
    showPreviewWithDelay(tableName: string, itemId: string, anchorElement: HTMLElement): void {
        this.cancelTimer();
        this.hoverTimerId = window.setTimeout(() => {
            this.hoverTimerId = 0;
            this.showPreviewImmediate(tableName, itemId, anchorElement);
        }, 300);
    }

    /**
     * 即座にプレビューを表示する（キーボード選択用・ディレイなし）。
     * @param tableName 参照先テーブル名
     * @param itemId 表示するアイテムID
     * @param anchorElement 位置決め基準となるアイテム要素
     */
    showPreviewImmediate(tableName: string, itemId: string, anchorElement: HTMLElement): void {
        // キャッシュヒット時は即時レンダリング
        const cached = this.previewCache.get(itemId);
        if (cached) {
            this.renderAndPosition(tableName, cached.header, cached.row, anchorElement);
            return;
        }

        // 非同期データ取得（レースコンディション防止）
        const requestId = ++this.currentPreviewRequestId;
        this.fetchPreviewAsync(tableName, itemId, requestId, anchorElement)
            .catch((e: unknown) => { console.warn('[DropdownQuickView] fetchPreviewAsync failed', e); });
    }

    /**
     * プレビューを非表示にする（マウスリーブ時）。
     */
    hidePreview(): void {
        this.cancelTimer();
        this.element.classList.remove('visible');
    }

    /**
     * クリーンアップ（ドロップダウンhide時）。
     * タイマーキャンセル・プレビュー非表示・キャッシュクリアを行う。
     */
    cleanup(): void {
        this.cancelTimer();
        this.element.classList.remove('visible');
        this.previewCache.clear();
    }

    /**
     * 参照テーブルからプレビューデータを非同期で取得してレンダリングする。
     */
    private async fetchPreviewAsync(tableName: string, itemId: string, requestId: number, anchorElement: HTMLElement): Promise<void> {
        const fullData = await this.referenceDataCache.getFullDataAsync(tableName);

        // レースコンディション: より新しいリクエストが来ていたら破棄
        if (requestId !== this.currentPreviewRequestId) return;

        // 対象行を検索
        const row = fullData.rows.get(itemId);
        if (!row) {
            console.warn('[DropdownQuickView] プレビュー対象行が見つかりません', { tableName, itemId });
            return;
        }

        // キャッシュに保存
        this.previewCache.set(itemId, { header: fullData.header, row });

        this.renderAndPosition(tableName, fullData.header, row, anchorElement);
    }

    /**
     * プレビューをレンダリングして位置を決定する。
     */
    private renderAndPosition(tableName: string, header: string[], row: string[], anchorElement: HTMLElement): void {
        this.renderContent(tableName, header, row);
        this.element.classList.add('visible');
        this.positionElement(anchorElement);
    }

    /**
     * クイックビューのHTMLコンテンツをレンダリングする。
     */
    private renderContent(tableName: string, header: string[], row: string[]): void {
        this.element.innerHTML = '';

        // ヘッダー（テーブル名表示）
        const headerDiv = document.createElement('div');
        headerDiv.classList.add('dropdown-quick-view-header');
        headerDiv.textContent = tableName;
        this.element.appendChild(headerDiv);

        // コンテンツ（HTMLテーブル）
        const contentDiv = document.createElement('div');
        contentDiv.classList.add('dropdown-quick-view-content');

        const table = document.createElement('table');
        table.classList.add('dropdown-quick-view-table');

        // thead
        const thead = document.createElement('thead');
        const theadRow = document.createElement('tr');
        for (const col of header) {
            const th = document.createElement('th');
            th.textContent = col;
            theadRow.appendChild(th);
        }
        thead.appendChild(theadRow);
        table.appendChild(thead);

        // tbody
        const tbody = document.createElement('tbody');
        const tbodyRow = document.createElement('tr');
        for (const cell of row) {
            const td = document.createElement('td');
            td.textContent = cell;
            tbodyRow.appendChild(td);
        }
        tbody.appendChild(tbodyRow);
        table.appendChild(tbody);

        contentDiv.appendChild(table);
        this.element.appendChild(contentDiv);
    }

    /**
     * クイックビューの表示位置を決定する。
     * デフォルトはドロップダウンリストの右側。
     * ビューポートの右端にはみ出す場合は左側に配置する。
     */
    private positionElement(anchorElement: HTMLElement): void {
        // ドロップダウンリストの右端を基準位置とする
        const listRect = this.dropdownListElement.getBoundingClientRect();
        const containerRect = this.containerElement.getBoundingClientRect();

        // アイテムのtop位置（コンテナ基準）
        const anchorRect = anchorElement.getBoundingClientRect();
        const topRelative = anchorRect.top - containerRect.top;

        // まず右側に配置してはみ出しチェック
        const rightPosition = listRect.right - containerRect.left;
        this.element.style.left = rightPosition + 'px';
        this.element.style.top = topRelative + 'px';

        // ビューポートの右端チェック（表示後の幅で判定）
        const quickViewRect = this.element.getBoundingClientRect();
        if (quickViewRect.right > window.innerWidth) {
            // 左側に配置（ドロップダウンリストの左端 - クイックビュー幅）
            const leftPosition = listRect.left - containerRect.left - this.element.offsetWidth;
            this.element.style.left = leftPosition + 'px';
        }

        // ビューポートの下端チェック（再取得して判定）
        const updatedRect = this.element.getBoundingClientRect();
        if (updatedRect.bottom > window.innerHeight) {
            const adjustedTop = topRelative - (updatedRect.bottom - window.innerHeight);
            this.element.style.top = Math.max(0, adjustedTop) + 'px';
        }
    }

    /**
     * ホバータイマーをキャンセルする。
     */
    private cancelTimer(): void {
        if (this.hoverTimerId !== 0) {
            window.clearTimeout(this.hoverTimerId);
            this.hoverTimerId = 0;
        }
    }
}
