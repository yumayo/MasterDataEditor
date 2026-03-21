using System;
using System.Diagnostics;
using System.IO;

namespace App.MasterDataEditor
{
	/// <summary>
	/// gitコマンドを実行する共通ヘルパー
	/// WebView2HandlerGitStatusRequest / WebView2HandlerGitShowRequest の重複を排除する
	/// ArgumentListを使用して引数インジェクションを防止する
	/// </summary>
	internal static class GitCommandHelper
	{
		/// <summary>
		/// workDirからgitリポジトリルートへの相対パスを算出し、data/ディレクトリのプレフィックスを返す
		/// git status --porcelain の出力パスはリポジトリルート相対のため、フィルタリングにはこのプレフィックスを使う
		/// workDirがリポジトリルートそのものの場合は "data/"、サブディレクトリの場合は "subdir/data/" となる
		/// </summary>
		public static string GetDataPrefix(string workDir)
		{
			var gitRoot = RunGitCommand(workDir, "rev-parse", "--show-toplevel").Trim();
			var relWorkDir = Path.GetRelativePath(gitRoot, workDir).Replace('\\', '/');
			return relWorkDir == "." ? "data/" : relWorkDir + "/data/";
		}

		/// <summary>
		/// 指定した作業ディレクトリでgitコマンドを実行し、標準出力を返す
		/// ProcessStartInfo.ArgumentListを使用し、各引数を個別に渡すことで引数インジェクションを防止する
		/// コマンドが失敗した場合（終了コードが0以外）は InvalidOperationException をスローする
		/// </summary>
		public static string RunGitCommand(string workDir, params string[] arguments)
		{
			var startInfo = new ProcessStartInfo
			{
				FileName = "git",
				WorkingDirectory = workDir,
				RedirectStandardOutput = true,
				RedirectStandardError = true,
				UseShellExecute = false,
				CreateNoWindow = true,
				StandardOutputEncoding = System.Text.Encoding.UTF8,
				StandardErrorEncoding = System.Text.Encoding.UTF8,
			};

			foreach (var arg in arguments)
			{
				startInfo.ArgumentList.Add(arg);
			}

			using var process = Process.Start(startInfo);
			if (process == null) throw new InvalidOperationException("Failed to start git process.");
			var output = process.StandardOutput.ReadToEnd();
			var error = process.StandardError.ReadToEnd();
			process.WaitForExit();

			if (process.ExitCode != 0)
			{
				throw new InvalidOperationException($"git command failed (exit code {process.ExitCode}): {error}");
			}

			return output;
		}
	}
}
