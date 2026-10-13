# ターミナル

WPF アプリ内で Windows PowerShell を使用できます。画面は xterm.js、プロセスと入出力は C# の ConPTY が担当します。

## 使用方法

未信頼のフォルダーは制限モードで起動します。初めて利用する場合は WPF ウィンドウ上部の **作業フォルダーを信頼…** からネイティブ確認で許可してください。信頼後は上部の案内バーが消えます。このフォルダーの信頼は次回起動時も維持されます。**設定 → 作業フォルダーの信頼 → 信頼設定を開く** から解除を確認すると、実行中のターミナルも終了します。[作業フォルダーの信頼](workspace-security.md) に対象と解除時の動作を記載しています。

- ステータスバーの `>_ TERMINAL`、下部パネルの `TERMINAL` タブ、または Ctrl＋バッククォートキー で開きます。最初に開いたときに PowerShell が起動します。
- 作業フォルダーは現在のプロジェクトのフォルダーです（`MASTER_DATA_EDITOR_WORKDIR`、未指定時は既存の `sample-workdir` 設定）。
- パネルを隠したり別のタブに切り替えたりしても、実行中のコマンドと出力履歴は維持されます。
- `終了` はシェルとその子プロセスを終了します。`exit` による自然終了にも対応し、終了後は `再起動` で新しいセッションを開けます。
- パネルのサイズ変更は端末の行数・列数へ反映されます。選択がない状態の `Ctrl+C` は実行中のコマンドを中断し、選択がある状態では選択文字列をコピーします。
- WebView のページ再読み込み・別ページへの遷移・アプリ終了ではセッションを終了します。画面を開き直した際に以前のプロセスを引き継ぎません。

Windows 10 バージョン 1809 以降が必要です。シェルには Windows 標準の `WindowsPowerShell\v1.0\powershell.exe -NoLogo` を使い、アプリと同じ権限で起動します。ブラウザーだけで起動した開発画面では、WPF バックエンドによる実シェルは使用できません。コマンドが変更するファイルやプロセスはエディターの Undo/Redo の対象外です。

## AI 専用ターミナル

ステータスバーと下部タブの `TERMINAL` の左にある `AI` をクリックすると、Claude 用の端末領域を開きます。未信頼の作業フォルダーでは通常端末と同じく使用できません。

- 初回は導入状態を確認し、未導入なら `インストール` ボタンを表示します。クリックすると `https://github.com/yumayo/ai-container.git` を clone し、続けて Windows PowerShell で起動します。Git、WSL、Docker などの実行環境と接続は Windows 側に必要です。進捗とスクリプトの出力は AI 端末内に表示されます。
- 配置先は `AppEnvironment.GetUserDataDir()/ai-container` です。通常は `%APPDATA%/App.MasterDataEditor/projects/<作業フォルダー識別名>/ai-container`、`MASTER_DATA_EDITOR_USERDATA_DIR` 指定時はその配下の `projects/<作業フォルダー識別名>/ai-container` になります。ワークスペース別に保持し、この配置先の `.git` ディレクトリと `start-wsl-containers.ps1` を導入判定に使います。
- 既存 clone があれば clone を省略します。空フォルダーだけでは導入済みとせず、既存 clone のスクリプトが欠落している場合は出力とエラー通知で知らせます。既存フォルダーや clone の内容を削除・更新しません。clone は固有の一時ディレクトリへ行い、成功後に配置先へ移動するので、取得失敗後も再試行できます。
- 導入済みなら AI を開いた時点で起動します。実行する子プロセスは `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <clone内のstart-wsl-containers.ps1> -Workspace <AppEnvironment.GetWorkDir()> -Tool claude` です。スクリプトの実行ディレクトリは clone 内、Workspace はエディターが認識する作業フォルダーです。ブラウザーからパスやコマンドを指定することはできません。
- AI と通常の TERMINAL は独立したセッションで、各１つまで同時に実行できます。タブ切り替えやパネルの非表示でも出力と実行を維持します。`終了` と `再起動` は対象の端末だけに適用します。AIの正常終了（コード0）、既知の中断（コード130またはWindowsのSTATUS_CONTROL_C_EXIT=-1073741510）、`終了` の成功時は、表示中のAI領域を自動で閉じます。再び `AI` をクリックすると導入状態を確認し直して新しいセッションを開始します。他のタブを表示中の場合やパネルを非表示にしている場合は、その表示・フォーカス・保存した高さを変えません。
- `Ctrl+C` の入力だけでは領域を閉じません。Claudeが処理を中断して動作を続ける場合があるため、実際のプロセス終了を待ちます。コード1や7など上記以外の終了は失敗として汎用通知と出力・`再起動` ボタンを残し、起動やインストールの問題を確認できるようにします。実機でのCtrl+Cの終了コードは未観測のため、未知のコードを中断と推測して隠しません。通常のTERMINALは従来どおり自然終了後も履歴と終了コードを表示します。
- 保存された AI タブを画面起動時に復元しても、自動ではプロセスを実行しません。AI タブまたは `開始` の明示操作で起動します。信頼解除、ページ離脱、アプリ終了では両端末を回収します。端末を終了しても ai-container が Docker 側で作成したコンテナーや生成ファイルの削除は行いません。

