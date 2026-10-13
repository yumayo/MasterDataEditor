using System;
using System.Collections.Concurrent;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace App.MasterDataEditor.Terminal;

/// <summary>ConPTY と PowerShell の所有者。ウィンドウの表示状態とプロセス寿命を分離する。</summary>
internal sealed class ConPtySession : IDisposable
{
    private const int MaximumPendingInputBytes = 1024 * 1024;
    private readonly IntPtr _pseudoConsole;
    private readonly SafeFileHandle _job;
    private readonly SafeFileHandle _process;
    private readonly FileStream _input;
    private readonly FileStream _output;
    private readonly BlockingCollection<byte[]> _inputQueue = new();
    private readonly ConcurrentQueue<Exception> _errors = new();
    private readonly object _nativeLock = new();
    private readonly Task _readTask;
    private readonly Task _writeTask;
    private readonly Task<int> _completion;
    private int _stopping;
    private int _pendingInputBytes;

    private ConPtySession(IntPtr pseudoConsole, SafeFileHandle job, SafeFileHandle process, FileStream input, FileStream output, Func<string, Task> onOutput)
    {
        _pseudoConsole = pseudoConsole;
        _job = job;
        _process = process;
        _input = input;
        _output = output;

        // CreatePipe は同期ハンドル。読み書きを専用スレッドに分け、UI や制御要求を塞がない。
        _readTask = Task.Factory.StartNew(() =>
        {
            var deliverOutput = true;
            try
            {
                var encoding = new UTF8Encoding(false);
                var decoder = encoding.GetDecoder();
                var bytes = new byte[8192];
                var buffer = new char[encoding.GetMaxCharCount(bytes.Length)];
                while (true)
                {
                    // 1 回の pipe read ごとに通知する。文字バッファを満たすまで次の入力を待たない。
                    var byteCount = _output.Read(bytes, 0, bytes.Length);
                    var count = decoder.GetChars(bytes, 0, byteCount, buffer, 0, byteCount == 0);
                    if (byteCount == 0 && count == 0) break;
                    if (!deliverOutput || count == 0) continue;
                    try
                    {
                        // xterm の処理完了 ACK まで待ち、ホストと画面に未処理出力を無制限に積まない。
                        // 十分な char バッファを渡す Decoder は絵文字もペア単位で返す。
                        onOutput(new string(buffer, 0, count)).GetAwaiter().GetResult();
                    }
                    catch (Exception error)
                    {
                        _errors.Enqueue(error);
                        deliverOutput = false;
                        RequestStop();
                        // ClosePseudoConsole は出力を flush するため、通知失敗後も読み捨てる。
                    }
                }
            }
            catch (IOException error) when (Volatile.Read(ref _stopping) != 0 || (error.HResult & 0xffff) == 109) { }
            catch (Exception error)
            {
                _errors.Enqueue(error);
                RequestStop();
            }
            finally
            {
                // 読み取り不能な pipe を先に閉じ、ClosePseudoConsole の flush 待ちを解除する。
                DisposePipe(_output);
                RequestStop();
            }
        }, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);

        _writeTask = Task.Factory.StartNew(() =>
        {
            try
            {
                foreach (var bytes in _inputQueue.GetConsumingEnumerable())
                {
                    if (Volatile.Read(ref _stopping) != 0) break;
                    try
                    {
                        _input.Write(bytes, 0, bytes.Length);
                        _input.Flush();
                    }
                    finally { Interlocked.Add(ref _pendingInputBytes, -bytes.Length); }
                }
            }
            catch (IOException) when (Volatile.Read(ref _stopping) != 0) { }
            catch (Exception error)
            {
                _errors.Enqueue(error);
                RequestStop();
            }
            finally { DisposePipe(_input); }
        }, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);

        _completion = Task.Factory.StartNew(() =>
        {
            var exitCode = 1u;
            try
            {
                if (ConPtyNative.WaitForSingleObject(_process, ConPtyNative.Infinite) == ConPtyNative.WaitFailed) throw new Win32Exception(Marshal.GetLastWin32Error());
                if (!ConPtyNative.GetExitCodeProcess(_process, out exitCode)) throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            catch (Exception error) { _errors.Enqueue(error); }
            finally
            {
                RequestStop();
                try
                {
                    // RequestStop が Resize を禁止してから閉じる。reader は flush 完了まで維持する。
                    ConPtyNative.ClosePseudoConsole(_pseudoConsole);
                    Task.WaitAll(_readTask, _writeTask);
                }
                catch (Exception error) { _errors.Enqueue(error); }
                finally
                {
                    // 読み書きの失敗でも、プロセスと Job のハンドルを必ず回収する。
                    lock (_nativeLock)
                    {
                        _process.Dispose();
                        _job.Dispose();
                    }
                    _inputQueue.Dispose();
                }
            }
            if (!_errors.IsEmpty) throw new AggregateException("ターミナルの入出力処理に失敗しました。", _errors);
            return unchecked((int)exitCode);
        }, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
    }

    public static ConPtySession Start(string workingDirectory, int columns, int rows, Func<string, Task> onOutput)
    {
        return StartCommand(workingDirectory, "-NoLogo", columns, rows, onOutput);
    }

    public static ConPtySession StartCommand(string workingDirectory, string arguments, int columns, int rows, Func<string, Task> onOutput)
    {
        ValidateDimensions(columns, rows);
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 17763)) throw new PlatformNotSupportedException("ターミナルには Windows 10 バージョン 1809 以降が必要です。");
        if (!Directory.Exists(workingDirectory)) throw new DirectoryNotFoundException($"作業フォルダーが存在しません: {workingDirectory}");
        ArgumentNullException.ThrowIfNull(onOutput);

        SafeFileHandle? inputRead = null;
        SafeFileHandle? inputWrite = null;
        SafeFileHandle? outputRead = null;
        SafeFileHandle? outputWrite = null;
        SafeFileHandle? process = null;
        SafeFileHandle? thread = null;
        SafeFileHandle? job = null;
        FileStream? input = null;
        FileStream? output = null;
        var pseudoConsole = IntPtr.Zero;
        var attributes = IntPtr.Zero;
        var attributesInitialized = false;
        var transferred = false;
        try
        {
            if (!ConPtyNative.CreatePipe(out inputRead, out inputWrite, IntPtr.Zero, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (!ConPtyNative.CreatePipe(out outputRead, out outputWrite, IntPtr.Zero, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
            Marshal.ThrowExceptionForHR(ConPtyNative.CreatePseudoConsole(new ConPtyNative.Coord { X = (short)columns, Y = (short)rows }, inputRead, outputWrite, 0, out pseudoConsole));

            var attributeBytes = IntPtr.Zero;
            ConPtyNative.InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeBytes);
            attributes = Marshal.AllocHGlobal(attributeBytes);
            if (!ConPtyNative.InitializeProcThreadAttributeList(attributes, 1, 0, ref attributeBytes)) throw new Win32Exception(Marshal.GetLastWin32Error());
            attributesInitialized = true;
            if (!ConPtyNative.UpdateProcThreadAttribute(attributes, 0, ConPtyNative.PseudoConsoleAttribute, pseudoConsole, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());

            job = ConPtyNative.CreateJobObject(IntPtr.Zero, IntPtr.Zero);
            if (job.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            var limits = new ConPtyNative.JobExtendedLimitInformation
            {
                BasicLimitInformation = new ConPtyNative.JobBasicLimitInformation { LimitFlags = ConPtyNative.JobObjectLimitKillOnJobClose }
            };
            if (!ConPtyNative.SetInformationJobObject(job, ConPtyNative.JobObjectExtendedLimitInformation, ref limits, (uint)Marshal.SizeOf<ConPtyNative.JobExtendedLimitInformation>())) throw new Win32Exception(Marshal.GetLastWin32Error());

            var shell = Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");
            var startup = new ConPtyNative.StartupInfoEx
            {
                StartupInfo = new ConPtyNative.StartupInfo { Size = (uint)Marshal.SizeOf<ConPtyNative.StartupInfoEx>() },
                AttributeList = attributes
            };
            // 実行開始前に Job へ所属させ、開始直後に作られた子プロセスも確実に回収する。
            if (!ConPtyNative.CreateProcess(shell, new StringBuilder($"\"{shell}\" {arguments}"), IntPtr.Zero, IntPtr.Zero, false, ConPtyNative.ExtendedStartupInfoPresent | ConPtyNative.CreateSuspended, IntPtr.Zero, workingDirectory, ref startup, out var information)) throw new Win32Exception(Marshal.GetLastWin32Error());
            process = new SafeFileHandle(information.Process, true);
            thread = new SafeFileHandle(information.Thread, true);
            if (!ConPtyNative.AssignProcessToJobObject(job, process)) throw new Win32Exception(Marshal.GetLastWin32Error());

            input = new FileStream(inputWrite, FileAccess.Write, 1, false);
            output = new FileStream(outputRead, FileAccess.Read, 8192, false);
            if (ConPtyNative.ResumeThread(thread) == uint.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error());
            var session = new ConPtySession(pseudoConsole, job, process, input, output, onOutput);
            transferred = true;
            return session;
        }
        finally
        {
            if (attributesInitialized) ConPtyNative.DeleteProcThreadAttributeList(attributes);
            if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
            thread?.Dispose();
            inputRead?.Dispose();
            outputWrite?.Dispose();
            if (!transferred)
            {
                if (process is { IsInvalid: false }) ConPtyNative.TerminateProcess(process, 1);
                // reader がない起動失敗経路では出力 pipe を先に閉じる。
                input?.Dispose();
                output?.Dispose();
                inputWrite?.Dispose();
                outputRead?.Dispose();
                if (pseudoConsole != IntPtr.Zero) ConPtyNative.ClosePseudoConsole(pseudoConsole);
                process?.Dispose();
                job?.Dispose();
            }
        }
    }

    public void WriteInput(string data)
    {
        if (Volatile.Read(ref _stopping) != 0) throw new InvalidOperationException("ターミナルは終了しています。");
        var bytes = Encoding.UTF8.GetBytes(data);
        if (bytes.Length == 0) return;
        if (Interlocked.Add(ref _pendingInputBytes, bytes.Length) > MaximumPendingInputBytes)
        {
            Interlocked.Add(ref _pendingInputBytes, -bytes.Length);
            throw new InvalidOperationException("ターミナルの入力が混み合っています。貼り付ける文字数を減らしてください。");
        }
        try { _inputQueue.Add(bytes); }
        catch
        {
            Interlocked.Add(ref _pendingInputBytes, -bytes.Length);
            throw;
        }
    }

    public void Resize(int columns, int rows)
    {
        ValidateDimensions(columns, rows);
        lock (_nativeLock)
        {
            if (Volatile.Read(ref _stopping) != 0) throw new InvalidOperationException("ターミナルは終了しています。");
            Marshal.ThrowExceptionForHR(ConPtyNative.ResizePseudoConsole(_pseudoConsole, new ConPtyNative.Coord { X = (short)columns, Y = (short)rows }));
        }
    }

    public Task<int> WaitForExitAsync() => _completion;

    public void Dispose()
    {
        RequestStop();
        _completion.GetAwaiter().GetResult();
    }

    private void DisposePipe(FileStream pipe)
    {
        try { pipe.Dispose(); }
        catch (IOException) when (Volatile.Read(ref _stopping) != 0) { }
        catch (Exception error) { _errors.Enqueue(error); }
    }

    private void RequestStop()
    {
        lock (_nativeLock)
        {
            if (Interlocked.Exchange(ref _stopping, 1) != 0) return;
            _inputQueue.CompleteAdding();
            if (!ConPtyNative.TerminateJobObject(_job, 1)) _errors.Enqueue(new Win32Exception(Marshal.GetLastWin32Error()));
        }
    }

    private static void ValidateDimensions(int columns, int rows)
    {
        if (columns < 1 || columns > short.MaxValue) throw new ArgumentOutOfRangeException(nameof(columns), "列数は 1 ～ 32767 にしてください。");
        if (rows < 1 || rows > short.MaxValue) throw new ArgumentOutOfRangeException(nameof(rows), "行数は 1 ～ 32767 にしてください。");
    }
}
