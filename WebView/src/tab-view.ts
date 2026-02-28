import {Tab, TabState} from "./tab";
import {TabButton} from "./tab-button";
import {EditorTableData} from "./model/editor-table-data";
import {Csv} from "./csv";
import {readFileAsync, findFilesAsync} from "./api";
import {EditorTable, AvailableJoinTarget} from "./editor-table";
import {ReferenceDataCache} from "./reference-data-cache";
import {GridDropdownInput} from "./grid-dropdown-input";
import {ViewDefinition, parseViewDefinition} from "./model/view-definition";
import {ViewColumnMapping} from "./model/view-column-mapping";
import {ViewRowMetadata} from "./model/view-row-metadata";
import {buildViewTableData, JoinedTableLoadedData, applyViewColumnConfig} from "./view-table-data-builder";
import {saveViewDataAsync, updateViewColumnConfigs} from "./view-save-splitter";
import {History} from "./history";

/**
 * ビュータブ管理モジュール
 *
 * 責務:
 * - ビュータブ（JOIN表示）の作成
 * - ビューコンテキストの設定
 * - JOIN操作の実行
 * - 非表示列の再表示
 * - ビュータブの再構築
 */
export class TabView {
    private readonly tab: Tab;

    constructor(tab: Tab) {
        this.tab = tab;
    }

