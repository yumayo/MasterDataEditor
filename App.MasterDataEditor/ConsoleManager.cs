using System;
using System.IO;
using System.Text;

namespace App.MasterDataEditor;

public static class ConsoleManager
{
	public static bool Setup()
	{
		try
		{
			// このクラスでは出力がShift-JISになっているのを、UTF-8にしています。

			// しかし、以下のように記述すると「System.IO.IOException: ハンドルが無効です。」という例外が発生してしまいます。
			// Console.OutputEncoding = Encoding.UTF8;
			// Console.InputEncoding = Encoding.UTF8;

			// 上記例外を抑制するため、リダイレクト方式でエンコーディングを設定しています。

			var writer = new StreamWriter(Console.OpenStandardOutput(), Encoding.UTF8)
			{
				AutoFlush = true
			};
			Console.SetOut(writer);

			return true;
		}
		catch (Exception ex)
		{
			System.Diagnostics.Debug.WriteLine($"Console setup failed: {ex.Message}");
			return false;
		}
	}
}
