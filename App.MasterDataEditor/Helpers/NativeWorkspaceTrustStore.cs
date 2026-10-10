using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

namespace App.MasterDataEditor;

/// <summary>ファイルAPIから到達できない、現在のWindowsユーザー専用の信頼保存先。</summary>
internal static class NativeWorkspaceTrustStore
{
    private const string RegistryPath = @"Software\App.MasterDataEditor\TrustedWorkspaces";

    public static bool Read(string workDir)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("作業フォルダーの信頼保存はWindows専用です。");
        var path = NormalizePath(workDir);
        using var key = Registry.CurrentUser.OpenSubKey(RegistryPath, false);
        if (key == null) return false;
        var valueName = GetValueName(path);
        var value = key.GetValue(valueName, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
        if (value == null) return false;
        if (key.GetValueKind(valueName) != RegistryValueKind.String || value is not string stored || !string.Equals(stored, path, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("保存された作業フォルダーの信頼情報が不正です。制限モードで起動します。");
        return true;
    }

    public static void Grant(string workDir)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("作業フォルダーの信頼保存はWindows専用です。");
        var path = NormalizePath(workDir);
        using var key = Registry.CurrentUser.CreateSubKey(RegistryPath);
        key.SetValue(GetValueName(path), path, RegistryValueKind.String);
    }

    public static void Revoke(string workDir)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("作業フォルダーの信頼保存はWindows専用です。");
        var path = NormalizePath(workDir);
        using var key = Registry.CurrentUser.OpenSubKey(RegistryPath, true);
        if (key == null) return;
        key.DeleteValue(GetValueName(path), false);
    }

    private static string NormalizePath(string workDir) => Path.TrimEndingDirectorySeparator(Path.GetFullPath(workDir));
    private static string GetValueName(string path) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(path.ToUpperInvariant())));
}