    /**
     * ビュータブの状態を作成する
     * preloadedViewDefinition が渡された場合はファイル読み込みを迂回してメモリ上の定義を使う
     */
    createViewTabState(
        name: string, tabButton: TabButton, preloadedViewDefinition: ViewDefinition | 'load_from_file'
    ): void {
        // "view:view_chara" から "view_chara" を抽出
        const viewName = name.substring(5);

        const viewDefPromise = preloadedViewDefinition !== 'load_from_file'
            ? Promise.resolve(preloadedViewDefinition)
            : readFileAsync('view/' + viewName + '.json').then((viewJson) => parseViewDefinition(JSON.parse(viewJson)));

        viewDefPromise.then((viewDefinition) => {
            const baseTable = viewDefinition.baseTable;

            // ベーステーブルを読み込み
            Promise.all([
                readFileAsync('schema/' + baseTable + '.json'),
                readFileAsync('data/' + baseTable + '.csv'),
            ]).then(([schemaText, csvText]) => {
                const json = JSON.parse(schemaText);
                const csv = new Csv();
                csv.load(csvText);
                const baseTableData = EditorTableData.parse(json, csv);

                // 結合テーブルを読み込み
                const joinPromises: Promise<JoinedTableLoadedData>[] = [];
                for (const join of viewDefinition.joins) {
                    const p = Promise.all([
                        readFileAsync('schema/' + join.targetTable + '.json'),
                        readFileAsync('data/' + join.targetTable + '.csv'),
                    ]).then(([sText, cText]) => {
                        const sJson = JSON.parse(sText);
                        const sCsv = new Csv();
                        sCsv.load(cText);
                        const td = EditorTableData.parse(sJson, sCsv);
                        return {tableName: join.targetTable, tableData: td} as JoinedTableLoadedData;
                    });
                    joinPromises.push(p);
                }

                Promise.all(joinPromises).then(async (joinedTables) => {
                    // ビューテーブルデータを構築
                    const rawBuildResult = buildViewTableData(baseTableData, joinedTables, viewDefinition);

                    // 列設定（幅オーバーライド・非表示列フィルタ）を適用
                    const buildResult = applyViewColumnConfig(rawBuildResult, viewDefinition.columns);
                    const compositeTableData = buildResult.compositeTableData;
                    const columnMappings = buildResult.columnMappings;
                    const joinTableKeyMaps = buildResult.joinTableKeyMaps;

                    // 逆参照JOIN対象を検出（EditorTable生成前に非同期処理を完了させる）
                    const reverseJoinTargets: AvailableJoinTarget[] = [];
                    const schemaFiles = await findFilesAsync('schema');
                    for (const file of schemaFiles) {
                        if (file.type !== 'file' || !file.name.endsWith('.json')) continue;
                        const childTableName = file.name.replace('.json', '');
                        if (childTableName === viewDefinition.baseTable) continue;
                        const childSchemaText = await readFileAsync('schema/' + childTableName + '.json');
                        const childSchema = JSON.parse(childSchemaText);
                        for (const col of childSchema.header) {
                            if (!col.reference) continue;
                            const refParts = col.reference.split('.');
                            if (refParts.length !== 2) continue;
                            if (refParts[0] !== viewDefinition.baseTable) continue;
                            reverseJoinTargets.push({
                                sourceColumnName: refParts[1],
                                targetTableName: childTableName,
                                targetColumnName: col.name,
                                isReverse: true,
                            });
                        }
                    }

                    // ラッパー要素を作成
                    const wrapperElement = document.createElement('div');
                    wrapperElement.classList.add('tab-wrapper');
                    wrapperElement.dataset.tabName = name;
                    this.tab.getEditor().element.appendChild(wrapperElement);

                    // 参照データキャッシュを作成（インメモリデータ優先取得用にマップを渡す）
                    const referenceDataCache = new ReferenceDataCache(this.tab.getOpenEditorTables());

                    // EditorTable生成
                    const factoryResult = this.tab.createEditorTable(
                        name, compositeTableData, referenceDataCache, wrapperElement, tabButton
                    );
                    const editorTable = factoryResult.editorTable;
                    const selection = factoryResult.selection;
                    const editorTableHandler = factoryResult.editorTableHandler;
                    const history = factoryResult.history;
                    const areaResizer = factoryResult.areaResizer;
                    const fillController = factoryResult.fillController;

                    // 開いているテーブルのマップに登録
                    this.tab.getOpenEditorTables().set(name, editorTable);

                    // ビューコンテキストを設定（逆参照は事前検出済みのため同期実行）
                    this.setupViewContext(
                        name, editorTable, viewDefinition, columnMappings,
                        joinTableKeyMaps, buildResult.rowMetadata, baseTableData, history,
                        reverseJoinTargets
                    );

                    // ファイルから読み込んだビューのJOIN列ヘッダーに背景色を適用
                    for (let i = 0; i < columnMappings.length; i++) {
                        if (columnMappings[i].isJoinedColumn) {
                            editorTable.addColumnHeaderClass(i, 'editor-table-joined-column-header');
                        }
                    }

                    // ビュー用の保存コールバック
                    const tabStates = this.tab.getTabStates();
                    editorTableHandler.setSaveCallback((_table: EditorTable) => {
                        const state = tabStates.get(name);
                        if (!state || state.kind !== 'view') return Promise.resolve();
                        // 保存前に列幅をViewDefinitionに反映
                        updateViewColumnConfigs(state.editorTable, state.columnMappings, state.viewDefinition);
                        return saveViewDataAsync(
                            state.editorTable, state.columnMappings, state.viewDefinition, state.rowMetadata
                        );
                    });

                    // 参照先テーブルをpreload
                    this.tab.reference.preloadReferenceTables(compositeTableData, referenceDataCache, editorTable);

                    // 逆参照を並行して解決（ベーステーブル名で解決する）
                    this.tab.reference.resolveReverseReferencesAsync(baseTable, editorTable);

                    // ドロップダウン入力を作成
                    const dropdownInput = new GridDropdownInput(
                        wrapperElement,
                        editorTableHandler.element,
                        (id: string) => { editorTableHandler.submitDropdownSelection(id); },
                        () => { editorTableHandler.cancelDropdown(); }
                    );

                    editorTableHandler.setReferenceComponents(referenceDataCache, dropdownInput, compositeTableData);

                    // 初期選択
                    selection.setRange(1, 1, 1, 1);
                    selection.move(1, 1);

                    // タブ状態を保存
                    const state: TabState = {
                        kind: 'view',
                        editorTable, selection, editorTableHandler, history,
                        areaResizer, fillController, wrapperElement,
                        referenceDataCache, dropdownInput, viewDefinition,
                        columnMappings, rowMetadata: buildResult.rowMetadata,
                        savedScrollLeft: 0, savedScrollTop: 0,
                    };
                    tabStates.set(name, state);

                    this.tab.activateTabState(state);
                    this.tab.setActiveTabNameInternal(name);

                    this.tab.consumePendingNavigation(state);
                });
            });
        });
    }

    /**
     * ビューコンテキストを設定する
     * 逆参照JOIN対象は事前検出済みのためパラメータで受け取る
     */
    private setupViewContext(
        name: string, editorTable: EditorTable, viewDefinition: ViewDefinition,
        columnMappings: ViewColumnMapping[], joinTableKeyMaps: Map<string, Map<string, string[][]>>,
        rowMetadata: ViewRowMetadata[], baseTableData: EditorTableData, history: History,
        reverseJoinTargets: AvailableJoinTarget[]
    ): void {
        // ベーステーブルのreferenceを持つ列から利用可能な順参照Join対象を抽出
        const availableJoinTargets: AvailableJoinTarget[] = [];
        for (const col of baseTableData.header) {
            if (!col.reference) continue;
            const parts = col.reference.split('.');
            if (parts.length !== 2) continue;
            availableJoinTargets.push({
                sourceColumnName: col.name,
                targetTableName: parts[0],
                targetColumnName: parts[1],
                isReverse: false,
            });
        }
        // 逆参照JOIN対象を追加（事前検出済み）
        availableJoinTargets.push(...reverseJoinTargets);

        editorTable.setViewContext({
            viewDefinition, columnMappings, availableJoinTargets, joinTableKeyMaps, rowMetadata,
            openEditorTables: this.tab.getOpenEditorTables(),
            onJoinAsync: async (target: AvailableJoinTarget, afterColumnIndex: number) => {
                if (target.isReverse) {
                    // 逆参照JOINを実行: viewDefinitionにJOIN定義を追加してビュー全体を再構築する
                    viewDefinition.joins.push({
                        sourceColumn: target.sourceColumnName,
                        targetTable: target.targetTableName,
                        targetColumn: target.targetColumnName,
                        insertAfterViewColumnIndex: afterColumnIndex,
                        sourceTable: '',
                    });
                    this.rebuildViewTab(name);
                    return;
                }
                return this.executeJoinAsync(
                    editorTable, viewDefinition, columnMappings, history,
                    target.targetTableName, target.sourceColumnName, afterColumnIndex
                );
            },
            onShowHiddenColumn: (tableName: string, columnName: string) => {
                this.showHiddenViewColumn(name, tableName, columnName);
            },
        });
    }

