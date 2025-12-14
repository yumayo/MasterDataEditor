using System;
using System.IO;
using System.Text.Json;

namespace App.MasterDataEditor
{
	public static class WebView2HandlerFileWriteRequest
	{
		public static object Invoke(JsonElement root)
		{
			try
			{
				if (!root.TryGetProperty("filename", out var filenameElement))
				{
					Logger.Warning("ファイル書き込み拒否");
					return new
					{
						type = "file_write_response",
						success = false,
						error = "Required filename"
					};
				}

				if (!root.TryGetProperty("data", out var dataElement))
				{
					Logger.Warning("ファイル書き込み拒否");
					return new
					{
						type = "file_write_response",
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
						type = "file_write_response",
						filename,
						success = false,
						error = "Invalid filename"
					};
				}

				var appDataPath = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
				var appFolder = Path.Combine(appDataPath, "App.MasterDataEditor");
				Directory.CreateDirectory(appFolder);
				var filePath = Path.Combine(appFolder, filename);

				var data = dataElement.GetString();
				File.WriteAllText(filePath, data);

				return new
				{
					type = "file_write_response",
					success = true
				};
			}
			catch (Exception ex)
			{
				Logger.Error(ex, $"ファイル書き込み時にエラーが発生しました。");
				return new
				{
					type = "file_write_response",
					success = false,
					error = ex.Message,
				};
			}
		}
	}
}