export {};

declare global {
    interface Window {
        masterDataEditor: MasterDataEditorPluginGlobal;
        editorApi: EditorAPI;
    }

    interface MasterDataEditorPluginGlobal {
        registerViewPlugin(registration: ViewPluginRegistration): void;
        registerView(registration: ViewPluginRegistration): void;
        editorApi: EditorAPI;
        api: ViewPluginAPI;
    }

    interface ViewPluginRegistration {
        id: string;
        title?: string;
        description?: string;
        render(container: HTMLElement, api: ViewPluginAPI): void | ViewPluginMountResult | Promise<void | ViewPluginMountResult>;
        dispose?(): void;
    }

    type ViewPluginMountResult = (() => void) | {
        dispose?(): void;
        save?(): void | boolean | Promise<void | boolean>;
    };

    interface ViewPluginAPI {
        editor: EditorAPI;
        data: EditorAPI['data'];
        schema: EditorAPI['schema'];
        edit: EditorAPI['edit'];
        events: EditorAPI['events'];
        view: ViewPluginRuntimeAPI;
        notification: { show(message: string): void };
    }

    type ViewPluginSaveHandler = () => void | boolean | Promise<void | boolean>;

    interface ViewPluginRuntimeAPI {
        setDirty(dirty: boolean): void;
        isDirty(): boolean;
        onSave(handler: ViewPluginSaveHandler): { dispose(): void };
        saveAsync(): Promise<boolean>;
    }

    interface EditorAPI {
        data: {
            getTableNames(): string[];
            getHeader(tableName: string): string[] | null;
            getRows(tableName: string): string[][] | null;
            getRowCount(tableName: string): number | null;
            getCellValue(tableName: string, row: number, column: number): string | null;
            readTableDataAsync(tableName: string): Promise<{ header: string[]; rows: string[][] } | null>;
        };
        schema: {
            getSchemaTableNames(): string[];
            getColumns(tableName: string): Array<{ name: string; type: string; defaultValue: string | null }> | null;
            getPrimaryKeys(tableName: string): string[] | null;
        };
        edit: {
            setCellValue(tableName: string, row: number, column: number, value: string): boolean;
            setCellValues(tableName: string, changes: Array<{ row: number; column: number; value: string }>): boolean;
            setCellValueAsync(tableName: string, row: number, column: number, value: string): Promise<boolean>;
            setCellValuesAsync(tableName: string, changes: Array<{ row: number; column: number; value: string }>): Promise<boolean>;
            insertRow(tableName: string, rowIndex: number): boolean;
            deleteRow(tableName: string, rowIndex: number): boolean;
            openTableAsync(tableName: string): Promise<boolean>;
            saveTableAsync(tableName: string): Promise<boolean>;
        };
        events: {
            onTableOpened(handler: (event: { tableName: string }) => void): { dispose(): void };
            onTableClosed(handler: (event: { tableName: string }) => void): { dispose(): void };
            onTableSaved(handler: (event: { tableName: string }) => void): { dispose(): void };
            onRowSelected(handler: (event: { tableName: string; rowIndex: number }) => void): { dispose(): void };
        };
    }
}
