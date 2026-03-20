# MasterDataEditor プラグイン基盤 設計書

## Context

マスターデータエディターに、JS/TS/JSX/TSXでプラグインを開発できる基盤を新設する。
ユーザー固有のバリデーション・カスタムUI・データ変換などをプラグインとして追加可能にする。

### 方針決定事項
- **スコープ**: 全Phase（1〜6）の設計のみ。実装はしない。
- **ビルド**: C#側がesbuildプロセスを起動してTS/TSX/JSXをJSにトランスパイル
- **JSXランタイム**: React
- **初期API**: データ読み取り + 通知（Phase 1）

---

## 1. アーキテクチャ全体像

```
workdir/
  plugins/                          ← プラグインディレクトリ（新設）
    my-validator/
      plugin.json                   ← マニフェスト
      src/
        index.tsx                   ← TS/TSXソース
      dist/
        index.js                    ← C#がesbuildで生成したバンドル
    another-plugin/
      plugin.json
      src/
        index.ts
      dist/
        index.js
```

### ビルドフロー

```
[アプリ起動時]
C# MainWindow起動
  → workdir/plugins/*/plugin.json を列挙
  → 各プラグインの main フィールド（src/index.tsx等）を取得
  → esbuild プロセスを起動: esbuild src/index.tsx --bundle --outfile=dist/index.js --format=iife --jsx=automatic --jsx-import-source=react
  → WebView2 にビルド済み plugins/ パスを通知

[WebView2側]
  → findFilesAsync("plugins") で dist/index.js を発見
  → readFileAsync で JSコード取得
  → <script> タグとして body に挿入
  → window.__mde.registerPlugin() が呼ばれてプラグイン登録
```

### C#側の変更（新規Handler）

```csharp
// WebView2HandlerBuildPluginRequest.cs（新設）
// リクエスト: { type: "build_plugin_request", pluginDir: "plugins/my-validator", entry: "src/index.tsx" }
// 処理: Process.Start("npx", "esbuild ...") を実行
// レスポンス: { type: "build_plugin_response", success: true, outputPath: "plugins/my-validator/dist/index.js" }
```

必要な前提: workdir に `node_modules/.bin/esbuild` が存在すること（`npm install esbuild` 済み）。
あるいは、esbuild のスタンドアロンバイナリをアプリに同梱する。

### ロードフロー

```
[JS側: PluginHost.loadPluginsAsync()]
1. findFilesAsync("plugins") で plugin.json を列挙
2. 各 plugin.json を readFileAsync で読み込み → PluginManifest にパース
3. ビルド済み dist/index.js を readFileAsync で取得
4. <script> タグを動的に生成し document.body に挿入
5. スクリプト実行により window.__mde.registerPlugin() が呼ばれる
6. 登録されたプラグインの activate(api) を呼び出す
```

---

## 2. 型定義

### 新規ファイル: `WebView/src/plugin-types.ts`

```typescript
/** plugin.json のスキーマ */
interface PluginManifest {
    name: string;           // プラグイン一意名
    version: string;        // セマンティックバージョン
    description: string;    // 説明
    main: string;           // エントリポイント（例: "src/index.tsx"）
}

/** プラグインが registerPlugin に渡すオブジェクト */
interface PluginRegistration {
    name: string;
    version: string;
    activate(api: PluginAPI): void;
    deactivate(): void;
}

/** プラグインに公開する統合API */
interface PluginAPI {
    data: PluginDataAPI;
    notification: PluginNotificationAPI;
    contextMenu: PluginContextMenuAPI;
    commands: PluginCommandsAPI;
    edit: PluginEditAPI;
    events: PluginEventsAPI;
    ui: PluginUIAPI;
}
```

---

## 3. フェーズ別設計

### Phase 1: 最小動作基盤（ロード + データ読取 + 通知）

**新規ファイル**: `plugin-types.ts`, `plugin-host.ts`
**変更ファイル**: `main.ts`
**C#新規**: `WebView2HandlerBuildPluginRequest.cs`

#### PluginHost クラス

```typescript
class PluginHost {
    // コンストラクタで受け取る依存
    constructor(store: InMemoryTableStore, notification: NotificationToast)

    // ライフサイクル
    loadPluginsAsync(): Promise<void>   // 起動時に呼ぶ。全プラグインを発見→ビルド→ロード→activate
    unloadAll(): void                   // アプリ終了時に全プラグインの deactivate を呼ぶ

    // 内部状態
    private plugins: Map<string, PluginRegistration>   // 登録済みプラグイン
}
```

