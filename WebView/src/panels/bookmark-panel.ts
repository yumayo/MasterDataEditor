import {Tab} from "../tabs/tab";
import {readFileAsync, writeFileAsync} from "../app/api";
import {BOOKMARKS_FILE} from "../config/userdata-path";
import {stringifyJsonForFile} from "../core/json-format";

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

interface BookmarkSchemaColumn {
    name: string;
    type?: string;
    comment?: string;
    reference?: unknown;
}

interface BookmarkSchemaJson {
    header: BookmarkSchemaColumn[];
    primary_key?: string | string[];
    description?: string;
}

/**
 * ブックマークパネル
 * ブックマークしたセルをテーブル名でグルーピング表示する
 * エントリクリックで該当テーブル・セルにジャンプする
 *
 * DOMがSSOT: ブックマーク情報はJS配列ではなくDOM要素の data 属性に保持する
 *
 * エントリDOM構造:
 *   <div.bookmark-entry-field-header>列名・コメント・型/FK/PKバッジ</div>
 *   <div.bookmark-entry-field-value>
 *     <span.bookmark-entry-display>セル値</span>
 *   </div>
 *   <span.bookmark-entry-legacy-text>列名: セル値 (PK値)</span>
 *   <button.bookmark-entry-delete>×</button>
 *
 * 全体テキスト例: "name: Sword (1)×"
 * テスト: toHaveText(/name:\s*Sword\s*\(1\)/) → "name: Sword (1)" にマッチ
 */
export class BookmarkPanel {
    private readonly element: HTMLElement;
    private readonly contentElement: HTMLElement;
    private readonly tab: Tab;
    /** グループ折り畳み状態（テーブル名 → 折り畳まれているか） */
    private readonly collapsedGroups = new Set<string>();
    /** スキーマ読み込みの重複を避けるためのキャッシュ */
    private readonly schemaCache = new Map<string, Promise<BookmarkSchemaJson | null>>();
    private nextGroupId = 0;

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
        this.updateEmptyState();
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
        const itemsElement = entryElement.parentElement;
        const groupElement = entryElement.closest<HTMLElement>('.bookmark-group');
        if (itemsElement === null || groupElement === null) {
            throw new Error('[BookmarkPanel.removeBookmark] DOM構造が不正です');
        }
        itemsElement.removeChild(entryElement);
        this.removeGroupIfEmpty(groupElement);
        this.updateEmptyState();
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
        const affectedGroups = new Set<HTMLElement>();
        for (let i = matched.length - 1; i >= 0; i--) {
            const entryElement = matched[i];
            const itemsElement = entryElement.parentElement;
            const groupElement = entryElement.closest<HTMLElement>('.bookmark-group');
            if (itemsElement === null || groupElement === null) continue;
            itemsElement.removeChild(entryElement);
            affectedGroups.add(groupElement);
        }
        for (const groupElement of affectedGroups) this.removeGroupIfEmpty(groupElement);
        this.updateEmptyState();
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
        this.updateEmptyState();
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
        await writeFileAsync(BOOKMARKS_FILE, stringifyJsonForFile(entries));
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
            const createdGroup = document.createElement('div');
            createdGroup.classList.add('bookmark-group');
            createdGroup.setAttribute('data-table-name', tableName);
            createdGroup.setAttribute('role', 'group');

            const collapsed = this.collapsedGroups.has(tableName);
            const itemsId = `bookmark-group-items-${++this.nextGroupId}`;

            const groupHeader = document.createElement('button');
            groupHeader.type = 'button';
            groupHeader.classList.add('bookmark-group-header');
            groupHeader.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            groupHeader.setAttribute('aria-controls', itemsId);

            const chevron = document.createElement('span');
            chevron.classList.add('bookmark-group-chevron');
            chevron.innerHTML = `<svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M5.7 13.7L5 13l4.6-4.6L5 3.7l.7-.7 5.3 5.4z"/></svg>`;

            const nameSpan = document.createElement('span');
            nameSpan.classList.add('bookmark-group-name');
            nameSpan.textContent = tableName;

            groupHeader.appendChild(chevron);
            groupHeader.appendChild(nameSpan);
            groupHeader.addEventListener('click', () => {
                this.toggleGroupCollapsed(createdGroup, tableName);
            });

            const itemsContainer = document.createElement('div');
            itemsContainer.id = itemsId;
            itemsContainer.classList.add('bookmark-group-items');
            itemsContainer.setAttribute('aria-hidden', collapsed ? 'true' : 'false');

