# Viewプラグイン開発

Viewプラグインは `plugins/views/*.js` に配置する JavaScript ファイルです。
エディター起動時に読み込まれ、アクティビティバーの `VIEW PLUGINS` パネルに一覧表示されます。
一覧の項目をクリックすると、サイドパネルではなく通常のタブとして View が開きます。
開いていたViewタブは他のタブと同じようにUI状態へ保存され、次回起動時に同じプラグインIDで復元されます。

## ランタイムAPI

Viewプラグインは `window.masterDataEditor.registerViewPlugin` で登録します。

```js
window.masterDataEditor.registerViewPlugin({
    id: 'quest-summary',
    title: 'Quest Summary',
    description: 'quest テーブルの件数を表示します',
    async render(container, api) {
        const data = await api.data.readTableDataAsync('quest');
        container.textContent = data === null ? 'quest テーブルがありません' : String(data.rows.length);
    },
});
```

`api` には `window.editorApi` と同じ内部APIを渡しています。

- `api.data`: テーブルデータ、参照ヒント、バリデーションエラー、検索結果の読み取り
- `api.schema`: スキーマの列、主キー、参照定義の読み取り
- `api.edit`: テーブルを開く、セル更新、行追加/削除、保存
- `api.events`: エディターイベントの購読
- `api.view`: Viewタブの dirty 状態と保存処理
- `api.notification.show(message, status?)`: トースト通知の表示。`status` は `'success'` または `'error'`（省略時は `'error'`）

View上のUIから編集する場合は、タブを切り替えずに更新できる `api.edit.setCellValueAsync()` / `api.edit.setCellValuesAsync()` を使ってください。
既存の `api.edit.setCellValue()` / `api.edit.setCellValues()` は、開いているテーブルを通常のエディター操作として更新し、そのテーブルをアクティブ化します。

参照列の候補リストは `api.data.getReferenceItemsAsync(tableName, columnName, sourceValue)` で取得できます。
動的参照（二段リスト）の列では、`sourceValue` に1段目の値を渡すと二段目の参照先テーブルを解決し、`{ tableName, columnName, displayColumnName, items }` を返します。
特定の値の表示名だけが必要な場合は `api.data.getReferenceDisplayTextAsync(tableName, columnName, sourceValue, value)` を使います。

`render()` が関数または `{ dispose() }` を返した場合、Viewタブを閉じた時に呼び出されます。
`render()` が `{ save() }` を返した場合は、Viewタブの保存時に `api.view.onSave()` と同じタイミングで呼び出されます。
イベント購読や React root の破棄は `dispose()` で行ってください。

## Viewタブの保存

Viewプラグインがテーブルを書き換える場合は、`api.view.setDirty(true)` でタブに未保存マークを付け、`api.view.onSave()` で保存処理を登録します。
保存UIまたは Ctrl+S が押されると、この保存処理が呼ばれます。保存に成功したら未保存マークは自動で消えます。

```js
window.masterDataEditor.registerViewPlugin({
    id: 'shop-editor',
    title: 'Shop Editor',
    render(container, api) {
        const dirtyTables = new Set();
        api.view.onSave(async () => {
            const results = await Promise.all([...dirtyTables].map(tableName => api.edit.saveTableAsync(tableName)));
            const saved = results.every(result => result);
            if (saved) dirtyTables.clear();
            return saved;
        });

        const button = document.createElement('button');
        button.textContent = '価格を変更';
        button.addEventListener('click', async () => {
            const updated = await api.edit.setCellValueAsync('shop_product', 0, 3, '1200');
            if (updated) {
                dirtyTables.add('shop_product');
                api.view.setDirty(true);
            }
        });
        container.appendChild(button);
    },
});
```

View内に独自の保存ボタンを置く場合は `api.view.saveAsync()` を呼びます。
保存を中断したい場合は、`onSave` の戻り値として `false` を返してください。

## TSXビルド例

プラグイン側では TSX で UI を作り、バンドル済み JavaScript を `plugins/views` に出力します。

```tsx
import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';

type ViewPluginApi = {
    data: typeof window.editorApi.data;
    edit: typeof window.editorApi.edit;
    view: {
        setDirty(dirty: boolean): void;
        onSave(handler: () => void | boolean | Promise<void | boolean>): { dispose(): void };
        saveAsync(): Promise<boolean>;
    };
    notification: { show(message: string, status?: 'success' | 'error'): void };
};

function QuestSummary({api}: {api: ViewPluginApi}) {
    const [count, setCount] = useState<number | null>(null);

    useEffect(() => {
        api.data.readTableDataAsync('quest')
            .then(data => { setCount(data === null ? 0 : data.rows.length); });
    }, [api]);

    return (
        <main>
            <h2>Quest Summary</h2>
            <div>quest rows: {count ?? 'loading'}</div>
            <button onClick={() => { api.edit.openTableAsync('quest'); }}>Open quest</button>
        </main>
    );
}

window.masterDataEditor.registerViewPlugin({
    id: 'quest-summary',
    title: 'Quest Summary',
    render(container, api) {
        const root = createRoot(container);
        root.render(<QuestSummary api={api} />);
        return () => { root.unmount(); };
    },
});
```

ビルドコマンド例:

```sh
npx esbuild src/index.tsx --bundle --format=iife --outfile=../../plugins/views/quest-summary.js
```

React を使う場合は、プラグインのバンドルに含めるか、ビルド時に external 指定して別途提供してください。
型補完には `sample-workdir/plugins/views/master-data-editor-view-plugin.d.ts` をプラグインプロジェクトから参照できます。
