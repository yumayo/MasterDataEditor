import {ValidationEngine, ValidationError} from "./validation-engine";
import {Tab} from "./tab";
import {StatusBar} from "./status-bar";
import {ResizeHandle} from "./resize-handle";

/**
 * バリデーションエラーパネル
 *
 * 画面下段に表示され、全テーブルのバリデーションエラーを一覧表示する。
 * テーブル名ヘッダー + エラー項目のグループ構造で表示する。
 * エラー項目クリックで該当テーブルタブに切り替え、対象セルにフォーカスジャンプする。
 *
 * バリデーション実行の責務も担う（ValidationEngine を保持する）。
 * runAndUpdate() を呼ぶと全テーブルのバリデーションを実行し、
 * UI更新 + 各EditorTableへのエラークラス付与を行う。
 *
 * 循環参照（ValidationPanel ↔ StatusBar）は Object.assign パターンで解決する。
 * main.ts で `const statusBar = {} as StatusBar` を先に作り、
 * `new ValidationPanel(engine, tab, statusBar)` でコンストラクタ完了時から全フィールドが有効になる。
 */
export class ValidationPanel {

    private readonly element: HTMLElement;
    private readonly engine: ValidationEngine;
    private readonly tab: Tab;
    private readonly statusBar: StatusBar;
    /** 縦方向リサイズハンドル。render() でコンテンツをクリアした後に再 prependTo する */
    private readonly resizeHandle: ResizeHandle;
    /** 現在のエラーリスト */
    private currentErrors: ValidationError[];

    constructor(engine: ValidationEngine, tab: Tab, statusBar: StatusBar) {
        this.engine = engine;
        this.tab = tab;
        this.statusBar = statusBar;
        this.currentErrors = [];

        const panel = document.createElement('div');
        panel.classList.add('validation-panel');
        // 初期状態は非表示（ステータスバーのバッジクリックで表示する）
        panel.style.display = 'none';
        this.element = panel;

        // 縦方向リサイズハンドル: 上端に配置し、上方向へドラッグすることで高さを増やす
        // delta が正（下移動）= 高さ縮小、負（上移動）= 高さ増加 なので -delta を加算する
        this.resizeHandle = new ResizeHandle('vertical', (delta: number): number => {
            const currentHeight = this.element.getBoundingClientRect().height;
            const newHeight = Math.max(80, currentHeight - delta);
            this.element.style.height = `${newHeight}px`;
            // 上方向ドラッグ(delta負)で高さ増加のため、消費delta = currentHeight - newHeight（delta反転後の変化量）
            return currentHeight - newHeight;
        });

        // 初期表示を構築する（PROBLEMSヘッダー + 「エラーはありません」）
        this.render();
    }

    /**
     * パネルを親要素に追加する（Editor から呼ばれる）
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    /**
     * ValidationEngine にスキーマを登録する（Tab がテーブルを開いた後に呼ぶ）
     */
    registerSchema(tableName: string, primaryKeyColumns: readonly string[], columns: ReadonlyArray<{name: string; reference: string | null}>): void {
        this.engine.registerSchema(tableName, { primaryKeyColumns, columns });
    }

    /**
     * 指定テーブルのPK重複エラーのみをストア全体から検出して返す。
     * ミニテーブル用の独立したバリデーションパス（ValidationPanel 未接続の EditorTable から呼ばれる）。
     * スキーマ未登録の場合は空配列を返す。
     */
    validatePkDuplicatesForTable(tableName: string): ValidationError[] {
        return this.engine.validatePkDuplicatesForTable(tableName);
    }

    /**
     * 指定テーブルに関する現在のエラーリストを返す。
     * reloadCellsFromStore() でDOMを再構築した後に既存エラークラスを再適用するために使う。
     * バリデーションを再実行しないため、参照先テーブルが閉じられていてもエラーが消えない。
     */
    getErrorsForTable(tableName: string): ValidationError[] {
        return this.currentErrors.filter(e => e.tableName === tableName);
    }

    /**
     * バリデーションを実行してパネル・ステータスバー・各EditorTableのエラークラスを更新する。
     * applyCellChanges / replayCellChanges 完了後に呼ばれる。
     *
     * 参照先テーブルが未ロードのためFKチェックがスキップされた列については、
     * 現在のストア値がエラー発生時の値と同じ場合のみエラーを引き継ぐ。
     * 値が変わっていればエラーは引き継がず消える（テストケース6の修正）。
     */
    runAndUpdate(): void {
        // 現在のエラーリストを渡してエンジン側でスキップ行の値変化を検知させる
        const result = this.engine.validate(this.currentErrors);
        // preservableErrors: 参照先テーブルが未ロードだが現在のストア値が変わっていないエラーのみ引き継ぐ
        const mergedErrors = [...result.errors, ...result.preservableErrors];
        this.currentErrors = mergedErrors;
        this.render();
        this.statusBar.updateCount(mergedErrors.length);
        // 全EditorTableにエラー情報を適用してセルのDOMクラスを更新する
        this.applyErrorClassesToAllEditorTables(mergedErrors);
    }

    /** パネルの表示/非表示をトグルする（ステータスバーのバッジクリックから呼ばれる） */
    toggleVisibility(): void {
        if (this.element.style.display === 'none') {
            this.element.style.display = 'block';
        } else {
            this.element.style.display = 'none';
        }
    }

    // -------------------------------------------------------------------------
    // レンダリング
    // -------------------------------------------------------------------------

