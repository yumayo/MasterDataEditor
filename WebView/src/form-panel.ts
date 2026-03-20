import {InMemoryTableStore} from "./in-memory-table-store";
import {ReverseReferenceResolver} from "./reverse-reference-resolver";
import {determineDisplayColumnName} from "./config";
import {readFileAsync} from "./api";
import {Csv} from "./csv";
import {extractFirstPrimaryKeyColumn} from "./schema-utils";
import {parseReferenceExpression, isSimpleReference} from "./reference-expression";
import {Tab} from "./tab";
import {NotificationToast} from "./notification";

/**
 * フォームパネルの1ページ（ナビゲーションスタックの1エントリ）
 */
interface FormPage {
    /** テーブル名 */
    tableName: string;
    /** 表示行のPK値 */
    pkValue: string;
    /** パンくずに表示するラベル */
    label: string;
}

/**
 * FK参照先またはFK参照元（1:N）のセクション情報
 */
interface RefSectionData {
    /** セクションタイトル */
    title: string;
    /** 参照先テーブル名 */
    tableKey: string;
    /** 参照先テーブルのヘッダー */
    header: string[];
    /** 参照先テーブルの行一覧 */
    rows: string[][];
    /** FK列名 */
    fkColumnName: string;
    /** 参照種別 */
    relationType: 'N:1' | '1:N';
    /** 参照先テーブルのPK列名（スキーマから取得） */
    primaryKeyColumnName: string;
}

/**
 * フォームビューパネル
 *
 * 選択行の全フィールドをkey:value形式で縦表示し、
 * FK参照先・逆参照をアコーディオン形式で表示する。
 * ドリルダウンは深さ4段まで対応する。
 *
 * RelationsPanel を一時的にオーバーレイして表示する。
 * ✕ボタンで閉じると Tab.closeFormPanel() 経由で RelationsPanel が再表示される。
 */
export class FormPanel {
    private readonly panelElement: HTMLElement;
    private readonly store: InMemoryTableStore;
    private readonly reverseReferenceResolver: ReverseReferenceResolver;
    private readonly tab: Tab;
    private readonly notification: NotificationToast;
    /** ナビゲーションスタック（先頭がルート、末尾が現在表示中ページ） */
    private navStack: FormPage[];
    /** レースコンディション防止用リクエストID */
    private currentRequestId: number;

    /** 最大ドリルダウン深度 */
    private static readonly MAX_DEPTH = 4;