## Windows での確認

リポジトリのルートから、.NET 10 SDK が入っている Windows のターミナルで実行してください。

```powershell
dotnet run --project .\WebView\e2e\fixtures\terminal\Terminal.Tests.csproj
```

追加の NuGet パッケージや WPF の起動を必要としない検証用プログラムです。まず OS 共通で、出力 ACK の順序・取消・送信失敗と、実際の `TerminalHost` の要求順序・不正起動・ページ遷移を検証します。Windows では続けて実 ConPTY を起動し、日本語を含む作業フォルダー、UTF-8 と絵文字、ANSI 色、入力順序、リサイズ、終了コード、大量出力中の終了、子プロセスの回収、再起動、ACK が返らない状態での停止を検証します。対応する Windows 以外では実 ConPTY の項目だけ `SKIP` と表示します。このスキップは実 ConPTY の動作確認に成功したという意味ではありません。

AI の fixture は OS 共通で導入状態と固定起動契約を、Windows では既存 clone の再利用、空白・日本語・単一引用符・末尾区切りを含む Workspace の受け渡し、子 PowerShell の終了コードを検証します。また通常端末と AI の同時起動、重複拒否、片方の終了、再起動、ページ破棄による全セッション回収を実 ConPTY で検証します。fixture はテスト用スクリプトを使い、外部 clone やコンテナーの起動を行いません。

続いて WPF アプリを起動し、未信頼ではターミナルを開始できないことを確認します。ウィンドウ上部で作業フォルダーを信頼してから、次を確認してください。

1. `TERMINAL` を開き、`Get-Location` がプロジェクトの作業フォルダーを表示する。
2. `Write-Host '日本語の表示' -ForegroundColor Green` を実行し、日本語と色を確認する。
3. `while ($true) { Get-Date; Start-Sleep 1 }` を実行し、パネルを隠して再表示しても継続し、選択なしの `Ctrl+C` で停止する。
4. パネルの高さ・ウィンドウ幅を変え、カーソルと折り返しが追従する。
5. `exit 7` で終了コードが表示され、`再起動` で新しいシェルが開く。
6. 長時間実行中のコマンドを `終了` ボタンとアプリ終了の両方で停止し、子プロセスが残らないことを確認する。
7. `AI` → `インストール` で clone と起動ログを確認し、Claude に入力できる。通常の `TERMINAL` を同時に開き、出力と入力が混ざらない。
8. AI を終了すると領域が閉じ、再度 `AI` から起動してもcloneが繰り返されず、スクリプトへ現在のワークスペースが渡る。Ctrl+CだけでClaudeが継続する場合は表示を維持し、実終了がコード0/130/-1073741510の場合に閉じる。異なる終了コードの場合は通知とログを確認する。パネル非表示時の継続、別タブ表示中のAI終了、信頼解除時の両端末終了も確認する。

Linux コンテナからは C# のコンパイルとフロントエンドのテストを実行できますが、Windows の ConPTY と WebView2 の接続は上記の Windows 確認が必要です。

## 通常ターミナル導入時の検証記録

- TypeScript の型検査（`--noEmit`）と通常の `npm run build` が成功し、ターミナルの Playwright テストは 18 件すべて成功しました。明暗テーマとリサイズ後の画面も確認し、黒帯が残らないことを確認しています。
- C# fixture は警告 0・エラー 0 でビルドでき、出力 ACK と TerminalHost のオフライン検証が成功しました。実 ConPTY の項目は Linux のため `SKIP` です。
- Playwright 全 1,523 件は 1,520 件成功、3 件失敗でした。失敗は `column-resize-auto-fit` の複数列ドラッグと Undo の 2 件、`diff-column-width-persist` の 1 件です。変更前の `953b691` を独立環境で検証しても、同じ 2 spec の 25 件中 22 件成功・同じ 3 件失敗となり、期待値・実測値とヘッダー DOM も一致しました。今回の変更前から存在する失敗です。

Windows 上の実 ConPTY と WPF の操作確認は未実施です。WPF アプリ全体のビルドは、検証用コンテナに `ModelContextProtocol.Core 1.1.0` がないため `NETSDK1064` で停止しています。Windows 側で必要な NuGet パッケージを用意してアプリをビルドし、上記の実機確認を行ってください。

## AI 専用ターミナル追加時の検証記録

