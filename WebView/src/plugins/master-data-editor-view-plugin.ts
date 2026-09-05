/** Viewプラグイン向け公開APIの現在のメジャーバージョン。 */
export const VIEW_PLUGIN_API_VERSION = 2 as const;

export type ViewPluginAPIVersion = typeof VIEW_PLUGIN_API_VERSION;
export type ViewPluginNotificationStatus = 'success' | 'error';

export interface ViewPluginNotificationAPI {
    show(message: string, status?: ViewPluginNotificationStatus): void;
}

/**
 * Viewプラグインへ公開するAPI。
 *
 * EditorAPIのイベント発火メソッドなど、ホスト専用操作は含めない。
 */
export interface ViewPluginAPI {
    /** 既存プラグインとの互換用。新規コードでは各名前空間を直接使用する。 */
    editor: EditorAPI;
    data: EditorDataAPI;
    schema: EditorSchemaAPI;
    edit: EditorEditAPI;
    events: EditorEventsAPI;
    tables: ViewPluginTablesAPI;
    view: ViewPluginRuntimeAPI;
    notification: ViewPluginNotificationAPI;
}

export type ViewPluginSaveHandler = () => void | boolean | Promise<void | boolean>;

export interface ViewPluginRuntimeAPI {
    setDirty(dirty: boolean): void;
    isDirty(): boolean;
    onSave(handler: ViewPluginSaveHandler): EditorDisposable;
    saveAsync(): Promise<boolean>;
    /**
     * Viewに属する編集セッションを作成する。
     * セッション経由の更新は未完了処理、dirty状態、保存対象テーブルを自動管理する。
     */
    createEditSession(): ViewPluginEditSession;
}

export interface ViewPluginRegistration {
    id: string;
    apiVersion: ViewPluginAPIVersion;
    title?: string;
    description?: string;
    render(container: HTMLElement, api: ViewPluginAPI): void | ViewPluginMountResult | Promise<void | ViewPluginMountResult>;
    dispose?(): void;
}

export type ViewPluginMountResult = (() => void) | {
    dispose?(): void;
    save?(): void | boolean | Promise<void | boolean>;
};

/** ホストが発行する、テーブル内で安定した行参照。 */
export interface ViewPluginRowReference {
    readonly tableName: string;
    readonly rowId: string;
}

export type ViewPluginRecordValues = Readonly<Record<string, string>>;
export type ViewPluginRecordChanges = Record<string, string>;

export interface ViewPluginRecord {
    readonly ref: ViewPluginRowReference;
    readonly values: ViewPluginRecordValues;
}

export interface ViewPluginTableAPI {
    readonly name: string;
    /** 列名をキーにしたレコードと安定した行参照を取得する。 */
    readRecordsAsync(): Promise<ViewPluginRecord[] | null>;
    /** 行参照で対象行を特定し、列名をキーにして複数セルを一括更新する。 */
    updateRecordAsync(ref: ViewPluginRowReference, changes: ViewPluginRecordChanges): Promise<boolean>;
    saveAsync(): Promise<boolean>;
}

export interface ViewPluginTablesAPI {
    get(tableName: string): ViewPluginTableAPI;
}

export interface ViewPluginEditSession {
    /** 更新成功時に対象テーブルとViewをdirtyにする。 */
    updateRecordAsync(ref: ViewPluginRowReference, changes: ViewPluginRecordChanges): Promise<boolean>;
    /** 未完了の更新を待って、変更された全テーブルを保存する。 */
    saveAsync(): Promise<boolean>;
    isDirty(): boolean;
    dispose(): void;
}

/** プラグインに公開するEditor API。ホスト専用のemit系メソッドは含めない。 */
export interface EditorAPI {
    data: EditorDataAPI;
    schema: EditorSchemaAPI;
    edit: EditorEditAPI;
    events: EditorEventsAPI;
}

