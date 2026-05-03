import {Tab} from "../tabs/tab";
import {Editor} from "../editor/editor";
import {EditorTable} from "../editor/editor-table";

/**
 * ツールバー — タブバーの右側に配置するツールボタン群
 *
 * 責務: アクティブなテーブルに対するツール操作のUIを提供する
 */
export class Toolbar {
    private readonly tab: Tab;
    private readonly editor: Editor;
    private readonly formToggleButton: HTMLButtonElement;
    private readonly relationsToggleButton: HTMLButtonElement;

    constructor(containerElement: HTMLElement, tab: Tab, editor: Editor) {
        this.tab = tab;
        this.editor = editor;

        // ER図ボタン（アクティブなテーブルをER図上で表示する）
        const erDiagramButton = this.createButton('ER図で表示', createErDiagramIcon());
        erDiagramButton.addEventListener('click', () => this.openErDiagramForActiveTable());
        containerElement.appendChild(erDiagramButton);

        // CSV エクスポートボタン
        const csvExportButton = this.createButton('CSVをクリップボードにコピー', createCopyIcon());
        csvExportButton.addEventListener('click', () => this.exportCsvToClipboard(csvExportButton));
        containerElement.appendChild(csvExportButton);

        // FormPanel トグルボタン
        const formToggle = this.createButton('フォームビューを開く/閉じる', createFormIcon());
        formToggle.classList.add('toolbar-button-form-toggle');
        formToggle.addEventListener('click', () => { this.tab.toggleFormPanelForActiveRow(); });
        containerElement.appendChild(formToggle);
        this.formToggleButton = formToggle;

        // RelationsPanel トグルボタン
        const relationsToggle = this.createButton('RelationsPanel を開く/閉じる', createRelationsIcon());
        relationsToggle.classList.add('toolbar-button-relations-toggle');
        // 初期状態: RelationsPanel は非表示なのでアクティブクラスは付与しない
        relationsToggle.addEventListener('click', () => { this.tab.toggleRelationsPanelForActiveTab(); });
        containerElement.appendChild(relationsToggle);
        this.relationsToggleButton = relationsToggle;

        // Editor から表示/非表示変更の通知を受け取り、ボタンのアクティブ状態を連動させる
        this.editor.connectVisibilityListener((visible: boolean) => {
            if (visible) {
                this.relationsToggleButton.classList.add('toolbar-button-relations-active');
            } else {
                this.relationsToggleButton.classList.remove('toolbar-button-relations-active');
            }
        });

        this.tab.connectFormPanelVisibilityListener((visible: boolean) => {
            if (visible) {
                this.formToggleButton.classList.add('toolbar-button-form-active');
            } else {
                this.formToggleButton.classList.remove('toolbar-button-form-active');
            }
        });
    }

    private createButton(title: string, icon: SVGSVGElement): HTMLButtonElement {
        const button = document.createElement('button');
        button.classList.add('toolbar-button');
        button.title = title;
        button.appendChild(icon);
        return button;
    }

    private openErDiagramForActiveTable(): void {
        const tableName = this.tab.getActiveTabName();
        if (tableName === false) return;
        this.tab.openErDiagramAndFocusTable(tableName);
    }

    private exportCsvToClipboard(button: HTMLButtonElement): void {
        const state = this.tab.getActiveTabState();
        if (!state) return;
        const csv = buildCsvWithHints(state.editorTable);
        navigator.clipboard.writeText(csv).then(() => {
            button.classList.add('toolbar-button-copied');
            button.addEventListener('animationend', () => {
                button.classList.remove('toolbar-button-copied');
            }, { once: true });
        }).catch(err => {
            console.error('クリップボードへの書き込みに失敗しました:', err);
        });
    }
}

/**
 * アクティブなテーブルのDOMからCSVを生成する
 * 形式: ヘッダー行（行番号列は空）+ データ行（行番号, セル値+ヒント句）
 */
function buildCsvWithHints(editorTable: EditorTable): string {
    const columnCount = editorTable.getColumnCount();
    const rowCount = editorTable.getLogicalRowCount();
    const dataColOffset = editorTable.dataColumnOffset();
    const lines: string[] = [];
    // ヘッダー行: 行番号列は空、以降はカラム名
    const headerCells: string[] = [''];
    for (let col = 0; col < columnCount; col++) {
        headerCells.push(escapeCsvField(editorTable.getColumnHeaderValue(col)));
    }
    lines.push(headerCells.join(','));
    // データ行: 全セルが空の行に達したら終了（パディング行を除外）
    // 仮想スクロールでDOM外の行もストアから値を取得するため getCellValueAt を使う
    for (let row = 1; row < rowCount; row++) {
        let hasValue = false;
        const cellTexts: string[] = [];
        for (let col = 0; col < columnCount; col++) {
            const value = editorTable.getCellValueAt(row, col + dataColOffset);
            // 参照ヒントはDOM外の行では取得できないため値のみ出力する
            const hint = editorTable.getReferenceHintText(row, col);
            const output = hint !== null ? value + ' ' + hint : value;
            cellTexts.push(output);
            if (value !== '') hasValue = true;
        }
        if (!hasValue) break;
        // 行番号は1始まりのデータ行インデックス
        const rowCells = [String(row)];
        for (const text of cellTexts) {
            rowCells.push(escapeCsvField(text));
        }
        lines.push(rowCells.join(','));
    }
    return lines.join('\r\n');
}

