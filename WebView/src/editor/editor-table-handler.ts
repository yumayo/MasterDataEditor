import {EditorTable} from "./editor-table";
import {GridTextField} from "../ui/grid-textfield";
import {Selection, CellRange} from "./selection";
import {History} from "./history";
import {CellChange, CellChangeCommand, CompositeCommand, PromoteBufferRowCommand} from "./command";
import {ReferenceDataCache} from "../references/reference-data-cache";
import {GridDropdownInput} from "../ui/grid-dropdown-input";
import {
    appendDateTimeDateSeparatorIfNeeded,
    applyDateTimeTextInputEdit,
    DateTimePicker,
    isDateTimeTextInputSeparator,
    normalizeDateTimeInputToSeconds,
    normalizeDateTimeTextInputValue,
} from "../ui/date-time-picker";
import {EditorTableData} from "../data/models/editor-table-data";
import {
    parseReferenceExpression,
    isDynamicReference,
    DynamicReference
} from "../references/reference-expression";
import {
    moveCell,
    extendSelectionCell,
    moveCellDownWithinSelection,
    moveCellUpWithinSelection,
    moveCellRightWithinSelection,
    moveCellLeftWithinSelection,
    saveColumnWidthsDataAsync,
    saveSchemaDataAsync,
    saveTableDataFromStoreAsync,
    saveDiffTableDataFromStoreAsync,
    getTarget
} from "./editor-actions";
import {ScrollViewportController} from "./scroll-viewport-controller";
import {NotificationToast} from "../ui/notification";
import {gitStatusAsync, invalidateGitStatusCache, type GitStatusResult, type WriteFileOptions} from "../app/api";

/**
 * 参照解決の結果
 */
interface ResolvedReference {
    tableName: string;
    columnName: string;
}

/**
 * EditorTable の入力イベントを一元管理するクラス
 *
 * 責務：
 * - contenteditable element の所有
 * - キーボードイベントのリスニング
 * - エディタ全体のショートカット処理（Ctrl+S, Ctrl+C, Ctrl+Z, Ctrl+Y等）
 * - セル移動（矢印キー、Enter、Tab）
 * - 編集モードの開始・終了
 * - ペースト処理
 * - フォーカス管理（IME対応）
 * - 参照列のドロップダウン連携
 */
export class EditorTableHandler {

    private readonly element: HTMLElement;

    private readonly table: EditorTable;
    private readonly selection: Selection;
    private readonly history: History;
    private readonly scrollController: ScrollViewportController;
    private textField: GridTextField | undefined;
    private inputContainer: HTMLElement | undefined;
    private dateTimePicker: DateTimePicker | undefined;

    private active: boolean;
    private visible: boolean;
    /**
     * 読み取り専用フラグ。ミニEditorTableでtrueにする。
     * trueの場合、セル編集UIの表示とCtrl+S保存を禁止してストア汚染とCSV破壊を防ぐ。
     */
    private readOnly: boolean;
    /**
     * 保存先テーブル名のオーバーライド。差分タブの右ペインで使用する。
     * 空文字の場合は this.table.tableName をそのまま使用する。
     * 差分タブのストアキーは "tableName:diff:current" のような不正パスのため、
     * 元の tableName を指定することでファイル破壊を防ぎつつ保存を可能にする。
     */
    private saveTargetTableName: string;
    /**
     * gitルート相対のファイルパス。差分タブの右ペインで使用する。
     * 空文字の場合は未設定を表す。
     * 保存後の refreshGitDiffForDiffTabAsync で HEAD版CSV取得に使用する。
     * サブディレクトリ環境（例: "subdir/data/quest_reward.csv"）でも正しく動作する。
     */
    private gitPath: string;
    /**
     * 差分タブ保存後に通常タブのDOMを同期するため、Tab.getOpenEditorTables() の Map を保持する。
     * 差分タブの右ペインの EditorTableHandler にのみ connectOpenEditorTables() で設定される。
     * false の場合は通常タブのDOM同期をスキップする（通常テーブル・ミニテーブル・差分タブ左ペイン）。
     */
    private openEditorTables: Map<string, EditorTable> | false;
    /** 保存処理の多重起動を防ぐための in-flight Promise。 */
    private saveInFlight: Promise<void> | false;
    /**
     * focusWithoutScrolling() が発行した rAF の ID。
     * 0 は「未発行」を表す（requestAnimationFrame は 0 を返さないため安全なセンチネル値）。
     * 連続呼び出し時の競合防止と deactivate 時のキャンセルに使用する。
     */
    private pendingScrollRestoreId: number;

    // 参照列用のコンポーネント
    private referenceDataCache: ReferenceDataCache | undefined;
    private dropdownInput: GridDropdownInput | undefined;
    private tableData: EditorTableData | undefined;
    private dropdownActive: boolean;
    private dateTimePickerActive: boolean;
    /** エラー通知トースト */
    private readonly notification: NotificationToast;

    private readonly boundOnKeydown: (e: KeyboardEvent) => void;
    private readonly boundOnBeforeInput: (e: InputEvent) => void;
    private readonly boundOnKeyup: (e: KeyboardEvent) => void;
    private readonly boundOnMouseup: (e: MouseEvent) => void;
    private readonly boundOnFocusout: (e: FocusEvent) => void;
    private readonly boundOnPaste: (e: ClipboardEvent) => void;

    constructor(
        table: EditorTable,
        selection: Selection,
        history: History,
        scrollController: ScrollViewportController,
        notification: NotificationToast
    ) {
        this.table = table;
        this.selection = selection;
        this.history = history;
        this.scrollController = scrollController;
        this.notification = notification;
        this.textField = undefined;

        this.active = false;
        this.visible = false;
        this.readOnly = false;
        this.saveTargetTableName = '';
        this.gitPath = '';
        this.openEditorTables = false;
        this.saveInFlight = false;
        this.dropdownActive = false;
        this.dateTimePickerActive = false;
        this.pendingScrollRestoreId = 0;

        // contenteditable element を作成
        // パーキング（非表示待機）は position:fixed で行う。
        // fixed の containing block はビューポートのため、フォーカス要素やキャレットを
        // 可視化しようとするブラウザの祖先スクロール（reveal）の対象にならない。
        // 旧方式（position:absolute + top:-99999px）では WebView2 が reveal の際に
        // 祖先スクロール要素（editor-left-pane）を(0,0)へスクロールさせ、
        // 横スクロールバーが1フレーム0座標で描画される不具合の原因になっていた。
        // opacity:0 はパーキング位置（ビューポート左上）でのキャレット点滅を隠すため。
        const element = document.createElement('div');
        element.style.width = '0px';
        element.style.position = 'fixed';
        element.style.top = '0px';
        element.style.left = '0px';
        element.style.opacity = '0';
        element.classList.add('grid-textfield');
        element.setAttribute('contenteditable', 'true');
        element.appendChild(document.createElement('br'));
        this.element = element;

        // イベントリスナーを登録
        this.boundOnKeydown = this.onKeydown.bind(this);
        this.boundOnBeforeInput = this.onBeforeInput.bind(this);
        this.boundOnKeyup = this.onKeyup.bind(this);
        this.boundOnMouseup = this.onMouseup.bind(this);
        this.boundOnFocusout = this.onFocusout.bind(this);
        this.boundOnPaste = this.onPaste.bind(this);

        this.element.addEventListener('keydown', this.boundOnKeydown);
        this.element.addEventListener('beforeinput', this.boundOnBeforeInput);
        this.element.addEventListener('keyup', this.boundOnKeyup);
        this.element.addEventListener('mouseup', this.boundOnMouseup);
        this.element.addEventListener('focusout', this.boundOnFocusout);
        this.element.addEventListener('paste', this.boundOnPaste);
        this.element.addEventListener('input', this.onInput.bind(this));
    }

    /**
     * ハンドラーを有効化（タブがアクティブになったとき）
     */
    enable(): void {
        if (this.active) return;

        this.active = true;
        this.focusWithoutScrolling(this.scrollController.getScrollTop(), this.scrollController.getScrollLeft());
    }

    /**
     * ハンドラーをアクティブ化してフォーカスを取得する
     * RelationsPanelのactivateHandler()から呼ばれ、排他制御を行う
     * enable()との違い: 既にactiveでも必ずフォーカスを取得する
     */
    activate(): void {
        this.active = true;
        this.focusWithoutScrolling(this.scrollController.getScrollTop(), this.scrollController.getScrollLeft());
    }

    /**
     * スクロール位置を維持しながら contenteditable element にフォーカスを移す。
     *
     * WebView2/Chromium では `focus({ preventScroll: true })` が機能しない場合があり、
     * フォーカス要素の reveal によってブラウザが自動スクロールして
     * スクロール位置がリセットされる場合がある。
     * focus 直後にスクロール位置を強制復元することでこの問題を回避する。
     *
     * scrollTop/scrollLeft は呼び出し元が「DOM スタイル変更前」に取得して渡すこと。
     * style 変更後にこのメソッドを呼ぶと、ブラウザが既にスクロールをリセット済みの
     * 状態でスクロール位置を読んでしまい、0 を「正しい位置」として保護してしまう。
     */
    private focusWithoutScrolling(scrollTop: number, scrollLeft: number): void {
        this.element.focus({ preventScroll: true });
        // preventScroll が機能しなかった場合でも強制的に元の位置に戻す
        this.scrollController.setScrollPosition(scrollTop, scrollLeft);
        // 前回の rAF が残っていればキャンセルして競合を防ぐ
        if (this.pendingScrollRestoreId !== 0) {
            window.cancelAnimationFrame(this.pendingScrollRestoreId);
        }
        // ブラウザの自動スクロールが非同期的に適用される場合に備え、次フレームでも復元する
        this.pendingScrollRestoreId = window.requestAnimationFrame(() => {
            this.pendingScrollRestoreId = 0;
            this.scrollController.setScrollPosition(scrollTop, scrollLeft);
        });
    }

