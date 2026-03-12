import {createRoot} from 'react-dom/client';
import {App} from './App';

// React マウント: <div id="root"> が存在しない場合は起動を中断する
const rootElement = document.getElementById('root');
if (rootElement === null) {
    throw new Error('React mount point <div id="root"> が見つかりません。index.htmlを確認してください。');
}
createRoot(rootElement).render(<App />);
