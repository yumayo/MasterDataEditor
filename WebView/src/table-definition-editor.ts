/**
 * テーブル定義エディタ
 *
 * 責務:
 * - 新規テーブルのスキーマ定義UIを提供する（テーブル名、列名、型、PK指定）
 * - 既存テーブルのスキーマ定義を読み込み、列の追加・削除・リネーム・並び替えを行う
 * - バリデーション（テーブル名の重複・不正文字、列名重複、PK未設定）
 * - 保存時にスキーマJSON + CSVヘッダーを生成してファイルシステムに書き込む
 * - 編集モード時は既存CSVの列構造を同期する（列追加→空セル、列削除→列除去、列リネーム→ヘッダー更新）
 * - 列定義行のドラッグ並び替え（Undo対応）
 *
 * Tab から呼ばれて専用タブとしてエディター領域にマウントされる。
 * 設定タブ（SettingsPanel）・ER図タブ（ErDiagramTab）と同じパターン。
 */
import {readFileAsync, writeFileAsync} from "./api";
import type {Tab} from "./tab";

/** テーブル名の有効文字パターン: 英数字とアンダースコアのみ */
const TABLE_NAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/** 列名の有効文字パターン: 英数字とアンダースコアのみ */
const COLUMN_NAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/** 列の型選択肢 */
const COLUMN_TYPES = ['string', 'int', 'float', 'double', 'bool'] as const;

/** ドラッグ開始の閾値（px） */
const DRAG_THRESHOLD = 5;

/** 列ドラッグの Undo エントリ */
interface ColumnMoveEntry {
    readonly fromIndex: number;
    readonly toIndex: number;
}

/**
 * 既存テーブル編集時に渡す対象情報。
 * スキーマJSONから抽出した列定義とテーブルメタデータを保持する。
 */
export interface EditTarget {
    /** 編集対象のテーブル名 */
    readonly tableName: string;
    /** スキーマの説明文（なければ空文字） */
    readonly description: string;
    /** 既存の列定義（元の列名リスト。保存時のCSV差分検出に使用） */
    readonly columns: ReadonlyArray<EditTargetColumn>;
    /** 主キー列名の配列 */
    readonly primaryKeys: ReadonlyArray<string>;
}

