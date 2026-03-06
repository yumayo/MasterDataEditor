import {Tab} from "./tab";
import {EditorTable} from "./editor-table";
import {readCellValue} from "./view-group-query";

/**
 * ツールバー — タブバーの右側に配置するツールボタン群
 *
 * 責務: アクティブなテーブルに対するツール操作のUIを提供する
 */
export class Toolbar {
    private readonly tab: Tab;

    constructor(containerElement: HTMLElement, tab: Tab) {
        this.tab = tab;
        const csvExportButton = this.createButton('CSVをクリップボードにコピー', createCopyIcon());
        csvExportButton.addEventListener('click', () => this.exportCsvToClipboard(csvExportButton));
        containerElement.appendChild(csvExportButton);
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
            const value = readCellValue(cell);
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
