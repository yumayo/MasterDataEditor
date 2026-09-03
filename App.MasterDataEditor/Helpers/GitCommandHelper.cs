using System;
using System.Collections.Generic;
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
		private const string BranchFieldSeparator = "%09";

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
			return GetWorkDirRelativePrefix(gitRoot, workDir, "data/");
		}

		/// <summary>
		/// schema/ディレクトリのgitルート相対プレフィックスを返す
		/// </summary>
		public static string GetSchemaPrefix(string gitRoot, string workDir)
		{
			return GetWorkDirRelativePrefix(gitRoot, workDir, "schema/");
		}

		/// <summary>
		/// git操作対象パスのバリデーションを行う
		/// パストラバーサル防止・data/ディレクトリ内の.csvファイル制限を一元的にチェックする
		/// 不正なパスの場合はエラーメッセージを返し、正常なら null を返す
		/// </summary>
		public static string? ValidateDataPath(string path, string dataPrefix)
		{
			if (string.IsNullOrEmpty(path)) return "path is empty";
			if (path.Contains("..") || Path.IsPathRooted(path)) return "invalid path";
			if (!path.StartsWith(dataPrefix, StringComparison.Ordinal) || !path.EndsWith(".csv", StringComparison.Ordinal)) return "path must be " + dataPrefix + "*.csv";
			return null;
		}

		/// <summary>
		/// コミットから読み出せるファイルをworkDir配下のdata/*.csvまたはschema/*.jsonに制限する
		/// </summary>
		public static string? ValidateVersionedFilePath(string path, string dataPrefix, string schemaPrefix)
		{
			if (string.IsNullOrEmpty(path)) return "path is empty";
			if (path.Contains("..") || Path.IsPathRooted(path)) return "invalid path";

			var isDataFile = path.StartsWith(dataPrefix, StringComparison.Ordinal)
				&& path.EndsWith(".csv", StringComparison.Ordinal);
			var isSchemaFile = path.StartsWith(schemaPrefix, StringComparison.Ordinal)
				&& path.EndsWith(".json", StringComparison.Ordinal);
			if (!isDataFile && !isSchemaFile)
			{
				return "path must be " + dataPrefix + "*.csv or " + schemaPrefix + "*.json";
			}

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
			if (frontendPath.StartsWith("data/", StringComparison.Ordinal))
			{
				return dataPrefix + frontendPath.Substring("data/".Length);
			}
			return frontendPath;
		}

		/// <summary>
		/// WebView側のdata/またはschema/始まりのパスをgitルート相対パスへ変換する
		/// </summary>
		public static string ToGitRootRelativeVersionedPath(string frontendPath, string dataPrefix, string schemaPrefix)
		{
			if (frontendPath.StartsWith("data/", StringComparison.Ordinal))
			{
				return dataPrefix + frontendPath.Substring("data/".Length);
			}
			if (frontendPath.StartsWith("schema/", StringComparison.Ordinal))
			{
				return schemaPrefix + frontendPath.Substring("schema/".Length);
			}
			return frontendPath;
		}

		/// <summary>
		/// ローカルブランチとremote-trackingブランチを列挙する。
		/// origin/HEADなどのシンボリックrefは結果から除外する。
		/// </summary>
		public static List<GitBranchReference> GetBranchReferences(string gitRoot)
		{
			var output = RunGitCommand(
				gitRoot,
				"for-each-ref",
				"--sort=refname",
				$"--format=%(refname){BranchFieldSeparator}%(objecttype){BranchFieldSeparator}%(symref)",
				"refs/heads",
				"refs/remotes"
			);

			var branches = new List<GitBranchReference>();
			foreach (var line in output.Split('\n', StringSplitOptions.RemoveEmptyEntries))
			{
				var fields = line.TrimEnd('\r').Split('\t');
				if (fields.Length != 3)
				{
					throw new InvalidOperationException("Unexpected git for-each-ref output.");
				}

				var refName = fields[0];
				GitBranchKind? kind = null;
				string? name = null;
				if (refName.StartsWith("refs/heads/", StringComparison.Ordinal))
				{
					kind = GitBranchKind.Local;
					name = refName.Substring("refs/heads/".Length);
				}
				else if (refName.StartsWith("refs/remotes/", StringComparison.Ordinal))
				{
					kind = GitBranchKind.Remote;
					name = refName.Substring("refs/remotes/".Length);
				}

				if (kind == null || name == null || fields[1] != "commit" || fields[2].Length != 0)
				{
					continue;
				}

				branches.Add(new GitBranchReference(name, refName, kind.Value));
			}

			return branches;
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

		private static string GetWorkDirRelativePrefix(string gitRoot, string workDir, string directory)
		{
			var relativePath = Path.GetRelativePath(gitRoot, workDir).Replace('\\', '/');
			if (relativePath == ".")
			{
				return directory;
			}
			return relativePath + "/" + directory;
		}
	}

	internal sealed class GitBranchReference
	{
		public GitBranchReference(string name, string refName, GitBranchKind kind)
		{
			Name = name;
			RefName = refName;
			Kind = kind;
		}

		public readonly string Name;
		public readonly string RefName;
		public readonly GitBranchKind Kind;
	}

	internal enum GitBranchKind
	{
		Local,
		Remote,
	}
}
