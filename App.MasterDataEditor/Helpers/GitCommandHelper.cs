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
		/// workDirのgitリポジトリルートの絶対パスを返す
		/// </summary>
		public static string GetGitRoot(string workDir)
		{
			return RunGitCommand(workDir, "rev-parse", "--show-toplevel").Trim();
		}

		/// <summary>
		/// data/ディレクトリのプレフィックスを返す
		/// git status --porcelain の出力パスはリポジトリルート相対であるため、
		/// gitルートからworkDirまでの相対パスを含めたプレフィックスを返す
		/// 例: gitRoot=/repo, workDir=/repo/sample-workdir → "sample-workdir/data/"
		/// </summary>
		public static string GetDataPrefix(string gitRoot, string workDir)
		{
			var relativePath = Path.GetRelativePath(gitRoot, workDir).Replace('\\', '/');
			if (relativePath == ".")
			{
				return "data/";
			}
			return relativePath + "/data/";
		}

		/// <summary>
		/// git操作対象パスのバリデーションを行う
		/// パストラバーサル防止・data/ディレクトリ内の.csvファイル制限を一元的にチェックする
		/// 不正なパスの場合はエラーメッセージを返し、正常なら null を返す
		/// </summary>
		public static string ValidateDataPath(string path, string dataPrefix)
		{
			if (string.IsNullOrEmpty(path)) return "path is empty";
			if (path.Contains("..") || Path.IsPathRooted(path)) return "invalid path";
			if (!path.StartsWith(dataPrefix) || !path.EndsWith(".csv")) return "path must be " + dataPrefix + "*.csv";
			return null;
		}

		/// <summary>
		/// フロントエンドから受け取った "data/xxx.csv" 形式のパスを
		/// gitルート相対の "{dataPrefix}xxx.csv" 形式に変換する。
		/// フロントエンドはgitリポジトリ構造を知らないため、
		/// テーブル名ベースでパスを構築する呼び出し元（git_log, git_blame）で使用する。
		/// </summary>
		public static string ToGitRootRelativePath(string frontendPath, string dataPrefix)
		{
			if (frontendPath.StartsWith("data/"))
			{
				return dataPrefix + frontendPath.Substring("data/".Length);
			}
			return frontendPath;
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
