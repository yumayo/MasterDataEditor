import {Tab} from "./tab";
import {fuzzyMatch, appendHighlightedSegments} from "./fuzzy-search";
import {SearchDataProvider} from "./search-data-provider";
import {EditorTable} from "./editor-table";

/**
 * コマンドパレットの候補アイテム（テーブル名ファジー検索用）
 */
interface TableItem {
    kind: 'table';
    displayName: string;
    tabName: string;
    description: string | null;
}

/**
 * クエリ式の検索結果アイテム（テーブル名.列名=値 で検索した結果）
 */
interface QueryResultItem {
    kind: 'query';
    tableName: string;
    pkValue: string;
    columnName: string;
    columnIndex: number;
    matchValue: string;
}

/**
 * ブックマーク候補アイテム（@bookmark プレフィクスで検索した結果）
 */
interface BookmarkItem {
    kind: 'bookmark';
    tableName: string;
    rowKey: string;
    columnName: string;
    label: string;
}

/** 候補リストの各要素はテーブル名候補、クエリ式結果、またはブックマーク候補のいずれか */
type PaletteItem = TableItem | QueryResultItem | BookmarkItem;

/** クエリ式の最大候補表示件数 */
const QUERY_RESULT_MAX = 20;

/**
 * コマンドパレット
 *
 * Ctrl+P で表示され、以下の2つのモードで動作する:
 * 1. テーブル名ファジー検索: テーブル名または description で絞り込み、選択したタブを開く
 * 2. クエリ式セルジャンプ: 「テーブル名.列名=値」形式で入力し、該当行の該当セルにジャンプする
 */
export class CommandPalette {
    private readonly tab: Tab;
    private readonly dataProvider: SearchDataProvider;
    private readonly tableItems: TableItem[];
    private readonly overlayElement: HTMLElement;
    private readonly inputElement: HTMLInputElement;
    private readonly listElement: HTMLElement;
    private selectedIndex: number;
    /** フィルタ済みの候補アイテム（Enter/クリック確定時にアクセスする） */
    private filteredItems: PaletteItem[];
    /** 非同期クエリ式検索のレースコンディション防止用リクエストID */
    private queryRequestId: number;

