using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace App.MasterDataEditor
{
	public static class WebView2HandlerGitStatusRequest
	{
		public static object Invoke(JsonElement root, string requestId)
		{
			try
			{
				var workDir = AppEnvironment.GetWorkDir();
				var gitRoot = GitCommandHelper.GetGitRoot(workDir);
				var output = GitCommandHelper.RunGitCommand(gitRoot, "--no-optional-locks", "status", "--porcelain");
				var changes = new List<object>();
				var staged = new List<object>();

				// data/ディレクトリ内の.csvファイルのみをフィルタリングする
				var dataPrefix = GitCommandHelper.GetDataPrefix(gitRoot, workDir);

				foreach (var line in output.Split('\n', StringSplitOptions.RemoveEmptyEntries))
				{
					if (line.Length < 4) continue;
					var indexStatus = line[0];
					var workTreeStatus = line[1];
					var filePath = line.Substring(3).Trim();

					// data/ディレクトリ内の.csvファイルのみを対象とする
					if (!filePath.StartsWith(dataPrefix) || !filePath.EndsWith(".csv")) continue;

					// テーブル名を抽出: {dataPrefix}xxx.csv → xxx
					var fileName = Path.GetFileNameWithoutExtension(filePath);

					// 新規ファイル（??）: 未追跡ファイルは isNew=true で changes に追加する
					// isNew=true のときクライアント側は git show を呼ばずヘッダー行のみのCSVを使う
					if (indexStatus == '?' && workTreeStatus == '?')
					{
						changes.Add(new { path = filePath, tableName = fileName, isNew = true });
						continue;
					}

					// ステージ済み変更（インデックスに変更があり、未追跡でない場合）
					if (indexStatus != ' ')
					{
						staged.Add(new { path = filePath, tableName = fileName, isNew = false });
					}

					// 未ステージ変更（ワーキングツリーに変更がある場合）
					if (workTreeStatus != ' ')
					{
						changes.Add(new { path = filePath, tableName = fileName, isNew = false });
					}
				}

				return new
				{
					type = "git_status_response",
					requestId,
					success = true,
					data = new { changes, staged }
				};
			}
			catch (Exception ex)
			{
				Logger.Error(ex, "git status 実行時にエラーが発生しました。");
				return new
				{
					type = "git_status_response",
					requestId,
					success = false,
					error = ex.Message,
				};
			}
		}
	}
}
