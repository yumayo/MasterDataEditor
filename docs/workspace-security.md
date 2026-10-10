# 作業フォルダーの信頼とプラグインの隔離

初めて開いたフォルダーと、信頼を解除したフォルダーは **制限モード** で起動します。一度信頼したフォルダーは、同じWindowsユーザーで次回起動したときも信頼を維持します。制限モードでも通常のデータ閲覧・編集・保存は使用できます。View / 検証プラグイン、保存後フック、ターミナル、Git 操作は無効です。Git 設定も外部プログラムを起動できるため信頼の対象に含みます。

必要な場合は WPF ウィンドウ上部の **作業フォルダーを信頼…** を押し、ネイティブの確認画面に表示されたフォルダーと実行権限を確認してください。既定の回答は「いいえ」です。「はい」を選ぶと信頼を保存して案内バー全体が消え、次回起動時も案内バーは表示されません。案内バーとボタンはエディターの明暗テーマに追従します。

信頼状態の確認・変更は **設定 → 作業フォルダーの信頼 → 信頼設定を開く** から行えます。信頼済みなら解除の確認、制限モードなら許可の確認を表示します。どちらも既定の回答は「いいえ」で、解除すると案内バーが再表示されます。この項目は User / Workspace の保存設定とは独立しています。JavaScript は確認画面を開くことだけを要求でき、信頼の許可・解除を直接指定する API はありません。プラグイン / MCP にも信頼を付与する API はありません。

**信頼を解除** すると View を閉じ、実行中の検証 Worker / 保存フック / ターミナルを停止します。実行待ちのフック・ターミナル開始は信頼の世代が変わるため再信頼しても実行されません。View 固有の未保存状態は破棄されるため、必要な内容は先に保存してください。テーブルに反映済みの編集と Undo 履歴は残ります。信頼前・解除後に受け付ける通常の編集保存はフックを実行しません。すでに実行中の Git コマンドやデータ編集の効果を巻き戻す機能ではありません。開始済み要求に含まれる後続の Git 処理は完了する場合があります。

信頼は正規化した絶対パスごとに、Windowsユーザー専用の `HKCU\Software\App.MasterDataEditor\TrustedWorkspaces` へ保存します。別フォルダーや子フォルダーへは引き継ぎません。保存先はプロジェクトファイルや User / Workspace 設定、ファイルAPIから変更できません。読込失敗や不正な保存値は制限モードに戻して通知し、許可の保存に失敗した場合は信頼を付与しません。解除は現在の信頼を先に失効し、保存情報を削除できなかった場合は次回起動時に信頼が復元される可能性を通知します。すでに起動している別のアプリへの変更同期は行いません。旧バージョンの信頼は保存されていないため、更新後に一度信頼する必要があります。

`--validate` によるヘッドレス実行は保存済みの信頼を復元せず、制限モードです。標準の検証だけを実行し、フォルダー内の検証プラグインを省略したことを標準エラーに出力します。

## View プラグイン

信頼済みのプラグインも `sandbox="allow-scripts"` の専用 iframe で動作します。`allow-same-origin` は付与しません。親画面の DOM、ストレージ、ネイティブ API を直接使用できません。通信・子 iframe・フォーム・外部スクリプトの読み込みは CSP で禁止します。WPF はトップ文書の正規 origin の要求だけを処理し、iframe の WebMessageReceived は購読しません。

`render(container, api)`、`document.createElement`、公開 API の `tables` と非同期の `data` / `edit`、イベント、通知、編集セッション、保存は使用できます。ホストとの通信は送信元の iframe と接続 ID を確認し、列挙した API だけを実行します。任意のファイル・Git・ターミナル・ホスト内部 API は公開しません。プラグインは公開 API を通じてプロジェクトのデータを変更・保存できるため、信頼確認は必要です。

互換性の変更点:

- プラグインコードは登録の検出時と各 View の生成時にそれぞれ隔離実行されます。トップレベルは登録だけにし、データ操作は `render` 内で行ってください。
- プラグイン内の `document` と `container` は iframe 内の DOM です。親画面の CSS / DOM を直接参照するコードは移行が必要です。アプリのテーマ変数はコピーされます。
- 同期 `data` / `schema` の読み取りは直近のスナップショットを返します。最新のテーブルデータは `readTableDataAsync` / `tables.get(...).readRecordsAsync` を使用してください。
- 同期の `setCellValue` / `setCellValues` / `insertRow` / `deleteRow` は明示的にエラーになります。セル編集は `setCellValueAsync` / `setCellValuesAsync` または編集セッションへ移行してください。行の挿入・削除は現在の隔離 API では提供しません。
- v1 でもホスト内部の `emitTableOpened` 等は公開しません。
- 通常の View 終了では `pagehide` で dispose を呼び出し、ホスト側の購読も解除します。信頼解除時は安全のため iframe を即時破棄するため、終了時の外部処理を保証しません。

同梱 `shop-products.js` は非同期の公開 API を使用しており、同期編集 API の移行は不要です。

## 検証

```sh
dp npx tsc --noEmit
dp npx playwright test workspace-security.spec.ts view-plugin.spec.ts plugin-validation.spec.ts terminal.spec.ts toolbar-tab-availability.spec.ts --workers=1
dp npx playwright test native-theme.spec.ts settings-workspace-trust.spec.ts --workers=1
dp dotnet run --project WebView/e2e/fixtures/workspace-trust-persistence/WorkspaceTrust.Tests.csproj
dp dotnet run --project WebView/e2e/fixtures/workspace-trust-persistence/WorkspaceTrust.Registry.Tests.csproj
dp dotnet run --project WebView/e2e/fixtures/native-theme/NativeTheme.Tests.csproj
dp dotnet run --project WebView/e2e/fixtures/workspace-security/WorkspaceSecurity.Tests.csproj
dp dotnet run --project WebView/e2e/fixtures/terminal/Terminal.Tests.csproj
```

Windows では、未信頼フォルダーを開いて通常保存してもフックが動かないこと、ネイティブ確認の「いいえ」/「はい」、設定からの信頼解除で起動中シェルが終了すること、信頼を許可して再起動すると信頼済みになること、解除して再起動すると制限モードになることを確認してください。Registry fixtureはWindowsで実行し、専用の一時パスの値だけを使って別プロセスでの復元、解除の永続化、不正値の拒否を検証します。Linuxでは本体ソースのコンパイルのみ確認し、実Registry I/OはSKIPします。信頼後の案内バー非表示と解除後の再表示、明暗テーマでのボタンの通常・hover・押下・Tabフォーカスも確認対象です。確認画面を10秒以上開いてもAPIタイムアウト通知が出ず、連続要求で確認画面が重ならないことを確認してください。Linux のブラウザーテストと色の入力検証では、Windows の実 WPF 描画とネイティブ確認操作は検証できません。MCP の認証と作業フォルダーの信頼は別の境界です。MCP の認証が成功しても信頼は付与されません。


Windows の実 WebView2 では、信頼済み View に次のプローブを一時的に追加し、開始済みのターミナルがなく、native のファイル応答も届かないことを確認します。`read_file_request` は既存の無害なファイル、`write_file_request` は検証専用の一時ファイルを指定してください。検証後はプローブを取り除きます。

```js
const bridge = window.chrome && window.chrome.webview;
if (bridge) {
    bridge.postMessage({type: 'terminal_start_request', requestId: 'frame-probe', sessionId: 'frame-probe', cols: 80, rows: 24});
    bridge.postMessage({type: 'read_file_request', requestId: 'frame-read-probe', filename: 'data/test.csv'});
    bridge.postMessage({type: 'write_file_request', requestId: 'frame-write-probe', filename: 'frame-security-probe.txt', data: 'unexpected'});
}
```

実 WebView2 は iframe にも `chrome.webview` オブジェクトを注入する場合があります。オブジェクト自体の不存在を安全性の根拠にはしていません。ホストが **トップ文書のイベントだけを購読** し、iframe の `CoreWebView2Frame.WebMessageReceived` を購読しないこと、正規 origin の確認、公開データ RPC の送信元と許可メソッドの照合が拒否の根拠です。Playwright の `nativeAccess === false` は iframe にネイティブブリッジを注入しないブラウザーモックでの結果です。Windows の実 WebView2 におけるこの境界の動的確認は別途必要です。
