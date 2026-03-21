using System;
using System.IO;
using System.Linq;

namespace App.MasterDataEditor
{
	public static class HelperFile
	{
		public static bool IsValidFilename(string? filename)
		{
			if (string.IsNullOrWhiteSpace(filename))
			{
				return false;
			}

			// パストラバーサル攻撃の防止
			if (filename.Contains(".."))
			{
				return false;
			}

			// 絶対パスの拒否（ドライブレター "C:\..." やルートパス "/" "/..." を防止）
			if (Path.IsPathRooted(filename))
			{
				return false;
			}

			// UNCパスの拒否（"\\server\share" を防止）
			if (filename.StartsWith(@"\\"))
			{
				return false;
			}

			// NTFS代替データストリームの拒否（"file.csv:stream" を防止）
			if (filename.Contains(':'))
			{
				return false;
			}

			// 無効な文字をチェック
			var invalidChars = Path.GetInvalidPathChars();
			if (filename.Any(c => invalidChars.Contains(c)))
			{
				return false;
			}

			return true;
		}

		/// <summary>
		/// baseDir配下の安全なパスに解決する。
		/// Path.Combineの「第2引数が絶対パスなら第1引数を無視する」挙動を防ぎ、
		/// 正規化後のパスがbaseDir配下に収まることを保証する。
		/// baseDir外へのアクセスはnullを返して拒否する。
		/// </summary>
		public static string? ResolveSafePath(string baseDir, string requestedPath)
		{
			try
			{
				var fullPath = Path.GetFullPath(Path.Combine(baseDir, requestedPath));
				var normalizedBase = Path.GetFullPath(baseDir);
				if (!normalizedBase.EndsWith(Path.DirectorySeparatorChar.ToString()))
				{
					normalizedBase += Path.DirectorySeparatorChar;
				}

				if (!fullPath.StartsWith(normalizedBase, StringComparison.OrdinalIgnoreCase))
				{
					return null;
				}

				return fullPath;
			}
			catch (ArgumentException)
			{
				// NUL文字等の不正な文字列がPath.GetFullPathに渡された場合
				return null;
			}
		}
	}
}