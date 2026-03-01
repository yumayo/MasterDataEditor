using System;
using System.IO;
using System.Text.Json;

namespace App.MasterDataEditor
{
	public static class WebView2HandlerDeleteFileRequest
	{
		public static object Invoke(JsonElement root)
		{
			try
			{
				if (!root.TryGetProperty("filename", out var filenameElement))
				{
					Logger.Warning("ファイル削除拒否");
					return new
					{
						type = "delete_file_response",
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
						success = false,
						error = "Invalid filename"
					};
				}

				var workDir = AppEnvironment.GetWorkDir();
				var filePath = Path.Combine(workDir, filename);

				if (!File.Exists(filePath))
				{
					return new
					{
						type = "delete_file_response",
						success = false,
						error = "File not found"
					};
				}

				File.Delete(filePath);

				return new
				{
					type = "delete_file_response",
					success = true
				};
			}
			catch (Exception ex)
			{
				Logger.Error(ex, "ファイル削除時にエラーが発生しました。");
				return new
				{
					type = "delete_file_response",
					success = false,
					error = ex.Message,
				};
			}
		}
	}
}
