import { gitStatusAsync, gitShowAsync, GitStatusEntry } from './api';
import { readFileAsync } from './api';
import { Tab } from './tab';

/**
 * ソース管理サイドバーパネル
 * CHANGESセクションとSTAGEDセクションで変更ファイル一覧を表示し、
 * クリックで差分タブをエディター領域に表示する
 */
export class SourceControlPanel {
    private readonly element: HTMLElement;
    private readonly changesSection: HTMLElement;
    private readonly stagedSection: HTMLElement;
    private readonly tab: Tab;

    /** 差分タブ表示リクエストの競合状態を防ぐためのリクエストID */
    private currentRequestId: number;

    constructor(tab: Tab) {
        this.tab = tab;
        this.currentRequestId = 0;

        this.element = document.createElement('div');
        this.element.classList.add('source-control-panel');

        const header = document.createElement('div');
        header.classList.add('sidebar-panel-header');
        header.textContent = 'SOURCE CONTROL';
        this.element.appendChild(header);

        // CHANGESセクション
        const changesHeader = document.createElement('div');
        changesHeader.classList.add('source-control-section-header');
        changesHeader.textContent = 'CHANGES';
        this.element.appendChild(changesHeader);

        this.changesSection = document.createElement('div');
        this.changesSection.classList.add('source-control-changes-section');
        this.element.appendChild(this.changesSection);

        // STAGEDセクション
        const stagedHeader = document.createElement('div');
        stagedHeader.classList.add('source-control-section-header');
        stagedHeader.textContent = 'STAGED';
        this.element.appendChild(stagedHeader);

        this.stagedSection = document.createElement('div');
        this.stagedSection.classList.add('source-control-staged-section');
        this.element.appendChild(this.stagedSection);
    }

    /**
     * パネルを親要素に追加する
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    /**
     * パネルを表示してgit statusを更新する
     */
    show(): void {
        this.element.classList.add('sidebar-panel-active');
        // 表示時に毎回最新の状態を取得する（fire-and-forget、エラーは握り潰さない）
        this.refreshAsync().catch(e => { console.error('git status 取得失敗', e); });
    }

    /**
     * パネルを非表示にする
     */
    hide(): void {
        this.element.classList.remove('sidebar-panel-active');
    }

    /**
     * git status を呼んで変更ファイル一覧を更新する
     */
    async refreshAsync(): Promise<void> {
        const result = await gitStatusAsync();

        // CHANGESセクションを更新する（isStaged=false）
        this.changesSection.replaceChildren();
        for (const entry of result.changes) {
            this.changesSection.appendChild(this.createFileItem(entry, false));
        }

        // STAGEDセクションを更新する（isStaged=true）
        this.stagedSection.replaceChildren();
        for (const entry of result.staged) {
            this.stagedSection.appendChild(this.createFileItem(entry, true));
        }
    }

    /**
     * ファイルアイテム（クリッカブル）のDOM要素を生成する
     * isStaged: true の場合は staged セクション（左右ともに読み取り専用）
     */
    private createFileItem(entry: GitStatusEntry, isStaged: boolean): HTMLElement {
        const item = document.createElement('div');
        item.classList.add('source-control-file-item');
        item.textContent = entry.tableName;
        item.addEventListener('click', () => {
            this.openDiffTabAsync(entry, isStaged).catch(e => { console.error('差分タブ表示失敗', e); });
        });
        return item;
    }

    /**
     * 指定したファイルの差分タブをエディター領域に表示する
     * HEAD版CSVをgit showで取得し、現在版CSVとスキーマを読み込んでDiffTabを構築する
     * isNew=true の場合は新規ファイルのため git show を呼ばずヘッダー行のみのCSVを使う
     * isStaged=true の場合は左右ともに読み取り専用モードで表示する
     */
    private async openDiffTabAsync(entry: GitStatusEntry, isStaged: boolean): Promise<void> {
        // リクエストIDをインクリメントしてこの呼び出しの識別子を確保する
        // await 後にIDが変わっていれば後続リクエストが開始されているため描画をスキップする
        const requestId = ++this.currentRequestId;

        const tableName = entry.tableName;

        if (entry.isNew) {
            // 新規ファイル: HEAD版は存在しない。スキーマから列ヘッダーのみのCSVを生成する
            const [schemaJson, currentCsv] = await Promise.all([
                readFileAsync(`schema/${tableName}.json`),
                readFileAsync(`data/${tableName}.csv`),
            ]);
            if (requestId !== this.currentRequestId) return;
            // ヘッダー行のみのCSVをHEAD版として渡す（空のHEAD状態を明示的に表現する）
            const headerOnlyCsv = this.buildHeaderOnlyCsv(schemaJson);
            this.tab.openDiffTab(tableName, isStaged, schemaJson, headerOnlyCsv, currentCsv);
        } else {
            // 既存ファイル: スキーマ・現在版CSV・HEAD版CSVを並列取得する
            const [schemaJson, currentCsv, headCsv] = await Promise.all([
                readFileAsync(`schema/${tableName}.json`),
                readFileAsync(`data/${tableName}.csv`),
                gitShowAsync(entry.path),
            ]);
            if (requestId !== this.currentRequestId) return;
            this.tab.openDiffTab(tableName, isStaged, schemaJson, headCsv, currentCsv);
        }
    }

    /**
     * スキーマJSONからヘッダー行のみのCSVを生成する
     * 新規ファイルのHEAD版（空の状態）を表現するために使用する
     */
    private buildHeaderOnlyCsv(schemaJson: string): string {
        const schema = JSON.parse(schemaJson) as { header: { name: string }[] };
        const headerNames = schema.header.map(col => col.name);
        return headerNames.join(',');
    }
}
