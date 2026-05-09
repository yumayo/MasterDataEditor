/**
 * テーブル定義エディタ
 *
 * 責務:
 * - 新規テーブルのスキーマ定義UIを提供する（テーブル名、列名、型、PK指定）
 * - 既存テーブルのスキーマ定義を読み込み、列の追加・削除・リネーム・並び替えを行う
 * - バリデーション（テーブル名の重複・不正文字、列名重複、PK未設定、参照形式、数値妥当性）
 * - 保存時にスキーマJSON + CSVヘッダーを生成してファイルシステムに書き込む
 * - 編集モード時は既存CSVの列構造を同期する（列追加→空セル、列削除→列除去、列リネーム→ヘッダー更新）
 * - 列定義行のドラッグ並び替え（Undo対応）
 *
 * Tab から呼ばれて専用タブとしてエディター領域にマウントされる。
 * 設定タブ（SettingsPanel）・ER図タブ（ErDiagramTab）と同じパターン。
 */
import {readFileAsync, writeFileAsync} from "../app/api";
import {Csv} from "../data/csv";
import type {Tab} from "./tab";

/** テーブル名の有効文字パターン: 英数字とアンダースコアのみ */
const TABLE_NAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/** 列名の有効文字パターン: 英数字とアンダースコアのみ */
const COLUMN_NAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/** 単純参照の形式パターン: テーブル名.列名（英数字とアンダースコア） */
const SIMPLE_REFERENCE_PATTERN = /^[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+$/;

/** 列の型選択肢 */
const COLUMN_TYPES = ['string', 'int', 'float', 'double', 'bool'] as const;

/** ドラッグ開始の閾値（px） */
const DRAG_THRESHOLD = 5;

/** ラジオボタンname属性のインクリメンタルカウンタ（一意性保証用） */
let radioGroupCounter = 0;

/** 列ドラッグの Undo エントリ */
interface ColumnMoveEntry {
    readonly fromIndex: number;
    readonly toIndex: number;
}

/** 動的参照フィールド定義（CSSクラス名とプレースホルダーのペア） */
const DYNAMIC_FIELD_DEFS: ReadonlyArray<{ cls: string; ph: string }> = [
    { cls: 'column-ref-dynamic-source-table', ph: '参照元テーブル名' },
    { cls: 'column-ref-dynamic-source-match-column', ph: '参照元テーブルの照合列' },
    { cls: 'column-ref-dynamic-source-match-value', ph: '自テーブルの照合列' },
    { cls: 'column-ref-dynamic-dest-table', ph: '参照先テーブル名' },
    { cls: 'column-ref-dynamic-dest-column', ph: '参照先列名' },
];

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
    /** 逆参照優先度（スキーマルートに存在する場合。なければ null） */
    readonly reverseReferencePriority: number | null;
}

/** EditTarget の列情報 */
export interface EditTargetColumn {
    readonly name: string;
    readonly type: string;
    /**
     * 元スキーマJSONの列定義オブジェクト全体を保持する。
     * 保存時に reference, comment, default, width, renderAsHtml 等のフィールドを引き継ぐために使用する。
     * key/name/type は UI 側の値で上書きされるため、それ以外のフィールドを復元する目的。
     */
    readonly originalSchema: Record<string, unknown>;
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
    /** reverseReferencePriority入力欄（詳細オプションセクション内） */
    private readonly reverseRefPriorityInput: HTMLInputElement;
    /** 詳細オプションセクション要素（reverseReferencePriority の初期値展開に使用） */
    private readonly advancedSection: HTMLElement;
    /** 詳細オプショントグルボタン要素（セクション展開状態と連動） */
    private readonly advancedToggle: HTMLButtonElement;

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
        this.nameInput.classList.add('table-definition-name-input', 'table-definition-text-input');
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
        this.descInput.classList.add('table-definition-desc-input', 'table-definition-text-input');
        this.descInput.placeholder = '例: 武器マスター';
        header.appendChild(this.descInput);

        // 詳細オプショントグル + 詳細セクション（reverseReferencePriority）
        this.advancedToggle = document.createElement('button');
        this.advancedToggle.classList.add('table-definition-advanced-toggle');
        this.advancedToggle.textContent = '▶ 詳細オプション';
        header.appendChild(this.advancedToggle);

