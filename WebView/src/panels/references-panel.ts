import {ReverseReferenceEntry} from "../references/reverse-reference-resolver";
import {Tab} from "../tabs/tab";

/**
 * REFERENCESパネル
 * PK値に対する逆参照エントリをテーブル名フォルダ形式で表示する
 */
export class ReferencesPanel {
    private readonly element: HTMLElement;
    private readonly pkLabelElement: HTMLElement;
    private readonly contentElement: HTMLElement;
    private readonly tab: Tab;

    constructor(tab: Tab) {
        this.tab = tab;
        this.element = document.createElement('div');
        this.element.classList.add('sidebar-panel', 'references-panel');

        const headerElement = document.createElement('div');
        headerElement.classList.add('sidebar-panel-header');
        headerElement.textContent = 'REFERENCES';
        this.element.appendChild(headerElement);

        this.pkLabelElement = document.createElement('div');
        this.pkLabelElement.classList.add('references-panel-pk-label');
        this.element.appendChild(this.pkLabelElement);

        this.contentElement = document.createElement('div');
        this.contentElement.classList.add('references-panel-content');
        this.element.appendChild(this.contentElement);
    }

    /**
     * パネルを親要素に追加する
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    /**
     * パネルを表示する
     */
    show(): void {
        this.element.classList.add('sidebar-panel-active');
    }

    /**
     * パネルを非表示にする
     */
    hide(): void {
        this.element.classList.remove('sidebar-panel-active');
    }

    /**
     * 逆参照エントリを表示する
     */
    showEntries(pkValue: string, entries: ReverseReferenceEntry[]): void {
        this.pkLabelElement.textContent = `id: ${pkValue}`;
        this.contentElement.replaceChildren();

        for (const entry of entries) {
            const folder = this.createFolder(entry);
            this.contentElement.appendChild(folder);
        }
    }

    /**
     * テーブル名フォルダを作成する
     * showEntries内のループで各エントリに対して呼ばれる
     */
    private createFolder(entry: ReverseReferenceEntry): HTMLElement {
        const folder = document.createElement('div');
        folder.classList.add('references-folder');

        const header = document.createElement('div');
        header.classList.add('references-folder-header');
        const count = entry.rows.length;
        header.textContent = `▼ ${entry.childTableName} (${count}件)`;

        const content = document.createElement('div');
        content.classList.add('references-folder-content');

        for (const refRow of entry.rows) {
            const row = document.createElement('div');
            row.classList.add('references-row');
            row.textContent = refRow.displayText !== '' ? refRow.displayText : 'id:' + refRow.pkValue;
            row.addEventListener('click', () => {
                this.tab.navigateToTableRow(entry.childTableName, refRow.pkValue);
            });
            content.appendChild(row);
        }

        // フォルダの開閉
        header.addEventListener('click', () => {
            const isCollapsed = content.style.display === 'none';
            content.style.display = isCollapsed ? '' : 'none';
            header.textContent = isCollapsed
                ? `▼ ${entry.childTableName} (${count}件)`
                : `▶ ${entry.childTableName} (${count}件)`;
        });

        folder.appendChild(header);
        folder.appendChild(content);
        return folder;
    }
}