    /**
     * ハンドラーを無効化（タブが非アクティブになったとき）
     */
    deactivate(): void {
        this.active = false;
        this.hideDateTimePicker(false);
        // タブ切り替え等で deactivate された後も rAF コールバックが実行されないようキャンセルする
        if (this.pendingScrollRestoreId !== 0) {
            window.cancelAnimationFrame(this.pendingScrollRestoreId);
            this.pendingScrollRestoreId = 0;
        }
    }

    /**
     * 読み取り専用にする（ミニEditorTable用）
     * セル編集UIの表示を禁止してストア汚染を防ぎ、Ctrl+Sも禁止してCSV破壊を防ぐ
     */
    makeReadOnly(): void {
        this.readOnly = true;
    }

    /**
     * 差分タブの右ペイン用に保存先テーブル名とgitパスを一括設定する。
     * - saveTargetTableName: ストアキーが "tableName:diff:current" のような不正パスでも、
     *   元の tableName を指定することでファイル破壊なく保存できる。
     * - gitPath: gitルート相対のファイルパス。保存後の refreshGitDiffForDiffTabAsync で HEAD版CSVを取得する際に使用する。
     *   サブディレクトリ環境では "data/xxx.csv" ではなく "subdir/data/xxx.csv" 形式になるため、
     *   ハードコードせず source-control-panel.ts の entry.path をそのまま引き回す。
     */
    configureDiffRightPane(saveTargetTableName: string, gitPath: string): void {
        this.saveTargetTableName = saveTargetTableName;
        this.gitPath = gitPath;
    }

    /**
     * 差分タブ保存後に通常タブのDOMを同期するため、開かれているEditorTableのMapを設定する。
     * Tab.getOpenEditorTables() の戻り値を渡すことで、差分タブ保存後に対応する通常タブが
     * 開いている場合は reloadCellsFromStore() を呼び出してDOMをストアと同期させる。
     * 差分タブの右ペイン生成時（DiffTab.buildRightEditorTablePane）から呼ぶこと。
     */
    connectOpenEditorTables(openEditorTables: Map<string, EditorTable>): void {
        this.openEditorTables = openEditorTables;
    }

    /**
     * contenteditable div を指定コンテナに追加する
     * element の public 露出を避けるためのメソッド
     */
    appendTo(container: HTMLElement): void {
        container.appendChild(this.element);
    }

    /**
     * GridTextField を生成して返す
     * element の public 露出を避けるため、このメソッド経由で生成する
     */
    createGridTextField(container: HTMLElement, table: EditorTable, selection: Selection): GridTextField {
        this.inputContainer = container;
        return new GridTextField(this.element, container, table, selection);
    }

    /**
     * GridDropdownInput を生成して返す。
     * element の public 露出を避けるため、このメソッド経由で生成する。
     * DropdownQuickView は呼び出し元（Tab）が dropdownInput.connectDropdownQuickView() で後から接続する。
     * diff-tab.ts のように Tab を持たない場面では接続しないことでクイックビュー無効になる。
     */
    createDropdownInput(container: HTMLElement): GridDropdownInput {
        return new GridDropdownInput(
            container,
            this.element,
            (id: string) => { this.submitDropdownSelection(id); },
            () => { this.cancelDropdown(); },
        );
    }

    /**
     * GridTextField を設定（循環依存解決のため、コンストラクタ後に設定）
     */
    setTextField(textField: GridTextField): void {
        this.textField = textField;
    }

    /**
     * 参照データキャッシュとドロップダウンコンポーネントを設定
     */
    setReferenceComponents(cache: ReferenceDataCache, dropdown: GridDropdownInput, tableData: EditorTableData): void {
        this.referenceDataCache = cache;
        this.dropdownInput = dropdown;
        this.tableData = tableData;
    }

    /**
     * セル編集モードを開始する（外部から呼ばれる用）
     *
     * dblclick 経由でミニEditorTableから呼ばれる場合は enable() が呼ばれていないため
     * ここで active = true にセットする。これによりキーボード操作（Enter/Tab/ESC）が
     * 正しく機能し、フォーカスアウト時の値確定も動作する。
     */
    enableCellEditMode(preserveContent: boolean): void {
        // 読み取り専用（ミニEditorTable）では編集UIを表示しない。
        // ストア汚染を防ぐため編集自体を禁止する。
        if (this.readOnly) return;
        if (!this.textField) return;

        // enable() を呼ばずに直接編集を開始するパス（ミニEditorTable dblclick）でも
        // キーボードイベントが機能するように active = true にする
        this.active = true;

        // バーチャルスクロールにより対象行がDOMに存在しない場合があるため、
        // セル矩形を取得する前に行をDOMに確保する
        const focus = this.selection.getFocus();
        this.table.ensureRowVisible(focus.row);

        const target = getTarget(this.table, this.selection);
        const cellRect = target.cellRect;
        // セルのビューポート絶対座標をそのまま渡す。
        // GridTextField.show() 内で this.element.parentElement の BoundingClientRect を引いて
        // position:absolute の配置基準要素からの相対座標に変換する。
        // これによりメインテーブルでも relations-panel 内でも正しく配置できる。
        const rect = new DOMRect(cellRect.left - 1, cellRect.top, cellRect.width + 1, cellRect.height);

        this.textField.show(rect, target.cellValue, preserveContent);

        this.visible = true;
    }

    /**
     * datetime型セルの編集モードを開始する。
     */
    enableDateTimeCellEditMode(preserveContent: boolean, initialText: string | null = null): void {
        if (this.readOnly) return;
        if (!this.inputContainer) return;
        if (!this.textField) return;

        const focus = this.selection.getFocus();
        const dataColIndex = focus.column - this.table.dataColumnOffset();
        if (dataColIndex < 0 || this.table.getColumnType(dataColIndex) !== 'datetime' || this.table.hasColumnReference(dataColIndex)) return;

        this.active = true;
        this.table.ensureRowVisible(focus.row);

        const target = getTarget(this.table, this.selection);
        const cellRect = target.cellRect;
        const rect = new DOMRect(cellRect.left - 1, cellRect.top, cellRect.width + 1, cellRect.height);
        const initialValue = initialText !== null ? initialText : (preserveContent ? target.cellValue : '');

        this.textField.show(rect, initialValue, preserveContent || initialText !== null);
        this.visible = true;

        const picker = this.ensureDateTimePicker();
        const pickerElement = picker.getElement();
        const containerRect = this.inputContainer.getBoundingClientRect();
        pickerElement.style.left = (rect.left - containerRect.left) + 'px';
        pickerElement.style.top = (rect.top - containerRect.top) + 'px';
        pickerElement.style.setProperty('--date-time-picker-width', Math.max(rect.width, 240) + 'px');
        pickerElement.style.setProperty('--date-time-picker-control-height', rect.height + 'px');
        pickerElement.classList.add('grid-date-time-picker-active');

        picker.setValue(initialValue);
        this.dateTimePickerActive = true;
        picker.open();
    }

    /**
     * フォーカスアウト時の処理
     */
    private onFocusout(event: FocusEvent): void {

        if (!this.active) return;

        // ドロップダウンがアクティブな場合はキャンセルして非表示にする
        if (this.dropdownActive && this.dropdownInput) {
            this.dropdownInput.cancel();
        }

        // フォーカス先がHTMLInputElement/HTMLTextAreaElementの場合は
        // 意図的な移動なのでフォーカスを奪わない（検索パネル等の入力フィールド用）
        const focusTarget = event.relatedTarget;
        if (this.dateTimePickerActive
            && this.dateTimePicker !== undefined
            && focusTarget instanceof Node
            && this.dateTimePicker.getElement().contains(focusTarget)) {
            return;
        }
        if (focusTarget instanceof HTMLInputElement || focusTarget instanceof HTMLTextAreaElement) {
            if (this.visible) {
                if (this.dateTimePickerActive) {
                    this.submitDateTimePickerAndHide();
                } else {
                    this.submitText();
                    this.hide();
                }
            }
            return;
        }

        // フォーカス先が別のEditorTableのgrid-textfield（contenteditable div）の場合は
        // フォーカスを奪わない。そのEditorTableのhandlerがactivate()を呼んでアクティブになっているため
        // こちらはdeactivate()された状態になっており、奪還してもIMEが壊れるだけ。
        if (focusTarget instanceof HTMLElement && focusTarget.classList.contains('grid-textfield') && focusTarget !== this.element) {
            if (this.visible) {
                if (this.dateTimePickerActive) {
                    this.submitDateTimePickerAndHide();
                } else {
                    this.submitText();
                    this.hide();
                }
            }
            return;
        }

        // フォーカス先がデバッグコンソール内の場合はフォーカスを奪わない（テキスト選択を許可する）
        if (focusTarget instanceof HTMLElement && focusTarget.closest('.debug-console')) {
            if (this.visible) {
                if (this.dateTimePickerActive) {
                    this.submitDateTimePickerAndHide();
                } else {
                    this.submitText();
                    this.hide();
                }
            }
            return;
        }

        // アクティブ中はセルを常に有効にし続けます。
        // IMEを使用していてキー入力の一文字目から日本語を使用できるようになります。
        // フォーカスアウト時点のスクロール位置を先に読んでから focus() を呼ぶ（DOM変更前なので正しい値）。
        this.focusWithoutScrolling(this.scrollController.getScrollTop(), this.scrollController.getScrollLeft());

        // すでに非表示なら何もしないです。
        if (!this.visible) return;

        if (this.dateTimePickerActive) {
            this.submitDateTimePickerAndHide();
            return;
        }

        this.submitText();

        // 非表示にします。
        this.hide();
    }

