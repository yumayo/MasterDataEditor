import {ValidationEngine, ValidationError} from "./validation-engine";
import {Tab} from "./tab";
import {StatusBar} from "./status-bar";
import {InMemoryTableStore} from "./in-memory-table-store";
import type {PluginValidationRunner, PluginValidationError} from "./plugin-validation-runner";

/**
 * バリデーションエラーパネル
 *
 * BottomPanel の PROBLEMS タブのコンテンツとして表示される。
 * タイトルバー・ResizeHandle・閉じるボタンは BottomPanel が担当するため、
 * このクラスはエラーリストの表示と、バリデーション実行ロジックのみを担う。
 *
 * 循環参照（ValidationPanel ↔ StatusBar）は Object.assign パターンで解決する。
 * main.ts で `Object.create({...})` による no-op stub を先に作り、
 * `new ValidationPanel(engine, tab, statusBar)` でコンストラクタ完了時から全フィールドが有効になる。
 */
export class ValidationPanel {

    private readonly element: HTMLElement;
    private readonly engine: ValidationEngine;
    private readonly tab: Tab;
    private readonly statusBar: StatusBar;
    private readonly store: InMemoryTableStore;
    /** 現在のエラーリスト */
    private currentErrors: ValidationError[];
    /** プラグインバリデーションランナー */
    private readonly pluginRunner: PluginValidationRunner;
    /** プラグイン非同期リクエストの陳腐化防止用カウンタ */
    private pluginRequestId = 0;

    constructor(engine: ValidationEngine, tab: Tab, statusBar: StatusBar, store: InMemoryTableStore, pluginRunner: PluginValidationRunner) {
        this.engine = engine;
        this.tab = tab;
        this.statusBar = statusBar;
        this.store = store;
        this.pluginRunner = pluginRunner;
        this.currentErrors = [];

        const panel = document.createElement('div');
        panel.classList.add('validation-panel');
        panel.style.display = 'none';
        this.element = panel;

        // 初期表示を構築する（「エラーはありません」）
        this.render();
    }

    /**
     * パネルを親要素に追加する（BottomPanel から呼ばれる）
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    /**
     * 表示/非表示を切り替える（BottomPanel から呼ばれる）
     */
    setVisible(visible: boolean): void {
        this.element.style.display = visible ? '' : 'none';
    }

    /**
     * ValidationEngine にスキーマを登録する（Tab がテーブルを開いた後に呼ぶ）
     */
    registerSchema(tableName: string, primaryKeyColumns: readonly string[], columns: ReadonlyArray<{name: string; type: string; reference: string | null; defaultValue: string | null}>): void {
        this.engine.registerSchema(tableName, { primaryKeyColumns, columns });
    }

