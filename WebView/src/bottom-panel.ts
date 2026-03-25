import {ResizeHandle} from "./resize-handle";
import type {ValidationPanel} from "./validation-panel";
import type {DebugConsole} from "./debug-console";

type BottomTab = 'problems' | 'debug';

/**
 * ボトムパネル
 *
 * PROBLEMS と DEBUG CONSOLE をタブで切り替えられる共通の下段パネル。
 * ResizeHandle・タブバー・閉じるボタンをここで一元管理し、
 * 各コンテンツ（ValidationPanel / DebugConsole）はタブの内容として表示する。
 *
 * StatusBar のエラーバッジクリック → toggleTab('problems')
 * StatusBar の DEBUG ボタンクリック → toggleTab('debug')
 * で開閉とタブ切り替えを一括管理する。
 */
export class BottomPanel {

    private readonly element: HTMLElement;
    private readonly validationPanel: ValidationPanel;
    private readonly debugConsole: DebugConsole;
    private readonly problemsTabBtn: HTMLElement;
    private readonly debugTabBtn: HTMLElement;
    private readonly clearBtn: HTMLElement;
    private activeTab: BottomTab;

    constructor(validationPanel: ValidationPanel, debugConsole: DebugConsole) {
        this.validationPanel = validationPanel;
        this.debugConsole = debugConsole;
        this.activeTab = 'problems';

        const panel = document.createElement('div');
        panel.classList.add('bottom-panel');
        panel.style.display = 'none';
        this.element = panel;

        // 縦方向リサイズハンドル（上端に配置し、上方向ドラッグで高さを増やす）
        const resizeHandle = new ResizeHandle('vertical', (delta: number): number => {
            const currentHeight = this.element.getBoundingClientRect().height;
            const newHeight = Math.max(80, currentHeight - delta);
            this.element.style.height = `${newHeight}px`;
            return currentHeight - newHeight;
        });
        resizeHandle.prependTo(this.element);

        // タブバー
        const tabBar = document.createElement('div');
        tabBar.classList.add('bottom-panel-tab-bar');

        this.problemsTabBtn = this.createTabBtn('PROBLEMS', 'problems');
        this.debugTabBtn = this.createTabBtn('DEBUG CONSOLE', 'debug');
        tabBar.appendChild(this.problemsTabBtn);
        tabBar.appendChild(this.debugTabBtn);

        // DEBUG CONSOLE 固有のクリアボタン（アクティブタブに応じて表示切替）
        const clearBtn = document.createElement('div');
        clearBtn.classList.add('bottom-panel-action');
        clearBtn.setAttribute('role', 'button');
        clearBtn.setAttribute('tabindex', '0');
        clearBtn.setAttribute('title', 'ログをクリア');
        clearBtn.setAttribute('aria-label', 'ログをクリア');
        clearBtn.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M6 2h4l1 1H5L6 2zM4 4h8v9l-1 1H5l-1-1V4zm2 2v6h1V6H6zm3 0v6h1V6H9z"/></svg>`;
        clearBtn.addEventListener('click', () => { this.debugConsole.clear(); });
        clearBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.debugConsole.clear(); });
        this.clearBtn = clearBtn;

        // 閉じるボタン
        const closeBtn = document.createElement('div');
        closeBtn.classList.add('bottom-panel-action');
        closeBtn.setAttribute('role', 'button');
        closeBtn.setAttribute('tabindex', '0');
        closeBtn.setAttribute('title', 'パネルを閉じる');
        closeBtn.setAttribute('aria-label', 'パネルを閉じる');
        closeBtn.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 8.707l3.646 3.647.708-.708L8.707 8l3.647-3.646-.708-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708z"/></svg>`;
        closeBtn.addEventListener('click', () => { this.element.style.display = 'none'; });
        closeBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.element.style.display = 'none'; });

        // アクションボタン群を右寄せグループにまとめる
        const actions = document.createElement('div');
        actions.classList.add('bottom-panel-actions');
        actions.appendChild(clearBtn);
        actions.appendChild(closeBtn);
        tabBar.appendChild(actions);

        panel.appendChild(tabBar);

        // 各コンテンツをパネル内に追加する（表示/非表示は applyTabState で管理）
        validationPanel.appendTo(panel);
        debugConsole.appendTo(panel);

        this.applyTabState();
    }

    /**
     * 指定タブをトグルする。
     * パネルが非表示 or 別タブが表示中 → 指定タブで表示する。
     * 同じタブが既に表示中 → パネルを閉じる。
     */
    toggleTab(tab: BottomTab): void {
        if (this.element.style.display !== 'none' && this.activeTab === tab) {
            this.element.style.display = 'none';
            return;
        }
        this.activeTab = tab;
        this.element.style.display = '';
        this.applyTabState();
    }

    /**
     * パネルを親要素に追加する（Editor から呼ばれる）
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    private createTabBtn(label: string, tab: BottomTab): HTMLElement {
        const btn = document.createElement('div');
        btn.classList.add('bottom-panel-tab');
        btn.textContent = label;
        btn.addEventListener('click', () => { this.toggleTab(tab); });
        return btn;
    }

    private applyTabState(): void {
        this.problemsTabBtn.classList.toggle('bottom-panel-tab-active', this.activeTab === 'problems');
        this.debugTabBtn.classList.toggle('bottom-panel-tab-active', this.activeTab === 'debug');
        // clearBtn は DEBUG CONSOLE タブのときのみ表示する
        this.clearBtn.style.display = this.activeTab === 'debug' ? '' : 'none';
        this.validationPanel.setVisible(this.activeTab === 'problems');
        this.debugConsole.setVisible(this.activeTab === 'debug');
    }
}