#### PluginDataAPI（読み取り専用）

```typescript
interface PluginDataAPI {
    getTableNames(): string[];                      // ストアに登録済みの全テーブル名
    getHeader(tableName: string): string[] | null;  // ヘッダー（ディープコピー）
    getRows(tableName: string): string[][] | null;  // 全行データ（ディープコピー）
    getSchemaColumns(tableName: string): PluginSchemaColumn[] | null;  // スキーマ情報
}

interface PluginSchemaColumn {
    name: string;
    type: string;
    // reference等のスキーマ情報
}
```

**重要**: `getRows()` / `getHeader()` はディープコピーを返す。プラグインがストア内部配列を直接操作してしまうことを防止する。

#### PluginNotificationAPI

```typescript
interface PluginNotificationAPI {
    show(message: string): void;       // トースト通知を表示
}
```

#### window.__mde グローバルオブジェクト

```typescript
// main.ts 初期化時にグローバルに公開
window.__mde = {
    registerPlugin(registration: PluginRegistration): void
};
```

#### エラー隔離

- `activate()` / `deactivate()` は try-catch で囲む
- プラグインの例外がアプリ本体を巻き込まない
- エラーは `notification.show()` で表示
- 二重登録（同名プラグイン）はエラーとして拒否

---

### Phase 2: コンテキストメニュー拡張

**変更ファイル**: `plugin-types.ts`, `plugin-host.ts`, `editor-table-context-menu.ts`, `editor-table.ts`

#### PluginContextMenuAPI

```typescript
interface PluginContextMenuAPI {
    addTableMenuItem(item: PluginContextMenuItem): void;
    removeTableMenuItem(label: string): void;
}

interface PluginContextMenuItem {
    label: string;
    action(context: PluginMenuContext): void;
}

interface PluginMenuContext {
    tableName: string;
    selectedRange: {
        startRow: number;
        startColumn: number;
        endRow: number;
        endColumn: number;
    };
    // 選択範囲のセルデータ（ディープコピー）
    selectedData: string[][];
}
```

#### 統合方法

- `PluginHost` がプラグインメニュー項目のリストを保持
- `EditorTableContextMenu` がセルコンテキストメニュー構築時に `PluginHost` から項目を取得
- セパレーター付きで既存メニューの末尾に追加
- `PluginHost` への参照は `EditorTable` 経由で渡す（密結合）

---

### Phase 3: コマンドパレット拡張

**変更ファイル**: `plugin-types.ts`, `plugin-host.ts`, `command-palette.ts`

#### PluginCommandsAPI

```typescript
interface PluginCommandsAPI {
    registerCommand(command: PluginCommand): void;
    unregisterCommand(id: string): void;
}

interface PluginCommand {
    id: string;                     // 一意のコマンドID（例: "my-plugin.validate"）
    displayName: string;            // パレットに表示する名前
    description: string | null;     // 説明テキスト
    execute(): void;                // 実行関数
}
```

#### 統合方法

- `CommandPalette` に `registerPluginCommand()` / `unregisterPluginCommand()` メソッドを追加
- 既存テーブル候補リストとプラグインコマンドリストを統合してファジー検索
- プラグインコマンドには `[Plugin]` プレフィックスバッジで視覚区別
- 選択時に `command.execute()` を呼び出す（テーブルオープンではなくコマンド実行）

---

### Phase 4: データ書き込みAPI（Undo/Redo対応）

**変更ファイル**: `plugin-types.ts`, `plugin-host.ts`

#### PluginEditAPI

```typescript
interface PluginEditAPI {
    /** セルの値を変更する（Undo/Redo対応）。成功時true、テーブル未開放時false */
    setCellValue(tableName: string, row: number, column: number, value: string): boolean;
    /** 複数セルを一括変更する（1つのUndoステップ）。成功時true */
    setCellValues(tableName: string, changes: Array<{ row: number; column: number; value: string }>): boolean;
    /** 行を挿入する（Undo/Redo対応）。成功時true */
    insertRow(tableName: string, rowIndex: number): boolean;
    /** 行を削除する（Undo/Redo対応）。成功時true */
    deleteRow(tableName: string, rowIndex: number): boolean;
}
```

#### 実装方針

