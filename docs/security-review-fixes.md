# セキュリティレビュー修正の確認先

第三者の作業フォルダーを開いたときのコード実行、MCP 接続者、ファイルの実体、Git の操作対象を、それぞれ独立した境界として修正しました。

| 指摘 | 修正 | 詳細・確認手順 |
| --- | --- | --- |
| 信頼確認前のプラグイン・フック実行 | ネイティブ UI による信頼確認までコード実行を無効化。信頼後も View は sandbox iframe と公開 RPC に隔離 | [作業フォルダーの信頼](workspace-security.md) |
| MCP の匿名 TCP 接続 | 同一ユーザー専用の名前付きパイプ、固定 Host と Origin の検査 | [MCP の接続と検証](mcp-security.md) |
| リンク経由の作業フォルダー外への I/O | 親階層の handle 保持と、検査した同じ最終 handle による操作 | [ファイル境界](files-security.md) |
| Git の選択外ファイルへの操作 | Add / Reset / Discard に literal pathspec を適用 | [Git の選択パス](files-security.md) |

## 互換性の変更

- 信頼は保存せず、毎起動で制限モードになります。通常のデータ閲覧・編集・保存は使用できます。コードを実行する機能は WPF 上部の確認で有効にします。
- MCP の HTTP URL への直接接続は廃止しました。`App.MasterDataEditor.exe --mcp` による既存の stdio 接続を使用してください。
- View プラグインは親 DOM や内部 API を直接使用できません。同期の編集 API は非対応となり、セル編集は公開された非同期 API へ移行してください。行挿入・削除の隔離 API は現在未提供です。
- ファイル API はリンク・ジャンクション・複数ハードリンク・UNC/device namespace を拒否します。ローカルドライブ上の実体のパスを使用してください。

## 検証の範囲

Linux のオフライン環境では、修正前の RED を再現し、修正後の C# 信頼・フック制御、同梱 MCP SDK を通す Host / Origin 検査、ファイルパスとリンク拒否、実 Git の選択外ファイル保護を別担当が確認しています。Linux の Git 検査は本番の literal helper を使い、Windows の fixture は実ハンドラーと親 handle の保持も検査します。ブラウザー側にはプラグイン隔離と通常操作の Playwright 回帰試験があります。

最終確認では TypeScript 型検査とフロントエンドのビルドが成功し、新規の作業フォルダーセキュリティ試験も 7 件すべて成功しました。Playwright 全体は 1,530 件中 1,527 件成功、3 件失敗です。失敗は既知の `column-resize-auto-fit` の 2 件と `diff-column-width-persist` の 1 件で、変更前の `953b691` でも再現しています。列幅の期待値 / 実測値（180 / 96、180 / 96、136 / 173）とヘッダー DOM が一致することを確認し、今回の修正による失敗ではないと判断しています。

C# の MCP、ファイル / Git 境界、信頼制御、ターミナル通信制御の各 fixture はすべて成功し、既存 Git fixture 3 件も成功しました。Windows 専用部分は SKIP であり、実行成功には含めていません。

この環境では Windows 上の WPF 操作、ConPTY 実プロセス、名前付きパイプのユーザー ACL、ファイル共有 handle とリンク差し替え競合は未確認です。Windows 専用 fixture は Linux で明示的に SKIP します。WPF 全体のビルドも検証環境の依存パッケージ不足で完了していません。上記の各文書に Windows での確認コマンドと手順を記載しています。