    /**
     * 入力イベント時の処理（リサイズとドロップダウンフィルタリング）
     */
    private onBeforeInput(event: InputEvent): void {
        if (!this.active) return;

        if (!this.dateTimePickerActive) {
            if (this.visible && this.isFocusedBoolColumnWithoutReference()) {
                const inputText = this.readBeforeInputText(event);
                if (inputText !== null && /\D/.test(inputText)) {
                    event.preventDefault();
                }
            }
            return;
        }

        const selection = this.getTextFieldSelectionOffsets();
        const result = applyDateTimeTextInputEdit(
            this.element.textContent ?? '',
            selection.start,
            selection.end,
            event.inputType,
            this.readBeforeInputText(event),
        );
        if (result === null) return;

        event.preventDefault();
        this.element.textContent = result.value;
        this.setTextFieldCaretOffset(result.selectionStart);
        if (this.dateTimePicker !== undefined) this.dateTimePicker.syncDraftFromText(result.value);
        if (this.textField !== undefined) this.textField.resizeTextField(result.value);
    }

    private onKeyup(_event: KeyboardEvent): void {
        this.appendDateTimeDateSeparatorToTextFieldIfNeeded();
    }

    private onMouseup(_event: MouseEvent): void {
        this.appendDateTimeDateSeparatorToTextFieldIfNeeded();
    }

    private onInput(): void {
        if (!this.active) return;

        const text = this.dateTimePickerActive ? this.normalizeDateTimeTextFieldInput() : this.normalizeBoolTextFieldInputIfNeeded();

        // ドロップダウンがアクティブな場合はフィルタリング
        if (this.dropdownActive && this.dropdownInput) {
            this.dropdownInput.onInputChanged(text);
            // テキストフィールドのリサイズも行う
            if (this.textField) {
                this.textField.resizeTextField(text);
            }
            return;
        }

        if (!this.textField) return;
        if (this.dateTimePickerActive && this.dateTimePicker !== undefined) {
            this.dateTimePicker.syncDraftFromText(text);
        }
        this.textField.resizeTextField(text);
    }

    /**
     * キーボードイベントを処理する
     */
    private onKeydown(keyboardEvent: KeyboardEvent): void {
        if (!this.active) return;

        this.table.stopAutoScrollForInput();

        if (this.dateTimePickerActive && this.moveDateTimeTextFieldCaretAcrossSeparator(keyboardEvent)) return;

        // ドロップダウンがアクティブな場合
        if (this.dropdownActive) {
            this.handleDropdownKeydown(keyboardEvent);
            return;
        }

        if (this.visible) {
            this.handleEditModeKeydown(keyboardEvent);
        } else {
            this.handleNavigationKeydown(keyboardEvent);
        }
    }

    /**
     * テキスト編集中のキー処理
     */
    private handleEditModeKeydown(keyboardEvent: KeyboardEvent): void {
        // IMEの入力中であれば決定しないです。
        if (!keyboardEvent.isComposing && keyboardEvent.code === 'Enter') {
            if (this.dateTimePickerActive) {
                this.submitDateTimePickerAndHide();
            } else {
                this.submitText();
                this.hide();
            }
            if (keyboardEvent.shiftKey) {
                moveCellUpWithinSelection(this.table, this.selection);
            } else {
                moveCellDownWithinSelection(this.table, this.selection);
            }
            return;
        }

        // Tabキーの処理（編集中）
        if (keyboardEvent.key === 'Tab') {
            keyboardEvent.preventDefault();
            if (this.dateTimePickerActive) {
                this.submitDateTimePickerAndHide();
            } else {
                this.submitText();
                this.hide();
            }
            if (keyboardEvent.shiftKey) {
                moveCellLeftWithinSelection(this.table, this.selection);
            } else {
                moveCellRightWithinSelection(this.table, this.selection);
            }
            return;
        }

        // ESCキーで入力をキャンセルして元に戻す
        if (keyboardEvent.key === 'Escape') {
            keyboardEvent.preventDefault();
            if (this.dateTimePickerActive) this.hideDateTimePicker(false);
            this.hide();
            return;
        }

        // 数値型の編集モードフィルタ（IME変換中はスキップ）
        if (!keyboardEvent.isComposing) {
            const focus = this.selection.getFocus();
            const dataColIndex = focus.column - this.table.dataColumnOffset();
            if (dataColIndex >= 0 && !this.table.hasColumnReference(dataColIndex)) {
                const colType = this.table.getColumnType(dataColIndex);
                // int型の上下矢印インクリメント/デクリメント
                if ((colType === 'int' || colType === 'long') && (keyboardEvent.key === 'ArrowUp' || keyboardEvent.key === 'ArrowDown')) {
                    keyboardEvent.preventDefault();
                    const currentText = this.element.textContent ?? '';
                    // long型はBigIntで計算し、53bit超の整数でも精度を保つ
                    let newValueStr: string;
                    if (colType === 'long') {
                        try {
                            const base = currentText === '' ? 0n : BigInt(currentText);
                            const newValue = keyboardEvent.key === 'ArrowUp' ? base + 1n : base - 1n;
                            newValueStr = newValue.toString();
                        } catch {
                            newValueStr = currentText;
                        }
                    } else {
                        const currentValue = parseInt(currentText, 10);
                        const base = isNaN(currentValue) ? 0 : currentValue;
                        newValueStr = String(keyboardEvent.key === 'ArrowUp' ? base + 1 : base - 1);
                    }
                    this.element.textContent = newValueStr;
                    // テキストフィールドをリサイズする
                    if (this.textField) this.textField.resizeTextField(newValueStr);
                    return;
                }
                // float/double型の上下矢印インクリメント/デクリメント（整数部を増減）
                // IEEE 754 浮動小数点の精度誤差を回避するため、加算後に丸める
                if ((colType === 'float' || colType === 'double') && (keyboardEvent.key === 'ArrowUp' || keyboardEvent.key === 'ArrowDown')) {
                    keyboardEvent.preventDefault();
                    const currentText = this.element.textContent ?? '';
                    const currentValue = parseFloat(currentText);
                    const base = isNaN(currentValue) ? 0 : currentValue;
                    const delta = keyboardEvent.key === 'ArrowUp' ? 1 : -1;
                    const newValue = Math.round((base + delta) * 1e10) / 1e10;
                    this.element.textContent = String(newValue);
                    if (this.textField) this.textField.resizeTextField(String(newValue));
                    return;
                }
                // bool型の入力フィルタ: 数字・制御キー以外をブロック
                if (colType === 'bool') {
                    if (!this.isAllowedDigitKey(keyboardEvent)) {
                        keyboardEvent.preventDefault();
                    }
                    return;
                }
                // int型の入力フィルタ: 数字・+・-・制御キー以外をブロック
                if (colType === 'int' || colType === 'long') {
                    if (!this.isAllowedNumericKey(keyboardEvent)) {
                        keyboardEvent.preventDefault();
                        return;
                    }
                }
                // float/double型の入力フィルタ: 数字・+・-・.・e・E・制御キー以外をブロック
                if (colType === 'float' || colType === 'double') {
                    if (!this.isAllowedNumericKey(keyboardEvent) && !/^[.eE]$/.test(keyboardEvent.key)) {
                        keyboardEvent.preventDefault();
                        return;
                    }
                }
            }
        }
    }

    /**
     * 数値型の編集モードで許可される基本キーかどうかを判定する。
     * 数字(0-9)、符号(+/-)、制御キー(Backspace/Delete/矢印/Home/End/Ctrl+A等)を許可する。
     * int型はこのメソッドのみで判定し、float/double型は追加で小数点・指数を許可する。
     */
    private isAllowedNumericKey(e: KeyboardEvent): boolean {
        // 制御キー系は常に許可する
        if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') return true;
        // Ctrl/Meta+キーの組み合わせは許可する（Ctrl+A, Ctrl+C等）
        if (e.ctrlKey || e.metaKey) return true;
        // 数字と符号を許可する
        if (/^[0-9+\-]$/.test(e.key)) return true;
        return false;
    }

    /**
     * bool型の編集モードで許可されるキーかどうかを判定する。
     * 数字(0-9)と編集用の制御キーだけを許可する。
     */
    private isAllowedDigitKey(e: KeyboardEvent): boolean {
        if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') return true;
        if (e.ctrlKey || e.metaKey) return true;
        return /^[0-9]$/.test(e.key);
    }

    /**
     * ドロップダウン表示中のキー処理
     */
    private handleDropdownKeydown(keyboardEvent: KeyboardEvent): void {
        if (!this.dropdownInput) return;

        // IME変換中は何もしない
        if (keyboardEvent.isComposing) {
            return;
        }

        switch (keyboardEvent.key) {
            case 'ArrowDown':
                keyboardEvent.preventDefault();
                this.dropdownInput.moveSelection(1);
                break;
            case 'ArrowUp':
                keyboardEvent.preventDefault();
                this.dropdownInput.moveSelection(-1);
                break;
            case 'Enter':
                keyboardEvent.preventDefault();
                this.dropdownInput.confirmSelection();
                break;
            case 'Tab':
                keyboardEvent.preventDefault();
                this.dropdownInput.confirmSelection();
                break;
            case 'Escape':
                keyboardEvent.preventDefault();
                this.dropdownInput.cancel();
                break;
        }
    }

