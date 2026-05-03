---
name: playwright
description: Playwrightテストを実行するためのラッパースキルです。テスト実行コマンドの正しい形式を提供します。
---

# Playwright テスト実行スキル

PlaywrightテストはDockerコンテナ内で実行する必要があります。ローカルの `npx playwright test` は使用しません。

## 実行方法

ラッパースクリプト `playwright` を使用してください。

### すべてのテストを実行する

```sh
playwright
```

### 特定のテストのみ実行する

```sh
playwright <テスト名>
```

### 引数をすべて渡す

すべての引数がそのまま `npx playwright test` に渡されます。

```sh
playwright --grep "テストパターン" --workers=1
```
