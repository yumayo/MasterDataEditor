using System;
using System.Text.Json;

namespace App.MasterDataEditor
{
	public static class WebView2HandlerGitResetRequest
	{
		public static object Invoke(JsonElement root, string requestId)
		{
			try
			{
				if (!root.TryGetProperty("path", out var pathElement))
				{
					return new { type = "git_reset_response", requestId, success = false, error = "path is required" };
				}

				var path = pathElement.GetString();
				var workDir = AppEnvironment.GetWorkDir();
				var gitRoot = GitCommandHelper.GetGitRoot(workDir);
				var dataPrefix = GitCommandHelper.GetDataPrefix(gitRoot, workDir);
				var validationError = GitCommandHelper.ValidateDataPath(path, dataPrefix);
				if (validationError != null)
				{
					return new { type = "git_reset_response", requestId, success = false, error = validationError };
				}

				GitCommandHelper.RunGitCommand(gitRoot, "reset", "HEAD", path);

				return new
				{
					type = "git_reset_response",
					requestId,
					success = true,
				};
			}
			catch (Exception ex)
			{
				Logger.Error(ex, "git reset 実行時にエラーが発生しました。");
				return new
				{
					type = "git_reset_response",
					requestId,
					success = false,
					error = ex.Message,
				};
			}
		}
	}
}