- TypeScript の型検査（`--noEmit`）は成功しました。AI の Playwright 12 件はすべて成功し、導入・再試行・通常端末との分離・非同期確認後のフォーカス保持を確認しました。未導入画面は幅400pxのライトテーマ（サイドバーを閉じた状態）と幅800pxのダークテーマ、実行中の出力は幅1280pxのライトテーマでスクリーンショットとDOMも確認しています。
- 最終 Playwright 全 1,566 件は 1,563 件成功、3 件失敗でした。失敗は `column-resize-auto-fit.spec.ts:433` と `:628` の列幅（期待180、実測96）、`diff-column-width-persist.spec.ts:190` の列幅（期待136px、実測173px）です。変更前の `5cfc936` を隔離した worktree で同じ2 specの25件を再実行しても、22件成功・同じ3件失敗となり、期待値・実測値も一致しました。今回のAI変更による回帰ではありません。
- C# fixture のOS共通の検証は成功しました。AIの導入判定・起動契約・作業フォルダー・信頼保護などを確認しています。実PowerShellの引数受け渡しとConPTYの同時起動・終了を検証するWindows向けfixtureは、Linux環境のため `SKIP` です。実際のai-containerのclone・WSL/Docker接続も別途Windows実機で確認する必要があり、これらの実機動作は未検証です。
- WPFアプリ本体の `dotnet build --no-restore` は、検証用コンテナに `ModelContextProtocol.Core 1.1.0` がないため完了できませんでした。本体ビルドとWindows上の操作確認は、必要な依存関係を用意したWindows環境で上記手順を実施してください。

## AI 終了時に領域を閉じる修正の検証記録

- TypeScript の型検査（`--noEmit`）と関連53件のPlaywrightテストは成功しました。AI関連20件のうち、今回追加した終了処理の8件もすべて成功しています。終了後の非表示、再起動、通知順序、他タブ・高さ・フォーカスの保護を検証し、8件のスクリーンショットとDOMのレビューでも問題はありませんでした。
- 全1,574件を16 workerで実行した結果は1,570件成功・4件失敗でした。失敗は前回確認済みの列幅3件とbranch比較のhover 1件です。hoverは単独で3回再実行し、3回とも成功しました。
- 8 workerで全件を再実行した結果は1,567件成功・7件失敗でした。列幅3件と`branch-compare-export-filter`の4件が失敗し、hoverは成功しました。列幅は前回と同じ期待値・実測値で、`column-resize-auto-fit`の2件が期待180・実測96、`diff-column-width-persist`の1件が期待136px・実測173pxです。
- 変更前の`3bd210d`を隔離したworktreeでbranch比較の2 spec・125件を検証すると、123件成功・2件失敗でした。export-filterの「他方列名空欄」の開始・終了2件は、変更前でも同じ`:209`のstrict mode違反（対象が2要素）で再現しました。一方、「CSV他方列なし」の2件とhoverは、この変更前の比較実行では成功しました。export-filterの4件すべてが変更前から再現すると確認できたわけではなく、今回の全件成功条件は未達です。
- 今回C#の変更はありません。Windows実機でのCtrl+C終了コードは未観測です。モックでコード0・130・-1073741510を受け取った後の画面動作を検証しており、実際のPowerShell・ConPTY・WSL/Dockerの終了経路まで確認したものではありません。

## 実装

- `App.MasterDataEditor/Terminal/ConPtyNative.cs`: Windows API 宣言。
- `App.MasterDataEditor/Terminal/ConPtySession.cs`: PowerShell の起動、専用スレッドによる入出力、UTF-8 デコード、リサイズ、Job Object による子プロセスの回収。
- `App.MasterDataEditor/Terminal/TerminalHost.cs`: 通常 / AI の独立セッションと WebView のドキュメント寿命、端末専用の要求キュー、応答と出力通知。
- `App.MasterDataEditor/Terminal/AiTerminalLauncher.cs`: AI の配置・導入判定・安全な PowerShell 引数と clone の実行手順。
- `App.MasterDataEditor/Terminal/TerminalOutputFlow.cs`: xterm.js の出力処理完了 ACK を待機し、セッション終了やページ遷移で解除する。
- `WebView/src/panels/terminal-panel.ts`: xterm.js の表示、入力・出力、起動・終了・再起動、サイズとテーマの追従。

端末は既存の WebView2 メッセージ通信を使います。WebSocket サーバー、node-pty、追加の NuGet パッケージは不要です。`sessionId` により過去のセッションの通知を分離し、端末入力を一般 API のデバッグログへ記録しません。ホストは開発時の指定ポートの `http://localhost`、リリース時の `https://app.local` からの要求だけを受け付けます。

入力は 1 メッセージ 16,384 UTF-16 コード単位までで、フロントエンドがサロゲートペアを維持して分割します。未送信入力には 1 MiB の上限があり、超過時は通知でエラーを表示します。出力は UTF-8 のデコーダーを維持し、`terminal_output` の `outputId` を xterm.js の `write` コールバックから `terminal_output_ack` として返します。C# は ACK を受け取るまで次の pipe read を待つため、未処理の出力は 1 チャンクに制限されます。ACK は入力・終了要求のキューを通さず即座に処理します。

自然終了では最後の出力を処理してから終了を通知します。明示終了・ページ遷移・アプリ終了では ACK 待ちを先に解除し、ConPTY が残りの出力を flush する間は reader が読み捨てます。背景タブのタイマー抑制を考慮して ACK の固定タイムアウトは設けず、セッションとドキュメントの取消で寿命を管理します。