1. `PluginHost` が `Tab` への参照を保持（Phase 4で追加）
2. `Tab` から対象テーブルの `EditorTable` と `History` を取得
3. `CellChangeCommand` / `InsertRowCommand` / `DeleteRowCommand` を構築
4. `History.executeCommand()` で実行 → 既存Undo/Redoスタックに自然統合
5. 対象テーブルがタブで開かれていない場合は `false` を返す（DOM不整合防止）

---

### Phase 5: イベントフック

**変更ファイル**: `plugin-types.ts`, `plugin-host.ts`, `tab.ts`, `editor-actions.ts`, `history.ts`

#### PluginEventsAPI

```typescript
interface PluginEventsAPI {
    /** テーブルが開かれたとき */
    onTableOpened(handler: (event: { tableName: string }) => void): PluginDisposable;
    /** テーブルが閉じられたとき */
    onTableClosed(handler: (event: { tableName: string }) => void): PluginDisposable;
    /** テーブルが保存されたとき */
    onTableSaved(handler: (event: { tableName: string }) => void): PluginDisposable;
    /** セルが編集されたとき（Undo/Redoも含む） */
    onCellChanged(handler: (event: PluginCellChangeEvent) => void): PluginDisposable;
    /** 行が選択されたとき */
    onRowSelected(handler: (event: { tableName: string; rowIndex: number }) => void): PluginDisposable;
}

interface PluginCellChangeEvent {
    tableName: string;
    row: number;
    column: number;
    oldValue: string;
    newValue: string;
}

interface PluginDisposable {
    dispose(): void;  // ハンドラを解除
}
```

#### イベント発火ポイント

| イベント | 発火箇所 | 発火トリガー |
|---------|---------|------------|
| `tableOpened` | `Tab.enableTabButton()` | タブアクティブ化完了時 |
| `tableClosed` | `Tab.closeTabButton()` | タブ閉じ完了時 |
| `tableSaved` | `saveTableDataFromStoreAsync()` | CSV書き込み成功後 |
| `cellChanged` | `History.executeCommand()` | コマンド実行/Undo/Redo時 |
| `rowSelected` | `EditorTable.notifyRowSelectionChanged()` | 行選択変化時 |

#### 実装方針

- `PluginHost` 内にイベントディスパッチャーを実装（`Map<string, Set<Function>>`）
- 各発火箇所から `PluginHost` のdispatchメソッドを直接呼び出す（密結合パターン）
- 全ハンドラ呼び出しを try-catch で隔離
- `PluginDisposable.dispose()` でハンドラを解除 → プラグインの `deactivate()` でクリーンアップ

---

### Phase 6: カスタムUI（サイドバーパネル + React対応）

**変更ファイル**: `plugin-types.ts`, `plugin-host.ts`, `sidebar.ts`, `activity-bar.ts`

#### PluginUIAPI

```typescript
interface PluginUIAPI {
    /** サイドバーにカスタムパネルを追加する */
    addSidebarPanel(panel: PluginSidebarPanel): void;
    /** サイドバーパネルを削除する */
    removeSidebarPanel(id: string): void;
    /** アクティブなエディタテーブルのDOM要素を取得する（読み取り専用用途） */
    getActiveTableElement(): HTMLElement | null;
}

interface PluginSidebarPanel {
    id: string;                              // パネル一意ID
    title: string;                           // パネルタイトル
    icon: string;                            // SVGパス文字列（ActivityBarアイコン用）
    render(container: HTMLElement): void;     // コンテナに描画する関数
    dispose(): void;                         // パネル破棄時のクリーンアップ
}
```

#### React対応

プラグインがJSX/TSXで書いた場合、`render(container)` 内でReactのcreateRootを使う：

```tsx
// プラグイン側のイメージ
import React from 'react';
import { createRoot } from 'react-dom/client';

window.__mde.registerPlugin({
    name: 'my-panel',
    version: '1.0.0',
    activate(api) {
        api.ui.addSidebarPanel({
            id: 'my-panel',
            title: 'マイパネル',
            icon: 'M12 2L2 7v10l10 5...',
            render(container) {
                const root = createRoot(container);
                root.render(<MyComponent api={api} />);
            },
            dispose() {
                // Reactのクリーンアップ
            }
        });
    },
    deactivate() {}
});
```

#### esbuildの設定

C#がesbuildを起動する際の引数：

```
esbuild src/index.tsx \
  --bundle \
  --outfile=dist/index.js \
  --format=iife \
  --global-name=__plugin_MyPlugin \
  --jsx=automatic \
  --jsx-import-source=react \
  --external:react \
  --external:react-dom
```

