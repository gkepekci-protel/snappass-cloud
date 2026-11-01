/**
 * SnapPass — OPERA Cloud API Proxy Server
 * ----------------------------------------
 * Çalıştırmak için:
 *   npm install
 *   node server.js
 *
 * Ardından tarayıcıda: http://localhost:3000
 */

const express  = require("express");
const cors     = require("cors");
const meter    = require("./lib/ohip-meter"); // OHIP çağrı sayacı (otel ve tür bazında, günlük)
const fetch    = (...args) => { try { meter.count(args[0], args[1]); } catch (_) {} return meter.watch(args[0], args[1], import("node-fetch").then(({ default: f }) => f(...args))); };
const path     = require("path");
const fs       = require("fs");
const fsp      = require("fs/promises");
const web      = require("./lib/web");
const db       = require("./lib/db");
meter.install(); // global fetch kullanan modüller (jeton, web.js) için

const app  = express();
const PORT = 3000;
const DEBUG_DIR = path.join(__dirname, "temp");
// Tarama hata ayıklama kayıtları (kimlik karesi, MRZ satırları, misafir adı) varsayılan olarak SAKLANMAZ.
// Yalnız geliştirme/inceleme için SNAPPASS_MRZ_DEBUG=1 ile açılır.
const MRZ_DEBUG_ON = process.env.SNAPPASS_MRZ_DEBUG === "1";

app.set("trust proxy", true);
app.use(cors());
app.use(express.json({ limit: "12mb" }));
// Giriş, davetiye, 2FA, Protel yönetim ekranları ve /api oturum kontrolü (lib/web.js)
app.use(web.router);

// Sayfa sürümü: app.bundle.js'in değişim zamanı. Paketin başına yazılır; açık kalan (eski) sayfalar /api/version ile kendi sürümünü
// karşılaştırıp "yeni sürüm var" uyarısı gösterir (telefonlarda sekmeler günlerce açık kalabiliyor).
const BUNDLE_FILE = path.join(__dirname, "public", "app.bundle.js");
const bundleVersion = () => { try { return String(Math.round(fs.statSync(BUNDLE_FILE).mtimeMs)); } catch { return ""; } };
app.get("/app.bundle.js", async (req, res) => {
  try {
    const code = fs.readFileSync(BUNDLE_FILE, "utf8");
    // Kurulumdaki varsayılan dil (kullanıcı kendi dilini seçmediyse bu kullanılır)
    let lang = "tr";
    try { lang = (await db.getSetting("default_lang")) === "en" ? "en" : "tr"; } catch (_) {}
    res.set({ "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0" });
    console.log(`[BUNDLE] paket verildi v=${bundleVersion()} dil=${lang} istemci=${String(req.headers["user-agent"] || "").slice(0, 60)}`);
    res.send(`window.__SP_VERSION=${JSON.stringify(bundleVersion())};window.__SP_DEFAULT_LANG=${JSON.stringify(lang)};\n${code}`);
  } catch (e) { res.status(500).send("// paket okunamadı"); }
});
app.get("/api/version", (req, res) => res.set("Cache-Control", "no-store").json({ v: bundleVersion() }));

app.use(express.static(path.join(__dirname, "public"), {
  index: false,
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
})); // React build buraya gelecek

/* ─── Sağlık kontrolü ──────────────────────────────────────────────────── */
app.get("/health", (_, res) => res.json({ status: "ok", time: new Date().toISOString() }));

/* ─── MRZ Debug Log ─────────────────────────────────────────────────────── */
app.post("/api/debug-log", async (req, res) => {
  if(!MRZ_DEBUG_ON) return res.json({ ok:true, skipped:true });
  try{
    const rawSessionId = String(req.body?.sessionId || "mrz-debug").trim();
    const sessionId = rawSessionId.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) || "mrz-debug";
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if(!lines.length) return res.json({ ok:true, skipped:true });

    await fsp.mkdir(DEBUG_DIR, { recursive:true });
    const filePath = path.join(DEBUG_DIR, `${sessionId}.txt`);
    const fileExists = fs.existsSync(filePath);
    const guest = req.body?.guest ? `guest=${JSON.stringify(req.body.guest)}` : "";
    const payload = lines
      .map(line => typeof line === "string" ? line : JSON.stringify(line))
      .join("\n");
    const header = !fileExists && guest ? `${guest}\n` : "";
    const text = `${header}${payload}\n`;
    await fsp.appendFile(filePath, text, "utf8");
    return res.json({ ok:true, path:filePath });
  }catch(err){
    console.error("[DEBUG-LOG] write error:", err.message);
    return res.status(500).json({ ok:false, error:err.message });
  }
});

