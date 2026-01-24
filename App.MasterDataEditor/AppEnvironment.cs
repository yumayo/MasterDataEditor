using System;

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

	public static int GetRequiredInt(string name)
	{
		var value = GetRequired(name);
		if (!int.TryParse(value, out var result))
		{
			throw new InvalidOperationException($"Environment variable '{name}' must be a valid integer.");
		}

		return result;
	}
}
