using System;
using System.Collections.Generic;
using System.Text.Json;

namespace App.MasterDataEditor
{
	/// <summary>
	/// git blame でCSVファイルの各行の最終変更者・日時・コミット情報を返す。
	/// --porcelain 形式でパースし、フロントエンドの BlameEntry[] と同じ構造で返す。
	/// </summary>
	public static class WebView2HandlerGitBlameRequest
	{
		public static object Invoke(JsonElement root, string requestId)
		{
			try
			{
				if (!root.TryGetProperty("filename", out var filenameElement))
				{
					return new { type = "git_blame_response", requestId, success = false, error = "filename is required" };
				}

				var filename = filenameElement.GetString();
				var workDir = AppEnvironment.GetWorkDir();
				var gitRoot = GitCommandHelper.GetGitRoot(workDir);
				var dataPrefix = GitCommandHelper.GetDataPrefix(gitRoot, workDir);
				var validationError = GitCommandHelper.ValidateDataPath(filename, dataPrefix);
				if (validationError != null)
				{
					return new { type = "git_blame_response", requestId, success = false, error = validationError };
				}

				var output = GitCommandHelper.RunGitCommand(gitRoot, "blame", "--porcelain", filename);
				var entries = ParsePorcelainBlame(output);

				return new
				{
					type = "git_blame_response",
					requestId,
					success = true,
					data = entries
				};
			}
			catch (Exception ex)
			{
				Logger.Error(ex, "git blame 実行時にエラーが発生しました。");
				return new
				{
					type = "git_blame_response",
					requestId,
					success = false,
					error = ex.Message,
				};
			}
		}

		/// <summary>
		/// git blame --porcelain の出力をパースして BlameEntry のリストを返す。
		///
		/// --porcelain 形式は以下の構造を1行ごとに繰り返す:
		///   {commitHash} {origLine} {finalLine} [groupLines]
		///   author {name}
		///   author-time {unix-timestamp}
		///   ...（他のヘッダー行）
		///   summary {message}
		///   ...
		///   \t{行の内容}  ← タブで始まる行が実際のソースコード行
		/// </summary>
		private static List<object> ParsePorcelainBlame(string output)
		{
			var entries = new List<object>();
			var lines = output.Split('\n');

			string currentHash = "";
			string currentAuthor = "";
			string currentDate = "";
			string currentMessage = "";
			int currentLineNumber = 0;

			for (int i = 0; i < lines.Length; i++)
			{
				var line = lines[i];
				if (line.Length == 0) continue;

				// コミットヘッダー行: "{40文字のハッシュ} {origLine} {finalLine} ..."
				if (line.Length >= 40 && !line.StartsWith('\t') && IsHexString(line, 40))
				{
					currentHash = line.Substring(0, 40);
					// finalLine は2番目の数値（スペース区切り）
					var parts = line.Split(' ');
					if (parts.Length >= 3 && int.TryParse(parts[2], out var finalLine))
					{
						currentLineNumber = finalLine;
					}
					// 新しいブロック開始時にリセット
					currentAuthor = "";
					currentDate = "";
					currentMessage = "";
				}
				else if (line.StartsWith("author "))
				{
					currentAuthor = line.Substring("author ".Length);
				}
				else if (line.StartsWith("author-time "))
				{
					var unixTimeStr = line.Substring("author-time ".Length);
					if (long.TryParse(unixTimeStr, out var unixTime))
					{
						var dateTime = DateTimeOffset.FromUnixTimeSeconds(unixTime);
						currentDate = dateTime.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
					}
				}
				else if (line.StartsWith("summary "))
				{
					currentMessage = line.Substring("summary ".Length);
				}
				else if (line.StartsWith('\t'))
				{
					// タブで始まる行 = ソースコード行 → 1エントリ確定
					entries.Add(new
					{
						lineNumber = currentLineNumber,
						author = currentAuthor,
						date = currentDate,
						commitHash = currentHash,
						commitMessage = currentMessage
					});
				}
			}

			return entries;
		}

		/// <summary>
		/// 文字列の先頭 length 文字がすべて16進数文字かどうかを判定する
		/// </summary>
		private static bool IsHexString(string s, int length)
		{
			if (s.Length < length) return false;
			for (int i = 0; i < length; i++)
			{
				var c = s[i];
				if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')))
				{
					return false;
				}
			}
			return true;
		}
	}
}
