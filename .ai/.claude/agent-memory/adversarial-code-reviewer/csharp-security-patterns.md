---
name: C# Security Review Patterns
description: C#バックエンドのセキュリティレビューで発見されたパターンと攻撃面
type: project
---

## HelperFile.cs セキュリティパターン (2026-03-21)

### ResolveSafePath の防御層
1. `IsValidFilename()` — 入力バリデーション (defense-in-depth)
2. `ResolveSafePath()` — Path.GetFullPath 正規化 + baseDir配下 StartsWith チェック
- 両方組み合わせて使うこと。ResolveSafePath 単体でもパストラバーサルは防げるが、IsValidFilename が漏れると ADS 等の攻撃面が残る

### 既知の攻撃面 (未対応)
- **NTFS代替データストリーム**: `:` がコロンチェックなしで通過する。`Path.GetInvalidPathChars()` はコロンを無効文字としない
- **シンボリックリンク/ジャンクション**: `Path.GetFullPath` は論理パスのみ正規化。reparse point を解決しない
- **ex.Message 情報漏洩**: 全6ハンドラーの catch で ex.Message をフロントエンドに送信。フルパスや git stderr が漏洩する

### GitCommandHelper 注意点
- `ArgumentList.Add()` で引数分割インジェクションは防止済み
- `git show HEAD:{path}` の path 部分は git 内部で解釈される → ArgumentList では防げない別レイヤーの問題
- `StandardOutput.ReadToEnd()` + `StandardError.ReadToEnd()` の順次読み取りでデッドロック可能性あり（巨大CSV時）

**Why:** ローカルデスクトップアプリだが、WebView2経由のメッセージ通信で任意のリクエストを送信可能。XSS等でフロントエンドが侵害された場合の攻撃面を最小化すべき。

**How to apply:** ファイルI/Oハンドラーの新規追加・変更時に、この3つの攻撃面が全て防御されているか確認する。

## EditorApiBridge (MCP↔WebView2ブリッジ) パターン (2026-03-22)

### スレッドセーフティの要注意箇所
- `SendMessageToWebView` は `Dispatcher.Invoke` (同期) でUIスレッドにマーシャリング → Kestrelスレッドからの呼び出しでブロック/デッドロックリスク
- `TaskCompletionSource` の `SetResult` vs `TrySetCanceled` 競合: タイムアウト発火とレスポンス到着が同時の場合に `InvalidOperationException` → 必ず `TrySetResult` / `TrySetException` を使うこと
- `_pendingRequests` の `TryRemove` が `HandleResponse` と `RequestAsync.finally` の2箇所 → 除去の一元化が望ましい

### MCPツール実装時の注意
- `JsonElement.GetInt32()` / `GetString()` は `ValueKind` が期待と異なると例外スロー → API戻り値が `null` の場合の防御必須
- `Deserialize<T>()!` の null 抑制は危険 → 明示的 null チェック必須
- `Task.WhenAll` の部分失敗で `AggregateException` → 存在しないテーブル名対策が必要

### 既知の設計判断
- `WebView2Handler._editorApiBridge` は null-object パターン（`new EditorApiBridge()` でダミー初期化、後から差し替え）→ 生焼けオブジェクト禁止ルールとの矛盾あり
- `App.OnExit` で `GetAwaiter().GetResult()` による同期ブロッキング → Kestrelスレッドとの相互待機でデッドロックリスク

**Why:** MCPブリッジはKestrelスレッドプール↔UIスレッド↔WebView2 JSスレッドの3スレッドを跨ぐ。各境界でのスレッドセーフティ確保が最重要。

**How to apply:** MCPツール追加時は、API戻り値のnull/型チェック、タイムアウト競合、UIスレッドブロッキングの3点を必ず検証する。