    /**
     * ナビゲーションモード（編集モードではない）のキー処理
     */
    private handleNavigationKeydown(keyboardEvent: KeyboardEvent): void {
        // F12: ミニテーブルの場合のみ自テーブルを左ペインで開く（ドリルダウン）
        if (keyboardEvent.key === 'F12' && this.table.isMiniTableInstance()) {
            keyboardEvent.preventDefault();
            const focus = this.selection.getFocus();
            this.table.navigateToDefinition(focus.row);
            return;
        }
        // F12: メインテーブルでFK列の参照先 / PK列の逆参照先テーブルを開く（RelationsPanel非表示時のみ）
        if (keyboardEvent.key === 'F12' && !this.table.isMiniTableInstance()) {
            const focus = this.selection.getFocus();
            if (this.table.navigateToReferenceTable(focus.row, focus.column)
                || this.table.navigateToReverseReferenceTable(focus.row, focus.column)) {
                keyboardEvent.preventDefault();
                return;
            }
        }

        // Ctrl+S: 保存
        if (keyboardEvent.ctrlKey && keyboardEvent.key === 's') {
            keyboardEvent.preventDefault();
            this.save();
            return;
        }

        // Ctrl+D: ブックマーク追加/解除トグル
        if (keyboardEvent.ctrlKey && keyboardEvent.key === 'd') {
            keyboardEvent.preventDefault();
            this.toggleBookmark();
            return;
        }

        // Ctrl+C: コピー
        if (keyboardEvent.ctrlKey && keyboardEvent.key === 'c') {
            keyboardEvent.preventDefault();
            this.selection.copy();
            return;
        }

        // Ctrl+V: ペースト（pasteイベントで処理するためpreventDefaultしない）
        if (keyboardEvent.ctrlKey && keyboardEvent.key === 'v') {
            // pasteイベントに任せる
            return;
        }

        // Ctrl+Z: Undo
        if (keyboardEvent.ctrlKey && keyboardEvent.key === 'z') {
            keyboardEvent.preventDefault();
            const result = this.history.undo();
            if (result) {
                this.selection.setRange(result.range.startRow, result.range.startColumn, result.range.endRow, result.range.endColumn);
                this.selection.move(result.range.startRow, result.range.startColumn);
                this.selection.setCopyRange(result.copyRange);
            }
            return;
        }

        // Ctrl+Y または Ctrl+Shift+Z: Redo
        // Ctrl+Shift+Z は key が 'Z'（大文字）になるため、Ctrl+Z (Undo) と区別される
        if (keyboardEvent.ctrlKey && (keyboardEvent.key === 'y' || keyboardEvent.key === 'Z')) {
            keyboardEvent.preventDefault();
            const result = this.history.redo();
            if (result) {
                this.selection.setRange(result.range.startRow, result.range.startColumn, result.range.endRow, result.range.endColumn);
                this.selection.move(result.range.startRow, result.range.startColumn);
                this.selection.setCopyRange(result.copyRange);
            }
            return;
        }

        // ESCキーでコピー範囲の点線表示を解除
        if (keyboardEvent.key === 'Escape') {
            keyboardEvent.preventDefault();
            if (this.selection.hasCopyRange()) {
                this.selection.clearCopyRange();
            } else {
                // コピー範囲が設定されていないときは履歴のコピー範囲をクリア
                this.history.clearCopyRange();
            }
            return;
        }

        // 矢印キー
        if (keyboardEvent.key === 'ArrowRight') {
            keyboardEvent.preventDefault();
            if (keyboardEvent.shiftKey) {
                extendSelectionCell(this.table, this.selection, 1, 0);
            } else {
                moveCell(this.table, this.selection, 1, 0);
            }
            return;
        }

        if (keyboardEvent.key === 'ArrowLeft') {
            keyboardEvent.preventDefault();
            if (keyboardEvent.shiftKey) {
                extendSelectionCell(this.table, this.selection, -1, 0);
            } else {
                moveCell(this.table, this.selection, -1, 0);
            }
            return;
        }

        if (keyboardEvent.key === 'ArrowUp') {
            keyboardEvent.preventDefault();
            if (keyboardEvent.shiftKey) {
                extendSelectionCell(this.table, this.selection, 0, -1);
            } else {
                moveCell(this.table, this.selection, 0, -1);
            }
            return;
        }

        if (keyboardEvent.key === 'ArrowDown') {
            keyboardEvent.preventDefault();
            if (keyboardEvent.shiftKey) {
                extendSelectionCell(this.table, this.selection, 0, 1);
            } else {
                moveCell(this.table, this.selection, 0, 1);
            }
            return;
        }

        // Enterキー
        if (keyboardEvent.key === 'Enter') {
            keyboardEvent.preventDefault();
            if (keyboardEvent.shiftKey) {
                moveCellUpWithinSelection(this.table, this.selection);
            } else {
                moveCellDownWithinSelection(this.table, this.selection);
            }
            return;
        }

        // Tabキー
        if (keyboardEvent.key === 'Tab') {
            keyboardEvent.preventDefault();
            if (keyboardEvent.shiftKey) {
                moveCellLeftWithinSelection(this.table, this.selection);
            } else {
                moveCellRightWithinSelection(this.table, this.selection);
            }
            return;
        }

        // DeleteキーまたはBackspaceキー（読み取り専用ミニEditorTableでは禁止）
        if (keyboardEvent.key === 'Delete' || keyboardEvent.key === 'Backspace') {
            if (this.readOnly) return;
            // DOM変更前にスクロール位置を保存する（applyCellChanges によるDOM書き換えで
            // ブラウザがフォーカス要素に自動スクロールし、位置がリセットされる場合がある）
            const scrollTop = this.scrollController.getScrollTop();
            const scrollLeft = this.scrollController.getScrollLeft();
            const deleteRange = this.selection.getSelectionRange();
            const changes: CellChange[] = [];
            for (let r = deleteRange.startRow; r <= deleteRange.endRow; r++) {
                for (let c = deleteRange.startColumn; c <= deleteRange.endColumn; c++) {
                    const oldValue = this.table.getCellValueAt(r, c);
                    if (oldValue !== '') changes.push({ row: r, column: c, oldValue, newValue: '' });
                }
            }
            if (changes.length > 0) {
                this.applyCellChangesWithHistory(changes, deleteRange, this.selection.getCopyRange());
                // 事前保存したスクロール位置で保護する（hide() と同じパターン）
                this.focusWithoutScrolling(scrollTop, scrollLeft);
            }
            return;
        }

        // Spaceキー: bool型セルの場合はトグル操作（テキスト編集モードには入らない）
        if (keyboardEvent.key === ' ') {
            const focus = this.selection.getFocus();
            const dataColIndex = focus.column - this.table.dataColumnOffset();
            if (dataColIndex >= 0 && this.table.getColumnType(dataColIndex) === 'bool' && !this.table.hasColumnReference(dataColIndex)) {
                keyboardEvent.preventDefault();
                this.toggleBoolCell();
                return;
            }
        }

        // datetime型セルでは文字入力開始時にも DateTimePicker を表示する。
        {
            const focus = this.selection.getFocus();
            const dataColIndex = focus.column - this.table.dataColumnOffset();
            if (dataColIndex >= 0
                && this.table.getColumnType(dataColIndex) === 'datetime'
                && !this.table.hasColumnReference(dataColIndex)
                && (keyboardEvent.key === 'Process' || /^[0-9/: T-]$/.test(keyboardEvent.key))) {
                if (this.readOnly) return;
                keyboardEvent.preventDefault();
                this.enableDateTimeCellEditMode(false, keyboardEvent.key === 'Process' ? null : keyboardEvent.key);
                return;
            }
        }

        // 文字入力による編集モード開始
        // Ctrl/Meta+キーの組み合わせはショートカットなので編集モードを開始しない
        if (keyboardEvent.ctrlKey || keyboardEvent.metaKey) return;
        // bool型列（FK参照なし）は数字キーのみテキスト編集を開始する
        {
            const focus = this.selection.getFocus();
            const dataColIndex = focus.column - this.table.dataColumnOffset();
            if (dataColIndex >= 0 && this.table.getColumnType(dataColIndex) === 'bool' && !this.table.hasColumnReference(dataColIndex)) {
                if (!/^[0-9]$/.test(keyboardEvent.key)) {
                    if (keyboardEvent.key.length === 1 || keyboardEvent.key === 'Process') keyboardEvent.preventDefault();
                    return;
                }
            }
            if (dataColIndex >= 0 && this.table.getColumnType(dataColIndex) === 'datetime' && !this.table.hasColumnReference(dataColIndex)) {
                return;
            }
        }
        if (keyboardEvent.key?.match(/^\w$/g) || keyboardEvent.key === 'Process') {
            if (this.readOnly) return;
            if (!this.textField) return;
            // ブラウザのデフォルト文字挿入を防ぐ。
            // enableCellEditModeWithDropdownAsync が非同期のため、
            // preventDefault しないと keydown → ブラウザが文字挿入 → async完了後に show() で textContent=null クリア
            // という順序で入力文字が消えてしまう。
            keyboardEvent.preventDefault();
            // Process キー（IME開始）の場合は文字挿入をスキップする
            const inputChar = keyboardEvent.key === 'Process' ? null : keyboardEvent.key;
            // 参照列の場合はドロップダウンを表示
            this.enableCellEditModeWithDropdownAsync(false).then((handled) => {
                // 非同期完了までにユーザーが別の操作をした場合は中断する
                if (!this.active) return;
                if (!handled) {
                    // ドロップダウンで処理されなかった場合は通常の編集モード
                    this.enableCellEditMode(false);
                }
                // show() 完了後に最初のキー文字をテキストフィールドに手動挿入する
                if (inputChar !== null) {
                    this.element.textContent = inputChar;
                    // カーソルを末尾に移動する
                    const range = document.createRange();
                    range.selectNodeContents(this.element);
                    range.collapse(false);
                    const windowSelection = window.getSelection();
                    if (windowSelection) {
                        windowSelection.removeAllRanges();
                        windowSelection.addRange(range);
                    }
                    // リサイズとドロップダウンフィルタリングを実行する
                    this.onInput();
                }
            });
            return;
        }
    }

