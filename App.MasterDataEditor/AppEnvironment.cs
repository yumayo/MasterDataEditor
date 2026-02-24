using System;
using System.IO;

namespace App.MasterDataEditor;

internal static class AppEnvironment
{
	public static string GetRequired(string name)
	{
		var value = Environment.GetEnvironmentVariable(name);
		if (string.IsNullOrWhiteSpace(value))
		{
			throw new InvalidOperationException($"Environment variable '{name}' is required.");
		}

		return value;
	}

	public static string Get(string name, string defaultValue)
	{
		var value = Environment.GetEnvironmentVariable(name);
		if (string.IsNullOrWhiteSpace(value))
		{
			return defaultValue;
		}

		return value;
	}

	public static int GetRequiredInt(string name)
	{
		var value = GetRequired(name);
		if (!int.TryParse(value, out var result))
		{
			throw new InvalidOperationException($"Environment variable '{name}' must be a valid integer.");
		}

		return result;
	}

	public static int GetInt(string name, int defaultValue)
	{
		var value = Environment.GetEnvironmentVariable(name);
		if (string.IsNullOrWhiteSpace(value))
		{
			return defaultValue;
		}

		if (!int.TryParse(value, out var result))
		{
			throw new InvalidOperationException($"Environment variable '{name}' must be a valid integer.");
		}

		return result;
	}

	public static string GetWorkDir()
	{
		var value = Environment.GetEnvironmentVariable("MASTER_DATA_EDITOR_WORKDIR");
		if (!string.IsNullOrWhiteSpace(value))
		{
			return Path.GetFullPath(value);
		}

		// NOTE: ガイドラインよりも実行のしやすさを優先するため特別にフォールバックを許可
		var repoRoot = GetRepositoryRoot();
		return Path.Combine(repoRoot, "sample-workdir");
	}

	private static string GetRepositoryRoot()
	{
		var directory = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
		while (directory != null)
		{
			if (Directory.Exists(Path.Combine(directory.FullName, ".git")))
			{
				return directory.FullName;
			}

			directory = directory.Parent;
		}

		throw new InvalidOperationException("Repository root not found. Set 'MASTER_DATA_EDITOR_WORKDIR' environment variable.");
	}

	public static int GetDevPort()
	{
		// NOTE: ガイドラインよりも実行のしやすさを優先するため特別にフォールバックを許可
		return GetInt("MASTER_DATA_EDITOR_DEV_PORT", 5173);
	}

	public static string GetConsoleLogPath()
	{
		// NOTE: ガイドラインよりも実行のしやすさを優先するため特別にフォールバックを許可
		return Get("MASTER_DATA_EDITOR_CONSOLE_LOG_PATH", "NUL");
	}

	public static string GetServerLogPath()
	{
		var workDir = GetWorkDir();
		var logDirectory = Path.Combine(workDir, "log");
		return Path.Combine(logDirectory, "App.MasterDataEditor.log");
	}

	public static string GetDirectoryName(string path)
	{
		var directoryName = Path.GetDirectoryName(path);
		if (string.IsNullOrEmpty(directoryName))
		{
			throw new InvalidOperationException($"Failed to resolve directory from path '{path}'.");
		}

		return directoryName;
	}
}