app.post("/api/debug-image", async (req, res) => {
  if(!MRZ_DEBUG_ON) return res.json({ ok:true, skipped:true });
  try{
    const rawSessionId = String(req.body?.sessionId || "mrz-debug").trim();
    const sessionId = rawSessionId.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) || "mrz-debug";
    const rawLabel = String(req.body?.label || "artifact").trim();
    const label = rawLabel.replace(/[^a-z0-9_-]/gi, "_").replace(/_+/g, "_").slice(0, 80) || "artifact";
    const imageData = String(req.body?.imageData || "");
    const match = imageData.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
    if(!match) return res.status(400).json({ ok:false, error:"Invalid image data" });

    const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
    const buffer = Buffer.from(match[2], "base64");
    await fsp.mkdir(DEBUG_DIR, { recursive:true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(DEBUG_DIR, `${sessionId}__${stamp}__${label}.${ext}`);
    await fsp.writeFile(filePath, buffer);
    return res.json({ ok:true, path:filePath });
  }catch(err){
    console.error("[DEBUG-IMG] write error:", err.message);
    return res.status(500).json({ ok:false, error:err.message });
  }
});

/* ─── Tesseract CDN proxy ─────────────────────────────────────────────────
   Tesseract worker, core (wasm) ve traineddata dosyalarını CDN'den proxy'le
── */
const TESS_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@4.1.2/dist";
const TESS_CORE_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js-core@4.0.4";
const TESS_LANG_CDN = "https://tessdata.projectnaptha.com/4.0.0";

app.get("/tess-worker.js", async (req, res) => {
  try {
    const r = await fetch(`${TESS_CDN}/worker.min.js`);
    res.set("Content-Type","application/javascript");
    res.send(await r.text());
  } catch(e) { res.status(502).send("// CDN error: "+e.message); }
});

app.get("/tesseract-core.wasm.js", async (req, res) => {
  try {
    const r = await fetch(`${TESS_CORE_CDN}/tesseract-core.wasm.js`);
    res.set("Content-Type","application/javascript");
    res.send(await r.text());
  } catch(e) { res.status(502).send("// CDN error: "+e.message); }
});

app.get("/tesseract-core.wasm", async (req, res) => {
  try {
    const r = await fetch(`${TESS_CORE_CDN}/tesseract-core.wasm`);
    if(!r.ok) return res.status(r.status).end();
    res.set("Content-Type","application/wasm");
    const buf = await r.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch(e) { res.status(502).end(); }
});

app.get("/tessdata/:lang.traineddata.gz", async (req, res) => {
  try {
    const lang = req.params.lang.replace(/[^a-z_]/gi,"");
    const r = await fetch(`${TESS_LANG_CDN}/${lang}.traineddata.gz`);
    if(!r.ok) return res.status(r.status).end();
    res.set("Content-Type","application/octet-stream");
    const buf = await r.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch(e) { res.status(502).end(); }
});


/* ─── OPERA Reservation Search ──────────────────────────────────────────
   GET /api/search?hostName=...&hotelId=...&appKey=...&token=...&byType=lastName|roomId|confirmationNo&query=...&tab=arrivals|inhouse
── */
app.get("/api/search", async (req, res) => {
  const { hostName, hotelId, appKey, byType, query, tab, all, depFrom, depTo } = req.query;
  // Token'ı header'dan al (URL limit sorununu önler)
  const token = req.headers["x-opera-token"] || req.query.token;

  if (!hostName || !hotelId || !appKey || !token || !query) {
    return res.status(400).json({ error: "Eksik parametre: " + JSON.stringify({hostName:!!hostName,hotelId:!!hotelId,appKey:!!appKey,token:!!token,query:!!query}) });
  }
  // Kimlik okuma ekranları yalnız aranan kaydı görür: boş, joker (%, *) ya da çok kısa soyad aramaları reddedilir.
  // Tek istisna: KBS Gönderim listesi (all=1) ve yalnız KBS'si açık otelde.
  const rawQ = String(query || "");
  const hasWildcard = /[%*]/.test(rawQ);
  const bare = rawQ.replace(/[%*\s]/g, "");
  const tooBroad = !bare || hasWildcard || (byType === "lastName" && bare.length < 2);
  if (tooBroad) {
    const listAll = all === "1" && rawQ.trim() === "%" && byType === "lastName" && await web.kbsHotelOn(req).catch(() => false);
    if (!listAll) return res.status(400).json({ error: "Arama ölçütü gerekli: soyad (en az 2 harf), oda no ya da rezervasyon no girin." });
  }

  const searchType = tab === "inhouse" ? "InHouse" : tab === "checkedout" ? "CheckedOut" : "Arrival";
  // checkedout (KBS düşüm adayları): isteğe bağlı çıkış tarihi aralığı (YYYY-MM-DD)
  const isoDay = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
  const depRange = tab === "checkedout" && isoDay(depFrom) && isoDay(depTo) ? `&departureStartDate=${isoDay(depFrom)}&departureEndDate=${isoDay(depTo)}` : "";
  const rsvBase = `${hostName}/rsv/v1/hotels/${encodeURIComponent(hotelId)}/reservations`;
  // "%" = tümü listelensin (oda sırasıyla görüntülemek için sınır yüksek); aksi hâlde kısa liste
  const listLimit = query === "%" ? 100 : 20;
  const url = byType === "confirmationNo"
    ? `${rsvBase}?confirmationNumberList=${encodeURIComponent(query)}&fetchInstructions=Reservation`
    : byType === "roomId"
      ? `${rsvBase}?roomId=${encodeURIComponent(query)}&searchType=${searchType}&fetchInstructions=Reservation&limit=50&excludePseudoRoomReservations=true`
      : `${rsvBase}?surname=${encodeURIComponent(query)}&searchType=${searchType}&=Reservation&fetchInstructions=Reservation&limit=${listLimit}${depRange}&excludePseudoRoomReservations=true`;

  console.log(`[SEARCH] GET ${url}`);
  console.log(`[SEARCH] hotelId=${hotelId} byType=${byType} query="${query}" tab=${tab} tokenLen=${token?.length}`);
  const allowedStatuses = tab === "inhouse"
    ? ["InHouse","CheckedIn","Checkedin","CHECKED_IN","inhouse"]
    : ["Reserved","Arrival","DueIn","Due In","due_in","RESERVED","Confirmed","confirmed"];

  try {
    const upstream = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "x-hotelid":    hotelId,
        "x-app-key":    appKey,
        "Authorization": `Bearer ${token}`,
      },
    });

    console.log(`[SEARCH] → HTTP ${upstream.status}`);

    if (upstream.status === 204) return res.status(204).end();

    let text = await upstream.text();
    // all=1 (KBS listesi): tüm sayfalar birleştirilir (OPERA sayfa başına en çok ~100 kayıt döner)
    if (all === "1" && query === "%" && byType === "lastName" && upstream.ok) {
      try {
        const first = JSON.parse(text);
        let more = first?.reservations?.hasMore === true || first?.reservations?.hasMore === "true";
        let offset = (first?.reservations?.reservationInfo ?? []).length;
        for (let page = 0; more && page < 30; page++) {
          const r2 = await fetch(`${url}&offset=${offset}`, { headers: { "Content-Type":"application/json", "x-hotelid":hotelId, "x-app-key":appKey, "Authorization":`Bearer ${token}` } });
          if (!r2.ok) break;
          const d2 = await r2.json();
          const got = d2?.reservations?.reservationInfo ?? [];
          if (!got.length) break;
          first.reservations.reservationInfo.push(...got);
          offset += got.length;
          more = d2?.reservations?.hasMore === true || d2?.reservations?.hasMore === "true";
        }
        text = JSON.stringify(first);
      } catch (e) { console.warn("[SEARCH] sayfalama hatası:", e.message); }
    }
    // childAges debug — ilk rezervasyonun roomStay'ini logla
    try {
      const d = JSON.parse(text);
      const first = d?.reservations?.reservationInfo?.[0];
      if (first) {
        const rs = first.roomStay || {};
        const rg = first?.reservationGuest ?? {};
        console.log("[SEARCH] adultCount:", rs.adultCount, "childCount:", rs.childCount);
        // Log all reservations with their accompanyGuests
        const allRsv = d?.reservations?.reservationInfo ?? [];
        allRsv.forEach(r => {
          const confId = (r.reservationIdList||[]).find(i=>i.type==="Confirmation")?.id;
          const resId  = (r.reservationIdList||[]).find(i=>i.type==="Reservation")?.id;
          const ag = r.reservationGuest?.accompanyGuests ?? [];
          if(ag.length) console.log(`[SEARCH] rsv=${resId} conf=${confId} accompany:`, JSON.stringify(ag.map(a=>({fn:a.firstName,ln:a.lastName,pid:[].concat(a.profileIdList??[]).find(p=>p.type==="Profile")?.id}))));
        });
      }
    } catch(_) {}
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    // Tab'a göre status filtrele — OPERA searchType bazen Checkout'ları da getiriyor
    const reservations = data?.reservations?.reservationInfo ?? [];
    if (reservations.length && tab) {
      const filtered = reservations.filter(r => {
        const st = (r?.reservationStatus ?? r?.computedReservationStatus ?? "").toLowerCase().replace(/[_\s]/g,"");
        if (tab === "inhouse")   return ["inhouse","checkedin"].includes(st);
        if (tab === "checkedout") return ["checkedout"].includes(st);
        if (tab === "arrivals")  return ["reserved","arrival","duein","confirmed"].includes(st);
        return true;
      });
      console.log(`[SEARCH] status filter: total=${reservations.length} → filtered=${filtered.length} (tab=${tab})`);
      if (data.reservations) data.reservations.reservationInfo = filtered;
    }

    res.status(upstream.status).json(data);
  } catch (err) {
    console.error("[SEARCH] Fetch error:", err.message);
    res.status(502).json({ error: "Upstream bağlantı hatası", detail: err.message });
  }
});