    private render(): void {
        // 既存の内容をクリアする
        while (this.element.firstChild) {
            this.element.removeChild(this.element.firstChild);
        }
        // クリア後にリサイズハンドルを先頭に戻す（render のたびに削除されるため）
        this.resizeHandle.prependTo(this.element);

        // PROBLEMSタイトルバー
        const header = document.createElement('div');
        header.classList.add('validation-panel-header');
        const title = document.createElement('span');
        title.textContent = 'PROBLEMS';
        header.appendChild(title);
        // 閉じるボタン（×）
        const closeBtn = document.createElement('div');
        closeBtn.classList.add('validation-panel-close');
        closeBtn.setAttribute('role', 'button');
        closeBtn.setAttribute('tabindex', '0');
        closeBtn.setAttribute('aria-label', 'PROBLEMSパネルを閉じる');
        closeBtn.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 8.707l3.646 3.647.708-.708L8.707 8l3.647-3.646-.708-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708z"/></svg>`;
        closeBtn.addEventListener('click', () => { this.element.style.display = 'none'; });
        header.appendChild(closeBtn);
        this.element.appendChild(header);

        // エラーがなければ「エラーはありません」を表示して終了
        if (this.currentErrors.length === 0) {
            const empty = document.createElement('div');
            empty.classList.add('validation-panel-empty');
            empty.textContent = 'エラーはありません';
            this.element.appendChild(empty);
            return;
        }

        // テーブル名でグループ化する
        const groups = new Map<string, ValidationError[]>();
        for (const error of this.currentErrors) {
            if (groups.has(error.tableName)) {
                groups.get(error.tableName)!.push(error);
            } else {
                groups.set(error.tableName, [error]);
            }
        }

        for (const [tableName, tableErrors] of groups) {
            // グループヘッダー
            const groupHeader = document.createElement('div');
            groupHeader.classList.add('validation-panel-group-header');
            const nameSpan = document.createElement('span');
            nameSpan.classList.add('validation-panel-group-name');
            nameSpan.textContent = tableName;
            const countSpan = document.createElement('span');
            countSpan.classList.add('validation-panel-group-count');
            countSpan.textContent = `(${tableErrors.length} 件)`;
            groupHeader.appendChild(nameSpan);
            groupHeader.appendChild(countSpan);
            this.element.appendChild(groupHeader);

            // エラー項目
            for (const error of tableErrors) {
                const item = document.createElement('div');
                item.classList.add('validation-panel-item');
                item.setAttribute('role', 'button');
                item.setAttribute('tabindex', '0');

                // エラー種別バッジ
                const kindSpan = document.createElement('span');
                kindSpan.classList.add('validation-panel-item-kind');
                if (error.kind === 'pk-duplicate') {
                    kindSpan.classList.add('validation-panel-item-kind-pk');
                    kindSpan.textContent = 'PK重複';
                } else {
                    kindSpan.classList.add('validation-panel-item-kind-fk');
                    kindSpan.textContent = 'FK切れ';
                }

                // 位置情報（行番号・列名）
                const locationSpan = document.createElement('span');
                locationSpan.classList.add('validation-panel-item-location');
                locationSpan.textContent = `${tableName} 行${error.rowIndex + 1} ${error.columnName}:`;

                // エラーメッセージ
                const messageSpan = document.createElement('span');
                messageSpan.classList.add('validation-panel-item-message');
                messageSpan.textContent = error.message;

                item.appendChild(kindSpan);
                item.appendChild(locationSpan);
                item.appendChild(messageSpan);

                // クリックとEnterキーで該当セルにジャンプする
                item.addEventListener('click', () => { this.jumpToError(error); });
                item.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.jumpToError(error); });

                this.element.appendChild(item);
            }
        }
    }

    // -------------------------------------------------------------------------
    // エラークラスをEditorTableのDOMに適用する
    // -------------------------------------------------------------------------

    private applyErrorClassesToAllEditorTables(errors: ValidationError[]): void {
        // テーブル名ごとにエラーをグループ化する
        const errorsByTable = new Map<string, ValidationError[]>();
        for (const error of errors) {
            if (errorsByTable.has(error.tableName)) {
                errorsByTable.get(error.tableName)!.push(error);
            } else {
                errorsByTable.set(error.tableName, [error]);
            }
        }
        // 全EditorTableに直接エラー情報を適用する（密結合: ValidationPanel → Tab → EditorTable）
        for (const [tableName, editorTable] of this.tab.getOpenEditorTables()) {
            const tableErrors = errorsByTable.has(tableName) ? errorsByTable.get(tableName)! : [];
            editorTable.applyValidationErrors(tableErrors);
        }
    }

    // -------------------------------------------------------------------------
    // セルジャンプ
    // -------------------------------------------------------------------------

    /**
     * エラー項目クリック時に該当テーブルタブを開き、対象セルにフォーカスする。
     * 行インデックス・列インデックスはストア基準なので、EditorTable.storeRowToDomRow() で
     * DOM上の行番号に変換する。ソート適用中でも正しい行を特定できる。
     * フィルターで非表示の行（storeRowToDomRow が null）はジャンプをスキップする。
     */
    private jumpToError(error: ValidationError): void {
        const tableName = error.tableName;

        // タブが既に開かれている場合はアクティブにする
        this.tab.switchToExistingTab(tableName);

        const tabStates = this.tab.getTabStates();
        const state = tabStates.get(tableName);
        if (!state) return;

        // ストア行インデックス → DOM行インデックスに変換する（ソート中も正しく逆引きできる）
        const domRow = state.editorTable.storeRowToDomRow(error.rowIndex);
        // フィルターで非表示の行はジャンプ対象外
        if (domRow === null) return;
        // DOM上の列: 行ヘッダーがcol=0なのでcolumnIndex + 1がデータ列
        const domCol = error.columnIndex + 1;
        state.selection.setRange(domRow, domCol, domRow, domCol);
        state.selection.move(domRow, domCol);
    }
}
