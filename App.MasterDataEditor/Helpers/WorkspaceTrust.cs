using System;
using System.IO;

namespace App.MasterDataEditor;

/// <summary>信頼はネイティブ UI が現在のプロセスにだけ付与する。作業フォルダーのファイルは判断に使わない。</summary>
internal static class WorkspaceTrust
{
    private static readonly object Sync = new();
    private static string _trustedPath = "";
    private static long _generation;
    public static event Action? Changed;

    public static bool IsTrusted(string workDir) => GetGeneration(workDir) != 0;

    public static long GetGeneration(string workDir)
    {
        lock (Sync) return string.Equals(_trustedPath, Path.TrimEndingDirectorySeparator(Path.GetFullPath(workDir)), OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal) ? _generation : 0;
    }

    public static void GrantFromNativeUi(string workDir)
    {
        lock (Sync)
        {
            _trustedPath = Path.TrimEndingDirectorySeparator(Path.GetFullPath(workDir));
            _generation++;
        }
        Changed?.Invoke();
    }

    public static void Revoke()
    {
        lock (Sync) { _trustedPath = ""; _generation++; }
        Changed?.Invoke();
    }

    public static T ExecuteTrusted<T>(string workDir, long generation, Func<T> operation)
    {
        lock (Sync)
        {
            if (generation == 0 || GetGeneration(workDir) != generation) throw new UnauthorizedAccessException("作業フォルダーは信頼されていません。ウィンドウ上部の信頼設定を確認してください。");
            return operation();
        }
    }
}
