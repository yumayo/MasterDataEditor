import {ReferenceDataCache} from "./reference-data-cache";
import {readFileAsync} from "./api";
import {Tab} from "./tab";
import {InMemoryTableStore} from "./in-memory-table-store";
import {EditorTable} from "./editor-table";
import {FillController} from "./fill-controller";
import {AreaResizer} from "./area-resizer";
import {History} from "./history";

/**
 * ドロップダウンのクイックビューパネルを管理するクラス。
 *
 * FK列のドロップダウンアイテムにホバーすると即座に参照先テーブルの
 * 関連データをミニEditorTableで表示する。
 * クイックビュー自体にマウスオーバーしている間は表示が維持される。
 *
 * DOM配置: document.body 直下に固定配置し、position:fixed でビューポート座標を使用する。
 * これにより .grid-dropdown の StackingContext に影響されず最前面に表示できる。
 *
 * シングルトン設計: Tab が1つだけ生成し、全 GridDropdownInput が共有する。
 * これにより body 直下に .dropdown-quick-view が1つしか存在しないことを保証する。
 *
 * Tab・InMemoryTableStore は connectTab() で Tab コンストラクタから接続する。
 * showPreview が呼ばれる時点では必ず接続済みであることが保証される。
 * dropdownListElement は各呼び出し時に引数として受け取り、シングルトンで正しい位置決めを実現する。
 */
export class DropdownQuickView {
    /** クイックビューのルート要素（document.body 直下に配置） */
    private readonly element: HTMLDivElement;
    /** ドロップダウンリスト要素（位置決め基準）。呼び出し元の GridDropdownInput ごとに更新される */
    private dropdownListElement: HTMLElement;
    /** hidePreviewWithDelay のディレイタイマーID（0 = タイマーなし） */
    private hideDelayTimerId: number = 0;
    /** クイックビュー自体にマウスがホバー中かどうか */
    private hovered: boolean = false;
    /** レースコンディション防止用リクエストID */
    private currentPreviewRequestId: number = 0;
    /** 参照データキャッシュへの参照 */
    private readonly referenceDataCache: ReferenceDataCache;
    /**
     * ミニEditorTable生成に使用するTab。
     * connectTab() で設定される。false の場合は connectTab() 未呼び出しを意味し、renderContentAsync() でエラーを投げる。
     */
    private tab: Tab | false;
    /**
     * テーブルデータの中央ストア。
     * connectTab() で設定される。false の場合は connectTab() 未呼び出しを意味する。
     */
    private store: InMemoryTableStore | false;
    /** 現在表示中のミニEditorTableインスタンス（未表示時はfalse） */
    private currentMiniEditorTable: EditorTable | false;
    /** 現在表示中のミニEditorTableのFillController（未表示時はfalse） */
    private currentMiniFillController: FillController | false;
    /** 現在表示中のミニEditorTableのAreaResizer（未表示時はfalse） */
    private currentMiniAreaResizer: AreaResizer | false;
    /** 現在表示中のミニEditorTableのHistory（未表示時はfalse） */
    private currentMiniHistory: History | false;
    /** 現在表示中のミニEditorTableのテーブル名（未表示時はfalse） */
    private currentMiniTableName: string | false;

