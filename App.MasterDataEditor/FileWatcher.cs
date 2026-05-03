using System;
using System.IO;
using System.Threading;

namespace App.MasterDataEditor;

/// <summary>
/// 指定ディレクトリの対象ファイルを監視し、
/// 変更・追加・削除を検知して WebView に file_changed メッセージを送信する。
/// 短時間に連続するイベントを300msのデバウンスで1回にまとめる。
/// </summary>
public sealed class FileWatcher : IDisposable
{
	private readonly FileSystemWatcher _watcher;
	private readonly Action _onFileChanged;
	private readonly object _lock = new();
	private Timer? _debounceTimer;

	/// <summary>デバウンス間隔（ミリ秒）</summary>
	private const int DebounceIntervalMs = 300;

	public FileWatcher(string directory, string filter, Action onFileChanged)
	{
		_onFileChanged = onFileChanged;

		_watcher = new FileSystemWatcher(directory, filter)
		{
			NotifyFilter = NotifyFilters.FileName
			               | NotifyFilters.LastWrite
			               | NotifyFilters.Size,
			IncludeSubdirectories = false,
			EnableRaisingEvents = true,
		};

		_watcher.Changed += OnFileEvent;
		_watcher.Created += OnFileEvent;
		_watcher.Deleted += OnFileEvent;
		_watcher.Renamed += OnFileRenamed;
	}

	/// <summary>
	/// 変更・追加・削除イベント共通ハンドラ。
	/// デバウンスタイマーをリセットして300ms後に1回だけ通知する。
	/// </summary>
	private void OnFileEvent(object sender, FileSystemEventArgs e)
	{
		ResetDebounceTimer();
	}

	/// <summary>
	/// リネームイベントハンドラ。デバウンスタイマーをリセットする。
	/// </summary>
	private void OnFileRenamed(object sender, RenamedEventArgs e)
	{
		ResetDebounceTimer();
	}

	/// <summary>
	/// デバウンスタイマーをリセットする。
	/// 前回のタイマーが動作中であれば破棄して新しいタイマーを開始する。
	/// FileSystemWatcher のイベントは複数スレッドプールスレッドから同時呼び出しされるため
	/// lock で排他制御する。
	/// </summary>
	private void ResetDebounceTimer()
	{
		lock (_lock)
		{
			_debounceTimer?.Dispose();
			_debounceTimer = new Timer(_ => _onFileChanged(), null, DebounceIntervalMs, Timeout.Infinite);
		}
	}

	public void Dispose()
	{
		lock (_lock)
		{
			_debounceTimer?.Dispose();
		}
		_watcher.Dispose();
	}
}

/// <summary>
/// 何もしない IDisposable 実装。
/// ディレクトリが存在しない等の理由でリソースを確保しない場合に
/// nullable フィールドを回避するために使用する。
/// </summary>
internal sealed class NullDisposable : IDisposable
{
	public static readonly NullDisposable Instance = new();
	public void Dispose() { }
}
