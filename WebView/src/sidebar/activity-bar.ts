import {DEFAULT_ACTIVITY_BAR_ORDER, normalizeActivityBarOrder, type UiActivityBarItem} from "../app/ui-state";

const DRAG_THRESHOLD = 5;

type DropIndicatorSide = 'before' | 'after';

interface ActivityBarDropPosition {
    readonly indicatorItem: ActivityBarItem;
    readonly indicatorSide: DropIndicatorSide;
    readonly insertAfter: boolean;
}

/** アクティビティバーの項目種別 */
export type ActivityBarItem = UiActivityBarItem;

const ACTIVITY_BAR_LABELS: Record<ActivityBarItem, string> = {
    files: 'エクスプローラー',
    references: '参照',
    search: '検索',
    bookmarks: 'ブックマーク',
    calendar: 'スケジュール',
    views: 'ビュープラグイン',
    sourceControl: 'ソース管理',
    branchCompare: 'ブランチ比較',
    history: 'タイムライン',
};

/**
 * ファイルアイコン（SVG）
 */
const FILES_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M17.5 0H8.5L7 1.5V6H2.5L1 7.5V22.5699L2.5 24H14.5699L16 22.5699V18H20.7L22 16.5699V4.5L17.5 0ZM17.5 2.12L19.88 4.5H17.5V2.12ZM14.5 22.5H2.5V7.5H7V16.5699L8.5 18H14.5V22.5ZM20.5 16.5H8.5V1.5H16V6H20.5V16.5Z" fill="currentColor"/>
</svg>`;

/**
 * リファレンスアイコン（SVG）
 */
const REFERENCES_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M11 3H13V11.17L15.59 8.58L17 10L12 15L7 10L8.41 8.58L11 11.17V3Z" fill="currentColor"/>
  <path d="M4 17V19H20V17H4Z" fill="currentColor"/>
  <path d="M4 21V23H20V21H4Z" fill="currentColor"/>
</svg>`;

/**
 * 検索アイコン（SVG虫眼鏡）
 */
const SEARCH_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M15.25 1C11.528 1 8.5 4.028 8.5 7.75C8.5 9.295 9.04 10.713 9.94 11.83L2.22 19.56L3.64 20.98L11.37 13.25C12.487 14.15 13.905 14.5 15.25 14.5C18.972 14.5 22 11.472 22 7.75C22 4.028 18.972 1 15.25 1ZM15.25 12.5C12.632 12.5 10.5 10.368 10.5 7.75C10.5 5.132 12.632 3 15.25 3C17.868 3 20 5.132 20 7.75C20 10.368 17.868 12.5 15.25 12.5Z" fill="currentColor"/>
</svg>`;

/**
 * ブックマークアイコン（SVG — 旗/しおり形状）
 */
const BOOKMARKS_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M17 3H7C5.9 3 5 3.9 5 5V21L12 18L19 21V5C19 3.9 18.1 3 17 3ZM17 18L12 15.82L7 18V5H17V18Z" fill="currentColor"/>
</svg>`;

/**
 * カレンダーアイコン（SVG）
 */
const CALENDAR_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="3.5" y="4.5" width="17" height="16" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
  <path d="M7.5 2.5V6.5M16.5 2.5V6.5M4 9H20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M7 12H9V14H7V12ZM11 12H13V14H11V12ZM15 12H17V14H15V12ZM7 16H9V18H7V16ZM11 16H13V18H11V16Z" fill="currentColor"/>
</svg>`;

/**
 * Viewプラグインアイコン（SVG — ウィンドウ形状）
 */
const VIEWS_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="3" y="4" width="18" height="16" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
  <path d="M3 8H21" stroke="currentColor" stroke-width="1.5"/>
  <path d="M7 12H11V16H7V12Z" fill="currentColor"/>
  <path d="M13 12H18V13.5H13V12Z" fill="currentColor"/>
  <path d="M13 15H18V16.5H13V15Z" fill="currentColor"/>
</svg>`;

/**
 * ソース管理アイコン（SVG — gitブランチ形状）
 * 上部1ノード（コミット元）から下部2ノード（ブランチ先）への分岐をcircleと線で表現する
 */
