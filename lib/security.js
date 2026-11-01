/* ─── Güvenlik yardımcıları ───────────────────────────────────────────────
   Gizli anahtar (data/secret.key), AES-256-GCM şifreleme, PBKDF2 parola özeti,
   imzalı oturum çerezi ve tek kullanımlık token'lar. TGA'daki security.py karşılığı.
── */
const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");

const DATA_DIR = process.env.SNAPPASS_DATA_DIR || path.join(__dirname, "..", "data");
const KEY_FILE = path.join(DATA_DIR, "secret.key");

// İlk çalıştırmada üretilir; yedeklenmeli (şifreli OHIP/SMTP bilgileri bu anahtarla açılır)
function loadKey() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(KEY_FILE)) {
    fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString("base64"), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(KEY_FILE, "utf8").trim(), "base64");
}
const MASTER_KEY  = loadKey();
const ENC_KEY     = crypto.createHmac("sha256", MASTER_KEY).update("enc").digest();
const SESSION_KEY = crypto.createHmac("sha256", MASTER_KEY).update("session").digest();

function encryptJson(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}

function decryptJson(text, fallback = {}) {
  if (!text) return fallback;
  try {
    const [, iv, tag, ct] = text.split(".");
    const decipher = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8"));
  } catch {
    return fallback;
  }
}

/* Parola: pbkdf2$240000$<salt>$<digest> (TGA ile aynı biçim) */
const PBKDF2_ITER = 240000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const digest = crypto.pbkdf2Sync(password, salt, PBKDF2_ITER, 32, "sha256");
  return `pbkdf2$${PBKDF2_ITER}$${salt.toString("base64")}$${digest.toString("base64")}`;
}

function verifyPassword(password, stored) {
  if (!stored || !password) return false;
  const [algo, iter, salt, digest] = stored.split("$");
  if (algo !== "pbkdf2") return false;
  const expected = Buffer.from(digest, "base64");
  const actual = crypto.pbkdf2Sync(password, Buffer.from(salt, "base64"), Number(iter), expected.length, "sha256");
  return crypto.timingSafeEqual(actual, expected);
}

// En az 8 karakter, harf + rakam, kullanıcı adını içermemeli
function passwordError(password, username) {
  if (!password || password.length < 8) return "Parola en az 8 karakter olmalı.";
  if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(password) || !/\d/.test(password)) return "Parola harf ve rakam içermeli.";
  if (username && password.toLowerCase().includes(String(username).toLowerCase())) return "Parola kullanıcı adını içermemeli.";
  return null;
}

const newToken  = () => crypto.randomBytes(32).toString("base64url");
const sha256Hex = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/* İmzalı oturum çerezi: base64url(JSON).HMAC */
function signSession(data) {
  const body = Buffer.from(JSON.stringify(data)).toString("base64url");
  const mac = crypto.createHmac("sha256", SESSION_KEY).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function readSession(cookie) {
  if (!cookie || !cookie.includes(".")) return null;
  const [body, mac] = cookie.split(".");
  const expected = crypto.createHmac("sha256", SESSION_KEY).update(body).digest("base64url");
  if (!safeEqual(mac, expected)) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
}

module.exports = {
  DATA_DIR, encryptJson, decryptJson, hashPassword, verifyPassword, passwordError,
  newToken, sha256Hex, safeEqual, signSession, readSession,
};
