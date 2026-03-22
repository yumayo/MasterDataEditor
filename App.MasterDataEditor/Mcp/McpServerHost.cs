using App.MasterDataEditor.Mcp.Tools;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using System;
using System.Threading;
using System.Threading.Tasks;

namespace App.MasterDataEditor.Mcp;

/// <summary>
/// WPFアプリケーション内でMCPサーバーをHTTPトランスポートでホストする。
/// バックグラウンドでKestrelを起動し、AIツールからのMCPリクエストを受け付ける。
/// </summary>
public sealed class McpServerHost : IAsyncDisposable
{
	private readonly WebApplication _app;

	private McpServerHost(WebApplication app)
	{
		_app = app;
	}

	/// <summary>
	/// MCPサーバーを構築し、起動する。
	/// </summary>
	public static async Task<McpServerHost> CreateAndStartAsync(CancellationToken cancellationToken)
	{
		var builder = WebApplication.CreateBuilder();

		builder.Services.AddMcpServer()
			.WithHttpTransport()
			.WithTools<HelloWorldTool>();

		var app = builder.Build();
		app.Urls.Add("http://localhost:3001");
		app.MapMcp();

		await app.StartAsync(cancellationToken);
		Logger.Info("MCP Server started on http://localhost:3001");

		return new McpServerHost(app);
	}

	public async ValueTask DisposeAsync()
	{
		await _app.StopAsync();
		await _app.DisposeAsync();
		Logger.Info("MCP Server stopped");
	}
}
