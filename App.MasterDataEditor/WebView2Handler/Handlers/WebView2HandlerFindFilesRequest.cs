using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace App.MasterDataEditor
{
	public static class WebView2HandlerFindFilesRequest
	{
		public static object Invoke(JsonElement root, string requestId)
		{
			try
			{

				if (!root.TryGetProperty("directory", out var directoryElement))
				{
					Logger.Warning("ファイル一覧取得拒否");
					return new
					{
						type = "find_files_response",
						requestId,
						success = false,
						error = "Required directory"
					};
				}

				var directory = directoryElement.GetString();

				if (string.IsNullOrEmpty(directory) || !HelperFile.IsValidFilename(directory))
				{
					Logger.Warning($"ファイル一覧取得拒否: 無効なディレクトリ名 {directory}");
					return new
					{
						type = "find_files_response",
						requestId,
						success = false,
						error = "Invalid directory"
					};
				}

				var workDir = AppEnvironment.GetWorkDir();
				var items = WorkspaceFileAccess.FindEntries(workDir, directory);

				return new
				{
					type = "find_files_response",
					requestId,
					success = true,
					data = items
				};
			}
			catch (Exception ex)
			{
				Logger.Error(ex, "ファイル一覧取得時にエラーが発生しました。");
				return new
				{
					type = "find_files_response",
					requestId,
					success = false,
					error = ex.Message,
				};
			}
		}
	}
}
