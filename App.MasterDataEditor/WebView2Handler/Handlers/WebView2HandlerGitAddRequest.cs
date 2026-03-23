using System;
using System.IO;
using System.Text.Json;

namespace App.MasterDataEditor
{
	public static class WebView2HandlerGitAddRequest
	{
		public static object Invoke(JsonElement root)
		{
			try
			{
				if (!root.TryGetProperty("path", out var pathElement))
				{
					return new
					{
						type = "git_add_response",
						success = false,
						error = "path is required",
					};
				}

				var path = pathElement.GetString();
				if (string.IsNullOrEmpty(path))
				{
					return new
					{
						type = "git_add_response",
						success = false,
						error = "path is empty",
					};
				}

				// パストラバーサル防止: ".." を含むパスや絶対パスは拒否する
				if (path.Contains("..") || Path.IsPathRooted(path))
				{
					return new
					{
						type = "git_add_response",
						success = false,
						error = "invalid path",
					};
				}

				var gitRoot = GitCommandHelper.GetGitRoot(AppEnvironment.GetWorkDir());
				var dataPrefix = GitCommandHelper.GetDataPrefix();

				// data/ディレクトリ内の.csvファイルのみを許可する
				if (!path.StartsWith(dataPrefix) || !path.EndsWith(".csv"))
				{
					return new
					{
						type = "git_add_response",
						success = false,
						error = "path must be " + dataPrefix + "*.csv",
					};
				}

				GitCommandHelper.RunGitCommand(gitRoot, "add", path);

				return new
				{
					type = "git_add_response",
					success = true,
				};
			}
			catch (Exception ex)
			{
				Logger.Error(ex, "git add 実行時にエラーが発生しました。");
				return new
				{
					type = "git_add_response",
					success = false,
					error = ex.Message,
				};
			}
		}
	}
}
