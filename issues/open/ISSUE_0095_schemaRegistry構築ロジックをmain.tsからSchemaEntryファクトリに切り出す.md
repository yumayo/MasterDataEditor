# schemaRegistry 構築ロジックを main.ts から SchemaEntry ファクトリに切り出す

## 背景

ISSUE_0085 で EditorAPI を実装した際、スキーマ JSON から `SchemaEntry` を構築するロジック（カラム解析、FK参照解析、primary_key 取得）が `main.ts` の初期化ループ内にインライン展開されている。
このロジックは SchemaEntry の構築責務であり、main.ts の初期化責務ではない。

## やること

- `editor-api-types.ts` の `SchemaEntry` に static ファクトリメソッド `fromSchemaJson(json: Record<string, unknown>): SchemaEntry` を追加する
- main.ts のインライン構築ロジックをファクトリメソッド呼び出しに置き換える
- Playwright テストで既存の動作が変わらないことを確認する
