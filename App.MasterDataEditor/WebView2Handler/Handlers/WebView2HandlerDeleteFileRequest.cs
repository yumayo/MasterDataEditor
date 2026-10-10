using System;
using System.IO;
using System.Text.Json;

namespace App.MasterDataEditor
{
	public static class WebView2HandlerDeleteFileRequest
	{
		public static object Invoke(JsonElement root, string requestId)
		{
			try
			{
				if (!root.TryGetProperty("filename", out var filenameElement))
				{
					Logger.Warning("ファイル削除拒否");
					return new
					{
						type = "delete_file_response",
						requestId,
						success = false,
						error = "Required filename"
					};
				}

				var filename = filenameElement.GetString();

				if (string.IsNullOrEmpty(filename) || !HelperFile.IsValidFilename(filename))
				{
					Logger.Warning($"ファイル削除拒否: 無効なファイル名 {filename}");
					return new
					{
						type = "delete_file_response",
						requestId,
						success = false,
						error = "Invalid filename"
					};
				}

				var workDir = AppEnvironment.GetWorkDir();
				if (!WorkspaceFileAccess.DeleteFile(workDir, filename))
				{
					return new
					{
						type = "delete_file_response",
						requestId,
						success = false,
						error = "File not found"
					};
				}


				return new
				{
					type = "delete_file_response",
					requestId,
					success = true
				};
			}
			catch (Exception ex)
			{
				Logger.Error(ex, "ファイル削除時にエラーが発生しました。");
				return new
				{
					type = "delete_file_response",
					requestId,
					success = false,
					error = ex.Message,
				};
			}
		}
	}
}
