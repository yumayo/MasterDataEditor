/**
 * テーブル定義エディタ
 *
 * 責務:
 * - 新規テーブルのスキーマ定義UIを提供する（テーブル名、列名、型、PK指定）
 * - バリデーション（テーブル名の重複・不正文字、列名重複、PK未設定）
 * - 保存時にスキーマJSON + CSVヘッダーを生成してファイルシステムに書き込む
 *
 * Tab から呼ばれて専用タブとしてエディター領域にマウントされる。
 * 設定タブ（SettingsPanel）・ER図タブ（ErDiagramTab）と同じパターン。
 */
import {writeFileAsync} from "./api";
import type {Tab} from "./tab";

/** テーブル名の有効文字パターン: 英数字とアンダースコアのみ */
const TABLE_NAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/** 列名の有効文字パターン: 英数字とアンダースコアのみ */
const COLUMN_NAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/** 列の型選択肢 */
const COLUMN_TYPES = ['string', 'int', 'float', 'double', 'bool'] as const;

/**
 * テーブル定義エディタ
 */
export class TableDefinitionEditor {
    private readonly container: HTMLElement;
    private readonly nameInput: HTMLInputElement;
    private readonly nameError: HTMLSpanElement;
    private readonly descInput: HTMLInputElement;
    private readonly columnsContainer: HTMLElement;
    private readonly saveError: HTMLSpanElement;
    private readonly tab: Tab;
    /** 既存テーブル名の一覧（重複チェック用） */
    private readonly existingTableNames: ReadonlyArray<string>;

    constructor(tab: Tab, existingTableNames: ReadonlyArray<string>) {
        this.tab = tab;
        this.existingTableNames = existingTableNames;

        // ルートコンテナ
        this.container = document.createElement('div');
        this.container.classList.add('table-definition-editor');

        // ヘッダーセクション（テーブル名・説明）
        const header = document.createElement('div');
        header.classList.add('table-definition-header');

        // テーブル名ラベル + 入力
        const nameLabel = document.createElement('label');
        nameLabel.textContent = 'テーブル名';
        nameLabel.classList.add('table-definition-label');
        header.appendChild(nameLabel);

        this.nameInput = document.createElement('input');
        this.nameInput.type = 'text';
        this.nameInput.classList.add('table-definition-name-input');
        this.nameInput.placeholder = '例: weapon';
        header.appendChild(this.nameInput);

        this.nameError = document.createElement('span');
        this.nameError.classList.add('table-definition-name-error');
        header.appendChild(this.nameError);

        // 説明ラベル + 入力
        const descLabel = document.createElement('label');
        descLabel.textContent = '説明';
        descLabel.classList.add('table-definition-label');
        header.appendChild(descLabel);

        this.descInput = document.createElement('input');
        this.descInput.type = 'text';
        this.descInput.classList.add('table-definition-desc-input');
        this.descInput.placeholder = '例: 武器マスター';
        header.appendChild(this.descInput);

        this.container.appendChild(header);

        // 列定義セクション
        const columnsSection = document.createElement('div');
        columnsSection.classList.add('table-definition-columns');

        // 列ヘッダー
        const columnHeader = document.createElement('div');
        columnHeader.classList.add('table-definition-column-header');
        const colNameHeader = document.createElement('span');
        colNameHeader.textContent = '列名';
        const colTypeHeader = document.createElement('span');
        colTypeHeader.textContent = '型';
        const colPkHeader = document.createElement('span');
        colPkHeader.textContent = 'PK';
        const colDeleteHeader = document.createElement('span');
        colDeleteHeader.textContent = '';
        columnHeader.appendChild(colNameHeader);
        columnHeader.appendChild(colTypeHeader);
        columnHeader.appendChild(colPkHeader);
        columnHeader.appendChild(colDeleteHeader);
        columnsSection.appendChild(columnHeader);

        // 列行コンテナ（動的に列行を追加する）
        this.columnsContainer = document.createElement('div');
        this.columnsContainer.classList.add('table-definition-column-rows');
        columnsSection.appendChild(this.columnsContainer);

        // 初期列を1行追加する
        this.addColumnRow();

        // 列追加ボタン
        const addColumnButton = document.createElement('button');
        addColumnButton.classList.add('table-definition-add-column-button');
        addColumnButton.textContent = '+ 列を追加';
        addColumnButton.addEventListener('click', () => { this.addColumnRow(); });
        columnsSection.appendChild(addColumnButton);

        this.container.appendChild(columnsSection);

        // フッターセクション（保存ボタン）
        const footer = document.createElement('div');
        footer.classList.add('table-definition-footer');

        const saveButton = document.createElement('button');
        saveButton.classList.add('table-definition-save-button');
        saveButton.textContent = '保存';
        saveButton.addEventListener('click', () => { this.saveAsync().catch(e => { console.error('テーブル定義保存エラー', e); }); });
        footer.appendChild(saveButton);

        this.saveError = document.createElement('span');
        this.saveError.classList.add('table-definition-save-error');
        footer.appendChild(this.saveError);

        this.container.appendChild(footer);
    }

