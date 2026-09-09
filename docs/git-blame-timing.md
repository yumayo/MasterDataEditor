# BLAME の処理時間を確認する

テーブルの行番号を右クリックし、「変更履歴を表示」を実行する。
下部の **DEBUG CONSOLE** に `git_blame [段階名] #requestId` が追加される。
同じ `requestId` の行が1回の実行に対応し、「時間」列に各段階の所要時間が表示される。
計測行をクリックすると、小さな計測データだけを API 詳細タブで確認できる。

計測データには `durationMs`（ミリ秒）、`source`（`host` または `webview`）、
対象に応じて `filename`、`chars`、`entryCount`、`renderedRows`、`consumer` が含まれる。
`chars` は .NET / JavaScript の文字列の長さ（UTF-16 コード単位数）で、バイト数ではない。

## 計測区間

| 段階名 | 計測する処理 |
| --- | --- |
| `background_queue_wait` | C# バックグラウンド処理が実行されるまでの待ち時間 |
| `resolve_git_root` | 作業ディレクトリの取得と `git rev-parse` によるルート解決 |
| `git_command_and_read_stdout` | `git blame --porcelain` の起動、標準出力の全文読み取り、終了待ち |
| `porcelain_split_lines` | Git の出力全文を改行で分割 |
| `porcelain_parse_entries` | 分割済みの行を解析し、行ごとの著者・日時等のオブジェクトを生成 |
| `response_json_serialize` | C# でレスポンス全体を JSON 化 |
| `response_dispatcher_wait` | JSON 化後、Windows の UI スレッドで送信を開始するまでの待ち時間 |
| `response_post_message_call` | `PostWebMessageAsString` の呼び出しから戻るまで |
| `response_json_parse` | WebView 側でレスポンスを `JSON.parse`。`consumer` ごとに別計測 |
| `response_log_json_stringify` | API レスポンスの全文ログを作るための `JSON.stringify` |
| `response_console_info_call` | API レスポンスのログ文字列構築と `console.info` の呼び出し |
| `console_event_json_parse` | C# で DevTools のコンソールイベントを JSON 解析 |
| `console_log_prepare` | コンソールイベントから文字列を取り出し、ファイル用のログ行を組み立て |
| `console_log_file_write` | 上記ログ行の同期ファイル書き込み |
| `prepare_rendered_rows` | 既存の BLAME セルの除去と表示状態の準備 |
| `index_entries` | 全 BLAME エントリを行番号で引ける配列へ格納 |
| `insert_blame_cells` | 描画中の行に BLAME ヘッダー・セルを追加 |
| `update_selection` | BLAME 列挿入に伴う選択範囲の補正と描画更新 |
| `refresh_layout` | 固定行・固定列・表示用ヘッダー等のレイアウト更新 |
| `request_to_response_event_total` | API 呼び出し開始から、対応する受信ハンドラーに入るまでの合計 |
| `show_total` | BLAME 表示開始から、API 取得と上記の同期表示反映が終わるまでの合計 |
| `handler_failed_total` | C# の BLAME 処理が例外で終了した場合の経過時間 |

`response_json_parse` の `consumer=sidebar` はサイドバーの通知リスナー、
`consumer=api:git_blame#ID` は当該 API の応答リスナー。
他の API が応答待ちの場合は、そのリスナーによる同じレスポンスの再解析も記録される。

## 数字の読み方

- `*_total` は他の段階を含む合計なので、各段階と足し合わせない。
  `show_total` にはブラウザーの次のフレームでの描画完了は含まれない。
- Git の実行と標準出力の読み取りは並行して進むため、一つの区間として計測する。
- `response_post_message_call` は送信 API の呼び出し時間であり、WebView の受信完了までの転送時間ではない。
  `request_to_response_event_total` には Git・解析・シリアライズ・通信・受信キュー等が含まれる。
- WebView 側の `console.info` と、C# 側のコンソールイベント処理・ファイル書き込みは別の区間。
  後者の計測通知は `show_total` の後に届くこともある。
- 計測値には追加ログの出力時間自体を含めないよう区間を区切っているが、
  合計時間には計測ログの通知や DEBUG CONSOLE の更新による負荷も含まれる。
- API の既存のタイムアウト（`git_blame` は10秒）は変更していない。
  タイムアウト時は `show_total` が失敗として記録される。
  C# 側の計測通知は通常の API 応答と独立しているため、その後に届く値も確認できる。

## ファイルで確認する

`[BLAME timing]` を検索し、`requestId` で絞り込む。

- C# の計測値: 作業ディレクトリの `log/App.MasterDataEditor.log`
- C# と WebView 両方の計測値: `MASTER_DATA_EDITOR_CONSOLE_LOG_PATH` で指定したコンソールログ
  （未設定の場合は `NUL` なのでファイルには残らない）。

計測ログにはレスポンス本体を含めない。既存の全件取得、JSON の解析・ログ出力、
表示処理は維持しているため、最適化前の各処理の負荷を確認できる。