/** CSVフィールドにカンマ・ダブルクォート・改行が含まれる場合はダブルクォートで囲む */
function escapeCsvField(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
        return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
}

/** ER図アイコン（アクティビティバーと同じデザイン: 2つの矩形ノード＋接続線） */
function createErDiagramIcon(): SVGSVGElement {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" class="toolbar-icon">
  <rect x="2" y="3" width="8" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/>
  <rect x="14" y="15" width="8" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/>
  <path d="M6 9V12H18V15" stroke="currentColor" stroke-width="1.5"/>
</svg>`;
    return wrapper.firstElementChild as SVGSVGElement;
}

/** コピーアイコン（2つの重なったドキュメント）をSVGで作成する */
function createCopyIcon(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.classList.add('toolbar-icon');
    // 背面ドキュメント（右上にオフセット）
    const back = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    back.setAttribute('x', '5');
    back.setAttribute('y', '1');
    back.setAttribute('width', '9');
    back.setAttribute('height', '11');
    back.setAttribute('rx', '1');
    back.setAttribute('fill', 'none');
    back.setAttribute('stroke', 'currentColor');
    back.setAttribute('stroke-width', '1.2');
    svg.appendChild(back);
    // 前面ドキュメント（背景色で塗りつぶして背面を部分的に隠す）
    const front = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    front.setAttribute('x', '2');
    front.setAttribute('y', '4');
    front.setAttribute('width', '9');
    front.setAttribute('height', '11');
    front.setAttribute('rx', '1');
    front.setAttribute('fill', 'var(--background-color)');
    front.setAttribute('stroke', 'currentColor');
    front.setAttribute('stroke-width', '1.2');
    svg.appendChild(front);
    return svg;
}

/** フォームビューアイコン（右ペインのフォーム入力を表す）をSVGで作成する */
function createFormIcon(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.classList.add('toolbar-icon');

    const frame = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    frame.setAttribute('x', '2');
    frame.setAttribute('y', '2');
    frame.setAttribute('width', '12');
    frame.setAttribute('height', '12');
    frame.setAttribute('rx', '1.3');
    frame.setAttribute('fill', 'none');
    frame.setAttribute('stroke', 'currentColor');
    frame.setAttribute('stroke-width', '1.2');
    svg.appendChild(frame);

    for (const y of ['5', '8', '11']) {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        label.setAttribute('x1', '4');
        label.setAttribute('y1', y);
        label.setAttribute('x2', '6');
        label.setAttribute('y2', y);
        label.setAttribute('stroke', 'currentColor');
        label.setAttribute('stroke-width', '1.2');
        label.setAttribute('stroke-linecap', 'round');
        svg.appendChild(label);

        const value = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        value.setAttribute('x1', '8');
        value.setAttribute('y1', y);
        value.setAttribute('x2', '12');
        value.setAttribute('y2', y);
        value.setAttribute('stroke', 'currentColor');
        value.setAttribute('stroke-width', '1.2');
        value.setAttribute('stroke-linecap', 'round');
        svg.appendChild(value);
    }

    return svg;
}

/**
 * Relationsパネルアイコン（左右パネル分割のイメージ）をSVGで作成する
 * VSCodeの「パネルを右に分割」アイコンに似たデザイン
 */
function createRelationsIcon(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.classList.add('toolbar-icon');
    // 外枠
    const outer = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    outer.setAttribute('x', '1');
    outer.setAttribute('y', '2');
    outer.setAttribute('width', '14');
    outer.setAttribute('height', '12');
    outer.setAttribute('rx', '1');
    outer.setAttribute('fill', 'none');
    outer.setAttribute('stroke', 'currentColor');
    outer.setAttribute('stroke-width', '1.2');
    svg.appendChild(outer);
    // 中央の縦分割線（左右パネルの境界を表す）
    const divider = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    divider.setAttribute('x1', '9');
    divider.setAttribute('y1', '2');
    divider.setAttribute('x2', '9');
    divider.setAttribute('y2', '14');
    divider.setAttribute('stroke', 'currentColor');
    divider.setAttribute('stroke-width', '1.2');
    svg.appendChild(divider);
    return svg;
}
