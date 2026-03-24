import { readFileSync, rmSync, mkdirSync, cpSync, existsSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = dirname(fileURLToPath(import.meta.url));

// --- .env パース ---
function parseEnv(filePath: string): Map<string, string> {
    const entries = new Map<string, string>();
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) continue;
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex === -1) continue;
        entries.set(trimmed.slice(0, eqIndex), trimmed.slice(eqIndex + 1));
    }
    return entries;
}

const env = parseEnv(resolve(ROOT, ".env"));

// コンテナ内では ROOT/dist を使用し、ホスト実行時は .env の MASTER_DATA_EDITOR_DIST を参照
const rawDist = env.get("MASTER_DATA_EDITOR_DIST");
const distPath = resolve(ROOT, "dist");
if (rawDist === null || rawDist === undefined || rawDist === "") {
    console.error("警告: .env に MASTER_DATA_EDITOR_DIST が未設定のため dist/ を使用します。");
}

const csprojFile = resolve(ROOT, "App.MasterDataEditor", "App.MasterDataEditor.csproj");
const webViewDir = resolve(ROOT, "WebView");

function run(command: string, cwd: string): void {
    console.log(`> ${command}`);
    execSync(command, { cwd, stdio: "inherit" });
}

// --- 1. dist の中身をクリーン（マウントポイント自体は削除不可のため中身のみ削除） ---
console.log(`\n=== dist をクリーン: ${distPath} ===`);
if (existsSync(distPath)) {
    for (const entry of readdirSync(distPath)) {
        rmSync(resolve(distPath, entry), { recursive: true, force: true });
    }
} else {
    mkdirSync(distPath, { recursive: true });
}

// --- 2. C# ビルド (Release) --- 成果物は dist/bin、中間ファイルは dist/obj に出力 ---
console.log("\n=== C# ビルド (Release) ===");
const objDir = resolve(distPath, "obj");
const binDir = resolve(distPath, "bin");
run(`dotnet publish "${csprojFile}" --configuration Release --self-contained --runtime win-x64 -o "${binDir}" -p:BaseIntermediateOutputPath="${objDir}/"`, ROOT);

// 中間ファイルを除去
rmSync(objDir, { recursive: true, force: true });

// --- 3. WebView ビルド ---
console.log("\n=== WebView ビルド ===");
run("npm run build", webViewDir);

// --- 4. WebView 成果物を dist/bin/WebView にコピー ---
const webViewDist = resolve(webViewDir, "dist");
const webViewOut = resolve(binDir, "WebView");
console.log(`\n=== WebView 成果物コピー: ${webViewDist} → ${webViewOut} ===`);
mkdirSync(webViewOut, { recursive: true });
cpSync(webViewDist, webViewOut, { recursive: true });

console.log("\n=== ビルド完了 ===");
console.log(`出力先: ${distPath}`);
