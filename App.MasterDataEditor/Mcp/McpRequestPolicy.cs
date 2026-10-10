using Microsoft.AspNetCore.Http;
using System;
using System.Threading.Tasks;

namespace App.MasterDataEditor.Mcp;

/// <summary>同一ユーザーの名前付きパイプで運ぶ MCP 専用 HTTP 要求を検査する。</summary>
public static class McpRequestPolicy
{
    public static Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        // プロキシの固定 Host だけを許可する。ポート付きや DNS rebinding 用の別 Host は受け付けない。
        if (context.Request.Headers.Host.Count != 1 || !string.Equals(context.Request.Headers.Host[0], "localhost", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return Task.CompletedTask;
        }
        // ブラウザーからの利用契約はない。空値や null を含め Origin がある要求はすべて拒否する。
        if (context.Request.Headers.ContainsKey("Origin"))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        }
        return next(context);
    }
}
