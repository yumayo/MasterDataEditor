import {formatValidationPrimaryKeyValues, ValidationEngine, ValidationError} from "../validation/validation-engine";
import {Tab} from "../tabs/tab";
import {StatusBar} from "../ui/status-bar";
import {InMemoryTableStore} from "../data/in-memory-table-store";
import {DebugConsole, type DebugConsoleEntryDetail} from "./debug-console";
import {resolvePluginErrors} from "../validation/plugin-validation-runner";
import type {PluginValidationRunner, PluginValidationError} from "../validation/plugin-validation-runner";
import {DynamicReferenceSchema} from "../references/reference-expression";
import {isGlobalValidationTargetTable} from "../validation/validation-table-scope";

type ValidationTableDebugSnapshot = Record<string, { header: string[]; rowCount: number; rowsPreview: string[][] }>;

const DEBUG_ROW_PREVIEW_LIMIT = 5;

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
    private readonly debugConsole: DebugConsole;
    /** 現在のエラーリスト */
    private currentErrors: ValidationError[];
    /** プラグインバリデーションランナー */
    private readonly pluginRunner: PluginValidationRunner;
    /** プラグイン非同期リクエストの陳腐化防止用カウンタ */
    private pluginRequestId = 0;
    /** グループ折り畳み状態（テーブル名 → 折り畳まれているか） */
    private readonly collapsedGroups = new Set<string>();
    /** 現在選択中のエラー項目を再描画後も復元するためのキー */
    private selectedErrorKey: string | null;

    constructor(engine: ValidationEngine, tab: Tab, statusBar: StatusBar, store: InMemoryTableStore, debugConsole: DebugConsole, pluginRunner: PluginValidationRunner) {
        this.engine = engine;
        this.tab = tab;
        this.statusBar = statusBar;
        this.store = store;
        this.debugConsole = debugConsole;
        this.pluginRunner = pluginRunner;
        this.currentErrors = [];
        this.selectedErrorKey = null;

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
    registerSchema(tableName: string, primaryKeyColumns: readonly string[], columns: ReadonlyArray<{name: string; type: string; reference: string | DynamicReferenceSchema | null; defaultValue: string | null}>): void {
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
     * 指定テーブル・行・列に対応するエラーリストを返す。
     * エラーツールチップがセル位置からエラーメッセージを照合するために使う。
     * 同一セルに複数エラー（PK重複 + 型不一致など）がある場合は全件返す。
     */
    getErrorsForCell(tableName: string, rowIndex: number, columnIndex: number): ValidationError[] {
        return this.currentErrors.filter(e => e.tableName === tableName && e.rowIndex === rowIndex && e.columnIndex === columnIndex);
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
        void this.runAndUpdateAsync();
    }

    /**
     * バリデーションを実行して結果を返す。
     * FormPanel のように判定結果をその場で表示したいUIから await して使う。
     */
    runAndUpdateAsync(): Promise<ValidationError[]> {
        // バリデーション全体をマクロタスクに遅延させてUIブロックを回避する。
        // セル編集のレンダリングが先に完了した後にバリデーションが走る。
        // requestId で連続呼び出し時の陳腐化を防止する（最新のリクエストのみ実行される）。
        const requestId = ++this.pluginRequestId;
        return new Promise((resolve) => {
            setTimeout(() => {
                if (requestId !== this.pluginRequestId) {
                    resolve(this.currentErrors);
                    return;
                }
                const engineStart = performance.now();
                const engineDebugRequestId = `engine-${requestId}`;
                const engineRequest = this.createEngineValidationRequest(engineDebugRequestId);
                const result = this.engine.validate(this.currentErrors);
                const mergedErrors = [...result.errors, ...result.preservableErrors];
                const engineDurationUs = Math.round((performance.now() - engineStart) * 1000);
                this.debugConsole.appendEntry(
                    'validate (engine)',
                    engineDurationUs,
                    'success',
                    'validation-panel.ts',
                    this.createValidationDebugDetail(
                        'validate (engine)',
                        engineDebugRequestId,
                        engineRequest,
                        {
                            type: 'validate_engine_response',
                            requestId: engineDebugRequestId,
                            success: true,
                            data: result,
                        },
                        'success',
                        engineDurationUs,
                    ),
                );
                // プラグインバリデーションは Web Worker で非同期実行する
                const pluginStart = performance.now();
                const pluginDebugRequestId = `plugin-${requestId}`;
                this.pluginRunner.runAllPluginsWithDebugAsync(pluginDebugRequestId).then((pluginResult) => {
                    if (requestId !== this.pluginRequestId) {
                        resolve(this.currentErrors);
                        return;
                    }
                    const pluginDurationUs = Math.round((performance.now() - pluginStart) * 1000);
                    this.debugConsole.appendEntry(
                        'validate (plugin)',
                        pluginDurationUs,
                        'success',
                        'validation-panel.ts',
                        this.createValidationDebugDetail('validate (plugin)', pluginDebugRequestId, pluginResult.debug.request, pluginResult.debug.response, 'success', pluginDurationUs),
                    );
                    const errors = [...mergedErrors, ...convertPluginErrors(pluginResult.errors, this.store, this.engine)];
                    this.applyErrors(errors);
                    resolve(errors);
                }).catch((e: unknown) => {
                    if (requestId !== this.pluginRequestId) {
                        resolve(this.currentErrors);
                        return;
                    }
                    const pluginDurationUs = Math.round((performance.now() - pluginStart) * 1000);
                    const errorMessage = e instanceof Error ? e.message : String(e);
                    this.debugConsole.appendEntry(
                        'validate (plugin)',
                        pluginDurationUs,
                        'error',
                        'validation-panel.ts',
                        this.createValidationDebugDetail(
                            'validate (plugin)',
                            pluginDebugRequestId,
                            { type: 'validate_plugin_request', requestId: pluginDebugRequestId, directory: 'plugins' },
                            { type: 'validate_plugin_response', requestId: pluginDebugRequestId, success: false, error: errorMessage },
                            'error',
                            pluginDurationUs,
                            errorMessage,
                        ),
                    );
                    const failError: PluginValidationError[] = [{ pluginName: '(system)', message: 'プラグインバリデーション実行失敗: ' + String(e), tableName: null, rowIndex: -1, columnName: null }];
                    const errors = [...mergedErrors, ...convertPluginErrors(failError, this.store, this.engine)];
                    this.applyErrors(errors);
                    resolve(errors);
                });
            }, 0);
        });
    }

    private createEngineValidationRequest(requestId: string): unknown {
        return {
            type: 'validate_engine_request',
            requestId,
            previousErrors: this.currentErrors,
            tableData: this.createStoreDebugSnapshot(),
        };
    }

    private createStoreDebugSnapshot(): ValidationTableDebugSnapshot {
        const snapshot: ValidationTableDebugSnapshot = {};
        for (const tableName of this.store.getTableNames()) {
            if (!isGlobalValidationTargetTable(tableName)) continue;
            const header = this.store.getHeader(tableName);
            const rows = this.store.getRows(tableName);
            if (header === false || rows === false) continue;
            snapshot[tableName] = {
                header,
                rowCount: rows.length,
                rowsPreview: rows.slice(0, DEBUG_ROW_PREVIEW_LIMIT),
            };
        }
        return snapshot;
    }

    private createValidationDebugDetail(
        apiName: string,
        requestId: string,
        request: unknown,
        response: unknown,
        status: 'success' | 'error',
        durationUs: number,
        error?: string,
    ): DebugConsoleEntryDetail {
        return {
            apiName,
            requestId,
            request,
            response,
            status,
            caller: 'validation-panel.ts',
            durationUs,
            error,
            startedAt: new Date(Date.now() - durationUs / 1000).toISOString(),
            completedAt: new Date().toISOString(),
        };
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
            const collapsed = this.collapsedGroups.has(tableName);
            groupHeader.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

            const chevron = document.createElement('span');
            chevron.classList.add('validation-panel-group-chevron');
            chevron.innerHTML = `<svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M5.7 13.7L5 13l4.6-4.6L5 3.7l.7-.7 5.3 5.4z"/></svg>`;

            const nameSpan = document.createElement('span');
            nameSpan.classList.add('validation-panel-group-name');
            nameSpan.textContent = tableName;
            const countSpan = document.createElement('span');
            countSpan.classList.add('validation-panel-group-count');
            countSpan.textContent = `(${tableErrors.length} 件)`;
            groupHeader.appendChild(chevron);
            groupHeader.appendChild(nameSpan);
            groupHeader.appendChild(countSpan);
            this.element.appendChild(groupHeader);

            // エラー項目コンテナ（折り畳み対象）
            const itemsContainer = document.createElement('div');
            itemsContainer.classList.add('validation-panel-group-items');
            itemsContainer.setAttribute('aria-hidden', collapsed ? 'true' : 'false');

            // ヘッダークリックで折り畳みを切り替える
            groupHeader.addEventListener('click', () => {
                const expanded = groupHeader.getAttribute('aria-expanded') === 'true';
                groupHeader.setAttribute('aria-expanded', expanded ? 'false' : 'true');
                itemsContainer.setAttribute('aria-hidden', expanded ? 'true' : 'false');
                if (expanded) {
                    this.collapsedGroups.add(tableName);
                } else {
                    this.collapsedGroups.delete(tableName);
                }
            });

            // エラー項目
            for (const error of tableErrors) {
                const item = document.createElement('div');
                item.classList.add('validation-panel-item');
                const errorKey = this.createErrorSelectionKey(error);
                if (this.selectedErrorKey === errorKey) {
                    item.classList.add('validation-panel-item-selected');
                    item.setAttribute('aria-current', 'true');
                }

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
                // 主キーが解決できている場合は「テーブル名.PK列名=PK値」形式で表示する。
                // 複合主キーでは構成列をすべて並べる。
                const pkPrefix = error.primaryKeyValues !== null
                    ? `${tableName}.${formatValidationPrimaryKeyValues(error.primaryKeyValues)}`
                    : tableName;
                if (error.kind === 'plugin' && error.rowIndex === -1) {
                    locationSpan.textContent = `${error.columnName}:`;
                } else if (error.kind === 'plugin') {
                    locationSpan.textContent = `${pkPrefix} 行${error.rowIndex + 1}:`;
                } else {
                    locationSpan.textContent = `${pkPrefix} 行${error.rowIndex + 1} ${error.columnName}:`;
                }

                const messageSpan = document.createElement('span');
                messageSpan.classList.add('validation-panel-item-message');
                messageSpan.textContent = error.message;

                item.appendChild(kindSpan);
                item.appendChild(locationSpan);
                item.appendChild(messageSpan);

                // ジャンプ先が特定できるエラーにのみクリックジャンプ機能を付与する
                const canJump = error.kind !== 'plugin' || error.rowIndex !== -1;
                item.addEventListener('click', () => {
                    this.selectErrorItem(item, error);
                    if (canJump) this.jumpToError(error);
                });
                if (canJump) {
                    item.setAttribute('role', 'button');
                    item.setAttribute('tabindex', '0');
                    item.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            this.selectErrorItem(item, error);
                            this.jumpToError(error);
                        }
                    });
                }

                itemsContainer.appendChild(item);
            }

            this.element.appendChild(itemsContainer);
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
        if (error.rowIndex < 0) return;
        this.tab.navigateToTableStoreCell(error.tableName, error.rowIndex, error.columnIndex);
    }

    private selectErrorItem(item: HTMLElement, error: ValidationError): void {
        this.selectedErrorKey = this.createErrorSelectionKey(error);
        const previousSelected = this.element.querySelectorAll('.validation-panel-item-selected');
        for (let i = 0; i < previousSelected.length; i++) {
            previousSelected[i].classList.remove('validation-panel-item-selected');
            previousSelected[i].removeAttribute('aria-current');
        }
        item.classList.add('validation-panel-item-selected');
        item.setAttribute('aria-current', 'true');
    }

    private createErrorSelectionKey(error: ValidationError): string {
        return JSON.stringify([
            error.tableName,
            error.rowIndex,
            error.columnIndex,
            error.columnName,
            error.kind,
            error.value,
            error.message,
            error.filterValue,
        ]);
    }
}

