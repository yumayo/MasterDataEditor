using App.MasterDataEditor.Mcp.Tools;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using System;
using System.Runtime.Versioning;
using System.Threading;
using System.Threading.Tasks;

namespace App.MasterDataEditor.Mcp;

/// <summary>
/// MCP の HTTP メッセージを Windows 同一ユーザー専用の名前付きパイプで受け付ける。
/// TCP ポートは公開せず、stdio プロキシからのローカル接続だけに利用する。
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class McpHttpServer : IAsyncDisposable
{
    private readonly WebApplication _app;
    private readonly Mutex _instance;

    private McpHttpServer(WebApplication app, Mutex instance)
    {
        _app = app;
        _instance = instance;
    }

    public static async Task<McpHttpServer> CreateAndStartAsync(EditorApiBridge editorApiBridge, CancellationToken cancellationToken)
    {
        var pipeName = McpPipeTransport.GetPipeName();
        // 名前付きパイプは複数プロセスが同名で待受可能なので、MCP の転送先が混在しないよう一つに限定する。
        // 所有権を取得しないため、非同期の起動/終了によるスレッド切り替えに依存しない。
        var instance = new Mutex(false, @"Global\" + pipeName + ".owner", out var createdNew);
        if (!createdNew)
        {
            instance.Dispose();
            throw new InvalidOperationException("このユーザーの MCP サーバーは既に起動しています。");
        }
        try
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = Array.Empty<string>(), ContentRootPath = AppContext.BaseDirectory });
            // 環境変数や appsettings によって TCP 待受が追加される余地をなくす。
            builder.Configuration.Sources.Clear();
            builder.WebHost.UseNamedPipes(options => options.CurrentUserOnly = true);
            builder.WebHost.ConfigureKestrel(options => options.ListenNamedPipe(pipeName));
            builder.Services.AddSingleton(editorApiBridge);
            builder.Services.AddMcpServer()
                .WithHttpTransport()
                .WithTools<HelloWorldTool>()
                .WithTools<TableInfoTool>()
                .WithTools<TableEditTool>()
                .WithTools<ValidationTool>()
                .WithTools<SearchTool>();

            var app = builder.Build();
            try
            {
                app.Use(McpRequestPolicy.InvokeAsync);
                app.MapGet("/health", () => Microsoft.AspNetCore.Http.Results.NoContent());
                app.MapMcp();
                await app.StartAsync(cancellationToken);
                Logger.Info("MCP Server started on a current-user named pipe");
                return new McpHttpServer(app, instance);
            }
            catch
            {
                await app.DisposeAsync();
                throw;
            }
        }
        catch
        {
            instance.Dispose();
            throw;
        }
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            await _app.StopAsync();
        }
        finally
        {
            try
            {
                await _app.DisposeAsync();
            }
            finally
            {
                _instance.Dispose();
            }
        }
        Logger.Info("MCP Server stopped");
    }
}
