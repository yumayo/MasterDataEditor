using System;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace App.MasterDataEditor
{
	public static class WebView2HandlerGitCellBlameRequest
	{
		public static object Invoke(JsonElement root, string requestId)
		{
			try
			{
				var filename = root.GetProperty("filename").GetString();
				var commit = root.GetProperty("commit").GetString();
				if (string.IsNullOrEmpty(filename)) throw new ArgumentException("filename is required");
				if (commit == null || !Regex.IsMatch(commit, @"\A(?:[0-9a-fA-F]{7,40}|[0-9a-fA-F]{64})\z")) throw new ArgumentException("invalid commit hash format");
				var primaryKey = root.GetProperty("primaryKey").EnumerateArray().Select(key => key.GetString() ?? "").ToArray();
				if (primaryKey.Length == 0 || primaryKey.Any(string.IsNullOrEmpty) || primaryKey.Distinct().Count() != primaryKey.Length) throw new ArgumentException("primaryKey is invalid");
				var cells = root.GetProperty("cells").EnumerateArray().Select(cell => new CellHistoryTarget(cell.GetProperty("lineNumber").GetInt32(), cell.GetProperty("columnName").GetString() ?? "")).ToArray();
				if (cells.Any(cell => cell.LineNumber < 2 || string.IsNullOrEmpty(cell.ColumnName))) throw new ArgumentException("cells is invalid");
				var workDir = AppEnvironment.GetWorkDir();
				var gitRoot = GitCommandHelper.GetGitRoot(workDir);
				var dataPrefix = GitCommandHelper.GetDataPrefix(gitRoot, workDir);
				filename = GitCommandHelper.ToGitRootRelativePath(filename, dataPrefix);
				var validationError = GitCommandHelper.ValidateDataPath(filename, dataPrefix);
				if (validationError != null) throw new ArgumentException(validationError);
				var entries = new GitCellHistory(gitRoot, primaryKey).Find(commit, filename, cells);
				return new
				{
					type = "git_cell_blame_response", requestId, success = true,
					data = entries.Select(entry => new {lineNumber = entry.LineNumber, columnName = entry.ColumnName, author = entry.Author, date = entry.Date, commitHash = entry.CommitHash, commitMessage = entry.CommitMessage}).ToArray(),
				};
			}
			catch (Exception ex)
			{
				Logger.Error(ex, "セル単位の変更履歴の取得に失敗しました。");
				return new {type = "git_cell_blame_response", requestId, success = false, error = ex.Message};
			}
		}
	}
}