    /**
     * テーブルのスキーマ情報を登録解除する。
     * DiffTab.destroy() でスキーマ残留を防ぐために呼ばれる。
     */
    unregisterSchema(tableName: string): void {
        this.engine.unregisterSchema(tableName);
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
     * 指定テーブルのPK重複 + 型不一致エラーをストアから検出して返す。
     * DiffTab右ペインのように openEditorTables に登録されないが全バリデーションが必要な
     * ミニテーブルが独立してバリデーションを行うための公開パス。
     */
    validateForTable(tableName: string): ValidationError[] {
        return this.engine.validateForTable(tableName);
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
     *
     * プラグインバリデーションも毎回実行する（プラグイン結果は揮発性）。
     * 非同期競合は pluginRequestId で防止する。
     */
    runAndUpdate(): void {
        const result = this.engine.validate(this.currentErrors);
        const mergedErrors = [...result.errors, ...result.preservableErrors];
        // プラグインバリデーションは非同期で実行し、結果をマージする。
        // findFilesAsync/readFileAsync は preloadAllFilesAsync でキャッシュ済みのため実質同期的に返る。
        // requestId で非同期競合を防止する（新しいリクエストが来たら古い結果は破棄する）。
        const requestId = ++this.pluginRequestId;
        this.pluginRunner.runAllPluginsAsync().then((pluginErrors) => {
            if (requestId !== this.pluginRequestId) return; // 陳腐化した結果は破棄
            this.applyErrors([...mergedErrors, ...convertPluginErrors(pluginErrors, this.store, this.engine)]);
        }).catch((e: unknown) => {
            if (requestId !== this.pluginRequestId) return;
            // プラグイン実行失敗をプラグインエラーとして表面化する（フォールバック禁止）
            const failError: PluginValidationError[] = [{ pluginName: '(system)', message: 'プラグインバリデーション実行失敗: ' + String(e), tableName: null, rowIndex: -1, columnName: null }];
            this.applyErrors([...mergedErrors, ...convertPluginErrors(failError, this.store, this.engine)]);
        });
    }

    /**
     * エラーリストをパネル・ステータスバー・EditorTableに一括反映する共通処理
     */
    private applyErrors(errors: ValidationError[]): void {
        this.currentErrors = errors;
        this.render();
        this.statusBar.updateCount(errors.length);
        this.applyErrorClassesToAllEditorTables(errors);
    }

    // -------------------------------------------------------------------------
    // レンダリング
    // -------------------------------------------------------------------------

    private render(): void {
        while (this.element.firstChild) {
            this.element.removeChild(this.element.firstChild);
        }

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

                const kindSpan = document.createElement('span');
                kindSpan.classList.add('validation-panel-item-kind');
                if (error.kind === 'pk-duplicate') {
                    kindSpan.classList.add('validation-panel-item-kind-pk');
                    kindSpan.textContent = 'PK重複';
                } else if (error.kind === 'type-mismatch') {
                    kindSpan.classList.add('validation-panel-item-kind-type');
                    kindSpan.textContent = '型不一致';
                } else if (error.kind === 'plugin') {
                    kindSpan.classList.add('validation-panel-item-kind-plugin');
                    kindSpan.textContent = 'プラグイン';
                } else {
                    kindSpan.classList.add('validation-panel-item-kind-fk');
                    kindSpan.textContent = 'FK切れ';
                }

                const locationSpan = document.createElement('span');
                locationSpan.classList.add('validation-panel-item-location');
                // プラグインエラーでジャンプ先がある場合はテーブル名・行番号を表示する
                // ジャンプ先がない場合はファイル名のみ表示する
                // 通常エラーはテーブル名・行番号・列名を表示する
                if (error.kind === 'plugin' && error.rowIndex === -1) {
                    locationSpan.textContent = `${error.columnName}:`;
                } else if (error.kind === 'plugin') {
                    locationSpan.textContent = `${error.tableName} 行${error.rowIndex + 1}:`;
                } else {
                    locationSpan.textContent = `${tableName} 行${error.rowIndex + 1} ${error.columnName}:`;
                }

                const messageSpan = document.createElement('span');
                messageSpan.classList.add('validation-panel-item-message');
                messageSpan.textContent = error.message;

                item.appendChild(kindSpan);
                item.appendChild(locationSpan);
                item.appendChild(messageSpan);

                // ジャンプ先が特定できるエラーにのみクリックジャンプ機能を付与する
                const canJump = error.kind !== 'plugin' || error.rowIndex !== -1;
                if (canJump) {
                    item.setAttribute('role', 'button');
                    item.setAttribute('tabindex', '0');
                    item.addEventListener('click', () => { this.jumpToError(error); });
                    item.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.jumpToError(error); });
                }

                this.element.appendChild(item);
            }
        }
    }

    // -------------------------------------------------------------------------
    // エラークラスをEditorTableのDOMに適用する
    // -------------------------------------------------------------------------

    private applyErrorClassesToAllEditorTables(errors: ValidationError[]): void {
        const errorsByTable = new Map<string, ValidationError[]>();
        for (const error of errors) {
            if (errorsByTable.has(error.tableName)) {
                errorsByTable.get(error.tableName)!.push(error);
            } else {
                errorsByTable.set(error.tableName, [error]);
            }
        }
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
     */
    private jumpToError(error: ValidationError): void {
        const tableName = error.tableName;
        const tabStates = this.tab.getTabStates();
        const state = tabStates.get(tableName);
        if (state) {
            this.tab.switchToExistingTab(tableName);
            const domRow = state.editorTable.storeRowToDomRow(error.rowIndex);
            if (domRow === null) return;
            const domCol = error.columnIndex + 1;
            state.selection.setRange(domRow, domCol, domRow, domCol);
            state.selection.move(domRow, domCol);
            state.editorTableHandler.activate();
        } else {
            if (error.pkValue === null) return;
            this.tab.navigateToTableCell(tableName, error.pkValue, error.columnIndex);
        }
    }
}

/**
 * PluginValidationError を ValidationError に変換する。
 * assertに行オブジェクト・列名が渡されている場合はジャンプ先として利用する。
 * ジャンプ先が指定されていないエラーは tableName="プラグイン"、rowIndex=-1 でセル特定不能を表現する。
 */
function convertPluginErrors(pluginErrors: PluginValidationError[], store: InMemoryTableStore, engine: ValidationEngine): ValidationError[] {
    const result: ValidationError[] = [];
    for (const pe of pluginErrors) {
        // ジャンプ先コンテキストがある場合はテーブル名・行・列を解決する
        if (pe.tableName !== null && pe.rowIndex !== -1) {
            const header = store.getHeader(pe.tableName);
            const columnIndex = (header !== false && pe.columnName !== null) ? header.indexOf(pe.columnName) : -1;
            result.push({
                tableName: pe.tableName,
                rowIndex: pe.rowIndex,
                columnIndex,
                columnName: pe.columnName !== null ? pe.columnName : '',
                value: '',
                kind: 'plugin',
                message: '[' + pe.pluginName + '] ' + pe.message,
                filterValue: null,
                pkValue: engine.resolvePkValue(pe.tableName, pe.rowIndex),
            });
        } else {
            result.push({
                tableName: 'プラグイン',
                rowIndex: -1,
                columnIndex: -1,
                columnName: pe.pluginName,
                value: '',
                kind: 'plugin',
                message: pe.message,
                filterValue: null,
                pkValue: null,
            });
        }
    }
    return result;
}
