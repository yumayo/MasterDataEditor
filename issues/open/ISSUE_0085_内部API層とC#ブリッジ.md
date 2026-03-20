# 内部API層（EditorAPI）と C# ↔ WebView ブリッジ

## Context

ISSUE_0078（プラグイン基盤）とMCPサーバーの両方が、フロントエンド内部の操作API を必要としている。
プラグインはJS内から直接呼び、MCPサーバーはC#経由のpostMessageブリッジで呼ぶ——呼び出し経路は異なるが、叩くAPIは同じ。

本ISSUEでは、ISSUE_0078からプラグイン固有の仕組み（マニフェスト、esbuild、スクリプト注入、PluginHost）を除いた **純粋な内部API層** と、それを外部から呼べるようにする **C# ↔ WebView ブリッジプロトコル** を設計・実装する。

```
WebView (TypeScript)
  └─ EditorAPI（内部API層）
       ├─ data   — テーブルデータ読み取り
       ├─ schema — スキーマ情報取得
       ├─ edit   — セル編集・行操作（Command経由、Undo/Redo対応）
       └─ events — テーブル操作イベント購読

       ↑ 消費者
       ├─ プラグイン（ISSUE_0078）  … JS内から直接呼び出し
       ├─ MCPサーバー（将来）       … C#ブリッジ経由
       └─ 内部テスト・デバッグ用途
```

### ISSUE_0078 との関係

ISSUE_0078 は本ISSUEの EditorAPI を前提とする。
ISSUE_0078 の責務はプラグインのライフサイクル管理（発見→ビルド→ロード→activate/deactivate）と、EditorAPI をプラグインに公開する薄いラッパーに限定される。

---

## 1. EditorAPI 型定義

### 新規ファイル: `WebView/src/editor-api-types.ts`

```typescript
/** 内部API統合インターフェース */
interface EditorAPI {
    data: EditorDataAPI;
    schema: EditorSchemaAPI;
    edit: EditorEditAPI;
    events: EditorEventsAPI;
}
```

---

## 2. フェーズ別設計

### Phase 1: データ読み取りAPI

**新規ファイル**: `editor-api-types.ts`, `editor-api.ts`
**変更ファイル**: `main.ts`

#### EditorDataAPI（読み取り専用）

```typescript
interface EditorDataAPI {
    /** ストアに登録済みの全テーブル名 */
    getTableNames(): string[];
    /** ヘッダー行（ディープコピー）。テーブル未登録時は null */
    getHeader(tableName: string): string[] | null;
    /** 全行データ（ディープコピー）。テーブル未登録時は null */
    getRows(tableName: string): string[][] | null;
    /** 指定テーブルの行数 */
    getRowCount(tableName: string): number | null;
    /** 指定セルの値 */
    getCellValue(tableName: string, row: number, column: number): string | null;
}
```

#### EditorSchemaAPI

```typescript
interface EditorSchemaAPI {
    /** スキーマが登録済みの全テーブル名 */
    getSchemaTableNames(): string[];
    /** カラム定義一覧 */
    getColumns(tableName: string): EditorSchemaColumn[] | null;
    /** 主キーカラム名の配列 */
    getPrimaryKeys(tableName: string): string[] | null;
    /** 外部キー参照の一覧 */
    getReferences(tableName: string): EditorSchemaReference[] | null;
}

interface EditorSchemaColumn {
    name: string;
    type: string;
}

interface EditorSchemaReference {
    columnName: string;       // FK列名
    targetTable: string;      // 参照先テーブル名
    targetColumn: string;     // 参照先カラム名
}
```

**実装**: `InMemoryTableStore` と スキーマ情報を参照し、ディープコピーを返す。

**重要**: 全ての返り値はディープコピー。呼び出し元が内部データを直接操作してしまうことを防止する。

---

### Phase 2: データ書き込みAPI（Undo/Redo対応）

**変更ファイル**: `editor-api.ts`

#### EditorEditAPI

```typescript
interface EditorEditAPI {
    /**
     * セルの値を変更する（Undo/Redo対応）
     * 対象テーブルがタブで開かれていない場合は false
     */
    setCellValue(tableName: string, row: number, column: number, value: string): boolean;
    /**
     * 複数セルを一括変更する（1つのUndoステップ）
     * 対象テーブルがタブで開かれていない場合は false
     */
    setCellValues(tableName: string, changes: Array<{ row: number; column: number; value: string }>): boolean;
    /** 行を挿入する（Undo/Redo対応） */
    insertRow(tableName: string, rowIndex: number): boolean;
    /** 行を削除する（Undo/Redo対応） */
    deleteRow(tableName: string, rowIndex: number): boolean;
}
```

#### 実装方針

1. `EditorAPI` が `Tab` への参照を保持
2. `Tab` から対象テーブルの `EditorTable` と `History` を取得
3. 既存の `CellChangeCommand` / `InsertRowCommand` / `DeleteRowCommand` を構築
4. `History.executeCommand()` で実行 → 既存Undo/Redoスタックに統合
5. 対象テーブルがタブで開かれていない場合は `false`（DOMがSSOTのため、DOM不在では操作不可）

---

### Phase 3: イベントAPI

**変更ファイル**: `editor-api.ts`

#### EditorEventsAPI