    /**
     * テーブルデータを保存する。
     * Ctrl+S キーハンドラおよび Tab.saveActiveTable() から呼ばれる。
     * 差分タブ右ペイン・ミニテーブル・通常テーブルの3パターンを処理する。
     */
    save(): void {
        if (this.readOnly) return;
        if (this.saveInFlight !== false) return;
        this.saveInFlight = this.saveAsync()
            .catch((e: unknown) => {
                console.error('[EditorTableHandler] save failed:', e);
                this.notification.show('保存に失敗しました');
            })
            .finally(() => {
                this.saveInFlight = false;
            });
    }

    private async saveAsync(): Promise<void> {
        const store = this.table.getStore();
        const saveWriteOptions: WriteFileOptions = {
            invalidateGitStatus: false,
            suppressSelfSaveGitRefresh: true,
        };
        // 差分タブの右ペイン: saveTargetTableName が設定されている場合は元テーブル名で保存する。
        // ストアキーは "tableName:diff:current" だが保存先は元の tableName にする。
        if (this.saveTargetTableName !== '') {
            // 差分タブの右ペイン保存:
            // - ストアキーは "tableName:diff:current" のような不正パスのため saveTargetTableName で保存する
            // - getDiffPaddingStoreRowIndices() で現在のDOM状態からパディング行インデックスを動的に取得してCSVから除外する
            // - Dirty解除は差分タブの History キー（this.table.tableName）で行う
            // - 保存後は通常テーブルのストアも最新CSVに更新してタブ再オープン時に反映する
            // - 保存後は refreshGitDiffForDiffTabAsync で gitPath（gitルート相対パス）を使ってgit差分ハイライトを更新する
            const paddingIndices = this.table.getDiffPaddingStoreRowIndices();
            await saveDiffTableDataFromStoreAsync(this.saveTargetTableName, store, this.table.tableName, paddingIndices, saveWriteOptions);
            // this.table.tableName = "quest_reward:diff:current" で markAllSaved を呼ぶ。
            // 差分タブの History は this.table.tableName（不正パスキー）で historyRegistry に登録されており、
            // saveTargetTableName（"quest_reward"）では登録されていない。
            store.markAllSaved(this.table.tableName);
            if (this.table.relationsPanel !== false) {
                this.table.relationsPanel.updateDirtyMark(this.saveTargetTableName, false);
            }
            // 通常テーブルのストアが存在する場合（タブが開いている、またはキャッシュ中）は
            // ファイルから再読み込みして最新状態に更新する。
            // これにより通常タブを開いたときに差分タブで保存したデータが反映される。
            // ただし通常テーブルがDirty状態の場合は未保存変更が上書きされるためスキップする。
            if (store.hasTable(this.saveTargetTableName) && !store.isTableDirty(this.saveTargetTableName)) {
                await store.reloadTableDataAsync(this.saveTargetTableName);
                // 通常タブが既に開かれている場合は reloadCellsFromStore() でストアの最新データをDOMに反映する。
                if (this.openEditorTables !== false && this.openEditorTables.has(this.saveTargetTableName)) {
                    (this.openEditorTables.get(this.saveTargetTableName) as EditorTable).reloadCellsFromStore();
                }
            }
            // 保存後にgit差分ハイライトを更新する。
            // gitPath（gitルート相対パス）を渡してHEAD版CSVとの差分を再計算する。
            await Promise.all([
                this.table.refreshGitDiffForDiffTabAsync(this.gitPath),
                this.refreshSourceControlAfterSaveAsync(),
            ]);
            // テーブル保存イベントを EditorAPI に発火する（差分タブの場合は元テーブル名を使用する）
            if (this.table.tab !== false) this.table.tab.emitTableSaved(this.saveTargetTableName);
            return;
        }
        if (this.table.isMiniTableInstance()) {
            // ミニEditorTableの場合はストアの全列データからCSVを保存する。
            // DOM上はFK列が欠落したフィルタ済みデータのみ表示しているが、
            // ストアは全列・全行データを保持しているため、ストア経由で保存すればCSVを破壊しない。
            await saveTableDataFromStoreAsync(this.table.tableName, store, saveWriteOptions);
            await this.markSavedAndUpdatePanelAsync();
            return;
        }
        // 通常テーブルの保存: ストアから直接CSVを生成して保存する。
        // ストアはSSOTとして全行・全列のデータを保持しているため、
        // 行挿入・削除を含む全変更を正確にCSVに反映できる。
        await Promise.all([
            saveTableDataFromStoreAsync(this.table.tableName, store, saveWriteOptions),
            saveSchemaDataAsync(this.table, saveWriteOptions),
            saveColumnWidthsDataAsync(this.table)
        ]);
        await this.markSavedAndUpdatePanelAsync();
        if (this.table.tab !== false) {
            await this.table.tab.saveCurrentFormPanelEditedTablesAsync(this.table.tableName);
        }
    }

    /**
     * 保存完了後の共通後処理: ストアのDirtyフラグをクリアし、RelationsPanelのDirtyマークを更新し、
     * git差分トラッカーを再構築して全セルのハイライトを再適用する。
     * markAllSavedは二相処理（setTabButtonDirtyのみ）でnotifyChange()を呼ばないため、
     * RelationsPanelのDirtyマークは呼び出し元で明示的に更新する必要がある。
     */
    private async markSavedAndUpdatePanelAsync(): Promise<void> {
        this.table.getStore().markAllSaved(this.table.tableName);
        if (this.table.relationsPanel !== false) {
            this.table.relationsPanel.updateDirtyMark(this.table.tableName, false);
        }
        const statusResult = await this.fetchGitStatusAfterSaveAsync();
        await Promise.all([
            this.table.refreshGitDiffAsync(statusResult),
            statusResult !== false && this.table.tab !== false ? this.table.tab.refreshSourceControlAsync(statusResult) : Promise.resolve(),
        ]);
        // テーブル保存イベントを EditorAPI に発火する
        // EditorTable の中継メソッドを経由せず Tab に直接アクセスする
        if (this.table.tab !== false) this.table.tab.emitTableSaved(this.table.tableName);
    }

    private async refreshSourceControlAfterSaveAsync(): Promise<void> {
        if (this.table.tab === false) return;
        const statusResult = await this.fetchGitStatusAfterSaveAsync();
        if (statusResult === false) return;
        await this.table.tab.refreshSourceControlAsync(statusResult);
    }

    private async fetchGitStatusAfterSaveAsync(): Promise<GitStatusResult | false> {
        invalidateGitStatusCache();
        try {
            return await gitStatusAsync();
        } catch (e: unknown) {
            console.warn('[EditorTableHandler] 保存後のgit status取得をスキップしました:', e);
            return false;
        }
    }

    /**
     * テキスト入力フィールドの内容を確定する
     */
    private submitText(): void {
        if (!this.visible) return;
        const target = getTarget(this.table, this.selection);
        const text = this.normalizeSubmittedTextForColumn(target.column, this.element.textContent ?? '');
        const range = { startRow: target.row, startColumn: target.column, endRow: target.row, endColumn: target.column };
        const changes: CellChange[] = [{ row: target.row, column: target.column, oldValue: target.cellValue, newValue: text }];
        this.applyCellChangesWithHistory(changes, range, this.selection.getCopyRange());
    }

    private normalizeSubmittedTextForColumn(column: number, text: string): string {
        const dataColIndex = column - this.table.dataColumnOffset();
        if (dataColIndex >= 0 && this.table.getColumnType(dataColIndex) === 'bool' && !this.table.hasColumnReference(dataColIndex)) {
            return this.normalizeBoolTextValue(text);
        }
        return text;
    }

    private normalizeBoolTextValue(text: string): string {
        const digits = text.replace(/\D/g, '');
        if (digits === '') return '';
        return /^0+$/.test(digits) ? '0' : '1';
    }

    /**
     * テキスト入力フィールドを非表示（パーキング状態）にする。
     * パーキングは position:fixed で行う（コンストラクタのコメント参照）。
     * fixed 要素はブラウザの reveal（フォーカス要素の可視化スクロール）の対象に
     * ならないため、祖先スクロール要素の位置がリセットされない。
     *
     * 重要: style 変更によってブラウザが同期的にスクロールをリセットする場合があるため、
     * スクロール位置は style 変更「前」に取得しなければならない。
     * 変更後に getScrollTop() を呼ぶと既に 0 になっており、0 で「保護」してしまう。
     */
    private hide(): void {
        // style 変更前にスクロール位置を保存する（変更後はブラウザが 0 にリセットする場合がある）
        const scrollTop = this.scrollController.getScrollTop();
        const scrollLeft = this.scrollController.getScrollLeft();
        if (this.dropdownActive && this.dropdownInput) {
            this.dropdownInput.hide();
            this.dropdownActive = false;
        }
        this.visible = false;
        this.element.textContent = null;
        this.element.style.width = '0px';
        this.element.style.height = '';
        this.element.style.lineHeight = '';
        this.element.style.position = 'fixed';
        this.element.style.top = '0px';
        this.element.style.left = '0px';
        this.element.style.opacity = '0';
        this.element.appendChild(document.createElement('br'));
        this.element.classList.remove('grid-textfield-active');
        // 事前保存したスクロール位置を渡して保護する（style 変更後のブラウザ自動スクロールを防ぐ）
        this.focusWithoutScrolling(scrollTop, scrollLeft);
    }

