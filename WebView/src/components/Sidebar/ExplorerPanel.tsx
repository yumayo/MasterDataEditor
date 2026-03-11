import React from 'react';
import {useStore} from 'zustand';
import {useSidebarStore} from '../../stores/sidebar-store';

interface ExplorerPanelProps {
    /** ファイルクリック時のコールバック（タブオープン） */
    onFileClick: (tableName: string) => void;
}

/**
 * Explorerパネル
 * sidebar-store の fileNames からファイル一覧を表示する。
 * クリックで onFileClick を呼び出してタブをオープンする。
 */
export function ExplorerPanel({onFileClick}: ExplorerPanelProps) {
    const fileNames = useStore(useSidebarStore, state => state.fileNames);

    return (
        <div className="sidebar-panel sidebar-panel-active">
            <div className="sidebar-panel-header">EXPLORER</div>
            {fileNames.map(name => (
                <div
                    key={name}
                    className="explorer-file"
                    style={{paddingLeft: 16}}
                    onClick={() => onFileClick(name)}
                >
                    {name}
                </div>
            ))}
        </div>
    );
}
