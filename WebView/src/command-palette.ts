import {Tab} from "./tab";

/**
 * コマンドパレットの候補アイテム
 */
interface CommandPaletteItem {
    displayName: string;
    tabName: string;
}

/**
 * コマンドパレット
 *
 * Ctrl+P で表示され、テーブルの名前でファジー検索し、
 * 選択した項目のタブを開く。VSCode の Ctrl+P と同等の機能。
 */
export class CommandPalette {
    private readonly tab: Tab;
    private readonly items: CommandPaletteItem[];
    private readonly overlayElement: HTMLElement;
    private readonly inputElement: HTMLInputElement;
    private readonly listElement: HTMLElement;
    private selectedIndex: number;
    /** フィルタ済みの候補アイテム（Enter/クリック確定時にアクセスする） */
    private filteredItems: CommandPaletteItem[];

    constructor(tab: Tab, parentElement: HTMLElement) {
        this.tab = tab;
        this.items = [];
        this.selectedIndex = 0;
        this.filteredItems = [];

        // オーバーレイ要素を構築
        this.overlayElement = document.createElement('div');
        this.overlayElement.classList.add('command-palette-overlay');

        // パレット本体
        const paletteElement = document.createElement('div');
        paletteElement.classList.add('command-palette');

        // 検索入力欄
        this.inputElement = document.createElement('input');
        this.inputElement.classList.add('command-palette-input');
        this.inputElement.type = 'text';
        this.inputElement.placeholder = 'テーブル名を入力...';

        // 候補リスト
        this.listElement = document.createElement('div');
        this.listElement.classList.add('command-palette-list');

        // DOM組み立て
        paletteElement.appendChild(this.inputElement);
        paletteElement.appendChild(this.listElement);
        this.overlayElement.appendChild(paletteElement);
        parentElement.appendChild(this.overlayElement);

        // イベントハンドラを登録
        this.overlayElement.addEventListener('mousedown', (e: MouseEvent) => {
            // オーバーレイ背景部分のクリックでのみ閉じる（パレット本体のクリックは無視）
            if (e.target === this.overlayElement) {
                this.hide();
            }
        });

        this.inputElement.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.hide();
                return;
            }
            // Enterキー：選択中の項目でタブを開く
            if (e.key === 'Enter') {
                e.preventDefault();
                this.confirmSelection(this.selectedIndex);
                return;
            }
            // ↑↓キー：選択を循環移動する
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const visibleItems = this.listElement.querySelectorAll('.command-palette-item');
                if (visibleItems.length === 0) return;
                const delta = e.key === 'ArrowDown' ? 1 : -1;
                this.selectedIndex = (this.selectedIndex + delta + visibleItems.length) % visibleItems.length;
                this.updateSelection(visibleItems);
                return;
            }
        });

        // 入力テキスト変更時にフィルタリングを実行
        this.inputElement.addEventListener('input', () => {
            this.renderList(this.inputElement.value);
        });
    }

    /**
     * テーブルを候補リストに登録する
     */
    registerTable(tableName: string): void {
        this.items.push({displayName: tableName, tabName: tableName});
    }

    /**
     * コマンドパレットを表示する
     * 入力欄をクリアし、全項目を表示した状態で開く
     */
    show(): void {
        this.overlayElement.classList.add('visible');
        this.inputElement.value = '';
        this.renderList('');
        this.inputElement.focus();
    }

    /**
     * コマンドパレットを非表示にする
     */
    hide(): void {
        this.overlayElement.classList.remove('visible');
    }

    /**
     * 選択中の項目でタブを開いてパレットを閉じる
     * Enter確定とマウスクリック確定の共通処理
     */
    private confirmSelection(index: number): void {
        if (this.filteredItems.length === 0) return;
        if (index < 0 || index >= this.filteredItems.length) return;
        const item = this.filteredItems[index];
        // tab.append でタブボタンを取得（既存ならそのまま返る）し、click でタブを有効化する
        const tabButton = this.tab.append(item.tabName);
        tabButton.click();
        this.hide();
    }

    /**
     * フィルタテキストに基づいてリストを描画する
     * 部分一致（大文字小文字区別なし）でフィルタリングし、
     * 該当なしの場合は空メッセージを表示する
     */
    private renderList(filterText: string): void {
        this.listElement.innerHTML = '';
        this.selectedIndex = 0;

        const lowerFilter = filterText.toLowerCase();
        this.filteredItems = this.items.filter(item => item.displayName.toLowerCase().includes(lowerFilter));

        if (this.filteredItems.length === 0) {
            // 該当なしメッセージを表示
            const emptyElement = document.createElement('div');
            emptyElement.classList.add('command-palette-empty');
            emptyElement.textContent = '該当する項目がありません';
            this.listElement.appendChild(emptyElement);
            return;
        }

        // フィルタ結果をリストに描画
        for (let i = 0; i < this.filteredItems.length; ++i) {
            const item = this.filteredItems[i];
            const itemElement = document.createElement('div');
            itemElement.classList.add('command-palette-item');
            // 最初の項目を選択状態にする
            if (i === 0) {
                itemElement.classList.add('selected');
            }

            const nameElement = document.createElement('span');
            nameElement.classList.add('command-palette-item-name');
            nameElement.textContent = item.displayName;

            // マウスクリックで項目を確定する（mousedownでblurを防ぎつつ確定処理を実行）
            const clickIndex = i;
            itemElement.addEventListener('mousedown', (e: MouseEvent) => {
                e.preventDefault();
                this.confirmSelection(clickIndex);
            });

            itemElement.appendChild(nameElement);
            this.listElement.appendChild(itemElement);
        }
    }

    /**
     * 選択状態を更新する
     * selectedIndexに基づいてselectedクラスを付け替え、
     * 選択項目が見えるようにスクロールする
     */
    private updateSelection(visibleItems: NodeListOf<Element>): void {
        for (let i = 0; i < visibleItems.length; ++i) {
            visibleItems[i].classList.remove('selected');
        }
        visibleItems[this.selectedIndex].classList.add('selected');
        visibleItems[this.selectedIndex].scrollIntoView({block: 'nearest'});
    }
}
