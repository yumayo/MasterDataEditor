using System;
using System.IO;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace App.MasterDataEditor
{
	public static class WebView2HandlerWriteFileRequest
	{
		private static readonly JsonSerializerOptions JsonWriteOptions = new()
		{
			Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
			WriteIndented = true
		};

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

				var data = GetFileContent(dataElement);
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

		private static string GetFileContent(JsonElement dataElement)
		{
			if (dataElement.ValueKind == JsonValueKind.String)
			{
				return dataElement.GetString() ?? "";
			}

			return JsonSerializer.Serialize(dataElement, JsonWriteOptions).Replace("\r\n", "\n") + "\n";
		}
	}
}