/* ─── GET Profile Search ────────────────────────────────────────────────────
   GET /api/profile-search?hostName=...&hotelId=...&appKey=...&token=...&firstName=...&lastName=...
── */
app.get("/api/profile-search", async (req, res) => {
  const { hostName, hotelId, appKey, token, firstName, lastName } = req.query;
  if (!hostName || !hotelId || !appKey || !token) return res.status(400).json({ error: "Eksik alan" });
  const headers = { "Content-Type":"application/json", "x-hotelid":hotelId, "x-app-key":appKey, "Authorization":`Bearer ${token}` };
  const params = new URLSearchParams({ profileType:"Guest", summaryInfo:"true", searchType:"Any" });
  // % wildcard: girilen değerin sonuna ekle — OPERA "starts with" mantığında çalışır
  if (lastName)  params.set("profileName", lastName + "%");
  if (firstName) params.set("givenName",   firstName + "%");
  const url = `${hostName}/crm/v1/profiles?${params}`;
  console.log(`[PROFILE-SEARCH] GET ${url}`);
  try {
    const upstream = await fetch(url, { headers });
    const text = await upstream.text();
    console.log(`[PROFILE-SEARCH] → HTTP ${upstream.status}  ${text.slice(0,200)}`);
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    res.status(upstream.status).json(data);
  } catch(err) { res.status(502).json({ error: err.message }); }
});

/* ─── POST Profile Duplicates (yinelenen profil kontrolü) ───────────────────
   POST /api/profile-duplicates
   Body: { hostName, hotelId, appKey, token, excludeProfileId?, criteria: { identificationNo, email, phone, firstName, lastName, birthDate } }
   OPERA getProfiles: identificationNo / email / phone tek başına, ad+soyad profileName+givenName ile aranır.
   Eşleşen profillerin özeti (ad, doğum tarihi, kimlik) ve eşleşme nedenleri döner. Kişisel veri günlüğe yazılmaz.
── */
// Ad karşılaştırması: aksan, büyük/küçük harf ve Türkçe i/ı farkı yok sayılır (MRZ "KEPEKCI" = OPERA "Kepekçi")
const foldText = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/\s+/g, " ").trim();
const foldId = (s) => String(s || "").replace(/[\s-]/g, "").toUpperCase();
// OPERA aramasında, Türkçe karakterle ASCII karşılığı karışabilecek ilk harfe kadar olan güvenli ön ek ("Kepekçi" → "Kepek")
const safePrefix = (s) => { const m = /^[A-Za-z]*?(?=[cCgGiIoOsSuU]|[^A-Za-z]|$)/.exec(String(s || "").trim()); return m ? m[0] : ""; };

