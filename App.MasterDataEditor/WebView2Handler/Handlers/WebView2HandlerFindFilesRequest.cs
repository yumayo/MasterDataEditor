using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace App.MasterDataEditor
{
	public static class WebView2HandlerFindFilesRequest
	{
		public static object Invoke(JsonElement root)
		{
			try
			{
				
				if (!root.TryGetProperty("directory", out var directoryElement))
				{
					Logger.Warning("ファイル一覧取得拒否");
					return new
					{
						type = "find_files_response",
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
						success = false,
						error = "Invalid directory"
					};
				}

				var appDataPath = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
				var appFolder = Path.Combine(appDataPath, "yumayo", "App.MasterDataEditor");
				Directory.CreateDirectory(appFolder);
				var dirPath = Path.Combine(appFolder, directory);

				var files = new List<object>();
				var dirs = new List<object>();

				if (Directory.Exists(dirPath))
				{
					// ファイルを取得
					var fileInfos = Directory.EnumerateFiles(dirPath);
					files = fileInfos.Select(f => new
					{
						name = Path.GetFileName(f),
						type = "file"
					}).ToList<object>();

					// ディレクトリを取得
					var dirInfos = Directory.EnumerateDirectories(dirPath);
					dirs = dirInfos.Select(d => new
					{
						name = Path.GetFileName(d),
						type = "directory"
					}).ToList<object>();
				}

				var items = dirs.Concat(files).ToList();

				return new
				{
					type = "find_files_response",
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
					success = false,
					error = ex.Message,
				};
			}
		}
	}
}