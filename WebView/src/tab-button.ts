import {Tab} from "./tab";
import {Editor} from "./editor";
import {extractFirstLineFromDescription} from "./description-utils";

export class TabButton {

    readonly tab: Tab;
    readonly editor: Editor;

    readonly element: HTMLLIElement;
    readonly name: string;

    private dirtyIndicator: HTMLElement;
    private closeButton: HTMLButtonElement;

    constructor(editor: Editor, tab: Tab, name: string, description: string | null) {
        this.editor = editor;
        this.name = name;
        this.tab = tab;

        this.element = document.createElement('li');
        this.element.classList.add('tab-button');
        // ホバー時にテーブル名をツールチップ表示する
        this.element.title = name;

        this.element.addEventListener('click', this.onClick.bind(this));
        this.element.addEventListener('auxclick', this.onAuxClick.bind(this));
        this.element.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.element.addEventListener('contextmenu', this.onContextMenu.bind(this));

        // ラベル部（テーブル名を1行目、description を2行目とする2行構造）
        const labelContainer = document.createElement('div');
        labelContainer.classList.add('tab-button-label');

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('tab-button-name');
        nameSpan.textContent = name;
        labelContainer.appendChild(nameSpan);

        // description が存在する場合は1行目のみ使用。表示する行がない場合は生成しない
        if (description !== null) {
            const firstLine = extractFirstLineFromDescription(description);
            if (firstLine !== null) {
                const descSpan = document.createElement('span');
                descSpan.classList.add('tab-button-description');
                descSpan.textContent = firstLine;
                labelContainer.appendChild(descSpan);
            }
        }

        this.element.appendChild(labelContainer);

        // 閉じるボタンと丸ポッチを配置するコンテナ
        const buttonContainer = document.createElement('div');
        buttonContainer.classList.add('tab-button-container');

        // 編集中を示す丸ポッチ（閉じるボタンの下に配置）
        this.dirtyIndicator = document.createElement('div');
        this.dirtyIndicator.classList.add('tab-button-dirty');
        buttonContainer.appendChild(this.dirtyIndicator);

        // 閉じるボタン（丸ポッチの上に重なる）
        this.closeButton = document.createElement('button');
        this.closeButton.classList.add('tab-button-close');
        this.closeButton.addEventListener('click', this.onClickCloseButton.bind(this));
        buttonContainer.appendChild(this.closeButton);

        this.element.appendChild(buttonContainer);
    }

    /**
     * 編集状態（dirty）を設定
     * @param dirty true: 編集あり（丸ポッチ表示）、false: 保存済み（丸ポッチ非表示）
     */
    setDirty(dirty: boolean): void {
        if (dirty) {
            this.dirtyIndicator.classList.add('tab-button-dirty-visible');
        } else {
            this.dirtyIndicator.classList.remove('tab-button-dirty-visible');
        }
    }

    /**
     * 編集状態を取得
     */
    isDirty(): boolean {
        return this.dirtyIndicator.classList.contains('tab-button-dirty-visible');
    }

    /**
     * スキーマ読み込み後に description を後付けで適用する。
     * ExplorerFile クリック以外の経路（navigateToTableRow / CommandPalette 等）で
     * null で生成されたタブボタンに description span を挿入する。
     * 既に description span が存在する場合（ExplorerFile 経由で既に設定済み）は何もしない。
     */
    applyDescription(description: string): void {
        const label = this.element.querySelector('.tab-button-label');
        if (!label) throw new Error('[TabButton] applyDescription: .tab-button-label が見つかりません');
        if (label.querySelector('.tab-button-description')) return;
        // description は1行目のみ使用し、name の後（2行目）に追加する
        const firstLine = extractFirstLineFromDescription(description);
        if (firstLine === null) return;
        const descSpan = document.createElement('span');
        descSpan.classList.add('tab-button-description');
        descSpan.textContent = firstLine;
        label.appendChild(descSpan);
    }

    click() {
        this.element.click();
    }

    private onClick() {
        // 自分自身がクリックされた場合は自分を有効状態にします。
        this.tab.enableTabButton(this.name);
    }

    /** 中クリック（ホイールクリック）でタブを閉じる */
    private onAuxClick(ev: MouseEvent) {
        if (ev.button !== 1) return;
        ev.preventDefault();
        this.tab.closeTab(this.name);
    }

    private onClickCloseButton(ev: MouseEvent) {
        // 閉じるボタンをliの上に置いていて、
        // liのclickイベントが呼び出されてしまうためイベントの伝播を止めておきます。
        ev.stopPropagation();

        // closeTab() に一任する。設定タブのクリーンアップ（settingsPanel/settingsWrapperElement のリセット等）
        // を含む全クリーンアップロジックが closeTab() に集約されているため、直接 removeTabButton() を
        // 呼ぶ旧実装は設定タブ再オープン時に古い SettingsPanel が再利用される問題を引き起こす。
        this.tab.closeTab(this.name);
    }

    enable() {
        this.element.classList.add('tab-button-active');
    }

    /** アクティブ化されたタブボタンが可視領域外にある場合、スクロールして表示する */
    scrollIntoViewIfNeeded(behavior: ScrollBehavior = 'smooth'): void {
        this.tab.scrollTabButtonIntoView(this, behavior);
    }

    disable() {
        this.element.classList.remove('tab-button-active');
    }

    /** 右クリックコンテキストメニュー: Tab にイベントを委譲する */
    private onContextMenu(ev: MouseEvent) {
        ev.preventDefault();
        this.tab.showTabButtonContextMenu(this.name, ev.clientX, ev.clientY);
    }

    private onMouseDown(ev: MouseEvent) {
        // 閉じるボタンのクリックは除外
        if ((ev.target as HTMLElement).classList.contains('tab-button-close')) {
            return;
        }

        // 中クリックのデフォルト動作（オートスクロール）を防止
        if (ev.button === 1) {
            ev.preventDefault();
            return;
        }

        // 左ボタンのみ
        if (ev.button !== 0) {
            return;
        }

        const startX = ev.clientX;
        const startY = ev.clientY;
        let isDragging = false;

        const onMouseMove = (moveEv: MouseEvent) => {
            // 5px以上移動したらドラッグ開始
            const dx = Math.abs(moveEv.clientX - startX);
            const dy = Math.abs(moveEv.clientY - startY);

            if (!isDragging && (dx > 5 || dy > 5)) {
                isDragging = true;
                this.element.classList.add('tab-button-dragging');
                this.tab.setDraggingTabName(this.name);
            }

            if (isDragging) {
                // ドロップ先のタブを探す
                this.tab.updateDropIndicator(moveEv.clientX, moveEv.clientY);
            }
        };

        const onMouseUp = (upEv: MouseEvent) => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            if (isDragging) {
                // ドロップ処理
                this.tab.dropTab(upEv.clientX, upEv.clientY);

                this.element.classList.remove('tab-button-dragging');
                this.tab.clearDropIndicators();
                this.tab.clearDraggingTabName();
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }
}