function profileSummaryOf(data) {
  const prof = data?.profiles?.profileInfo?.[0]?.profile ?? {};
  const cust = prof.customer ?? {};
  const names = [].concat(cust.personName ?? []);
  const pn = names.find(n => n.nameType === "Primary") ?? names[0] ?? {};
  const idents = [].concat(cust.identifications?.identificationInfo ?? []).map(i => i.identification).filter(Boolean);
  return {
    firstName: pn.givenName || "", lastName: pn.surname || "",
    birthDate: cust.birthDate || "", nationality: cust.nationality || "",
    idType: idents[0]?.idType || "", idNumber: idents[0]?.idNumber || "",
    idNumbers: idents.map(i => String(i.idNumber || "")),
    idents: idents.map(i => ({ idType: i.idType || "", idNumber: String(i.idNumber || "") })),
  };
}

app.post("/api/profile-duplicates", async (req, res) => {
  const { hostName, hotelId, appKey, token, excludeProfileId, criteria = {} } = req.body || {};
  if (!hostName || !hotelId || !appKey || !token) return res.status(400).json({ error: "Eksik alan" });
  const headers = { "Content-Type":"application/json", "x-hotelid":hotelId, "x-app-key":appKey, "Authorization":`Bearer ${token}` };
  const t = (v) => String(v ?? "").trim();
  const c = {
    identificationNo: t(criteria.identificationNo), email: t(criteria.email), phone: t(criteria.phone),
    firstName: t(criteria.firstName), lastName: t(criteria.lastName), birthDate: t(criteria.birthDate),
  };
  const base = { profileType: "Guest", summaryInfo: "true", searchType: "Any" };
  const searches = [];
  if (c.identificationNo) searches.push({ reason: "Kimlik no", params: { identificationNo: c.identificationNo } });
  if (c.email) searches.push({ reason: "E-posta", params: { email: c.email } });
  if (c.phone) searches.push({ reason: "Telefon", params: { phone: c.phone } });
  if (c.firstName && c.lastName) {
    searches.push({ reason: "Ad + Soyad", params: { profileName: c.lastName, givenName: c.firstName } });
    // Aksanlı/aksansız yazım farkı için ön ek araması (adaylar aşağıda tam ad karşılaştırmasıyla elenir)
    const lp = safePrefix(c.lastName), fp = safePrefix(c.firstName);
    if (lp.length >= 3 && (lp !== c.lastName || fp !== c.firstName)) {
      searches.push({ reason: "Ad + Soyad", params: { profileName: lp + "%", ...(fp.length >= 2 ? { givenName: fp + "%" } : {}) } });
    }
  }
  if (!searches.length) return res.json({ matches: [], checked: [] });

  const warnings = [];
  const idsOf = (d) => [].concat(d?.profiles?.profileInfo ?? d?.profileSummaries?.profileInfo ?? [])
    .map(pi => [].concat(pi.profileIdList ?? []).find(i => i.type === "Profile")?.id).filter(Boolean);
  try {
    // 1) ölçütlere göre aday profiller
    const reasonsById = new Map();
    await Promise.all(searches.map(async (s) => {
      try {
        const r = await fetch(`${hostName}/crm/v1/profiles?${new URLSearchParams({ ...base, ...s.params })}`, { headers });
        if (r.status === 204 || r.status === 404) return;
        const text = await r.text();
        if (!r.ok) { warnings.push(`${s.reason}: HTTP ${r.status}`); return; }
        let d; try { d = JSON.parse(text); } catch { d = {}; }
        for (const id of idsOf(d).slice(0, 15)) {
          if (excludeProfileId && String(id) === String(excludeProfileId)) continue;
          if (!reasonsById.has(id)) reasonsById.set(id, new Set());
          reasonsById.get(id).add(s.reason);
        }
      } catch (e) { warnings.push(`${s.reason}: ${e.message}`); }
    }));
    const candidates = [...reasonsById.keys()].slice(0, 12);
    console.log(`[DUPLICATES] ölçüt=${searches.map(s => s.reason).join("+")} aday=${candidates.length}`);

    // 2) adayların özetini al ve eşleşmeyi doğrula (4'er 4'er)
    const matches = [];
    const queue = [...candidates];
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        try {
          const r = await fetch(`${hostName}/crm/v1/profilesByIds?profileIds=${encodeURIComponent(id)}`, { headers });
          if (!r.ok) continue;
          const sm = profileSummaryOf(await r.json());
          const reasons = new Set(reasonsById.get(id));
          // kimlik no: aday gerçekten bu numarayı taşıyor mu
          if (reasons.has("Kimlik no") && sm.idNumbers.length && !sm.idNumbers.some(x => foldId(x) === foldId(c.identificationNo))) reasons.delete("Kimlik no");
          // ad + soyad: tam eşleşme (aksan/büyük-küçük harf duyarsız); iki tarafta da doğum tarihi varsa aynı olmalı
          if (reasons.has("Ad + Soyad")) {
            const sameFirst = foldText(sm.firstName).split(" ")[0] === foldText(c.firstName).split(" ")[0];
            const sameLast = foldText(sm.lastName) === foldText(c.lastName);
            const birthOk = !c.birthDate || !sm.birthDate || c.birthDate.slice(0, 10) === sm.birthDate.slice(0, 10);
            if (!(sameFirst && sameLast && birthOk)) reasons.delete("Ad + Soyad");
          }
          if (!reasons.size) continue;
          // kimlik no ile eşleşmişse kartta eşleşen kimlik gösterilir (profilde birden çok kimlik olabilir)
          const hit = reasons.has("Kimlik no") ? sm.idents.find(x => foldId(x.idNumber) === foldId(c.identificationNo)) : null;
          matches.push({ id, firstName: sm.firstName, lastName: sm.lastName, birthDate: sm.birthDate, nationality: sm.nationality, idType: hit ? hit.idType : sm.idType, idNumber: hit ? hit.idNumber : sm.idNumber, reasons: [...reasons] });
        } catch (_) {}
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    // kimlik no eşleşenler önce
    matches.sort((a, b) => b.reasons.length - a.reasons.length || (b.reasons.includes("Kimlik no") ? 1 : 0) - (a.reasons.includes("Kimlik no") ? 1 : 0));
    res.json({ matches, checked: searches.map(s => s.reason), warnings });
  } catch (err) {
    console.error("[DUPLICATES] Hata:", err.message);
    res.status(502).json({ error: err.message });
  }
});

