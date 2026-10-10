using System;
using System.IO.Pipes;
using System.Net.Http;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

namespace App.MasterDataEditor.Mcp;

/// <summary>サーバーと stdio プロキシが共有する、Windows 同一ユーザー専用の接続境界。</summary>
[SupportedOSPlatform("windows")]
public static class McpPipeTransport
{
    public const string Endpoint = "http://localhost/";

    public static string GetPipeName()
    {
        using var identity = WindowsIdentity.GetCurrent();
        var sid = identity.User?.Value ?? throw new InvalidOperationException("MCP の接続に必要な Windows ユーザー ID を取得できません。");
        // SID 自体をパイプ名に残さず、ユーザーごとに安定した名前を作る。これは秘密情報ではない。
        return "MasterDataEditor.Mcp." + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sid)));
    }

    public static HttpClient CreateHttpClient()
    {
        var pipeName = GetPipeName();
        var handler = new SocketsHttpHandler
        {
            UseProxy = false,
            AllowAutoRedirect = false,
            ConnectCallback = async (_, cancellationToken) =>
            {
                // サーバー ACL に加えクライアントも相手が同一ユーザーか確認し、別ユーザーの偽サーバーを拒否する。
                var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                try
                {
                    await pipe.ConnectAsync(cancellationToken);
                    return pipe;
                }
                catch
                {
                    await pipe.DisposeAsync();
                    throw;
                }
            }
        };
        return new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(3) };
    }
}
