using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace App.MasterDataEditor;

/// <summary>通常のファイルAPIから隔離したAPPDATAの信頼レコードを管理する。</summary>
internal static class NativeWorkspaceTrustStore
{
    public static bool Read(string workDir)
    {
        var path = NormalizePath(workDir);
        var contents = WorkspaceFileAccess.ReadNativeTrustRecord(GetFilename(path));
        if (contents == null) return false;
        try
        {
            using var record = JsonDocument.Parse(contents);
            var root = record.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var number) || number != 1 || !root.TryGetProperty("path", out var storedPath) || storedPath.ValueKind != JsonValueKind.String || !string.Equals(storedPath.GetString(), path, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
                throw new InvalidDataException("保存された作業フォルダーの信頼情報が不正です。制限モードで起動します。");
            return true;
        }
        catch (JsonException error) { throw new InvalidDataException("保存された作業フォルダーの信頼情報を読み取れません。制限モードで起動します。", error); }
    }

    public static void Grant(string workDir)
    {
        var path = NormalizePath(workDir);
        WorkspaceFileAccess.WriteNativeTrustRecord(GetFilename(path), JsonSerializer.Serialize(new {version = 1, path}));
    }

    public static void Revoke(string workDir)
    {
        var path = NormalizePath(workDir);
        WorkspaceFileAccess.DeleteNativeTrustRecord(GetFilename(path));
    }

    private static string NormalizePath(string workDir) => Path.TrimEndingDirectorySeparator(Path.GetFullPath(workDir));
    private static string GetFilename(string path) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(OperatingSystem.IsWindows() ? path.ToUpperInvariant() : path))) + ".json";
}