        this.advancedSection = document.createElement('div');
        this.advancedSection.classList.add('table-definition-advanced-section');
        this.advancedSection.style.display = 'none';
        const rrpLabel = document.createElement('label');
        rrpLabel.textContent = '逆参照優先度';
        rrpLabel.classList.add('table-definition-label');
        this.advancedSection.appendChild(rrpLabel);
        this.reverseRefPriorityInput = document.createElement('input');
        this.reverseRefPriorityInput.type = 'number';
        this.reverseRefPriorityInput.classList.add('table-definition-reverse-ref-priority-input', 'table-definition-text-input');
        this.reverseRefPriorityInput.placeholder = '例: 1';
        this.advancedSection.appendChild(this.reverseRefPriorityInput);
        header.appendChild(this.advancedSection);

        this.advancedToggle.addEventListener('click', () => {
            const isHidden = this.advancedSection.style.display === 'none';
            this.advancedSection.style.display = isHidden ? '' : 'none';
            this.advancedToggle.textContent = isHidden ? '▼ 詳細オプション' : '▶ 詳細オプション';
        });

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
        const colCommentHeader = document.createElement('span');
        colCommentHeader.textContent = 'コメント';
        const colWidthHeader = document.createElement('span');
        colWidthHeader.textContent = '幅';
        const colDetailHeader = document.createElement('span');
        colDetailHeader.textContent = '';
        const colDeleteHeader = document.createElement('span');
        colDeleteHeader.textContent = '';
        columnHeader.appendChild(colDragHeader);
        columnHeader.appendChild(colNameHeader);
        columnHeader.appendChild(colTypeHeader);
        columnHeader.appendChild(colPkHeader);
        columnHeader.appendChild(colCommentHeader);
        columnHeader.appendChild(colWidthHeader);
        columnHeader.appendChild(colDetailHeader);
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
            // reverseReferencePriority の初期値を反映する（値がある場合は詳細セクションも展開する）
            if (editTarget.reverseReferencePriority !== null) {
                this.reverseRefPriorityInput.value = String(editTarget.reverseReferencePriority);
                this.advancedSection.style.display = '';
                this.advancedToggle.textContent = '▼ 詳細オプション';
            }
            for (let i = 0; i < editTarget.columns.length; i++) {
                const col = editTarget.columns[i];
                const row = this.addColumnRow();
                (row.querySelector('.column-name-input') as HTMLInputElement).value = col.name;
                (row.querySelector('.column-type-select') as HTMLSelectElement).value = col.type;
                // PKチェックボックス: 主キー配列に含まれていればチェックする
                if (editTarget.primaryKeys.indexOf(col.name) !== -1) {
                    (row.querySelector('.column-pk-checkbox') as HTMLInputElement).checked = true;
                }
                // 元スキーマから comment/width/reference/default/renderAsHtml を反映する
                this.applyOriginalSchemaToRow(row, col.originalSchema);
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
        nameInput.classList.add('column-name-input', 'table-definition-text-input');
        nameInput.placeholder = '列名';
        row.appendChild(nameInput);

        // 型選択
        const typeSelect = document.createElement('select');
        typeSelect.classList.add('column-type-select', 'table-definition-text-input');
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

        // コメント入力
        const commentInput = document.createElement('input');
        commentInput.type = 'text';
        commentInput.classList.add('column-comment-input', 'table-definition-text-input');
        commentInput.placeholder = 'コメント';
        row.appendChild(commentInput);

        // 幅入力
        const widthInput = document.createElement('input');
        widthInput.type = 'number';
        widthInput.classList.add('column-width-input', 'table-definition-text-input');
        widthInput.placeholder = '100';
        row.appendChild(widthInput);

        // 詳細トグルボタン
        const detailToggle = document.createElement('button');
        detailToggle.classList.add('column-detail-toggle');
        detailToggle.textContent = '▼';
        row.appendChild(detailToggle);

        // 削除ボタン
        const deleteButton = document.createElement('button');
        deleteButton.classList.add('column-delete-button');
        deleteButton.textContent = '\u00d7'; // ×
        deleteButton.addEventListener('click', () => { row.remove(); });
        row.appendChild(deleteButton);

        // 詳細展開パネル（列行のgridの外にフルスパンで配置）
        const detailPanel = document.createElement('div');
        detailPanel.classList.add('column-detail-panel');
        detailPanel.style.display = 'none';

        // 参照タイプラジオグループ（インクリメンタルカウンタで一意なname属性を生成する）
        const refTypeGroup = document.createElement('div');
        refTypeGroup.classList.add('column-ref-type-group');
        const radioName = 'ref-type-' + (radioGroupCounter++);

        // 参照なしラジオ（label でラップしてラベルクリックでも選択可能にする）
        const refNoneLabel = document.createElement('label');
        refNoneLabel.classList.add('column-ref-label');
        const refNoneRadio = document.createElement('input');
        refNoneRadio.type = 'radio';
        refNoneRadio.name = radioName;
        refNoneRadio.classList.add('column-ref-type-none');
        refNoneRadio.checked = true;
        refNoneLabel.appendChild(refNoneRadio);
        refNoneLabel.appendChild(document.createTextNode('参照なし'));
        refTypeGroup.appendChild(refNoneLabel);

        // 単純参照ラジオ
        const refSimpleLabel = document.createElement('label');
        refSimpleLabel.classList.add('column-ref-label');
        const refSimpleRadio = document.createElement('input');
        refSimpleRadio.type = 'radio';
        refSimpleRadio.name = radioName;
        refSimpleRadio.classList.add('column-ref-type-simple');
        refSimpleLabel.appendChild(refSimpleRadio);
        refSimpleLabel.appendChild(document.createTextNode('単純参照'));
        refTypeGroup.appendChild(refSimpleLabel);

        // 動的参照ラジオ
        const refDynamicLabel = document.createElement('label');
        refDynamicLabel.classList.add('column-ref-label');
        const refDynamicRadio = document.createElement('input');
        refDynamicRadio.type = 'radio';
        refDynamicRadio.name = radioName;
        refDynamicRadio.classList.add('column-ref-type-dynamic');
        refDynamicLabel.appendChild(refDynamicRadio);
        refDynamicLabel.appendChild(document.createTextNode('動的参照'));
        refTypeGroup.appendChild(refDynamicLabel);
        detailPanel.appendChild(refTypeGroup);

        // 単純参照入力（初期非表示）
        const refSimpleInput = document.createElement('input');
        refSimpleInput.type = 'text';
        refSimpleInput.classList.add('column-ref-simple-input', 'table-definition-text-input');
        refSimpleInput.placeholder = '例: table.column';
        refSimpleInput.style.display = 'none';
        detailPanel.appendChild(refSimpleInput);

        // 動的参照フィールド群（初期非表示）
        const refDynamicFields = document.createElement('div');
        refDynamicFields.classList.add('column-ref-dynamic-fields');
        refDynamicFields.style.display = 'none';
        for (let di = 0; di < DYNAMIC_FIELD_DEFS.length; di++) {
            const def = DYNAMIC_FIELD_DEFS[di];
            const input = document.createElement('input');
            input.type = 'text';
            input.classList.add(def.cls, 'table-definition-text-input');
            input.placeholder = def.ph;
            refDynamicFields.appendChild(input);
        }
        detailPanel.appendChild(refDynamicFields);

        // ラジオボタンの変更で単純参照/動的参照フィールドの表示を切り替える
        const updateRefVisibility = () => {
            refSimpleInput.style.display = refSimpleRadio.checked ? '' : 'none';
            refDynamicFields.style.display = refDynamicRadio.checked ? '' : 'none';
        };
        refNoneRadio.addEventListener('change', updateRefVisibility);
        refSimpleRadio.addEventListener('change', updateRefVisibility);
        refDynamicRadio.addEventListener('change', updateRefVisibility);

        // デフォルト値入力
        const defaultInput = document.createElement('input');
        defaultInput.type = 'text';
        defaultInput.classList.add('column-default-input', 'table-definition-text-input');
        defaultInput.placeholder = 'デフォルト値';
        detailPanel.appendChild(defaultInput);

        // renderAsHtmlチェックボックス（label でラップしてラベルクリックでも選択可能にする）
        const renderHtmlWrapper = document.createElement('div');
        renderHtmlWrapper.classList.add('column-render-html-wrapper');
        const renderHtmlLabel = document.createElement('label');
        const renderHtmlCheckbox = document.createElement('input');
        renderHtmlCheckbox.type = 'checkbox';
        renderHtmlCheckbox.classList.add('column-render-html-checkbox');
        renderHtmlLabel.appendChild(renderHtmlCheckbox);
        renderHtmlLabel.appendChild(document.createTextNode('HTMLとして描画'));
        renderHtmlWrapper.appendChild(renderHtmlLabel);
        detailPanel.appendChild(renderHtmlWrapper);

        row.appendChild(detailPanel);

        // 詳細トグルのクリックでパネルを開閉する
        detailToggle.addEventListener('click', () => {
            const isHidden = detailPanel.style.display === 'none';
            detailPanel.style.display = isHidden ? '' : 'none';
            detailToggle.textContent = isHidden ? '▲' : '▼';
        });

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
     * バリデーションを実行し、エラーがあれば表示して false を返す。
     * テーブル名、列名、PK設定、参照形式、数値妥当性を検証する。
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

            // 参照バリデーション（各列ごとに検証する）
            const refSimpleRadio = row.querySelector('.column-ref-type-simple') as HTMLInputElement;
            const refDynamicRadio = row.querySelector('.column-ref-type-dynamic') as HTMLInputElement;
            if (refSimpleRadio.checked) {
                // 単純参照: 入力値の存在チェックと形式チェック
                const refVal = (row.querySelector('.column-ref-simple-input') as HTMLInputElement).value.trim();
                if (refVal === '') {
                    this.saveError.textContent = `${i + 1}列目の参照先を入力してください`;
                    return false;
                }
                if (!SIMPLE_REFERENCE_PATTERN.test(refVal)) {
                    this.saveError.textContent = `${i + 1}列目の参照先は「テーブル名.列名」形式で入力してください`;
                    return false;
                }
            } else if (refDynamicRadio.checked) {
                // 動的参照: 5フィールドすべてが非空であることを検証する
                for (let di = 0; di < DYNAMIC_FIELD_DEFS.length; di++) {
                    const fieldVal = (row.querySelector('.' + DYNAMIC_FIELD_DEFS[di].cls) as HTMLInputElement).value.trim();
                    if (fieldVal === '') {
                        this.saveError.textContent = `${i + 1}列目の動的参照「${DYNAMIC_FIELD_DEFS[di].ph}」を入力してください`;
                        return false;
                    }
                }
            }

            // width バリデーション（入力されている場合のみ）
            const widthStr = (row.querySelector('.column-width-input') as HTMLInputElement).value.trim();
            if (widthStr !== '') {
                const widthNum = Number(widthStr);
                if (!Number.isInteger(widthNum) || widthNum <= 0) {
                    this.saveError.textContent = `${i + 1}列目の幅は正の整数で入力してください`;
                    return false;
                }
            }
        }

