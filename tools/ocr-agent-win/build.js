/**
 * SnapPass OCR Aracı — Windows kurulum paketi üretir: dist/SnapPassOCR-Setup.exe
 *   node tools/ocr-agent-win/build.js            (yönetici izni isteyen kurulum exe'si)
 *   node tools/ocr-agent-win/build.js --test     (ek olarak izin istemeyen test sürümü: dist/SnapPassOCR-Setup-test.exe)
 * Gerekenler: Windows, .NET Framework 4 C# derleyicisi (csc.exe), npm. İnternetten bir şey indirilmez;
 * node.exe bu makinedeki Node'dan, paketler npm önbelleğinden gelir.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const DIST = path.join(ROOT, "dist");
const STAGE = path.join(DIST, "ocr-agent");
const PAYLOAD = path.join(STAGE, "payload");
const APP = path.join(PAYLOAD, "app");
const CSC = path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
const rootPkg = require(path.join(ROOT, "package.json"));

const step = (s) => console.log(`\n▶ ${s}`);
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };

step("Hazırlık");
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });

step("Uygulama dosyaları");
copy(process.execPath, path.join(PAYLOAD, "node.exe"));
copy(path.join(ROOT, "ocr-agent.js"), path.join(APP, "ocr-agent.js"));
copy(path.join(ROOT, "lib", "mrz-engine.js"), path.join(APP, "lib", "mrz-engine.js"));
copy(path.join(ROOT, "public", "mrz-parser.js"), path.join(APP, "public", "mrz-parser.js"));
copy(path.join(ROOT, "ocr-models", "mrz.traineddata"), path.join(APP, "ocr-models", "mrz.traineddata"));
fs.writeFileSync(path.join(APP, "package.json"), JSON.stringify({
  name: "snappass-ocr-agent",
  version: rootPkg.version,
  private: true,
  main: "ocr-agent.js",
  dependencies: { express: rootPkg.dependencies.express, "tesseract.js": rootPkg.dependencies["tesseract.js"] },
}, null, 2));

step("Bağımlılıklar (projenin node_modules klasöründen, yalnız gerekenler)");
// express ve tesseract.js'in bağımlılık ağacını izleyip paketleri kopyalar (internet / npm gerekmez)
const SRC_MODULES = path.join(ROOT, "node_modules");
const needed = new Set();
const visit = (name) => {
  if (needed.has(name)) return;
  const pkgFile = path.join(SRC_MODULES, name, "package.json");
  if (!fs.existsSync(pkgFile)) throw new Error(`node_modules içinde yok: ${name} (önce npm install çalıştırın)`);
  needed.add(name);
  const p = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
  for (const dep of Object.keys({ ...p.dependencies, ...p.optionalDependencies })) {
    if (fs.existsSync(path.join(SRC_MODULES, name, "node_modules", dep))) continue; // iç içe kurulu; paketle birlikte kopyalanır
    if (fs.existsSync(path.join(SRC_MODULES, dep))) visit(dep);
  }
};
visit("express");
visit("tesseract.js");
for (const name of needed) fs.cpSync(path.join(SRC_MODULES, name), path.join(APP, "node_modules", name), { recursive: true });
console.log(`${needed.size} paket kopyalandı`);

step("Windows servisi (SnapPassOcrService.exe)");
execFileSync(CSC, ["/nologo", "/target:exe", "/optimize+", "/r:System.ServiceProcess.dll",
  `/out:${path.join(PAYLOAD, "SnapPassOcrService.exe")}`, path.join(__dirname, "Service.cs")], { stdio: "inherit" });

step("Sıkıştırma (payload.zip)");
const zip = path.join(STAGE, "payload.zip");
execFileSync("powershell", ["-NoProfile", "-Command",
  `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory('${PAYLOAD}', '${zip}', [IO.Compression.CompressionLevel]::Optimal, $false)`],
  { stdio: "inherit" });

const buildSetup = (out, manifest) => {
  const args = ["/nologo", "/target:exe", "/optimize+",
    "/r:System.ServiceProcess.dll", "/r:System.IO.Compression.dll", "/r:System.IO.Compression.FileSystem.dll",
    `/resource:${zip},payload.zip`, `/out:${out}`, path.join(__dirname, "Setup.cs")];
  if (manifest) args.splice(3, 0, `/win32manifest:${path.join(__dirname, "setup.manifest")}`);
  execFileSync(CSC, args, { stdio: "inherit" });
};

step("Kurulum programı (SnapPassOCR-Setup.exe)");
const setupExe = path.join(DIST, "SnapPassOCR-Setup.exe");
buildSetup(setupExe, true);
if (process.argv.includes("--test")) buildSetup(path.join(DIST, "SnapPassOCR-Setup-test.exe"), false);

const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(1) + " MB";
console.log(`\n✅ Hazır: ${setupExe} (${mb(setupExe)})`);