    constructor(store: InMemoryTableStore, tab: Tab, notification: NotificationToast) {
        this.store = store;
        this.reverseReferenceResolver = new ReverseReferenceResolver(store);
        this.tab = tab;
        this.notification = notification;
        this.navStack = [];
        this.currentRequestId = 0;

        const panel = document.createElement('div');
        panel.classList.add('form-panel');
        this.panelElement = panel;

        // ヘッダー（パンくず + ✕ボタンを水平レイアウト）
        const header = document.createElement('div');
        header.classList.add('form-panel-header');
        const breadcrumb = document.createElement('div');
        breadcrumb.classList.add('form-panel-breadcrumb');
        header.appendChild(breadcrumb);

        // ✕ボタンをheader内右端に配置する
        const closeButton = document.createElement('button');
        closeButton.classList.add('form-panel-close');
        closeButton.setAttribute('aria-label', 'フォームビューを閉じる');
        closeButton.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`;
        closeButton.addEventListener('click', () => { this.tab.closeFormPanel(); });
        header.appendChild(closeButton);
        this.panelElement.appendChild(header);

        // コンテンツ（スクロール領域）
        const content = document.createElement('div');
        content.classList.add('form-panel-content');
        this.panelElement.appendChild(content);
    }

    /**
     * 親要素にパネルを追加する
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.panelElement);
    }

    /**
     * パネルのDOM要素をDOMから削除する（Tab.closeFormPanel から呼ばれる）
     */
    remove(): void {
        this.panelElement.remove();
    }

    /**
     * 指定テーブル・行のフォームを表示する
     * Tab.showFormPanel() から呼ばれる
     */
    showForRowAsync(tableName: string, pkValue: string): Promise<void> {
        this.navStack = [{ tableName, pkValue, label: `${tableName} / ${pkValue}` }];
        return this.renderCurrentPageAsync();
    }

    /**
     * パンくずの指定インデックスまで戻る
     */
    private goToPageAsync(index: number): Promise<void> {
        this.navStack = this.navStack.slice(0, index + 1);
        return this.renderCurrentPageAsync();
    }

    /**
     * 参照アイテムをクリックしてドリルダウンする
     */
    private drillDownAsync(tableName: string, pkValue: string, label: string): Promise<void> {
        if (this.navStack.length >= FormPanel.MAX_DEPTH) return Promise.resolve();
        this.navStack.push({ tableName, pkValue, label });
        return this.renderCurrentPageAsync();
    }

    /**
     * 現在のナビゲーションスタックトップのページを描画する
     */
    private async renderCurrentPageAsync(): Promise<void> {
        const requestId = ++this.currentRequestId;
        const page = this.navStack[this.navStack.length - 1];

        // パンくずを更新する
        this.renderBreadcrumb();

        // コンテンツ領域をクリアしてローディング表示
        const content = this.panelElement.querySelector('.form-panel-content') as HTMLElement;
        content.innerHTML = '';
        const loading = document.createElement('div');
        loading.classList.add('form-panel-loading');
        loading.textContent = '読み込み中...';
        content.appendChild(loading);

        try {
            // テーブルデータを取得する
            const { header, rows } = await this.resolveTableDataAsync(page.tableName);
            if (requestId !== this.currentRequestId) return;

            // スキーマからPK列名を取得してPK列インデックスを特定する
            // loadSchemaJsonAsync の呼び出しより先にスキーマが必要なため先行ロードする
            const pageSchema = await this.loadSchemaJsonAsync(page.tableName);
            if (requestId !== this.currentRequestId) return;
            const pagePkColumnName = extractFirstPrimaryKeyColumn(pageSchema);
            const pkColIdx = header.indexOf(pagePkColumnName);
            // 対象行をPK値で検索する
            const targetRow = rows.find(row => row[pkColIdx] !== undefined && row[pkColIdx] === page.pkValue);
            if (requestId !== this.currentRequestId) return;

            // 逆参照マップを取得する
            const reverseMap = await this.reverseReferenceResolver.resolveAsync(page.tableName, pagePkColumnName);
            if (requestId !== this.currentRequestId) return;

            // コンテンツを構築する
            content.innerHTML = '';

            // タイトル行
            const title = document.createElement('div');
            title.classList.add('form-panel-title');
            const titleTable = document.createElement('span');
            titleTable.classList.add('form-panel-title-table');
            titleTable.textContent = page.tableName;
            const titlePk = document.createElement('span');
            titlePk.classList.add('form-panel-title-pk');
            titlePk.textContent = page.pkValue;
            title.appendChild(titleTable);
            title.appendChild(titlePk);
            content.appendChild(title);

            if (targetRow === undefined) {
                // 行が見つからない場合は案内を表示する
                const notFound = document.createElement('div');
                notFound.classList.add('form-panel-not-found');
                notFound.textContent = `PK "${page.pkValue}" の行が見つかりません`;
                content.appendChild(notFound);
                return;
            }

            // 深さインジケーター
            const depthBar = this.buildDepthBar(this.navStack.length - 1);
            content.appendChild(depthBar);

            // フィールド一覧を構築する
            const fieldsContainer = document.createElement('div');
            fieldsContainer.classList.add('form-panel-fields');
            // 2列ずつ横並びでフィールドを配置する（最後の列が奇数の場合は1列）
            for (let i = 0; i < header.length; i += 2) {
                const row = document.createElement('div');
                row.classList.add('form-panel-field-row');
                row.appendChild(this.buildFieldElement(header[i], targetRow[i] ?? ''));
                if (i + 1 < header.length) {
                    row.appendChild(this.buildFieldElement(header[i + 1], targetRow[i + 1] ?? ''));
                }
                fieldsContainer.appendChild(row);
            }
            content.appendChild(fieldsContainer);

            // FK参照先セクション（N:1）を構築する（pageSchemaを再利用）
            const fkSections = this.buildFkSections(header, targetRow, pageSchema);
            for (const section of fkSections) {
                const sectionEl = this.buildRefSection(section, this.navStack.length - 1);
                content.appendChild(sectionEl);
            }

            // 逆参照セクション（1:N）を構築する
            const pkValue = page.pkValue;
            const reverseEntries = reverseMap.get(pkValue) ?? [];
            // priority でソートして優先度の高いものを先に表示する
            const sortedEntries = [...reverseEntries].sort((a, b) => a.priority - b.priority);
            for (const entry of sortedEntries) {
                // 逆参照の行とスキーマをストア優先で取得する
                const [childData, childSchema] = await Promise.all([
                    this.resolveTableDataAsync(entry.childTableName),
                    this.loadSchemaJsonAsync(entry.childTableName),
                ]);
                if (requestId !== this.currentRequestId) return;
                const fkColIdx = childData.header.indexOf(entry.childColumnName);
                const filteredRows = fkColIdx === -1
                    ? []
                    : childData.rows.filter(row => row[fkColIdx] === pkValue);
                const childPkColumnName = extractFirstPrimaryKeyColumn(childSchema);
                const section: RefSectionData = {
                    title: `← ${entry.childTableName}（${entry.childColumnName}）`,
                    tableKey: entry.childTableName,
                    header: childData.header,
                    rows: filteredRows,
                    fkColumnName: entry.childColumnName,
                    relationType: '1:N',
                    primaryKeyColumnName: childPkColumnName,
                };
                const sectionEl = this.buildRefSection(section, this.navStack.length - 1);
                content.appendChild(sectionEl);
            }
        } catch (err) {
            // エラー時はローディング表示をエラーメッセージに差し替える
            content.innerHTML = '';
            const errorEl = document.createElement('div');
            errorEl.classList.add('form-panel-error');
            errorEl.textContent = 'エラーが発生しました';
            content.appendChild(errorEl);
            console.error('[FormPanel] renderCurrentPageAsync failed:', err);
            this.notification.show('フォームの表示に失敗しました');
        }
    }

    /**
     * パンくずナビゲーションをレンダリングする
     */
    private renderBreadcrumb(): void {
        const breadcrumb = this.panelElement.querySelector('.form-panel-breadcrumb') as HTMLElement;
        breadcrumb.innerHTML = '';
        for (let i = 0; i < this.navStack.length; i++) {
            if (i > 0) {
                const sep = document.createElement('span');
                sep.classList.add('form-panel-breadcrumb-sep');
                sep.textContent = '/';
                breadcrumb.appendChild(sep);
            }
            const item = document.createElement('span');
            item.classList.add('form-panel-breadcrumb-item');
            if (i === this.navStack.length - 1) {
                item.classList.add('form-panel-breadcrumb-item--current');
            } else {
                item.classList.add('form-panel-breadcrumb-item--link');
                const capturedIndex = i;
                item.addEventListener('click', () => {
                    this.goToPageAsync(capturedIndex).catch(err => {
                        console.error('[FormPanel] goToPageAsync failed:', err);
                        this.notification.show('フォームのページ遷移に失敗しました');
                    });
                });
            }
            item.textContent = this.navStack[i].label;
            breadcrumb.appendChild(item);
        }
    }

    /**
     * フィールド要素を構築する（ラベル + 値）
     */
    private buildFieldElement(label: string, value: string): HTMLElement {
        const field = document.createElement('div');
        field.classList.add('form-panel-field');
        const labelEl = document.createElement('div');
        labelEl.classList.add('form-panel-field-label');
        labelEl.textContent = label;
        const valueEl = document.createElement('div');
        valueEl.classList.add('form-panel-field-value');
        valueEl.textContent = value === '' ? '—' : value;
        if (value === '') valueEl.classList.add('form-panel-field-value--empty');
        field.appendChild(labelEl);
        field.appendChild(valueEl);
        return field;
    }

    /**
     * 深さインジケーターを構築する
     */
    private buildDepthBar(depth: number): HTMLElement {
        const bar = document.createElement('div');
        bar.classList.add('form-panel-depth-bar');
        for (let i = 0; i < FormPanel.MAX_DEPTH; i++) {
            const dot = document.createElement('div');
            dot.classList.add('form-panel-depth-dot');
            if (i <= depth) dot.classList.add('form-panel-depth-dot--active');
            bar.appendChild(dot);
        }
        return bar;
    }

    /**
     * FK参照先セクション（N:1）のデータを構築する
     * スキーマのreference定義から単純参照のみ対応する（動的参照は省略）
     */
    private buildFkSections(header: string[], row: string[], schemaJson: SchemaJson): RefSectionData[] {
        const sections: RefSectionData[] = [];
        for (let i = 0; i < header.length; i++) {
            const colName = header[i];
            const fkValue = row[i] ?? '';
            if (fkValue === '') continue;
            // スキーマから対応する列定義を探す（header キーを使用）
            const colDef = schemaJson.header.find(c => c.name === colName);
            if (!colDef || !colDef.reference) continue;
            const expr = parseReferenceExpression(colDef.reference);
            if (!isSimpleReference(expr)) continue;
            // FK参照先テーブルのデータをストアから取得する（非同期は構築時には行えないため後続でロードする）
            // primaryKeyColumnName は loadFkSectionDataAsync で非同期取得するため空文字列をプレースホルダーとする
            sections.push({
                title: `→ ${expr.tableName}（${colName}）`,
                tableKey: expr.tableName,
                header: [],
                rows: [],
                fkColumnName: colName,
                relationType: 'N:1',
                primaryKeyColumnName: '',
            });
        }
        return sections;
    }

    /**
     * RefItem要素を構築する（参照アイテムの共通描画処理）
     * buildRefSection と loadFkSectionDataAsync の両方から呼ばれる
     */
    private buildRefItemElement(tableKey: string, refPkValue: string, displayValue: string, canDrillDown: boolean): HTMLElement {
        const refItem = document.createElement('div');
        refItem.classList.add('form-panel-ref-item');
        if (canDrillDown) refItem.classList.add('form-panel-ref-item--clickable');
        const refMain = document.createElement('div');
        refMain.classList.add('form-panel-ref-item-main');
        refMain.textContent = refPkValue !== '' ? refPkValue : '(PK値なし)';
        refItem.appendChild(refMain);
        if (displayValue !== '' && displayValue !== refPkValue) {
            const refSub = document.createElement('div');
            refSub.classList.add('form-panel-ref-item-sub');
            refSub.textContent = displayValue;
            refItem.appendChild(refSub);
        }
        if (canDrillDown) {
            const arrowEl = document.createElement('div');
            arrowEl.classList.add('form-panel-ref-item-arrow');
            arrowEl.textContent = '→';
            refItem.appendChild(arrowEl);
            const capturedLabel = displayValue !== '' ? displayValue : refPkValue;
            refItem.addEventListener('click', () => {
                this.drillDownAsync(tableKey, refPkValue, capturedLabel).catch(err => {
                    console.error('[FormPanel] drillDownAsync failed:', err);
                    this.notification.show('フォームのドリルダウンに失敗しました');
                });
            });
        }
        return refItem;
    }

    /**
     * 参照セクション要素を構築する（アコーディオン形式）
     * N:1は参照先テーブルのPK値が一致する行を、1:Nは逆参照行を表示する
     */
    private buildRefSection(section: RefSectionData, currentDepth: number): HTMLElement {
        const container = document.createElement('div');
        container.classList.add('form-panel-section');

        // セクションヘッダー
        const sectionHeader = document.createElement('div');
        sectionHeader.classList.add('form-panel-section-header');
        const arrow = document.createElement('span');
        arrow.classList.add('form-panel-section-arrow');
        arrow.textContent = '▸';
        const titleSpan = document.createElement('span');
        titleSpan.classList.add('form-panel-section-title');
        titleSpan.textContent = section.title;
        const badge = document.createElement('span');
        badge.classList.add('form-panel-section-badge');
        badge.textContent = String(section.rows.length);
        sectionHeader.appendChild(arrow);
        sectionHeader.appendChild(titleSpan);
        sectionHeader.appendChild(badge);
        container.appendChild(sectionHeader);

        // セクションボディ（開閉制御）
        const body = document.createElement('div');
        body.classList.add('form-panel-section-body');
        // セクション内のRefItemを構築する
        if (section.rows.length === 0) {
            const empty = document.createElement('div');
            empty.classList.add('form-panel-section-empty');
            empty.textContent = '参照なし';
            body.appendChild(empty);
        } else {
            const pkColIdx = section.primaryKeyColumnName !== '' ? section.header.indexOf(section.primaryKeyColumnName) : -1;
            const sectionDisplayColName = determineDisplayColumnName(section.header);
            const displayColIdx = sectionDisplayColName !== '' ? section.header.indexOf(sectionDisplayColName) : -1;
            for (const refRow of section.rows) {
                const refPkValue = pkColIdx !== -1 ? (refRow[pkColIdx] ?? '') : '';
                const displayValue = displayColIdx !== -1 ? (refRow[displayColIdx] ?? '') : '';
                const canDrillDown = currentDepth < FormPanel.MAX_DEPTH - 1 && refPkValue !== '';
                body.appendChild(this.buildRefItemElement(section.tableKey, refPkValue, displayValue, canDrillDown));
            }
        }
        container.appendChild(body);

        // 開閉制御（クリックでtoggle）
        let isOpen = false;
        body.style.display = 'none';
        sectionHeader.addEventListener('click', () => {
            isOpen = !isOpen;
            body.style.display = isOpen ? '' : 'none';
            arrow.classList.toggle('form-panel-section-arrow--open', isOpen);
        });

        // 非同期でN:1参照先テーブルのデータをロードしてbodyを更新する
        if (section.relationType === 'N:1' && section.rows.length === 0 && section.header.length === 0) {
            // バックグラウンドでFK参照データをロードする（失敗時はユーザーに通知しない、ノイズ防止）
            this.loadFkSectionDataAsync(section, body, badge, currentDepth).catch(err => {
                console.error('[FormPanel] loadFkSectionDataAsync failed:', err);
            });
        }

        return container;
    }

    /**
     * FK参照先（N:1）セクションのデータを非同期でロードしてDOMを更新する
     * buildRefSection では同期的にPlaceholderを描画し、このメソッドで後から内容を埋める
     * section.tableKey と section.fkColumnName を直接使用する（表示文字列をSSOTにしない）
     */
    private async loadFkSectionDataAsync(
        section: RefSectionData,
        body: HTMLElement,
        badge: HTMLElement,
        currentDepth: number
    ): Promise<void> {
        const requestId = this.currentRequestId;

        // FK値は現在ページのソーステーブルから section.fkColumnName で取得する
        const currentPage = this.navStack[this.navStack.length - 1];
        const [srcData, srcSchema] = await Promise.all([
            this.resolveTableDataAsync(currentPage.tableName),
            this.loadSchemaJsonAsync(currentPage.tableName),
        ]);
        if (requestId !== this.currentRequestId) return;
        const srcPkColumnName = extractFirstPrimaryKeyColumn(srcSchema);
        const pkColIdx = srcData.header.indexOf(srcPkColumnName);
        const srcRow = srcData.rows.find(row => row[pkColIdx] !== undefined && row[pkColIdx] === currentPage.pkValue);
        if (srcRow === undefined) return;
        const fkColIdx = srcData.header.indexOf(section.fkColumnName);
        if (fkColIdx === -1) return;
        const fkValue = srcRow[fkColIdx];
        if (fkValue === '' || fkValue === undefined) return;

        // FK参照先テーブルのデータとスキーマを取得し、PK列がfkValueと一致する行を検索する
        const [targetData, targetSchema] = await Promise.all([
            this.resolveTableDataAsync(section.tableKey),
            this.loadSchemaJsonAsync(section.tableKey),
        ]);
        if (requestId !== this.currentRequestId) return;
        const targetPkColumnName = extractFirstPrimaryKeyColumn(targetSchema);
        const targetPkColIdx = targetData.header.indexOf(targetPkColumnName);
        const matchedRows = targetPkColIdx !== -1
            ? targetData.rows.filter(row => row[targetPkColIdx] === fkValue)
            : [];

        // badge とbodyを更新する
        badge.textContent = String(matchedRows.length);
        body.innerHTML = '';

        if (matchedRows.length === 0) {
            const empty = document.createElement('div');
            empty.classList.add('form-panel-section-empty');
            empty.textContent = '参照なし';
            body.appendChild(empty);
            return;
        }

        const targetDisplayColName = determineDisplayColumnName(targetData.header);
        const displayColIdx = targetDisplayColName !== '' ? targetData.header.indexOf(targetDisplayColName) : -1;
        for (const refRow of matchedRows) {
            const refPkValue = targetPkColIdx !== -1 ? (refRow[targetPkColIdx] ?? '') : '';
            const displayValue = displayColIdx !== -1 ? (refRow[displayColIdx] ?? '') : '';
            const canDrillDown = currentDepth < FormPanel.MAX_DEPTH - 1 && refPkValue !== '';
            body.appendChild(this.buildRefItemElement(section.tableKey, refPkValue, displayValue, canDrillDown));
        }
    }

    /**
     * テーブルデータをストア優先・CSV直読みで取得する
     */
    private async resolveTableDataAsync(tableName: string): Promise<{ header: string[]; rows: string[][] }> {
        const storeHeader = this.store.getHeader(tableName);
        const storeRows = this.store.getRows(tableName);
        if (storeHeader !== false && storeRows !== false) {
            return { header: storeHeader, rows: storeRows };
        }
        const csvText = await readFileAsync(`data/${tableName}.csv`);
        const csv = new Csv();
        csv.load(csvText);
        return { header: csv.header, rows: csv.body };
    }

    /**
     * スキーマJSONをロードする（FK参照定義・PK列名の取得に使用）
     * ロードに失敗した場合は例外を伝播させる
     */
    private async loadSchemaJsonAsync(tableName: string): Promise<SchemaJson> {
        const text = await readFileAsync(`schema/${tableName}.json`);
        return JSON.parse(text) as SchemaJson;
    }
}

/**
 * スキーマJSONの型定義（最小限）
 * 実際のスキーマJSONは "header" キーを使用している
 */
interface SchemaJson {
    header: Array<{ name: string; reference?: string }>;
    primary_key: string | string[];
    /** JSONパース結果なので任意のキーが存在しうる（extractFirstPrimaryKeyColumn との互換性に必要） */
    [key: string]: unknown;
}
