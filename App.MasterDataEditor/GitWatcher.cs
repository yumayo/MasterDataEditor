using System;
using System.IO;
using System.Threading;

namespace App.MasterDataEditor;

/// <summary>
/// .git/ ディレクトリ全体を監視し、Git状態が実際に変わったときだけ通知する。
/// git status は index の stat キャッシュを更新する場合があるため、
/// ファイルイベントだけで通知すると通知→git status→index更新→通知のループになる。
/// </summary>
public sealed class GitWatcher : IDisposable
{
	private readonly string _gitRoot;
	private readonly FileSystemWatcher _watcher;
	private readonly Action _onGitChanged;
	private readonly object _lock = new();
	private Timer? _debounceTimer;
	private string _lastSnapshot = "";

	/// <summary>デバウンス間隔（ミリ秒）</summary>
	private const int DebounceIntervalMs = 300;

	public GitWatcher(string gitDirectory, Action onGitChanged)
	{
		_onGitChanged = onGitChanged;
		_gitRoot = Directory.GetParent(gitDirectory)?.FullName
		           ?? throw new ArgumentException("gitDirectory must be inside a git repository.", nameof(gitDirectory));
		_lastSnapshot = ReadGitStateSnapshot() ?? "";

		_watcher = new FileSystemWatcher(gitDirectory)
		{
			NotifyFilter = NotifyFilters.FileName
			               | NotifyFilters.LastWrite
			               | NotifyFilters.Size,
			IncludeSubdirectories = true,
			EnableRaisingEvents = false,
		};

		_watcher.Changed += OnFileSystemEvent;
		_watcher.Created += OnFileSystemEvent;
		_watcher.Deleted += OnFileSystemEvent;
		_watcher.Renamed += OnFileSystemRenamed;
		_watcher.EnableRaisingEvents = true;
	}

	/// <summary>
	/// Changed/Created/Deleted イベント共通ハンドラ。
	/// </summary>
	private void OnFileSystemEvent(object sender, FileSystemEventArgs e)
	{
		var relativePath = e.Name?.Replace('\\', '/');
		if (ShouldIgnoreEvent(relativePath)) return;
		ResetDebounceTimer();
	}

	/// <summary>
	/// Renamed イベントハンドラ。シグネチャが異なるため別メソッド。
	/// </summary>
	private void OnFileSystemRenamed(object sender, RenamedEventArgs e)
	{
		var oldRelativePath = e.OldName?.Replace('\\', '/');
		var relativePath = e.Name?.Replace('\\', '/');
		if (ShouldIgnoreEvent(oldRelativePath) && ShouldIgnoreEvent(relativePath)) return;
		ResetDebounceTimer();
	}

	private bool ShouldIgnoreEvent(string? relativePath)
	{
		if (string.IsNullOrWhiteSpace(relativePath)) return true;
		return relativePath == "index.lock";
	}

	private void ResetDebounceTimer()
	{
		lock (_lock)
		{
			_debounceTimer?.Dispose();
			_debounceTimer = new Timer(_ => FlushGitChanged(), null, DebounceIntervalMs, Timeout.Infinite);
		}
	}

	private void FlushGitChanged()
	{
		var snapshot = ReadGitStateSnapshot();
		if (snapshot == null) return;
		var shouldNotify = false;

		lock (_lock)
		{
			_debounceTimer?.Dispose();
			_debounceTimer = null;
			if (snapshot != _lastSnapshot)
			{
				_lastSnapshot = snapshot;
				shouldNotify = true;
			}
		}

		if (shouldNotify)
		{
			_onGitChanged();
		}
	}

	private string? ReadGitStateSnapshot()
	{
		try
		{
			var head = "";
			try
			{
				head = GitCommandHelper.RunGitCommand(_gitRoot, "rev-parse", "--verify", "HEAD").TrimEnd();
			}
			catch
			{
				// 初回コミット前のリポジトリでは HEAD が存在しない。
			}
			// git status は index の stat キャッシュを更新する場合があるため、
			// .git 監視側の状態比較には index を書かない staged diff を使う。
			var stagedDiff = GitCommandHelper.RunGitCommand(_gitRoot, "--no-optional-locks", "diff", "--cached", "--name-status").TrimEnd();
			return head + "\n" + stagedDiff;
		}
		catch (Exception ex)
		{
			Logger.Error(ex, "Git状態スナップショットの取得に失敗しました。");
			return null;
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
