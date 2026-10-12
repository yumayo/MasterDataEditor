---
name: shared_scrollbar_marker_ownership
description: 共有スクロールバーマーカーは activeTabName と display:none wrapper の順序競合で hidden タブへ退避しうる
type: project
---

右側スクロールバーマーカーは共有 `canvas.scrollbar-marker-track` を各通常タブの `.editor-table-pane-bottom-right` へ付け替える構造であり、再アタッチ先の解決が古いアクティブ状態を参照すると hidden wrapper 側へ移動して消える。
**Why:** `.tab-wrapper[data-tab-name="enemy"][style*="display: none"]` 配下の `.editor-table-main-viewport` は `clientHeight=0` になるため、そこへ再アタッチされた共有 canvas は `width="14" height="0" style="height: 0px"` になり、アクティブ `item` 側にエラーがあっても右側マーカーが見えなくなる。タブ切替中に `setVisiblePanes()` が走る設計では、`activeTabName` 更新順や「表示中ペイン」と「論理的アクティブタブ」のズレがそのまま見た目破綻になる。
**How to apply:** 右側マーカー不具合をレビューするときは、スクリーンショットだけでなく dump HTML で `canvas.scrollbar-marker-track` の親要素を必ず確認する。共有UIの付け替え先はグローバル状態推定ではなく、今まさに表示する `EditorTable` / paneStack から明示的に渡す設計を優先し、`display:none` 復帰前後の順序依存もチェックする。

2026-04-27 の dump レビューでは、修正後の `canvas.scrollbar-marker-track` は `item` 表示中に `.editor-table-pane-bottom-right` 直下へ 1 個だけ存在し、`width="14" height="629"` を維持していた。`data-tab-name="enemy"` の hidden wrapper 残留も見えず、旧構造の `.editor-left-slot` 直下配置で出ていた「ヘッダー帯を含む高さ」「hidden tab への退避」という破綻は解消されていた。
**Why:** 実スクロール領域への移設により、列ヘッダー 21px と行ヘッダー 53px を除外した高さになり、マーカーが本文領域だけに対応する。close 後 dump に `data-tab-name="item"` しか残らないことは、共有 canvas の所有権が hidden tab に取り残されていない直接証拠になる。
**How to apply:** 今後のレビューでは、`canvas.scrollbar-marker-track` の個数が 1 であること、親が `.editor-table-pane-bottom-right` であること、`height="0"` ではなく本文高さ相当の正値になっていること、不要な `data-tab-name="enemy"` wrapper が dump に残っていないことを確認基準にする。

2026-04-27 の正常系 dump では、非アクティブ `enemy` タブを閉じた後の DOM に `data-tab-name="item"` の `tab-wrapper` だけが残り、`canvas.scrollbar-marker-track` は `width="14" height="629"` のまま `.editor-table-pane-bottom-right` 直下に配置されていた。ヘッダーあり構成では `.editor-table-pane-bottom-right[style*="inset: 21px 0px 0px 53px"]`、行ヘッダーなし構成では `.editor-table-pane-bottom-right[style*="inset: 21px 0px 0px"]` となり、いずれも top inset が列ヘッダー高ぶん確保されていたため、右側マーカーが列ヘッダーへ被らない正常パターンとして扱える。
