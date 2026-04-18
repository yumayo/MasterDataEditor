using System;
using System.IO;
using System.Text.Json;

namespace App.MasterDataEditor
{
	public static class WebView2HandlerWriteFileRequest
	{
		public static object Invoke(JsonElement root, string requestId)
		{
			try
			{
				if (!root.TryGetProperty("filename", out var filenameElement))
				{
					Logger.Warning("ファイル書き込み拒否");
					return new
					{
						type = "write_file_response",
						requestId,
						success = false,
						error = "Required filename"
					};
				}

				if (!root.TryGetProperty("data", out var dataElement))
				{
					Logger.Warning("ファイル書き込み拒否");
					return new
					{
						type = "write_file_response",
						requestId,
						success = false,
						error = "Required data"
					};
				}

				var filename = filenameElement.GetString();

				if (string.IsNullOrEmpty(filename) || !HelperFile.IsValidFilename(filename))
				{
					Logger.Warning($"ファイル書き込み拒否: 無効なファイル名 {filename}");
					return new
					{
						type = "write_file_response",
						requestId,
						filename,
						success = false,
						error = "Invalid filename"
					};
				}

				var workDir = AppEnvironment.GetWorkDir();
				Directory.CreateDirectory(workDir);
				var filePath = HelperFile.ResolveSafePath(workDir, filename);

				if (filePath == null)
				{
					Logger.Warning($"ファイル書き込み拒否: workDir外へのアクセス {filename}");
					return new
					{
						type = "write_file_response",
						requestId,
						success = false,
						error = "Invalid filename"
					};
				}

				var data = dataElement.GetString();
				Directory.CreateDirectory(AppEnvironment.GetDirectoryName(filePath));
				File.WriteAllText(filePath, data);
				AfterSaveHookRunner.StartIfExists(workDir, filename);

				return new
				{
					type = "write_file_response",
					requestId,
					success = true
				};
			}
			catch (Exception ex)
			{
				Logger.Error(ex, $"ファイル書き込み時にエラーが発生しました。");
				return new
				{
					type = "write_file_response",
					requestId,
					success = false,
					error = ex.Message,
				};
			}
		}
	}
}
