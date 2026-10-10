using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;
using App.MasterDataEditor;

if (!OperatingSystem.IsWindows())
{
    Console.WriteLine("SKIP 実HKCUへの信頼保存・復元はWindowsで確認してください");
    return;
}

if (args.Length == 3 && args[0] == "--restore-check")
{
    WorkspaceTrust.RestoreFromNativeStore(args[1]);
    if (WorkspaceTrust.IsTrusted(args[1]) != bool.Parse(args[2])) Environment.ExitCode = 1;
    return;
}

const string registryPath = @"Software\App.MasterDataEditor\TrustedWorkspaces";
var workDir = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.Combine(Path.GetTempPath(), "workspace-trust-registry-" + Guid.NewGuid().ToString("N"))));
var otherDir = workDir + "-other";
var valueName = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(workDir.ToUpperInvariant())));
var otherValueName = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(otherDir.ToUpperInvariant())));
using var key = Registry.CurrentUser.CreateSubKey(registryPath);
try
{
    WorkspaceTrust.GrantFromNativeUi(workDir);
    if (key.GetValue(valueName) is not string stored || !string.Equals(stored, workDir, StringComparison.OrdinalIgnoreCase) || key.GetValueKind(valueName) != RegistryValueKind.String)
        throw new Exception("ネイティブで許可したフォルダーがHKCUへ保存されていません");
    Console.WriteLine("PASS HKCUへ正規化パスを保存");
    CheckFreshProcess(workDir, true);
    Console.WriteLine("PASS 次回プロセスで保存済み信頼を復元");

    WorkspaceTrust.RestoreFromNativeStore(otherDir);
    if (WorkspaceTrust.IsTrusted(otherDir) || WorkspaceTrust.IsTrusted(workDir)) throw new Exception("別フォルダーが信頼済みになりました");
    WorkspaceTrust.RestoreFromNativeStore(workDir.ToUpperInvariant() + Path.DirectorySeparatorChar);
    if (!WorkspaceTrust.IsTrusted(workDir)) throw new Exception("大小文字と末尾区切り違いの同じフォルダーを復元できません");
    Console.WriteLine("PASS 同じフォルダーだけを復元");

    WorkspaceTrust.Revoke();
    if (key.GetValue(valueName) != null) throw new Exception("解除したフォルダーがHKCUに残っています");
    WorkspaceTrust.RestoreFromNativeStore(workDir);
    if (WorkspaceTrust.IsTrusted(workDir)) throw new Exception("解除した信頼が再び復元されました");
    CheckFreshProcess(workDir, false);
    Console.WriteLine("PASS 解除を保存し次回プロセスでも復元しない");

    foreach (var invalid in new (object Value, RegistryValueKind Kind)[] { (otherDir, RegistryValueKind.String), (1, RegistryValueKind.DWord), (workDir, RegistryValueKind.ExpandString) })
    {
        key.SetValue(valueName, invalid.Value, invalid.Kind);
        try { WorkspaceTrust.RestoreFromNativeStore(workDir); }
        catch (Exception error) when (error is FormatException or IOException or UnauthorizedAccessException) { }
        if (WorkspaceTrust.IsTrusted(workDir)) throw new Exception("不一致パスまたは不正なRegistry値型が信頼されました");
    }
    Console.WriteLine("PASS 不正な型とパスを信頼しない");
}
finally
{
    // この実行専用の値だけを削除し、ユーザーの既存の信頼設定には触れない。
    key.DeleteValue(valueName, false);
    key.DeleteValue(otherValueName, false);
}

static void CheckFreshProcess(string workDir, bool expected)
{
    var start = new ProcessStartInfo(Environment.ProcessPath ?? throw new InvalidOperationException("実行ファイルを取得できません")) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
    if (string.Equals(Path.GetFileNameWithoutExtension(start.FileName), "dotnet", StringComparison.OrdinalIgnoreCase)) start.ArgumentList.Add(typeof(WorkspaceTrust).Assembly.Location);
    start.ArgumentList.Add("--restore-check");
    start.ArgumentList.Add(workDir);
    start.ArgumentList.Add(expected.ToString());
    using var child = Process.Start(start) ?? throw new InvalidOperationException("復元確認プロセスを開始できません");
    var output = child.StandardOutput.ReadToEnd();
    var error = child.StandardError.ReadToEnd();
    child.WaitForExit();
    if (child.ExitCode != 0) throw new Exception("別プロセスの信頼復元結果が一致しません: " + output + error);
}