/* ─── POST new profile + add as accompanying guest to reservation ──────────
   POST /api/add-accompanying
   Body: { hostName, hotelId, appKey, token, reservationId, profileId, docData }
   Step 1: POST /crm/v1/profiles  → yeni profil oluştur (varsa skip)
   Step 2: PUT /rsv/v1/hotels/{hotelId}/reservations/{reservationId}  → rezervasyona ekle
── */
app.post("/api/add-accompanying", async (req, res) => {
  const { hostName, hotelId, appKey, token, reservationId, confirmationNo, existingProfileId, mainProfileId, docData } = req.body;
  console.log(`[ACCOMPANY] istek: yeni profil=${!existingProfileId && !!docData} mevcut profil=${existingProfileId || "-"} sayfa sürümü=${req.headers["x-sp-version"] || "bilinmiyor"}`);
  if (!hostName || !hotelId || !appKey || !token || !reservationId || !mainProfileId) {
    return res.status(400).json({ error: "Eksik alan" });
  }
  const headers = { "Content-Type":"application/json", "x-hotelid":hotelId, "x-app-key":appKey, "Authorization":`Bearer ${token}` };
  const strip = obj => JSON.parse(JSON.stringify(obj, (k,v) => v===undefined||v===""?undefined:v));

  try {
    let profileId = existingProfileId;

    // Step 1: Yeni profil oluştur (eğer mevcut profil yoksa)
    if (!profileId && docData) {
      const profileBody = strip({
        profileDetails: {
          // OPERA profil tipini zorunlu tutar (yoksa OPERAWS-ProfileTypeNotPassed)
          profileType: "Guest",
          customer: {
            personName: [{ givenName: docData.firstName, surname: docData.lastName, middleName: docData.middleName||undefined, nameType: "Primary" }],
            birthDate:   docData.dateOfBirth   || undefined,
            birthPlace:  docData.birthPlace    || undefined,
            gender:      docData.gender        || undefined,
            nationality: docData.nationality   || undefined,
            identifications: docData.documentNumber ? {
              identificationInfo: [{ identification: {
                idType:             (docData.documentType === "TCKN" ? "TCKN" : (docData.documentType || "PASSPORT")),
                idNumber:           docData.documentNumber,
                issuedCountry:      docData.issuingCountry || undefined,
                issuedDate:         docData.issuedDate     || undefined,
                expirationDate:     docData.expiryDate     || undefined,
                issuedPlace:        docData.issuedPlace    || undefined,
                registeredProperty: hotelId,
                primaryInd:         "true",
              }}]
            } : undefined,
          },
          statusCode: "ACTIVE",
        }
      });
      const createUrl = `${hostName}/crm/v1/profiles`;
      console.log(`[ACCOMPANY] POST ${createUrl}`);
      const cr = await fetch(createUrl, { method:"POST", headers, body: JSON.stringify(profileBody) });
      const ct = await cr.text();
      console.log(`[ACCOMPANY] Profile create → HTTP ${cr.status}  ${ct.slice(0,200)}`);
      if (!cr.ok) return res.status(cr.status).json({ error: "Profil oluşturulamadı", detail: ct });
      let cd = {}; try { cd = JSON.parse(ct); } catch { cd = {}; }
      // OPERA 201 yanıtında profil numarası çoğunlukla yalnız bağlantıda (links[].href = .../crm/v1/profiles/{id}) ya da Location başlığında gelir
      const idFromHref = (h) => /\/profiles\/([^/?#]+)/.exec(String(h || ""))?.[1] || null;
      const selfLink = [].concat(cd?.links ?? []).find(l => l?.rel === "self" && idFromHref(l.href)) ?? [].concat(cd?.links ?? []).find(l => idFromHref(l?.href));
      profileId = cd?.profileDetails?.profileIdList?.find?.(p=>p.type==="Profile")?.id
               ?? cd?.profileIdList?.find?.(p=>p.type==="Profile")?.id
               ?? cd?.id ?? cd?.profileId
               ?? idFromHref(selfLink?.href)
               ?? idFromHref(cr.headers.get("location"));
      if (!profileId) return res.status(500).json({ error: "Yeni profileId alınamadı", raw: ct });
      console.log(`[ACCOMPANY] Yeni profileId=${profileId}`);
    }

    // Step 2: Client'ın gönderdiği mevcut accompany ID listesini kullan (GET yapmıyoruz)
    const clientExisting = [].concat(req.body.existingAccompanyIds ?? []);
    const existingGuests = clientExisting
      .filter(id => id && id !== profileId && id !== mainProfileId)
      .map(id => ({ profileInfo: { profileIdList: [{ type: "Profile", id }], profile: {} }, primary: false }));
    console.log(`[ACCOMPANY] clientExisting=${JSON.stringify(clientExisting)} → existingGuests=${existingGuests.length}`);

    console.log(`[ACCOMPANY] PUT guests: main=${mainProfileId} existing=${existingGuests.length} new=${profileId}`);

    const rsvBody = {
      reservations: [{
        reservationIdList: [{ type: "Reservation", id: reservationId }],
        reservationGuests: [
          { profileInfo: { profileIdList: [{ type: "Profile", id: mainProfileId }], profile: {} } },
          ...existingGuests,
          { profileInfo: { profileIdList: [{ type: "Profile", id: profileId    }], profile: {} }, primary: false }
        ]
      }]
    };
    console.log(`[ACCOMPANY] rsvBody guests:`, JSON.stringify(rsvBody.reservations[0].reservationGuests));
    const rsvUrl = `${hostName}/rsv/v1/hotels/${encodeURIComponent(hotelId)}/reservations/${encodeURIComponent(reservationId)}`;
    console.log(`[ACCOMPANY] PUT ${rsvUrl}`);
    const rr = await fetch(rsvUrl, { method:"PUT", headers, body: JSON.stringify(rsvBody) });
    const rt = await rr.text();
    console.log(`[ACCOMPANY] Reservation update → HTTP ${rr.status}  ${rt.slice(0,200)}`);
    let rd; try { rd = JSON.parse(rt); } catch { rd = { raw: rt }; }
    res.status(rr.status).json({ ...rd, newProfileId: profileId });

  } catch(err) {
    console.error("[ACCOMPANY] Hata:", err.message);
    res.status(502).json({ error: err.message });
  }
});

/* ─── DEBUG — tam isteği göster ──────────────────────────────────────────
   GET /api/debug?surname=Güven
   Terminalde ve tarayıcıda ne geldiğini / gönderildiğini gösterir
── */
app.get("/api/debug", async (req, res) => {
  const { hostName, hotelId, appKey, byType, query, tab } = req.query;
  const token = req.headers["x-opera-token"] || req.query.token;
  const searchType = tab === "inhouse" ? "InHouse" : "Arrival";
  const param = byType === "confirmationNo"
    ? `confirmationNumber=${encodeURIComponent(query || "")}`
    : `surname=${encodeURIComponent(query || "")}`;
  const url = `${hostName}/rsv/v1/hotels/${encodeURIComponent(hotelId || "")}/reservations?${param}&searchType=${searchType}&=Reservation&limit=20`;

  console.log("\n[DEBUG] ══════════════════════════════");
  console.log("[DEBUG] query received:", req.query);
  console.log("[DEBUG] token length:", token?.length);
  console.log("[DEBUG] OPERA URL would be:", url);
  console.log("[DEBUG] ══════════════════════════════\n");

  // Actually call OPERA and return raw response
  try {
    const upstream = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "x-hotelid":    hotelId,
        "x-app-key":    appKey,
        "Authorization": `Bearer ${token}`,
      },
    });
    const text = await upstream.text();
    console.log("[DEBUG] OPERA HTTP:", upstream.status);
    console.log("[DEBUG] OPERA response (first 500):", text.slice(0, 500));
    res.json({ 
      status: upstream.status, 
      operaUrl: url,
      tokenLength: token?.length,
      queryReceived: req.query,
      raw: text.slice(0, 2000) 
    });
  } catch(err) {
    res.json({ error: err.message, operaUrl: url });
  }
});



