/**
 * SnapPass OCR Aracı — resepsiyon terminalinde çalışan yerel MRZ okuyucu
 * ----------------------------------------------------------------------
 * Bulutta çalışan SnapPass sayfası, kamera karesini önce bu araca gönderir; görüntü bilgisayardan çıkmaz
 * ve okuma terminalin kendi işlemcisiyle yapılır. Araç yoksa sayfa bulut OCR'ına geçer.
 *
 *   node ocr-agent.js
 *
 * Yalnız 127.0.0.1 üzerinde dinler. Ortam değişkenleri:
 *   SNAPPASS_AGENT_PORT     (varsayılan 5102)
 *   SNAPPASS_AGENT_ORIGINS  izin verilen sayfa adresleri, virgülle
 *                           (varsayılan https://snappass.protel.com.tr,http://localhost:3000,http://127.0.0.1:3000)
 *                           "*.trycloudflare.com" gibi alt alan kalıpları desteklenir
 *   SNAPPASS_OCR_WORKERS    eşzamanlı okuma sayısı (varsayılan çekirdek - 1)
 */
const express = require("express");
const engine  = require("./lib/mrz-engine");
const pkg     = require("./package.json");

const PORT = Number(process.env.SNAPPASS_AGENT_PORT) || 5102;
const ORIGINS = (process.env.SNAPPASS_AGENT_ORIGINS || "https://snappass.protel.com.tr,http://localhost:3000,http://127.0.0.1:3000")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

function originAllowed(origin) {
  if (!origin) return false;
  const o = origin.toLowerCase();
  return ORIGINS.some(rule => {
    if (!rule.includes("*")) return rule === o;
    // "*.trycloudflare.com" → https://<herhangi>.trycloudflare.com
    const host = o.replace(/^https?:\/\//, "");
    return o.startsWith("https://") && host.endsWith(rule.replace(/^\*/, ""));
  });
}

const app = express();

// CORS + Chrome yerel ağ erişimi (Private Network Access): yalnız izinli SnapPass sayfaları
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !originAllowed(origin)) return res.status(403).json({ error: "Bu sayfa için izin yok" });
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.headers["access-control-request-private-network"]) res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});
app.use(express.json({ limit: "12mb" }));

app.get("/health", (_, res) => res.json({ ok: true, agent: "snappass-ocr", version: pkg.version, engine: "tesseract", ...engine.stats() }));

app.post("/mrz/scan", async (req, res) => {
  const image = String(req.body?.image || "");
  if (!image) return res.status(400).json({ error: "Görüntü gerekli" });
  try {
    const t0 = Date.now();
    const result = await engine.recognize(engine.decodeImage(image));
    console.log(`[OCR] ${Date.now() - t0} ms, geçerli kontrol ${result.checksum?.validCount ?? 0}/${result.checksum?.totalCount ?? 0}`);
    res.json(result);
  } catch (e) {
    console.error("[OCR]", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`\n✅  SnapPass OCR Aracı çalışıyor: http://127.0.0.1:${PORT}`);
  console.log(`    İzinli sayfalar: ${ORIGINS.join(", ")}\n`);
});
