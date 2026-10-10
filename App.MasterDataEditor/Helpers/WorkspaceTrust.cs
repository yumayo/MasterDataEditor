using System;
using System.IO;

namespace App.MasterDataEditor;

/// <summary>信頼の付与と保存はネイティブUIに限定する。作業フォルダーのファイルは判断に使わない。</summary>
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

    public static void RestoreFromNativeStore(string workDir)
    {
        try
        {
            lock (Sync)
            {
                // 読込失敗でも以前の信頼と処理待ちの世代を残さない。復元時は再保存しない。
                _trustedPath = "";
                _generation++;
                var path = Path.TrimEndingDirectorySeparator(Path.GetFullPath(workDir));
                if (NativeWorkspaceTrustStore.Read(path)) _trustedPath = path;
            }
        }
        finally { Changed?.Invoke(); }
    }

    public static void GrantFromNativeUi(string workDir)
    {
        lock (Sync)
        {
            var path = Path.TrimEndingDirectorySeparator(Path.GetFullPath(workDir));
            NativeWorkspaceTrustStore.Grant(path);
            _trustedPath = path;
            _generation++;
        }
        Changed?.Invoke();
    }

    public static void Revoke()
    {
        try
        {
            lock (Sync)
            {
                var path = _trustedPath;
                _trustedPath = "";
                _generation++;
                if (path.Length == 0) return;
                try { NativeWorkspaceTrustStore.Revoke(path); }
                catch (Exception error) { throw new IOException("現在の信頼は解除しましたが、保存済みの信頼を削除できませんでした。次回起動時に信頼が復元される可能性があります。", error); }
            }
        }
        // 保存の削除に失敗しても、実行中のターミナル・プラグインを停止してからエラーを返す。
        finally { Changed?.Invoke(); }
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