    constructor(tab: Tab, parentElement: HTMLElement, openEditorTables: Map<string, EditorTable>) {
        this.tab = tab;
        this.dataProvider = new SearchDataProvider(openEditorTables);
        this.tableItems = [];
        this.selectedIndex = 0;
        this.filteredItems = [];
        this.queryRequestId = 0;

        // オーバーレイ要素を構築
        this.overlayElement = document.createElement('div');
        this.overlayElement.classList.add('command-palette-overlay');

        // パレット本体
        const paletteElement = document.createElement('div');
        paletteElement.classList.add('command-palette');

        // 検索入力欄
        this.inputElement = document.createElement('input');
        this.inputElement.classList.add('command-palette-input');
        this.inputElement.type = 'text';
        this.inputElement.placeholder = 'テーブル名 or テーブル名.列名=値';

        // 候補リスト
        this.listElement = document.createElement('div');
        this.listElement.classList.add('command-palette-list');

        // DOM組み立て
        paletteElement.appendChild(this.inputElement);
        paletteElement.appendChild(this.listElement);
        this.overlayElement.appendChild(paletteElement);
        parentElement.appendChild(this.overlayElement);

        // イベントハンドラを登録
        this.overlayElement.addEventListener('mousedown', (e: MouseEvent) => {
            // オーバーレイ背景部分のクリックでのみ閉じる（パレット本体のクリックは無視）
            if (e.target === this.overlayElement) {
                this.hide();
            }
        });

        this.inputElement.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.hide();
                return;
            }
            // Enterキー：選択中の項目で確定する
            if (e.key === 'Enter') {
                e.preventDefault();
                this.confirmSelection(this.selectedIndex);
                return;
            }
            // 上下キー：選択を循環移動する
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const visibleItems = this.listElement.querySelectorAll('.command-palette-item');
                if (visibleItems.length === 0) return;
                const delta = e.key === 'ArrowDown' ? 1 : -1;
                this.selectedIndex = (this.selectedIndex + delta + visibleItems.length) % visibleItems.length;
                this.updateSelection(visibleItems);
                return;
            }
        });

        // 入力テキスト変更時にフィルタリングを実行
        this.inputElement.addEventListener('input', () => {
            this.renderList(this.inputElement.value);
        });
    }

    /**
     * テーブルを候補リストに登録する
     */
    registerTable(tableName: string, description: string | null): void {
        this.tableItems.push({kind: 'table', displayName: tableName, tabName: tableName, description: description});
    }

    /**
     * コマンドパレットを表示する
     * 入力欄をクリアし、全項目を表示した状態で開く
     */
    show(): void {
        this.overlayElement.classList.add('visible');
        this.inputElement.value = '';
        this.renderList('');
        this.inputElement.focus();
    }

    /**
     * コマンドパレットを非表示にする
     */
    hide(): void {
        this.overlayElement.classList.remove('visible');
    }

    /**
     * 選択中の項目で確定してパレットを閉じる
     * テーブル名モード: tab.append + click でタブを開く
     * クエリ式モード: tab.navigateToTableCell でセルにジャンプする
     */
    private confirmSelection(index: number): void {
        if (this.filteredItems.length === 0) return;
        if (index < 0 || index >= this.filteredItems.length) return;
        const item = this.filteredItems[index];
        if (item.kind === 'table') {
            // テーブル名モード: タブを開く
            const tabButton = this.tab.append(item.tabName, null);
            tabButton.click();
        } else if (item.kind === 'query') {
            // クエリ式モード: 該当セルにジャンプする
            this.tab.navigateToTableCell(item.tableName, item.pkValue, item.columnIndex);
        } else {
            // ブックマークモード: Tab の共通ジャンプメソッドに委譲する
            this.tab.navigateToBookmark(item.tableName, item.rowKey, item.columnName);
        }
        this.hide();
    }

    /**
     * フィルタテキストに基づいてリストを描画する
     * クエリ式（テーブル名.列名=値）にマッチする場合はクエリ式検索を実行し、
     * それ以外はテーブル名のファジー検索を行う
     */
    private renderList(filterText: string): void {
        // @bookmark プレフィクス: ブックマーク一覧を表示する
        if (filterText.startsWith('@bookmark')) {
            const query = filterText.slice('@bookmark'.length).trim();
            this.renderBookmarkList(query);
            return;
        }
        // クエリ式の判定: テーブル名.列名=値 のパターン
        const queryMatch = filterText.match(/^(\w+)\.(\w+)\s*=\s*(.+)$/);
        if (queryMatch) {
            const tableName = queryMatch[1];
            const columnName = queryMatch[2];
            const searchValue = queryMatch[3].trim();
            this.renderQueryResultsAsync(tableName, columnName, searchValue);
            return;
        }
        // テーブル名ファジー検索モード
        this.renderTableList(filterText);
    }

    /**
     * テーブル名ファジー検索の候補リストを描画する
     */
    private renderTableList(filterText: string): void {
        this.listElement.innerHTML = '';
        this.selectedIndex = 0;

        // テーブル名またはdescriptionのfuzzyMatchでフィルタリング
        const filtered: TableItem[] = filterText === ''
            ? [...this.tableItems]
            : this.tableItems.filter(item =>
                fuzzyMatch(item.displayName, filterText) ||
                (item.description !== null && fuzzyMatch(item.description, filterText))
            );
        this.filteredItems = filtered;

        if (filtered.length === 0) {
            const emptyElement = document.createElement('div');
            emptyElement.classList.add('command-palette-empty');
            emptyElement.textContent = '該当する項目がありません';
            this.listElement.appendChild(emptyElement);
            return;
        }

        // フィルタ結果をリストに描画
        for (let i = 0; i < filtered.length; ++i) {
            const item = filtered[i];
            const itemElement = document.createElement('div');
            itemElement.classList.add('command-palette-item');
            if (i === 0) {
                itemElement.classList.add('selected');
            }

            const nameElement = document.createElement('span');
            nameElement.classList.add('command-palette-item-name');
            if (filterText !== '') {
                appendHighlightedSegments(nameElement, item.displayName, filterText);
            } else {
                nameElement.textContent = item.displayName;
            }

            const clickIndex = i;
            itemElement.addEventListener('mousedown', (e: MouseEvent) => {
                e.preventDefault();
                this.confirmSelection(clickIndex);
            });

            itemElement.appendChild(nameElement);

            // descriptionが設定されている場合のみ右端に表示する
            if (item.description !== null) {
                const descElement = document.createElement('span');
                descElement.classList.add('command-palette-item-description');
                if (filterText !== '') {
                    appendHighlightedSegments(descElement, item.description, filterText);
                } else {
                    descElement.textContent = item.description;
                }
                itemElement.appendChild(descElement);
            }

            this.listElement.appendChild(itemElement);
        }
    }

    /**
     * ブックマーク一覧を候補リストに描画する
     * Tab 経由で BookmarkPanel からブックマーク一覧を取得し、query で絞り込む
     */
    private renderBookmarkList(query: string): void {
        this.listElement.innerHTML = '';
        this.selectedIndex = 0;
        const bookmarks = this.tab.getBookmarks();
        // query が空でなければテーブル名・列名・ラベルのいずれかに部分一致する候補に絞り込む
        const lowerQuery = query.toLowerCase();
        const filtered: BookmarkItem[] = [];
        for (const bm of bookmarks) {
            if (query === '' || bm.tableName.toLowerCase().includes(lowerQuery) || bm.columnName.toLowerCase().includes(lowerQuery) || bm.label.toLowerCase().includes(lowerQuery)) {
                filtered.push({ kind: 'bookmark', tableName: bm.tableName, rowKey: bm.rowKey, columnName: bm.columnName, label: bm.label });
            }
        }
        this.filteredItems = filtered;
        if (filtered.length === 0) {
            const emptyElement = document.createElement('div');
            emptyElement.classList.add('command-palette-empty');
            emptyElement.textContent = '該当する項目がありません';
            this.listElement.appendChild(emptyElement);
            return;
        }
        for (let i = 0; i < filtered.length; ++i) {
            const item = filtered[i];
            const itemElement = document.createElement('div');
            itemElement.classList.add('command-palette-item');
            if (i === 0) itemElement.classList.add('selected');
            // テーブル名
            const nameElement = document.createElement('span');
            nameElement.classList.add('command-palette-item-name');
            nameElement.textContent = item.tableName;
            itemElement.appendChild(nameElement);
            // 列名: ラベル (PK値) を右端に表示する
            const descElement = document.createElement('span');
            descElement.classList.add('command-palette-item-description');
            descElement.textContent = item.columnName + ': ' + item.label + ' (' + item.rowKey + ')';
            itemElement.appendChild(descElement);
            const clickIndex = i;
            itemElement.addEventListener('mousedown', (e: MouseEvent) => {
                e.preventDefault();
                this.confirmSelection(clickIndex);
            });
            this.listElement.appendChild(itemElement);
        }
    }

    /**
     * クエリ式の検索結果を非同期で取得して候補リストに描画する
     * SearchDataProvider 経由でテーブルデータをロードし、列の値が一致する行を候補として表示する
     */
    private async renderQueryResultsAsync(tableName: string, columnName: string, searchValue: string): Promise<void> {
        // レースコンディション防止: リクエストIDをインクリメントしてから非同期処理に入る
        ++this.queryRequestId;
        const requestId = this.queryRequestId;

        // テーブルが登録済みか確認する（tableItems はスキーマ読み込み時に登録される）
        const tableExists = this.tableItems.some(item => item.tabName === tableName);
        if (!tableExists) {
            this.listElement.innerHTML = '';
            this.selectedIndex = 0;
            this.filteredItems = [];
            const emptyElement = document.createElement('div');
            emptyElement.classList.add('command-palette-empty');
            emptyElement.textContent = "テーブル '" + tableName + "' が見つかりません";
            this.listElement.appendChild(emptyElement);
            return;
        }

        // SearchDataProvider からテーブルデータを非同期取得する
        const tableData = await this.dataProvider.getTableDataAsync(tableName);

        // レースコンディション: 非同期取得中に別の入力が発生した場合は結果を破棄する
        if (requestId !== this.queryRequestId) return;

        // 列名から列インデックスを解決する
        const columnIndex = tableData.csvHeader.indexOf(columnName);
        if (columnIndex === -1) {
            this.listElement.innerHTML = '';
            this.selectedIndex = 0;
            this.filteredItems = [];
            const emptyElement = document.createElement('div');
            emptyElement.classList.add('command-palette-empty');
            emptyElement.textContent = '該当する項目がありません';
            this.listElement.appendChild(emptyElement);
            return;
        }

        // PK列のインデックスを取得する
        const pkColumnIndex = tableData.csvHeader.indexOf(tableData.primaryKeyColumnName);

        // 列の値が部分一致する行を検索する（大文字小文字区別なし、最大QUERY_RESULT_MAX件）
        const results: QueryResultItem[] = [];
        const lowerSearchValue = searchValue.toLowerCase();
        for (let r = 0; r < tableData.csvBody.length && results.length < QUERY_RESULT_MAX; ++r) {
            const row = tableData.csvBody[r];
            const cellValue = row[columnIndex];
            if (cellValue.toLowerCase().includes(lowerSearchValue)) {
                results.push({
                    kind: 'query',
                    tableName: tableName,
                    pkValue: pkColumnIndex !== -1 ? row[pkColumnIndex] : '',
                    columnName: columnName,
                    columnIndex: columnIndex,
                    matchValue: cellValue,
                });
            }
        }

        // リスト描画
        this.listElement.innerHTML = '';
        this.selectedIndex = 0;
        this.filteredItems = results;

        if (results.length === 0) {
            const emptyElement = document.createElement('div');
            emptyElement.classList.add('command-palette-empty');
            emptyElement.textContent = '該当する項目がありません';
            this.listElement.appendChild(emptyElement);
            return;
        }

        for (let i = 0; i < results.length; ++i) {
            const result = results[i];
            const itemElement = document.createElement('div');
            itemElement.classList.add('command-palette-item');
            if (i === 0) {
                itemElement.classList.add('selected');
            }

            // テーブル名を表示する
            const nameElement = document.createElement('span');
            nameElement.classList.add('command-palette-item-name');
            nameElement.textContent = result.tableName;
            itemElement.appendChild(nameElement);

            // PK値を表示する
            const pkElement = document.createElement('span');
            pkElement.classList.add('command-palette-item-pk');
            pkElement.textContent = result.pkValue;
            itemElement.appendChild(pkElement);

            // マッチした列の値を右端に表示する
            const valueElement = document.createElement('span');
            valueElement.classList.add('command-palette-item-description');
            valueElement.textContent = result.matchValue;
            itemElement.appendChild(valueElement);

            const clickIndex = i;
            itemElement.addEventListener('mousedown', (e: MouseEvent) => {
                e.preventDefault();
                this.confirmSelection(clickIndex);
            });

            this.listElement.appendChild(itemElement);
        }
    }

    /**
     * 選択状態を更新する
     * selectedIndexに基づいてselectedクラスを付け替え、
     * 選択項目が見えるようにスクロールする
     */
    private updateSelection(visibleItems: NodeListOf<Element>): void {
        for (let i = 0; i < visibleItems.length; ++i) {
            visibleItems[i].classList.remove('selected');
        }
        visibleItems[this.selectedIndex].classList.add('selected');
        visibleItems[this.selectedIndex].scrollIntoView({block: 'nearest'});
    }
}
