/* KBS (Emniyet) iç API'si ile giriş / oda değişimi / çıkış. Her işlem kullanıcının açık KBS oturumu üzerinden, tek tek yapılır.
   İstek biçimleri KBS'nin kendi ekranının yaptığı çağrılardan alınmıştır (Konaklayan/*, KPS/MernisNoKontrol). */
const kbs = require("./kbs");

const ZERO_GUID = "00000000-0000-0000-0000-000000000000";
// OPERA'da adlar çoğu zaman Türkçe harfsiz (BICER), KBS'de Türkçe harfli (BİÇER): karşılaştırmada harfler sadeleştirilir
const FOLD = { "İ": "I", "Ş": "S", "Ğ": "G", "Ü": "U", "Ö": "O", "Ç": "C", "Â": "A", "Î": "I", "Û": "U" };
const norm = (s) => String(s ?? "").toLocaleUpperCase("tr-TR").replace(/[İŞĞÜÖÇÂÎÛ]/g, c => FOLD[c]).replace(/\s+/g, " ").trim();

// KBS listesi kimlik/ad/soyadı maskeli ("ES**", "15******850") döndürür: maskenin görünen baş/son kısmıyla eşleştir
function maskMatch(masked, full) {
  const m = String(masked ?? ""), f = norm(full);
  if (!m || !f) return true; // karşılaştıracak veri yoksa elemez
  if (!m.includes("*")) return norm(m) === f;
  const pre = norm(m.slice(0, m.indexOf("*"))), suf = norm(m.slice(m.lastIndexOf("*") + 1));
  return f.startsWith(pre) && (!suf || f.endsWith(suf));
}

async function findGuest(userId, room, it) {
  if (!room) throw new Error("KBS'deki oda numarası bilinmiyor.");
  const r = await kbs.api(userId, "Konaklayan/OdaBazliAktifKonaklayanGetir?odaNo=" + encodeURIComponent(room));
  const list = Array.isArray(r.json?.data) ? r.json.data : [];
  if (!list.length) throw new Error(`KBS'de ${room} numaralı odada aktif konaklayan yok.`);
  const doc = it.idNo || it.docNo || "";
  const cand = list.filter(x =>
    maskMatch(x.adi, it.firstName) && maskMatch(x.soyadi, it.lastName) &&
    (maskMatch(x.kimlikNo, doc) || maskMatch(x.gecerliBelge, doc)));
  if (cand.length !== 1) throw new Error(cand.length ? `KBS'de ${room} odasında birden fazla eşleşen kayıt var.` : `KBS'de ${room} odasında bu misafir bulunamadı.`);
  return cand[0].id;
}

// KBS yanıtındaki kayıt kimliği (varsa): düz GUID metni ya da { id } nesnesi
const guidOf = (d) => { const v = typeof d === "string" ? d : d && typeof d === "object" ? (d.id || d.konaklayanId) : ""; return /^[0-9a-f-]{36}$/i.test(String(v || "")) ? String(v) : ""; };
// T.C. kimlik no standardı: 11 rakam, ilki 0 değil, 10. ve 11. hane sağlama kurallarına uyar
function validTckn(s) {
  if (!/^[1-9]\d{10}$/.test(s)) return false;
  const d = s.split("").map(Number);
  if ((((d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7])) % 10 + 10) % 10 !== d[9]) return false;
  return d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
}

const bad = (j, fallback) => { throw new Error(String(j?.message || fallback).slice(0, 200)); };

