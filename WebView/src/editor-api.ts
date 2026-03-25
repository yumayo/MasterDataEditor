import {InMemoryTableStore} from "./in-memory-table-store";
import {Tab} from "./tab";
import {CellChangeCommand, CellChange, InsertRowCommand, DeleteRowCommand} from "./command";
import {readFileAsync} from "./api";
import {saveTableDataFromStoreAsync} from "./editor-actions";
import {Csv} from "./csv";
import {determineDisplayColumnName} from "./config";
import {ValidationEngine} from "./validation-engine";
import type {PluginValidationRunner} from "./plugin-validation-runner";
import {resolvePluginErrors} from "./plugin-validation-runner";
import type {EditorAPI, EditorDataAPI, EditorSchemaAPI, EditorEditAPI, EditorEventsAPI, EditorDisposable, EditorCellChangeEvent, SchemaEntry, RelatedTableInfo, ValidationErrorInfo} from "./editor-api-types";

/**
 * EditorAPI の実装
 *
 * ストア・タブ・スキーマレジストリを密結合で保持し、
 * data/schema/edit/events の4名前空間を提供する。
 * window.editorApi として公開され、C# ブリッジやe2eテストから利用される。
 */
export class EditorApiImpl implements EditorAPI {
    readonly data: EditorDataAPI;
    readonly schema: EditorSchemaAPI;
    readonly edit: EditorEditAPI;
    readonly events: EditorEventsAPI;

    // イベントハンドラーリスト（events 名前空間の emit で使用する）
    private readonly cellChangedHandlers: Array<(event: EditorCellChangeEvent) => void>;
    private readonly tableOpenedHandlers: Array<(event: { tableName: string }) => void>;
    private readonly tableClosedHandlers: Array<(event: { tableName: string }) => void>;
    private readonly tableSavedHandlers: Array<(event: { tableName: string }) => void>;
    private readonly rowSelectedHandlers: Array<(event: { tableName: string; rowIndex: number }) => void>;