/** EditTarget の列情報 */
export interface EditTargetColumn {
    readonly name: string;
    readonly type: string;
}

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
    /** ドラッグインジケーター要素（position:fixed でbodyに追加、ドラッグ中のみ表示） */
    private readonly indicator: HTMLElement;
    /** 列ドラッグの Undo スタック */
    private readonly undoStack: Array<ColumnMoveEntry>;
    /**
     * 編集モード時の元テーブル情報（false = 新規作成モード）
     * 保存時のCSV列同期とバリデーション（自テーブル名の重複除外）に使用する
     */
    private readonly editTarget: EditTarget | false;
    /** ドラッグ候補（mousedown後、閾値到達前の状態） */
    private isDragPending: boolean;
    /** ドラッグ中かどうか（閾値到達後） */
    private isDragging: boolean;
    /** mousedown 時点のY座標（閾値判定用） */
    private dragStartY: number;
    /** ドラッグ中の行要素 */
    private dragSourceRow: HTMLElement;
    /** document.mousemove バインド済みハンドラ */
    private readonly onDragMouseMove: (e: MouseEvent) => void;
    /** document.mouseup バインド済みハンドラ */
    private readonly onDragMouseUp: () => void;
    /** ドラッグ中に updateIndicatorPosition で計算された挿入先インデックス（mouseup 時に参照する） */
    private currentInsertIndex: number;

    constructor(tab: Tab, existingTableNames: ReadonlyArray<string>, editTarget: EditTarget | false) {
        this.tab = tab;
        this.existingTableNames = existingTableNames;
        this.editTarget = editTarget;
        this.undoStack = [];
        this.isDragPending = false;
        this.isDragging = false;
        this.dragStartY = 0;
        this.currentInsertIndex = 0;
        // dragSourceRow はドラッグ操作中のみ参照される。初期値としてダミー要素を設定し、メンバ変数nullを回避する
        this.dragSourceRow = document.createElement('div');

        // ドラッグインジケーター要素を生成（position:fixed でbodyに追加し、非表示で待機）
        this.indicator = document.createElement('div');
        this.indicator.classList.add('column-drag-indicator');
        this.indicator.style.display = 'none';
        document.body.appendChild(this.indicator);

        // document レベルのイベントハンドラをバインド
        this.onDragMouseMove = (e: MouseEvent) => { this.handleDragMouseMove(e.clientY); };
        this.onDragMouseUp = () => { this.handleDragMouseUp(); };

        // ルートコンテナ（tabIndex=0 でキーボードフォーカスを受け取れるようにする）
        this.container = document.createElement('div');
        this.container.classList.add('table-definition-editor');
        this.container.tabIndex = 0;
        // テーブル定義エディタ内の Ctrl+Z をキャプチャして Undo を実行する
        this.container.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === 'z' && this.undoStack.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                const entry = this.undoStack.pop() as ColumnMoveEntry;
                this.moveColumnRow(entry.toIndex, entry.fromIndex);
            }
        });

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

        // 列ヘッダー（ドラッグハンドル列用の空セルを先頭に追加）
        const columnHeader = document.createElement('div');
        columnHeader.classList.add('table-definition-column-header');
        const colDragHeader = document.createElement('span');
        colDragHeader.textContent = '';
        const colNameHeader = document.createElement('span');
        colNameHeader.textContent = '列名';
        const colTypeHeader = document.createElement('span');
        colTypeHeader.textContent = '型';
        const colPkHeader = document.createElement('span');
        colPkHeader.textContent = 'PK';
        const colDeleteHeader = document.createElement('span');
        colDeleteHeader.textContent = '';
        columnHeader.appendChild(colDragHeader);
        columnHeader.appendChild(colNameHeader);
        columnHeader.appendChild(colTypeHeader);
        columnHeader.appendChild(colPkHeader);
        columnHeader.appendChild(colDeleteHeader);
        columnsSection.appendChild(columnHeader);

        // 列行コンテナ（動的に列行を追加する）
        this.columnsContainer = document.createElement('div');
        this.columnsContainer.classList.add('table-definition-column-rows');
        columnsSection.appendChild(this.columnsContainer);

        // 編集モード: 既存列定義を反映する / 新規モード: 空の列を1行追加する
        if (editTarget !== false) {
            this.nameInput.value = editTarget.tableName;
            this.descInput.value = editTarget.description;
            for (let i = 0; i < editTarget.columns.length; i++) {
                const col = editTarget.columns[i];
                const row = this.addColumnRow();
                (row.querySelector('.column-name-input') as HTMLInputElement).value = col.name;
                (row.querySelector('.column-type-select') as HTMLSelectElement).value = col.type;
                // PKチェックボックス: 主キー配列に含まれていればチェックする
                if (editTarget.primaryKeys.indexOf(col.name) !== -1) {
                    (row.querySelector('.column-pk-checkbox') as HTMLInputElement).checked = true;
                }
                // 元の列名をdata属性に保持する（保存時のCSV列マッピングに使用）
                // リネームされた場合、inputのvalueは新しい名前だがこの属性は元の名前を保持するため
                // 元CSVの対応列を正しく特定できる
                row.dataset['originalColumnName'] = col.name;
            }
        } else {
            this.addColumnRow();
        }

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
     * エディタを破棄する。
     * タブクローズ時に呼ばれ、document レベルのイベントリスナーと
     * body 直下のインジケーター要素を除去する（DOMリーク防止）。
     */
    destroy(): void {
        document.removeEventListener('mousemove', this.onDragMouseMove);
        document.removeEventListener('mouseup', this.onDragMouseUp);
        if (this.isDragging || this.isDragPending) {
            document.body.style.cursor = '';
            this.indicator.style.display = 'none';
        }
        this.indicator.remove();
    }

    /**
     * 列行を1行追加し、追加した行要素を返す。
     * ボタンクリック時と、編集モードの初期化で複数回呼ばれる。
     */
    private addColumnRow(): HTMLElement {
        const row = document.createElement('div');
        row.classList.add('table-definition-column-row');

        // ドラッグハンドル（先頭に配置）
        const dragHandle = document.createElement('div');
        dragHandle.classList.add('column-drag-handle');
        dragHandle.textContent = '\u283f'; // ⠿ グリップアイコン
        dragHandle.title = 'ドラッグで並び替え';
        dragHandle.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            this.startDrag(row, e.clientY);
        });
        row.appendChild(dragHandle);

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
        deleteButton.textContent = '\u00d7'; // ×
        deleteButton.addEventListener('click', () => { row.remove(); });
        row.appendChild(deleteButton);

        this.columnsContainer.appendChild(row);
        return row;
    }

    /**
     * ドラッグ操作を開始する（mousedownハンドラから呼ばれる）
     */
    private startDrag(row: HTMLElement, clientY: number): void {
        this.dragSourceRow = row;
        this.dragStartY = clientY;
        this.isDragPending = true;
        this.isDragging = false;
        document.addEventListener('mousemove', this.onDragMouseMove);
        document.addEventListener('mouseup', this.onDragMouseUp);
    }

    /**
     * ドラッグ中のmousemoveハンドラ
     * 閾値を超えたらドラッグを開始し、インジケーターを表示・更新する
     */
    private handleDragMouseMove(clientY: number): void {
        if (this.isDragPending) {
            if (Math.abs(clientY - this.dragStartY) < DRAG_THRESHOLD) return;
            // 閾値到達: ドラッグ開始
            this.isDragPending = false;
            this.isDragging = true;
            this.dragSourceRow.classList.add('column-dragging');
            this.indicator.style.display = '';
            document.body.style.cursor = 'grabbing';
        }
        if (!this.isDragging) return;
        this.updateIndicatorPosition(clientY);
    }

    /**
     * ドラッグ終了のmouseupハンドラ
     * インジケーター位置に基づいて列行を移動し、Undoスタックに記録する
     */
    private handleDragMouseUp(): void {
        document.removeEventListener('mousemove', this.onDragMouseMove);
        document.removeEventListener('mouseup', this.onDragMouseUp);
        document.body.style.cursor = '';
        this.indicator.style.display = 'none';
        if (this.isDragging) {
            this.isDragging = false;
            this.dragSourceRow.classList.remove('column-dragging');
            // 移動元のインデックスを算出する
            const rows = this.columnsContainer.children;
            let fromIndex = 0;
            for (let i = 0; i < rows.length; i++) {
                if (rows[i] === this.dragSourceRow) { fromIndex = i; break; }
            }
            // updateIndicatorPosition で計算済みの挿入先インデックスを使う
            const toIndex = this.currentInsertIndex;
            // 移動元と挿入先が異なる場合のみ移動する
            if (fromIndex !== toIndex) {
                this.moveColumnRow(fromIndex, toIndex);
                this.undoStack.push({ fromIndex, toIndex });
            }
        }
        this.isDragPending = false;
        // ドラッグ完了後、コンテナにフォーカスを移す（Ctrl+Z Undo を受け取るため）
        this.container.focus();
    }

    /**
     * マウスY座標から挿入先を計算し、インジケーターを配置する。
     * 同時に currentInsertIndex を更新する（mouseup 時に参照される）。
     *
     * インジケーターは position:fixed なので、ビューポート座標をそのまま top に設定する。
     * left/width はコンテナの水平範囲と一致させる。
     *
     * currentInsertIndex は「fromを抜いた後のインデックス」として計算する
     * （row-drag-controller.ts と同じロジック）。
     */
    private updateIndicatorPosition(clientY: number): void {
        const rows = this.columnsContainer.children;
        const containerRect = this.columnsContainer.getBoundingClientRect();
        this.indicator.style.left = containerRect.left + 'px';
        this.indicator.style.width = containerRect.width + 'px';
        // 各行の矩形を走査して、マウス位置に最も近い行間を特定する
        let fromIndex = 0;
        for (let i = 0; i < rows.length; i++) {
            if (rows[i] === this.dragSourceRow) { fromIndex = i; break; }
        }
        let insertIndex = 0;
        for (let i = 0; i < rows.length; i++) {
            const rowElement = rows[i] as HTMLElement;
            const rect = rowElement.getBoundingClientRect();
            const rowMidY = rect.top + rect.height / 2;
            if (clientY > rowMidY) {
                insertIndex = i + 1;
            }
        }
        // インジケーターの top 位置をビューポート座標で設定する
        let indicatorTop: number;
        if (insertIndex < rows.length) {
            const targetRow = rows[insertIndex] as HTMLElement;
            indicatorTop = targetRow.getBoundingClientRect().top;
        } else {
            // 最終行の下端
            const lastRow = rows[rows.length - 1] as HTMLElement;
            indicatorTop = lastRow.getBoundingClientRect().bottom;
        }
        this.indicator.style.top = indicatorTop + 'px';
        // fromを抜いた後のインデックスに変換して保存する（mouseup 時に参照）
        this.currentInsertIndex = insertIndex > fromIndex ? insertIndex - 1 : insertIndex;
    }

    /**
     * 列行を fromIndex から toIndex へ移動する（DOM操作のみ）
     *
     * Undo時は逆向き（toIndex → fromIndex）で呼ばれる。
     */
    private moveColumnRow(fromIndex: number, toIndex: number): void {
        const rows = this.columnsContainer.children;
        const sourceRow = rows[fromIndex] as HTMLElement;
        // fromIndex の行を一旦除去する（除去後は後続のインデックスが1つ詰まる）
        this.columnsContainer.removeChild(sourceRow);
        // toIndex の位置に挿入する
        if (toIndex >= this.columnsContainer.children.length) {
            this.columnsContainer.appendChild(sourceRow);
        } else {
            this.columnsContainer.insertBefore(sourceRow, this.columnsContainer.children[toIndex]);
        }
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
        // 編集モードでは自テーブル名は重複対象から除外する（名前を変えなければ重複ではない）
        const isOwnName = this.editTarget !== false && tableName === this.editTarget.tableName;
        if (!isOwnName && this.existingTableNames.indexOf(tableName) !== -1) {
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
     * スキーマJSON + CSVを保存する。
     * 新規モードではCSVヘッダーのみ生成、編集モードでは既存CSVの列構造を同期する。
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

        // スキーマJSONオブジェクトを組み立てる
        const schema: Record<string, unknown> = {
            header: headerArray,
            primary_key: primaryKeys,
        };
        if (description !== '') {
            schema['description'] = description;
        }

        if (this.editTarget !== false) {
            // 編集モード: 既存CSVの列構造を同期して保存する
            await this.saveEditModeAsync(this.editTarget, tableName, schema, columnNames);
        } else {
            // 新規モード: スキーマJSON + 空CSVヘッダーを保存する
            await writeFileAsync('schema/' + tableName + '.json', JSON.stringify(schema, null, 2));
            await writeFileAsync('data/' + tableName + '.csv', columnNames.join(','));
            this.tab.closeTableDefinitionAndOpenTable(tableName, description !== '' ? description : null);
        }
    }

    /**
     * 編集モードの保存処理。
     * 既存CSVを読み込み、元スキーマとの列差分に基づいてCSV列構造を同期する。
     *
     * 列マッピングの戦略:
     * - 各列行DOMの data-original-column-name 属性で元CSVの列名を特定する
     * - この属性が存在する列 → 既存列（リネームされていてもデータをコピー）
     * - この属性が存在しない列 → 新規追加列（空セル）
     * - 元にあって現在のDOMにない列 → 削除列（CSVから除去）
     *
     * これにより列の追加・削除・リネーム・並び替えを一括で処理できる。
     *
     * @param editTarget 編集対象のテーブル情報（saveAsync の if 分岐で editTarget !== false が確定済み）
     */
    private async saveEditModeAsync(
        editTarget: EditTarget,
        tableName: string,
        schema: Record<string, unknown>,
        newColumnNames: string[]
    ): Promise<void> {
        const originalTableName = editTarget.tableName;
        const originalColumns = editTarget.columns;

        // 既存CSVを読み込む
        const csvContent = await readFileAsync('data/' + originalTableName + '.csv');
        // CRLF/LF 両方に対応する（プロジェクトの改行コードはCRLFだが、モックテスト等ではLFの場合もある）
        const csvLines = csvContent.split(/\r?\n/).filter(line => line.trim() !== '');

        // 元の列名リスト（元スキーマから取得。CSVヘッダー行のインデックスと対応する）
        const originalColumnNames = originalColumns.map(c => c.name);

        // DOM列行から元の列名マッピングを構築する
        // columnMappings[i] = 新しいi番目の列に対応する元CSVの列インデックス（-1 = 新規列）
        const columnRows = this.columnsContainer.querySelectorAll('.table-definition-column-row');
        const columnMappings: number[] = [];
        for (let i = 0; i < columnRows.length; i++) {
            const row = columnRows[i] as HTMLElement;
            if ('originalColumnName' in row.dataset) {
                // 既存列: data-original-column-name 属性から元のCSV列名を取得する
                const originalName = row.dataset['originalColumnName'] as string;
                const originalIndex = originalColumnNames.indexOf(originalName);
                columnMappings.push(originalIndex);
            } else {
                // 新規追加列: 元CSVに対応列なし
                columnMappings.push(-1);
            }
        }

        // 新しい列順に基づいてCSVを再構築する
        const newCsvLines: string[] = [];

        // ヘッダー行: 新しい列名リスト
        newCsvLines.push(newColumnNames.join(','));

        // データ行: 元のCSVデータを新しい列順で再構築する
        for (let lineIndex = 1; lineIndex < csvLines.length; lineIndex++) {
            const cells = csvLines[lineIndex].split(',');
            const newCells: string[] = [];
            for (let colIndex = 0; colIndex < columnMappings.length; colIndex++) {
                const originalIndex = columnMappings[colIndex];
                if (originalIndex !== -1 && originalIndex < cells.length) {
                    // 既存列（リネーム含む）: 元のデータをコピー
                    newCells.push(cells[originalIndex]);
                } else {
                    // 新規列: 空セル
                    newCells.push('');
                }
            }
            newCsvLines.push(newCells.join(','));
        }

        // スキーマとCSVを保存する
        await writeFileAsync('schema/' + tableName + '.json', JSON.stringify(schema, null, 2));
        await writeFileAsync('data/' + tableName + '.csv', newCsvLines.join('\n'));

        // テーブル定義タブを閉じてテーブルを再オープンする
        // description が空文字の場合は null として渡す（新規作成の saveAsync と同じ規約）
        const description = this.descInput.value.trim();
        this.tab.closeTableDefinitionAndReopenTable(tableName, description !== '' ? description : null);
    }
}
