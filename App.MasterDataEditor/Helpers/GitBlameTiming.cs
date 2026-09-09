using System;
using System.Diagnostics;
using System.Text.Json;

namespace App.MasterDataEditor;

/// <summary>BLAME の各段階の計測値だけを、requestId 付きでログと WebView に通知する。</summary>
public sealed class GitBlameTiming
{
	private readonly string _requestId;
	private readonly string _filename;
	private readonly Action<object> _send;
	private int? _startLine;
	private int? _endLine;

	public GitBlameTiming(string requestId, string filename, Action<object> send)
	{
		_requestId = requestId;
		_filename = filename;
		_send = send;
	}

	public void SetRange(int startLine, int endLine)
	{
		_startLine = startLine;
		_endLine = endLine;
	}

	public void Record(string stage, double durationMs, long? chars = null, int? entryCount = null, bool success = true)
	{
		var message = new
		{
			type = "git_blame_timing", requestId = _requestId, filename = _filename,
			source = "host", stage, durationMs, chars, entryCount, success,
			startLine = _startLine, endLine = _endLine,
		};
		Logger.Info("[BLAME timing] " + JsonSerializer.Serialize(message));
		_send(message);
	}

	public void RecordSince(string stage, long startedAt, long? chars = null, int? entryCount = null, bool success = true)
	{
		Record(stage, Stopwatch.GetElapsedTime(startedAt).TotalMilliseconds, chars, entryCount, success);
	}
}
