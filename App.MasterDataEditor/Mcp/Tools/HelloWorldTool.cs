using ModelContextProtocol.Server;
using System.ComponentModel;

namespace App.MasterDataEditor.Mcp.Tools;

[McpServerToolType]
public sealed class HelloWorldTool
{
	[McpServerTool, Description("挨拶を返します。")]
	public static string Hello(
		[Description("挨拶する相手の名前")] string name)
	{
		return $"Hello, {name}! Welcome to MasterDataEditor.";
	}
}
