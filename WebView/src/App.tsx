import {useState} from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
// React UIに切り替える際に以下のimportを有効化する:
// import {Sidebar} from './components/Sidebar/Sidebar';
// import {TabBar} from './components/TabBar/TabBar';
// import {RelationsPanel} from './components/RelationsPanel/RelationsPanel';
// import type {ReferenceEntry} from './components/Sidebar/ReferencesPanel';

/*
 * React UIに切り替える際に以下のハンドラ関数を有効化する:
 *
 * function handleFileClick(tableName: string): void {
 *     useTabStore.getState().addTab(tableName);
 *     useTabStore.getState().activateTab(tableName);
 * }
 * function handleTabClick(tableName: string): void {
 *     useTabStore.getState().activateTab(tableName);
 * }
 * function handleTabClose(tableName: string): void {
 *     useTabStore.getState().removeTab(tableName);
 * }
 * function handleNavigateToDefinition(tableName: string, rowIndex: number): void {
 *     // 定義ジャンプ処理
 * }
 * function handleReferenceRowClick(tableName: string, pkValue: string): void {
 *     // 逆参照行ナビゲーション
 * }
 * function handleSidebarWidthChange(width: number): void {
 *     // エディター領域幅の連動更新
 * }
 * const EMPTY_REFERENCE_ENTRIES: ReferenceEntry[] = [];
 */

export function App() {
    const [queryClient] = useState(() => new QueryClient());

    return (
        <QueryClientProvider client={queryClient}>
            {/*
             * React UIツリーは現時点ではレンダリングしない。
             * Vanilla UIが全機能を担当しており、React UIはまだプロトタイプ段階。
             * display:none でもDOM要素は生成され、Playwrightのlocatorが
             * Vanilla側と競合するため（.sidebar-resize-handle等）、
             * Reactコンポーネントのロジック層が完成するまでツリーを生成しない。
             *
             * ロジック層が完成しReact UIに切り替える際は、以下のコメントを解除する:
             *
             * <div className="app-layout">
             *     <Sidebar onFileClick={handleFileClick} onReferenceRowClick={handleReferenceRowClick}
             *         referencesPkValue="" referencesEntries={EMPTY_REFERENCE_ENTRIES}
             *         onWidthChange={handleSidebarWidthChange} />
             *     <div className="main-area">
             *         <div className="tab-toolbar-area">
             *             <TabBar onTabClick={handleTabClick} onTabClose={handleTabClose} />
             *         </div>
             *         <div className="editor-area">
             *             <div className="editor-left-pane">
             *                 <EditorTableView tableName={activeTab} storeRowIndices={null} />
             *             </div>
             *             <RelationsPanel onNavigateToDefinition={handleNavigateToDefinition} />
             *         </div>
             *     </div>
             * </div>
             */}
        </QueryClientProvider>
    );
}