    constructor(referenceDataCache: ReferenceDataCache) {
        // dropdownListElement は showPreview 呼び出し時に更新される。
        // シングルトンとして複数の GridDropdownInput から共有されるため、
        // コンストラクタでは空の div で初期化し、実際の呼び出し前に必ず上書きされることを保証する。
        this.dropdownListElement = document.createElement('div');
        this.referenceDataCache = referenceDataCache;
        this.tab = false;
        this.store = false;
        this.currentMiniEditorTable = false;
        this.currentMiniFillController = false;
        this.currentMiniAreaResizer = false;
        this.currentMiniHistory = false;
        this.currentMiniTableName = false;

        // クイックビューのDOM要素を構築して document.body 直下に追加する。
        // .grid-dropdown の StackingContext に影響されず最前面に表示するため body 直下に配置する。
        this.element = document.createElement('div');
        this.element.classList.add('dropdown-quick-view');
        document.body.appendChild(this.element);

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
     * Tab と InMemoryTableStore を接続する（Tab コンストラクタから呼ばれる）。
     * ミニEditorTable生成能力を付与するために必要。
     * シングルトンとして生成後に一度だけ呼ばれる。
     */
    connectTab(tab: Tab, store: InMemoryTableStore): void {
        if (this.tab !== false) {
            throw new Error('[DropdownQuickView] connectTab() は複数回呼べません');
        }
        this.tab = tab;
        this.store = store;
    }

    /**
     * プレビューを表示する（マウスホバー・キーボード選択どちらからも呼ぶ）。
     * listElement: 現在表示中のドロップダウンリスト要素（クイックビューの位置決め基準）。
     * シングルトンとして複数の GridDropdownInput から共有されるため、呼び出しごとに更新する。
     *
     * アイテムAからBに素早く移動した場合、mouseleave(A)が設定した hideTimer が残存し
     * hidePreview() が requestId を上書きしてBのfetch結果を破棄するバグを防ぐため、
     * 冒頭で cancelHideTimer() を呼んでタイマーを確実にキャンセルする。
     */
    showPreview(tableName: string, itemId: string, anchorElement: HTMLElement, listElement: HTMLElement): void {
        this.cancelHideTimer();
        this.dropdownListElement = listElement;
        const requestId = ++this.currentPreviewRequestId;
        this.fetchAndRenderAsync(tableName, itemId, requestId, anchorElement)
            .catch((e: unknown) => { console.warn('[DropdownQuickView] fetchAndRenderAsync failed', e); });
    }

    /**
     * プレビューを即時非表示にする。
     * hidePreviewWithDelayのタイマーが残存している場合も確実にキャンセルする。
     */
    hidePreview(): void {
        this.cancelHideTimer();
        // 進行中の非同期処理（fetchAndRenderAsync / renderContentAsync）を確実にキャンセルする
        ++this.currentPreviewRequestId;
        this.element.classList.remove('visible');
        this.destroyCurrentMiniEditorTable();
    }

    /**
     * ドロップダウンアイテムの mouseleave 時に呼ぶ（短いディレイ付き非表示）。
     * ディレイ中にクイックビュー自体にマウスが入った場合、非表示をキャンセルする。
     */
    hidePreviewWithDelay(): void {
        this.cancelHideTimer();
        this.hideDelayTimerId = window.setTimeout(() => {
            this.hideDelayTimerId = 0;
            // クイックビューにホバー中なら何もしない
            if (this.hovered) return;
            this.hidePreview();
        }, 50);
    }

    /**
     * クリーンアップ（ドロップダウンhide時）。
     */
    cleanup(): void {
        this.cancelHideTimer();
        // 進行中の非同期処理（fetchAndRenderAsync / renderContentAsync）を確実にキャンセルする
        ++this.currentPreviewRequestId;
        this.hovered = false;
        this.element.classList.remove('visible');
        this.destroyCurrentMiniEditorTable();
    }

    /**
     * 参照テーブルからプレビューデータを非同期で取得してミニEditorTableをレンダリングする。
     */
    private async fetchAndRenderAsync(tableName: string, itemId: string, requestId: number, anchorElement: HTMLElement): Promise<void> {
        const fullData = await this.referenceDataCache.getFullDataAsync(tableName);

        // レースコンディション防止: 非同期待機中に別のリクエストが発行された場合は破棄する
        if (requestId !== this.currentPreviewRequestId) return;

        // 対象行をIDで検索する
        const row = fullData.rows.get(itemId);
        if (!row) {
            console.warn('[DropdownQuickView] プレビュー対象行が見つかりません', { tableName, itemId });
            return;
        }

        await this.renderContentAsync(tableName, fullData.header, row, requestId);

        // 非同期待機中に別のリクエストが発行された場合は表示しない
        if (requestId !== this.currentPreviewRequestId) {
            this.destroyCurrentMiniEditorTable();
            return;
        }

        this.element.classList.add('visible');
        this.positionElement(anchorElement);
    }

    /**
     * クイックビューのコンテンツをミニEditorTableでレンダリングする。
     * 既存のミニEditorTableを破棄してから新しいものを生成する。
     *
     * DOM構築は非同期I/O完了後に行う。早期リターン時にDOM残留が発生しないようにするため。
     */
    private async renderContentAsync(tableName: string, header: string[], row: string[], requestId: number): Promise<void> {
        if (this.tab === false || this.store === false) {
            throw new Error('[DropdownQuickView] connectTab() が呼ばれていない状態で renderContentAsync が呼ばれた');
        }
        // 既存のミニEditorTableを破棄する
        this.destroyCurrentMiniEditorTable();

        // スキーマをファイルから読み込む（DOM構築前にI/Oを完了させる）
        const schemaText = await readFileAsync(`schema/${tableName}.json`);

        // 非同期待機中に別のリクエストが発行された場合はここで中断する（DOM残留なし）
        if (requestId !== this.currentPreviewRequestId) return;

        const schemaJson: Record<string, unknown> = JSON.parse(schemaText);
        await this.store.registerTableAsync(tableName);

        // 非同期待機中に別のリクエストが発行された場合はストア登録を戻して中断する（DOM残留なし）
        if (requestId !== this.currentPreviewRequestId) {
            this.store.unregisterTable(tableName);
            return;
        }

        // すべての非同期処理が完了してからDOMを構築・挿入する
        this.element.innerHTML = '';

        // RelationsPanel と同じ構造でコンテンツを構築する
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
        rowCount.textContent = '1 row';
        tableHeader.appendChild(rowCount);

        tableSection.appendChild(tableHeader);

        // ミニEditorTableのラッパー構造（RelationsPanel と同じ構造）
        // wrapper: ドロップダウン配置先（overflow:visible）
        // scrollContainer: スクロール担当（overflow:auto）
        // innerWrapper: EditorTable・テキストフィールドの配置先（通常フロー）
        const wrapper = document.createElement('div');
        wrapper.classList.add('relations-mini-table-wrapper');
        tableSection.appendChild(wrapper);

        const scrollContainer = document.createElement('div');
        scrollContainer.classList.add('relations-mini-table-scroll');
        wrapper.appendChild(scrollContainer);

        const innerWrapper = document.createElement('div');
        scrollContainer.appendChild(innerWrapper);

        contentDiv.appendChild(tableSection);
        this.element.appendChild(contentDiv);

        // クイックビューは1行だけ表示する。バッファ行1行を加えて emptyRowCount=2 とする。
        // connectQuickView: false を渡してQV内ミニテーブルのFK列ホバーによる自己破棄ループを防ぐ。
        const {editorTable, fillController, areaResizer, history} = this.tab.createMiniEditorTable(
            scrollContainer, innerWrapper, wrapper, tableName, schemaJson, header, [row], 2, false
        );

        // QV内ミニテーブルはReadOnly表示専用のため非アクティブ状態に設定する。
        // deactivate() はイベントリスナーの解除のみ行うため、視覚状態の付与には
        // setInactiveAppearance(true) を別途呼ぶ必要がある。
        editorTable.deactivate();
        editorTable.setInactiveAppearance(true);

        // 現在表示中のミニEditorTableとして記録する（破棄時に使用）
        this.currentMiniEditorTable = editorTable;
        this.currentMiniFillController = fillController;
        this.currentMiniAreaResizer = areaResizer;
        this.currentMiniHistory = history;
        this.currentMiniTableName = tableName;
    }

    /**
     * クイックビューの表示位置を決定する（position:fixed のビューポート座標を使用）。
     * デフォルトはドロップダウンリストの右側。
     * ビューポートの右端にはみ出す場合は左側に配置する。
     */
    private positionElement(anchorElement: HTMLElement): void {
        // position:fixed なのでビューポート座標（getBoundingClientRect の結果）をそのまま使う
        const listRect = this.dropdownListElement.getBoundingClientRect();
        const anchorRect = anchorElement.getBoundingClientRect();

        // 前回呼び出し時の制約スタイルをリセットする（シングルトンのため残存する）
        this.element.style.maxWidth = '';
        this.element.style.maxHeight = '';

        // まずドロップダウンリストの右側に配置を試みる
        this.element.style.left = listRect.right + 'px';
        this.element.style.top = anchorRect.top + 'px';

        // ビューポートの右端をはみ出す場合はドロップダウンリストの左側に配置する。
        // 左側にも十分なスペースがない場合の挙動は listRect.left の大きさで分岐する:
        //   - CSS の min-width（200px）未満: 左側に配置しても QV がほぼ表示できないため、
        //     右側に留まったまま maxWidth でビューポート内に収める（左フォールバックを諦める）。
        //   - min-width 以上: QV の幅を listRect.left に制約して左端 0 から配置する。
        //     これにより QV の right === listRect.left となりドロップダウンと水平方向で重ならない。
        const minWidthThreshold = 200;
        const quickViewRect = this.element.getBoundingClientRect();
        if (quickViewRect.right > window.innerWidth) {
            const leftAligned = listRect.left - this.element.offsetWidth;
            if (listRect.left < minWidthThreshold) {
                // 左側スペースが小さすぎて左フォールバックが無意味な場合は、
                // 右側配置のまま maxWidth でビューポート右端に収める。
                this.element.style.maxWidth = Math.max(0, window.innerWidth - listRect.right) + 'px';
            } else if (leftAligned < 0) {
                // 左側スペースが min-width 以上あるが QV 幅に足りない場合、
                // QV の幅を listRect.left に制約して左端 0 から配置する。
                this.element.style.maxWidth = listRect.left + 'px';
                this.element.style.left = '0px';
            } else {
                this.element.style.left = leftAligned + 'px';
            }
        }

        // ビューポートの下端をはみ出す場合は上方向にずらして収める。
        // ただしドロップダウンリストの top より上には行かない制約を設ける。
        // この制約により「クイックビューがドロップダウンリスト領域に重なって操作不能」を防ぐ。
        const updatedRect = this.element.getBoundingClientRect();
        if (updatedRect.bottom > window.innerHeight) {
            const adjustedTop = anchorRect.top - (updatedRect.bottom - window.innerHeight);
            // listRect.top を下限とすることでドロップダウンリストに被らない位置まで上方向補正を制限する。
            // ビューポート上端（0）も下限として保護する（listRect.top が負になるケースに備える）。
            const clampedTop = Math.max(0, Math.max(listRect.top, adjustedTop));
            this.element.style.top = clampedTop + 'px';
            // top を listRect.top に制約した結果、クイックビューが下端からはみ出す可能性があるため
            // max-height を動的に設定してビューポート内に収まるようにする
            const availableHeight = Math.max(0, window.innerHeight - clampedTop);
            this.element.style.maxHeight = availableHeight + 'px';
        }
    }

    /**
     * 現在表示中のミニEditorTableを破棄する。
     * FillController・AreaResizer を deactivate し、History を unregister し、
     * ストアの参照カウントを戻す。
     */
    private destroyCurrentMiniEditorTable(): void {
        if (this.currentMiniEditorTable === false) return;
        this.currentMiniEditorTable.deactivate();
        if (this.currentMiniFillController !== false) {
            this.currentMiniFillController.deactivate();
            this.currentMiniFillController = false;
        }
        if (this.currentMiniAreaResizer !== false) {
            this.currentMiniAreaResizer.deactivate();
            this.currentMiniAreaResizer = false;
        }
        if (this.currentMiniHistory !== false) {
            this.currentMiniHistory.unregister();
            this.currentMiniHistory = false;
        }
        if (this.currentMiniTableName !== false && this.store !== false) {
            this.store.unregisterTable(this.currentMiniTableName);
            this.currentMiniTableName = false;
        }
        this.currentMiniEditorTable = false;
        // DOMに残留したミニEditorTableの要素を削除する
        this.element.innerHTML = '';
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
