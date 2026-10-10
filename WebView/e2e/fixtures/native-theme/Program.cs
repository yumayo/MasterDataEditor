using System.Text.Json;
using System.Text.Json.Nodes;
using App.MasterDataEditor;

var colors = new[] {"background", "surface", "foreground", "secondaryForeground", "border", "hover", "pressed", "focus"};
var validJson = JsonSerializer.Serialize(new {palette = colors.ToDictionary(name => name, _ => new[] {0, 128, 255, 64})});
using var validDocument = JsonDocument.Parse(validJson);
var valid = NativeThemePalette.Parse(validDocument.RootElement);
if (valid.Background != new NativeRgba(0, 128, 255, 64) || valid.Focus != valid.Background) throw new Exception("RGBAのbyte値が保持されませんでした。");
Console.WriteLine("PASS 正常パレットと透明度を保持");

var invalidCases = new (string Name, Action<JsonObject> Change)[]
{
    ("palette欠落", root => root.Remove("palette")),
    ("palette不正型", root => root["palette"] = true),
    ("色欠落", root => root["palette"]!.AsObject().Remove("focus")),
    ("任意資源名", root => root["palette"]!["unexpectedResource"] = new JsonArray(0, 0, 0, 255)),
    ("色不正型", root => root["palette"]!["focus"] = "red"),
    ("RGBA要素不足", root => root["palette"]!["focus"] = new JsonArray(0, 0, 0)),
    ("RGBA要素超過", root => root["palette"]!["focus"] = new JsonArray(0, 0, 0, 255, 0)),
    ("負の値", root => root["palette"]!["focus"]![0] = -1),
    ("256以上", root => root["palette"]!["focus"]![1] = 256),
    ("小数", root => root["palette"]!["focus"]![2] = 0.5),
    ("文字列", root => root["palette"]!["focus"]![3] = "255"),
    ("null", root => root["palette"]!["focus"]![3] = null),
};
foreach (var (name, change) in invalidCases)
{
    var root = JsonNode.Parse(validJson)!.AsObject();
    change(root);
    using var document = JsonDocument.Parse(root.ToJsonString());
    var current = valid;
    var rejected = false;
    try { current = NativeThemePalette.Parse(document.RootElement); }
    catch (FormatException) { rejected = true; }
    if (!rejected || !ReferenceEquals(current, valid)) throw new Exception($"{name}が拒否されず、パレットが置き換わりました。");
    Console.WriteLine($"PASS {name}は全体を拒否");
}
