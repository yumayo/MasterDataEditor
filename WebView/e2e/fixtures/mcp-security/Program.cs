using App.MasterDataEditor;
using App.MasterDataEditor.Mcp;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ModelContextProtocol.Server;
using System.IO.Pipes;
using System.Text;

const string Initialize = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"clientInfo\":{\"name\":\"security-fixture\",\"version\":\"1\"}}}";

if (args.Length > 0)
{
    if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("ACL checks require Windows");
    if (args.Length == 1 && args[0] == "--print-pipe-name")
    {
        Console.WriteLine(McpPipeTransport.GetPipeName());
        return 0;
    }
    if (args.Length == 2 && args[0] == "--probe-pipe")
    {
        // 攻撃者はクライアント側の owner 検査を使わない。サーバー DACL による拒否だけを検証する。
        using var pipe = new NamedPipeClientStream(".", args[1], PipeDirection.InOut, PipeOptions.Asynchronous);
        try
        {
            await pipe.ConnectAsync(3000);
            Console.WriteLine("CONNECTED: same-user probe should connect; another OS user must not connect.");
            return 1;
        }
        catch (UnauthorizedAccessException)
        {
            Console.WriteLine("PASS: Windows denied access to the other user's pipe.");
            return 0;
        }
        catch (TimeoutException)
        {
            Console.WriteLine("INCONCLUSIVE: pipe unavailable; keep the victim server running and verify a same-user probe first.");
            return 2;
        }
    }
    throw new ArgumentException("Unknown fixture argument");
}

// 同梱 MCP SDK をそのまま使用し、TCP を使わず HTTP パイプラインを検査する。
// 修正前はポリシーが存在しないため SDK 単体に要求が到達し、攻撃ケースが実際に成功する。
var builder = WebApplication.CreateBuilder(Array.Empty<string>());
builder.Logging.ClearProviders();
var memoryServer = new MemoryServer();
builder.Services.AddSingleton<IServer>(memoryServer);
builder.Services.AddMcpServer().WithHttpTransport().WithTools<AuditTool>();
await using var app = builder.Build();
app.Use(McpRequestPolicy.InvokeAsync);
app.MapMcp();
await app.StartAsync();
var failed = 0;
foreach (var test in new[]
{
    ("localhost", "https://attacker.example", 403),
    ("attacker.example", (string?)null, 400),
    ("localhost:3001", null, 400),
    ("localhost.attacker.example", null, 400),
    ("localhost", "null", 403),
    ("localhost", "http://localhost", 403),
    ("localhost", "", 403),
    ("localhost", null, 200),
})
{
    var result = await memoryServer.RequestAsync(test.Item1, test.Item2, Initialize, "");
    var sessionIssued = result.Session.Length > 0;
    var toolExecuted = false;
    if (sessionIssued)
    {
        await memoryServer.RequestAsync(test.Item1, test.Item2, "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}", result.Session);
        var call = await memoryServer.RequestAsync(test.Item1, test.Item2, "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"hello\",\"arguments\":{}}}", result.Session);
        toolExecuted = call.Body.Contains("audit-ok", StringComparison.Ordinal);
    }
    var allowed = test.Item3 == 200;
    var pass = result.Status == test.Item3 && sessionIssued == allowed && toolExecuted == allowed;
    Console.WriteLine($"{(pass ? "PASS" : "FAIL")}: Host={test.Item1}, Origin={test.Item2}, expected={test.Item3}, actual={result.Status}, session={sessionIssued}, toolExecuted={toolExecuted}");
    if (!pass) failed++;
}
await app.StopAsync();

if (OperatingSystem.IsWindows())
{
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
    await using (var server = await McpHttpServer.CreateAndStartAsync(new EditorApiBridge(), timeout.Token))
    {
        try
        {
            await using var duplicate = await McpHttpServer.CreateAndStartAsync(new EditorApiBridge(), timeout.Token);
            Console.WriteLine("FAIL: duplicate MCP server started for the same user");
            failed++;
        }
        catch (InvalidOperationException) { Console.WriteLine("PASS: duplicate user server rejected"); }
        using var client = McpPipeTransport.CreateHttpClient();
        foreach (var test in new[] { ("localhost", "", 200), ("attacker.example", "", 400), ("localhost", "https://attacker.example", 403) })
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, McpPipeTransport.Endpoint) { Content = new StringContent(Initialize, Encoding.UTF8, "application/json") };
            request.Headers.Host = test.Item1;
            request.Headers.Add("Accept", "application/json, text/event-stream");
            if (test.Item2.Length > 0) request.Headers.Add("Origin", test.Item2);
            using var response = await client.SendAsync(request, timeout.Token);
            var pass = (int)response.StatusCode == test.Item3 && response.Headers.Contains("Mcp-Session-Id") == (test.Item3 == 200);
            Console.WriteLine($"{(pass ? "PASS" : "FAIL")}: production named-pipe Host={test.Item1}, Origin={test.Item2}, status={(int)response.StatusCode}");
            if (!pass) failed++;
        }
        using var health = await client.GetAsync(McpPipeTransport.Endpoint + "health", timeout.Token);
        if (health.StatusCode != System.Net.HttpStatusCode.NoContent) throw new InvalidOperationException("Production named-pipe health check failed");
    }
    await using var restarted = await McpHttpServer.CreateAndStartAsync(new EditorApiBridge(), timeout.Token);
    Console.WriteLine("PASS: production named-pipe server restarts after shutdown");
}
else Console.WriteLine("SKIP: Windows named-pipe ACL integration (run this fixture on Windows)");
return failed == 0 ? 0 : 1;


[McpServerToolType]
public sealed class AuditTool
{
    [McpServerTool(Name = "hello")]
    public string Hello() => "audit-ok";
}
public sealed class MemoryServer : IServer
{
    public IFeatureCollection Features { get; } = new FeatureCollection();
    private Func<IFeatureCollection, Task> handler = _ => throw new InvalidOperationException("Server has not started");
    public MemoryServer() => Features.Set<IServerAddressesFeature>(new ServerAddressesFeature());
    public Task StartAsync<TContext>(IHttpApplication<TContext> application, CancellationToken cancellationToken) where TContext : notnull
    {
        handler = async features =>
        {
            var context = application.CreateContext(features);
            try { await application.ProcessRequestAsync(context); }
            finally { application.DisposeContext(context, null); }
        };
        return Task.CompletedTask;
    }
    public async Task<(int Status, string Body, string Session)> RequestAsync(string host, string? origin, string body, string session)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = "POST";
        context.Request.Scheme = "http";
        context.Request.Protocol = "HTTP/1.1";
        context.Request.Path = "/";
        context.Request.Host = new HostString(host);
        context.Request.ContentType = "application/json";
        context.Request.Headers.Accept = "application/json, text/event-stream";
        if (origin is not null) context.Request.Headers.Origin = origin;
        if (session.Length > 0) context.Request.Headers["Mcp-Session-Id"] = session;
        var bytes = Encoding.UTF8.GetBytes(body);
        context.Request.ContentLength = bytes.Length;
        context.Request.Body = new MemoryStream(bytes);
        using var output = new MemoryStream();
        context.Response.Body = output;
        await handler(context.Features);
        return (context.Response.StatusCode, Encoding.UTF8.GetString(output.ToArray()), context.Response.Headers["Mcp-Session-Id"].ToString());
    }
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    public void Dispose() { }
}
