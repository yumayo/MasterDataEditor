import {ValidationEngine, ValidationError} from "./validation-engine";
import {Tab} from "./tab";
import {StatusBar} from "./status-bar";

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
     * バリデーションを実行してパネル・ステータスバー・各EditorTableのエラークラスを更新する。
     * applyCellChanges / replayCellChanges 完了後に呼ばれる。
     */
    runAndUpdate(): void {
        const errors = this.engine.validate();
        this.currentErrors = errors;
        this.render();
        // エラーが1件以上ある場合はパネルを自動表示する。エラーが0件になったら自動で非表示にする。
        this.element.style.display = errors.length > 0 ? 'block' : 'none';
        this.statusBar.updateCount(errors.length);
        // 全EditorTableにエラー情報を適用してセルのDOMクラスを更新する
        this.applyErrorClassesToAllEditorTables(errors);
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
        if (this.currentErrors.length === 0) return;

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
