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

			// Win32 の正規化で別名になる末尾の空白・ピリオド、デバイス名を拒否する。
			// Linux の検査でも Windows 上と同じ規則を適用する。
			foreach (var component in filename.Replace('\\', '/').Split('/'))
			{
				if (component.Length == 0 || component == "." || component.EndsWith(' ') || component.EndsWith('.')) return false;
				if (component.Any(c => c < 32 || "<>\"|?*".Contains(c))) return false;
				var device = component.Split('.')[0].ToUpperInvariant();
				if (device is "CON" or "PRN" or "AUX" or "NUL" or "CONIN$" or "CONOUT$") return false;
				if (device.Length == 4 && (device.StartsWith("COM", StringComparison.Ordinal) || device.StartsWith("LPT", StringComparison.Ordinal)) && "123456789¹²³".Contains(device[3])) return false;
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
				if (!IsValidFilename(requestedPath)) return null;
				var fullPath = Path.GetFullPath(Path.Combine(baseDir, requestedPath));
				var normalizedBase = Path.GetFullPath(baseDir);
				if (!normalizedBase.EndsWith(Path.DirectorySeparatorChar.ToString()))
				{
					normalizedBase += Path.DirectorySeparatorChar;
				}

				var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
				if (!fullPath.StartsWith(normalizedBase, comparison))
				{
					return null;
				}

				// 作業フォルダー自身と、その祖先も検査する。存在しない末尾だけは作成用に許可する。
				// この検査だけでは差し替え競合を防げないため、実 I/O は WorkspaceFileAccess を使用する。
				var current = Path.GetPathRoot(fullPath) ?? throw new ArgumentException("Invalid path root");
				foreach (var component in fullPath.Substring(current.Length).Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
				{
					if (!IsValidFilename(component)) return null;
					current = Path.Combine(current, component);
					try
					{
						if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) return null;
					}
					catch (FileNotFoundException) { }
					catch (DirectoryNotFoundException) { }
				}

				return fullPath;
			}
			catch (ArgumentException)
			{
				// NUL文字等の不正な文字列がPath.GetFullPathに渡された場合
				return null;
			}
			catch (IOException) { return null; }
			catch (UnauthorizedAccessException) { return null; }
		}
	}
}