/* ─── GET Identification Types LOV ───────────────────────────────────────
   GET /api/id-types
   Query: hostName, hotelId, appKey, token
── */
app.get("/api/id-types", async (req, res) => {
  const { hostName, hotelId, appKey } = req.query;
  const token = req.headers["x-opera-token"] || req.query.token;
  if (!hostName || !appKey || !token) return res.status(400).json({ error: "Eksik parametre" });
  try {
    const url = `${hostName}/lov/v1/listOfValues/IdentificationTypes`;
    const r = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "x-hotelid":    hotelId || "",
        "x-app-key":    appKey,
        "Authorization": `Bearer ${token}`,
      }
    });
    const text = await r.text();
    console.log(`[ID-TYPES] → HTTP ${r.status}  ${text.slice(0,200)}`);
    if (!r.ok) {
      console.warn(`[ID-TYPES] OPERA ${r.status} → fallback`);
      return res.json({ opts:[{v:"PASSPORT",l:"Pasaport"},{v:"TCKN",l:"TCKN"}], fallback:true });
    }
    const d = JSON.parse(text);
    console.log("[ID-TYPES] response keys:", Object.keys(d).join(","));
    // OPERA LOV: { listOfValues: { items: [{code,name,...}] } }
    const lov = d?.listOfValues;
    const items = (lov?.items ?? lov?.item ?? (Array.isArray(lov) ? lov : null))
      ?? d?.identificationTypes ?? d?.items
      ?? (Array.isArray(d) ? d : null)
      ?? [];
    if(items.length === 0){
      // Fallback: Pasaport + TCKN
      return res.json({ opts:[{v:"PASSPORT",l:"Pasaport"},{v:"TCKN",l:"TCKN"}], fallback:true });
    }
    const opts = items.map(i => ({ v: i.code||i.id||i.type, l: i.description||i.name||i.code||i.id })).filter(o=>o.v);
    res.json({ opts });
  } catch(e) {
    console.error("[ID-TYPES] error:", e.message, "— fallback kullanılıyor");
    // Hata durumunda her zaman fallback döndür, 500 verme
    res.json({ opts:[{v:"PASSPORT",l:"Pasaport"},{v:"TCKN",l:"TCKN"}], fallback:true });
  }
});

