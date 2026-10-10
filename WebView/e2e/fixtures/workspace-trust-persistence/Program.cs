using App.MasterDataEditor;

var workDir = Path.Combine(Path.GetTempPath(), "workspace-trust-persistence-" + Guid.NewGuid().ToString("N"));
var failures = new List<string>();
var checks = new (string Name, Action Check)[]
{
    ("保存済みの信頼を起動時に復元", () => {
        NativeWorkspaceTrustStore.TrustedPaths.Add(workDir);
        NativeWorkspaceTrustStore.FailGrant = true; // 復元が保存を再実行していないことも確認する。
        WorkspaceTrust.RestoreFromNativeStore(workDir);
        Require(WorkspaceTrust.IsTrusted(workDir), "保存済みフォルダーが未信頼です");
    }),
    ("ネイティブ許可を永続ストアへ保存", () => {
        WorkspaceTrust.GrantFromNativeUi(workDir);
        Require(NativeWorkspaceTrustStore.Read(workDir), "許可が保存されていません");
    }),
    ("正規化した同じフォルダーだけを復元", () => {
        NativeWorkspaceTrustStore.TrustedPaths.Add(workDir);
        WorkspaceTrust.RestoreFromNativeStore(Path.Combine(workDir, "."));
        Require(WorkspaceTrust.IsTrusted(workDir), "同じフォルダーを認識できません");
        Require(!WorkspaceTrust.IsTrusted(workDir + "-other") && !WorkspaceTrust.IsTrusted(Path.Combine(workDir, "child")), "別フォルダーへ信頼が継承されています");
    }),
    ("別フォルダーの起動で以前の実行中信頼を持ち越さない", () => {
        WorkspaceTrust.GrantFromNativeUi(workDir);
        WorkspaceTrust.RestoreFromNativeStore(workDir + "-other");
        Require(!WorkspaceTrust.IsTrusted(workDir) && !WorkspaceTrust.IsTrusted(workDir + "-other"), "別フォルダーの起動で古い信頼が残っています");
        Require(NativeWorkspaceTrustStore.Read(workDir), "別フォルダーの起動が保存済み信頼を消しました");
    }),
    ("解除を保存し次回復元しない", () => {
        WorkspaceTrust.GrantFromNativeUi(workDir);
        NativeWorkspaceTrustStore.TrustedPaths.Add(workDir);
        WorkspaceTrust.Revoke();
        Require(!NativeWorkspaceTrustStore.Read(workDir), "解除が保存されていません");
        WorkspaceTrust.RestoreFromNativeStore(workDir);
        Require(!WorkspaceTrust.IsTrusted(workDir), "解除した信頼が復元されました");
    }),
    ("保存失敗では信頼を付与しない", () => {
        NativeWorkspaceTrustStore.FailGrant = true;
        var rejected = false;
        try { WorkspaceTrust.GrantFromNativeUi(workDir); }
        catch (IOException) { rejected = true; }
        Require(rejected && !WorkspaceTrust.IsTrusted(workDir), "保存できていない信頼が付与されました");
    }),
    ("読込失敗では以前の実行中信頼も復元しない", () => {
        WorkspaceTrust.GrantFromNativeUi(workDir);
        NativeWorkspaceTrustStore.FailRead = true;
        var rejected = false;
        try { WorkspaceTrust.RestoreFromNativeStore(workDir); }
        catch (IOException) { rejected = true; }
        Require(rejected && !WorkspaceTrust.IsTrusted(workDir), "読込失敗が通知されないか古い信頼が残っています");
    }),
    ("削除失敗でも実行中の信頼を失効し次回の注意を通知", () => {
        WorkspaceTrust.GrantFromNativeUi(workDir);
        NativeWorkspaceTrustStore.TrustedPaths.Add(workDir);
        NativeWorkspaceTrustStore.FailRevoke = true;
        var generation = WorkspaceTrust.GetGeneration(workDir);
        var changes = 0;
        Action changed = () => changes++;
        WorkspaceTrust.Changed += changed;
        Exception? error = null;
        try { WorkspaceTrust.Revoke(); }
        catch (Exception exception) { error = exception; }
        finally { WorkspaceTrust.Changed -= changed; }
        Require(!WorkspaceTrust.IsTrusted(workDir) && changes == 1, "失敗時に信頼と実行中機能が失効しません");
        var rejected = false;
        try { WorkspaceTrust.ExecuteTrusted(workDir, generation, () => true); }
        catch (UnauthorizedAccessException) { rejected = true; }
        Require(rejected, "削除失敗時に古い世代の実行が許可されました");
        Require(error != null && error.Message.Contains("次回"), "次回起動で復元し得ることが通知されません");
        Require(NativeWorkspaceTrustStore.Read(workDir), "削除失敗の保存状態が再現されていません");
    }),
    ("解除と再信頼で古い世代を拒否", () => {
        WorkspaceTrust.GrantFromNativeUi(workDir);
        var generation = WorkspaceTrust.GetGeneration(workDir);
        WorkspaceTrust.Revoke();
        WorkspaceTrust.GrantFromNativeUi(workDir);
        var rejected = false;
        try { WorkspaceTrust.ExecuteTrusted(workDir, generation, () => true); }
        catch (UnauthorizedAccessException) { rejected = true; }
        Require(rejected, "古い世代の実行が許可されました");
    }),
};
foreach (var (name, check) in checks)
{
    Reset();
    try { check(); Console.WriteLine("PASS " + name); }
    catch (Exception error) { failures.Add(name + ": " + error.Message); Console.Error.WriteLine("FAIL " + name + ": " + error.Message); }
}
Reset();
if (failures.Count > 0) Environment.ExitCode = 1;

static void Reset()
{
    NativeWorkspaceTrustStore.FailRead = NativeWorkspaceTrustStore.FailGrant = NativeWorkspaceTrustStore.FailRevoke = false;
    WorkspaceTrust.Revoke();
    NativeWorkspaceTrustStore.TrustedPaths.Clear();
}

static void Require(bool value, string message)
{
    if (!value) throw new Exception(message);
}
