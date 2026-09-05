using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;

namespace App.MasterDataEditor
{
	internal sealed record CellHistoryTarget(int LineNumber, string ColumnName);
	internal sealed record CellHistoryEntry(int LineNumber, string ColumnName, string Author, string Date, string CommitHash, string CommitMessage);

	/// <summary>
	/// CSVセルの値を主キー＋列名で親コミットへ辿る。行番号は最初のセル指定にのみ使う。
	/// マージでは値を引き継いだ親（複数なら最初の親）を辿り、競合解消で作られた値はマージに帰属する。
	/// 主キー変更は新しい行として扱い、重複主キーや取得できない履歴から著者を推測しない。
	/// </summary>
	internal sealed class GitCellHistory
	{
		private sealed record TrackedCell(CellHistoryTarget Target, string Key, string Value);
		private sealed record Work(string Revision, string Path, List<TrackedCell> Cells);
		private sealed record Commit(string Hash, string[] Parents, string Author, string Date, string Message);
		private enum CellState { Missing, Present, Ambiguous }

		private readonly string gitRoot;
		private readonly string[] primaryKey;
		private readonly Dictionary<(string Revision, string Path), string?> blobs = new();
		private readonly Dictionary<(string Revision, string Path), string> latestCommits = new();
		private readonly Dictionary<string, Snapshot> snapshots = new();
		private readonly HashSet<string> trackedKeys = new(StringComparer.Ordinal);
		private readonly HashSet<string> shallowCommits;
		private readonly Stopwatch elapsed = Stopwatch.StartNew();

		public GitCellHistory(string gitRoot, string[] primaryKey)
		{
			this.gitRoot = gitRoot;
			this.primaryKey = primaryKey;
			var shallowPath = GitCommandHelper.RunGitCommand(gitRoot, "rev-parse", "--git-path", "shallow").Trim();
			shallowPath = Path.GetFullPath(shallowPath, gitRoot);
			shallowCommits = File.Exists(shallowPath) ? new(File.ReadAllLines(shallowPath), StringComparer.Ordinal) : new(StringComparer.Ordinal);
		}

		public List<CellHistoryEntry> Find(string revision, string path, IReadOnlyList<CellHistoryTarget> targets)
		{
			var result = new List<CellHistoryEntry>();
			if (targets.Count == 0) return result;
			var blob = GetBlob(revision, path);
			if (blob == null) throw new InvalidOperationException("指定コミットにCSVがありません。");
			var initial = new Snapshot(GitCommandHelper.RunGitCommand(gitRoot, "cat-file", "blob", blob), primaryKey, null);
			var cells = new List<TrackedCell>();
			foreach (var target in targets.Distinct())
			{
				if (!initial.KeysByLine.TryGetValue(target.LineNumber, out var key)) continue;
				if (initial.GetCell(key, target.ColumnName, out var value) != CellState.Present) continue;
				trackedKeys.Add(key);
				cells.Add(new TrackedCell(target, key, value));
			}

			var queue = new Queue<Work>();
			queue.Enqueue(new Work(revision, path, cells));
			while (queue.Count > 0)
			{
				// UIのタイムアウト前に部分結果を返す。未解決セルは「変更者不明」のままにする。
				if (elapsed.Elapsed > TimeSpan.FromSeconds(100)) break;
				var work = queue.Dequeue();
				if (work.Cells.Count == 0) continue;
				var hash = FindLatestFileCommit(work.Revision, work.Path);
				if (hash.Length == 0) continue;
				var commit = ReadCommit(hash);
				if (shallowCommits.Contains(commit.Hash)) continue;
				var remaining = new List<TrackedCell>(work.Cells);
				var ambiguous = new HashSet<TrackedCell>();
				foreach (var parent in commit.Parents)
				{
					if (remaining.Count == 0) break;
					var parentPath = ResolveParentPath(parent, commit.Hash, work.Path);
					if (parentPath == null) continue;
					var snapshot = ReadSnapshot(parent, parentPath);
					if (snapshot == null) continue;
					var inherited = new List<TrackedCell>();
					foreach (var cell in remaining)
					{
						var state = snapshot.GetCell(cell.Key, cell.Target.ColumnName, out var value);
						if (state == CellState.Ambiguous) ambiguous.Add(cell);
						if (state == CellState.Present && value == cell.Value) inherited.Add(cell);
					}
					var inheritedSet = new HashSet<TrackedCell>(inherited);
					remaining.RemoveAll(inheritedSet.Contains);
					if (inherited.Count > 0) queue.Enqueue(new Work(parent, parentPath, inherited));
				}
				foreach (var cell in remaining)
				{
					if (ambiguous.Contains(cell)) continue;
					result.Add(new CellHistoryEntry(cell.Target.LineNumber, cell.Target.ColumnName, commit.Author, commit.Date, commit.Hash, commit.Message));
				}
			}
			return result;
		}

		private string FindLatestFileCommit(string revision, string path)
		{
			if (latestCommits.TryGetValue((revision, path), out var hash)) return hash;
			// まず第一親上でファイルが変わる地点まで飛ばす。そこで全親を比較して値を引き継ぐ親を選ぶ。
			// 全親のツリーが同じマージが省略されても、第一親を優先する規則を維持できる。
			hash = GitCommandHelper.RunGitCommand(gitRoot, "log", "-1", "--format=%H", "--first-parent", "--full-history", "-m", revision, "--", ":(literal)" + path).Trim();
			latestCommits[(revision, path)] = hash;
			return hash;
		}

