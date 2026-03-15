import {ReferenceDataCache} from "./reference-data-cache";

/**
 * ドロップダウンのクイックビューパネルを管理するクラス。
 *
 * FK列のドロップダウンアイテムにホバーすると、300ms後に参照先テーブルの
 * 関連データをRelationsPanel風のDOM構造で表示する。
 * クイックビュー自体にマウスオーバーしている間は表示が維持される。
 */
export class DropdownQuickView {
    /** クイックビューのルート要素 */
    private readonly element: HTMLDivElement;
    /** ドロップダウンリスト要素（位置決め基準） */
    private readonly dropdownListElement: HTMLElement;
    /** .grid-dropdown コンテナ要素（位置決め基準） */
    private readonly containerElement: HTMLElement;
    /** ホバーディレイタイマーID（0 = タイマーなし） */
    private hoverTimerId: number = 0;
    /** hidePreviewWithDelay のディレイタイマーID（0 = タイマーなし） */
    private hideDelayTimerId: number = 0;
    /** クイックビュー自体にマウスがホバー中かどうか */
    private hovered: boolean = false;
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

        // クイックビュー自体へのホバーで表示を維持する
        this.element.addEventListener('mouseenter', () => {
            this.hovered = true;
            this.cancelHideTimer();
        });
        this.element.addEventListener('mouseleave', () => {
            this.hovered = false;
            this.hidePreviewWithDelay();
        });
    }

    /**
     * アイテムホバー開始時に呼ぶ（300msディレイ付き）。
     * 300ms以内に別アイテムへ移動した場合、前のタイマーをキャンセルする。
     */
    showPreviewWithDelay(tableName: string, itemId: string, anchorElement: HTMLElement): void {
        this.cancelHoverTimer();
        this.hoverTimerId = window.setTimeout(() => {
            this.hoverTimerId = 0;
            this.showPreviewImmediate(tableName, itemId, anchorElement);
        }, 300);
    }

    /**
     * 即座にプレビューを表示する（キーボード選択用・ディレイなし）。
     */
    showPreviewImmediate(tableName: string, itemId: string, anchorElement: HTMLElement): void {
        const cached = this.previewCache.get(`${tableName}:${itemId}`);
        if (cached) {
            this.renderAndPosition(tableName, cached.header, cached.row, anchorElement);
            return;
        }

        const requestId = ++this.currentPreviewRequestId;
        this.fetchPreviewAsync(tableName, itemId, requestId, anchorElement)
            .catch((e: unknown) => { console.warn('[DropdownQuickView] fetchPreviewAsync failed', e); });
    }

    /**
     * プレビューを即時非表示にする。
     * hidePreviewWithDelayのタイマーが残存している場合も確実にキャンセルする。
     */
    hidePreview(): void {
        this.cancelHideTimer();
        this.cancelHoverTimer();
        this.element.classList.remove('visible');
    }

    /**
     * ドロップダウンアイテムの mouseleave 時に呼ぶ（短いディレイ付き非表示）。
     * ディレイ中にクイックビュー自体にマウスが入った場合、非表示をキャンセルする。
     */
    hidePreviewWithDelay(): void {
        this.cancelHideTimer();
        this.hideDelayTimerId = window.setTimeout(() => {
            this.hideDelayTimerId = 0;
            // 新しい表示タイマーが進行中、またはクイックビューにホバー中なら何もしない
            if (this.hoverTimerId !== 0 || this.hovered) return;
            this.hidePreview();
        }, 50);
    }

    /**
     * クリーンアップ（ドロップダウンhide時）。
     */
    cleanup(): void {
        this.cancelHoverTimer();
        this.cancelHideTimer();
        this.hovered = false;
        this.element.classList.remove('visible');
        this.previewCache.clear();
    }

    /**
     * 参照テーブルからプレビューデータを非同期で取得してレンダリングする。
     */
    private async fetchPreviewAsync(tableName: string, itemId: string, requestId: number, anchorElement: HTMLElement): Promise<void> {
        const fullData = await this.referenceDataCache.getFullDataAsync(tableName);

        // レースコンディション防止: 非同期待機中に別のリクエストが発行された場合は破棄する
        if (requestId !== this.currentPreviewRequestId) return;

        // 対象行をIDで検索する
        const row = fullData.rows.get(itemId);
        if (!row) {
            console.warn('[DropdownQuickView] プレビュー対象行が見つかりません', { tableName, itemId });
            return;
        }

        // テーブル名とIDを複合キーにしてキャッシュ保存（異なるテーブルで同一IDが存在する場合の衝突を防ぐ）
        this.previewCache.set(`${tableName}:${itemId}`, { header: fullData.header, row });
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
     * クイックビューのHTMLコンテンツをRelationsPanel風のDOM構造でレンダリングする。
     */
    private renderContent(tableName: string, header: string[], row: string[]): void {
        this.element.innerHTML = '';

        // relations-panel-content ラッパー
        const contentDiv = document.createElement('div');
        contentDiv.classList.add('relations-panel-content');

        // セクションヘッダー（"RELATIONS"）
        const sectionHeader = document.createElement('div');
        sectionHeader.classList.add('relations-panel-section-header');
        sectionHeader.textContent = 'RELATIONS';
        contentDiv.appendChild(sectionHeader);

        // テーブルセクション
        const tableSection = document.createElement('div');
        tableSection.classList.add('relations-table-section');

        // テーブルヘッダー（テーブル名・N:1タグ・行数）
        const tableHeader = document.createElement('div');
        tableHeader.classList.add('relations-table-header');

        const tableTitle = document.createElement('span');
        tableTitle.classList.add('relations-table-title');
        tableTitle.textContent = tableName;
        tableHeader.appendChild(tableTitle);

        const n1Tag = document.createElement('span');
        n1Tag.classList.add('relations-tag', 'relations-tag--n1');
        n1Tag.textContent = 'N:1';
        tableHeader.appendChild(n1Tag);

        // 行数は常に1（クイックビューは1行分のデータを表示するため）
        const rowCount = document.createElement('span');
        rowCount.classList.add('relations-table-row-count');
        rowCount.textContent = '1 rows';
        tableHeader.appendChild(rowCount);

        tableSection.appendChild(tableHeader);

        // ミニテーブルラッパー
        const miniTableWrapper = document.createElement('div');
        miniTableWrapper.classList.add('relations-mini-table-wrapper');

        const miniTable = document.createElement('table');
        miniTable.classList.add('relations-mini-table');

        // thead
        const thead = document.createElement('thead');
        const theadRow = document.createElement('tr');
        for (const col of header) {
            const th = document.createElement('th');
            th.textContent = col;
            theadRow.appendChild(th);
        }
        thead.appendChild(theadRow);
        miniTable.appendChild(thead);

        // tbody（1行のみ）
        const tbody = document.createElement('tbody');
        const tbodyRow = document.createElement('tr');
        tbodyRow.classList.add('relations-mini-table-row');
        for (const cell of row) {
            const td = document.createElement('td');
            td.textContent = cell;
            tbodyRow.appendChild(td);
        }
        tbody.appendChild(tbodyRow);
        miniTable.appendChild(tbody);

        miniTableWrapper.appendChild(miniTable);
        tableSection.appendChild(miniTableWrapper);
        contentDiv.appendChild(tableSection);
        this.element.appendChild(contentDiv);
    }

    /**
     * クイックビューの表示位置を決定する。
     * デフォルトはドロップダウンリストの右側。
     * ビューポートの右端にはみ出す場合は左側に配置する。
     */
    private positionElement(anchorElement: HTMLElement): void {
        // コンテナとドロップダウンリストの絶対位置を取得（relative座標計算の基準）
        const listRect = this.dropdownListElement.getBoundingClientRect();
        const containerRect = this.containerElement.getBoundingClientRect();

        // アンカー要素の上端をコンテナ相対のtop座標として算出する
        const anchorRect = anchorElement.getBoundingClientRect();
        const topRelative = anchorRect.top - containerRect.top;

        // まずドロップダウンリストの右側に配置を試みる
        const rightPosition = listRect.right - containerRect.left;
        this.element.style.left = rightPosition + 'px';
        this.element.style.top = topRelative + 'px';

        // ビューポートの右端をはみ出す場合はドロップダウンリストの左側に配置する
        const quickViewRect = this.element.getBoundingClientRect();
        if (quickViewRect.right > window.innerWidth) {
            const leftPosition = listRect.left - containerRect.left - this.element.offsetWidth;
            this.element.style.left = leftPosition + 'px';
        }

        // ビューポートの下端をはみ出す場合は上方向にずらして収める
        const updatedRect = this.element.getBoundingClientRect();
        if (updatedRect.bottom > window.innerHeight) {
            const adjustedTop = topRelative - (updatedRect.bottom - window.innerHeight);
            this.element.style.top = Math.max(0, adjustedTop) + 'px';
        }
    }

    /**
     * ホバーディレイタイマーをキャンセルする。
     */
    private cancelHoverTimer(): void {
        if (this.hoverTimerId !== 0) {
            window.clearTimeout(this.hoverTimerId);
            this.hoverTimerId = 0;
        }
    }

    /**
     * hidePreviewWithDelay のタイマーをキャンセルする。
     */
    private cancelHideTimer(): void {
        if (this.hideDelayTimerId !== 0) {
            window.clearTimeout(this.hideDelayTimerId);
            this.hideDelayTimerId = 0;
        }
    }
}
