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
    apiVersion: 2,
    title: 'Quest Summary',
    description: 'quest テーブルの件数を表示します',
    async render(container, api) {
        const data = await api.data.readTableDataAsync('quest');
        container.textContent = data === null ? 'quest テーブルがありません' : String(data.rows.length);
    },
});
```

`apiVersion` は利用する公開APIのメジャーバージョンです。現在は `2` です。
既存プラグインとの互換性のため、`apiVersion` の省略時はバージョン1として読み込みます。新規プラグインでは `apiVersion: 2` を明示してください。
ホストはバージョン1と2の両方を受け付けるため、既存プラグインをすぐに変更する必要はありません。

`api` はViewプラグイン専用の公開APIです。
`data`、`schema`、`edit`、`events` は `window.editorApi` に対応しますが、イベント発火などのホスト専用操作は公開しません。

- `api.data`: テーブルデータ、参照ヒント、バリデーションエラー、検索結果の読み取り
- `api.schema`: スキーマの列、主キー、参照定義の読み取り
- `api.edit`: テーブルを開く、セル更新、行追加/削除、保存
- `api.events`: エディターイベントの購読
- `api.tables`: 列名と安定した行参照を使うレコード操作（バージョン2）
- `api.view`: Viewタブの dirty 状態と保存処理
- `api.notification.show(message, status?)`: トースト通知の表示。`status` は `'success'` または `'error'`（省略時は `'error'`）

View上のUIから編集する場合は、タブを切り替えずに更新できる `api.edit.setCellValueAsync()` / `api.edit.setCellValuesAsync()` を使ってください。
既存の `api.edit.setCellValue()` / `api.edit.setCellValues()` は、開いているテーブルを通常のエディター操作として更新し、そのテーブルをアクティブ化します。

参照列の候補リストは `api.data.getReferenceItemsAsync(tableName, columnName, sourceValue)` で取得できます。
動的参照（二段リスト）の列では、`sourceValue` に1段目の値を渡すと二段目の参照先テーブルを解決し、`{ tableName, columnName, displayColumnName, items }` を返します。
特定の値の表示名だけが必要な場合は `api.data.getReferenceDisplayTextAsync(tableName, columnName, sourceValue, value)` を使います。

## レコードAPI（バージョン2）

新規Viewでは、行番号・列番号の代わりに `api.tables` を使うことを推奨します。
`readRecordsAsync()` は列名をキーにした `values` と、行の挿入・削除・並び替え後も同じ行を指す `ref` を返します。

```js
const table = api.tables.get('shop_product');
const records = await table.readRecordsAsync();
if (records === null) return;

console.log(records[0].values.price);
await table.updateRecordAsync(records[0].ref, {
    price: '1200',
    sort_order: '10',
});
```

行参照はアプリを実行している間だけ有効です。行が削除された場合やテーブルがファイルから再読み込みされた場合、更新は `false` を返します。
存在しない列名を指定した場合は、プラグインの実装ミスを発見できるよう例外を送出します。

`render()` が関数または `{ dispose() }` を返した場合、Viewタブを閉じた時に呼び出されます。
`render()` が `{ save() }` を返した場合は、Viewタブの保存時に `api.view.onSave()` と同じタイミングで呼び出されます。
イベント購読や React root の破棄は `dispose()` で行ってください。

## Viewタブの保存

バージョン2では `api.view.createEditSession()` を使うと、Viewタブの未保存表示と保存対象テーブルを自動で管理できます。

```js
window.masterDataEditor.registerViewPlugin({
    id: 'shop-editor',
    apiVersion: 2,
    title: 'Shop Editor',
    async render(container, api) {
        const table = api.tables.get('shop_product');
        const records = await table.readRecordsAsync();
        if (records === null || records.length === 0) return;
        const edit = api.view.createEditSession();

        const button = document.createElement('button');
        button.textContent = '価格を変更';
        button.addEventListener('click', async () => {
            await edit.updateRecordAsync(records[0].ref, {price: '1200'});
        });
        container.appendChild(button);

        return {dispose: () => edit.dispose()};
    },
});
```

編集セッションは、更新中のPromise、変更されたテーブル、Viewタブのdirty表示を管理します。
Ctrl+Sでは未完了の更新を待ち、変更されたすべてのテーブルを保存します。
View内に独自の保存ボタンを置く場合は `api.view.saveAsync()` または `edit.saveAsync()` を呼びます。

バージョン1、またはレコードAPIを使わない独自処理では、従来どおり `api.view.setDirty()` と `api.view.onSave()` を利用できます。
保存UIまたは Ctrl+S が押されると登録した保存処理が呼ばれ、成功すると未保存マークが消えます。
保存を中断したい場合は、`onSave` の戻り値として `false` を返してください。

## バージョン1から2への移行

バージョン2はバージョン1の `data`、`schema`、`edit`、`events`、`view`、`notification` を維持した上で、`tables` と編集セッションを追加しています。
まず登録時に `apiVersion: 2` を追加します。行番号と列番号を使う編集は、必要に応じて次のように置き換えられます。

```js
// バージョン1
const data = await api.data.readTableDataAsync('shop_product');
await api.edit.setCellValuesAsync('shop_product', [
    {row: 0, column: 2, value: '1200'},
]);
api.view.setDirty(true);
api.view.onSave(() => api.edit.saveTableAsync('shop_product'));

// バージョン2
const records = await api.tables.get('shop_product').readRecordsAsync();
if (records === null || records.length === 0) return;
const edit = api.view.createEditSession();
await edit.updateRecordAsync(records[0].ref, {price: '1200'});
```

バージョン1のコードは引き続き実行できます。移行すると、列の追加や行の並び替えによって番号が変わる影響を受けにくくなり、dirty管理と複数テーブル保存をプラグイン側で実装する必要がなくなります。

## TSXビルド例

プラグイン側では TSX で UI を作り、バンドル済み JavaScript を `plugins/views` に出力します。

```tsx
import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';

function QuestSummary({api}: {api: ViewPluginAPI}) {
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
    apiVersion: 2,
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
型補完では、利用するAPIバージョンに対応する宣言ファイルをプラグインプロジェクトから参照してください。

- バージョン1: `sample-workdir/plugins/views/master-data-editor-view-plugin.d.ts`
- バージョン2: `sample-workdir/plugins/types/v2/master-data-editor-view-plugin.d.ts`

グローバル型名が重複するため、1つのプラグインプロジェクトから参照する宣言ファイルはどちらか一方だけにします。
バージョン1の宣言ファイルは既存APIの移行確認用として維持します。
バージョン2の宣言ファイルは `WebView/src/plugins/master-data-editor-view-plugin.ts` を公開型の定義元として、WebViewのビルド時に自動生成されます。
バージョン2の型だけを更新する場合は `npm run generate:view-plugin-types` を実行してください。

開発中に `plugins/views/*.js` を更新した場合は、`VIEW PLUGINS` パネル右上の再読み込みボタンで読み込み済みプラグインと開いているViewタブを更新できます。