React/ReactDOMは本体側がグローバルに提供するか、プラグインにバンドルさせるかの選択がある。
**推奨**: 本体側がReactをグローバルに提供し、`--external:react` でプラグイン側は参照のみ。
これにより複数プラグインがReactを重複バンドルする問題を回避。

#### サイドバー統合

- `ActivityBar` にプラグインパネルのアイコンを追加（既存のEXPLORER/REFERENCES/SEARCH/SOURCE CONTROLの下に配置）
- パネル切替時に `render(container)` / `dispose()` を呼び出す
- コンテナは `<div class="plugin-panel-container">` として生成し、プラグインはこの中だけにDOMを構築する規約

---

## 4. セキュリティ設計

### 本体が提供する防御層

| 防御 | 方法 |
|------|------|
| データ汚染防止 | `getRows()` / `getHeader()` はディープコピーを返す |
| 例外隔離 | プラグインの全メソッド呼び出しをtry-catchで囲む |
| ファイルアクセス制限 | C#側の `HelperFile.IsValidFilename` がパストラバーサルを防止 |
| ネットワーク遮断 | WebView2の `WebResourceRequested` フィルターが外部通信を遮断済み |

### 意図的に提供しない防御層

| 非防御 | 理由 |
|--------|------|
| JS隔離（iframe/Worker） | 密結合設計との整合。信頼できるプラグインのみ配置が前提 |
| DOM操作の制限 | 技術的にはdocument全体にアクセス可能。API経由操作はプラグイン規約 |

---

## 5. ファイル構成まとめ

### 新規ファイル（TypeScript）

| ファイル | 責務 |
|---------|------|
| `WebView/src/plugin-types.ts` | 全API型定義（PluginManifest, PluginAPI, 各サブAPI） |
| `WebView/src/plugin-host.ts` | プラグインライフサイクル管理・API実装・イベントディスパッチ |

### 新規ファイル（C#）

| ファイル | 責務 |
|---------|------|
| `WebView2Handler/Handlers/WebView2HandlerBuildPluginRequest.cs` | esbuildプロセス起動・トランスパイル実行 |

### 変更ファイル（Phase別）

| Phase | 変更ファイル |
|-------|------------|
| 1 | `main.ts` |
| 2 | `editor-table-context-menu.ts`, `editor-table.ts` |
| 3 | `command-palette.ts` |
| 4 | （plugin-host内で完結。Tab参照追加のみ） |
| 5 | `tab.ts`, `editor-actions.ts`, `history.ts` |
| 6 | `sidebar.ts`, `activity-bar.ts` |

---

## 6. プラグイン開発者向けテンプレート

Phase 1完了時に以下を提供：

1. **型定義ファイル**: `mde.d.ts` — `window.__mde` のTypeScript型定義
2. **サンプル plugin.json**
3. **サンプルプラグイン**（TS版: バリデーター、TSX版: カスタムパネル）
4. **ドキュメント**: `docs/plugin-development.md`

### plugin.json サンプル

```json
{
    "name": "my-validator",
    "version": "1.0.0",
    "description": "テーブルデータのバリデーションプラグイン",
    "main": "src/index.ts"
}
```

### プラグインのディレクトリ構造

```
my-validator/
  plugin.json
  src/
    index.ts          ← エントリポイント（TS/TSX/JSX）
  dist/
    index.js          ← C#がesbuildで自動生成
  node_modules/       ← プラグイン固有の依存（React等）
  package.json        ← プラグイン固有のnpm設定
```

---

## 7. 検証方法

| Phase | 検証内容 |
|-------|---------|
| 1 | サンプルプラグインを `plugins/` に配置 → 起動時にactivateが呼ばれる → `api.data.getTableNames()` でテーブル名取得 → `api.notification.show()` で通知表示 |
| 2 | プラグインから追加したメニュー項目が右クリックで表示される → クリックで実行される |
| 3 | Ctrl+Pで表示されるコマンドパレットにプラグインコマンドが表示される → 選択で実行される |
| 4 | プラグインから `api.edit.setCellValue()` でセル値変更 → Ctrl+Zで元に戻る |
| 5 | テーブル操作時にプラグインの `onTableOpened` / `onCellChanged` 等のハンドラが呼ばれる |
| 6 | サイドバーにプラグインパネルのアイコンが表示される → クリックでReactコンポーネントが描画される |
| 全Phase | Playwrightテストで自動検証（e2eフィクスチャにモックプラグインを配置） |
