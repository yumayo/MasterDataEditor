# ファイル境界と Git の選択パス

作業フォルダーとユーザーデータの読取り・書込み・削除・一覧 API は、リンクを経由するアクセスを拒否します。作業フォルダー自身、その祖先、途中のディレクトリ、最終ファイルが対象です。リンク先が同じ作業フォルダー内でも許可しません。Windows のジャンクションなど、すべての reparse point が対象です。複数のハードリンクを持つファイルも読取り・書込み・削除を拒否します。

`HelperFile.ResolveSafePath` の検査済み文字列だけで実 I/O を実行してはいけません。`WorkspaceFileAccess` はドライブルートから親ディレクトリまで `FILE_FLAG_OPEN_REPARSE_POINT` で開き、書込み・削除の共有を許可しない handle を操作終了まで保持します。これにより検査後の親ディレクトリの名前変更やリンクへの差し替えを拒否します。最終ファイルも no-follow で開いて属性とリンク数を検査し、その同じ handle で読み書き・削除します。書込みの切り詰めは検査後です。列挙は固定されたディレクトリの取得済み属性を使い、リンクのエントリーを除外します。

末尾の空白・ピリオド、DOS デバイス名、代替データストリーム、UNC/device namespace も拒否します。リンク配下や UNC 上に作業フォルダーがある場合は、ローカルドライブ上の実体のパスを開いてください。

Git Add / Reset / Discard は `--literal-pathspecs` と独立した引数の `--` を使用し、`table[12].csv` や `work[12]` をパターンとして扱いません。作業ツリーを読む Add / Discard は対象ファイルの親を固定します。Add は既存ファイルも固定し、親ごと削除済みなら index の一件だけを削除します。Reset は index のみを更新します。Discard は Git による最終ファイルの置換を許可します。Discard の復元元がシンボリックリンクや競合状態の場合は拒否します。履歴検索の明示的な `:(literal)` などには変更を加えません。

## 検証

オフラインで実行できる、実ソースをリンクした fixture を用意しています。

```powershell
dotnet run --project .\WebView\e2e\fixtures\security-files\SecurityFiles.Tests.csproj
```

Windows のリンク作成テストには開発者モードまたはシンボリックリンクを作成できる権限が必要です。fixture は一時ディレクトリ内だけを操作します。

- 全 OS: 各階層のリンク拒否と字句検査、実 Git による Add / Reset / Discard の選択外ファイル保護。
- Windows: 実ハンドラーで正常な新規保存・読取り・一覧・削除、親ディレクトリ保持中の名前変更拒否と正常 I/O、最終ファイルのリンク差し替え競合、ハードリンク拒否。
- Linux: Windows native I/O と handle 競合は明示的に SKIP。Git は本番の literal helper と実 Git を検証し、Windows ではハンドラーと親 handle の保持も検証します。

実アプリの WPF は Windows 専用です。安全なファイル I/O を非 Windows で呼ぶと `PlatformNotSupportedException` で拒否します。Linux の結果を Windows native I/O の成功として扱わないでください。
