# ISSUE_0083: 内部エラーを NotificationToast に通知する

## 概要

`console.warn` / `console.error` で握りつぶされている内部エラーを、右下のベルマーク（`NotificationToast`）経由でユーザーに通知するようにする。

## 背景

`tab-reference.ts:51-53` の `.catch()` のように、非同期処理のエラーが `console.warn` だけで処理されている箇所がある。ブラウザの開発者ツールを開かない限りエラーに気づけず、サイレント障害（例: 逆参照ヒントが表示されない）が発生してもユーザーには「参照なし」としか見えない。

実際に `config` インポートの削除漏れにより `ReferenceError: config is not defined` が発生したが、`.catch()` で握りつぶされたため発見が遅れた。

## 対象箇所（調査が必要）

- `tab-reference.ts:51-53` — `resolveReverseReferencesAsync` の `.catch()`
- その他 `console.warn` / `console.error` でエラーを握りつぶしている箇所

## 要件

- `NotificationToast` は既に実装済み（`notification.ts`）で、`show(message: string)` メソッドを持つ
- 現状は `main.ts` で `window.notification` としてテスト用に公開されているのみ
- 内部エラーが発生した場合に `notification.show()` を呼んでユーザーに通知する
- 全箇所の `console.warn` / `console.error` を対象にするか、重要な非同期エラーのみに絞るかは要検討
