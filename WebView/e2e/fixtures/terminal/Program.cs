using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using System.Text.Json;
using System.Threading.Channels;
using App.MasterDataEditor.Terminal;

await TerminalOutputFlowChecks.RunAsync();
await TerminalHostChecks.RunAsync();

// NuGet や WPF に依存せず、Windows 10 1809 以降の実 ConPTY を検証する。
if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 17763))
{
    Console.WriteLine("SKIP: ConPTY の実機テストには Windows 10 1809 以降が必要です。");
    return;
}

var workingDirectory = Path.Combine(Path.GetTempPath(), "master-data-terminal-日本語-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(workingDirectory);
try
{
    foreach (var dimensions in new[] { (0, 24), (80, 0), (-1, 24), (32768, 24) })
    {
        try
        {
            using var invalid = ConPtySession.Start(workingDirectory, dimensions.Item1, dimensions.Item2, _ => Task.CompletedTask);
            throw new Exception("不正な行数・列数で開始できてしまいました。");
        }
        catch (ArgumentOutOfRangeException) { }
    }

    var output = new TerminalOutput();
    using (var session = ConPtySession.Start(workingDirectory, 160, 30, output.AppendAsync))
    {
        session.WriteInput("Write-Output ('READY_' + 'OK')\r");
        await output.WaitForAsync("READY_OK");

        session.WriteInput("Write-Output ('CWD=' + (Get-Location).Path)\r");
        await output.WaitForAsync("CWD=" + workingDirectory);

        session.WriteInput("Write-Output ([char]0x65e5 + [string][char]0x672c + [char]0x8a9e); [Console]::Write(([char]27 + '[31m') + ('ANSI_' + 'OK') + ([char]27 + '[0m'))\r");
        await output.WaitForAsync("日本語");
        await output.WaitForAsync("\u001b[31m");
        await output.WaitForAsync("ANSI_OK");

        // enqueue の順序を別々の入力イベントで保ち、最後の出力まで確認する。
        session.WriteInput("Write-Output ('ORDER_' + 'ONE')\r");
        session.WriteInput("Write-Output ('ORDER_' + 'TWO')\r");
        session.WriteInput("Write-Output ('ORDER_' + 'THREE')\r");
        await output.WaitForAsync("ORDER_THREE");
        output.AssertInOrder("ORDER_ONE", "ORDER_TWO", "ORDER_THREE");

        session.Resize(120, 40);
        session.WriteInput("Write-Output ('SIZE=' + [Console]::WindowWidth + 'x' + [Console]::WindowHeight)\r");
        await output.WaitForAsync("SIZE=120x40");

        // 複数の読み取りチャンクにまたがる UTF-8 と、大量出力中の終了を検証する。
        session.WriteInput("1..500 | ForEach-Object { Write-Output (([string][char]0x65e5 + [char]::ConvertFromUtf32(0x1f680)) * 40) }; Write-Output ('BULK_' + 'DONE')\r");
        await output.WaitForAsync("BULK_DONE");
        output.AssertNoReplacementCharacter();
        session.WriteInput("exit 7\r");
        var exitCode = await session.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(20));
        if (exitCode != 7) throw new Exception($"終了コードが失われました: {exitCode}");
    }

    var childOutput = new TerminalOutput();
    using (var session = ConPtySession.Start(workingDirectory, 100, 30, childOutput.AppendAsync))
    {
        session.WriteInput("$s = New-Object System.Diagnostics.ProcessStartInfo; $s.FileName = $PSHOME + '\\powershell.exe'; $s.Arguments = '-NoLogo -NoProfile -Command Start-Sleep -Seconds 300'; $s.UseShellExecute = $false; $s.CreateNoWindow = $true; $p = [System.Diagnostics.Process]::Start($s); Write-Output ('CHILD=' + $p.Id)\r");
        var childId = await childOutput.WaitForProcessIdAsync();
        using var child = Process.GetProcessById(childId);
        // Dispose はコマンド完了を待たず、Job に属する子プロセスも終了する。
        session.WriteInput("while ($true) { Write-Output ('BUSY_' + 'OUTPUT') }\r");
        await childOutput.WaitForAsync("BUSY_OUTPUT");
        await Task.Run(session.Dispose).WaitAsync(TimeSpan.FromSeconds(20));
        if (!child.WaitForExit(5000)) throw new Exception("ターミナルを停止しても子プロセスが残っています。");
    }

    // 終了後も新しいターミナルを開始でき、同じセッションを繰り返し破棄できる。
    using (var restarted = ConPtySession.Start(workingDirectory, 80, 24, _ => Task.CompletedTask))
    {
        await Task.Run(restarted.Dispose).WaitAsync(TimeSpan.FromSeconds(20));
        restarted.Dispose();
    }

    // ページ終了などで画面の ACK が来ない場合も、取消後は pipe を drain して終了する。
    var pendingOutput = Channel.CreateUnbounded<JsonElement>();
    using (var flow = new TerminalOutputFlow("unacknowledged", (message, token) => pendingOutput.Writer.WriteAsync(JsonSerializer.SerializeToElement(message), token).AsTask(), CancellationToken.None))
    using (var stalled = ConPtySession.Start(workingDirectory, 80, 24, flow.SendAsync))
    {
        stalled.WriteInput("Write-Output ('PENDING_' + 'ACK')\r");
        await pendingOutput.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(20));
        flow.Stop();
        await Task.Run(stalled.Dispose).WaitAsync(TimeSpan.FromSeconds(20));
    }
    Console.WriteLine("PASS: ConPTY 開始・作業フォルダー・日本語/ANSI・入力順序・リサイズ・終了コード・大量出力・子プロセス停止・再起動・未 ACK 出力中の終了");
}
finally
{
    Directory.Delete(workingDirectory, true);
}