            createdGroup.appendChild(groupHeader);
            createdGroup.appendChild(itemsContainer);
            this.contentElement.appendChild(createdGroup);
            this.updateGroupCount(createdGroup);
            this.hydrateGroupSchemaMetaAsync(createdGroup, tableName).catch((e: unknown) => {
                console.warn('[BookmarkPanel] hydrateGroupSchemaMetaAsync failed:', e);
            });
            groupElement = createdGroup;
        }
        return groupElement;
    }

    /**
     * エントリDOM要素を構築してグループに追加する（addBookmark/restoreBookmarks共用）
     */
    private appendEntryElement(tableName: string, rowKey: string, columnName: string, label: string, createdAt: string): void {
        const groupElement = this.getOrCreateGroupElement(tableName);
        const itemsElement = this.getGroupItemsElement(groupElement);
        const entryElement = document.createElement('div');
        entryElement.classList.add('bookmark-entry');
        entryElement.setAttribute('data-table-name', tableName);
        entryElement.setAttribute('data-pk-value', rowKey);
        entryElement.setAttribute('data-column-name', columnName);
        entryElement.setAttribute('data-created-at', createdAt);
        entryElement.setAttribute('role', 'button');
        entryElement.setAttribute('tabindex', '0');
        entryElement.title = `${tableName}.${columnName}: ${label} (${this.formatRowKeyForText(rowKey, null)})`;

        const body = document.createElement('div');
        body.classList.add('bookmark-entry-body');

        const fieldHeader = document.createElement('div');
        fieldHeader.classList.add('bookmark-entry-field-header');

        const labelGroup = document.createElement('div');
        labelGroup.classList.add('bookmark-entry-field-label-group');

        const fieldLabel = document.createElement('div');
        fieldLabel.classList.add('bookmark-entry-field-label');
        fieldLabel.textContent = columnName;
        labelGroup.appendChild(fieldLabel);

        const comment = document.createElement('div');
        comment.classList.add('bookmark-entry-field-comment');
        comment.hidden = true;
        labelGroup.appendChild(comment);

        const meta = document.createElement('div');
        meta.classList.add('bookmark-entry-field-meta');
        meta.hidden = true;

        fieldHeader.appendChild(labelGroup);
        fieldHeader.appendChild(meta);
        body.appendChild(fieldHeader);

        const value = document.createElement('div');
        value.classList.add('bookmark-entry-field-value');
        if (label === '') value.classList.add('bookmark-entry-field-value--empty');

        // セル値/ラベル（テスト互換: .bookmark-entry-display セレクタで "Sword" を取得可能にする）
        const displaySpan = document.createElement('span');
        displaySpan.classList.add('bookmark-entry-display');
        displaySpan.textContent = label;
        value.appendChild(displaySpan);
        body.appendChild(value);

        const location = document.createElement('div');
        location.classList.add('bookmark-entry-location');
        this.renderPrimaryKeyLocation(location, rowKey, null);
        body.appendChild(location);

        // 既存E2Eとコマンドパレット表示形式の互換用テキスト。
        const legacyText = document.createElement('span');
        legacyText.classList.add('bookmark-entry-legacy-text');
        legacyText.setAttribute('aria-hidden', 'true');
        legacyText.textContent = `${columnName}: ${label} (${this.formatRowKeyForText(rowKey, null)})`;
        body.appendChild(legacyText);

        entryElement.appendChild(body);

        // 削除ボタン（×アイコン）
        const deleteButton = document.createElement('button');
        deleteButton.classList.add('bookmark-entry-delete');
        deleteButton.textContent = '\u00d7';
        deleteButton.setAttribute('aria-label', `${tableName}/${columnName}: ${label} (${this.formatRowKeyForText(rowKey, null)}) のブックマークを削除`);
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
        itemsElement.appendChild(entryElement);
        this.updateGroupCount(groupElement);
        this.updateEmptyState();
        this.hydrateEntrySchemaMetaAsync(entryElement, tableName, columnName).catch((e: unknown) => {
            console.warn('[BookmarkPanel] hydrateEntrySchemaMetaAsync failed:', e);
        });
    }

    /**
     * ブックマーク先のテーブル・セルにジャンプする
     * Tab.navigateToBookmarkAsync に委譲する（command-palette.ts と共通ロジック）
     */
    private navigateToBookmark(tableName: string, rowKey: string, columnName: string): void {
        this.tab.navigateToBookmark(tableName, rowKey, columnName);
    }

    private toggleGroupCollapsed(groupElement: HTMLElement, tableName: string): void {
        const header = groupElement.querySelector<HTMLElement>('.bookmark-group-header');
        const items = groupElement.querySelector<HTMLElement>('.bookmark-group-items');
        if (header === null || items === null) return;
        const expanded = header.getAttribute('aria-expanded') === 'true';
        header.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        items.setAttribute('aria-hidden', expanded ? 'true' : 'false');
        if (expanded) {
            this.collapsedGroups.add(tableName);
        } else {
            this.collapsedGroups.delete(tableName);
        }
    }

    private getGroupItemsElement(groupElement: HTMLElement): HTMLElement {
        const itemsElement = groupElement.querySelector<HTMLElement>('.bookmark-group-items');
        if (itemsElement === null) throw new Error('[BookmarkPanel.getGroupItemsElement] .bookmark-group-items が見つかりません');
        return itemsElement;
    }

    private removeGroupIfEmpty(groupElement: HTMLElement): void {
        const itemsElement = groupElement.querySelector<HTMLElement>('.bookmark-group-items');
        if (itemsElement === null) return;
        if (itemsElement.querySelector('.bookmark-entry') !== null) {
            this.updateGroupCount(groupElement);
            return;
        }
        groupElement.remove();
    }

    private updateGroupCount(groupElement: HTMLElement): void {
        const header = groupElement.querySelector<HTMLElement>('.bookmark-group-header');
        const itemsElement = groupElement.querySelector<HTMLElement>('.bookmark-group-items');
        const tableName = groupElement.getAttribute('data-table-name') ?? '';
        if (header === null || itemsElement === null) return;
        const count = itemsElement.querySelectorAll('.bookmark-entry').length;
        header.dataset.countLabel = `${count} 件`;
        header.setAttribute('aria-label', `${tableName} (${count} 件)`);
    }

    private updateEmptyState(): void {
        const hasGroup = this.contentElement.querySelector('.bookmark-group') !== null;
        const currentEmpty = this.contentElement.querySelector<HTMLElement>('.bookmark-panel-empty');
        if (hasGroup) {
            currentEmpty?.remove();
            return;
        }
        if (currentEmpty !== null) return;
        const empty = document.createElement('div');
        empty.classList.add('bookmark-panel-empty');
        empty.textContent = 'ブックマークはありません';
        this.contentElement.appendChild(empty);
    }

    private async hydrateGroupSchemaMetaAsync(groupElement: HTMLElement, tableName: string): Promise<void> {
        const schema = await this.loadSchemaAsync(tableName);
        if (schema === null || !groupElement.isConnected) return;
        if (groupElement.getAttribute('data-table-name') !== tableName) return;
        if (schema.description !== undefined && schema.description !== '') {
            const header = groupElement.querySelector<HTMLElement>('.bookmark-group-header');
            if (header !== null) header.title = schema.description;
        }
    }

    private async hydrateEntrySchemaMetaAsync(entryElement: HTMLElement, tableName: string, columnName: string): Promise<void> {
        const schema = await this.loadSchemaAsync(tableName);
        if (schema === null || !entryElement.isConnected) return;
        if (entryElement.getAttribute('data-table-name') !== tableName || entryElement.getAttribute('data-column-name') !== columnName) return;
        const column = schema.header.find(col => col.name === columnName);
        if (column === undefined) return;
        const rowKey = entryElement.getAttribute('data-pk-value') ?? '';
        const labelText = entryElement.querySelector<HTMLElement>('.bookmark-entry-display')?.textContent ?? '';

        const label = entryElement.querySelector<HTMLElement>('.bookmark-entry-field-label');
        if (label !== null && column.comment !== undefined && column.comment !== '') label.title = column.comment;

        const comment = entryElement.querySelector<HTMLElement>('.bookmark-entry-field-comment');
        const visibleComment = this.getVisibleColumnComment(column);
        if (comment !== null && visibleComment !== null) {
            comment.textContent = visibleComment;
            comment.title = column.comment ?? visibleComment;
            comment.hidden = false;
        }

        const meta = entryElement.querySelector<HTMLElement>('.bookmark-entry-field-meta');
        if (meta === null) return;
        meta.replaceChildren();
        if (this.getPrimaryKeyColumnNames(schema).includes(columnName)) {
            meta.appendChild(this.createEntryChip('PK', 'bookmark-entry-field-chip--pk'));
        }
        if (column.type !== undefined && column.type !== '') {
            meta.appendChild(this.createEntryChip(column.type, 'bookmark-entry-field-chip--type'));
        }
        if (column.reference !== undefined && column.reference !== null && column.reference !== '') {
            meta.appendChild(this.createEntryChip('FK', 'bookmark-entry-field-chip--fk'));
        }
        meta.hidden = meta.childElementCount === 0;

        const location = entryElement.querySelector<HTMLElement>('.bookmark-entry-location');
        if (location !== null) this.renderPrimaryKeyLocation(location, rowKey, schema);
        const formattedPk = this.formatRowKeyForText(rowKey, schema);
        entryElement.title = `${tableName}.${columnName}: ${labelText} (${formattedPk})`;
        const legacyText = entryElement.querySelector<HTMLElement>('.bookmark-entry-legacy-text');
        if (legacyText !== null) legacyText.textContent = `${columnName}: ${labelText} (${formattedPk})`;
        const deleteButton = entryElement.querySelector<HTMLElement>('.bookmark-entry-delete');
        if (deleteButton !== null) deleteButton.setAttribute('aria-label', `${tableName}/${columnName}: ${labelText} (${formattedPk}) のブックマークを削除`);
    }

    private loadSchemaAsync(tableName: string): Promise<BookmarkSchemaJson | null> {
        const cached = this.schemaCache.get(tableName);
        if (cached !== undefined) return cached;
        const promise = readFileAsync(`schema/${tableName}.json`)
            .then(text => JSON.parse(text) as BookmarkSchemaJson)
            .catch(() => null);
        this.schemaCache.set(tableName, promise);
        return promise;
    }

    private createEntryChip(text: string, modifierClass: string): HTMLElement {
        const chip = document.createElement('span');
        chip.classList.add('bookmark-entry-chip', modifierClass);
        chip.textContent = text;
        return chip;
    }

    private renderPrimaryKeyLocation(location: HTMLElement, rowKey: string, schema: BookmarkSchemaJson | null): void {
        location.replaceChildren(...this.createPrimaryKeyChips(rowKey, schema));
    }

    private createPrimaryKeyChips(rowKey: string, schema: BookmarkSchemaJson | null): HTMLElement[] {
        const values = this.splitRowKeyValues(rowKey);
        const pkColumnNames = schema !== null ? this.getPrimaryKeyColumnNames(schema) : [];
        if (pkColumnNames.length > 1 && values.length === pkColumnNames.length) {
            return pkColumnNames.map((name, index) => this.createEntryChip(`PK ${name}=${values[index]}`, 'bookmark-entry-location-chip--pk'));
        }
        if (pkColumnNames.length === 1 && values.length === 1) {
            return [this.createEntryChip(`PK ${pkColumnNames[0]}=${values[0]}`, 'bookmark-entry-location-chip--pk')];
        }
        return [this.createEntryChip(`PK ${this.formatRowKeyForText(rowKey, schema)}`, 'bookmark-entry-location-chip--pk')];
    }

    private formatRowKeyForText(rowKey: string, schema: BookmarkSchemaJson | null): string {
        const values = this.splitRowKeyValues(rowKey);
        const pkColumnNames = schema !== null ? this.getPrimaryKeyColumnNames(schema) : [];
        if (pkColumnNames.length === 1 && values.length === 1) {
            return `${pkColumnNames[0]}=${values[0]}`;
        }
        if (pkColumnNames.length > 1 && values.length === pkColumnNames.length) {
            return pkColumnNames.map((name, index) => `${name}=${values[index]}`).join(', ');
        }
        return values.join(' / ');
    }

    private splitRowKeyValues(rowKey: string): string[] {
        return rowKey.split('\t');
    }

    private getVisibleColumnComment(colSchema: BookmarkSchemaColumn): string | null {
        const comment = colSchema.comment;
        if (comment === undefined || comment === '') return null;
        const firstLine = comment.split('\n')[0];
        return firstLine === '' ? null : firstLine;
    }

    private getPrimaryKeyColumnNames(schema: BookmarkSchemaJson): string[] {
        if (schema.primary_key === undefined) return [];
        if (Array.isArray(schema.primary_key)) return schema.primary_key;
        return [schema.primary_key];
    }
}