```typescript
interface EditorEventsAPI {
    onTableOpened(handler: (event: { tableName: string }) => void): EditorDisposable;
    onTableClosed(handler: (event: { tableName: string }) => void): EditorDisposable;
    onTableSaved(handler: (event: { tableName: string }) => void): EditorDisposable;
    onCellChanged(handler: (event: EditorCellChangeEvent) => void): EditorDisposable;
    onRowSelected(handler: (event: { tableName: string; rowIndex: number }) => void): EditorDisposable;
}

interface EditorCellChangeEvent {
    tableName: string;
    row: number;
    column: number;
    oldValue: string;
    newValue: string;
}

interface EditorDisposable {
    dispose(): void;
}
```

#### イベント発火ポイント

| イベント | 発火箇所 | トリガー |
|---------|---------|---------|
| `tableOpened` | `Tab.enableTabButton()` | タブアクティブ化完了時 |
| `tableClosed` | `Tab.closeTabButton()` | タブ閉じ完了時 |
| `tableSaved` | `saveTableDataFromStoreAsync()` | CSV書き込み成功後 |
| `cellChanged` | `History.executeCommand()` | コマンド実行/Undo/Redo時 |
| `rowSelected` | `EditorTable.notifyRowSelectionChanged()` | 行選択変化時 |

---

### Phase 4: C# ↔ WebView ブリッジ

**新規ファイル（TypeScript）**: `editor-api-bridge.ts`
**新規ファイル（C#）**: `WebView2HandlerEditorApiRequest.cs`

#### プロトコル設計

C# → WebView（リクエスト）:
```json
{
    "type": "editor_api_request",
    "requestId": "uuid-1234",
    "method": "data.getRows",
    "params": { "tableName": "items" }
}
```

WebView → C#（レスポンス）:
```json
{
    "type": "editor_api_response",
    "requestId": "uuid-1234",
    "success": true,
    "data": [["1", "ポーション", "50"], ...]
}
```

#### ブリッジの方向

現在の通信は **WebView → C#（リクエスト）→ WebView（レスポンス）** の一方向。
本ISSUEでは逆方向の **C# → WebView（リクエスト）→ C#（レスポンス）** を新設する。

```
既存:  WebView --postMessage--> C# --PostWebMessageAsString--> WebView
新設:  C# --PostWebMessageAsString--> WebView --postMessage--> C#
```

#### WebView側ブリッジ（editor-api-bridge.ts）

```typescript
/**
 * C#からのAPIリクエストを受信し、EditorAPIを呼び出して結果を返す
 */
class EditorApiBridge {
    constructor(api: EditorAPI) { ... }

    /** window.chrome.webview の message イベントにリスナーを登録 */
    install(): void { ... }

    /** メッセージを受信し、method名でディスパッチ、結果をpostMessageで返す */
    private handleRequest(requestId: string, method: string, params: Record<string, unknown>): void { ... }
}
```

#### C#側ブリッジ

```csharp
// MCPサーバーやその他のC#コードが EditorAPI を呼ぶためのプロキシ
public class EditorApiBridge
{
    // WebView2にリクエストを送り、レスポンスを非同期で待つ
    public async Task<JsonElement> CallAsync(string method, object? parameters);
}
```

#### 既存api.tsとの共存

既存の `api.ts` は WebView → C# 方向のリクエストキュー。
新設のブリッジは C# → WebView 方向。方向が逆なので干渉しない。

WebView側は `message` イベントの `type` フィールドで振り分ける:
- `*_response` → 既存の `api.ts` レスポンスハンドラー
- `editor_api_request` → 新設のブリッジハンドラー

---

## 3. ファイル構成

### 新規ファイル

| ファイル | 責務 |
|---------|------|
| `WebView/src/editor-api-types.ts` | EditorAPI 全型定義 |
| `WebView/src/editor-api.ts` | EditorAPI 実装（InMemoryTableStore, Tab, History を参照） |
| `WebView/src/editor-api-bridge.ts` | C# → WebView ブリッジ（メッセージ受信→API呼出→結果返送） |
| `WebView2Handler/Handlers/WebView2HandlerEditorApiRequest.cs` | C# → WebView リクエスト送信 + レスポンス待機 |

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `main.ts` | EditorAPI インスタンス生成、ブリッジ install |
| `WebView2Handler/WebView2Handler.cs` | `editor_api_response` メッセージの受信ハンドリング追加 |

---

## 4. 検証方法

| Phase | 検証内容 |
|-------|---------|
| 1 | `editorApi.data.getTableNames()` でテーブル名一覧取得。`getRows()` の返り値を変更しても内部データに影響しない（ディープコピー検証） |
| 2 | `editorApi.edit.setCellValue()` でセル変更 → Ctrl+Z で元に戻る。タブ未開放テーブルへの操作は `false` を返す |
| 3 | テーブル開閉・セル編集時にイベントハンドラが呼ばれる。`dispose()` 後は呼ばれない |
| 4 | C# から `EditorApiBridge.CallAsync("data.getRows", ...)` でテーブルデータ取得。書き込みも同様に動作 |
| 全Phase | Playwrightテストで自動検証 |

---

## 5. 将来の消費者

- **ISSUE_0078（プラグイン基盤）**: `PluginAPI` は `EditorAPI` の薄いラッパー + プラグイン固有API（contextMenu, commands, ui）
- **MCPサーバー**: C#ブリッジ経由で `EditorAPI` を呼び、MCP tools として公開
- **E2Eテスト補助**: テストフィクスチャから `EditorAPI` を直接呼んでデータ操作
