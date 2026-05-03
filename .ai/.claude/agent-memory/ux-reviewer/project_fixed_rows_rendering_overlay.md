---
name: fixed_rows_rendering_overlay
description: 固定行で内容欠落・背景透け・境界崩れが同時発生した場合のUX上の重大パターン
type: project
---

固定行領域で「セル内容が消える」「下のスクロール内容が透ける」「固定境界が壊れる」が同時に出たら、見た目の軽微な乱れではなく、固定オーバーレイ層の描画責務分離が破綻している重大UX不具合として扱う。

**Why:** プランナーは固定行を見出し補助ではなく作業中の文脈保持に使うため、固定領域が空白化したり下層データが透けると「どの行が固定され、どこから通常スクロールか」を即座に見失う。誤編集や確認漏れに直結する。

**How to apply:** 固定行・固定列レビューでは、内容欠落、背景不透明性、境界線の3点を必ずセットで確認する。特に「固定最終行の直下に最初の通常行が並ぶ」場面で、境界の線・影・背景塗りが一貫しているかを重点的に見る。

2026-04-19 の固定行最終レビューでは、この重大パターンは解消済みだった。スクリーンショット上で固定1〜12行の本文が連続して視認でき、最終固定行の直下に境界線が成立していた。DOMでも `editor-table-detached-frozen-row-background-layer` が固定本文の背面を独立保持し、`editor-table-detached-frozen-row-layer` / `editor-table-detached-row-header-layer` / 背景レイヤーのすべてで `freeze-row-border` が最終固定行に付いていたため、今後はこの組み合わせを「透け防止と境界成立の合格パターン」として扱う。

2026-04-20 の仮想スクロール追従レビューでは、`refreshQuadrantViewportRowHeaders` の位置計算を `offsetTop` 読み取りから論理行インデックス基準へ切り替えた後も、この合格パターンは維持されていた。固定行ダンプでは `editor-table-pane-top-left` / `editor-table-pane-top-right` / `editor-table-pane-bottom-left` の分割が崩れず、`editor-table-detached-frozen-row-background-layer` と `editor-table-detached-frozen-row-layer` がどちらも `top: 21px` / `42px` を共有していたため、背景面と本文面の位置ずれは見られなかった。`fill-handle` も `z-index: 26` で固定行選択上に正しく残り、参照ヒントケースでは固定行セル内の `cell-reverse-reference-hint` が通常行と同じDOMパターンを保っていた。

**Why:** 固定行の座標源を `offsetTop` から論理行インデックスへ切り替える変更は、深いスクロールや表示レンジ更新時に「背景だけ合って本文がずれる」「fill-handle だけ旧座標に残る」「固定行の参照ヒントだけ別行値を引く」という再発リスクを持つ。ここが無事なら、固定領域まわりの責務分離が論理座標系でも成立していると判断しやすい。

**How to apply:** 今後同系統の変更をレビューするときは、スクリーンショットで固定最終行直下の境界線と fill-handle の位置を確認し、DOMでは `editor-table-detached-frozen-row-background-layer` と `editor-table-detached-frozen-row-layer` の `top` 値一致、`fill-handle` の前面維持、`cell-reverse-reference-hint` の固定行/通常行での構造一致をセットで確認する。

2026-04-20 の最終レビューでは、コメント付きヘッダーを含む 4 象限でも `editor-table-pane-top-left` / `editor-table-pane-top-right` がともに `height: 94px` で成立し、固定1行目・2行目の `top` が左右で `41px` / `67.5px` に一致していた。通常領域でも `data-row-index="60"` が行ヘッダー層と本文層の双方に存在し、行高共有による Y 座標同期は維持されていた。`selected` 同期も `data-row-index="5"` と `data-row-index="90"` のケースで分離行ヘッダー側に `selected` / `sel-adj-right` が入り、本文側のフォーカスセルと視覚的に噛み合っていたため、4象限化による「選択中なのに行ヘッダーだけ未選択」に戻っていない。

同レビューで唯一の継続監視点は、深いスクロール + 行追加ダンプで `fill-handle` が `display: block; top: -572px;` のまま残っていたこと。スクリーンショット上では視覚破綻になっていないため今回の評価は下げないが、固定領域の改善と別系統で「オフスクリーン残存」の癖はまだ残っていると記録しておく。
