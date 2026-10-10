# ターミナル

WPF アプリ内で Windows PowerShell を使用できます。画面は xterm.js、プロセスと入出力は C# の ConPTY が担当します。

## 使用方法

アプリは毎回制限モードで起動します。先に WPF ウィンドウ上部の **作業フォルダーを信頼…** からネイティブ確認で許可してください。信頼は現在の起動中だけ有効です。**信頼を解除** すると実行中のターミナルも終了します。[作業フォルダーの信頼](workspace-security.md) に対象と解除時の動作を記載しています。

- ステータスバーの `>_ TERMINAL`、下部パネルの `TERMINAL` タブ、または Ctrl＋バッククォートキー で開きます。最初に開いたときに PowerShell が起動します。
- 作業フォルダーは現在のプロジェクトのフォルダーです（`MASTER_DATA_EDITOR_WORKDIR`、未指定時は既存の `sample-workdir` 設定）。
- パネルを隠したり別のタブに切り替えたりしても、実行中のコマンドと出力履歴は維持されます。
- `終了` はシェルとその子プロセスを終了します。`exit` による自然終了にも対応し、終了後は `再起動` で新しいセッションを開けます。
- パネルのサイズ変更は端末の行数・列数へ反映されます。選択がない状態の `Ctrl+C` は実行中のコマンドを中断し、選択がある状態では選択文字列をコピーします。
- WebView のページ再読み込み・別ページへの遷移・アプリ終了ではセッションを終了します。画面を開き直した際に以前のプロセスを引き継ぎません。

Windows 10 バージョン 1809 以降が必要です。シェルには Windows 標準の `WindowsPowerShell\v1.0\powershell.exe -NoLogo` を使い、アプリと同じ権限で起動します。ブラウザーだけで起動した開発画面では、WPF バックエンドによる実シェルは使用できません。コマンドが変更するファイルやプロセスはエディターの Undo/Redo の対象外です。

## Windows での確認

リポジトリのルートから、.NET 10 SDK が入っている Windows のターミナルで実行してください。

```powershell
dotnet run --project .\WebView\e2e\fixtures\terminal\Terminal.Tests.csproj
```

追加の NuGet パッケージや WPF の起動を必要としない検証用プログラムです。まず OS 共通で、出力 ACK の順序・取消・送信失敗と、実際の `TerminalHost` の要求順序・不正起動・ページ遷移を検証します。Windows では続けて実 ConPTY を起動し、日本語を含む作業フォルダー、UTF-8 と絵文字、ANSI 色、入力順序、リサイズ、終了コード、大量出力中の終了、子プロセスの回収、再起動、ACK が返らない状態での停止を検証します。対応する Windows 以外では実 ConPTY の項目だけ `SKIP` と表示します。このスキップは実 ConPTY の動作確認に成功したという意味ではありません。

続いて WPF アプリを起動し、未信頼ではターミナルを開始できないことを確認します。ウィンドウ上部で作業フォルダーを信頼してから、次を確認してください。

1. `TERMINAL` を開き、`Get-Location` がプロジェクトの作業フォルダーを表示する。
2. `Write-Host '日本語の表示' -ForegroundColor Green` を実行し、日本語と色を確認する。
3. `while ($true) { Get-Date; Start-Sleep 1 }` を実行し、パネルを隠して再表示しても継続し、選択なしの `Ctrl+C` で停止する。
4. パネルの高さ・ウィンドウ幅を変え、カーソルと折り返しが追従する。
5. `exit 7` で終了コードが表示され、`再起動` で新しいシェルが開く。
6. 長時間実行中のコマンドを `終了` ボタンとアプリ終了の両方で停止し、子プロセスが残らないことを確認する。

Linux コンテナからは C# のコンパイルとフロントエンドのテストを実行できますが、Windows の ConPTY と WebView2 の接続は上記の Windows 確認が必要です。

## この変更の検証状況

- TypeScript の型検査（`--noEmit`）と通常の `npm run build` が成功し、ターミナルの Playwright テストは 18 件すべて成功しました。明暗テーマとリサイズ後の画面も確認し、黒帯が残らないことを確認しています。
- C# fixture は警告 0・エラー 0 でビルドでき、出力 ACK と TerminalHost のオフライン検証が成功しました。実 ConPTY の項目は Linux のため `SKIP` です。
- Playwright 全 1,523 件は 1,520 件成功、3 件失敗でした。失敗は `column-resize-auto-fit` の複数列ドラッグと Undo の 2 件、`diff-column-width-persist` の 1 件です。変更前の `953b691` を独立環境で検証しても、同じ 2 spec の 25 件中 22 件成功・同じ 3 件失敗となり、期待値・実測値とヘッダー DOM も一致しました。今回の変更前から存在する失敗です。

Windows 上の実 ConPTY と WPF の操作確認は未実施です。WPF アプリ全体のビルドは、検証用コンテナに `ModelContextProtocol.Core 1.1.0` がないため `NETSDK1064` で停止しています。Windows 側で必要な NuGet パッケージを用意してアプリをビルドし、上記の実機確認を行ってください。

## 実装

- `App.MasterDataEditor/Terminal/ConPtyNative.cs`: Windows API 宣言。
- `App.MasterDataEditor/Terminal/ConPtySession.cs`: PowerShell の起動、専用スレッドによる入出力、UTF-8 デコード、リサイズ、Job Object による子プロセスの回収。
- `App.MasterDataEditor/Terminal/TerminalHost.cs`: 単一セッションと WebView のドキュメント寿命、端末専用の要求キュー、応答と出力通知。
- `App.MasterDataEditor/Terminal/TerminalOutputFlow.cs`: xterm.js の出力処理完了 ACK を待機し、セッション終了やページ遷移で解除する。
- `WebView/src/panels/terminal-panel.ts`: xterm.js の表示、入力・出力、起動・終了・再起動、サイズとテーマの追従。

端末は既存の WebView2 メッセージ通信を使います。WebSocket サーバー、node-pty、追加の NuGet パッケージは不要です。`sessionId` により過去のセッションの通知を分離し、端末入力を一般 API のデバッグログへ記録しません。ホストは開発時の指定ポートの `http://localhost`、リリース時の `https://app.local` からの要求だけを受け付けます。

入力は 1 メッセージ 16,384 UTF-16 コード単位までで、フロントエンドがサロゲートペアを維持して分割します。未送信入力には 1 MiB の上限があり、超過時は通知でエラーを表示します。出力は UTF-8 のデコーダーを維持し、`terminal_output` の `outputId` を xterm.js の `write` コールバックから `terminal_output_ack` として返します。C# は ACK を受け取るまで次の pipe read を待つため、未処理の出力は 1 チャンクに制限されます。ACK は入力・終了要求のキューを通さず即座に処理します。

自然終了では最後の出力を処理してから終了を通知します。明示終了・ページ遷移・アプリ終了では ACK 待ちを先に解除し、ConPTY が残りの出力を flush する間は reader が読み捨てます。背景タブのタイマー抑制を考慮して ACK の固定タイムアウトは設けず、セッションとドキュメントの取消で寿命を管理します。