internal sealed class TerminalOutput
{
    private readonly StringBuilder _text = new();
    private readonly object _sync = new();

    public Task AppendAsync(string value)
    {
        for (var index = 0; index < value.Length; index++)
        {
            if (char.IsHighSurrogate(value[index]))
            {
                if (++index == value.Length || !char.IsLowSurrogate(value[index])) throw new Exception("通知の境界で絵文字が分断されました。");
            }
            else if (char.IsLowSurrogate(value[index])) throw new Exception("通知に単独の下位サロゲートが含まれています。");
        }
        lock (_sync) _text.Append(value);
        return Task.CompletedTask;
    }

    public async Task WaitForAsync(string expected)
    {
        var timeout = Stopwatch.StartNew();
        while (timeout.Elapsed < TimeSpan.FromSeconds(30))
        {
            lock (_sync)
            {
                if (_text.ToString().Contains(expected, StringComparison.Ordinal)) return;
            }
            await Task.Delay(50);
        }
        throw new Exception($"ターミナルから期待した出力を受信できません: {expected}");
    }

    public async Task<int> WaitForProcessIdAsync()
    {
        var timeout = Stopwatch.StartNew();
        while (timeout.Elapsed < TimeSpan.FromSeconds(30))
        {
            lock (_sync)
            {
                var match = Regex.Match(_text.ToString(), @"CHILD=(\d+)");
                if (match.Success) return int.Parse(match.Groups[1].Value);
            }
            await Task.Delay(50);
        }
        throw new Exception("子プロセスの ID が出力されませんでした。");
    }

    public void AssertInOrder(params string[] expected)
    {
        lock (_sync)
        {
            var text = _text.ToString();
            var position = 0;
            foreach (var part in expected)
            {
                var index = text.IndexOf(part, position, StringComparison.Ordinal);
                if (index < 0) throw new Exception($"入力順序が保たれていません: {part}");
                position = index + part.Length;
            }
        }
    }

    public void AssertNoReplacementCharacter()
    {
        lock (_sync)
        {
            if (_text.ToString().Contains('\ufffd')) throw new Exception("UTF-8 のデコードで置換文字が発生しました。");
        }
    }
}
