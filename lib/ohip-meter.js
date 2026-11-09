/* OHIP çağrı sayacı: sunucudan OHIP'e (OPERA Cloud) giden her isteği otel ve tür bazında sayar, günlük olarak veritabanına yazar.
   Kapasite planlaması ve kota takibi içindir; istek içeriği, kişi ya da kimlik verisi tutulmaz. */
const crypto = require("crypto");
const db = require("./db");
const alerts = require("./alerts");

const realFetch = globalThis.fetch.bind(globalThis);
const buf = new Map(); // "YYYY-MM-DD|OTEL|tür" -> sayı
let timer = null;

// Yalnız OHIP yolları sayılır (Google, SMTP vb. sayılmaz)
function classify(url, method) {
  const u = String(url);
  const m = String(method || "GET").toUpperCase();
  if (/\/oauth\/v1\/tokens/i.test(u)) return "token";
  if (/\/rsv\/v1\//.test(u)) return m === "GET" ? "rezervasyon-okuma" : "rezervasyon-yazma";
  if (/\/crm\/v1\/profilesByIds/.test(u)) return "profil-okuma";
  if (/\/crm\/v1\/profiles/.test(u)) return m === "GET" ? "profil-arama" : "profil-yazma";
  if (/\/ent\/|\/config\/v1\//.test(u)) return "tanim";
  return null;
}

const dayKey = () => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

// Uygulama anahtarının kısa özeti (anahtarın kendisi saklanmaz)
const appKeyTag = (appKey) => appKey ? "@" + crypto.createHash("sha256").update(String(appKey)).digest("hex").slice(0, 12) : "";

function count(url, opts) {
  const kind = classify(url, opts && opts.method);
  if (!kind) return;
  const h = (opts && opts.headers) || {};
  const hotel = String(h["x-hotelid"] || h["X-HotelId"] || "").toUpperCase().slice(0, 30);
  if (!hotel) return; // yalnız otel çağrıları sayılır; jeton ve tanım çağrıları (otel kodu taşımayan) sayaca girmez
  const k = `${dayKey()}|${hotel}|${kind}`;
  buf.set(k, (buf.get(k) || 0) + 1);
}

// OHIP yanıtını izler: sunucu/yetki/kota hatasında otel için uyarı açar, başarılı yanıtta kapatır (kişi verisi yazılmaz)
function judge(res) {
  const st = res && res.status;
  if (!st) return null;
  if (st === 401 || st === 403) return { code: "auth", message: "OHIP erişim yetkisi reddedildi (" + st + "). OHIP tanımlarını/yetkileri kontrol edin." };
  if (st === 429) return { code: "rate", message: "OHIP çağrı sınırına takıldı (429). Bir süre sonra tekrar denenir; yenileme sıklığı azaltılabilir." };
  if (st >= 500) return { code: "server", message: "OHIP sunucusu hata verdi (" + st + "). OPERA tarafı geçici olarak yanıt vermiyor olabilir." };
  if (st < 400) return "ok";
  return null; // 400/404 gibi içerik hataları sistem uyarısı değildir
}
function watch(url, opts, p) {
  try {
    if (!classify(url, opts && opts.method)) return p;
    const h = (opts && opts.headers) || {};
    const hotelCode = String(h["x-hotelid"] || h["X-HotelId"] || "");
    if (!hotelCode) return p; // jeton çağrıları: chainToken kendisi bildirir
    p.then(res => {
      const j = judge(res);
      if (j === "ok") alerts.resolve({ hotelCode, source: "ohip" });
      else if (j) alerts.raise({ hotelCode, source: "ohip", ...j });
    }, err => {
      alerts.raise({ hotelCode, source: "ohip", code: "unreachable", message: "OHIP'e ulaşılamadı (" + String((err && (err.code || err.name)) || "hata").slice(0, 40) + "). Bağlantı/ağ kontrol edilmeli." });
    }).catch(() => {});
  } catch (_) {}
  return p;
}

async function flush() {
  if (!buf.size) return;
  const items = [...buf.entries()];
  buf.clear();
  for (const [k, n] of items) {
    const [day, hotel, kind] = k.split("|");
    try {
      await db.query(
        "INSERT INTO ohip_calls(day, hotel_code, kind, n) VALUES($1,$2,$3,$4) ON CONFLICT(day, hotel_code, kind) DO UPDATE SET n = ohip_calls.n + EXCLUDED.n",
        [day, hotel, kind, n]);
    } catch (e) { buf.set(k, (buf.get(k) || 0) + n); } // yazılamazsa sonraki turda tekrar dene
  }
}

function install() {
  if (globalThis.__ohipMeter) return;
  globalThis.__ohipMeter = true;
  globalThis.fetch = (url, opts) => { try { count(url, opts); } catch (_) {} return watch(url, opts, realFetch(url, opts)); };
  timer = setInterval(() => { flush().catch(() => {}); }, 30 * 1000);
  if (timer.unref) timer.unref();
  const bye = () => { flush().finally(() => process.exit(0)); };
  process.once("SIGINT", bye); process.once("SIGTERM", bye);
}

// Otel için son günler ve bu ay: { days: [{day, total, kinds:{}}], month: {total, kinds:{}} }
async function usage(hotelCode, daysBack = 14) {
  const code = String(hotelCode || "").toUpperCase();
  await flush().catch(() => {});
  const rows = (await db.query(
    "SELECT to_char(day,'YYYY-MM-DD') AS day, kind, n FROM ohip_calls WHERE hotel_code=$1 AND day >= LEAST(date_trunc('month', now())::date, now()::date - $2::int) ORDER BY day DESC",
    [code, daysBack])).rows;
  const byDay = new Map(); const month = { total: 0, kinds: {} };
  const monthPrefix = dayKey().slice(0, 7);
  for (const r of rows) {
    const d = byDay.get(r.day) || { day: r.day, total: 0, kinds: {} };
    d.total += r.n; d.kinds[r.kind] = (d.kinds[r.kind] || 0) + r.n; byDay.set(r.day, d);
    if (r.day.startsWith(monthPrefix)) { month.total += r.n; month.kinds[r.kind] = (month.kinds[r.kind] || 0) + r.n; }
  }
  return { days: [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, daysBack), month };
}

module.exports = { install, usage, flush, count, watch, appKeyTag, _classify: classify };
