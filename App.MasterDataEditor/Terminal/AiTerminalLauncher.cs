using System;
using System.IO;
using System.Text;

namespace App.MasterDataEditor.Terminal;

/// <summary>AI 専用端末の固定配置と PowerShell の起動契約を所有する。</summary>
internal sealed class AiTerminalLauncher
{
    private readonly string _repositoryDirectory;

    public AiTerminalLauncher(string repositoryDirectory)
    {
        _repositoryDirectory = Path.GetFullPath(repositoryDirectory);
    }

    public bool IsInstalled()
    {
        return Directory.Exists(Path.Combine(_repositoryDirectory, ".git")) && File.Exists(Path.Combine(_repositoryDirectory, "start-wsl-containers.ps1"));
    }

    public string CreateArguments(string workspace, bool install)
    {
        var shell = Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");
        var script = Path.Combine(_repositoryDirectory, "start-wsl-containers.ps1");
        // PowerShell 5 の native argument 再構築に任せず、空白＋末尾区切りも Windows 引数として引用する。
        var childArguments = "-NoProfile -ExecutionPolicy Bypass -File " + QuoteWindowsArgument(script) + " -Workspace " + QuoteWindowsArgument(workspace) + " -Tool claude";
        var bootstrap = $$"""
            $ErrorActionPreference = 'Stop'
            $repository = {{QuotePowerShellLiteral(_repositoryDirectory)}}
            $script = {{QuotePowerShellLiteral(script)}}
            try {
                if (-not (Test-Path -LiteralPath (Join-Path $repository '.git') -PathType Container)) {
                    if (-not {{(install ? "$true" : "$false")}}) { throw 'AI is not installed. Select Install to download ai-container.' }
                    if (Test-Path -LiteralPath $repository) { throw 'The AI installation directory already exists but is not a Git clone. Move it before retrying.' }
                    [IO.Directory]::CreateDirectory((Split-Path -Parent $repository)) | Out-Null
                    $staging = $repository + '.clone-' + [Guid]::NewGuid().ToString('N')
                    try {
                        & git clone -- 'https://github.com/yumayo/ai-container.git' $staging
                        if ($LASTEXITCODE -ne 0) { throw ('git clone failed with exit code ' + $LASTEXITCODE) }
                        [IO.Directory]::Move($staging, $repository)
                    } finally {
                        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
                    }
                }
                if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw 'start-wsl-containers.ps1 is missing from the existing clone. Check the AI installation directory.' }
                $startInfo = New-Object System.Diagnostics.ProcessStartInfo
                $startInfo.FileName = {{QuotePowerShellLiteral(shell)}}
                $startInfo.Arguments = {{QuotePowerShellLiteral(childArguments)}}
                $startInfo.WorkingDirectory = $repository
                $startInfo.UseShellExecute = $false
                $process = [System.Diagnostics.Process]::Start($startInfo)
                $process.WaitForExit()
                $exitCode = $process.ExitCode
                $process.Dispose()
                exit $exitCode
            } catch {
                Write-Error -ErrorRecord $_ -ErrorAction Continue
                exit 1
            }
            """;
        return "-NoProfile -ExecutionPolicy Bypass -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(bootstrap));
    }

    private static string QuotePowerShellLiteral(string value)
    {
        return "'" + value.Replace("'", "''", StringComparison.Ordinal) + "'";
    }

    private static string QuoteWindowsArgument(string value)
    {
        var quoted = new StringBuilder("\"");
        var backslashes = 0;
        foreach (var character in value)
        {
            if (character == '\\') { backslashes++; continue; }
            quoted.Append('\\', character == '\"' ? backslashes * 2 + 1 : backslashes);
            quoted.Append(character);
            backslashes = 0;
        }
        quoted.Append('\\', backslashes * 2);
        return quoted.Append('\"').ToString();
    }
}
