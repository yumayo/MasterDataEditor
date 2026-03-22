# ISSUE_0112 スキーマにdefaultフィールドを追加しFK検証でデフォルト値をスキップする

## 背景

ゲームのマスターデータでは、FK列に「参照なし」を意味するデフォルト値（例: `0`）が頻繁に使われる。
現在のバリデーションでは空セル（`""`）のみFK参照切れの検証をスキップしているが、型ごとのデフォルト値（int: `0`、string: `""`、bool: `false`）やスキーマで明示的に指定されたデフォルト値がFK参照切れとして誤検出される。

例えば、int型のFK列に `0` を入力した場合、参照先テーブルに `0` が存在しなければFK参照切れエラーになるが、`0` は「未設定」を意味するデフォルト値であり、エラーにすべきではない。

## やること

### 1. スキーマJSONフォーマットに `default` フィールドを追加

header の各カラム定義に `default` フィールドを追加する。

```json
{
    "header": [
        {
            "key": 0,
            "name": "item_id",
            "type": "int",
            "comment": "アイテムID",
            "reference": "item.id",
            "default": 0,
            "width": 120
        }
    ]
}
```

- `default` フィールドは省略可能
- 値は `number | string | boolean` を受け付ける（スキーマJSONの型に合わせる）

### 2. 空セルを型ごとのデフォルト値と同等に扱う

空セル（`""`）は各型のデフォルト値と同等として扱う：

| 型 | デフォルト値 |
|----|-----------|
| int | `0` |
| string | `""` |
| bool | `false` |

つまり、int型の列で空セルは `0` と同等であり、string型の列で空セルは `""` と同等である。

### 3. FK検証でデフォルト値をスキップする

`ValidationEngine.validateSimpleReference()` および `validateDynamicReference()` において、セル値が以下のいずれかに該当する場合はFK参照切れエラーとしない：

1. 空セル（`""`）— 現状の動作を維持
2. スキーマで `default` が明示的に指定されている場合、セル値が `default` 値と一致する
3. スキーマで `default` が未指定の場合、セル値が型ごとのデフォルト値と一致する（int列で `"0"`、bool列で `"false"`）

**判定ロジックの整理:**
- セル値が `""` の場合 → スキップ（現行通り）
- スキーマに `default` がある場合 → セル値が `String(default)` と一致すればスキップ
- スキーマに `default` がない場合 → セル値が型デフォルト（int: `"0"`, string: `""`, bool: `"false"`）と一致すればスキップ

### 4. TypeScript側の型定義への反映

#### SchemaEntry / EditorSchemaColumn にdefault情報を追加

```typescript
export interface EditorSchemaColumn {
    name: string;
    type: string;
    default: string | null;  // デフォルト値（文字列化済み）。nullの場合は型ごとのデフォルトを使用
}
```

#### createSchemaEntryFromJson の修正

`default` フィールドを読み取り、文字列に変換して `EditorSchemaColumn.default` に格納する。

#### ValidationEngine の TableSchema にも反映

```typescript
interface TableSchemaColumn {
    name: string;
    type: string;
    reference: string | null;
    default: string | null;  // 追加
}
```

### 5. 影響範囲

- `editor-api-types.ts`: `EditorSchemaColumn` に `default` フィールド追加、`createSchemaEntryFromJson` の修正
- `validation-engine.ts`: `TableSchema` の列定義に `default` 追加、FK検証ロジックの修正
- `form-panel.ts`: スキーマJSON読み込み時に `default` を扱う場合（必要に応じて）
- `diff-view.ts` / `diff-rows.ts`: SchemaColumn に `default` 追加が必要な場合

## テスト

- int型FK列にデフォルト値 `0` を入力した場合、FK参照切れエラーにならないこと
- int型FK列の空セルがFK参照切れエラーにならないこと（現行動作維持）
- bool型FK列にデフォルト値 `false` を入力した場合、FK参照切れエラーにならないこと
- スキーマで `"default": 999` と明示した列に `999` を入力した場合、FK参照切れエラーにならないこと
- デフォルト値以外の不正な値（参照先に存在しない値）は従来通りFK参照切れエラーになること
- 動的参照（DynamicReference）でもデフォルト値スキップが機能すること
