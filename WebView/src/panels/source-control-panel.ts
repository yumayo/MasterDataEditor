import { gitStatusAsync, gitShowFreshAsync, gitAddAsync, gitResetAsync, gitDiscardAsync, GitStatusEntry, invalidateGitStatusCache, invalidateGitShowCache } from '../app/api';
import { readFileAsync } from '../app/api';
import { Tab } from '../tabs/tab';
import { ActivityBar } from '../sidebar/activity-bar';
import { extractFirstLineFromDescription } from '../core/description-utils';

/**
 * ソース管理サイドバーパネル
 * STAGEDセクション（上）とCHANGESセクション（下）で変更ファイル一覧を表示し、
 * クリックで差分タブをエディター領域に表示する
 */
export class SourceControlPanel {
    private readonly element: HTMLElement;
    private readonly changesSection: HTMLElement;
    private readonly stagedSection: HTMLElement;
    private readonly tab: Tab;
    private readonly activityBar: ActivityBar;

    /** refreshAsync / openDiffTabAsync の競合状態を防ぐためのリクエストID */
    private currentRequestId: number;

    constructor(tab: Tab, activityBar: ActivityBar) {
        this.tab = tab;
        this.activityBar = activityBar;
        this.currentRequestId = 0;

        this.element = document.createElement('div');
        this.element.classList.add('source-control-panel');

        const header = document.createElement('div');
        header.classList.add('sidebar-panel-header');
        header.textContent = 'SOURCE CONTROL';
        this.element.appendChild(header);

        // STAGEDセクション（上）
        const stagedHeader = document.createElement('div');
        stagedHeader.classList.add('source-control-section-header');
        stagedHeader.textContent = 'STAGED';
        this.element.appendChild(stagedHeader);

        this.stagedSection = document.createElement('div');
        this.stagedSection.classList.add('source-control-staged-section');
        this.element.appendChild(this.stagedSection);

        // CHANGESセクション（下）
        const changesHeader = document.createElement('div');
        changesHeader.classList.add('source-control-section-header');
        changesHeader.textContent = 'CHANGES';
        this.element.appendChild(changesHeader);

        this.changesSection = document.createElement('div');
        this.changesSection.classList.add('source-control-changes-section');
        this.element.appendChild(this.changesSection);
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
        // gitアイコンクリック時はキャッシュをクリアして最新の状態を取得する
        invalidateGitStatusCache();
        invalidateGitShowCache();
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
     * スキーマをすべて並列取得してから各セクションを構築する
     * 非同期中断が2箇所あるため requestId で競合状態を防ぐ
     */
    async refreshAsync(): Promise<void> {
        const requestId = ++this.currentRequestId;
        const result = await gitStatusAsync();
        if (requestId !== this.currentRequestId) return;
        const allEntries = [...result.staged, ...result.changes];

        // 全スキーマを並列取得してdescriptionを抽出する
        // システム境界（ファイルI/O）のエラーは握り潰して空文字列を返す
        const descriptions = await Promise.all(
            allEntries.map(async entry => {
                try {
                    const schemaJson = await readFileAsync(`schema/${entry.tableName}.json`);
                    const schema = JSON.parse(schemaJson) as { description?: string };
                    return schema.description ?? '';
                } catch {
                    return '';
                }
            })
        );
        if (requestId !== this.currentRequestId) return;

        // STAGEDセクションを更新する（isStaged=true）
        this.stagedSection.replaceChildren();
        result.staged.forEach((entry, index) => {
            this.stagedSection.appendChild(this.createFileItem(entry, true, descriptions[index]));
        });

        // CHANGESセクションを更新する（isStaged=false）
        this.changesSection.replaceChildren();
        result.changes.forEach((entry, index) => {
            this.changesSection.appendChild(this.createFileItem(entry, false, descriptions[result.staged.length + index]));
        });

        // アクティビティバーのバッジを changes + staged の合計件数で更新する
        this.activityBar.updateSourceControlBadge(result.changes.length + result.staged.length);
    }

    /**
     * ファイルアイテム（クリッカブル）のDOM要素を生成する
     * ExplorerFileと同様の2行構造（テーブル名 + description）で表示する
     * isStaged: true の場合は staged セクション（左右ともに読み取り専用）
     * description: "" の場合は description行を非表示にする
     */
    private createFileItem(entry: GitStatusEntry, isStaged: boolean, description: string): HTMLElement {
        const item = document.createElement('div');
        item.classList.add('source-control-file-item');

        // テキスト領域（テーブル名 + description）を左側に配置する
        const textArea = document.createElement('div');
        textArea.classList.add('source-control-file-text');

        // テーブル名は上段（主情報）に表示する
        const nameEl = document.createElement('span');
        nameEl.classList.add('explorer-file-name');
        nameEl.textContent = entry.tableName;
        textArea.appendChild(nameEl);

        // description が存在する場合は1行目のみ使用して下段（補助情報）に表示する
        if (description !== '') {
            const firstLine = extractFirstLineFromDescription(description);
            if (firstLine !== null) {
                const descEl = document.createElement('span');
                descEl.classList.add('explorer-file-description');
                descEl.textContent = firstLine;
                textArea.appendChild(descEl);
            }
        }
        item.appendChild(textArea);

        // アクションボタン領域（ホバー時に表示）
        const actions = document.createElement('div');
        actions.classList.add('source-control-actions');

        actions.appendChild(this.createActionButton(
            '<svg viewBox="0 0 16 16"><path d="M4 2.5h5.5l2.5 2.5v8.5H4z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.5 2.5V5H12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
            'open-file', 'エディターで開く',
            (e: MouseEvent) => {
                e.stopPropagation();
                this.openFileInEditor(entry, description);
            },
        ));

        if (isStaged) {
            // stagedセクション: 「-」ボタン（unstage）のみ
            // git checkout -- はステージを解除しないためdiscardボタンは置かない
            actions.appendChild(this.createActionButton(
                '<svg viewBox="0 0 16 16"><path d="M3 8h10" stroke="currentColor" stroke-width="1.5"/></svg>',
                'unstage', 'ステージ解除',
                (e: MouseEvent) => {
                    e.stopPropagation();
                    this.executeActionAsync(() => gitResetAsync(entry.path));
                },
            ));
        } else {
            // changesセクション: 「+」ボタン（stage）+ 「戻る矢印」ボタン（discard）
            actions.appendChild(this.createActionButton(
                '<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5"/></svg>',
                'stage', 'ステージ',
                (e: MouseEvent) => {
                    e.stopPropagation();
                    this.executeActionAsync(() => gitAddAsync(entry.path));
                },
            ));
            actions.appendChild(this.createActionButton(
                '<svg viewBox="0 0 16 16"><path d="M3 8h8M7 4l-4 4 4 4" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>',
                'discard', '変更を破棄',
                (e: MouseEvent) => {
                    e.stopPropagation();
                    if (!window.confirm('変更を破棄しますか？この操作は元に戻せません。')) return;
                    this.executeActionAsync(() => gitDiscardAsync(entry.path));
                },
            ));
        }
        item.appendChild(actions);

        item.addEventListener('click', () => {
            // DOMをSSOTとしてアクティブクラスを切り替える
            // パネル全体から既存のアクティブクラスをすべて除去してからクリックされた要素に付与する
            this.element.querySelectorAll('.source-control-file-item-active').forEach(el => {
                el.classList.remove('source-control-file-item-active');
            });
            item.classList.add('source-control-file-item-active');
            this.openDiffTabAsync(entry, isStaged).catch(e => { console.error('差分タブ表示失敗', e); });
        });
        return item;
    }

    /**
     * アクションボタン（SVGアイコン付き）を生成する
     */
    private createActionButton(svgHtml: string, label: string, tooltip: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.classList.add('source-control-action-btn');
        btn.setAttribute('data-action', label);
        btn.title = tooltip;
        btn.setAttribute('aria-label', tooltip);
        btn.innerHTML = svgHtml;
        btn.addEventListener('click', onClick);
        return btn;
    }

    /**
     * Source Control上のファイルを差分タブではなく通常エディターで開く。
     * ExplorerFile.onClick と同じく TabButton を作成してクリックする経路に揃える。
     */
    private openFileInEditor(entry: GitStatusEntry, description: string): void {
        ++this.currentRequestId;
        this.element.querySelectorAll('.source-control-file-item-active').forEach(el => {
            el.classList.remove('source-control-file-item-active');
        });
        const tabButton = this.tab.append(entry.tableName, description === '' ? null : description);
        tabButton.click();
    }

    /**
     * git操作を実行し、操作中はパネル内のアクションボタンを無効化する
     * 完了後にrefreshAsyncでパネルを再描画する
     */
    private executeActionAsync(action: () => Promise<void>): void {
        this.element.classList.add('source-control-busy');
        action()
            .then(() => this.refreshAsync())
            .catch(err => { console.error('git操作失敗', err); })
            .finally(() => { this.element.classList.remove('source-control-busy'); });
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
            this.tab.openDiffTab(tableName, isStaged, schemaJson, headerOnlyCsv, currentCsv, entry.path, null, null);
        } else {
            // 既存ファイル: スキーマ・現在版CSV・HEAD版CSVを並列取得する
            const [schemaJson, currentCsv, headCsv] = await Promise.all([
                readFileAsync(`schema/${tableName}.json`),
                readFileAsync(`data/${tableName}.csv`),
                gitShowFreshAsync(entry.path),
            ]);
            if (requestId !== this.currentRequestId) return;
            this.tab.openDiffTab(tableName, isStaged, schemaJson, headCsv, currentCsv, entry.path, null, null);
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
