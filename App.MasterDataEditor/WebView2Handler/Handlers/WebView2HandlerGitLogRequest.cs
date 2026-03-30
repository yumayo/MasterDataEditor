using System;
using System.Collections.Generic;
using System.Text.Json;

namespace App.MasterDataEditor
{
	/// <summary>
	/// git log でCSVファイルのコミット履歴を返す。
	/// --format で構造化出力し、フロントエンドの LogEntry[] と同じ構造で返す。
	/// </summary>
	public static class WebView2HandlerGitLogRequest
	{
		/// <summary>
		/// git log --format のレコード区切り文字。
		/// コミットメッセージやauthor名に出現しない文字列を使う。
		/// </summary>
		private const string RecordSeparator = "---GIT_LOG_SEPARATOR---";

		/// <summary>
		/// git log --format のフィールド区切り文字。
		/// </summary>
		private const string FieldSeparator = "---FIELD---";

		public static object Invoke(JsonElement root, string requestId)
		{
			try
			{
				if (!root.TryGetProperty("filename", out var filenameElement))
				{
					return new { type = "git_log_response", requestId, success = false, error = "filename is required" };
				}

				if (!root.TryGetProperty("limit", out var limitElement))
				{
					return new { type = "git_log_response", requestId, success = false, error = "limit is required" };
				}

				var limit = limitElement.GetInt32();
				var workDir = AppEnvironment.GetWorkDir();
				var gitRoot = GitCommandHelper.GetGitRoot(workDir);
				var dataPrefix = GitCommandHelper.GetDataPrefix(gitRoot, workDir);
				var filename = GitCommandHelper.ToGitRootRelativePath(filenameElement.GetString(), dataPrefix);
				var validationError = GitCommandHelper.ValidateDataPath(filename, dataPrefix);
				if (validationError != null)
				{
					return new { type = "git_log_response", requestId, success = false, error = validationError };
				}

				// --follow でファイル名変更にも追従する
				// --format で commitHash, author, date, message を構造化出力する
				var format = $"%H{FieldSeparator}%an{FieldSeparator}%ai{FieldSeparator}%s{RecordSeparator}";
				var output = GitCommandHelper.RunGitCommand(
					gitRoot,
					"log",
					$"-n{limit}",
					$"--format={format}",
					"--follow",
					"--",
					filename
				);

				var entries = ParseLogOutput(output);

				return new
				{
					type = "git_log_response",
					requestId,
					success = true,
					data = entries
				};
			}
			catch (Exception ex)
			{
				Logger.Error(ex, "git log 実行時にエラーが発生しました。");
				return new
				{
					type = "git_log_response",
					requestId,
					success = false,
					error = ex.Message,
				};
			}
		}

		private static List<object> ParseLogOutput(string output)
		{
			var entries = new List<object>();
			var records = output.Split(RecordSeparator, StringSplitOptions.RemoveEmptyEntries);

			foreach (var record in records)
			{
				var trimmed = record.Trim();
				if (trimmed.Length == 0) continue;

				var fields = trimmed.Split(FieldSeparator);
				if (fields.Length < 4) continue;

				entries.Add(new
				{
					commitHash = fields[0],
					author = fields[1],
					date = fields[2],
					message = fields[3]
				});
			}

			return entries;
		}
	}
}
