using System;
using System.IO;
using System.Text.Json;

namespace App.MasterDataEditor
{
	public static class WebView2HandlerGitAddRequest
	{
		public static object Invoke(JsonElement root, string requestId)
		{
			try
			{
				if (!root.TryGetProperty("path", out var pathElement))
				{
					return new { type = "git_add_response", requestId, success = false, error = "path is required" };
				}

				var path = pathElement.GetString();
				var workDir = AppEnvironment.GetWorkDir();
				var gitRoot = GitCommandHelper.GetGitRoot(workDir);
				var dataPrefix = GitCommandHelper.GetDataPrefix(gitRoot, workDir);
				var validationError = GitCommandHelper.ValidateDataPath(path, dataPrefix);
				if (validationError != null)
				{
					return new { type = "git_add_response", requestId, success = false, error = validationError };
				}

				try
				{
					using var access = WorkspaceFileAccess.LockParent(gitRoot, path!, false);
					access.ValidateGitFile(true);
					GitCommandHelper.RunGitLiteralPathCommand(gitRoot, "add", "--", path!);
				}
				catch (IOException ex) when (ex is FileNotFoundException || ex is DirectoryNotFoundException)
				{
					// 親ごと削除されたファイルは worktree を走査せず index の一件だけを削除する。
					// 検査後に欠落した親がリンクとして現れても、外部ファイルを読み込まない。
					GitCommandHelper.RunGitLiteralPathCommand(gitRoot, "ls-files", "--error-unmatch", "--", path!);
					GitCommandHelper.RunGitLiteralPathCommand(gitRoot, "update-index", "--force-remove", "--", path!);
				}

				return new
				{
					type = "git_add_response",
					requestId,
					success = true,
				};
			}
			catch (Exception ex)
			{
				Logger.Error(ex, "git add 実行時にエラーが発生しました。");
				return new
				{
					type = "git_add_response",
					requestId,
					success = false,
					error = ex.Message,
				};
			}
		}
	}
}
