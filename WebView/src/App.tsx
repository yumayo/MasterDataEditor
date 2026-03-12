import React, {useState, useEffect} from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useStore} from 'zustand';
import {Sidebar} from './components/Sidebar/Sidebar';
import {TabBar} from './components/TabBar/TabBar';
import {RelationsPanel} from './components/RelationsPanel/RelationsPanel';
import {CommandPalette} from './components/CommandPalette';
import {EditorTableView} from './components/EditorTable/EditorTableView';
import {useTabStore} from './stores/tab-store';
import {useSidebarStore} from './stores/sidebar-store';

/**
 * アプリケーションルートコンポーネント
 *
 * React UIツリー全体を組み立てる。
 * QueryClientProvider → Sidebar / タブバー / エディター領域 / CommandPalette の構成。
 * 各タブのEditorTableViewはマウント/アンマウントではなく display:none で切り替える。
 * これによりテストが .tab-wrapper[data-tab-name="..."] で非アクティブタブのDOMにもアクセスできる。
 */
export function App() {
    const [queryClient] = useState(() => new QueryClient());
    const [commandPaletteVisible, setCommandPaletteVisible] = useState(false);

    const tabOrder = useStore(useTabStore, state => state.tabOrder);
    const activeTabName = useStore(useTabStore, state => state.activeTabName);
    const columnSchemaMap = useStore(useTabStore, state => state.columnSchemaMap);

    // アプリ起動時にスキーマファイル一覧を読み込む
    useEffect(() => {
        useSidebarStore.getState().loadFileNamesAsync().catch(err => {
            console.error('[App] スキーマファイル一覧の読み込み失敗:', err);
        });
    }, []);

    // グローバルキーボードショートカット: Ctrl+Shift+F → SEARCHパネル、Ctrl+P → コマンドパレット
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'F') {
                e.preventDefault();
                useSidebarStore.getState().setActivePanel('search');
                return;
            }
            if (e.ctrlKey && !e.shiftKey && e.key === 'p') {
                e.preventDefault();
                setCommandPaletteVisible(true);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    function handleFileClick(tableName: string): void {
        useTabStore.getState().openTableAsync(tableName).catch(err => {
            console.error('[App] テーブルオープン失敗:', err);
        });
    }

    function handleTabClick(tableName: string): void {
        useTabStore.getState().activateTab(tableName);
    }

    function handleTabClose(tableName: string): void {
        useTabStore.getState().closeTab(tableName);
    }

    function handleNavigateToDefinition(tableName: string, pkValue: string): void {
        // 定義ジャンプ: 指定テーブルをPK値でナビゲーション
        useTabStore.getState().navigateToTableRow(tableName, pkValue);
    }

    function handleReferenceRowClick(tableName: string, pkValue: string): void {
        useTabStore.getState().navigateToTableRow(tableName, pkValue);
    }

    function handleSidebarWidthChange(_width: number): void {
        // サイドバー幅変更時のコールバック（将来のエディター領域幅調整用。現在は使用しない）
    }

    function hideCommandPalette(): void {
        setCommandPaletteVisible(false);
    }

    return (
        <QueryClientProvider client={queryClient}>
            {/* サイドバー: EXPLORER / REFERENCES / SEARCH パネル切り替え */}
            <Sidebar
                onFileClick={handleFileClick}
                onReferenceRowClick={handleReferenceRowClick}
                referencesPkValue=""
                referencesEntries={[]}
                onWidthChange={handleSidebarWidthChange}
            />
            {/* タブバー: タブ一覧 + ツールバー */}
            <div id="tab" className="tab">
                <div className="tab-scroll-area">
                    <TabBar onTabClick={handleTabClick} onTabClose={handleTabClose} />
                </div>
                <div id="toolbar" className="toolbar"></div>
            </div>
            {/* エディター領域: 左ペイン（テーブル一覧） + 右ペイン（RelationsPanel） */}
            <div id="editor" className="editor">
                <div className="editor-left-pane">
                    {tabOrder.map(tableName => {
                        const columnSchemas = columnSchemaMap.get(tableName);
                        // columnSchemaMap にない場合は空配列（オープン中でスキーマ未設定の過渡状態）
                        const schemas = columnSchemas !== undefined ? columnSchemas : [];
                        return (
                            <div
                                key={tableName}
                                className="tab-wrapper"
                                data-tab-name={tableName}
                                style={{display: tableName === activeTabName ? 'flex' : 'none'}}
                            >
                                {/* storeRowIndices=null は通常テーブル（ミニテーブルでない）を表す */}
                                <EditorTableView
                                    tableName={tableName}
                                    storeRowIndices={null}
                                    columnSchemas={schemas}
                                    autoFillEntries={[]}
                                />
                            </div>
                        );
                    })}
                </div>
                {/* RelationsPanelは1つだけ: アクティブタブの選択行に応じてrelations-storeが更新される */}
                <RelationsPanel onNavigateToDefinition={handleNavigateToDefinition} />
            </div>
            {/* コマンドパレット: Ctrl+P で表示するテーブル名ファジー検索UI */}
            <CommandPalette visible={commandPaletteVisible} onClose={hideCommandPalette} />
        </QueryClientProvider>
    );
}
