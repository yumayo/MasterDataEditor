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

			// 無効な文字をチェック
			var invalidChars = Path.GetInvalidFileNameChars();
			if (filename.Any(c => invalidChars.Contains(c)))
			{
				return false;
			}

			return true;
		}
	}
}