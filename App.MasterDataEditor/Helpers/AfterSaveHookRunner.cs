using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace App.MasterDataEditor
{
	internal static class AfterSaveHookRunner
	{
		private const string HookDirectoryName = "hooks";
		private const string HookFileName = "after-save.sh";
		private const string HookScriptRelativePath = HookDirectoryName + "/" + HookFileName;
		private static readonly SemaphoreSlim HookExecutionLock = new(1, 1);

		public static void StartIfExists(string workDir, string filename)
		{
			if (IsHookFile(filename))
			{
				return;
			}

			var hooksDirectory = Path.Combine(workDir, HookDirectoryName);
			var hookPath = Path.Combine(hooksDirectory, HookFileName);
			if (!File.Exists(hookPath))
			{
				return;
			}

			_ = Task.Run(() =>
			{
				HookExecutionLock.Wait();
				try
				{
					RunHook(workDir, hookPath, filename);
				}
				catch (Exception ex)
				{
					Logger.Error(ex, $"after-save hook の実行に失敗しました: {hookPath}");
				}
				finally
				{
					HookExecutionLock.Release();
				}
			});
		}

		private static void RunHook(string workDir, string hookPath, string filename)
		{
			Logger.Info($"after-save hook を開始: {filename}");

			var startInfo = new ProcessStartInfo
			{
				FileName = "bash",
				WorkingDirectory = workDir,
				RedirectStandardOutput = true,
				RedirectStandardError = true,
				UseShellExecute = false,
				CreateNoWindow = true,
				StandardOutputEncoding = Encoding.UTF8,
				StandardErrorEncoding = Encoding.UTF8,
			};
			// bash に Windows 形式の絶対パス（C:\...）を渡すとバックスラッシュがエスケープとして解釈される。
			// workDir をカレントにした上で POSIX 形式の相対パスを渡し、Windows/Git Bash でも壊れないようにする。
			startInfo.ArgumentList.Add(HookScriptRelativePath);
			startInfo.ArgumentList.Add(filename.Replace('\\', '/'));

			using var process = Process.Start(startInfo);
			if (process == null)
			{
				throw new InvalidOperationException("after-save hook プロセスの起動に失敗しました。");
			}

			var standardOutputTask = process.StandardOutput.ReadToEndAsync();
			var standardErrorTask = process.StandardError.ReadToEndAsync();
			process.WaitForExit();
			Task.WaitAll(standardOutputTask, standardErrorTask);
			var standardOutput = standardOutputTask.Result.Trim();
			var standardError = standardErrorTask.Result.Trim();

			if (!string.IsNullOrEmpty(standardOutput))
			{
				Logger.Info($"after-save hook stdout: {standardOutput}");
			}

			if (process.ExitCode != 0)
			{
				var errorMessage = string.IsNullOrEmpty(standardError)
					? $"after-save hook が終了コード {process.ExitCode} で失敗しました"
					: $"after-save hook が終了コード {process.ExitCode} で失敗しました: {standardError}";
				Logger.Warning(errorMessage);
				return;
			}

			if (!string.IsNullOrEmpty(standardError))
			{
				Logger.Warning($"after-save hook stderr: {standardError}");
			}

			Logger.Info($"after-save hook が完了: {filename}");
		}

		private static bool IsHookFile(string filename)
		{
			var normalizedPath = filename.Replace('\\', '/');
			return normalizedPath == $"{HookDirectoryName}/{HookFileName}" || normalizedPath.StartsWith($"{HookDirectoryName}/");
		}
	}
}