/* ─── PUT Profile + POST Identification ──────────────────────────────────
   PUT  /api/profile
   Body: { hostName, hotelId, appKey, token, profileId, docData }

   Step 1: PUT  /crm/v1/profiles/{id}               → ad/soyad/doğum/cinsiyet
   Step 2: POST /crm/v1/profiles/{id}/identifications → pasaport/kimlik belgesi
── */
app.put("/api/profile", async (req, res) => {
  const { hostName, hotelId, appKey, token, profileId, docData } = req.body;

  if (!hostName || !hotelId || !appKey || !token || !profileId) {
    return res.status(400).json({ error: "Eksik alan zorunlu" });
  }
  profileCache.delete(pcKey(hotelId, profileId));

  const headers = {
    "Content-Type": "application/json",
    "x-hotelid":    hotelId,
    "x-app-key":    appKey,
    "Authorization": `Bearer ${token}`,
  };

  const strip = obj => JSON.parse(JSON.stringify(obj, (k,v) => v === undefined || v === "" ? undefined : v));

  // ── Step 1: PUT profile → kişisel bilgiler ──────────────────────────
  const profileBody = strip({
    profileDetails: {
      customer: {
        personName: [{
          givenName:  docData.firstName  || undefined,
          middleName: docData.middleName || undefined,
          surname:    docData.lastName   || undefined,
          nameType:   "Primary"
        }],
        birthDate:   docData.dateOfBirth || undefined,
        birthPlace:  docData.birthPlace  || undefined,
        gender:      docData.gender      || undefined,
        nationality: docData.nationality || undefined,
      },
      statusCode:     "ACTIVE",
      markForHistory: false,
      hasCommission:  false,
    }
  });

  console.log(`[PROFILE-1] PUT /crm/v1/profiles/${profileId}`);
  try {
    const r1 = await fetch(`${hostName}/crm/v1/profiles/${encodeURIComponent(profileId)}`, {
      method: "PUT", headers, body: JSON.stringify(profileBody),
    });
    const t1 = await r1.text();
    console.log(`[PROFILE-1] → HTTP ${r1.status}  ${t1.slice(0,300)}`);
    if (!r1.ok) {
      let d; try { d = JSON.parse(t1); } catch { d = { raw: t1 }; }
      return res.status(r1.status).json({ step: "profile", ...d });
    }
  } catch (err) {
    return res.status(502).json({ step: "profile", error: err.message });
  }

  // ── Step 2: PUT profile identification ──────────────────────────────
  // OPERA Cloud'da identification, profileDetails.customer.identifications değil
  // profileDetails direkt altında — ama wrapper farklı: { profileDetails: { ... , userDefinedFields: ... }}
  // Deneme 1: profileDetails.customer.identifications (bazı versiyonlarda çalışır)
  // Deneme 2: ayrı PATCH endpoint
  // En güvenli: /crm/v1/profiles/{id} PUT içine customer.identifications olarak göm

  const identPutBody = strip({
    profileDetails: {
      customer: {
        identifications: {
          identificationInfo: [{
            identification: {
              idType:             (docData.documentType === "TCKN" ? "TCKN" : (docData.documentType || "PASSPORT")),
              idNumber:           docData.documentNumber || undefined,
              issuedCountry:      docData.issuingCountry || undefined,
              issuedDate:         docData.issuedDate     || undefined,
              expirationDate:     docData.expiryDate     || undefined,
              issuedPlace:        docData.issuedPlace    || undefined,
              registeredProperty: hotelId,
              primaryInd:         "true",
              orderSequence:      "1",
            }
          }]
        }
      },
      statusCode:     "ACTIVE",
      markForHistory: false,
      hasCommission:  false,
    }
  });

  console.log(`[PROFILE-2] PUT /crm/v1/profiles/${profileId} (identification)`);
  console.log(`[PROFILE-2] BODY:`, JSON.stringify(identPutBody, null, 2));
  try {
    const r2 = await fetch(`${hostName}/crm/v1/profiles/${encodeURIComponent(profileId)}`, {
      method: "PUT", headers, body: JSON.stringify(identPutBody),
    });
    const t2 = await r2.text();
    console.log(`[PROFILE-2] → HTTP ${r2.status}  ${t2.slice(0,500)}`);
    let d; try { d = JSON.parse(t2); } catch { d = { raw: t2 }; }

    if (!r2.ok) {
      // Eğer customer.identifications da çalışmadıysa, tam hata detayını döndür
      return res.status(r2.status).json({ step: "identification", status: r2.status, ...d });
    }
    return res.status(200).json({ step: "identification", status: r2.status, success: true });
  } catch (err) {
    return res.status(502).json({ step: "identification", error: err.message });
  }
});


/* ─── Profil önbelleği ───────────────────────────────────────────────────
   Bellekte, otel+profil bazında, 10 dk. Yalnız KBS için bilgileri tam profiller saklanır; eksik bilgili profil her seferinde
   OPERA'dan okunur (OPERA'da düzeltilince hemen görünsün). Profil yazılınca (düzenleme, kimlik güncelleme) ilgili kayıt silinir.
   fresh=1 ile atlanabilir. Kalıcı değildir; sunucu yeniden başlarsa boşalır. */
