using System;
using System.Linq;
using System.Text.Json;

namespace App.MasterDataEditor;

internal readonly record struct NativeRgba(byte Red, byte Green, byte Blue, byte Alpha);

/// <summary>WebViewから受け取る固定8色。全色を検証してから画面へ渡し、部分適用を防ぐ。</summary>
internal sealed record NativeThemePalette(NativeRgba Background, NativeRgba Surface, NativeRgba Foreground, NativeRgba SecondaryForeground, NativeRgba Border, NativeRgba Hover, NativeRgba Pressed, NativeRgba Focus)
{
    public static NativeThemePalette Parse(JsonElement message)
    {
        if (message.ValueKind != JsonValueKind.Object || !message.TryGetProperty("palette", out var palette) || palette.ValueKind != JsonValueKind.Object || palette.EnumerateObject().Count() != 8)
            throw new FormatException("ネイティブ画面のテーマには固定8色が必要です。");
        return new NativeThemePalette(ReadColor(palette, "background"), ReadColor(palette, "surface"), ReadColor(palette, "foreground"), ReadColor(palette, "secondaryForeground"), ReadColor(palette, "border"), ReadColor(palette, "hover"), ReadColor(palette, "pressed"), ReadColor(palette, "focus"));
    }

    private static NativeRgba ReadColor(JsonElement palette, string name)
    {
        if (!palette.TryGetProperty(name, out var color) || color.ValueKind != JsonValueKind.Array || color.GetArrayLength() != 4)
            throw new FormatException($"テーマ色 {name} はRGBAの4要素で指定してください。");
        foreach (var channel in color.EnumerateArray())
        {
            if (channel.ValueKind != JsonValueKind.Number || !channel.TryGetByte(out _)) throw new FormatException($"テーマ色 {name} は0～255の整数で指定してください。");
        }
        return new NativeRgba(color[0].GetByte(), color[1].GetByte(), color[2].GetByte(), color[3].GetByte());
    }
}
