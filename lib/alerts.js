/* Sistem uyarıları (OHIP hataları). Otel bazlıdır; kişi verisi içermez.
   - raise: hata olunca açık uyarı oluşturur ya da aynı uyarıyı günceller (tekrar sayısı artar)
   - resolve: aynı kaynakta (ohip) bir başarı olunca otelin açık uyarıları kapanır
   - list / markSeen: kullanıcı uyarıları görür; her kullanıcı bir uyarıyı ilk kez gördüğünde popup gösterilir */
const db = require("./db");

const open = new Set();           // "OTEL|kaynak" -> açık uyarısı var (her başarılı çağrıda veritabanına gitmemek için)
const lastRaise = new Map();      // "OTEL|kaynak|kod" -> son yazma zamanı (sık tekrarlarda veritabanını yormamak için)
let loaded = false;

async function init() {
  if (loaded) return;
  loaded = true;
  try {
    const rows = await db.all("SELECT DISTINCT hotel_code, source FROM alerts WHERE resolved_at IS NULL");
    for (const r of rows) open.add(`${r.hotel_code}|${r.source}`);
  } catch (_) { loaded = false; }
}

const norm = (h) => String(h || "").trim().toUpperCase().slice(0, 30);

async function raise({ hotelCode, source, code, message }) {
  const hotel = norm(hotelCode);
  if (!hotel || !source || !code) return;
  const k = `${hotel}|${source}|${code}`;
  const now = Date.now();
  if (now - (lastRaise.get(k) || 0) < 20000 && open.has(`${hotel}|${source}`)) return; // 20 sn içinde tekrar yazma
  lastRaise.set(k, now);
  try {
    const upd = await db.query(
      "UPDATE alerts SET last_at=now(), n=n+1, message=$4 WHERE hotel_code=$1 AND source=$2 AND code=$3 AND resolved_at IS NULL RETURNING id",
      [hotel, source, code, String(message || "").slice(0, 300)]);
    if (!upd.rows.length) {
      await db.query("INSERT INTO alerts(hotel_code, source, code, message) VALUES($1,$2,$3,$4)", [hotel, source, code, String(message || "").slice(0, 300)]);
      console.warn(`[UYARI] ${hotel} ${source}/${code}: ${message}`);
    }
    open.add(`${hotel}|${source}`);
  } catch (e) { console.warn("[UYARI] yazılamadı:", e.message); }
}

async function resolve({ hotelCode, source }) {
  const hotel = norm(hotelCode);
  if (!hotel || !open.has(`${hotel}|${source}`)) return;
  open.delete(`${hotel}|${source}`);
  try {
    await db.query("UPDATE alerts SET resolved_at=now() WHERE hotel_code=$1 AND source=$2 AND resolved_at IS NULL", [hotel, source]);
  } catch (e) { open.add(`${hotel}|${source}`); }
}

// Zincirdeki (Enterprise) tüm otellere: jeton hatası gibi otel koduna bağlı olmayan OHIP hataları
async function chainHotels(chainId) {
  const rows = await db.all("SELECT hotel_code FROM hotels WHERE chain_id=$1 AND hotel_code<>''", [chainId]);
  return rows.map(r => r.hotel_code);
}
async function raiseChain(chainId, source, code, message) { for (const h of await chainHotels(chainId)) await raise({ hotelCode: h, source, code, message }); }
async function resolveChain(chainId, source) { for (const h of await chainHotels(chainId)) await resolve({ hotelCode: h, source }); }

// Otelin uyarıları: açık olanlar + son 24 saatte kapananlar; kullanıcı için görüldü bilgisiyle
async function list(hotelCode, userId) {
  const rows = await db.all(
    `SELECT a.id, a.source, a.code, a.message, a.n, a.first_at, a.last_at, a.resolved_at,
            EXISTS (SELECT 1 FROM alert_seen s WHERE s.alert_id=a.id AND s.user_id=$2) AS seen
       FROM alerts a
      WHERE a.hotel_code=$1 AND (a.resolved_at IS NULL OR a.resolved_at > now() - interval '24 hours')
      ORDER BY (a.resolved_at IS NULL) DESC, a.last_at DESC LIMIT 30`, [norm(hotelCode), userId]);
  return rows.map(r => ({
    id: String(r.id), source: r.source, code: r.code, message: r.message, count: r.n,
    firstAt: r.first_at, lastAt: r.last_at, resolved: !!r.resolved_at, seen: !!r.seen,
  }));
}

async function markSeen(userId, ids) {
  const list = [...new Set((ids || []).map(x => Number(x)).filter(Number.isFinite))].slice(0, 50);
  for (const id of list) {
    await db.query("INSERT INTO alert_seen(user_id, alert_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [userId, id]);
  }
}

// Yönetici: tüm oteller (açık + son 7 gün)
async function listAll() {
  return db.all(
    `SELECT a.id, a.hotel_code, a.source, a.code, a.message, a.n, a.first_at, a.last_at, a.resolved_at
       FROM alerts a WHERE a.resolved_at IS NULL OR a.resolved_at > now() - interval '7 days'
      ORDER BY (a.resolved_at IS NULL) DESC, a.last_at DESC LIMIT 200`);
}

module.exports = { init, raise, resolve, raiseChain, resolveChain, list, markSeen, listAll };
