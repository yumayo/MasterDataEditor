using System;
using System.IO;
using System.Text.Json;

namespace App.MasterDataEditor
{
	public static class WebView2HandlerReadFileRequest
	{
		public static object Invoke(JsonElement root, string requestId)
		{
			try
			{
				if (!root.TryGetProperty("filename", out var filenameElement))
				{
					Logger.Warning("ファイル読み込み拒否");
					return new
					{
						type = "read_file_response",
						requestId,
						success = false,
						error = "Invalid filename",
					};
				}

				var filename = filenameElement.GetString();
				var scope = GetScope(root);
				var relativeFilename = scope == "user" && filename != null
					? AppEnvironment.NormalizeUserDataRelativePath(filename)
					: filename;

				if (string.IsNullOrEmpty(relativeFilename) || !HelperFile.IsValidFilename(relativeFilename) || scope == null)
				{
					Logger.Warning($"ファイル読み込み拒否: 無効なファイル名 {filename}");
					return new
					{
						type = "read_file_response",
						requestId,
						success = false,
						error = "Invalid filename",
					};
				}

				var baseDir = GetBaseDirectory(scope);
				var data = WorkspaceFileAccess.ReadAllText(baseDir, relativeFilename);

				return new
				{
					type = "read_file_response",
					requestId,
					success = true,
					data
				};
			}
			catch (Exception ex)
			{
				Logger.Error(ex, "ファイル読み込み時にエラーが発生しました。");
				return new
				{
					type = "read_file_response",
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

		private static string GetBaseDirectory(string scope)
		{
			return scope == "user"
				? AppEnvironment.GetUserDataDir()
				: AppEnvironment.GetWorkDir();
		}
	}
}
