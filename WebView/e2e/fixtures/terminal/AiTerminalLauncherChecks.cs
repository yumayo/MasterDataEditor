using System.Diagnostics;
using System.Text;
using App.MasterDataEditor.Terminal;

internal static class AiTerminalLauncherChecks
{
    public static async Task RunAsync()
    {
        var root = Path.Combine(Path.GetTempPath(), "ai-terminal-日本語 ' $ -" + Guid.NewGuid().ToString("N"));
        var repository = Path.Combine(root, "ai-container");
        Directory.CreateDirectory(root);
        try
        {
            var launcher = new AiTerminalLauncher(repository);
            if (launcher.IsInstalled()) throw new Exception("存在しない clone を導入済みとして扱いました。");
            Directory.CreateDirectory(repository);
            if (launcher.IsInstalled()) throw new Exception("空フォルダーを導入済みとして扱いました。");
            var script = Path.Combine(repository, "start-wsl-containers.ps1");
            await File.WriteAllTextAsync(script, "param([string]$Workspace, [string]$Tool)\n[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'received.txt'), ($Workspace + [Environment]::NewLine + $Tool))\nexit 7", new UTF8Encoding(true));
            if (launcher.IsInstalled()) throw new Exception("Git clone ではないフォルダーを導入済みとして扱いました。");
            Directory.CreateDirectory(Path.Combine(repository, ".git"));
            await File.WriteAllTextAsync(Path.Combine(repository, ".git", "config"), "[remote \"origin\"]\n\turl = https://github.com/yumayo/ai-container.git\n");
            if (!launcher.IsInstalled()) throw new Exception("既存 clone とスクリプトを認識しません。");
            File.Delete(script);
            if (launcher.IsInstalled()) throw new Exception("起動スクリプト欠落を導入済みとして扱いました。");
            await File.WriteAllTextAsync(script, "param([string]$Workspace, [string]$Tool)\n[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'received.txt'), ($Workspace + [Environment]::NewLine + $Tool))\nexit 7", new UTF8Encoding(true));

            var workspace = Path.Combine(root, "作業 '$() & ; workspace");
            Directory.CreateDirectory(workspace);
            const string prefix = "-NoProfile -ExecutionPolicy Bypass -EncodedCommand ";
            foreach (var tool in new[] { "claude", "codex" })
            {
                var arguments = launcher.CreateArguments(workspace, true, tool);
                if (!arguments.StartsWith(prefix, StringComparison.Ordinal)) throw new Exception("AI の起動は PowerShell の非対話スクリプト引数でなければなりません。");
                var bootstrap = Encoding.Unicode.GetString(Convert.FromBase64String(arguments[prefix.Length..]));
                if (!bootstrap.Contains("https://github.com/yumayo/ai-container.git", StringComparison.Ordinal)) throw new Exception("指定の clone 元が失われました。");
                if (!bootstrap.Contains("-NoProfile -ExecutionPolicy Bypass -File", StringComparison.Ordinal) || !bootstrap.Contains("-Tool " + tool, StringComparison.Ordinal)) throw new Exception("選択した AI の起動契約が失われました。");
            }
            foreach (var tool in new[] { "", "unknown", "Claude", "CODEX", "codex ", " claude", "claude; Write-Output injected" })
            {
                try
                {
                    launcher.CreateArguments(workspace, true, tool);
                    throw new Exception("許可されていない tool から起動引数が生成されました。");
                }
                catch (ArgumentException) { }
            }
            Console.WriteLine("PASS: AI 未導入・空フォルダー・clone とスクリプトの導入判定・両ツールの PowerShell 起動契約・不正 tool 拒否");

            if (!OperatingSystem.IsWindows())
            {
                Console.WriteLine("SKIP: AI の実 PowerShell 引数受け渡し・既存 clone 再利用・終了コード確認には Windows が必要です。");
                return;
            }
            foreach (var tool in new[] { "claude", "codex" })
            foreach (var install in new[] { true, false })
            foreach (var suppliedWorkspace in new[] { workspace, workspace + Path.DirectorySeparatorChar })
            {
                var shell = Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");
                using var process = Process.Start(new ProcessStartInfo(shell, launcher.CreateArguments(suppliedWorkspace, install, tool)) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = root }) ?? throw new Exception("PowerShell を開始できません。");
                await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(30));
                if (process.ExitCode != 7) throw new Exception("既存 clone を再利用しないか、スクリプトの終了コードが失われました。");
                var received = await File.ReadAllLinesAsync(Path.Combine(repository, "received.txt"));
                if (received.Length != 2 || received[0] != suppliedWorkspace || received[1] != tool) throw new Exception("Workspace または Tool が引数として安全に渡されていません。");
            }
            Console.WriteLine("PASS: 既存 clone 再利用・日本語と引用符を含む Workspace 受け渡し・Claude / Codex の引数受信・終了コード伝播");
        }
        finally { Directory.Delete(root, true); }
    }
}
