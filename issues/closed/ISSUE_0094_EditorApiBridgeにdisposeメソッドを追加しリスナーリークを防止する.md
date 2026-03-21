# EditorApiBridge に dispose メソッドを追加しリスナーリークを防止する

## 背景

ISSUE_0085 で実装した `EditorApiBridge.install()` は無名リスナーを `window.chrome.webview` に登録するが、`removeEventListener` する手段がない。
現在は `install()` が main.ts で1回だけ呼ばれるため問題にならないが、将来的にブリッジの再構築時にリスナーが累積するリスクがある。

## やること

- リスナー関数をフィールドに保持する
- `dispose()` メソッドを追加し、`removeEventListener` でリスナーを解除する
- 二重 `install()` を防止するガードを追加する
