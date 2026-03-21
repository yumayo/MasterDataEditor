# gitShowAsync の失敗をエラー種別で分岐する

## 問題

`refreshGitDiffForDiffTabAsync` および `refreshGitDiffAsync` の catch 節で、`gitShowAsync` のあらゆる失敗を「HEAD版が存在しない新規テーブル」として扱い `createForNewTable()`（全セルchanged）にフォールバックしている。

パスバリデーションエラー、タイムアウト、git実行エラーなど、新規テーブルとは無関係の失敗でも全セルが変更扱いになり、誤判定の原因になる。

## 期待する動作

エラーの種別に応じて分岐する：

- **HEADに存在しない**（`"fatal: path '...' does not exist in 'HEAD'"`）→ `createForNewTable()`（全セルchanged）。これは正しい動作。
- **それ以外のエラー**（バリデーションエラー、タイムアウト、git実行エラー等）→ トラッカーをリセット（`gitDiffTracker = false`）してハイライトなしにする。誤判定を防ぐ。

## 対象箇所

- `WebView/src/editor-table.ts` の `refreshGitDiffForDiffTabAsync` catch 節
- `WebView/src/editor-table.ts` の `refreshGitDiffAsync` catch 節（同様の問題がある）

## 実装案

`gitShowAsync` が reject するときの Error メッセージで分岐するか、C#側のレスポンスにエラーコードを追加して構造的に判定できるようにする。
