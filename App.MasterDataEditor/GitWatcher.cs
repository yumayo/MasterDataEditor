using System;
using System.IO;
using System.Threading;

namespace App.MasterDataEditor;

/// <summary>
/// .git/ ディレクトリ全体を監視し、git操作を検知して通知する。
/// index の Changed イベントのみ除外する。
/// git status が index の stat キャッシュを更新するため、
/// 除外しないと通知→git status→index更新→通知の無限ループになる。
/// ステージング変更（git add/reset）は index.lock → index のアトミック置換で
/// Created イベントが発火するため、そちらで検知する。
/// </summary>
public sealed class GitWatcher : IDisposable
{
	private readonly FileSystemWatcher _watcher;
	private readonly Action _onGitChanged;
	private readonly object _lock = new();
	private Timer? _debounceTimer;

	/// <summary>デバウンス間隔（ミリ秒）</summary>
	private const int DebounceIntervalMs = 300;

	public GitWatcher(string gitDirectory, Action onGitChanged)
	{
		_onGitChanged = onGitChanged;

		_watcher = new FileSystemWatcher(gitDirectory)
		{
			NotifyFilter = NotifyFilters.FileName
			               | NotifyFilters.LastWrite
			               | NotifyFilters.Size,
			IncludeSubdirectories = true,
			EnableRaisingEvents = true,
		};

		_watcher.Changed += OnFileSystemEvent;
		_watcher.Created += OnFileSystemEvent;
		_watcher.Deleted += OnFileSystemEvent;
		_watcher.Renamed += OnFileSystemRenamed;
	}

	/// <summary>
	/// Changed/Created/Deleted イベント共通ハンドラ。
	/// index の Changed は git status の stat キャッシュ更新で発火するため除外する。
	/// </summary>
	private void OnFileSystemEvent(object sender, FileSystemEventArgs e)
	{
		var relativePath = e.Name?.Replace('\\', '/');
		// index.lock: git status がロックファイルを Created/Deleted するため
		// 通知→git status→発火の無限ループを引き起こす
		if (relativePath == "index.lock") return;
		ResetDebounceTimer();
	}

	/// <summary>
	/// Renamed イベントハンドラ。シグネチャが異なるため別メソッド。
	/// </summary>
	private void OnFileSystemRenamed(object sender, RenamedEventArgs e)
	{
		ResetDebounceTimer();
	}

	private void ResetDebounceTimer()
	{
		lock (_lock)
		{
			_debounceTimer?.Dispose();
			_debounceTimer = new Timer(_ => _onGitChanged(), null, DebounceIntervalMs, Timeout.Infinite);
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