/**
 * PluginValidationError を ValidationError に変換する。
 * ストア参照によるセル値解決は resolvePluginErrors（共通関数）に委譲する。
 * columnIndex と primaryKeyValues は ValidationPanel 固有の関心事のためここで解決する。
 */
function convertPluginErrors(pluginErrors: PluginValidationError[], store: InMemoryTableStore, engine: ValidationEngine): ValidationError[] {
    const resolved = resolvePluginErrors(pluginErrors, store);
    const result: ValidationError[] = [];
    for (let i = 0; i < resolved.length; ++i) {
        const r = resolved[i];
        // columnIndex はコンテキスト付きエラーでのみ解決する（ジャンプ先セル特定用）
        let columnIndex = -1;
        if (r.rowIndex !== -1 && r.columnName !== '') {
            const header = store.getHeader(r.tableName);
            if (header !== false) {
                columnIndex = header.indexOf(r.columnName);
            }
        }
        result.push({
            tableName: r.tableName,
            rowIndex: r.rowIndex,
            columnIndex,
            columnName: r.columnName,
            value: r.value,
            kind: 'plugin',
            message: r.message,
            filterValue: null,
            primaryKeyValues: r.rowIndex !== -1 ? engine.resolvePrimaryKeyValues(r.tableName, r.rowIndex) : null,
        });
    }
    return result;
}
