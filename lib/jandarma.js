/* Jandarma KBS (Kimlik Bildirme Sistemi) SOAP servisi: giriş / oda değişimi / çıkış / aktif liste.
   Servis: https://vatandas.jandarma.gov.tr/KBS_Tesis_Servis/SrvShsYtkTml.svc (WCF, BasicHttpBinding + Transport güvenliği).
   Sözleşme (alan adları, SIRASI ve enum değerleri) Protel PMS'in üretilmiş istemcisinden alınmıştır (SrvShsYtkTml.cs);
   WCF DataContract alanları alfabetik sırayla beklenir. Oturum yoktur: her çağrıda KullaniciTC + TssKod (tesis kodu) + Sifre gider.
   Parola günlüğe yazılmaz. Not: bu istemci gerçek servise karşı henüz denenmemiştir (yalnız sahte sunucuyla sınanmıştır). */
const ISO = require("../public/iso-countries");
const COUNTRIES = require("./jandarma-countries.json"); // alpha-3 → Jandarma ülke enum adı

const URL_DEFAULT = process.env.SNAPPASS_JANDARMA_URL || "https://vatandas.jandarma.gov.tr/KBS_Tesis_Servis/SrvShsYtkTml.svc";
const NS_OP = "http://tempuri.org/";
const NS_DC = "http://schemas.datacontract.org/2004/07/KBS_Tesis_Servis";
const TIMEOUT_MS = 60000;

const xe = (v) => String(v ?? "").replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
// xs:dateTime (saat dilimsiz, yerel): 2026-10-29T14:30:00
const dt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const dayOf = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? `${m[1]}-${m[2]}-${m[3]}T00:00:00` : ""; };

// DataContract gövdesi: alanlar verildiği sırayla (çağıran alfabetik verir); boş değerler atlanır
function body(fields) {
  return fields.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `<a:${k}>${xe(v)}</a:${k}>`).join("");
}

function envelope(op, creds, talepName, fields) {
  const { tcNo, tssKod, password } = creds;
  return `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>` +
    `<${op} xmlns="${NS_OP}"><KullaniciTC>${xe(tcNo)}</KullaniciTC><TssKod>${xe(tssKod)}</TssKod><Sifre>${xe(password)}</Sifre>` +
    (talepName ? `<${talepName} xmlns:a="${NS_DC}">${body(fields)}</${talepName}>` : "") +
    `</${op}></s:Body></s:Envelope>`;
}

const tag = (xml, name) => { const m = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml); return m ? m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&") : ""; };

async function call(op, creds, talepName, fields, { url = URL_DEFAULT } = {}) {
  const res = await fetch(url, {
    method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "content-type": "text/xml; charset=utf-8", SOAPAction: `"${NS_OP}ISrvShsYtkTml/${op}"` },
    body: envelope(op, creds, talepName, fields),
  }).catch(e => { throw new Error(e.name === "TimeoutError" ? "Jandarma KBS 60 sn içinde yanıt vermedi." : "Jandarma KBS'ye ulaşılamadı: " + String(e.cause?.code || e.message).slice(0, 100)); });
  const xml = await res.text();
  const fault = tag(xml, "faultstring");
  if (fault) throw new Error("Jandarma KBS hatası: " + fault.slice(0, 200));
  if (!res.ok && !/<(?:\w+:)?Basarili>/.test(xml)) throw new Error(`Jandarma KBS beklenmeyen yanıt verdi (HTTP ${res.status}).`);
  return xml;
}

