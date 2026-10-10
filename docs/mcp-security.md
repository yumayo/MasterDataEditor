# MCP のローカル接続と検証

MCP は Windows の同一ユーザー専用の名前付きパイプで通信します。`localhost:3001` の TCP 待受は廃止しました。既存の `App.MasterDataEditor.exe --mcp` による stdio 接続設定はそのまま使用できます。HTTP URL に直接接続していたクライアントは、この stdio コマンドへ変更してください。トークン、秘密ファイル、追加の確認操作は不要です。

サーバーとプロキシの両方が `CurrentUserOnly` を指定し、別 OS ユーザーによる接続と偽サーバーへの接続を Windows に拒否させます。Windows ではユーザーに加えて昇格状態も確認されるため、GUI とクライアントは同じユーザー、同じ昇格状態で起動してください。同じユーザーとして動くプロセスは MCP に接続できます。

ユーザーの SID に基づくパイプ名と、セッションをまたぐ `Global` 名前空間の Mutex により、同一ユーザーで MCP サーバーは一つだけ起動します。二つ目のエディターは MCP の起動に失敗し、最初のエディターが接続先として継続します。パイプの所有者とセッションはプロセス終了時に破棄され、秘密の永続化や認証の失効処理はありません。

HTTP の `Host` は固定値 `localhost` だけを許可します。ポート付き Host やそれ以外の Host は 400、`Origin` は空値や `null` を含め存在するだけで 403 を返し、MCP セッションを発行しません。stdio 以外のブラウザーからのアクセスは提供していません。環境変数や appsettings による TCP listener の追加も無効化しています。

## オフライン検証

既存 WPF ビルドに同梱された MCP SDK DLL を参照し、新しいパッケージをダウンロードせずに検査します。先に WPF の Debug ビルド成果物を用意してください。別の場所にある場合は `-p:McpAssemblyDirectory=...` を指定できます。

```powershell
dotnet run --project .\WebView\e2e\fixtures\mcp-security\McpSecurity.Tests.csproj
```

Linux の検証では in-memory HTTP サーバーで本番の Host/Origin ポリシーと同梱 MCP SDK を通し、不正要求で initialize とツール呼び出しが拒否されること、正規要求で両方が成功することを確認します。実 TCP は使いません。Windows のパイプ ACL 統合検証は Linux では SKIP になります。

Windows で同じコマンドを実行すると、本番 `McpHttpServer` と `McpPipeTransport` による initialize、悪意ある Host/Origin の拒否、同一ユーザーの二重起動拒否、終了後の再起動も検査します。このとき GUI は閉じておいてください。

## 別 OS ユーザーの拒否確認

1. ユーザー A で GUI を起動し、MCP サーバーが起動したことをログで確認します。
2. ユーザー A で次のコマンドを実行し、パイプ名を取得します。パイプ名は識別子であり秘密ではありません。

   ```powershell
   dotnet run --project .\WebView\e2e\fixtures\mcp-security\McpSecurity.Tests.csproj -- --print-pipe-name
   ```

3. 同じユーザー A で `--probe-pipe <取得した名前>` を渡し、`CONNECTED` が表示されることを確認します。このモードの終了コード 1 は接続したことを示します。
4. GUI を起動したまま、別 OS ユーザー B のコンソールで同じ `--probe-pipe <A の名前>` を実行します。この攻撃プローブはクライアント側の `CurrentUserOnly` を意図的に使わず、サーバー DACL による拒否だけを検査します。`PASS: Windows denied access...` と終了コード 0 が期待値です。`INCONCLUSIVE` / 終了コード 2 は未検証扱いにし、GUI と同一ユーザー接続を確認してください。
5. `netstat -ano` などでアプリが TCP 3001 を待ち受けていないことも確認します。

アプリの別ユーザー拒否とホスト側 Windows ACL は、Linux の in-memory テストだけでは検証できません。
