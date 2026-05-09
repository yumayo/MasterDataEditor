import type {ReverseReferenceEntry} from "../references/reverse-reference-resolver";

/**
 * 逆参照先ジャンプダイアログ — PK列 Ctrl+Click/F12 で逆参照先が複数あるとき表示する選択モーダル
 *
 * CommitSelectorDialog と同じモーダルパターンだが、Promise ではなくコールバック方式。
 * 呼び出し元が同期メソッド（navigateToReverseReferenceTable）であり、結果を await する必要がないため。
 */
export class ReverseReferenceJumpDialog {

    /**
     * ダイアログを開く。
     * 逆参照エントリ一覧を表示し、ユーザーがクリックした項目を onSelect で返す。
     * Esc / オーバーレイクリックでキャンセル（onSelect を呼ばずに閉じる）。
     * 多重オープン防止: 既にダイアログがDOM上に存在する場合は何もしない。
     */
    static open(entries: readonly ReverseReferenceEntry[], onSelect: (entry: ReverseReferenceEntry) => void): void {
        // 多重オープン防止
        if (document.querySelector('.reverse-reference-jump-dialog') !== null) return;

        // ダイアログを閉じる共通処理
        const closeDialog = () => {
            dialog.remove();
            document.removeEventListener('keydown', onKeyDown, true);
        };

        // モーダルオーバーレイ（全画面背景）
        const dialog = document.createElement('div');
        dialog.classList.add('reverse-reference-jump-dialog');

        // コンテンツ領域
        const content = document.createElement('div');
        content.classList.add('reverse-reference-jump-content');
        content.setAttribute('role', 'dialog');
        content.setAttribute('aria-modal', 'true');
        content.setAttribute('aria-labelledby', 'reverse-reference-jump-dialog-title');
        dialog.appendChild(content);

        // タイトル
        const title = document.createElement('div');
        title.classList.add('reverse-reference-jump-title');
        title.id = 'reverse-reference-jump-dialog-title';
        title.textContent = '逆参照先を選択';
        content.appendChild(title);

        // リスト
        const list = document.createElement('div');
        list.classList.add('reverse-reference-jump-list');
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', '逆参照先一覧');
        content.appendChild(list);

        // 各エントリ
        for (const entry of entries) {
            const entryElement = document.createElement('div');
            entryElement.classList.add('reverse-reference-jump-entry');
            entryElement.setAttribute('role', 'option');
            entryElement.setAttribute('tabindex', '0');
            entryElement.textContent = entry.childTableName + '\uFF08' + String(entry.rows.length) + '\u4EF6\uFF09';
            entryElement.addEventListener('click', () => {
                closeDialog();
                onSelect(entry);
            });
            list.appendChild(entryElement);
        }

        // オーバーレイ背景クリックでキャンセル
        dialog.addEventListener('click', (ev: MouseEvent) => {
            if (ev.target === dialog) closeDialog();
        });

        // Escキーでキャンセル
        const onKeyDown = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                closeDialog();
            }
        };
        document.addEventListener('keydown', onKeyDown, true);

        document.body.appendChild(dialog);
    }
}
