using App.MasterDataEditor.Mcp.Tools;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using System.Threading;
using System.Threading.Tasks;

namespace App.MasterDataEditor.Mcp;

/// <summary>
/// MCPサーバーをstdioトランスポートでホストする。
/// MCPクライアント（Claude Desktop等）が本プロセスを子プロセスとして起動し、
/// stdin/stdoutでJSON-RPCメッセージをやり取りする。
/// </summary>
public static class McpServerHost
{
	/// <summary>
	/// MCPサーバーをstdioモードで起動し、stdinが閉じるまでブロックする。
	/// </summary>
	public static async Task RunAsync(CancellationToken cancellationToken)
	{
		var builder = Host.CreateApplicationBuilder();

		builder.Services.AddMcpServer()
			.WithStdioServerTransport()
			.WithTools<HelloWorldTool>();

		// stdoutはMCPプロトコルが占有するため、ログはstderrへ出力
		builder.Logging.AddConsole(options =>
		{
			options.LogToStandardErrorThreshold = LogLevel.Trace;
		});

		using var host = builder.Build();
		await host.RunAsync(cancellationToken);
	}
}
