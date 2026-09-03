using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace App.MasterDataEditor
{
	/// <summary>
	/// 比較対象として選択できるローカルおよびremote-trackingブランチを返す。
	/// </summary>
	public static class WebView2HandlerGitBranchListRequest
	{
		public static object Invoke(JsonElement root, string requestId)
		{
			try
			{
				var workDir = AppEnvironment.GetWorkDir();
				var gitRoot = GitCommandHelper.GetGitRoot(workDir);
				var branchReferences = GitCommandHelper.GetBranchReferences(gitRoot);
				var branches = new List<GitBranchInfoResponseData>();

				foreach (var branch in branchReferences)
				{
					branches.Add(new GitBranchInfoResponseData(branch.Name, branch.RefName, branch.Kind));
				}

				return new GitBranchListSuccessResponse(requestId, branches);
			}
			catch (Exception ex)
			{
				Logger.Error(ex, "git branch list 実行時にエラーが発生しました。");
				return new GitBranchListFailureResponse(requestId, ex.Message);
			}
		}
	}

	internal sealed class GitBranchInfoResponseData
	{
		public GitBranchInfoResponseData(string name, string refName, GitBranchKind kind)
		{
			Name = name;
			RefName = refName;
			Kind = kind switch
			{
				GitBranchKind.Local => "local",
				GitBranchKind.Remote => "remote",
				_ => throw new InvalidOperationException("Unexpected branch kind."),
			};
		}

		[JsonInclude]
		[JsonPropertyName("name")]
		public readonly string Name;
		[JsonInclude]
		[JsonPropertyName("ref")]
		public readonly string RefName;
		[JsonInclude]
		[JsonPropertyName("kind")]
		public readonly string Kind;
	}

	internal sealed class GitBranchListSuccessResponse
	{
		public GitBranchListSuccessResponse(string requestId, List<GitBranchInfoResponseData> data)
		{
			Type = "git_branch_list_response";
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
		public readonly List<GitBranchInfoResponseData> Data;
	}

	internal sealed class GitBranchListFailureResponse
	{
		public GitBranchListFailureResponse(string requestId, string error)
		{
			Type = "git_branch_list_response";
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
