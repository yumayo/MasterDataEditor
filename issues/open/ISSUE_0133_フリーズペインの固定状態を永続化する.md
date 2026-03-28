# ISSUE_0133 フリーズペインの固定状態を永続化する

## 概要

行・列の固定（フリーズペイン、ISSUE_0119）の固定列数・固定行数が永続化されておらず、タブを閉じて再度開くと固定状態が失われる。テーブルごとの固定状態をファイルに保存し、再オープン時に復元する。

## 背景

ISSUE_0119の仕様には「テーブルごとの固定列数・固定行数を localStorage に保存する」と記載されていたが未実装。現状 `frozenColumnCount` / `frozenRowCount` は `EditorTable` のメモリ上のフィールドのみで保持されており、タブを閉じるかアプリケーションを再起動すると固定状態がリセットされる。大量の列を持つテーブルでは毎回固定し直す手間が発生している。

## 要件

### 保存タイミング

- `freezeColumns()` / `unfreezeColumns()` / `freezeRows()` / `unfreezeRows()` の呼び出し時に即座に保存する

### 保存先

- `schema/{テーブル名}.json` に `frozenColumnCount` / `frozenRowCount` フィールドを追加する
- 値が0（未固定）の場合はフィールドを省略する（既存スキーマとの互換性維持）

### 復元タイミング

- テーブルをタブで開いた際にスキーマから固定状態を読み込み、`freezeColumns()` / `freezeRows()` を適用する

### ミニテーブルでの扱い

- ミニテーブル（RelationsPanel内）では固定機能自体が無効のため、保存・復元ともに不要

## 期待される動作

1. `enemy` テーブルの `name` 列まで固定する（2列固定）
2. `enemy` タブを閉じる
3. `enemy` テーブルを再度開く
4. `id`, `name` 列が固定された状態で表示される
5. `schema/enemy.json` に `"frozenColumnCount": 2` が保存されている

## 対象ファイル（変更）

- `WebView/src/editor-table.ts` — `freezeColumns()` / `freezeRows()` でスキーマ保存を呼び出す
- `WebView/src/tab.ts` — テーブルオープン時にスキーマから固定状態を読み込み適用する
- `WebView/src/editor-actions.ts` — スキーマJSONへの固定状態書き込み
- `WebView/e2e/freeze-pane.spec.ts` — 永続化・復元のテスト追加