export interface EditorDataAPI {
    getTableNames(): string[];
    getHeader(tableName: string): string[] | null;
    getRows(tableName: string): string[][] | null;
    getRowCount(tableName: string): number | null;
    getCellValue(tableName: string, row: number, column: number): string | null;
    readTableDataAsync(tableName: string): Promise<{ header: string[]; rows: string[][] } | null>;
    getReferenceItemsAsync(tableName: string, columnName: string, sourceValue: string): Promise<ReferenceListInfo | null>;
    getReferenceDisplayTextAsync(tableName: string, columnName: string, sourceValue: string, value: string): Promise<ReferenceDisplayTextInfo | null>;
    getReferenceHintsAsync(tableName: string): Promise<Record<string, Record<string, string>> | null>;
    getRelatedTablesAsync(tableName: string): Promise<RelatedTableInfo[] | null>;
    getValidationErrorsAsync(): Promise<ValidationErrorInfo[]>;
    searchCellsAsync(queryText: string, caseSensitive: boolean, wholeWord: boolean, useRegex: boolean): Promise<SearchResultInfo[]>;
}

export interface ReferenceItemInfo {
    id: string;
    displayText: string;
}

export interface ReferenceListInfo {
    tableName: string;
    columnName: string;
    displayColumnName: string;
    items: ReferenceItemInfo[];
}

export interface ReferenceDisplayTextInfo {
    tableName: string;
    columnName: string;
    id: string;
    displayText: string;
}

export interface RelatedTableInfo {
    relationType: 'N:1' | '1:N';
    label: string;
    tableName: string;
    header: string[];
    rows: string[][];
}

export interface ValidationErrorInfo {
    tableName: string;
    rowIndex: number;
    columnName: string;
    value: string;
    kind: 'pk-duplicate' | 'fk-broken' | 'type-mismatch' | 'plugin';
    message: string;
}

export interface SearchResultInfo {
    tableName: string;
    rowIndex: number;
    columnName: string;
    columnIndex: number;
    pkValue: string;
    value: string;
    referenceDisplayText: string;
}

export interface EditorSchemaAPI {
    getSchemaTableNames(): string[];
    getColumns(tableName: string): EditorSchemaColumn[] | null;
    getPrimaryKeys(tableName: string): string[] | null;
    getReferences(tableName: string): EditorSchemaReference[] | null;
}

export interface EditorSchemaColumn {
    name: string;
    type: string;
    defaultValue: string | null;
}

export interface EditorSchemaReference {
    columnName: string;
    targetTable: string;
    targetColumn: string;
}

export interface EditorEditAPI {
    setCellValue(tableName: string, row: number, column: number, value: string): boolean;
    setCellValues(tableName: string, changes: Array<{ row: number; column: number; value: string }>): boolean;
    setCellValueAsync(tableName: string, row: number, column: number, value: string): Promise<boolean>;
    setCellValuesAsync(tableName: string, changes: Array<{ row: number; column: number; value: string }>): Promise<boolean>;
    insertRow(tableName: string, rowIndex: number): boolean;
    deleteRow(tableName: string, rowIndex: number): boolean;
    openTableAsync(tableName: string): Promise<boolean>;
    saveTableAsync(tableName: string): Promise<boolean>;
}

export interface EditorEventsAPI {
    onTableOpened(handler: (event: { tableName: string }) => void): EditorDisposable;
    onTableClosed(handler: (event: { tableName: string }) => void): EditorDisposable;
    onCellChanged(handler: (event: EditorCellChangeEvent) => void): EditorDisposable;
    onTableSaved(handler: (event: { tableName: string }) => void): EditorDisposable;
    onRowSelected(handler: (event: { tableName: string; rowIndex: number }) => void): EditorDisposable;
}

export interface EditorCellChangeEvent {
    tableName: string;
    row: number;
    column: number;
    oldValue: string;
    newValue: string;
}

export interface EditorDisposable {
    dispose(): void;
}

export interface MasterDataEditorPluginGlobal {
    readonly apiVersion: ViewPluginAPIVersion;
    registerViewPlugin(registration: ViewPluginRegistration): void;
    registerView(registration: ViewPluginRegistration): void;
    editorApi: EditorAPI;
    api: ViewPluginAPI;
}