        // PK: 最低1列チェックされていること
        if (!hasPk) {
            this.saveError.textContent = 'プライマリキーを最低1列設定してください';
            return false;
        }

        // reverseReferencePriority バリデーション（入力されている場合のみ）
        const rrpStr = this.reverseRefPriorityInput.value.trim();
        if (rrpStr !== '') {
            const rrpNum = Number(rrpStr);
            if (!Number.isInteger(rrpNum) || rrpNum <= 0) {
                this.saveError.textContent = '逆参照優先度は正の整数で入力してください';
                return false;
            }
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
        const columnRows = this.columnsContainer.querySelectorAll('.table-definition-column-row');
        const primaryKeys: string[] = [];
        const columnNames: string[] = [];
        for (let i = 0; i < columnRows.length; i++) {
            const row = columnRows[i];
            const colName = (row.querySelector('.column-name-input') as HTMLInputElement).value.trim();
            const isPk = (row.querySelector('.column-pk-checkbox') as HTMLInputElement).checked;
            columnNames.push(colName);
            if (isPk) primaryKeys.push(colName);
        }

        if (this.editTarget !== false) {
            // 編集モード: 元スキーマのメタデータを引き継いでheader配列を組み立てる
            await this.saveEditModeAsync(this.editTarget, tableName, description, primaryKeys, columnNames, columnRows);
        } else {
            // 新規モード: UI入力値を含む完全なheader配列を組み立てる
            const headerArray: Array<Record<string, unknown>> = [];
            for (let i = 0; i < columnRows.length; i++) {
                const row = columnRows[i] as HTMLElement;
                const colName = (row.querySelector('.column-name-input') as HTMLInputElement).value.trim();
                const colType = (row.querySelector('.column-type-select') as HTMLSelectElement).value;
                const entry: Record<string, unknown> = { key: i, name: colName, type: colType };
                this.applyColumnExtrasToEntry(row, entry);
                headerArray.push(entry);
            }
            const schema: Record<string, unknown> = { header: headerArray, primary_key: primaryKeys };
            if (description !== '') schema['description'] = description;
            this.applyReverseRefPriorityToSchema(schema);
            await writeFileAsync('schema/' + tableName + '.json', schema);
            await writeFileAsync('data/' + tableName + '.csv', columnNames.join(','));
            this.tab.closeTableDefinitionAndOpenTable(tableName, description !== '' ? description : null);
        }
    }

