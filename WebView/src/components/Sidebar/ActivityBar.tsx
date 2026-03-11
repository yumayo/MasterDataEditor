import React from 'react';
import {useStore} from 'zustand';
import {useSidebarStore, SidebarPanel} from '../../stores/sidebar-store';

/**
 * ファイルアイコン（VSCode風 ダブルドキュメント）
 */
function FilesIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.5 0H8.5L7 1.5V6H2.5L1 7.5V22.5699L2.5 24H14.5699L16 22.5699V18H20.7L22 16.5699V4.5L17.5 0ZM17.5 2.12L19.88 4.5H17.5V2.12ZM14.5 22.5H2.5V7.5H7V16.5699L8.5 18H14.5V22.5ZM20.5 16.5H8.5V1.5H16V6H20.5V16.5Z" fill="currentColor" />
        </svg>
    );
}

/**
 * リファレンスアイコン（ダウンロード矢印 + 横線2本）
 */
function ReferencesIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M11 3H13V11.17L15.59 8.58L17 10L12 15L7 10L8.41 8.58L11 11.17V3Z" fill="currentColor" />
            <path d="M4 17V19H20V17H4Z" fill="currentColor" />
            <path d="M4 21V23H20V21H4Z" fill="currentColor" />
        </svg>
    );
}

/**
 * 検索アイコン（虫眼鏡）
 */
function SearchIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M15.25 1C11.528 1 8.5 4.028 8.5 7.75C8.5 9.295 9.04 10.713 9.94 11.83L2.22 19.56L3.64 20.98L11.37 13.25C12.487 14.15 13.905 14.5 15.25 14.5C18.972 14.5 22 11.472 22 7.75C22 4.028 18.972 1 15.25 1ZM15.25 12.5C12.632 12.5 10.5 10.368 10.5 7.75C10.5 5.132 12.632 3 15.25 3C17.868 3 20 5.132 20 7.75C20 10.368 17.868 12.5 15.25 12.5Z" fill="currentColor" />
        </svg>
    );
}

/**
 * アクティビティバーのボタン1件分のデータ
 */
interface ActivityBarButtonDef {
    panel: SidebarPanel;
    icon: React.ReactElement;
    label: string;
}

/** ボタン定義リスト（順序がそのまま表示順になる） */
const BUTTON_DEFS: ActivityBarButtonDef[] = [
    {panel: 'files', icon: <FilesIcon />, label: 'Explorer'},
    {panel: 'references', icon: <ReferencesIcon />, label: 'References'},
    {panel: 'search', icon: <SearchIcon />, label: 'Search'},
];

/**
 * アクティビティバー
 * 左端の48px幅のアイコン列。クリックでサイドバーのアクティブパネルを切り替える。
 */
export function ActivityBar() {
    const activePanel = useStore(useSidebarStore, state => state.activePanel);
    const setActivePanel = useSidebarStore.getState().setActivePanel;

    return (
        <div className="activity-bar">
            {BUTTON_DEFS.map(def => (
                <div
                    key={def.panel}
                    className={'activity-bar-item' + (activePanel === def.panel ? ' activity-bar-item-active' : '')}
                    data-panel={def.panel}
                    aria-label={def.label}
                    role="button"
                    onClick={() => setActivePanel(def.panel)}
                >
                    {def.icon}
                </div>
            ))}
        </div>
    );
}
