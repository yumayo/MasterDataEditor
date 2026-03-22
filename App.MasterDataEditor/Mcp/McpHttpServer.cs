using App.MasterDataEditor.Mcp.Tools;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using System;
using System.Threading;
using System.Threading.Tasks;

namespace App.MasterDataEditor.Mcp;

/// <summary>
/// WPFアプリケーション内でMCPサーバーをHTTPトランスポートでホストする。
/// バックグラウンドでKestrelを起動し、MCPクライアントからのHTTPリクエストを受け付ける。
/// stdioプロキシ（McpStdioProxy）からの転送先として機能する。
/// </summary>
public sealed class McpHttpServer : IAsyncDisposable
{
	private readonly WebApplication _app;

	private McpHttpServer(WebApplication app)
	{
		_app = app;
	}

	/// <summary>
	/// MCPサーバーを構築し、HTTP Streamable HTTPトランスポートで起動する。
	/// </summary>
	/// <param name="editorApiBridge">WebView2との非同期通信ブリッジ（MCPツールがEditorAPIを呼び出すために使用）</param>
	/// <param name="cancellationToken">キャンセルトークン</param>
	public static async Task<McpHttpServer> CreateAndStartAsync(EditorApiBridge editorApiBridge, CancellationToken cancellationToken)
	{
		var builder = WebApplication.CreateBuilder();

		// EditorApiBridgeをDIコンテナに登録（MCPツールがコンストラクタインジェクションで受け取る）
		builder.Services.AddSingleton(editorApiBridge);

		builder.Services.AddMcpServer()
			.WithHttpTransport()
			.WithTools<HelloWorldTool>()
			.WithTools<TableInfoTool>();

		var app = builder.Build();
		app.Urls.Add("http://localhost:3001");
		app.MapMcp();

		await app.StartAsync(cancellationToken);
		Logger.Info("MCP HTTP Server started on http://localhost:3001");

		return new McpHttpServer(app);
	}

	public async ValueTask DisposeAsync()
	{
		await _app.StopAsync();
		await _app.DisposeAsync();
		Logger.Info("MCP HTTP Server stopped");
	}
}