    /**
     * 親要素にエディタを追加する
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.container);
    }

    /**
     * 列行を1行追加する
     */
    private addColumnRow(): void {
        const row = document.createElement('div');
        row.classList.add('table-definition-column-row');

        // 列名入力
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.classList.add('column-name-input');
        nameInput.placeholder = '列名';
        row.appendChild(nameInput);

        // 型選択
        const typeSelect = document.createElement('select');
        typeSelect.classList.add('column-type-select');
        for (let i = 0; i < COLUMN_TYPES.length; i++) {
            const option = document.createElement('option');
            option.value = COLUMN_TYPES[i];
            option.textContent = COLUMN_TYPES[i];
            typeSelect.appendChild(option);
        }
        row.appendChild(typeSelect);

        // PKチェックボックス
        const pkCheckbox = document.createElement('input');
        pkCheckbox.type = 'checkbox';
        pkCheckbox.classList.add('column-pk-checkbox');
        row.appendChild(pkCheckbox);

        // 削除ボタン
        const deleteButton = document.createElement('button');
        deleteButton.classList.add('column-delete-button');
        deleteButton.textContent = '×';
        deleteButton.addEventListener('click', () => { row.remove(); });
        row.appendChild(deleteButton);

        this.columnsContainer.appendChild(row);
    }

    /**
     * バリデーションを実行し、エラーがあれば表示して false を返す
     */
    private validate(): boolean {
        // エラー表示をクリアする
        this.nameError.textContent = '';
        this.saveError.textContent = '';

        const tableName = this.nameInput.value.trim();

        // テーブル名: 空チェック
        if (tableName === '') {
            this.nameError.textContent = 'テーブル名を入力してください';
            return false;
        }

        // テーブル名: 文字パターンチェック
        if (!TABLE_NAME_PATTERN.test(tableName)) {
            this.nameError.textContent = '英数字とアンダースコアのみ使用できます';
            return false;
        }

        // テーブル名: 既存テーブルとの重複チェック
        if (this.existingTableNames.indexOf(tableName) !== -1) {
            this.nameError.textContent = '同名のテーブルが既に存在します';
            return false;
        }

        // 列定義の取得と検証
        const rows = this.columnsContainer.querySelectorAll('.table-definition-column-row');
        if (rows.length === 0) {
            this.saveError.textContent = '列を最低1つ追加してください';
            return false;
        }

        const columnNames: string[] = [];
        let hasPk = false;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const colName = (row.querySelector('.column-name-input') as HTMLInputElement).value.trim();

            // 列名: 空チェック
            if (colName === '') {
                this.saveError.textContent = `${i + 1}列目の列名を入力してください`;
                return false;
            }

            // 列名: 文字パターンチェック
            if (!COLUMN_NAME_PATTERN.test(colName)) {
                this.saveError.textContent = `${i + 1}列目の列名は英数字とアンダースコアのみ使用できます`;
                return false;
            }

            // 列名: 重複チェック
            if (columnNames.indexOf(colName) !== -1) {
                this.saveError.textContent = `列名「${colName}」が重複しています`;
                return false;
            }

            columnNames.push(colName);

            const pkChecked = (row.querySelector('.column-pk-checkbox') as HTMLInputElement).checked;
            if (pkChecked) hasPk = true;
        }

        // PK: 最低1列チェックされていること
        if (!hasPk) {
            this.saveError.textContent = 'プライマリキーを最低1列設定してください';
            return false;
        }

        return true;
    }

    /**
     * スキーマJSON + CSVヘッダーを生成してファイルに保存し、
     * テーブル定義タブを閉じて新テーブルをエクスプローラーに追加して通常タブで開く
     */
    private async saveAsync(): Promise<void> {
        if (!this.validate()) return;

        const tableName = this.nameInput.value.trim();
        const description = this.descInput.value.trim();

        // 列定義を収集する
        const rows = this.columnsContainer.querySelectorAll('.table-definition-column-row');
        const headerArray: Array<{ key: number; name: string; type: string }> = [];
        const primaryKeys: string[] = [];
        const columnNames: string[] = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const colName = (row.querySelector('.column-name-input') as HTMLInputElement).value.trim();
            const colType = (row.querySelector('.column-type-select') as HTMLSelectElement).value;
            const isPk = (row.querySelector('.column-pk-checkbox') as HTMLInputElement).checked;

            headerArray.push({ key: i, name: colName, type: colType });
            columnNames.push(colName);
            if (isPk) primaryKeys.push(colName);
        }

        // スキーマJSON生成
        const schema: Record<string, unknown> = {
            header: headerArray,
            primary_key: primaryKeys,
        };
        if (description !== '') {
            schema['description'] = description;
        }

        // ファイル書き込み
        await writeFileAsync('schema/' + tableName + '.json', JSON.stringify(schema, null, 2));
        await writeFileAsync('data/' + tableName + '.csv', columnNames.join(','));

        // テーブル定義タブを閉じ、新テーブルをエクスプローラーに追加して通常タブで開く
        this.tab.closeTableDefinitionAndOpenTable(tableName, description !== '' ? description : null);
    }
}