const PROFILE_TTL_MS = 10 * 60 * 1000;
const PROFILE_CACHE_MAX = 5000;
const profileCache = new Map();
const pcKey = (hotelId, profileId) => `${hotelId}|${profileId}`;
function profileComplete(match) {
  const cust = match?.profile?.customer ?? {};
  const nat = String(cust.nationality || cust.citizenCountry?.code || "").toUpperCase();
  const idents = [].concat(cust.identifications?.identificationInfo ?? []).map(i => i.identification).filter(Boolean);
  const hasId = idents.some(i => String(i.idNumber || "").trim());
  if (!nat || !hasId) return false;
  if (nat === "TR") return true;
  return !!(cust.birthDate && cust.gender && cust.birthPlace);
}
function profileCachePut(hotelId, profileId, match) {
  if (!profileComplete(match)) { profileCache.delete(pcKey(hotelId, profileId)); return; }
  if (profileCache.size >= PROFILE_CACHE_MAX) profileCache.delete(profileCache.keys().next().value);
  profileCache.set(pcKey(hotelId, profileId), { at: Date.now(), match });
}

/* ─── GET Profile Details ────────────────────────────────────────────────
   GET /api/profile?hostName=...&hotelId=...&appKey=...&profileId=...
   OPERA: GET {HostName}/crm/v1/profiles/{profileId}?fetchInstructions=Identification&fetchInstructions=Customer
── */
app.get("/api/profile", async (req, res) => {
  const { hostName, hotelId, appKey, profileId, fresh } = req.query;
  const token = req.headers["x-opera-token"];
  if (!hostName || !hotelId || !appKey || !token || !profileId) {
    return res.status(400).json({ error: "Eksik parametre" });
  }
  if (fresh !== "1") {
    const hit = profileCache.get(pcKey(hotelId, profileId));
    if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return res.json({ matched: hit.match, cached: true });
  }
  // OPERA: GET /crm/v1/profilesByIds?profileIds={profileId}
  const url = `${hostName}/crm/v1/profilesByIds?profileIds=${encodeURIComponent(profileId)}`;
  console.log(`[PROFILE-GET] GET ${url}`);
  try {
    const upstream = await fetch(url, {
      headers: { "Content-Type":"application/json", "x-hotelid":hotelId, "x-app-key":appKey, "Authorization":`Bearer ${token}` }
    });
    const text = await upstream.text();
    console.log(`[PROFILE-GET] → HTTP ${upstream.status} (${text.length} bayt)`);
    if (!upstream.ok) return res.status(upstream.status).json(JSON.parse(text));
    const data = JSON.parse(text);
    const match = data?.profiles?.profileInfo?.[0] ?? null;
    profileCachePut(hotelId, profileId, match);
    res.json({ matched: match });
  } catch(err) {
    console.log(`[PROFILE-GET] ERROR:`, err.message);
    res.status(502).json({ error: err.message });
  }
});

/* ─── PUT Profile Identification (update via main profile endpoint) ─────
   Identification OPERA'da /crm/v1/profiles/{id} PUT ile güncellenir
   identId varsa body'e id eklenir (update), yoksa yeni kayıt açılır
── */
app.put("/api/identification", async (req, res) => {
  const { hostName, hotelId, appKey, token, profileId, identId, docData } = req.body;
  if (!hostName || !hotelId || !appKey || !token || !profileId) {
    return res.status(400).json({ error: "Eksik alan" });
  }
  profileCache.delete(pcKey(hotelId, profileId));
  const headers = { "Content-Type":"application/json", "x-hotelid":hotelId, "x-app-key":appKey, "Authorization":`Bearer ${token}` };
  const strip = obj => JSON.parse(JSON.stringify(obj, (k,v) => v===undefined||v===""?undefined:v));

  const identObj = strip({
    idType:             (docData.documentType === "TCKN" ? "TCKN" : (docData.documentType || "PASSPORT")),
    idNumber:           docData.documentNumber || undefined,
    issuedCountry:      docData.issuingCountry || undefined,
    issuedDate:         docData.issuedDate     || undefined,
    expirationDate:     docData.expiryDate     || undefined,
    issuedPlace:        docData.issuedPlace    || undefined,
    registeredProperty: hotelId,
    primaryInd:         "true",
    orderSequence:      "1",
  });

  const identInfoItem = identId
    ? { identification: identObj, id: identId, type: "DocumentId" }
    : { identification: identObj };

  const body = {
    profileDetails: {
      customer: {
        identifications: {
          identificationInfo: [identInfoItem]
        }
      }
    }
  };

  const url = `${hostName}/crm/v1/profiles/${encodeURIComponent(profileId)}`;
  console.log(`[IDENT-PUT] PUT ${url} (identId=${identId||"new"})`);
  console.log(`[IDENT-PUT] BODY:`, JSON.stringify(body, null, 2));
  try {
    const upstream = await fetch(url, { method:"PUT", headers, body:JSON.stringify(body) });
    const text = await upstream.text();
    console.log(`[IDENT-PUT] → HTTP ${upstream.status}  ${text.slice(0,300)}`);
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    res.status(upstream.status).json(data);
  } catch(err) {
    res.status(502).json({ error: err.message });
  }
});

/* ─── Tüm diğer GET istekleri → tarama uygulaması ("/" oturum ister) ──── */
app.get("*", (_, res) => res.redirect(303, "/"));

web.init().then(() => {
  app.listen(PORT, () => {
    console.log(`\n✅  SnapPass Proxy Server çalışıyor`);
    console.log(`    http://localhost:${PORT}\n`);
    console.log(`    Giriş:   http://localhost:${PORT}/login`);
    console.log(`    Yönetim: http://localhost:${PORT}/admin\n`);
  });
}).catch(err => {
  console.error("[DB] Veritabanı açılamadı:", err.message);
  process.exit(1);
});