    /**
     * 編集モードの保存処理。
     * 既存CSVを Csv クラス（RFC4180準拠）で読み込み、元スキーマとの列差分に基づいてCSV列構造を同期する。
     * スキーマJSONは元列定義の reference, comment, default, width, renderAsHtml 等のメタデータを引き継ぐ。
     *
     * 列マッピングの戦略:
     * - 各列行DOMの data-original-column-name 属性で元CSVの列名を特定する
     * - この属性が存在する列 → 既存列（リネームされていてもデータをコピー、メタデータも引き継ぐ）
     * - この属性が存在しない列 → 新規追加列（空セル、メタデータはデフォルト）
     * - 元にあって現在のDOMにない列 → 削除列（CSVから除去）
     *
     * これにより列の追加・削除・リネーム・並び替えを一括で処理できる。
     *
     * @param editTarget 編集対象のテーブル情報（saveAsync の if 分岐で editTarget !== false が確定済み）
     */
    private async saveEditModeAsync(
        editTarget: EditTarget,
        tableName: string,
        description: string,
        primaryKeys: string[],
        newColumnNames: string[],
        columnRows: NodeListOf<Element>
    ): Promise<void> {
        const originalTableName = editTarget.tableName;
        const originalColumns = editTarget.columns;

        // 既存CSVを RFC4180準拠の Csv クラスで読み込む（カンマ・クォート含むフィールドに対応）
        const csvContent = await readFileAsync('data/' + originalTableName + '.csv');
        const csv = new Csv();
        csv.load(csvContent);

        // 元の列名リスト（元スキーマから取得。CSVヘッダー行のインデックスと対応する）
        const originalColumnNames = originalColumns.map(c => c.name);

        // 元列名 → EditTargetColumn のマップを構築する（メタデータ引き継ぎ用）
        const originalColumnMap = new Map<string, EditTargetColumn>();
        for (let i = 0; i < originalColumns.length; i++) {
            originalColumnMap.set(originalColumns[i].name, originalColumns[i]);
        }

        // DOM列行から列マッピングとスキーマheader配列を構築する
        // columnMappings[i] = 新しいi番目の列に対応する元CSVの列インデックス（-1 = 新規列）
        const columnMappings: number[] = [];
        const headerArray: Array<Record<string, unknown>> = [];
        for (let i = 0; i < columnRows.length; i++) {
            const row = columnRows[i] as HTMLElement;
            const colName = (row.querySelector('.column-name-input') as HTMLInputElement).value.trim();
            const colType = (row.querySelector('.column-type-select') as HTMLSelectElement).value;

            if ('originalColumnName' in row.dataset) {
                // 既存列: 元スキーマのメタデータを引き継いでheaderエントリを組み立てる
                const originalName = row.dataset['originalColumnName'] as string;
                const originalIndex = originalColumnNames.indexOf(originalName);
                columnMappings.push(originalIndex);
                // 元スキーマに列が必ず存在することを前提とする（data-original-column-nameが設定されている以上、元の列定義から生成されたため）
                const originalCol = originalColumnMap.get(originalName);
                if (!originalCol) throw new Error(`元スキーマに列 "${originalName}" が見つかりません`);
                // 元列の全フィールドをベースにし、key/name/type を上書きし、さらにUI入力値で追加プロパティを上書きする
                const entry: Record<string, unknown> = { ...originalCol.originalSchema, key: i, name: colName, type: colType };
                this.applyColumnExtrasToEntry(row, entry);
                headerArray.push(entry);
            } else {
                // 新規追加列: 元CSVに対応列なし
                columnMappings.push(-1);
                const entry: Record<string, unknown> = { key: i, name: colName, type: colType };
                this.applyColumnExtrasToEntry(row, entry);
                headerArray.push(entry);
            }
        }

        // スキーマJSONオブジェクトを組み立てる（元列メタデータ引き継ぎ済みのheaderを使用）
        const schema: Record<string, unknown> = { header: headerArray, primary_key: primaryKeys };
        if (description !== '') schema['description'] = description;
        this.applyReverseRefPriorityToSchema(schema);

        // 新しい列順に基づいてCSVを再構築する（Csv クラスで RFC4180準拠のシリアライズ）
        const newCsv = new Csv();
        newCsv.header = newColumnNames;
        const newBody: string[][] = [];
        for (let rowIndex = 0; rowIndex < csv.body.length; rowIndex++) {
            const originalRow = csv.body[rowIndex];
            const newRow: string[] = [];
            for (let colIndex = 0; colIndex < columnMappings.length; colIndex++) {
                const originalIndex = columnMappings[colIndex];
                if (originalIndex !== -1 && originalIndex < originalRow.length) {
                    // 既存列（リネーム含む）: 元のデータをコピー
                    newRow.push(originalRow[originalIndex]);
                } else {
                    // 新規列: 空セル
                    newRow.push('');
                }
            }
            newBody.push(newRow);
        }
        newCsv.body = newBody;

        // スキーマとCSVを保存する
        await writeFileAsync('schema/' + tableName + '.json', schema);
        // Csv.toString() は末尾に改行を付与する。データ行がない場合はヘッダーのみ出力する。
        // 元の保存形式と合わせるため、末尾改行を除去する
        const csvString = newCsv.toString().replace(/\n$/, '');
        await writeFileAsync('data/' + tableName + '.csv', csvString);

        // テーブル定義タブを閉じてテーブルを再オープンする
        // description が空文字の場合は null として渡す（新規作成の saveAsync と同じ規約）
        this.tab.closeTableDefinitionAndReopenTable(tableName, description !== '' ? description : null);
    }

