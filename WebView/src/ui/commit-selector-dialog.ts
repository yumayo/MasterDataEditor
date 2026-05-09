import {gitLogAsync} from "../app/api";
import type {LogEntry} from "../app/api";

/** openAsync の戻り値型。比較ボタン押下時に左右コミットを返す。キャンセル時は null */
export interface CommitSelection {
    leftCommit: string;
    rightCommit: string;
}

/**
 * コミット選択ダイアログ — バージョン比較機能のモーダルUI
 *
 * タブボタンの右クリックメニュー「バージョン比較...」から開かれる。
 * 左右ペインにコミット一覧を表示し、ユーザーが2つのコミットを選択して
 * 「比較」ボタンを押すと Promise<CommitSelection> で解決する。
 * キャンセル・Esc・オーバーレイクリック時は null で解決する。
 */
export class CommitSelectorDialog {

    /**
     * ダイアログを開く。
     * git log でコミット一覧を取得し、左右ペインに表示する。
     * 多重オープンを防止する（既にダイアログが存在する場合は即座に null を返す）。
     * @param tableName テーブル名（git log の対象ファイルパス解決に使用）
     * @returns 比較ボタン押下時は CommitSelection、キャンセル時は null
     */
    async openAsync(tableName: string): Promise<CommitSelection | null> {
        // 多重オープン防止: 既にダイアログがDOM上に存在する場合はキャンセル扱い
        if (document.querySelector('.commit-selector-dialog') !== null) return null;

        // コミット履歴を取得する
        const logEntries = await gitLogAsync('data/' + tableName + '.csv', 50);

        return new Promise<CommitSelection | null>((resolve) => {
            // resolve が複数回呼ばれないようにガードする
            let resolved = false;
            const resolveOnce = (value: CommitSelection | null) => {
                if (resolved) return;
                resolved = true;
                resolve(value);
            };

            // ダイアログを閉じる共通処理
            const closeDialog = () => {
                dialog.remove();
                document.removeEventListener('keydown', onKeyDown, true);
            };

            // モーダルオーバーレイ（ダイアログ全体）
            const dialog = document.createElement('div');
            dialog.classList.add('commit-selector-dialog');

            // コンテンツ領域（ARIA: dialog ロール + modal + labelledby）
            const content = document.createElement('div');
            content.classList.add('commit-selector-content');
            content.setAttribute('role', 'dialog');
            content.setAttribute('aria-modal', 'true');
            content.setAttribute('aria-labelledby', 'commit-selector-dialog-title');
            dialog.appendChild(content);

            // タイトル
            const title = document.createElement('div');
            title.classList.add('commit-selector-title');
            title.id = 'commit-selector-dialog-title';
            title.textContent = 'バージョン比較 — ' + tableName;
            content.appendChild(title);

            // 左右ペインコンテナ
            const panesContainer = document.createElement('div');
            panesContainer.classList.add('commit-selector-panes');
            content.appendChild(panesContainer);

            // 比較ボタン（先に生成して selectEntry から disabled 制御を行う）
            const compareButton = document.createElement('button');
            compareButton.classList.add('commit-selector-compare-button');
            compareButton.textContent = '比較';
            compareButton.disabled = true;

            // 左右の選択状態を追跡し、比較ボタンの disabled を更新する関数
            let leftSelected = false;
            let rightSelected = false;
            const updateCompareButtonState = () => {
                compareButton.disabled = !(leftSelected && rightSelected);
            };

            // 左ペイン
            const leftPane = document.createElement('div');
            leftPane.classList.add('commit-selector-left');
            panesContainer.appendChild(leftPane);
            const leftLabel = document.createElement('div');
            leftLabel.classList.add('commit-selector-pane-label');
            leftLabel.textContent = '比較元（左）';
            leftPane.appendChild(leftLabel);
            const leftList = this.buildCommitList(logEntries, () => {
                leftSelected = true;
                updateCompareButtonState();
            });
            leftPane.appendChild(leftList);

            // 右ペイン
            const rightPane = document.createElement('div');
            rightPane.classList.add('commit-selector-right');
            panesContainer.appendChild(rightPane);
            const rightLabel = document.createElement('div');
            rightLabel.classList.add('commit-selector-pane-label');
            rightLabel.textContent = '比較先（右）';
            rightPane.appendChild(rightLabel);
            const rightList = this.buildCommitList(logEntries, () => {
                rightSelected = true;
                updateCompareButtonState();
            });
            rightPane.appendChild(rightList);

            // ボタンコンテナ
            const buttonsContainer = document.createElement('div');
            buttonsContainer.classList.add('commit-selector-buttons');
            content.appendChild(buttonsContainer);

            // 「キャンセル」ボタン
            const cancelButton = document.createElement('button');
            cancelButton.classList.add('commit-selector-cancel-button');
            cancelButton.textContent = 'キャンセル';
            cancelButton.addEventListener('click', () => {
                closeDialog();
                resolveOnce(null);
            });
            buttonsContainer.appendChild(cancelButton);

            // 「比較」ボタンのクリックハンドラ
            compareButton.addEventListener('click', () => {
                const leftEntry = leftList.querySelector('.commit-list-entry.selected') as HTMLElement | null;
                const rightEntry = rightList.querySelector('.commit-list-entry.selected') as HTMLElement | null;
                if (leftEntry === null || rightEntry === null) return;
                const leftCommit = leftEntry.dataset.commit;
                const rightCommit = rightEntry.dataset.commit;
                // dataset.commit が未定義（undefined）の場合は不正状態
                if (leftCommit === undefined || rightCommit === undefined) {
                    throw new Error('選択中のコミットエントリに data-commit 属性がありません');
                }
                // 同一コミットの比較は無意味なので処理しない
                if (leftCommit === rightCommit) return;
                closeDialog();
                resolveOnce({ leftCommit, rightCommit });
            });
            buttonsContainer.appendChild(compareButton);

            // オーバーレイ背景クリックでダイアログを閉じる
            dialog.addEventListener('click', (ev: MouseEvent) => {
                if (ev.target === dialog) {
                    closeDialog();
                    resolveOnce(null);
                }
            });

            // Escキーでダイアログを閉じる
            const onKeyDown = (ev: KeyboardEvent) => {
                if (ev.key === 'Escape') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    closeDialog();
                    resolveOnce(null);
                }
            };
            document.addEventListener('keydown', onKeyDown, true);

            document.body.appendChild(dialog);
        });
    }

    /**
     * コミットリスト要素を構築する。
     * プリセット2件（HEAD、作業ツリー）+ git log のコミットエントリを表示する。
     * 各エントリクリックで同リスト内の排他選択を行い、onSelect コールバックで選択状態を通知する。
     */
    private buildCommitList(logEntries: readonly LogEntry[], onSelect: () => void): HTMLElement {
        const list = document.createElement('div');
        list.classList.add('commit-list');
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', 'コミット一覧');

        // プリセット: HEAD（最新コミット）
        const headEntry = this.createPresetEntry(list, 'HEAD', 'HEAD（最新コミット）', onSelect);
        list.appendChild(headEntry);

        // プリセット: 作業ツリー
        const workingTreeEntry = this.createPresetEntry(list, 'WORKING_TREE', '作業ツリー', onSelect);
        list.appendChild(workingTreeEntry);

        // git log のコミットエントリ
        for (const entry of logEntries) {
            const entryElement = document.createElement('div');
            entryElement.classList.add('commit-list-entry');
            entryElement.dataset.commit = entry.commitHash;
            entryElement.setAttribute('role', 'option');
            entryElement.setAttribute('tabindex', '0');
            entryElement.setAttribute('aria-selected', 'false');

            const hashSpan = document.createElement('span');
            hashSpan.classList.add('commit-list-entry-hash');
            // 7桁ハッシュ表示（ただしテスト用データは短いハッシュなのでそのまま表示）
            hashSpan.textContent = entry.commitHash.length > 7 ? entry.commitHash.substring(0, 7) : entry.commitHash;
            entryElement.appendChild(hashSpan);

            const messageSpan = document.createElement('span');
            messageSpan.classList.add('commit-list-entry-message');
            messageSpan.textContent = entry.message;
            entryElement.appendChild(messageSpan);

            entryElement.addEventListener('click', () => {
                this.selectEntry(list, entryElement);
                onSelect();
            });

            list.appendChild(entryElement);
        }

        return list;
    }

    /**
     * プリセットエントリ（HEAD、作業ツリー）を生成する。
     * @param list 親リスト要素（排他選択のために必要）
     */
    private createPresetEntry(list: HTMLElement, dataCommit: string, label: string, onSelect: () => void): HTMLElement {
        const entry = document.createElement('div');
        entry.classList.add('commit-list-entry', 'preset');
        entry.dataset.commit = dataCommit;
        entry.setAttribute('role', 'option');
        entry.setAttribute('tabindex', '0');
        entry.setAttribute('aria-selected', 'false');

        const hashSpan = document.createElement('span');
        hashSpan.classList.add('commit-list-entry-hash');
        hashSpan.textContent = dataCommit;
        entry.appendChild(hashSpan);

        const messageSpan = document.createElement('span');
        messageSpan.classList.add('commit-list-entry-message');
        messageSpan.textContent = label;
        entry.appendChild(messageSpan);

        entry.addEventListener('click', () => {
            this.selectEntry(list, entry);
            onSelect();
        });

        return entry;
    }

    /**
     * リスト内のエントリを排他選択する。
     * 既に選択中のエントリから .selected と aria-selected を除去し、新しいエントリに付与する。
     */
    private selectEntry(list: HTMLElement, entry: HTMLElement): void {
        const current = list.querySelector('.commit-list-entry.selected');
        if (current !== null) {
            current.classList.remove('selected');
            current.setAttribute('aria-selected', 'false');
        }
        entry.classList.add('selected');
        entry.setAttribute('aria-selected', 'true');
    }
}