    /**
     * Join操作を実行する
     */
    private async executeJoinAsync(
        editorTable: EditorTable, viewDefinition: ViewDefinition,
        columnMappings: ViewColumnMapping[], history: History,
        targetTable: string, sourceColumn: string, afterColumnIndex: number
    ): Promise<void> {
        // 結合先テーブルを読み込み
        const [schemaText, csvText] = await Promise.all([
            readFileAsync('schema/' + targetTable + '.json'),
            readFileAsync('data/' + targetTable + '.csv'),
        ]);

        const json = JSON.parse(schemaText);
        const csv = new Csv();
        csv.load(csvText);
        const joinTableData = EditorTableData.parse(json, csv);

        // Join定義を追加
        // referenceからtargetColumnを取得
        const targetColumn = joinTableData.header.length > 0 ? joinTableData.header[0].name : 'id';
        // referenceのtargetColumnを使う
        const baseCol = editorTable.getTableData().header.find(c => c.name === sourceColumn);
        let actualTargetColumn = targetColumn;
        if (baseCol && baseCol.reference) {
            const parts = baseCol.reference.split('.');
            if (parts.length === 2) {
                actualTargetColumn = parts[1];
            }
        }

        // ViewJoinCommandを使用
        const {ViewJoinCommand} = await import("./view-join-command");
        const command = new ViewJoinCommand(
            editorTable, viewDefinition, columnMappings, joinTableData,
            targetTable, sourceColumn, actualTargetColumn, afterColumnIndex
        );

        const anchor = editorTable.getSelection().getAnchor();
        const copyRange = editorTable.getSelection().getCopyRange();
        history.executeCommand(command, {
            startRow: anchor.row, startColumn: anchor.column,
            endRow: anchor.row, endColumn: anchor.column,
        }, copyRange);
    }

    /**
     * 非表示列を再表示する
     * viewDefinition.columns の hidden を false に変更し、ビュータブを再構築する
     */
    showHiddenViewColumn(name: string, tableName: string, columnName: string): void {
        const tabStates = this.tab.getTabStates();
        const state = tabStates.get(name);
        if (!state || state.kind !== 'view') return;

        // viewDefinition.columns の該当エントリを hidden:false で置換
        const colIndex = state.viewDefinition.columns.findIndex(
            c => c.tableName === tableName && c.columnName === columnName && c.hidden
        );
        if (colIndex >= 0) {
            const old = state.viewDefinition.columns[colIndex];
            state.viewDefinition.columns.splice(colIndex, 1, {
                tableName: old.tableName, columnName: old.columnName,
                width: old.width, hidden: false,
            });
        }

        // ビュータブを再構築
        this.rebuildViewTab(name);
    }

    /**
     * ビュータブを再構築する
     * 現在のViewDefinitionを保持したまま、タブを再作成する
     */
    rebuildViewTab(name: string): void {
        const tabStates = this.tab.getTabStates();
        const state = tabStates.get(name);
        if (!state || state.kind !== 'view') return;

        const viewDefinition = state.viewDefinition;

        // 現在の列幅をViewDefinitionに反映
        updateViewColumnConfigs(state.editorTable, state.columnMappings, viewDefinition);

        // 現在のタブ状態をクリーンアップ
        state.editorTable.deactivate();
        state.areaResizer.deactivate();
        state.fillController.deactivate();
        state.editorTableHandler.deactivate();
        state.wrapperElement.remove();
        tabStates.delete(name);
        this.tab.getOpenEditorTables().delete(name);

        const tabButton = this.tab.getTabButtons().find(x => x.name === name);
        if (!tabButton) return;

        // ファイル読み込みを迂回し、メモリ上のviewDefinitionを引数として渡す
        this.tab.setActiveTabNameInternal(name);
        this.createViewTabState(name, tabButton, viewDefinition);
    }
}