    /**
     * 列行のDOMからcomment/width/reference/default/renderAsHtmlを読み取り、
     * header配列のエントリに設定する。空値のプロパティはdelete演算子で除去しスキーマを汚染しない。
     * 新規モード・編集モードの両方で共通利用する。
     */
    private applyColumnExtrasToEntry(row: HTMLElement, entry: Record<string, unknown>): void {
        // comment
        const commentVal = (row.querySelector('.column-comment-input') as HTMLInputElement).value.trim();
        if (commentVal !== '') { entry['comment'] = commentVal; } else { delete entry['comment']; }

        // width
        const widthStr = (row.querySelector('.column-width-input') as HTMLInputElement).value.trim();
        if (widthStr !== '') { entry['width'] = Number(widthStr); } else { delete entry['width']; }

        // reference（詳細パネル内のラジオボタンで参照タイプを判定する）
        const refSimpleRadio = row.querySelector('.column-ref-type-simple') as HTMLInputElement;
        const refDynamicRadio = row.querySelector('.column-ref-type-dynamic') as HTMLInputElement;
        if (refSimpleRadio.checked) {
            const refVal = (row.querySelector('.column-ref-simple-input') as HTMLInputElement).value.trim();
            if (refVal !== '') { entry['reference'] = refVal; } else { delete entry['reference']; }
        } else if (refDynamicRadio.checked) {
            const srcTable = (row.querySelector('.column-ref-dynamic-source-table') as HTMLInputElement).value.trim();
            const srcMatchCol = (row.querySelector('.column-ref-dynamic-source-match-column') as HTMLInputElement).value.trim();
            const srcMatchVal = (row.querySelector('.column-ref-dynamic-source-match-value') as HTMLInputElement).value.trim();
            const destTable = (row.querySelector('.column-ref-dynamic-dest-table') as HTMLInputElement).value.trim();
            const destCol = (row.querySelector('.column-ref-dynamic-dest-column') as HTMLInputElement).value.trim();
            entry['reference'] = { sourceTable: srcTable, sourceMatchColumn: srcMatchCol, sourceMatchValue: srcMatchVal, destTable: destTable, destColumn: destCol };
        } else {
            // "参照なし" が選択されている場合はreferenceを除去する
            delete entry['reference'];
        }

        // default
        const defaultVal = (row.querySelector('.column-default-input') as HTMLInputElement).value.trim();
        if (defaultVal !== '') { entry['default'] = defaultVal; } else { delete entry['default']; }

        // renderAsHtml
        const renderHtml = (row.querySelector('.column-render-html-checkbox') as HTMLInputElement).checked;
        if (renderHtml) { entry['renderAsHtml'] = true; } else { delete entry['renderAsHtml']; }
    }

