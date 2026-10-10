using System.Diagnostics;
using App.MasterDataEditor;

var workDir = Path.Combine(Path.GetTempPath(), "workspace-trust-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(Path.Combine(workDir, "hooks"));
try
{
    WorkspaceTrust.Revoke();
    if (WorkspaceTrust.IsTrusted(workDir)) throw new Exception("未確認の作業フォルダーが信頼されています");
    WorkspaceTrust.GrantFromNativeUi(workDir);
    if (!WorkspaceTrust.IsTrusted(workDir) || WorkspaceTrust.IsTrusted(workDir + "-other")) throw new Exception("信頼の範囲が不正です");
    var oldGeneration = WorkspaceTrust.GetGeneration(workDir);
    WorkspaceTrust.Revoke();
    WorkspaceTrust.GrantFromNativeUi(workDir);
    try { WorkspaceTrust.ExecuteTrusted(workDir, oldGeneration, () => true); throw new Exception("古い信頼で実行できました"); }
    catch (UnauthorizedAccessException) { }
    WorkspaceTrust.Revoke();
    Console.WriteLine("PASS: 既定拒否・作業フォルダー完全一致・解除と再信頼で旧世代無効");

    await File.WriteAllTextAsync(Path.Combine(workDir, "hooks", "after-save.sh"), "printf executed > hook-marker\n");
    AfterSaveHookRunner.StartIfExists(workDir, "data/test.csv");
    await Task.Delay(300);
    if (File.Exists(Path.Combine(workDir, "hook-marker"))) throw new Exception("未信頼の保存でフックが実行されました");
    Console.WriteLine("PASS: 未信頼の通常保存では実フックを実行しない");

    try
    {
        using var bash = Process.Start(new ProcessStartInfo("bash", "--version") {UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true});
        if (bash == null) throw new Exception("bashの起動に失敗");
        await bash.WaitForExitAsync();
    }
    catch (System.ComponentModel.Win32Exception)
    {
        Console.WriteLine("SKIP: bashがないため信頼済み実フックの対照実験を省略");
        return;
    }
    WorkspaceTrust.GrantFromNativeUi(workDir);
    AfterSaveHookRunner.StartIfExists(workDir, "data/test.csv");
    var deadline = Stopwatch.StartNew();
    while (!File.Exists(Path.Combine(workDir, "hook-marker")) && deadline.Elapsed < TimeSpan.FromSeconds(5)) await Task.Delay(25);
    if (!File.Exists(Path.Combine(workDir, "hook-marker"))) throw new Exception("信頼済みの保存フックが実行されません");
    WorkspaceTrust.Revoke();
    Console.WriteLine("PASS: 明示信頼後のみ実フックが実行される");
}
finally { WorkspaceTrust.Revoke(); Directory.Delete(workDir, true); }

namespace App.MasterDataEditor
{
    internal static class Logger
    {
        public static void Info(string message) => Console.WriteLine(message);
        public static void Warning(string message) => Console.Error.WriteLine(message);
        public static void Error(Exception error, string message) => Console.Error.WriteLine(message + ": " + error);
    }
}
