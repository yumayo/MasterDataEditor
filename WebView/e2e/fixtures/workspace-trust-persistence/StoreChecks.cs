using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using App.MasterDataEditor;

var workDir = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.Combine(Path.GetTempPath(), "trust-store-" + Guid.NewGuid().ToString("N"))));
var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
var keyPath = OperatingSystem.IsWindows() ? workDir.ToUpperInvariant() : workDir;
var filename = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(keyPath))) + ".json";
var failures = 0;
Run("許可をフォルダーごとのJSONへ保存し完全一致したパスを復元", () => {
    NativeWorkspaceTrustStore.Grant(workDir);
    Require(WorkspaceFileAccess.Records.Count == 1 && WorkspaceFileAccess.Records.ContainsKey(filename), "パスのSHA256名のファイルへ保存されません");
    using var record = JsonDocument.Parse(WorkspaceFileAccess.Records[filename]);
    Require(record.RootElement.GetProperty("version").GetInt32() == 1 && string.Equals(record.RootElement.GetProperty("path").GetString(), workDir, comparison), "保存形式またはパスが一致しません");
    Require(NativeWorkspaceTrustStore.Read(Path.Combine(workDir, ".")), "同じフォルダーの信頼を復元できません");
    Require(!NativeWorkspaceTrustStore.Read(workDir + "-other"), "別フォルダーに信頼が引き継がれました");
});
Run("解除で該当フォルダーの保存ファイルを削除", () => {
    NativeWorkspaceTrustStore.Grant(workDir);
    NativeWorkspaceTrustStore.Revoke(workDir);
    Require(WorkspaceFileAccess.Records.Count == 0 && !NativeWorkspaceTrustStore.Read(workDir), "解除した信頼がファイルに残っています");
});
Run("一方のフォルダーを解除しても別フォルダーの信頼を残す", () => {
    NativeWorkspaceTrustStore.Grant(workDir);
    NativeWorkspaceTrustStore.Grant(workDir + "-other");
    NativeWorkspaceTrustStore.Revoke(workDir);
    Require(!NativeWorkspaceTrustStore.Read(workDir) && NativeWorkspaceTrustStore.Read(workDir + "-other") && WorkspaceFileAccess.Records.Count == 1, "他のフォルダーの信頼が失われました");
});
Run("不正JSON・型・バージョン・不一致パスは復元しない", () => {
    foreach (var invalid in new[] { "", "broken", "{}", "[]", "null", "{\"version\":999999999999999999999999999999,\"path\":\"wrong\"}", "{\"version\":\"1\",\"path\":\"wrong\"}", "{\"version\":2,\"path\":\"wrong\"}", JsonSerializer.Serialize(new {version = 1, path = workDir + "-other"}), JsonSerializer.Serialize(new {version = 1, path = 1}) })
    {
        WorkspaceFileAccess.Records[filename] = invalid;
        var rejected = false;
        try { NativeWorkspaceTrustStore.Read(workDir); }
        catch (InvalidDataException) { rejected = true; }
        Require(rejected, "不正な保存値がエラーとして通知されません");
    }
});
Environment.ExitCode = failures == 0 ? 0 : 1;

void Run(string name, Action check)
{
    WorkspaceFileAccess.Records.Clear();
    try { check(); Console.WriteLine("PASS " + name); }
    catch (Exception error) { failures++; Console.Error.WriteLine("FAIL " + name + ": " + error.Message); }
}
static void Require(bool value, string message) { if (!value) throw new Exception(message); }
