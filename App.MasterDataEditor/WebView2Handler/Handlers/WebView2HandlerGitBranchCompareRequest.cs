using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace App.MasterDataEditor
{
	/// <summary>
	/// 2つのブランチ先端をSHAへ固定し、data/*.csvのA/M/D差分を返す。
	/// </summary>
	public static class WebView2HandlerGitBranchCompareRequest
	{
		public static object Invoke(JsonElement root, string requestId)
		{
			try
			{
				if (!TryGetRequiredString(root, "leftRef", out var leftRef))
				{
					return ErrorResponse(requestId, "leftRef is required");
				}
				if (!TryGetRequiredString(root, "rightRef", out var rightRef))
				{
					return ErrorResponse(requestId, "rightRef is required");
				}
				if (leftRef == rightRef)
				{
					return ErrorResponse(requestId, "leftRef and rightRef must be different");
				}

				var workDir = AppEnvironment.GetWorkDir();
				var gitRoot = GitCommandHelper.GetGitRoot(workDir);
				var branches = GitCommandHelper.GetBranchReferences(gitRoot);
				if (!ContainsRef(branches, leftRef))
				{
					return ErrorResponse(requestId, "leftRef is not a branch ref");
				}
				if (!ContainsRef(branches, rightRef))
				{
					return ErrorResponse(requestId, "rightRef is not a branch ref");
				}

				// refの移動に影響されないよう、一覧生成前に両端をコミットSHAへ解決する。
				var leftCommit = ResolveCommit(gitRoot, leftRef);
				var rightCommit = ResolveCommit(gitRoot, rightRef);
				var dataPrefix = GitCommandHelper.GetDataPrefix(gitRoot, workDir);
				var output = GitCommandHelper.RunGitCommand(
					gitRoot,
					"diff",
					"--name-status",
					"--no-renames",
					"--diff-filter=AMD",
					"-z",
					leftCommit,
					rightCommit,
					"--",
					dataPrefix
				);
				var files = ParseChangedFiles(output, dataPrefix);

				var data = new GitBranchCompareResponseData(leftCommit, rightCommit, files);
				return new GitBranchCompareSuccessResponse(requestId, data);
			}
			catch (Exception ex)
			{
				Logger.Error(ex, "git branch compare 実行時にエラーが発生しました。");
				return ErrorResponse(requestId, ex.Message);
			}
		}

		private static bool TryGetRequiredString(JsonElement root, string propertyName, out string value)
		{
			value = string.Empty;
			if (!root.TryGetProperty(propertyName, out var element) || element.ValueKind != JsonValueKind.String)
			{
				return false;
			}

			var stringValue = element.GetString();
			if (string.IsNullOrEmpty(stringValue))
			{
				return false;
			}

			value = stringValue;
			return true;
		}

		private static bool ContainsRef(List<GitBranchReference> branches, string refName)
		{
			foreach (var branch in branches)
			{
				if (branch.RefName == refName)
				{
					return true;
				}
			}
			return false;
		}

		private static string ResolveCommit(string gitRoot, string refName)
		{
			return GitCommandHelper.RunGitCommand(gitRoot, "rev-parse", "--verify", refName + "^{commit}").Trim();
		}

		private static List<GitBranchCompareFileResponseData> ParseChangedFiles(string output, string dataPrefix)
		{
			var fields = output.Split('\0', StringSplitOptions.RemoveEmptyEntries);
			if (fields.Length % 2 != 0)
			{
				throw new InvalidOperationException("Unexpected git diff --name-status output.");
			}

			var files = new List<GitBranchCompareFileResponseData>();
			for (var index = 0; index < fields.Length; index += 2)
			{
				var status = fields[index];
				var gitPath = fields[index + 1];
				var validationError = GitCommandHelper.ValidateDataPath(gitPath, dataPrefix);
				if (validationError != null)
				{
					throw new InvalidOperationException(validationError);
				}
				var fileStatus = ParseFileStatus(status);

				var path = "data/" + gitPath.Substring(dataPrefix.Length);
				var tableName = Path.GetFileNameWithoutExtension(path);
				files.Add(new GitBranchCompareFileResponseData(path, tableName, fileStatus));
			}

			return files;
		}

		private static GitBranchFileStatus ParseFileStatus(string status)
		{
			return status switch
			{
				"A" => GitBranchFileStatus.Added,
				"M" => GitBranchFileStatus.Modified,
				"D" => GitBranchFileStatus.Deleted,
				_ => throw new InvalidOperationException("Unexpected git diff status: " + status),
			};
		}

		private static GitBranchCompareFailureResponse ErrorResponse(string requestId, string error)
		{
			return new GitBranchCompareFailureResponse(requestId, error);
		}
	}

	internal enum GitBranchFileStatus
	{
		Added,
		Modified,
		Deleted,
	}

	internal sealed class GitBranchCompareFileResponseData
	{
		public GitBranchCompareFileResponseData(string path, string tableName, GitBranchFileStatus status)
		{
			Path = path;
			TableName = tableName;
			Status = status switch
			{
				GitBranchFileStatus.Added => "A",
				GitBranchFileStatus.Modified => "M",
				GitBranchFileStatus.Deleted => "D",
				_ => throw new InvalidOperationException("Unexpected branch file status."),
			};
		}

		[JsonInclude]
		[JsonPropertyName("path")]
		public readonly string Path;
		[JsonInclude]
		[JsonPropertyName("tableName")]
		public readonly string TableName;
		[JsonInclude]
		[JsonPropertyName("status")]
		public readonly string Status;
	}

	internal sealed class GitBranchCompareResponseData
	{
		public GitBranchCompareResponseData(string leftCommit, string rightCommit, List<GitBranchCompareFileResponseData> files)
		{
			LeftCommit = leftCommit;
			RightCommit = rightCommit;
			Files = files;
		}

		[JsonInclude]
		[JsonPropertyName("leftCommit")]
		public readonly string LeftCommit;
		[JsonInclude]
		[JsonPropertyName("rightCommit")]
		public readonly string RightCommit;
		[JsonInclude]
		[JsonPropertyName("files")]
		public readonly List<GitBranchCompareFileResponseData> Files;
	}

	internal sealed class GitBranchCompareSuccessResponse
	{
		public GitBranchCompareSuccessResponse(string requestId, GitBranchCompareResponseData data)
		{
			Type = "git_branch_compare_response";
			RequestId = requestId;
			Success = true;
			Data = data;
		}

		[JsonInclude]
		[JsonPropertyName("type")]
		public readonly string Type;
		[JsonInclude]
		[JsonPropertyName("requestId")]
		public readonly string RequestId;
		[JsonInclude]
		[JsonPropertyName("success")]
		public readonly bool Success;
		[JsonInclude]
		[JsonPropertyName("data")]
		public readonly GitBranchCompareResponseData Data;
	}

	internal sealed class GitBranchCompareFailureResponse
	{
		public GitBranchCompareFailureResponse(string requestId, string error)
		{
			Type = "git_branch_compare_response";
			RequestId = requestId;
			Success = false;
			Error = error;
		}

		[JsonInclude]
		[JsonPropertyName("type")]
		public readonly string Type;
		[JsonInclude]
		[JsonPropertyName("requestId")]
		public readonly string RequestId;
		[JsonInclude]
		[JsonPropertyName("success")]
		public readonly bool Success;
		[JsonInclude]
		[JsonPropertyName("error")]
		public readonly string Error;
	}
}
