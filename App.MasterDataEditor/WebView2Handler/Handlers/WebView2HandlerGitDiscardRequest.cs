using System;
using System.Text.Json;

namespace App.MasterDataEditor
{
	public static class WebView2HandlerGitDiscardRequest
	{
		public static object Invoke(JsonElement root, string requestId)
		{
			try
			{
				if (!root.TryGetProperty("path", out var pathElement))
				{
					return new { type = "git_discard_response", requestId, success = false, error = "path is required" };
				}

				var path = pathElement.GetString();
				var workDir = AppEnvironment.GetWorkDir();
				var gitRoot = GitCommandHelper.GetGitRoot(workDir);
				var dataPrefix = GitCommandHelper.GetDataPrefix(gitRoot, workDir);
				var validationError = GitCommandHelper.ValidateDataPath(path, dataPrefix);
				if (validationError != null)
				{
					return new { type = "git_discard_response", requestId, success = false, error = validationError };
				}

				// checkout は最終ファイルを置換するため、親だけを固定する。
				// 復元元の index がリンクなら復元自体を拒否し、リンクを新しく持ち込まない。
				var indexEntries = GitCommandHelper.RunGitLiteralPathCommand(gitRoot, "ls-files", "--stage", "-z", "--", path!).Split('\0', StringSplitOptions.RemoveEmptyEntries);
				if (indexEntries.Length != 1 || (!indexEntries[0].StartsWith("100644 ", StringComparison.Ordinal) && !indexEntries[0].StartsWith("100755 ", StringComparison.Ordinal)))
				{
					return new { type = "git_discard_response", requestId, success = false, error = "Only a regular staged file can be restored" };
				}
				using var access = WorkspaceFileAccess.LockParent(gitRoot, path!, true);
				access.ValidateGitFile(false);
				GitCommandHelper.RunGitLiteralPathCommand(gitRoot, "checkout", "--", path!);

				return new
				{
					type = "git_discard_response",
					requestId,
					success = true,
				};
			}
			catch (Exception ex)
			{
				Logger.Error(ex, "git discard 実行時にエラーが発生しました。");
				return new
				{
					type = "git_discard_response",
					requestId,
					success = false,
					error = ex.Message,
				};
			}
		}
	}
}
