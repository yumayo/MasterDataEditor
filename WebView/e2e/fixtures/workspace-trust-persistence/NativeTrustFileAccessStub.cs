namespace App.MasterDataEditor;

// OS共通ではI/Oだけを置き換え、保存形式とパス照合は本体Storeを実行する。
internal static class WorkspaceFileAccess
{
    internal static readonly Dictionary<string, string> Records = new(StringComparer.Ordinal);
    public static string? ReadNativeTrustRecord(string filename) => Records.TryGetValue(filename, out var value) ? value : null;
    public static void WriteNativeTrustRecord(string filename, string contents) => Records[filename] = contents;
    public static bool DeleteNativeTrustRecord(string filename) => Records.Remove(filename);
}