async function checkin(userId, it) {
  const room = String(it.room || "").trim();
  if (!room) throw new Error("Oda numarası yok.");
  if (it.kind === "tr") {
    if (!/^\d{11}$/.test(String(it.idNo || ""))) throw new Error("11 haneli T.C. kimlik no gerekli.");
    if (!validTckn(String(it.idNo))) throw new Error("T.C. kimlik no geçersiz (doğrulama kuralına uymuyor).");
    const q = await kbs.api(userId, "KPS/MernisNoKontrol", { method: "POST", body: { tckimlikNo: Number(it.idNo) } });
    if (!q.json?.isSuccess) bad(q.json, "T.C. kimlik no sorgulanamadı.");
    const r = await kbs.api(userId, "Konaklayan/KonaklayanTurkVatandasiEkle", { method: "POST", body: {
      kimlikNo: Number(it.idNo), verilenOda: room, aracPlaka: "", adresIlKodu: 0, adresIlceKodu: 0, cepTelefonu: "", gecerliBelge: "", gunuBirlikId: ZERO_GUID, onaylandiMi: false } });
    if (!r.json?.isSuccess) bad(r.json, "Giriş yapılamadı.");
    return { message: r.json.message || "Giriş yapıldı.", kbsId: guidOf(r.json.data) };
  }
  const dob = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(it.birthDate || ""));
  if (!it.docNo || !it.firstName || !it.lastName || !it.countryId || !dob || !it.birthPlace || !["M", "F"].includes(it.gender)) throw new Error("Eksik bilgi: belge no, ad, soyad, uyruk, doğum tarihi/yeri, cinsiyet.");
  const r = await kbs.api(userId, "Konaklayan/KonaklayanYabanciEkle", { method: "POST", body: {
    gecerliBelge: String(it.docNo), adi: String(it.firstName), soyAdi: String(it.lastName), anaAdi: "", babaAdi: "",
    ulkeKodu: Number(it.countryId), cinsiyet: it.gender === "F" ? 2 : 1, dogumTarihi: `${dob[3]}.${dob[2]}.${dob[1]}`, dogumYeri: String(it.birthPlace),
    verilenOda: room, aracPlaka: "", cepTelefonu: "", adresIlKodu: 0, adresIlceKodu: 0, gunuBirlikId: ZERO_GUID, onaylandiMi: false } });
  if (!r.json?.isSuccess) bad(r.json, "Giriş yapılamadı.");
  return { message: r.json.message || "Giriş yapıldı.", kbsId: guidOf(r.json.data) };
}

async function room(userId, it) {
  const to = String(it.room || "").trim();
  if (!to) throw new Error("Yeni oda numarası yok.");
  const id = /^[0-9a-f-]{36}$/i.test(String(it.kbsId || "")) ? it.kbsId : await findGuest(userId, String(it.oldRoom || "").trim(), it);
  const r = await kbs.api(userId, "Konaklayan/KonaklayanOdaGuncelle", { method: "POST", body: { konaklayanId: id, verilenOda: to } });
  if (!r.json?.isSuccess) bad(r.json, "Oda güncellenemedi.");
  return { message: r.json.message || "Oda güncellendi.", kbsId: id };
}

// KBS'deki aktif konaklayanlar (yalnız okuma). Önce toplu liste, olmazsa oda listesi + oda bazlı liste. Kısa süre önbellekte tutulur.
const activeCache = new Map(); // userId -> { at, list }
// KBS sık istekte 429 verip hesabı/IP'yi sıkıştırdığı için liste 5 dakika önbellekte tutulur; yalnız elle Yenile (fresh), gönderim sonrası ve ilk yükleme KBS'ye gider.
const KBS_LIST_TTL_MS = 5 * 60 * 1000;
const pickList = (d) => Array.isArray(d) ? d : Array.isArray(d?.items) ? d.items : Array.isArray(d?.list) ? d.list : Array.isArray(d?.data) ? d.data : Array.isArray(d?.konaklayanlar) ? d.konaklayanlar : null;
const slim = (x) => ({
  id: String(x.id || x.konaklayanId || ""), room: String(x.verilenOda ?? x.odaNo ?? "").trim(),
  firstName: String(x.adi ?? x.ad ?? ""), lastName: String(x.soyadi ?? x.soyAdi ?? x.soyad ?? ""),
  idNo: String(x.kimlikNo ?? ""), docNo: String(x.gecerliBelge ?? ""), country: String(x.ulkeAdi ?? ""), at: x.gelisTarihi || "",
});
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
// KBS sık istekte 429 (çok istek) verir: bekleyip birkaç kez yeniden dener
async function apiRetry(userId, path, opts) {
  for (let i = 0; ; i++) {
    const r = await kbs.api(userId, path, opts);
    if (r.status !== 429 || i >= 3) return r;
    await sleep(2000 * (i + 1));
  }
}
const roomOf = x => typeof x !== "object" || x === null ? x : (x.odaNo ?? x.verilenOda ?? x.oda ?? x.odaNumarasi ?? x.odaAdi);
// Toplu liste {pageIndex, pageSize} ile tam gelir (2026-10-27 doğrulandı); değişirse diğer adaylar bir kez denenir, tam liste vereni hatırlanır (yalnız okuma)
const PAGE_BODIES = [{ pageIndex: 0, pageSize: 1000 }, {}, { pageNumber: 1, pageSize: 1000 }, { page: 1, pageSize: 1000 }, { skip: 0, take: 1000 }, { sayfaNo: 1, sayfaBoyutu: 1000 }, { start: 0, length: 1000 }];
let pageBody = null, pageTried = false;

