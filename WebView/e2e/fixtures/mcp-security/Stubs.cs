using System.Text.Json;
namespace App.MasterDataEditor;
public static class Logger
{
    public static void Info(string message) { }
}
public sealed class EditorApiBridge
{
    public Task<JsonElement> RequestAsync(string method, object arguments, CancellationToken cancellationToken) => throw new InvalidOperationException("WebView2 unavailable in transport fixture");
}
