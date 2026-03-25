using System;
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
					return new { type = "git_show_response", requestId, success = false, error = "path is required" };
				}

				var path = pathElement.GetString();
				// data/ディレクトリ内の.csvファイルのみを許可する
				var workDir = AppEnvironment.GetWorkDir();
				var gitRoot = GitCommandHelper.GetGitRoot(workDir);
				var dataPrefix = GitCommandHelper.GetDataPrefix(gitRoot, workDir);
				var validationError = GitCommandHelper.ValidateDataPath(path, dataPrefix);
				if (validationError != null)
				{
					return new { type = "git_show_response", requestId, success = false, error = validationError };
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