const SOURCE_CONTROL_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="4" r="2.5" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="6" cy="20" r="2.5" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="18" cy="20" r="2.5" stroke="currentColor" stroke-width="1.5"/>
  <path d="M12 6.5V11M12 11C12 15 6 15 6 17.5M12 11C12 15 18 15 18 17.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
</svg>`;

/** 2ブランチ比較アイコン（左右のブランチと差分矢印） */
const BRANCH_COMPARE_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="6" cy="5" r="2" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="6" cy="19" r="2" stroke="currentColor" stroke-width="1.5"/>
  <path d="M6 7V17" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="18" cy="5" r="2" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="18" cy="19" r="2" stroke="currentColor" stroke-width="1.5"/>
  <path d="M18 7V17M9 9H15M13 7L15 9L13 11M15 15H9M11 13L9 15L11 17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/**
 * 履歴アイコン（SVG — 時計形状）
 * タイムラインパネルを開くボタンに使用する
 */
const HISTORY_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20ZM12.5 7H11V13L16.25 16.15L17 14.92L12.5 12.25V7Z"/>
</svg>`;

/**
 * 歯車アイコン（SVG）
 */
const SETTINGS_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M19.14 12.94C19.18 12.64 19.2 12.33 19.2 12C19.2 11.68 19.18 11.36 19.13 11.06L21.16 9.48C21.34 9.34 21.39 9.07 21.28 8.87L19.36 5.55C19.24 5.33 18.99 5.26 18.77 5.33L16.38 6.29C15.88 5.91 15.35 5.59 14.76 5.35L14.4 2.81C14.36 2.57 14.16 2.4 13.92 2.4H10.08C9.84 2.4 9.65 2.57 9.61 2.81L9.25 5.35C8.66 5.59 8.12 5.92 7.63 6.29L5.24 5.33C5.02 5.25 4.77 5.33 4.65 5.55L2.74 8.87C2.62 9.08 2.66 9.34 2.86 9.48L4.89 11.06C4.84 11.36 4.8 11.69 4.8 12C4.8 12.31 4.82 12.64 4.87 12.94L2.84 14.52C2.66 14.66 2.61 14.93 2.72 15.13L4.64 18.45C4.76 18.67 5.01 18.74 5.23 18.67L7.62 17.71C8.12 18.09 8.65 18.41 9.24 18.65L9.6 21.19C9.65 21.43 9.84 21.6 10.08 21.6H13.92C14.16 21.6 14.36 21.43 14.39 21.19L14.75 18.65C15.34 18.41 15.88 18.09 16.37 17.71L18.76 18.67C18.98 18.75 19.23 18.67 19.35 18.45L21.27 15.13C21.39 14.91 21.34 14.66 21.15 14.52L19.14 12.94ZM12 15.6C10.02 15.6 8.4 13.98 8.4 12C8.4 10.02 10.02 8.4 12 8.4C13.98 8.4 15.6 10.02 15.6 12C15.6 13.98 13.98 15.6 12 15.6Z" fill="currentColor"/>
</svg>`;

/**
 * アクティビティバー
 * 左端の48px幅のアイコン列
 */
export class ActivityBar {
    private readonly element: HTMLElement;
    private activeItem: ActivityBarItem;
    private readonly buttons: Map<ActivityBarItem, HTMLElement>;
    private readonly settingsButton: HTMLElement;
    private order: ActivityBarItem[];
    private draggedItem: ActivityBarItem | null;
    private suppressNextClick: boolean;
    private readonly onItemClick: (item: ActivityBarItem) => void;
    private readonly onSettingsClick: () => void;
    private readonly onOrderChanged: (order: ActivityBarItem[]) => void;

    constructor(
        onItemClick: (item: ActivityBarItem) => void,
        onSettingsClick: () => void,
        initialOrder: ActivityBarItem[] = DEFAULT_ACTIVITY_BAR_ORDER,
        onOrderChanged: (order: ActivityBarItem[]) => void = () => {},
    ) {
        this.onItemClick = onItemClick;
        this.onSettingsClick = onSettingsClick;
        this.onOrderChanged = onOrderChanged;
        this.activeItem = 'files';
        this.order = normalizeActivityBarOrder(initialOrder);
        this.draggedItem = null;
        this.suppressNextClick = false;

        this.element = document.createElement('div');
        this.element.classList.add('activity-bar');

        this.buttons = new Map<ActivityBarItem, HTMLElement>([
            ['files', this.createButton(FILES_ICON_SVG, 'files')],
            ['references', this.createButton(REFERENCES_ICON_SVG, 'references')],
            ['search', this.createButton(SEARCH_ICON_SVG, 'search')],
            ['bookmarks', this.createButton(BOOKMARKS_ICON_SVG, 'bookmarks')],
            ['calendar', this.createButton(CALENDAR_ICON_SVG, 'calendar')],
            ['views', this.createButton(VIEWS_ICON_SVG, 'views')],
            ['sourceControl', this.createButton(SOURCE_CONTROL_ICON_SVG, 'sourceControl')],
            ['branchCompare', this.createButton(BRANCH_COMPARE_ICON_SVG, 'branchCompare')],
            ['history', this.createButton(HISTORY_ICON_SVG, 'history')],
        ]);

        // 歯車ボタンは margin-top: auto で下部固定
        this.settingsButton = document.createElement('div');
        this.settingsButton.classList.add('activity-bar-item', 'activity-bar-settings');
        this.settingsButton.innerHTML = SETTINGS_ICON_SVG;
        this.settingsButton.setAttribute('data-panel', 'settings');
        this.configureButtonAccessibility(this.settingsButton, '設定');
        this.settingsButton.addEventListener('click', () => { this.onSettingsClick(); });

        this.renderButtons();
        this.updateActiveState();
    }

    /**
     * アクティビティバーを親要素に追加する
     */
    appendTo(parent: HTMLElement): void {
        parent.appendChild(this.element);
    }

    /**
     * アクティブなアイテムを切り替える
     */
    activateItem(item: ActivityBarItem): void {
        this.activeItem = item;
        this.updateActiveState();
    }

    /**
     * アイコンボタンを作成する
     */
    private createButton(svgHtml: string, item: ActivityBarItem): HTMLElement {
        const button = document.createElement('div');
        button.classList.add('activity-bar-item');
        button.innerHTML = svgHtml;
        button.setAttribute('data-panel', item);
        this.configureButtonAccessibility(button, ACTIVITY_BAR_LABELS[item]);
        button.addEventListener('mousedown', (event: MouseEvent) => { this.onMouseDown(event, item); });
        button.addEventListener('click', () => {
            if (this.suppressNextClick) {
                this.suppressNextClick = false;
                return;
            }
            this.activateItem(item);
            this.onItemClick(item);
        });
        return button;
    }

    private configureButtonAccessibility(button: HTMLElement, label: string): void {
        button.setAttribute('role', 'button');
        button.setAttribute('tabindex', '0');
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            if (!event.repeat) button.click();
        });
    }

    /**
     * ソース管理アイコンにバッジを表示/非表示する
     * count > 0: バッジ要素を作成または更新して変更ファイル数を表示する
     * count === 0: バッジ要素をDOMから除去する
     */
    updateSourceControlBadge(count: number): void {
        const sourceControlButton = this.getButton('sourceControl');
        const existing = sourceControlButton.querySelector('.activity-bar-badge');
        if (count === 0) {
            if (existing) existing.remove();
            return;
        }
        if (existing) {
            existing.textContent = String(count);
            return;
        }
        // バッジ要素を新規作成してソース管理ボタンの子要素として追加する
        const badge = document.createElement('span');
        badge.classList.add('activity-bar-badge');
        badge.textContent = String(count);
        sourceControlButton.appendChild(badge);
    }

    private renderButtons(): void {
        for (const item of this.order) {
            this.element.appendChild(this.getButton(item));
        }
        this.element.appendChild(this.settingsButton);
    }

    private getButton(item: ActivityBarItem): HTMLElement {
        const button = this.buttons.get(item);
        if (button === undefined) {
            throw new Error(`Unknown activity bar item: ${item}`);
        }
        return button;
    }

    private onMouseDown(event: MouseEvent, item: ActivityBarItem): void {
        if (event.button !== 0) return;

        event.preventDefault();
        const startX = event.clientX;
        const startY = event.clientY;
        let isDragging = false;

        const onMouseMove = (moveEvent: MouseEvent): void => {
            const dx = Math.abs(moveEvent.clientX - startX);
            const dy = Math.abs(moveEvent.clientY - startY);

            if (!isDragging && (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD)) {
                isDragging = true;
                this.draggedItem = item;
                this.getButton(item).classList.add('activity-bar-item-dragging');
                document.body.style.cursor = 'grabbing';
            }

            if (isDragging) {
                moveEvent.preventDefault();
                this.updateDropIndicator(moveEvent.clientX, moveEvent.clientY);
            }
        };

        const onMouseUp = (upEvent: MouseEvent): void => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            if (isDragging) {
                upEvent.preventDefault();
                this.dropAt(upEvent.clientX, upEvent.clientY);
                this.onDragEnd();
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    private dropAt(clientX: number, clientY: number): void {
        const position = this.findDropPosition(clientX, clientY);
        if (this.draggedItem === null || position === null) return;
        const draggedItem = this.draggedItem;
        const originalOrder = this.order.join('\n');
        const targetItem = position.indicatorItem;
        const nextOrder = this.order.filter(item => item !== draggedItem);
        const targetIndex = nextOrder.indexOf(targetItem);
        nextOrder.splice(position.insertAfter ? targetIndex + 1 : targetIndex, 0, draggedItem);
        if (nextOrder.join('\n') === originalOrder) return;
        this.order = nextOrder;
        this.renderButtons();
        this.updateActiveState();
        this.persistOrder();
        this.suppressNextClick = true;
    }

    private onDragEnd(): void {
        const draggedItem = this.draggedItem;
        this.draggedItem = null;
        document.body.style.cursor = '';
        this.clearDragVisualState();
        if (draggedItem !== null) {
            this.suppressNextClick = true;
            window.setTimeout(() => { this.suppressNextClick = false; }, 0);
        }
    }

    private updateDropIndicator(clientX: number, clientY: number): void {
        this.clearDropIndicator();
        const position = this.findDropPosition(clientX, clientY);
        if (position === null) return;
        this.getButton(position.indicatorItem).classList.add(
            position.indicatorSide === 'before' ? 'activity-bar-item-drop-before' : 'activity-bar-item-drop-after',
        );
    }

    private findDropPosition(clientX: number, clientY: number): ActivityBarDropPosition | null {
        if (this.draggedItem === null) return null;

        const activityBarRect = this.element.getBoundingClientRect();
        if (clientX < activityBarRect.left || clientX > activityBarRect.right) return null;

        for (const item of this.order) {
            if (item === this.draggedItem) continue;
            const button = this.getButton(item);
            const rect = button.getBoundingClientRect();
            if (clientY < rect.top || clientY > rect.bottom) continue;
            const insertAfter = clientY > rect.top + rect.height / 2;
            return {
                indicatorItem: item,
                indicatorSide: insertAfter ? 'after' : 'before',
                insertAfter,
            };
        }
        return null;
    }

    private clearDragVisualState(): void {
        for (const button of this.buttons.values()) {
            button.classList.remove('activity-bar-item-dragging');
        }
        this.clearDropIndicator();
    }

    private clearDropIndicator(): void {
        for (const button of this.buttons.values()) {
            button.classList.remove('activity-bar-item-drop-before', 'activity-bar-item-drop-after');
        }
    }

    private persistOrder(): void {
        this.onOrderChanged([...this.order]);
    }

    /**
     * アクティブ状態の視覚表現を更新する
     */
    private updateActiveState(): void {
        for (const [item, button] of this.buttons) {
            const isActive = this.activeItem === item;
            button.classList.toggle('activity-bar-item-active', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        }
    }
}
