using System;
using System.IO;
using System.Text.Json;

namespace App.MasterDataEditor
{
	public static class WebView2HandlerGitShowRequest
	{
		public static object Invoke(JsonElement root, string requestId)
		{
			try
			{
				if (!root.TryGetProperty("path", out var pathElement))
				{
					return new
					{
						type = "git_show_response",
						requestId,
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
						requestId,
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
						requestId,
						success = false,
						error = "invalid path",
					};
				}

				// data/ディレクトリ内の.csvファイルのみを許可する
				var gitRoot = GitCommandHelper.GetGitRoot(AppEnvironment.GetWorkDir());
				var dataPrefix = GitCommandHelper.GetDataPrefix();

				// data/ディレクトリ内の.csvファイルのみを許可する
				if (!path.StartsWith(dataPrefix) || !path.EndsWith(".csv"))
				{
					return new
					{
						type = "git_show_response",
						requestId,
						success = false,
						error = "path must be " + dataPrefix + "*.csv",
					};
				}

				var output = GitCommandHelper.RunGitCommand(gitRoot, "show", $"HEAD:{path}");

				return new
				{
					type = "git_show_response",
					requestId,
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
					requestId,
					success = false,
					error = ex.Message,
				};
			}
		}
	}
}
