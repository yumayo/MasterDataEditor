import {Tab} from "./tab";
import {Editor} from "./editor";
import {EditorTable} from "./editor-table";

/**
 * ツールバー — タブバーの右側に配置するツールボタン群
 *
 * 責務: アクティブなテーブルに対するツール操作のUIを提供する
 */
export class Toolbar {
    private readonly tab: Tab;
    private readonly editor: Editor;
    private readonly relationsToggleButton: HTMLButtonElement;

    constructor(containerElement: HTMLElement, tab: Tab, editor: Editor) {
        this.tab = tab;
        this.editor = editor;

        // CSV エクスポートボタン
        const csvExportButton = this.createButton('CSVをクリップボードにコピー', createCopyIcon());
        csvExportButton.addEventListener('click', () => this.exportCsvToClipboard(csvExportButton));
        containerElement.appendChild(csvExportButton);

        // RelationsPanel トグルボタン
        const relationsToggle = this.createButton('RelationsPanel を開く/閉じる', createRelationsIcon());
        relationsToggle.classList.add('toolbar-button-relations-toggle');
        // 初期状態: RelationsPanel は表示されているのでアクティブクラスを付与する
        relationsToggle.classList.add('toolbar-button-relations-active');
        relationsToggle.addEventListener('click', () => { this.editor.toggleRelationsPanel(); });
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
    }

    private createButton(title: string, icon: SVGSVGElement): HTMLButtonElement {
        const button = document.createElement('button');
        button.classList.add('toolbar-button');
        button.title = title;
        button.appendChild(icon);
        return button;
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
    const rowCount = editorTable.getRowCount();
    const lines: string[] = [];
    // ヘッダー行: 行番号列は空、以降はカラム名
    const headerCells: string[] = [''];
    for (let col = 0; col < columnCount; col++) {
        headerCells.push(escapeCsvField(editorTable.getColumnHeaderValue(col)));
    }
    lines.push(headerCells.join(','));
    // データ行: 全セルが空の行に達したら終了（パディング行を除外）
    for (let row = 1; row < rowCount; row++) {
        let hasValue = false;
        const cellTexts: string[] = [];
        for (let col = 1; col <= columnCount; col++) {
            const cell = editorTable.getCell(row, col);
            const value = EditorTable.getCellValue(cell);
            const hintElement = cell.querySelector('.cell-reference-hint');
            let output = value;
            if (hintElement && hintElement.textContent) {
                output = value + ' ' + hintElement.textContent;
            }
            cellTexts.push(output);
            if (value !== '') hasValue = true;
        }
        if (!hasValue) break;
        // 行番号はDOMの行ヘッダーセルから取得
        const rowHeaderCell = editorTable.getCell(row, 0);
        const rowCells = [rowHeaderCell.textContent ?? ''];
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
