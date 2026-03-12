import React, {useEffect} from 'react';
import {useStore} from 'zustand';
import {useSidebarStore} from '../../stores/sidebar-store';

interface ExplorerPanelProps {
    /** ファイルクリック時のコールバック（タブオープン） */
    onFileClick: (tableName: string) => void;
}

/**
 * Explorerパネル
 * sidebar-store の fileNames からファイル一覧を表示する。
 * マウント時に loadFileNamesAsync でスキーマファイル一覧を取得する。
 * クリックで onFileClick を呼び出してタブをオープンする。
 */
export function ExplorerPanel({onFileClick}: ExplorerPanelProps) {
    const fileNames = useStore(useSidebarStore, state => state.fileNames);

    // マウント時にファイル一覧を取得する
    useEffect(() => {
        useSidebarStore.getState().loadFileNamesAsync().catch(err => {
            console.error('[ExplorerPanel] ファイル一覧取得失敗:', err);
        });
    }, []);

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
