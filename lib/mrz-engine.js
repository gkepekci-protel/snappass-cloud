/* ─── MRZ OCR motoru (Tesseract 5, tesseract.js) ──────────────────────────
   SnapPass.Service'in Tesseract motorunun açık kaynak karşılığı:
     LSTM, MRZ karakter listesi, sözlükler kapalı, tek blok (PSM 6), mrz.traineddata
     tüm görüntü + alt %40 okunur, MRZ'ye daha çok benzeyen metin ayrıştırılır (MrzScannerService)
   Hem bulut OCR (proxy içinde) hem resepsiyon terminalindeki yerel araç (ocr-agent.js) bunu kullanır.
   İşçi sayısı: SNAPPASS_OCR_WORKERS (varsayılan: çekirdek sayısı - 1)
── */
const os   = require("os");
const path = require("path");
const { createWorker, OEM, PSM } = require("tesseract.js");
const MRZ  = require("../public/mrz-parser");

const MODEL_DIR = process.env.SNAPPASS_OCR_MODEL_DIR || path.join(__dirname, "..", "ocr-models");
const POOL_SIZE = Math.max(1, Number(process.env.SNAPPASS_OCR_WORKERS) || os.cpus().length - 1);
const WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";

// PNG / JPEG boyutunu başlıktan okur (kırpma dikdörtgeni için)
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  throw new Error("Görüntü PNG ya da JPEG olmalı");
}

async function newWorker() {
  const worker = await createWorker("mrz", OEM.LSTM_ONLY, {
    langPath: MODEL_DIR,
    gzip: false,
    cacheMethod: "none",
  }, {
    load_system_dawg: "0",
    load_freq_dawg: "0",
  });
  await worker.setParameters({ tessedit_char_whitelist: WHITELIST, tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  return worker;
}

/* ── İşçi havuzu: her iş boştaki bir işçide çalışır, işçiler ilk kullanımda açılır ── */
const idle = [];
const waiting = [];
let created = 0;

async function acquire() {
  if (idle.length) return idle.pop();
  if (created < POOL_SIZE) { created++; try { return await newWorker(); } catch (e) { created--; throw e; } }
  return new Promise((resolve) => waiting.push(resolve));
}

function release(worker) {
  const next = waiting.shift();
  if (next) next(worker); else idle.push(worker);
}

// buffer: JPEG/PNG. Dönüş: SnapPass /api/mrz/scan ile aynı biçim (firstName, rawMrz, checksum, ...)
async function recognize(buffer) {
  const { width, height } = imageSize(buffer);
  const worker = await acquire();
  try {
    const full = (await worker.recognize(buffer)).data.text || "";
    const top = Math.floor(height * 0.6);
    const crop = (await worker.recognize(buffer, { rectangle: { left: 0, top, width, height: height - top } })).data.text || "";
    const useCrop = MRZ.scoreMrzLikeness(crop) > MRZ.scoreMrzLikeness(full);
    const parsed = MRZ.parse(useCrop ? crop : full);
    return { ...MRZ.toMrzResult(parsed), strategy: useCrop ? "bottom-crop-40%" : "full-image" };
  } finally {
    release(worker);
  }
}

// data URL ya da düz base64
function decodeImage(imageBase64) {
  const s = String(imageBase64 || "");
  return Buffer.from(s.includes(",") ? s.slice(s.indexOf(",") + 1) : s, "base64");
}

const stats = () => ({ poolSize: POOL_SIZE, workers: created, idle: idle.length, queued: waiting.length });

module.exports = { recognize, decodeImage, stats };
