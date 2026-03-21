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