		private Commit ReadCommit(string hash)
		{
			var fields = GitCommandHelper.RunGitCommand(gitRoot, "show", "-s", "--format=%H%x00%P%x00%an%x00%ai%x00%s", hash).TrimEnd('\r', '\n').Split('\0');
			if (fields.Length != 5) throw new InvalidOperationException("コミット情報を読み取れませんでした。");
			return new Commit(fields[0], fields[1].Split(' ', StringSplitOptions.RemoveEmptyEntries), fields[2], fields[3], fields[4]);
		}

		private string? GetBlob(string revision, string path)
		{
			if (blobs.TryGetValue((revision, path), out var blob)) return blob;
			var tree = GitCommandHelper.RunGitCommand(gitRoot, "ls-tree", "-z", revision, "--", ":(literal)" + path);
			var tab = tree.IndexOf('\t');
			if (tab < 0) blob = null;
			else
			{
				var fields = tree.Substring(0, tab).Split(' ');
				blob = fields.Length == 3 && fields[1] == "blob" ? fields[2] : null;
			}
			blobs[(revision, path)] = blob;
			return blob;
		}

		private Snapshot? ReadSnapshot(string revision, string path)
		{
			var blob = GetBlob(revision, path);
			if (blob == null) return null;
			if (snapshots.TryGetValue(blob, out var snapshot)) return snapshot;
			snapshot = new Snapshot(GitCommandHelper.RunGitCommand(gitRoot, "cat-file", "blob", blob), primaryKey, trackedKeys);
			// 同じblobを再利用しつつ、長い履歴でCSV全体を保持し続けない。
			if (snapshots.Count >= 8) snapshots.Remove(snapshots.Keys.First());
			snapshots[blob] = snapshot;
			return snapshot;
		}

		private string? ResolveParentPath(string parent, string commit, string path)
		{
			if (GetBlob(parent, path) != null) return path;
			var changes = GitCommandHelper.RunGitCommand(gitRoot, "diff-tree", "-r", "--no-commit-id", "--name-status", "-z", "-M", parent, commit).Split('\0');
			for (var i = 0; i < changes.Length - 1;)
			{
				var status = changes[i++];
				if (status.Length == 0 || i >= changes.Length) break;
				var oldPath = changes[i++];
				if (status[0] != 'R' && status[0] != 'C') continue;
				if (i >= changes.Length) break;
				var newPath = changes[i++];
				if (status[0] == 'R' && newPath == path) return oldPath;
			}
			return null;
		}

		private sealed class Snapshot
		{
			private readonly Dictionary<string, int> columns = new(StringComparer.Ordinal);
			private readonly Dictionary<string, string[]?> rows = new(StringComparer.Ordinal);
			public Dictionary<int, string> KeysByLine { get; } = new();

			public Snapshot(string csv, string[] primaryKey, HashSet<string>? retainedKeys)
			{
				using var records = ParseCsv(csv).GetEnumerator();
				if (!records.MoveNext()) return;
				var header = records.Current.Fields;
				for (var i = 0; i < header.Length; i++)
				{
					if (!columns.TryAdd(header[i], i)) columns[header[i]] = -1;
				}
				if (primaryKey.Any(key => !columns.TryGetValue(key, out var index) || index < 0)) return;
				var keyIndices = primaryKey.Select(key => columns[key]).ToArray();
				while (records.MoveNext())
				{
					var (line, fields) = records.Current;
					var key = JsonSerializer.Serialize(keyIndices.Select(index => index < fields.Length ? fields[index] : "").ToArray());
					if (retainedKeys != null && !retainedKeys.Contains(key)) continue;
					if (!rows.TryAdd(key, fields)) rows[key] = null;
					if (retainedKeys == null) KeysByLine[line] = key;
				}
			}

			public CellState GetCell(string key, string column, out string value)
			{
				value = "";
				if (!rows.TryGetValue(key, out var row) || !columns.TryGetValue(column, out var index)) return CellState.Missing;
				if (row == null || index < 0) return CellState.Ambiguous;
				value = index < row.Length ? row[index] : "";
				return CellState.Present;
			}
		}

		/// <summary>引用符・カンマ・CRLF・埋め込み改行を扱い、元ファイルの開始行番号も保持する。</summary>
		private static IEnumerable<(int Line, string[] Fields)> ParseCsv(string csv)
		{
			var fields = new List<string>();
			var field = new StringBuilder();
			var quoted = false;
			var line = 1;
			var startLine = 1;
			var recordStarted = false;
			for (var i = csv.Length > 0 && csv[0] == '\uFEFF' ? 1 : 0; i < csv.Length; i++)
			{
				var c = csv[i];
				recordStarted = true;
				if (c == '"')
				{
					if (quoted && i + 1 < csv.Length && csv[i + 1] == '"') { field.Append('"'); i++; }
					else if (quoted || field.Length == 0) quoted = !quoted;
					else field.Append(c);
				}
				else if (c == ',' && !quoted) { fields.Add(field.ToString()); field.Clear(); }
				else if (c == '\n' || c == '\r')
				{
					if (c == '\r' && i + 1 < csv.Length && csv[i + 1] == '\n') i++;
					line++;
					if (quoted) { field.Append('\n'); continue; }
					fields.Add(field.ToString());
					yield return (startLine, fields.ToArray());
					fields.Clear(); field.Clear(); startLine = line; recordStarted = false;
				}
				else field.Append(c);
			}
			if (quoted) throw new InvalidOperationException("CSVの引用符が閉じられていません。");
			if (recordStarted) { fields.Add(field.ToString()); yield return (startLine, fields.ToArray()); }
		}
	}
}
