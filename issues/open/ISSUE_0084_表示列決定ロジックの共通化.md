# ISSUE_0084: 表示列決定ロジック（determineDisplayColumn）の共通化

## 概要

`config.referenceDisplayColumnPriority` を走査して優先度の高い表示列を決定するロジックが4箇所にコピペされている。共通関数に集約する。

## 背景

`config.primaryKeyColumnName` 廃止リファクタリング時に、`reverse-reference-resolver.ts` から `config` インポートを削除した際、同ファイル内の `determineDisplayColumnIndex` が `config.referenceDisplayColumnPriority` を使っていることに気づけず `ReferenceError: config is not defined` がサイレント障害として発生した。ロジックが分散していることが見落としの直接原因。

## 分散箇所

| ファイル | メソッド | 戻り値 |
|---|---|---|
| `reference-data-cache.ts:390` | `determineDisplayColumn()` | 列名 (string) |
| `reverse-reference-resolver.ts:427` | `determineDisplayColumnIndex()` | CSVインデックス (number) |
| `form-panel.ts:523` | `findDisplayColumnIndex()` | ヘッダーインデックス (number) |
| `search-panel.ts:331` | インライン展開 | ヘッダーインデックス (number) |
| `editor-table-reference.ts:373` | インラインチェック | boolean判定 |

## 要件

- 共通関数を1箇所に定義し、全箇所からインポートする
- 戻り値の型が異なる（列名 vs インデックス）ため、列名を返す関数を基本とし、インデックス変換は呼び出し側で行う設計が妥当
- `config.referenceDisplayColumnPriority` への依存を1箇所に集約することで、将来のインポート削除漏れを防止する
