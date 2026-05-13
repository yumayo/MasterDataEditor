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
				var scope = GetScope(root);
				var relativeFilename = scope == "user" && filename != null
					? AppEnvironment.NormalizeUserDataRelativePath(filename)
					: filename;

				if (string.IsNullOrEmpty(relativeFilename) || !HelperFile.IsValidFilename(relativeFilename) || scope == null)
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
				var baseDir = GetBaseDirectory(scope, workDir);
				Directory.CreateDirectory(baseDir);
				var filePath = HelperFile.ResolveSafePath(baseDir, relativeFilename);

				if (filePath == null)
				{
					Logger.Warning($"ファイル書き込み拒否: baseDir外へのアクセス scope={scope} filename={filename} relativeFilename={relativeFilename}");
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
				if (scope == "workspace")
				{
					AfterSaveHookRunner.StartIfExists(workDir, filename);
				}

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

		private static string? GetScope(JsonElement root)
		{
			if (!root.TryGetProperty("scope", out var scopeElement))
			{
				return "workspace";
			}

			var scope = scopeElement.GetString();
			return scope == "workspace" || scope == "user" ? scope : null;
		}

		private static string GetBaseDirectory(string scope, string workDir)
		{
			return scope == "user"
				? AppEnvironment.GetUserDataDir()
				: workDir;
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
