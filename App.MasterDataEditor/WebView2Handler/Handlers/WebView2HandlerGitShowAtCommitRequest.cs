using System;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace App.MasterDataEditor
{
	/// <summary>
	/// git show {commit}:{path} で任意コミット時点のファイル内容を返す。
	/// バージョン比較機能で使用する。
	/// </summary>
	public static class WebView2HandlerGitShowAtCommitRequest
	{
		/// <summary>
		/// コミットハッシュの書式を検証する正規表現。
		/// 短縮ハッシュ（7文字以上）またはフルハッシュ（40文字）を許可する。
		/// </summary>
		private static readonly Regex CommitHashPattern = new Regex(@"^[0-9a-fA-F]{7,40}$", RegexOptions.Compiled);

		public static object Invoke(JsonElement root, string requestId)
		{
			try
			{
				if (!root.TryGetProperty("commit", out var commitElement))
				{
					return new { type = "git_show_at_commit_response", requestId, success = false, error = "commit is required" };
				}

				if (!root.TryGetProperty("path", out var pathElement))
				{
					return new { type = "git_show_at_commit_response", requestId, success = false, error = "path is required" };
				}

				var commit = commitElement.GetString();
				var path = pathElement.GetString();

				// コミットハッシュのバリデーション（インジェクション防止）
				if (string.IsNullOrEmpty(commit) || !CommitHashPattern.IsMatch(commit))
				{
					return new { type = "git_show_at_commit_response", requestId, success = false, error = "invalid commit hash format" };
				}

				var workDir = AppEnvironment.GetWorkDir();
				var gitRoot = GitCommandHelper.GetGitRoot(workDir);
				var dataPrefix = GitCommandHelper.GetDataPrefix(gitRoot, workDir);
				// フロントエンドから受け取った "data/xxx.csv" をgitルート相対パスに変換する
				path = GitCommandHelper.ToGitRootRelativePath(path, dataPrefix);
				var validationError = GitCommandHelper.ValidateDataPath(path, dataPrefix);
				if (validationError != null)
				{
					return new { type = "git_show_at_commit_response", requestId, success = false, error = validationError };
				}

				// git show {commit}:{path} で指定コミット時点のファイル内容を取得する
				var output = GitCommandHelper.RunGitCommand(gitRoot, "show", $"{commit}:{path}");

				return new
				{
					type = "git_show_at_commit_response",
					requestId,
					success = true,
					data = output
				};
			}
			catch (Exception ex)
			{
				Logger.Error(ex, "git show at commit 実行時にエラーが発生しました。");
				return new
				{
					type = "git_show_at_commit_response",
					requestId,
					success = false,
					error = ex.Message,
				};
			}
		}
	}
}