    constructor(store: InMemoryTableStore, tab: Tab, schemaRegistry: Map<string, SchemaEntry>, validationEngine: ValidationEngine, pluginRunner: PluginValidationRunner) {
        this.cellChangedHandlers = [];
        this.tableOpenedHandlers = [];
        this.tableClosedHandlers = [];
        this.tableSavedHandlers = [];
        this.rowSelectedHandlers = [];

        // テーブルデータ読み取りの共通ヘルパー（ストア優先→CSV フォールバック）
        // data 名前空間の readTableDataAsync と新メソッドの両方から使う
        async function resolveTableDataAsync(tableName: string): Promise<{ header: string[]; rows: string[][] } | null> {
            const storeHeader = store.getHeader(tableName);
            if (storeHeader !== false) {
                const storeRows = store.getRows(tableName);
                if (storeRows === false) throw new Error('[resolveTableDataAsync] ストアの不変条件違反: header は存在するが rows が取得できません');
                return { header: [...storeHeader], rows: storeRows.map(r => [...r]) };
            }
            const content = await readFileAsync('data/' + tableName + '.csv');
            if (content === '') return null;
            const csv = new Csv();
            csv.load(content);
            return { header: [...csv.header], rows: csv.body.map(r => [...r]) };
        }

        // data 名前空間: ストアからの読み取り（ディープコピーを返して内部データを保護する）
        this.data = {
            getTableNames(): string[] {
                return store.getTableNames();
            },
            getHeader(tableName: string): string[] | null {
                const header = store.getHeader(tableName);
                if (header === false) return null;
                return [...header];
            },
            getRows(tableName: string): string[][] | null {
                const rows = store.getRows(tableName);
                if (rows === false) return null;
                return rows.map(r => [...r]);
            },
            getRowCount(tableName: string): number | null {
                const rows = store.getRows(tableName);
                if (rows === false) return null;
                return rows.length;
            },
            getCellValue(tableName: string, row: number, column: number): string | null {
                const rows = store.getRows(tableName);
                if (rows === false) return null;
                if (row < 0 || row >= rows.length) return null;
                const rowData = rows[row];
                if (column < 0 || column >= rowData.length) return null;
                return rowData[column];
            },
            async readTableDataAsync(tableName: string): Promise<{ header: string[]; rows: string[][] } | null> {
                return resolveTableDataAsync(tableName);
            },
            async getReferenceHintsAsync(tableName: string): Promise<Record<string, Record<string, string>> | null> {
                // スキーマが存在しないテーブルは null を返す
                const entry = schemaRegistry.get(tableName);
                if (!entry) return null;
                const result: Record<string, Record<string, string>> = {};
                // FK参照がない場合は空オブジェクトを返す
                for (let i = 0; i < entry.references.length; ++i) {
                    const ref = entry.references[i];
                    // 参照先テーブルのデータを取得する
                    const targetData = await resolveTableDataAsync(ref.targetTable);
                    if (targetData === null) continue;
                    // PK列（参照先のターゲット列）と表示列を決定する
                    const pkColumn = ref.targetColumn;
                    const displayColumn = determineDisplayColumnName(targetData.header);
                    // 表示列が空（見つからない）またはPK列と同じ場合は有意な表示テキストがないのでスキップする
                    if (displayColumn === '' || displayColumn === pkColumn) continue;
                    // PK列と表示列のインデックスを取得する
                    const pkColIndex = targetData.header.indexOf(pkColumn);
                    const displayColIndex = targetData.header.indexOf(displayColumn);
                    if (pkColIndex === -1 || displayColIndex === -1) continue;
                    // PK値 → 表示テキスト のマップを構築する
                    const hints: Record<string, string> = {};
                    for (let j = 0; j < targetData.rows.length; ++j) {
                        const row = targetData.rows[j];
                        hints[row[pkColIndex]] = row[displayColIndex];
                    }
                    result[ref.columnName] = hints;
                }
                return result;
            },
            async getRelatedTablesAsync(tableName: string): Promise<RelatedTableInfo[] | null> {
                // スキーマが存在しないテーブルは null を返す
                const entry = schemaRegistry.get(tableName);
                if (!entry) return null;
                const results: RelatedTableInfo[] = [];
                // 現テーブルのデータを取得する（FK値収集・PK値収集のため）
                const currentData = await resolveTableDataAsync(tableName);
                // --- N:1（このテーブルが参照している親テーブル） ---
                for (let i = 0; i < entry.references.length; ++i) {
                    const ref = entry.references[i];
                    const targetData = await resolveTableDataAsync(ref.targetTable);
                    if (targetData === null) continue;
                    // 現テーブルから当該FK列の値を収集する（重複除去）
                    const fkValues = new Set<string>();
                    if (currentData !== null) {
                        const fkColIndex = currentData.header.indexOf(ref.columnName);
                        if (fkColIndex !== -1) {
                            for (let j = 0; j < currentData.rows.length; ++j) {
                                const v = currentData.rows[j][fkColIndex];
                                if (v !== '') fkValues.add(v);
                            }
                        }
                    }
                    // 参照先テーブルのPK列インデックスを取得してフィルタする
                    const targetPkColIndex = targetData.header.indexOf(ref.targetColumn);
                    const filteredRows: string[][] = [];
                    if (targetPkColIndex !== -1) {
                        for (let j = 0; j < targetData.rows.length; ++j) {
                            if (fkValues.has(targetData.rows[j][targetPkColIndex])) {
                                filteredRows.push(targetData.rows[j]);
                            }
                        }
                    }
                    results.push({
                        relationType: 'N:1',
                        label: ref.targetTable + ' (' + ref.columnName + ' → ' + ref.targetTable + '.' + ref.targetColumn + ')',
                        tableName: ref.targetTable,
                        header: targetData.header,
                        rows: filteredRows,
                    });
                }
                // --- 1:N（このテーブルを参照している子テーブル） ---
                // 現テーブルのPK値を収集する
                const pkValues = new Set<string>();
                if (currentData !== null) {
                    // 最初のPK列を使う
                    const pkColName = entry.primaryKeys.length > 0 ? entry.primaryKeys[0] : '';
                    const pkColIndex = pkColName !== '' ? currentData.header.indexOf(pkColName) : -1;
                    if (pkColIndex !== -1) {
                        for (let j = 0; j < currentData.rows.length; ++j) {
                            const v = currentData.rows[j][pkColIndex];
                            if (v !== '') pkValues.add(v);
                        }
                    }
                }
                // 全テーブルのスキーマを走査して、このテーブルを参照している子テーブルを見つける
                for (const [childTableName, childEntry] of schemaRegistry) {
                    if (childTableName === tableName) continue;
                    for (let i = 0; i < childEntry.references.length; ++i) {
                        const childRef = childEntry.references[i];
                        if (childRef.targetTable !== tableName) continue;
                        // 子テーブルのデータを取得する
                        const childData = await resolveTableDataAsync(childTableName);
                        if (childData === null) continue;
                        // 子テーブルのFK列で現テーブルのPK値に含まれる行のみフィルタする
                        const childFkColIndex = childData.header.indexOf(childRef.columnName);
                        const filteredRows: string[][] = [];
                        if (childFkColIndex !== -1) {
                            for (let j = 0; j < childData.rows.length; ++j) {
                                if (pkValues.has(childData.rows[j][childFkColIndex])) {
                                    filteredRows.push(childData.rows[j]);
                                }
                            }
                        }
                        results.push({
                            relationType: '1:N',
                            label: childTableName + ' (' + childTableName + '.' + childRef.columnName + ' → ' + tableName + '.' + childRef.targetColumn + ')',
                            tableName: childTableName,
                            header: childData.header,
                            rows: filteredRows,
                        });
                    }
                }
                return results;
            },
            async getValidationErrorsAsync(): Promise<ValidationErrorInfo[]> {
                // MCP呼び出し時は最新状態を反映するため、preservableErrors の引き継ぎなしで実行する
                const result = validationEngine.validate([]);
                const out: ValidationErrorInfo[] = [];
                for (let i = 0; i < result.errors.length; ++i) {
                    const e = result.errors[i];
                    out.push({ tableName: e.tableName, rowIndex: e.rowIndex, columnName: e.columnName, value: e.value, kind: e.kind, message: e.message });
                }
                // プラグインバリデーションを実行してエラーをマージする。
                // runAllPluginsAsync が reject した場合でもエンジン結果は保持し、システムエラー1件を追加する。
                try {
                    const pluginErrors = await pluginRunner.runAllPluginsAsync();
                    const resolved = resolvePluginErrors(pluginErrors, store);
                    for (let i = 0; i < resolved.length; ++i) {
                        const r = resolved[i];
                        out.push({ tableName: r.tableName, rowIndex: r.rowIndex, columnName: r.columnName, value: r.value, kind: 'plugin', message: r.message });
                    }
                } catch (e: unknown) {
                    out.push({ tableName: 'プラグイン', rowIndex: -1, columnName: '(system)', value: '', kind: 'plugin', message: '[system] プラグインバリデーション実行失敗: ' + String(e) });
                }
                return out;
            },
        };

        // schema 名前空間: スキーマレジストリからの読み取り
        this.schema = {
            getSchemaTableNames(): string[] {
                return [...schemaRegistry.keys()];
            },
            getColumns(tableName: string): Array<{ name: string; type: string; defaultValue: string | null }> | null {
                const entry = schemaRegistry.get(tableName);
                if (!entry) return null;
                return entry.columns.map(c => ({ name: c.name, type: c.type, defaultValue: c.defaultValue }));
            },
            getPrimaryKeys(tableName: string): string[] | null {
                const entry = schemaRegistry.get(tableName);
                if (!entry) return null;
                return [...entry.primaryKeys];
            },
            getReferences(tableName: string): Array<{ columnName: string; targetTable: string; targetColumn: string }> | null {
                const entry = schemaRegistry.get(tableName);
                if (!entry) return null;
                return entry.references.map(r => ({ columnName: r.columnName, targetTable: r.targetTable, targetColumn: r.targetColumn }));
            },
        };

        // edit 名前空間のクロージャからイベントハンドラーにアクセスするためのキャプチャ
        const cellChangedHandlers = this.cellChangedHandlers;
        const tableSavedHandlers = this.tableSavedHandlers;

        // edit 名前空間: コマンドパターンを使った書き込み操作（Undo/Redo 対応）
        // EditorAPI の row/column はストアインデックス（0始まり）だが、
        // CellChangeCommand が呼ぶ updateCellValueAt() は DOM インデックス（1始まり: ヘッダー行/行ヘッダー列を含む）を期待する。
        // 変換: domRow = storeRow + 1, domColumn = storeColumn + 1
        // InsertRowCommand / DeleteRowCommand の rowIndex も DOM データ行インデックス（1始まり）を期待する。
        // 変換: domRowIndex = storeRowIndex + 1
        this.edit = {
            setCellValue(tableName: string, row: number, column: number, value: string): boolean {
                const tabState = tab.getTabStateByName(tableName);
                if (!tabState) return false;
                const rows = store.getRows(tableName);
                if (rows === false) return false;
                if (row < 0 || row >= rows.length) return false;
                if (column < 0 || column >= rows[row].length) return false;
                const oldValue = rows[row][column];
                // DOM インデックスに変換する
                const domRow = row + 1;
                const domColumn = column + 1;
                const changes: CellChange[] = [{ row: domRow, column: domColumn, oldValue, newValue: value }];
                const range = { startRow: domRow, startColumn: domColumn, endRow: domRow, endColumn: domColumn };
                const command = new CellChangeCommand(tabState.editorTable, changes, range, range);
                tabState.history.executeCommand(command, range, range);
                // タブを最前面にして更新セルを選択状態にする
                tab.switchToExistingTab(tableName);
                tabState.selection.setRange(domRow, domColumn, domRow, domColumn);
                tabState.selection.move(domRow, domColumn);
                tabState.editorTableHandler.activate();
                // セル変更イベントはストアインデックスで発火する（外部API視点）
                // ハンドラー実行中の dispose() によるインデックスずれを防止するためスナップショットを使用する
                const handlers = [...cellChangedHandlers];
                for (let i = 0; i < handlers.length; ++i) {
                    try { handlers[i]({ tableName, row, column, oldValue, newValue: value }); } catch (e) { console.error('[EditorAPI] イベントハンドラーでエラーが発生しました:', e); }
                }
                return true;
            },
            setCellValues(tableName: string, changes: Array<{ row: number; column: number; value: string }>): boolean {
                const tabState = tab.getTabStateByName(tableName);
                if (!tabState) return false;
                const rows = store.getRows(tableName);
                if (rows === false) return false;
                // 全変更の oldValue を取得して CellChange[] を構築する（DOM インデックスに変換）
                const cellChanges: CellChange[] = [];
                for (let i = 0; i < changes.length; ++i) {
                    const c = changes[i];
                    if (c.row < 0 || c.row >= rows.length) return false;
                    if (c.column < 0 || c.column >= rows[c.row].length) return false;
                    cellChanges.push({ row: c.row + 1, column: c.column + 1, oldValue: rows[c.row][c.column], newValue: c.value });
                }
                // 空配列の場合は何もせず成功を返す
                if (cellChanges.length === 0) return true;
                // 範囲は DOM インデックスで包含するバウンディングボックスとする
                let minRow = cellChanges[0].row, maxRow = cellChanges[0].row;
                let minCol = cellChanges[0].column, maxCol = cellChanges[0].column;
                for (let i = 1; i < cellChanges.length; ++i) {
                    if (cellChanges[i].row < minRow) minRow = cellChanges[i].row;
                    if (cellChanges[i].row > maxRow) maxRow = cellChanges[i].row;
                    if (cellChanges[i].column < minCol) minCol = cellChanges[i].column;
                    if (cellChanges[i].column > maxCol) maxCol = cellChanges[i].column;
                }
                const range = { startRow: minRow, startColumn: minCol, endRow: maxRow, endColumn: maxCol };
                const command = new CellChangeCommand(tabState.editorTable, cellChanges, range, range);
                tabState.history.executeCommand(command, range, range);
                // タブを最前面にして最後の変更セルを選択状態にする
                tab.switchToExistingTab(tableName);
                const lastChange = cellChanges[cellChanges.length - 1];
                tabState.selection.setRange(lastChange.row, lastChange.column, lastChange.row, lastChange.column);
                tabState.selection.move(lastChange.row, lastChange.column);
                tabState.editorTableHandler.activate();
                // セル変更イベントはストアインデックスで発火する（外部API視点）
                // oldValue は cellChanges から取得する（executeCommand 後はストアが更新済みのため rows を参照してはならない）
                // ハンドラー実行中の dispose() によるインデックスずれを防止するためスナップショットを使用する
                const handlers = [...cellChangedHandlers];
                for (let i = 0; i < cellChanges.length; ++i) {
                    const cc = cellChanges[i];
                    const c = changes[i];
                    for (let j = 0; j < handlers.length; ++j) {
                        try { handlers[j]({ tableName, row: c.row, column: c.column, oldValue: cc.oldValue, newValue: c.value }); } catch (e) { console.error('[EditorAPI] イベントハンドラーでエラーが発生しました:', e); }
                    }
                }
                return true;
            },
            insertRow(tableName: string, rowIndex: number): boolean {
                const tabState = tab.getTabStateByName(tableName);
                if (!tabState) return false;
                const rows = store.getRows(tableName);
                if (rows === false) return false;
                // 末尾挿入（rowIndex === rows.length）を許可するため > で比較する
                if (rowIndex < 0 || rowIndex > rows.length) return false;
                const header = store.getHeader(tableName);
                if (header === false) return false;
                // DOM データ行インデックスに変換する
                const domRowIndex = rowIndex + 1;
                const command = new InsertRowCommand(tabState.editorTable, domRowIndex);
                const range = { startRow: domRowIndex, startColumn: 1, endRow: domRowIndex, endColumn: header.length };
                tabState.history.executeCommand(command, range, range);
                return true;
            },
            deleteRow(tableName: string, rowIndex: number): boolean {
                const tabState = tab.getTabStateByName(tableName);
                if (!tabState) return false;
                const rows = store.getRows(tableName);
                if (rows === false) return false;
                if (rowIndex < 0 || rowIndex >= rows.length) return false;
                const header = store.getHeader(tableName);
                if (header === false) return false;
                // DOM データ行インデックスに変換する
                const domRowIndex = rowIndex + 1;
                const command = new DeleteRowCommand(tabState.editorTable, domRowIndex);
                const range = { startRow: domRowIndex, startColumn: 1, endRow: domRowIndex, endColumn: header.length };
                tabState.history.executeCommand(command, range, range);
                return true;
            },
            openTableAsync(tableName: string): Promise<boolean> {
                return tab.openTableAsync(tableName);
            },
            async saveTableAsync(tableName: string): Promise<boolean> {
                if (store.getHeader(tableName) === false) return false;
                await saveTableDataFromStoreAsync(tableName, store);
                // Dirty状態をクリアする（タブが開いている場合のみ: Historyレジストリが必要）
                const tabState = tab.getTabStateByName(tableName);
                if (tabState) {
                    store.markAllSaved(tableName);
                    // RelationsPanel のDirtyマークを更新する（通常保存パスと同等の後処理）
                    if (tabState.editorTable.relationsPanel !== false) {
                        tabState.editorTable.relationsPanel.updateDirtyMark(tableName, false);
                    }
                    // 保存完了後にgit差分を再取得してセルのハイライトを更新する
                    tabState.editorTable.refreshGitDiffAsync()
                        .catch((e: unknown) => { console.error('[EditorAPI] refreshGitDiffAsync failed:', e); });
                }
                // テーブル保存イベントを発火する
                const snapshot = [...tableSavedHandlers];
                for (let i = 0; i < snapshot.length; ++i) {
                    try { snapshot[i]({ tableName }); } catch (e) { console.error('[EditorAPI] イベントハンドラーでエラーが発生しました:', e); }
                }
                return true;
            },
        };

        // events 名前空間: イベント購読
        this.events = {
            onCellChanged: (handler: (event: EditorCellChangeEvent) => void): EditorDisposable => {
                this.cellChangedHandlers.push(handler);
                return { dispose: () => { const idx = this.cellChangedHandlers.indexOf(handler); if (idx !== -1) this.cellChangedHandlers.splice(idx, 1); } };
            },
            onTableOpened: (handler: (event: { tableName: string }) => void): EditorDisposable => {
                this.tableOpenedHandlers.push(handler);
                return { dispose: () => { const idx = this.tableOpenedHandlers.indexOf(handler); if (idx !== -1) this.tableOpenedHandlers.splice(idx, 1); } };
            },
            onTableClosed: (handler: (event: { tableName: string }) => void): EditorDisposable => {
                this.tableClosedHandlers.push(handler);
                return { dispose: () => { const idx = this.tableClosedHandlers.indexOf(handler); if (idx !== -1) this.tableClosedHandlers.splice(idx, 1); } };
            },
            onTableSaved: (handler: (event: { tableName: string }) => void): EditorDisposable => {
                this.tableSavedHandlers.push(handler);
                return { dispose: () => { const idx = this.tableSavedHandlers.indexOf(handler); if (idx !== -1) this.tableSavedHandlers.splice(idx, 1); } };
            },
            onRowSelected: (handler: (event: { tableName: string; rowIndex: number }) => void): EditorDisposable => {
                this.rowSelectedHandlers.push(handler);
                return { dispose: () => { const idx = this.rowSelectedHandlers.indexOf(handler); if (idx !== -1) this.rowSelectedHandlers.splice(idx, 1); } };
            },
        };
    }

