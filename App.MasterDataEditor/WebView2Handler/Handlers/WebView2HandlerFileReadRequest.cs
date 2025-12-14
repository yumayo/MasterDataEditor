using System;
using System.IO;
using System.Text.Json;

namespace App.MasterDataEditor
{
	public static class WebView2HandlerFileReadRequest
	{
		public static object Invoke(JsonElement root)
		{
			try
			{
				if (!root.TryGetProperty("filename", out var filenameElement))
				{
					Logger.Warning("ファイル読み込み拒否");
					return new
					{
						type = "file_read_response",
						success = false,
						error = "Invalid filename",
					};
				}

				var filename = filenameElement.GetString();

				if (string.IsNullOrEmpty(filename) || !HelperFile.IsValidFilename(filename))
				{
					Logger.Warning($"ファイル読み込み拒否: 無効なファイル名 {filename}");
					return new
					{
						type = "file_read_response",
						success = false,
						error = "Invalid filename",
					};
				}

				var appDataPath = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
				var appFolder = Path.Combine(appDataPath, "App.MasterDataEditor");
				var filePath = Path.Combine(appFolder, filename);

				string data = "";
				if (File.Exists(filePath))
				{
					data = File.ReadAllText(filePath);
				}

				return new
				{
					type = "file_read_response",
					success = true,
					data
				};
			}
			catch (Exception ex)
			{
				Logger.Error(ex, "ファイル読み込み時にエラーが発生しました。");
				return new
				{
					type = "file_read_response",
					success = false,
					error = ex.Message,
				};
			}
		}
	}
}