type PublicViewPluginAPIVersion = ViewPluginAPIVersion;
type PublicViewPluginNotificationStatus = ViewPluginNotificationStatus;
type PublicViewPluginNotificationAPI = ViewPluginNotificationAPI;
type PublicViewPluginAPI = ViewPluginAPI;
type PublicViewPluginSaveHandler = ViewPluginSaveHandler;
type PublicViewPluginRuntimeAPI = ViewPluginRuntimeAPI;
type PublicViewPluginRegistration = ViewPluginRegistration;
type PublicViewPluginMountResult = ViewPluginMountResult;
type PublicViewPluginRowReference = ViewPluginRowReference;
type PublicViewPluginRecordValues = ViewPluginRecordValues;
type PublicViewPluginRecordChanges = ViewPluginRecordChanges;
type PublicViewPluginRecord = ViewPluginRecord;
type PublicViewPluginTableAPI = ViewPluginTableAPI;
type PublicViewPluginTablesAPI = ViewPluginTablesAPI;
type PublicViewPluginEditSession = ViewPluginEditSession;
type PublicEditorAPI = EditorAPI;
type PublicEditorDataAPI = EditorDataAPI;
type PublicReferenceItemInfo = ReferenceItemInfo;
type PublicReferenceListInfo = ReferenceListInfo;
type PublicReferenceDisplayTextInfo = ReferenceDisplayTextInfo;
type PublicRelatedTableInfo = RelatedTableInfo;
type PublicValidationErrorInfo = ValidationErrorInfo;
type PublicSearchResultInfo = SearchResultInfo;
type PublicEditorSchemaAPI = EditorSchemaAPI;
type PublicEditorSchemaColumn = EditorSchemaColumn;
type PublicEditorSchemaReference = EditorSchemaReference;
type PublicEditorEditAPI = EditorEditAPI;
type PublicEditorEventsAPI = EditorEventsAPI;
type PublicEditorCellChangeEvent = EditorCellChangeEvent;
type PublicEditorDisposable = EditorDisposable;
type PublicMasterDataEditorPluginGlobal = MasterDataEditorPluginGlobal;

declare global {
    type ViewPluginAPIVersion = PublicViewPluginAPIVersion;
    type ViewPluginNotificationStatus = PublicViewPluginNotificationStatus;
    interface ViewPluginNotificationAPI extends PublicViewPluginNotificationAPI {}
    interface ViewPluginAPI extends PublicViewPluginAPI {}
    type ViewPluginSaveHandler = PublicViewPluginSaveHandler;
    interface ViewPluginRuntimeAPI extends PublicViewPluginRuntimeAPI {}
    interface ViewPluginRegistration extends PublicViewPluginRegistration {}
    type ViewPluginMountResult = PublicViewPluginMountResult;
    interface ViewPluginRowReference extends PublicViewPluginRowReference {}
    type ViewPluginRecordValues = PublicViewPluginRecordValues;
    type ViewPluginRecordChanges = PublicViewPluginRecordChanges;
    interface ViewPluginRecord extends PublicViewPluginRecord {}
    interface ViewPluginTableAPI extends PublicViewPluginTableAPI {}
    interface ViewPluginTablesAPI extends PublicViewPluginTablesAPI {}
    interface ViewPluginEditSession extends PublicViewPluginEditSession {}
    interface EditorAPI extends PublicEditorAPI {}
    interface EditorDataAPI extends PublicEditorDataAPI {}
    interface ReferenceItemInfo extends PublicReferenceItemInfo {}
    interface ReferenceListInfo extends PublicReferenceListInfo {}
    interface ReferenceDisplayTextInfo extends PublicReferenceDisplayTextInfo {}
    interface RelatedTableInfo extends PublicRelatedTableInfo {}
    interface ValidationErrorInfo extends PublicValidationErrorInfo {}
    interface SearchResultInfo extends PublicSearchResultInfo {}
    interface EditorSchemaAPI extends PublicEditorSchemaAPI {}
    interface EditorSchemaColumn extends PublicEditorSchemaColumn {}
    interface EditorSchemaReference extends PublicEditorSchemaReference {}
    interface EditorEditAPI extends PublicEditorEditAPI {}
    interface EditorEventsAPI extends PublicEditorEventsAPI {}
    interface EditorCellChangeEvent extends PublicEditorCellChangeEvent {}
    interface EditorDisposable extends PublicEditorDisposable {}
    interface MasterDataEditorPluginGlobal extends PublicMasterDataEditorPluginGlobal {}

    interface Window {
        masterDataEditor: MasterDataEditorPluginGlobal;
        editorApi: EditorAPI;
    }
}