const activeBusy = new Map(); // aynı anda gelen istekler tek okumayı paylaşır
// Döner: { list, at }. Okuma eksik/başarısızsa son tam liste (en çok 15 dk önceki) döner; o da yoksa hata fırlatır.
function active(userId, { fresh = false } = {}) {
  const c = activeCache.get(userId);
  if (!fresh && c && Date.now() - c.at < c.ttl) return Promise.resolve(c);
  if (!activeBusy.has(userId)) activeBusy.set(userId, readActive(userId).catch(e => {
    if (c && Date.now() - c.at < 15 * 60000 && !/oturum/i.test(e.message)) { console.warn("[KBS] aktif liste okunamadı, önceki liste kullanılıyor:", e.message); return c; }
    throw e;
  }).finally(() => activeBusy.delete(userId)));
  return activeBusy.get(userId);
}
async function readActive(userId) {
  // Beklenen kişi sayısı oda listesinden gelir; okunan liste bununla tutmazsa eksik sayılır ve asla kullanılmaz
  const rooms = await apiRetry(userId, "Konaklayan/AktifOdaListesiGetir");
  if (!rooms.json?.isSuccess) throw new Error(`KBS oda listesi okunamadı (${rooms.status}).`);
  const roomList = pickList(rooms.json.data) || [];
  const expected = roomList.reduce((n, x) => n + (Number(x?.kisiSayisi) || 0), 0);
  const roomNos = [...new Set(roomList.map(roomOf).filter(Boolean).map(String))];
  let raw = null, ttl = KBS_LIST_TTL_MS;
  if (!expected) raw = [];
  for (const body of raw ? [] : pageBody ? [pageBody] : pageTried ? [] : PAGE_BODIES) {
    await sleep(400);
    const r = await apiRetry(userId, "Konaklayan/AktifKonaklayanGetir", { method: "POST", body });
    const list = pickList(r.json?.data);
    if (!pageBody) console.log(`[KBS] toplu liste denemesi {${Object.keys(body).join(",")}} → ${r.status} ${list ? list.length : "-"}/${expected}`);
    if (list && list.length >= expected) { raw = list; pageBody = body; break; }
  }
  pageTried = true;
  if (!raw) {
    raw = []; ttl = 300000; // oda oda okuma çok çağrı yapar: 5 dk önbellek
    for (const room of roomNos) {
      await sleep(350);
      const q = await apiRetry(userId, "Konaklayan/OdaBazliAktifKonaklayanGetir?odaNo=" + encodeURIComponent(room));
      if (!q.json?.isSuccess) throw new Error(`KBS ${room} odası okunamadı (${q.status}).`);
      raw.push(...(pickList(q.json.data) || []));
    }
  }
  const list = raw.map(slim).filter(x => x.id);
  if (list.length !== expected) throw new Error(`KBS listesi eksik okundu (${list.length}/${expected}).`);
  const out = { list, at: Date.now(), ttl };
  activeCache.set(userId, out);
  return out;
}

async function checkout(userId, it) {
  // KBS listesinden gelen kayıtta konaklayan kimliği bellidir; değilse odada ad/belgeyle aranır
  const id = /^[0-9a-f-]{36}$/i.test(String(it.kbsId || "")) ? it.kbsId : await findGuest(userId, String(it.oldRoom || it.room || "").trim(), it);
  activeCache.delete(userId);
  const r = await kbs.api(userId, "Konaklayan/KonaklayanPasifYap", { method: "POST", body: { konaklayanId: id } });
  if (!r.json?.isSuccess) bad(r.json, "Çıkış yapılamadı.");
  return { message: r.json.message || "Çıkış yapıldı.", kbsId: id };
}

const ACTIONS = { checkin, room, checkout };

// Kayıtları sırayla gönderir; her biri için { profileId, ok, message } döner (biri hata verse de diğerleri denenir)
async function run(userId, action, items) {
  const fn = ACTIONS[action];
  const out = [];
  for (const it of items) {
    try { const res = await fn(userId, it); out.push({ profileId: it.profileId, ok: true, message: String(res.message || "").slice(0, 300), kbsId: res.kbsId || "" }); }
    catch (e) {
      out.push({ profileId: it.profileId, ok: false, message: String(e.message || "Hata").slice(0, 200) });
      if (/oturumu (açık değil|sona erdi)/.test(e.message)) break; // oturum yoksa kalanları denemeye gerek yok
    }
    await new Promise(r => setTimeout(r, 350));
  }
  activeCache.delete(userId); // KBS'deki liste değişti
  return out;
}

module.exports = { run, active, _maskMatch: maskMatch };