    /**
     * reverseReferencePriority入力値をスキーマオブジェクトに追加する。
     * 空値の場合は追加しない。
     */
    private applyReverseRefPriorityToSchema(schema: Record<string, unknown>): void {
        const rrpStr = this.reverseRefPriorityInput.value.trim();
        if (rrpStr !== '') { schema['reverseReferencePriority'] = Number(rrpStr); }
    }

    /**
     * 既存テーブル編集モードで、originalSchemaの値を列行のUI要素に反映する。
     * comment, width, reference, default, renderAsHtml を対応するinputに設定する。
     */
    private applyOriginalSchemaToRow(row: HTMLElement, schema: Record<string, unknown>): void {
        // comment
        if (typeof schema['comment'] === 'string') {
            (row.querySelector('.column-comment-input') as HTMLInputElement).value = schema['comment'];
        }
        // width
        if (typeof schema['width'] === 'number') {
            (row.querySelector('.column-width-input') as HTMLInputElement).value = String(schema['width']);
        }
        // reference
        const ref = schema['reference'];
        if (typeof ref === 'string') {
            // 単純参照
            (row.querySelector('.column-ref-type-simple') as HTMLInputElement).checked = true;
            (row.querySelector('.column-ref-simple-input') as HTMLInputElement).value = ref;
            // 単純参照入力を表示状態にする（ラジオのchangeイベントはプログラム的に発火しないため手動で切り替え）
            (row.querySelector('.column-ref-simple-input') as HTMLElement).style.display = '';
        } else if (typeof ref === 'object' && ref !== null && 'sourceTable' in ref) {
            // 動的参照: 型ガードで DynamicReferenceSchema オブジェクトであることを確認する
            const dynRef = ref as Record<string, string>;
            (row.querySelector('.column-ref-type-dynamic') as HTMLInputElement).checked = true;
            (row.querySelector('.column-ref-dynamic-source-table') as HTMLInputElement).value = dynRef['sourceTable'] as string;
            (row.querySelector('.column-ref-dynamic-source-match-column') as HTMLInputElement).value = dynRef['sourceMatchColumn'] as string;
            (row.querySelector('.column-ref-dynamic-source-match-value') as HTMLInputElement).value = dynRef['sourceMatchValue'] as string;
            (row.querySelector('.column-ref-dynamic-dest-table') as HTMLInputElement).value = dynRef['destTable'] as string;
            (row.querySelector('.column-ref-dynamic-dest-column') as HTMLInputElement).value = dynRef['destColumn'] as string;
            // 動的参照フィールドを表示状態にする
            (row.querySelector('.column-ref-dynamic-fields') as HTMLElement).style.display = '';
        }
        // default
        if (typeof schema['default'] === 'string') {
            (row.querySelector('.column-default-input') as HTMLInputElement).value = schema['default'];
        }
        // renderAsHtml
        if (schema['renderAsHtml'] === true) {
            (row.querySelector('.column-render-html-checkbox') as HTMLInputElement).checked = true;
        }
    }
}