// Sonuç: { Basarili, HataKodu, Mesaj } (giriş yanıtlarında "sonuc" altında, diğerlerinde doğrudan)
function parseSonuc(xml) {
  // listelerde her kaydın kendi "sonuc"u vardır; listenin sonucu en sonda gelir (alfabetik sıra: mItems, sonuc)
  const all = [...xml.matchAll(/<(?:\w+:)?sonuc(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?sonuc>/g)];
  const scope = all.length ? all[all.length - 1][1] : xml;
  return { ok: /^true$/i.test(tag(scope, "Basarili").trim()), code: tag(scope, "HataKodu").trim(), message: tag(scope, "Mesaj").trim() };
}
const okOrThrow = (xml, fallback) => {
  const s = parseSonuc(xml);
  if (!s.ok) throw new Error((s.message || fallback + (s.code ? ` (${s.code})` : "")).slice(0, 200));
  return s;
};

const nameOf = (nat) => {
  const a3 = (ISO.list.find(c => c.code === String(nat || "").toUpperCase()) || {}).alpha3;
  return a3 ? COUNTRIES[a3] || "" : "";
};
const KUL = "KONAKLAMA";
const when = (it) => { const d = it.arrivalDate ? new Date(it.arrivalDate) : null; return dt(d && !isNaN(d) ? d : new Date()); };

async function checkin(creds, it) {
  const room = String(it.room || "").trim();
  if (!room) throw new Error("Oda numarası yok.");
  if (it.kind === "tr") {
    if (!/^\d{11}$/.test(String(it.idNo || ""))) throw new Error("11 haneli T.C. kimlik no gerekli.");
    const xml = await call("MusteriKimlikNoGiris", creds, "musteri", [
      ["GRSTRH", dt(new Date())], ["ILERITARIHLI", "false"], ["KIMLIKNO", it.idNo], ["KULLANIMSEKLI", KUL], ["ODANO", room], ["ULKKOD", "TURKIYE"]]);
    return { message: okOrThrow(xml, "Giriş yapılamadı.").message || "Giriş yapıldı.", kbsId: "" };
  }
  const country = nameOf(it.nationality);
  const birth = dayOf(it.birthDate);
  if (!it.docNo || !it.firstName || !it.lastName || !country || !birth) throw new Error("Eksik bilgi: belge no, ad, soyad, uyruk, doğum tarihi.");
  const xml = await call("MusteriYabanciGiris", creds, "musteri", [
    ["ADI", it.firstName], ["BELGENO", it.docNo], ["CINSIYET", it.gender === "F" ? "KADIN" : it.gender === "M" ? "ERKEK" : ""], ["DOGUMTARIHI", birth],
    ["GRSTRH", dt(new Date())], ["ILERITARIHLI", "false"], ["KULLANIMSEKLI", KUL], ["ODANO", room], ["SOYADI", it.lastName], ["ULKKOD", country]]);
  return { message: okOrThrow(xml, "Giriş yapılamadı.").message || "Giriş yapıldı.", kbsId: "" };
}

async function room(creds, it) {
  const to = String(it.room || "").trim();
  if (!to) throw new Error("Yeni oda numarası yok.");
  if (it.kind === "tr") {
    const xml = await call("MusteriKimlikNoGuncelle", creds, "musteri", [
      ["GRSTRH", when(it)], ["ILERITARIHLI", "false"], ["KIMLIKNO", it.idNo], ["KULLANIMSEKLI", KUL], ["ODANO", to]]);
    return { message: okOrThrow(xml, "Oda güncellenemedi.").message || "Oda güncellendi.", kbsId: "" };
  }
  const xml = await call("MusteriYabanciGuncelle", creds, "musteri", [
    ["BELGENO", it.docNo], ["GRSTRH", when(it)], ["ILERITARIHLI", "false"], ["KULLANIMSEKLI", KUL], ["ODANO", to]]);
  return { message: okOrThrow(xml, "Oda güncellenemedi.").message || "Oda güncellendi.", kbsId: "" };
}

async function checkout(creds, it) {
  const f = [["CKSTIP", "TESISTENCIKIS"], ["CKSTRH", dt(new Date())]];
  if (it.kind === "tr") {
    const xml = await call("MusteriKimlikNoCikis", creds, "musteri", [...f, ["KIMLIKNO", it.idNo]]);
    return { message: okOrThrow(xml, "Çıkış yapılamadı.").message || "Çıkış yapıldı.", kbsId: "" };
  }
  const xml = await call("MusteriYabanciCikis", creds, "musteri", [["BELGENO", it.docNo], ...f]);
  return { message: okOrThrow(xml, "Çıkış yapılamadı.").message || "Çıkış yapıldı.", kbsId: "" };
}

// Aktif konaklayanlar (yalnız okuma): Türk + yabancı listeleri
function parseList(xml) {
  const out = [];
  for (const m of xml.matchAll(/<(?:\w+:)?(MusteriKimlikNoGirisSonuc|MusteriYabanciGirisSonuc)(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?\1>/g)) {
    const x = m[2];
    const idNo = tag(x, "KIMLIKNO").trim(), docNo = tag(x, "BELGENO").trim();
    out.push({ id: idNo || docNo, room: tag(x, "ODANO").trim(), firstName: tag(x, "ADI").trim(), lastName: tag(x, "SOYADI").trim(), idNo: idNo === "0" ? "" : idNo, docNo, country: "", at: tag(x, "GRSTRH").trim() });
  }
  return out.filter(x => x.id);
}
const LIST_TTL_MS = 5 * 60 * 1000; // liste 5 dakika önbellekte; yalnız elle Yenile / gönderim sonrası servise gider
const cache = new Map(); // anahtar → { at, list }
const busy = new Map();
function active(key, creds, { fresh = false } = {}) {
  const c = cache.get(key);
  if (!fresh && c && Date.now() - c.at < LIST_TTL_MS) return Promise.resolve(c);
  if (!busy.has(key)) busy.set(key, (async () => {
    const a = await call("MusteriKimlikNoListele", creds, null, []);
    const sa = parseSonuc(a); if (!sa.ok && sa.code !== "KayitBulunamadi") throw new Error((sa.message || "Liste okunamadı.").slice(0, 200));
    const b = await call("MusteriYabanciListele", creds, null, []);
    const sb = parseSonuc(b); if (!sb.ok && sb.code !== "KayitBulunamadi") throw new Error((sb.message || "Liste okunamadı.").slice(0, 200));
    const out = { list: [...parseList(a), ...parseList(b)], at: Date.now(), ttl: LIST_TTL_MS };
    cache.set(key, out);
    return out;
  })().finally(() => busy.delete(key)));
  return busy.get(key);
}

const ACTIONS = { checkin, room, checkout };
async function run(key, creds, action, items) {
  const fn = ACTIONS[action], out = [];
  for (const it of items) {
    try { const r = await fn(creds, it); out.push({ profileId: it.profileId, ok: true, message: String(r.message || "").slice(0, 300), kbsId: "" }); }
    catch (e) { out.push({ profileId: it.profileId, ok: false, message: String(e.message || "Hata").slice(0, 200) }); }
    await new Promise(r => setTimeout(r, 350));
  }
  cache.delete(key);
  return out;
}

// Bağlantı denemesi (yalnız okuma): kimlik bilgileri doğruysa liste döner
async function test(key, creds) { const r = await active(key, creds, { fresh: true }); return { count: r.list.length }; }

module.exports = { run, active, test, _envelope: envelope, _parseList: parseList, _parseSonuc: parseSonuc, _nameOf: nameOf };
