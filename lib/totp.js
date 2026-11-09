/* ─── Authenticator (TOTP, RFC 6238) ──────────────────────────────────────
   Google Authenticator, Microsoft Authenticator vb. ile uyumlu: SHA-1, 6 hane, 30 sn.
   Protel yöneticilerinin Google girişinden sonraki ikinci adımı.
── */
const crypto = require("crypto");
const qrcode = require("qrcode-generator");

const ISSUER = "SnapPass";
const PERIOD = 30;
const DIGITS = 6;
const WINDOW = 1; // saat kayması için ±1 adım (±30 sn)
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const c of String(str).toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    value = (value << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const newSecret = () => base32Encode(crypto.randomBytes(20));
const currentStep = (now = Date.now()) => Math.floor(now / 1000 / PERIOD);

function codeAt(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1] & 15;
  return String((h.readUInt32BE(off) & 0x7fffffff) % 10 ** DIGITS).padStart(DIGITS, "0");
}

// Kod doğruysa eşleşen adımı döner (aynı kodun tekrar kullanılmasını engellemek için saklanır), değilse null.
// lastStep: bu hesapta en son kabul edilen adım; ondan eski ya da eşit adımlar reddedilir.
function verify(secret, code, lastStep = 0) {
  code = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const now = currentStep();
  for (let s = now - WINDOW; s <= now + WINDOW; s++) {
    if (s <= lastStep) continue;
    if (crypto.timingSafeEqual(Buffer.from(codeAt(secret, s)), Buffer.from(code))) return s;
  }
  return null;
}

function otpauthUri(secret, account) {
  const label = encodeURIComponent(`${ISSUER}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`;
}

function qrSvg(text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true });
}

// Elle girişte okunması kolay olsun diye 4'lü gruplar
const formatSecret = (secret) => secret.replace(/(.{4})/g, "$1 ").trim();

module.exports = { newSecret, verify, codeAt, currentStep, otpauthUri, qrSvg, formatSecret, ISSUER };