    private ensureDateTimePicker(): DateTimePicker {
        if (this.dateTimePicker !== undefined) return this.dateTimePicker;
        if (!this.inputContainer) throw new Error('[EditorTableHandler.ensureDateTimePicker] inputContainer が未設定です');
        this.dateTimePicker = new DateTimePicker({
            value: '',
            rootClassNames: ['grid-date-time-picker'],
            onCommit: (value: string) => { this.applyDateTimePickerValueToTextField(value); },
            onDismiss: () => { this.submitDateTimePickerAndHide(); },
            ignoreOutsideClick: (target: Node) => this.element.contains(target),
        });
        this.dateTimePicker.getInput().addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key !== 'Tab') return;
            event.preventDefault();
            this.submitDateTimePickerAndHide();
            if (event.shiftKey) {
                moveCellLeftWithinSelection(this.table, this.selection);
            } else {
                moveCellRightWithinSelection(this.table, this.selection);
            }
        });
        this.inputContainer.appendChild(this.dateTimePicker.getElement());
        return this.dateTimePicker;
    }

    private applyDateTimePickerValueToTextField(value: string): void {
        if (!this.dateTimePickerActive) return;
        this.element.textContent = value;
        if (this.textField) this.textField.resizeTextField(value);
    }

    private normalizeDateTimeTextFieldInput(): string {
        const text = this.element.textContent ?? '';
        const selectionOffset = this.getTextFieldSelectionOffsets().start;
        const result = normalizeDateTimeTextInputValue(text, selectionOffset);
        if (result === null || result.value === text) return text;

        this.element.textContent = result.value;
        this.setTextFieldCaretOffset(result.selectionStart);
        return result.value;
    }

    private normalizeBoolTextFieldInputIfNeeded(): string {
        const text = this.element.textContent ?? '';
        if (!this.visible || !this.isFocusedBoolColumnWithoutReference()) return text;

        const digits = text.replace(/\D/g, '');
        if (digits === text) return text;

        this.element.textContent = digits;
        this.setTextFieldCaretOffset(digits.length);
        return digits;
    }

    private isFocusedBoolColumnWithoutReference(): boolean {
        const focus = this.selection.getFocus();
        const dataColIndex = focus.column - this.table.dataColumnOffset();
        return dataColIndex >= 0
            && this.table.getColumnType(dataColIndex) === 'bool'
            && !this.table.hasColumnReference(dataColIndex);
    }

    private moveDateTimeTextFieldCaretAcrossSeparator(event: KeyboardEvent): boolean {
        if (event.key !== 'Backspace' && event.key !== 'Delete') return false;

        const selection = window.getSelection();
        if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) return false;

        const text = this.element.textContent ?? '';
        const selectionOffset = this.getTextFieldSelectionOffsets().start;
        const separatorIndex = event.key === 'Backspace' ? selectionOffset - 1 : selectionOffset;
        if (!isDateTimeTextInputSeparator(text, separatorIndex)) return false;

        event.preventDefault();
        this.setTextFieldCaretOffset(event.key === 'Backspace' ? separatorIndex : separatorIndex + 1);
        return true;
    }

    private appendDateTimeDateSeparatorToTextFieldIfNeeded(): void {
        if (!this.active || !this.dateTimePickerActive) return;

        const selection = this.getTextFieldSelectionOffsets();
        const result = appendDateTimeDateSeparatorIfNeeded(this.element.textContent ?? '', selection.start, selection.end);
        if (result === null) return;

        this.element.textContent = result.value;
        this.setTextFieldCaretOffset(result.selectionStart);
        if (this.dateTimePicker !== undefined) this.dateTimePicker.syncDraftFromText(result.value);
        if (this.textField !== undefined) this.textField.resizeTextField(result.value);
    }

    private getTextFieldSelectionOffsets(): { start: number; end: number } {
        const textLength = this.element.textContent?.length ?? 0;
        const selection = window.getSelection();
        if (selection === null || selection.rangeCount === 0) return { start: textLength, end: textLength };

        const range = selection.getRangeAt(0);
        if (!this.element.contains(range.startContainer) || !this.element.contains(range.endContainer)) {
            return { start: textLength, end: textLength };
        }

        const startRange = document.createRange();
        startRange.selectNodeContents(this.element);
        startRange.setEnd(range.startContainer, range.startOffset);

        const endRange = document.createRange();
        endRange.selectNodeContents(this.element);
        endRange.setEnd(range.endContainer, range.endOffset);

        return { start: startRange.toString().length, end: endRange.toString().length };
    }

    private setTextFieldCaretOffset(offset: number): void {
        let textNode = this.element.firstChild;
        if (!(textNode instanceof Text)) {
            this.element.textContent = this.element.textContent ?? '';
            textNode = this.element.firstChild;
        }
        if (!(textNode instanceof Text)) {
            textNode = document.createTextNode('');
            this.element.appendChild(textNode);
        }

        const clampedOffset = Math.max(0, Math.min(offset, textNode.textContent?.length ?? 0));
        const range = document.createRange();
        range.setStart(textNode, clampedOffset);
        range.collapse(true);

        const selection = window.getSelection();
        if (selection === null) return;
        selection.removeAllRanges();
        selection.addRange(range);
    }

    private readBeforeInputText(event: InputEvent): string | null {
        if (event.data !== null) return event.data;
        return event.dataTransfer?.getData('text/plain') ?? event.dataTransfer?.getData('text') ?? null;
    }

    private submitDateTimePickerAndHide(): void {
        if (!this.dateTimePickerActive) return;
        if (this.visible) {
            const text = this.element.textContent ?? '';
            this.element.textContent = normalizeDateTimeInputToSeconds(text) ?? text;
            this.submitText();
        }
        this.hideDateTimePicker(false);
        if (this.visible) this.hide();
    }

    private hideDateTimePicker(restoreFocus = true): void {
        if (!this.dateTimePickerActive && this.dateTimePicker === undefined) return;
        const scrollTop = this.scrollController.getScrollTop();
        const scrollLeft = this.scrollController.getScrollLeft();
        this.dateTimePickerActive = false;
        if (this.dateTimePicker !== undefined) {
            this.dateTimePicker.close();
            const pickerElement = this.dateTimePicker.getElement();
            pickerElement.style.top = '-99999px';
            pickerElement.style.left = '-99999px';
            pickerElement.classList.remove('grid-date-time-picker-active');
        }
        if (restoreFocus) this.focusWithoutScrolling(scrollTop, scrollLeft);
    }

    /**
     * テキスト入力を確定して非表示にする（外部から呼ばれる用）
     */
    submitAndHide(): void {
        if (this.dateTimePickerActive) {
            this.submitDateTimePickerAndHide();
            return;
        }
        this.submitText();
        this.hide();
    }

    /**
     * システムクリップボードからのペーストイベントを処理する
     */
    private onPaste(event: ClipboardEvent): void {
        if (!this.active) return;
        // 読み取り専用ミニEditorTableではペーストを禁止してストア汚染を防ぐ
        if (this.readOnly) return;

        // テキスト入力モード中（visible）は通常のペースト動作を許可
        if (this.visible) return;

        event.preventDefault();

        const clipboardData = event.clipboardData;
        if (!clipboardData) return;

        // クリップボードからテキストを取得
        const text = clipboardData.getData('text/plain');
        if (!text) return;

        // コピー範囲がある場合、クリップボードの内容と比較
        if (this.selection.hasCopyRange()) {
            const copyRangeText = this.getCopyRangeText();
            // 改行コードを正規化して比較（\r\nを\nに変換、末尾の改行を除去）
            const normalizedClipboardText = text.replace(/\r\n/g, '\n').replace(/\n$/, '');
            const normalizedCopyRangeText = copyRangeText.replace(/\r\n/g, '\n').replace(/\n$/, '');
            // クリップボードの内容とコピー範囲の内容が一致する場合は倍数ペースト
            if (normalizedClipboardText === normalizedCopyRangeText) {
                this.pasteFromCopyRange();
                return;
            }
        }

        // タブ区切り・改行区切りのテキストを2次元配列に解析
        const sourceData = this.parseClipboardText(text);
        if (sourceData.length === 0) return;

        this.pasteFromClipboardData(sourceData);
    }

    /**
     * コピー範囲のセル内容からテキストを生成する
     * （クリップボードと同じ形式：タブ区切り、改行区切り）
     */
    private getCopyRangeText(): string {
        const copyRange = this.selection.getCopyRange();
        const rows: string[] = [];

        for (let r = copyRange.startRow; r <= copyRange.endRow; r++) {
            const cells: string[] = [];
            for (let c = copyRange.startColumn; c <= copyRange.endColumn; c++) {
                cells.push(this.table.getCellValueAt(r, c));
            }
            rows.push(cells.join('\t'));
        }

        return rows.join('\n');
    }

    /**
     * クリップボードのテキストを2次元配列に解析する
     * タブで列区切り、改行で行区切り
     */
    private parseClipboardText(text: string): string[][] {
        // 末尾の改行を除去
        const trimmedText = text.replace(/\r?\n$/, '');

        // 行に分割（\r\nと\nの両方に対応）
        const lines = trimmedText.split(/\r?\n/);

        const result: string[][] = [];
        for (const line of lines) {
            // タブで列に分割
            const cells = line.split('\t');
            result.push(cells);
        }

        return result;
    }

    /**
     * 解析したクリップボードデータをテーブルに貼り付ける
     */
    private pasteFromClipboardData(sourceData: string[][]): void {
        const copyRange = this.selection.getCopyRange();
        this.pasteNormal(sourceData, copyRange);
    }

    /**
     * コピー範囲からソースデータを取得する
     */
    private getSourceData(copyRange: CellRange): string[][] {
        const copyRowCount = copyRange.endRow - copyRange.startRow + 1;
        const copyColumnCount = copyRange.endColumn - copyRange.startColumn + 1;

        const sourceData: string[][] = [];
        for (let r = 0; r < copyRowCount; r++) {
            const rowData: string[] = [];
            for (let c = 0; c < copyColumnCount; c++) {
                rowData.push(this.table.getCellValueAt(copyRange.startRow + r, copyRange.startColumn + c));
            }
            sourceData.push(rowData);
        }
        return sourceData;
    }

    /**
     * 通常のペースト：アンカー位置からコピー範囲と同じサイズでペースト
     */
    private pasteNormal(sourceData: string[][], copyRange: CellRange): void {
        const anchor = this.selection.getAnchor();
        const tableRowCount = this.table.getLogicalRowCount();
        const tableColumnCount = this.table.getTotalColumnCount();
        const rowCount = sourceData.length;
        const columnCount = sourceData[0].length;
        const changes: CellChange[] = [];
        for (let r = 0; r < rowCount; r++) {
            const destRow = anchor.row + r;
            if (destRow >= tableRowCount) break;
            for (let c = 0; c < columnCount; c++) {
                const destColumn = anchor.column + c;
                if (destColumn >= tableColumnCount) break;
                changes.push({ row: destRow, column: destColumn, oldValue: this.table.getCellValueAt(destRow, destColumn), newValue: sourceData[r][c] });
            }
        }
        const pasteEndRow = Math.min(anchor.row + rowCount - 1, tableRowCount - 1);
        const pasteEndColumn = Math.min(anchor.column + columnCount - 1, tableColumnCount - 1);
        const pasteRange = { startRow: anchor.row, startColumn: anchor.column, endRow: pasteEndRow, endColumn: pasteEndColumn };
        this.applyPasteChanges(changes, pasteRange, copyRange);
    }

    /**
     * 倍数ペースト：選択範囲全体にコピーデータを繰り返しfill
     */
    private pasteWithFill(sourceData: string[][], selectionRange: CellRange, copyRange: CellRange): void {
        const copyRowCount = sourceData.length;
        const copyColumnCount = sourceData[0].length;
        const tableRowCount = this.table.getLogicalRowCount();
        const tableColumnCount = this.table.getTotalColumnCount();
        const selectionRowCount = selectionRange.endRow - selectionRange.startRow + 1;
        const selectionColumnCount = selectionRange.endColumn - selectionRange.startColumn + 1;
        const changes: CellChange[] = [];
        for (let r = 0; r < selectionRowCount; r++) {
            const destRow = selectionRange.startRow + r;
            if (destRow >= tableRowCount) break;
            const srcRowIndex = r % copyRowCount;
            for (let c = 0; c < selectionColumnCount; c++) {
                const destColumn = selectionRange.startColumn + c;
                if (destColumn >= tableColumnCount) break;
                const srcColumnIndex = c % copyColumnCount;
                changes.push({ row: destRow, column: destColumn, oldValue: this.table.getCellValueAt(destRow, destColumn), newValue: sourceData[srcRowIndex][srcColumnIndex] });
            }
        }
        this.applyPasteChanges(changes, selectionRange, copyRange);
    }

    /**
     * 選択範囲がコピー範囲の倍数かどうかを判定
     */
    private shouldFillSelection(copyRange: CellRange, selectionRange: CellRange): boolean {
        const copyRowCount = copyRange.endRow - copyRange.startRow + 1;
        const copyColumnCount = copyRange.endColumn - copyRange.startColumn + 1;
        const selectionRowCount = selectionRange.endRow - selectionRange.startRow + 1;
        const selectionColumnCount = selectionRange.endColumn - selectionRange.startColumn + 1;

        const isRowMultiple = selectionRowCount >= copyRowCount && selectionRowCount % copyRowCount === 0;
        const isColumnMultiple = selectionColumnCount >= copyColumnCount && selectionColumnCount % copyColumnCount === 0;
        const isLarger = selectionRowCount > copyRowCount || selectionColumnCount > copyColumnCount;

        return isRowMultiple && isColumnMultiple && isLarger;
    }

    /**
     * コピー範囲からペースト
     */
    private pasteFromCopyRange(): void {
        if (!this.selection.hasCopyRange()) return;

        const copyRange = this.selection.getCopyRange();
        const selectionRange = this.selection.getSelectionRange();
        const sourceData = this.getSourceData(copyRange);

        if (this.shouldFillSelection(copyRange, selectionRange)) {
            this.pasteWithFill(sourceData, selectionRange, copyRange);
        } else {
            this.pasteNormal(sourceData, copyRange);
        }
    }

    /**
     * ペースト変更を適用し、選択範囲を更新する
     */
    private applyPasteChanges(changes: CellChange[], pasteRange: CellRange, copyRange: CellRange): void {
        this.applyCellChangesWithHistory(changes, pasteRange, copyRange);
        this.selection.setRange(pasteRange.startRow, pasteRange.startColumn, pasteRange.endRow, pasteRange.endColumn);
    }

    /**
     * セル値変更を適用し、履歴に記録する
     * selection.setRange()は呼ばない（呼び出し元の責任）。
     *
     * バッファ空行（storeRowIndices の範囲外）への変更が含まれる場合、
     * 事前にその行をストアに昇格し、PromoteBufferRowCommand + CellChangeCommand の
     * CompositeCommand として履歴に積む（Undoで正しくストア行を削除できるようにする）。
     */
    private applyCellChangesWithHistory(changes: CellChange[], range: CellRange, copyRange: CellRange): void {
        // バッファ空行への変更を検出して昇格が必要な行を収集し、昇格コマンドを構築する。
        // 同一行に対して重複昇格しないよう domDataRowIndex の Set で管理する。
        // 昇格を実際に行う前に storeRowIndices.length を記録することで Undo 時の対称性を保つ。
        const promoteCommands: PromoteBufferRowCommand[] = [];
        const promotedDomDataRowIndices = new Set<number>();
        for (const change of changes) {
            const domDataRowIndex = change.row - 1; // DOM行インデックス(1始まり) → DOMデータ行インデックス(0始まり)
            if (domDataRowIndex >= 0 && this.table.isBufferRow(domDataRowIndex) && !promotedDomDataRowIndices.has(domDataRowIndex)) {
                // 昇格前の storeRowIndices.length を記録してからコマンドを構築する。
                // promoteBufferRowToStore は引数の行まで間の行をまとめて昇格するため、
                // storeRowIndicesLengthBefore = 昇格直前の length = 降格開始インデックスになる。
                const lengthBefore = this.table.getStoreRowIndices().length;
                // PromoteBufferRowCommand.execute() 内で promoteBufferRowToStore() と applyAutoFillToRow() を両方呼ぶ。
                // ここでは直接昇格せず、コマンド経由で実行することで Redo 時にも FK 自動埋め込みが行われる。
                const command = new PromoteBufferRowCommand(this.table, domDataRowIndex, lengthBefore);
                command.execute();
                promoteCommands.push(command);
                promotedDomDataRowIndices.add(domDataRowIndex);
            }
        }

        const allChanges = this.table.applyCellChanges(changes);

        // 昇格が発生した場合は CompositeCommand として history に積む
        // （昇格だけでセル値変更がない場合も昇格コマンド自体をUndoできるよう記録する）
        if (promoteCommands.length > 0) {
            const meaningfulChanges = allChanges.filter(c => c.oldValue !== c.newValue);
            const commands = [
                ...promoteCommands,
                ...(meaningfulChanges.length > 0
                    ? [new CellChangeCommand(this.table, meaningfulChanges, range, copyRange)]
                    : []),
            ];
            const composite = new CompositeCommand(commands);
            this.history.pushCommand(composite, range, copyRange);
        } else {
            this.history.push({ changes: allChanges, range, copyRange });
        }
    }



    /**
     * 現在のフォーカス列の参照を解決する（動的参照対応）
     * @returns 解決した参照情報、または参照列でない場合は null
     */
    private async resolveReferenceAsync(): Promise<ResolvedReference | null> {
        if (!this.tableData || !this.referenceDataCache) return null;

        const focus = this.selection.getFocus();
        // column=0は行ヘッダーなので、データ列は1から始まる
        const columnIndex = focus.column - this.table.dataColumnOffset();

        if (columnIndex < 0 || columnIndex >= this.tableData.header.length) {
            return null;
        }

        const reference = this.tableData.header[columnIndex].reference;
        if (!reference) return null;

        const expr = parseReferenceExpression(reference);

        if (!isDynamicReference(expr)) {
            // 単純参照の場合
            return {
                tableName: expr.tableName,
                columnName: expr.columnName
            };
        }

        // 動的参照の場合
        return this.resolveDynamicReferenceAsync(expr, focus.row, columnIndex);
    }

    /**
     * 動的参照を解決する
     * @param expr 動的参照式
     * @param rowIndex 現在の行インデックス
     * @param currentDataColumnIndex 動的参照を持つ列自身のデータ列インデックス
     * @returns 解決した参照情報、または解決できない場合は null
     */
    private async resolveDynamicReferenceAsync(expr: DynamicReference, rowIndex: number, currentDataColumnIndex: number): Promise<ResolvedReference | null> {
        if (!this.tableData || !this.referenceDataCache) return null;

        // 1. 同一行の指定カラムの値を取得（ビューの合成ヘッダーではプレフィックス付きのためresolveで解決）
        const valueColumnIndex = this.table.resolveValueColumnIndex(expr.filter.valueColumn, currentDataColumnIndex);
        if (valueColumnIndex === -1) {
            console.warn(`Dynamic reference: column '${expr.filter.valueColumn}' not found in table header`);
            this.notification.show(`動的参照: テーブル '${this.table.tableName}' に列 '${expr.filter.valueColumn}' が見つかりません`);
            return null;
        }

        // column=0は行ヘッダー（blame列が有効な場合はcolumn=1がblame列）なので、データ列オフセットを加算する
        const cellValue = this.table.getCellValueAt(rowIndex, valueColumnIndex + this.table.dataColumnOffset());
        if (cellValue === '') {
            // 値が空の場合は参照を解決できない（データ欠損であり、スキーマ設定ミスではない）
            return null;
        }

        // 2. フィルタテーブルの全データを取得
        const fullData = await this.referenceDataCache.getFullDataAsync(expr.filter.tableName);
        if (fullData.rows.size === 0) {
            console.warn(`Dynamic reference: table '${expr.filter.tableName}' has no data`);
            this.notification.show(`動的参照: テーブル '${expr.filter.tableName}' のデータが空です`);
            return null;
        }

        // 3. フィルタ列（filterColumn）で値を検索し、lookupColumn / targetColumn の値を取得
        const lookupColumnIndex = fullData.header.indexOf(expr.lookupColumn);
        if (lookupColumnIndex === -1) {
            console.warn(`Dynamic reference: column '${expr.lookupColumn}' not found in table '${expr.filter.tableName}'`);
            this.notification.show(`動的参照: テーブル '${expr.filter.tableName}' に列 '${expr.lookupColumn}' が見つかりません`);
            return null;
        }
        const targetColumnIndex = fullData.header.indexOf(expr.targetColumn);
        if (targetColumnIndex === -1) {
            console.warn(`Dynamic reference: column '${expr.targetColumn}' not found in table '${expr.filter.tableName}'`);
            this.notification.show(`動的参照: テーブル '${expr.filter.tableName}' に列 '${expr.targetColumn}' が見つかりません`);
            return null;
        }

        const row = this.referenceDataCache.findRowByColumn(fullData, expr.filter.filterColumn, cellValue);
        if (!row) {
            console.warn(`Dynamic reference: value '${cellValue}' not found in column '${expr.filter.filterColumn}' of table '${expr.filter.tableName}'`);
            this.notification.show(`動的参照: テーブル '${expr.filter.tableName}' の列 '${expr.filter.filterColumn}' で値 '${cellValue}' が見つかりません`);
            return null;
        }

        const targetTableName = row[lookupColumnIndex];
        if (targetTableName === '') {
            console.warn(`Dynamic reference: column '${expr.lookupColumn}' is empty for '${expr.filter.filterColumn}'='${cellValue}'`);
            return null;
        }
        const resolvedTargetColumn = row[targetColumnIndex];
        if (resolvedTargetColumn === '') {
            console.warn(`Dynamic reference: column '${expr.targetColumn}' is empty for '${expr.filter.filterColumn}'='${cellValue}'`);
            return null;
        }

        // 4. 解決した参照を返す
        return {
            tableName: targetTableName,
            columnName: resolvedTargetColumn
        };
    }

    /**
     * 参照列の場合にドロップダウンを表示してセル編集モードを開始
     * @param preserveContent trueの場合、セルの内容を保持する（ダブルクリック時）
     */
    async enableCellEditModeWithDropdownAsync(preserveContent: boolean): Promise<boolean> {
        // 読み取り専用（ミニEditorTable）では編集UIを表示しない
        if (this.readOnly) return false;
        if (!this.referenceDataCache || !this.dropdownInput || !this.textField) {
            return false;
        }

        // 参照を解決（動的参照対応）
        let resolvedReference = await this.resolveReferenceAsync();

        // 明示的な参照がない場合、逆参照されているPK列かチェック
        if (!resolvedReference && this.tableData) {
            const focus = this.selection.getFocus();
            const columnIndex = focus.column - this.table.dataColumnOffset();
            if (columnIndex >= 0
                && columnIndex < this.tableData.header.length
                && this.tableData.primaryKeyColumns.includes(this.tableData.header[columnIndex].name)
                && this.table.hasReverseReferences()) {
                resolvedReference = {
                    tableName: this.table.tableName,
                    columnName: this.tableData.header[columnIndex].name,
                };
            }
        }

        if (!resolvedReference) {
            return false;
        }

        try {
            // 参照テーブルデータを取得
            const refData = await this.referenceDataCache.get(resolvedReference.tableName);

            // アイテムが空の場合は通常入力を使用
            if (refData.items.length === 0) {
                return false;
            }

            // バーチャルスクロールにより対象行がDOMに存在しない場合があるため、
            // セル矩形を取得する前に行をDOMに確保する
            const focus = this.selection.getFocus();
            this.table.ensureRowVisible(focus.row);

            // セルの位置を取得
            // ビューポート絶対座標をそのまま渡す（GridTextField.show() 内で補正する）
            const target = getTarget(this.table, this.selection);
            const cellRect = target.cellRect;
            const rect = new DOMRect(cellRect.left - 1, cellRect.top, cellRect.width + 1, cellRect.height);

            // preserveContent=falseの場合（キー入力）はセル内容を初期化する（通常のセル編集と同様）
            const initialValue = preserveContent ? target.cellValue : '';

            // 入力フィールドを表示（GridTextFieldを使用）
            this.textField.show(rect, initialValue, preserveContent);
            this.visible = true;
            this.dropdownActive = true;

            // ドロップダウンリストを表示（参照先テーブル名をクイックビュー用に渡す）
            this.dropdownInput.show(rect, refData.items, initialValue, resolvedReference.tableName);

            return true;
        } catch (e) {
            console.warn(`Failed to load reference data for ${resolvedReference.tableName}`, e);
            this.notification.show('参照データの読み込みに失敗しました');
            return false;
        }
    }

    /**
     * ドロップダウンからの選択を確定
     */
    submitDropdownSelection(id: string): void {
        if (!this.dropdownActive) return;
        const target = getTarget(this.table, this.selection);
        const range = { startRow: target.row, startColumn: target.column, endRow: target.row, endColumn: target.column };
        const changes: CellChange[] = [{ row: target.row, column: target.column, oldValue: target.cellValue, newValue: id }];
        this.applyCellChangesWithHistory(changes, range, this.selection.getCopyRange());
        this.dropdownActive = false;
        this.hide();
        moveCellDownWithinSelection(this.table, this.selection);
    }

    /**
     * ドロップダウンをキャンセル
     */
    cancelDropdown(): void {
        this.dropdownActive = false;

        // 入力フィールドを非表示
        this.hide();
    }

    /**
     * ドロップダウンがアクティブかどうか
     */
    isDropdownActive(): boolean {
        return this.dropdownActive;
    }

    /**
     * bool型セルのトグル操作を行う。
     * 現在のフォーカスセルの値を "1"↔"0" に切り替え、CellChangeCommand で履歴に記録する。
     * ダブルクリックおよびSpaceキーから呼び出される。
     */
    toggleBoolCell(): void {
        if (this.readOnly) return;
        const target = getTarget(this.table, this.selection);
        const oldValue = target.cellValue;
        const newValue = oldValue !== '0' ? '0' : '1';
        const range = { startRow: target.row, startColumn: target.column, endRow: target.row, endColumn: target.column };
        const changes: CellChange[] = [{ row: target.row, column: target.column, oldValue, newValue }];
        this.applyCellChangesWithHistory(changes, range, this.selection.getCopyRange());
    }

    /**
     * フォーカスセルのブックマークをトグルする（Ctrl+Dから呼ばれる）
     * 通常テーブル（タブあり）でのみ動作する
     */
    private toggleBookmark(): void {
        // ミニテーブルや差分タブでは動作しない（正当なガード）
        if (this.table.tab === false) return;
        const focus = this.selection.getFocus();
        const pkValue = this.table.getRowBookmarkKey(focus.row);
        // 修正6: PK値が空の場合はバッファ空行等で設計上ありえない操作 → throw
        if (pkValue === '') throw new Error('[EditorTableHandler.toggleBookmark] pkValue が空文字列: row=' + focus.row);
        // フォーカスセルの列名を取得する（column=0は行ヘッダーなのでデータ列は1始まり）
        const dataColIndex = focus.column - this.table.dataColumnOffset();
        // 修正6: データ列範囲外は設計上ありえない → throw
        if (dataColIndex < 0) throw new Error('[EditorTableHandler.toggleBookmark] dataColIndex < 0: column=' + focus.column);
        if (!this.tableData) throw new Error('[EditorTableHandler.toggleBookmark] tableData が未設定');
        if (dataColIndex >= this.tableData.header.length) throw new Error('[EditorTableHandler.toggleBookmark] dataColIndex が範囲外: ' + dataColIndex);
        const columnName = this.tableData.header[dataColIndex].name;
        const tableName = this.table.tableName;
        // 修正9: EditorTable のファサードメソッド経由でブックマーク操作する
        if (this.table.hasBookmark(tableName, pkValue, columnName)) {
            this.table.removeBookmark(tableName, pkValue, columnName);
            // 修正7: unmarkCellBookmarked をインライン展開
            this.table.getCell(focus.row, focus.column).removeAttribute('data-bookmarked');
        } else {
            const cellValue = this.table.getCellValueAt(focus.row, focus.column);
            this.table.addBookmark(tableName, pkValue, columnName, cellValue);
            // 修正7: markCellBookmarked をインライン展開
            this.table.getCell(focus.row, focus.column).setAttribute('data-bookmarked', '');
        }
    }
}
