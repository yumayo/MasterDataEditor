import { gitStatusAsync, gitShowAsync, GitStatusEntry } from './api';
import { readFileAsync } from './api';
import { DiffView } from './diff-view';
import { Editor } from './editor';

/**
 * ソース管理サイドバーパネル
 * CHANGESセクションとSTAGEDセクションで変更ファイル一覧を表示し、
 * クリックで差分ビューをエディター領域に表示する
 */
export class SourceControlPanel {
    private readonly element: HTMLElement;
    private readonly changesSection: HTMLElement;
    private readonly stagedSection: HTMLElement;
    private readonly editor: Editor;

    /** 差分ビュー表示リクエストの競合状態を防ぐためのリクエストID */
    private currentRequestId: number;

    constructor(editor: Editor) {
        this.editor = editor;
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

        // CHANGESセクションを更新する
        this.changesSection.replaceChildren();
        for (const entry of result.changes) {
            this.changesSection.appendChild(this.createFileItem(entry));
        }

        // STAGEDセクションを更新する
        this.stagedSection.replaceChildren();
        for (const entry of result.staged) {
            this.stagedSection.appendChild(this.createFileItem(entry));
        }
    }

    /**
     * ファイルアイテム（クリッカブル）のDOM要素を生成する
     */
    private createFileItem(entry: GitStatusEntry): HTMLElement {
        const item = document.createElement('div');
        item.classList.add('source-control-file-item');
        item.textContent = entry.tableName;
        item.addEventListener('click', () => {
            this.openDiffViewAsync(entry).catch(e => { console.error('差分ビュー表示失敗', e); });
        });
        return item;
    }

    /**
     * 指定したファイルの差分ビューをエディター領域に表示する
     * HEAD版CSVをgit showで取得し、現在版CSVとスキーマを読み込んでDiffViewを構築する
     * isNew=true の場合は新規ファイルのため git show を呼ばずヘッダー行のみのCSVを使う
     */
    private async openDiffViewAsync(entry: GitStatusEntry): Promise<void> {
        // リクエストIDをインクリメントしてこの呼び出しの識別子を確保する
        // await 後にIDが変わっていれば後続リクエストが開始されているため描画をスキップする
        const requestId = ++this.currentRequestId;

        // 既存の差分ビューを閉じてからエディターを通常状態に戻す
        // DiffView の参照は Editor が管理する（hasDiffView() で存在確認）
        this.editor.hideDiffView();

        const tableName = entry.tableName;

        if (entry.isNew) {
            // 新規ファイル: HEAD版は存在しない。スキーマから列ヘッダーのみのCSVを生成する
            const [schemaJson, currentCsv] = await Promise.all([
                readFileAsync(`schema/${tableName}.json`),
                readFileAsync(`data/${tableName}.csv`),
            ]);
            // await 完了後に別のリクエストが開始されていれば描画しない
            if (requestId !== this.currentRequestId) return;
            // ヘッダー行のみのCSVをHEAD版として渡す（空のHEAD状態を明示的に表現する）
            const headerOnlyCsv = this.buildHeaderOnlyCsv(schemaJson);
            const diffView = new DiffView(tableName, schemaJson, headerOnlyCsv, currentCsv);
            this.editor.showDiffView(diffView);
        } else {
            // 既存ファイル: スキーマ・現在版CSV・HEAD版CSVを並列取得する
            const [schemaJson, currentCsv, headCsv] = await Promise.all([
                readFileAsync(`schema/${tableName}.json`),
                readFileAsync(`data/${tableName}.csv`),
                gitShowAsync(entry.path),
            ]);
            // await 完了後に別のリクエストが開始されていれば描画しない
            if (requestId !== this.currentRequestId) return;
            const diffView = new DiffView(tableName, schemaJson, headCsv, currentCsv);
            this.editor.showDiffView(diffView);
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