    /** テーブルオープンイベントを発火する（Tab.enableTabButton から呼ばれる） */
    emitTableOpened(tableName: string): void {
        // ハンドラー実行中に dispose() で配列が縮小してもループインデックスがずれないようスナップショットを作成する
        const snapshot = [...this.tableOpenedHandlers];
        for (let i = 0; i < snapshot.length; ++i) {
            try { snapshot[i]({ tableName }); } catch (e) { console.error('[EditorAPI] イベントハンドラーでエラーが発生しました:', e); }
        }
    }

    /** テーブルクローズイベントを発火する（Tab.performCloseTab から呼ばれる） */
    emitTableClosed(tableName: string): void {
        const snapshot = [...this.tableClosedHandlers];
        for (let i = 0; i < snapshot.length; ++i) {
            try { snapshot[i]({ tableName }); } catch (e) { console.error('[EditorAPI] イベントハンドラーでエラーが発生しました:', e); }
        }
    }

    /** テーブル保存イベントを発火する（EditorTableHandler の保存完了時に呼ばれる） */
    emitTableSaved(tableName: string): void {
        const snapshot = [...this.tableSavedHandlers];
        for (let i = 0; i < snapshot.length; ++i) {
            try { snapshot[i]({ tableName }); } catch (e) { console.error('[EditorAPI] イベントハンドラーでエラーが発生しました:', e); }
        }
    }

    /** 行選択変更イベントを発火する（EditorTable.notifyRowSelectionChanged から呼ばれる） */
    emitRowSelected(tableName: string, rowIndex: number): void {
        const snapshot = [...this.rowSelectedHandlers];
        for (let i = 0; i < snapshot.length; ++i) {
            try { snapshot[i]({ tableName, rowIndex }); } catch (e) { console.error('[EditorAPI] イベントハンドラーでエラーが発生しました:', e); }
        }
    }
}
