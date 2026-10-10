namespace App.MasterDataEditor;

// OS共通の状態遷移検証ではHKCUだけを差し替え、WorkspaceTrust本体をそのまま使用する。
internal static class NativeWorkspaceTrustStore
{
    internal static readonly HashSet<string> TrustedPaths = new(OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal);
    internal static bool FailRead;
    internal static bool FailGrant;
    internal static bool FailRevoke;

    internal static bool Read(string workDir)
    {
        if (FailRead) throw new IOException("信頼の読込失敗を再現");
        return TrustedPaths.Contains(Path.TrimEndingDirectorySeparator(Path.GetFullPath(workDir)));
    }

    internal static void Grant(string workDir)
    {
        if (FailGrant) throw new IOException("信頼の保存失敗を再現");
        TrustedPaths.Add(Path.TrimEndingDirectorySeparator(Path.GetFullPath(workDir)));
    }

    internal static void Revoke(string workDir)
    {
        if (FailRevoke) throw new IOException("信頼の削除失敗を再現");
        TrustedPaths.Remove(Path.TrimEndingDirectorySeparator(Path.GetFullPath(workDir)));
    }
}
