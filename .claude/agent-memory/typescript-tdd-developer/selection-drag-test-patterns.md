# 選択ドラッグのE2Eで確認する前提

- RowDragController は行ヘッダーの `.selected` を mousedown 時に判定し、選択済み行では行移動、未選択行では範囲選択を開始する。初期フォーカス行にも `.selected` が付くため、先頭行から範囲選択するテストでは別行を実クリックしてからドラッグを始める。
- `.selection-overlay-border` は `.editor-table` の子とは限らず、通常テーブルでは同じ `.tab-wrapper` 内の兄弟領域に置かれる。選択枠のlocatorは対象タブのwrapperで絞り込む。空のevaluateAll結果をMath.min/Math.maxへ渡すとInfinityになり、本来の失敗原因が見えなくなるため、先に枠の表示を確認する。
