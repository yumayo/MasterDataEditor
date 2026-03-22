# ISSUE_0110 MCPツールでバリデーションエラー一覧を取得する

## 背景

MCPサーバー経由でバリデーションエラー一覧を取得できれば、LLMに「このエラーを修正して」と依頼するだけで自動修復のワークフローが成立する：

1. LLM が `GetValidationErrors` でエラー一覧を取得
2. エラー内容を解析し、修正値を決定
3. `UpdateCell` / `UpdateCells`（ISSUE_0109）でセルを修正
4. 再度 `GetValidationErrors` でエラーが解消されたことを確認

TypeScript側には `ValidationEngine` が既に実装されており、PK重複・FK参照切れ・型不一致の3種別のエラーを検出できる。
ただし現状 `ValidationEngine.validate()` は `ValidationPanel` からのみ呼ばれており、EditorAPI経由で外部からアクセスする手段がない。

## やること

### TypeScript側: EditorAPI にバリデーションエラー取得メソッドを追加

#### EditorDataAPI に追加
```typescript
/** 全テーブルのバリデーションエラー一覧を取得する */
getValidationErrors(): ValidationErrorInfo[];
```

#### ValidationErrorInfo 型を定義（editor-api-types.ts）
```typescript
export interface ValidationErrorInfo {
    tableName: string;
    rowIndex: number;
    columnName: string;
    value: string;
    kind: 'pk-duplicate' | 'fk-broken' | 'type-mismatch';
    message: string;
}
```

#### EditorApiImpl に実装
- `ValidationPanel` が保持している `currentErrors` を参照してエラー一覧を返す
- または `ValidationEngine.validate()` を直接呼び出して最新のエラーを取得する

### C#側: MCPツール `ValidationTool` を新設

`App.MasterDataEditor/Mcp/Tools/ValidationTool.cs` を作成する。

#### GetValidationErrors
- 説明: 全テーブルのバリデーションエラー一覧を取得する（PK重複・FK参照切れ・型不一致）
- パラメータ: なし（全テーブル対象）、またはオプションで `tableName`（特定テーブルのみ）
- EditorApiBridge経由で `data.getValidationErrors` を呼び出す
- 戻り値: エラー一覧を人間可読なテキストでフォーマットして返す

出力フォーマット例:
```
バリデーションエラー (3件):

[PK重複] chara テーブル 行3 列 "id": 値 "1" — 主キー値 "1" が重複しています
[FK参照切れ] shop テーブル 行5 列 "item_id": 値 "999" — 参照先 item.id に値 "999" が存在しません
[型不一致] chara テーブル 行2 列 "hp": 値 "abc" — 値 "abc" は型 int と一致しません
```

### McpHttpServer への登録

`McpHttpServer.CreateAndStartAsync` の `.WithTools<>()` チェーンに `ValidationTool` を追加する。

## 想定されるLLMワークフロー

```
User: 「バリデーションエラーを全部修正して」

LLM:
1. GetValidationErrors() → エラー3件取得
2. DescribeTable("shop") → shop テーブルの構造と参照先を確認
3. DescribeTable("item") → item テーブルの有効なIDを確認
4. UpdateCell("shop", 5, "item_id", "42") → FK参照切れを有効値に修正
5. UpdateCell("chara", 2, "hp", "100") → 型不一致を正しい型の値に修正
6. GetValidationErrors() → エラー0件を確認
```

## テスト

- PK重複、FK参照切れ、型不一致の各エラーが正しく取得できることを検証
- エラーがない場合に空のレスポンスが返ることを検証
- テーブル名フィルタが正しく動作することを検証
