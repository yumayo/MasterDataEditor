import {EditorTable} from "../editor/editor-table";
import {Utility} from "../core/utility";
import {Selection} from "../editor/selection";

/**
 * テキスト入力フィールドの表示を管理するクラス
 *
 * 責務：
 * - テキスト入力フィールドの表示位置・サイズ調整
 * - テキスト内容の設定・取得
 *
 * element の所有、キーボードイベント、ペースト処理は EditorTableHandler が担当
 */
export class GridTextField {

    private readonly element: HTMLElement;
    /** grid-textfield の position:absolute 基準となるコンテナ（position:relative） */
    private readonly container: HTMLElement;
    private readonly table: EditorTable;
    private readonly selection: Selection;

    constructor(element: HTMLElement, container: HTMLElement, table: EditorTable, selection: Selection) {
        this.element = element;
        this.container = container;
        this.table = table;
        this.selection = selection;
    }

    /**
     * テキスト入力フィールドを表示する
     *
     * rect はセルのビューポート絶対座標（EditorTableHandler で計算済み）。
     * grid-textfield は position:absolute なので、コンストラクタで受け取った container の
     * BoundingClientRect を引いて相対座標に変換する。
     * container はスクロールコンテナの内側に配置された通常フロー要素（position:relative）であり、
     * getBoundingClientRect() がスクロールに追従するため scrollLeft/scrollTop の加算は不要。
     */
    show(rect: DOMRect, cellText: string, preserveContent: boolean): void {
        this.element.classList.add('grid-textfield-active');

        // パーキング（position:fixed + opacity:0、EditorTableHandler.hide() 参照）を解除して
        // CSS の position:absolute に戻す
        this.element.style.position = '';
        this.element.style.opacity = '';

        // container（position:relative の含有ブロック）基準の相対座標を計算する
        const containerRect = this.container.getBoundingClientRect();
        this.element.style.left = (rect.left - containerRect.left) + 'px';
        this.element.style.top = (rect.top - containerRect.top) + 'px';

        if (preserveContent) {
            // ダブルクリック時: セルのテキストをコピーする
            this.element.textContent = cellText;
            this.resizeTextField(cellText);

            // カーソルを一番後ろに設定する
            if (cellText.length > 0) {
                const range = document.createRange();
                range.selectNodeContents(this.element);
                range.collapse(false);
                const windowSelection = window.getSelection();
                if (windowSelection) {
                    windowSelection.removeAllRanges();
                    windowSelection.addRange(range);
                }
            }
        } else {
            // キーボード入力時: セルの内容をクリアして新規入力
            this.element.textContent = null;
            this.resizeTextField('');
        }
    }

    /**
     * テキストフィールドの内容を取得する
     */
    getTextContent(): string {
        return this.element.textContent ?? '';
    }

    /**
     * テキストフィールドのサイズを調整する
     */
    resizeTextField(textContent: string): void {
        const focus = this.selection.getFocus();
        const textFieldWidth = Utility.getTextWidth(textContent, 'normal 13px sans-serif');

        const { width, cellHeight } = this.table.calculateTextFieldWidth(focus.row, focus.column, textFieldWidth);

        // 幅と高さを設定
        this.element.style.width = width + 'px';
        this.element.style.height = cellHeight + 'px';
        // lineHeightはテキスト1行分の高さに固定（セルの高さに依存させない）
    }
}
