# ISSUE_0148: userdata移行と親ディレクトリ自動作成

## 種別
機能追加

## 症状
bookmarks.jsonやer-diagram-layout.json等のユーザー設定ファイルがdata/ディレクトリに混在しており、CSVマスターデータとの区別がつきにくい。また、WriteFileRequestがサブディレクトリ付きパスを指定した場合に親ディレクトリを自動作成しないため、userdata/ディレクトリが存在しない初回起動時にファイル書き込みが失敗する。

## 要件
- WriteFileRequestで書き込み先の親ディレクトリが存在しない場合に自動作成する
- 既存のユーザー設定ファイル（bookmarks.json、er-diagram-layout.json）の保存先をdata/からuserdata/に移動する
- フロントエンド側の読み書きパスもuserdata/に変更する
- 今後の新規ユーザー設定ファイル（ISSUE_0149、ISSUE_0150等）はすべてuserdata/に保存する

## 対策案
1. WebView2HandlerWriteFileRequest.csのFile.WriteAllText前にDirectory.CreateDirectory(親ディレクトリ)を追加する
2. ReadFileRequestも同様に親ディレクトリ不在でエラーにならないよう確認する
3. フロントエンド側でbookmarks.json、er-diagram-layout.jsonのパスをuserdata/配下に変更する
4. 既存のdata/配下にある設定ファイルからの移行は行わない（初回はファイルなしとして扱い、次回保存時にuserdata/に作成される）

## 前提タスク
ISSUE_0149、ISSUE_0150の前提タスクとなる。
