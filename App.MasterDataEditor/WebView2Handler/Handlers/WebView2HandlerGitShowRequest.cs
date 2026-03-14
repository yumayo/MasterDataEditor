using System;
using System.IO;
using System.Text.Json;

namespace App.MasterDataEditor
{
	public static class WebView2HandlerGitShowRequest
	{
		public static object Invoke(JsonElement root)
		{
			try
			{
				if (!root.TryGetProperty("path", out var pathElement))
				{
					return new
					{
						type = "git_show_response",
						success = false,
						error = "path is required",
					};
				}

				var path = pathElement.GetString();
				if (string.IsNullOrEmpty(path))
				{
					return new
					{
						type = "git_show_response",
						success = false,
						error = "path is empty",
					};
				}

				// パストラバーサル防止: ".." を含むパスや絶対パスは拒否する
				if (path.Contains("..") || Path.IsPathRooted(path))
				{
					return new
					{
						type = "git_show_response",
						success = false,
						error = "invalid path",
					};
				}

				// gitルート相対のdata/ディレクトリのプレフィックスを取得する
				// フロントエンドからはgitルート相対パス（entry.path）が渡されるため、バリデーションもそれに合わせる
				var workDir = AppEnvironment.GetWorkDir();
				var dataPrefix = GitCommandHelper.GetDataPrefix(workDir);

				// gitルート相対のdata/ディレクトリ内の.csvファイルのみを許可する
				if (!path.StartsWith(dataPrefix) || !path.EndsWith(".csv"))
				{
					return new
					{
						type = "git_show_response",
						success = false,
						error = "path must be " + dataPrefix + "*.csv",
					};
				}

				// git show にはgitルート相対パスをそのまま渡す（entry.pathはgitルート相対なので正しい）
				var output = GitCommandHelper.RunGitCommand(workDir, $"show HEAD:{path}");

				return new
				{
					type = "git_show_response",
					success = true,
					data = output
				};
			}
			catch (Exception ex)
			{
				Logger.Error(ex, "git show 実行時にエラーが発生しました。");
				return new
				{
					type = "git_show_response",
					success = false,
					error = ex.Message,
				};
			}
		}
	}
}
