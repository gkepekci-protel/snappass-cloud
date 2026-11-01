/* ─── Bulut MRZ okuma ──────────────────────────────────────────────────────
   SNAPPASS_OCR_BACKEND:
     local    (varsayılan) lib/mrz-engine.js — Tesseract 5 + mrz.traineddata, işçi havuzu
     snappass SnapPass.Service'in /api/mrz/scan ucu (yalnız Windows, eski kurulum)
   SnapPass.Service bu makinede ayrı bir örnek olarak çalışır (varsayılan https://127.0.0.1:5101):
     Jwt__SecretKey        = data/ocr-jwt.key içeriği (proxy aynı anahtarla JWT imzalar)
     Kestrel HTTPS sertifikası = data/ocr-cert.pfx (proxy data/ocr-cert.pem'e güvenir)
   SnapPass veritabanında aktif "ocr-proxy" kullanıcısı (rol User) bulunmalıdır.
── */
const https  = require("https");
const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");
const { DATA_DIR } = require("./security");

const OCR_URL   = new URL(process.env.SNAPPASS_OCR_URL || "https://127.0.0.1:5101");
const OCR_USER  = process.env.SNAPPASS_OCR_USER || "ocr-proxy";
const KEY_FILE  = path.join(DATA_DIR, "ocr-jwt.key");
const CERT_FILE = path.join(DATA_DIR, "ocr-cert.pem");

const BACKEND   = (process.env.SNAPPASS_OCR_BACKEND || "local").toLowerCase();

const readIf = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "");
const enabled = () => (BACKEND === "snappass" ? !!readIf(KEY_FILE) : true);

// SnapPass JwtService ile aynı token: HS256, iss SnapPass, aud SnapPassClient, name + role claim
function mintToken(hotelId = "") {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name": OCR_USER,
    "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": "User",
    hotelId,
    jti: crypto.randomUUID(),
    nbf: now - 30, iat: now, exp: now + 600,
    iss: "SnapPass", aud: "SnapPassClient",
  });
  const sig = crypto.createHmac("sha256", Buffer.from(readIf(KEY_FILE), "utf8")).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

// SnapPass'in Tesseract motoru aynı anda tek görüntü işler (eşzamanlı istekte boş döner); istekler sıraya alınır
let queue = Promise.resolve();
function scan(args) {
  if (BACKEND !== "snappass") {
    const engine = require("./mrz-engine");
    return engine.recognize(engine.decodeImage(args.imageBase64));
  }
  const run = queue.then(() => scanOnce(args));
  queue = run.catch(() => {});
  return run;
}

// imageBase64: data URL ya da düz base64 (JPEG/PNG). engine: hybrid | paddle | tesseract
function scanOnce({ imageBase64, engine = "hybrid", hotelId = "" }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ imageBase64, engine });
    const req = https.request({
      hostname: OCR_URL.hostname,
      port: OCR_URL.port || 443,
      path: "/api/mrz/scan",
      method: "POST",
      ca: readIf(CERT_FILE) || undefined,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "Cookie": `snappass_token=${mintToken(hotelId)}`,
      },
      timeout: 60000,
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { text += c; });
      res.on("end", () => {
        let data = {};
        try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
        if (res.statusCode !== 200) return reject(new Error(`MRZ motoru hata verdi (HTTP ${res.statusCode}): ${data.detail || data.error || data.raw || ""}`));
        resolve(data);
      });
    });
    req.on("timeout", () => req.destroy(new Error("MRZ motoru zaman aşımı")));
    req.on("error", (e) => reject(new Error(`MRZ motoruna bağlanılamadı (${OCR_URL.origin}): ${e.code || e.message}`)));
    req.end(payload);
  });
}

module.exports = { enabled, scan };
