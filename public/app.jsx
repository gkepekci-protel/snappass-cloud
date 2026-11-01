
/* ═══════════════════════════════════════════════════════════
   SnapPass — OPERA Cloud Proxy Client
   Proxy: http://localhost:3000/api/auth  &  /api/search
═══════════════════════════════════════════════════════════ */
const { useState, useRef, useEffect, useCallback } = React;

const PROXY = window.location.origin;
const SHOW_MRZ_DEBUG_UI = false;

/* ── DİL (Türkçe / English) ───────────────────────────────────────────────
   Kullanıcıya görünen metinler Türkçe kaynak metin olarak yazılır: t("Belge Tara").
   İngilizce karşılıkları public/i18n.js sözlüğündedir; sözlükte olmayan metin Türkçe kalır (eksik çeviri uygulamayı bozmaz).
   Dil seçimi: çerez sp_lang (kullanıcının seçimi) → yoksa kurulumdaki varsayılan dil (window.__SP_DEFAULT_LANG) → tr.
── */
const SP_I18N = window.SP_I18N || { en:{}, tr:{} }; // tr: aynı Türkçe kaynak metnin farklı anlamlarını ayırmak için (ör. "Giriş tarihi" → "Giriş")
function readLang(){
  const m = /(?:^|;\s*)sp_lang=(tr|en)\b/.exec(document.cookie || "");
  return m ? m[1] : (window.__SP_DEFAULT_LANG === "en" ? "en" : "tr");
}
let CUR_LANG = readLang();
document.documentElement.lang = CUR_LANG;
// vars: {ad} → metindeki {ad} yerine konur
function t(src, vars){
  let s = (SP_I18N[CUR_LANG] && SP_I18N[CUR_LANG][src]) || src;
  if(vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}
function setLang(l){
  CUR_LANG = l === "en" ? "en" : "tr";
  document.cookie = `sp_lang=${CUR_LANG}; Path=/; Max-Age=31536000; SameSite=Lax`;
  document.documentElement.lang = CUR_LANG;
  window.dispatchEvent(new Event("sp-lang"));
}
// Rezervasyon durumu (OPERA'dan İngilizce gelir) → seçili dilde
const STATUS_TR = { reserved:"Rezerve", inhouse:"Konaklıyor", checkedin:"Giriş yapıldı", checkedout:"Çıkış yapıldı", cancelled:"İptal", canceled:"İptal", noshow:"Gelmedi", duein:"Bugün gelecek", dueout:"Bugün çıkacak", waitlist:"Bekleme listesi", pending:"Beklemede" };
function statusText(status){
  const key = String(status || "").toLowerCase().replace(/[^a-z]/g, "");
  return STATUS_TR[key] ? t(STATUS_TR[key]) : status;
}
// Belge tipi etiketi: bilinen kodlar seçili dilde, OPERA'nın verdiği diğer açıklamalar olduğu gibi
function idTypeLabel(o){
  if(o.v === "PASSPORT") return t("Pasaport");
  if(o.v === "TCKN") return t("TCKN");
  return o.l;
}
// Dil değiştirici (TR | EN)
function LangSwitch(){
  return(
    <div className="lang-switch" role="group" aria-label={t("Dil")}>
      {[["tr","TR"],["en","EN"]].map(([code,label])=>(
        <button key={code} type="button" onClick={()=>setLang(code)} aria-pressed={CUR_LANG===code} className={CUR_LANG===code?"on":""}>{label}</button>
      ))}
    </div>
  );
}

async function writeDebugLogFile({ sessionId, guest, lines }) {
  if(!sessionId || !Array.isArray(lines) || !lines.length) return;
  try{
    await fetch(`${PROXY}/api/debug-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, guest, lines }),
    });
  }catch(err){
    console.warn("[MRZ-DEBUG] log file write failed:", err);
  }
}

async function writeDebugImageFile({ sessionId, label, canvas }) {
  if(!sessionId || !label || !canvas || typeof canvas.toDataURL !== "function") return;
  try{
    const imageData = canvas.toDataURL("image/jpeg", 0.86);
    await fetch(`${PROXY}/api/debug-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, label, imageData }),
    });
  }catch(err){
    console.warn("[MRZ-DEBUG] image file write failed:", err);
  }
}

function isHandheldDevice(){
  try{
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "") ||
      (window.matchMedia && window.matchMedia("(max-width: 820px)").matches);
  }catch{
    return false;
  }
}

function getScanViewportHeight(){
  const vh = window.innerHeight || 800;
  return isHandheldDevice() ? Math.max(360, Math.min(620, Math.round(vh * 0.58))) : 380;
}

async function openPreferredCameraStream(){
  const handheld = isHandheldDevice();
  const attempts = [
    {
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: handheld ? 2560 : 1920 },
        height: { ideal: handheld ? 1440 : 1080 },
        aspectRatio: { ideal: 16 / 9 },
      },
      audio: false,
    },
    {
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    },
    {
      video: true,
      audio: false,
    },
  ];

  let lastError = null;
  for(const constraints of attempts){
    try{
      return await navigator.mediaDevices.getUserMedia(constraints);
    }catch(err){
      lastError = err;
    }
  }
  throw lastError || new Error(t("Kamera kullanılamıyor"));
}

async function optimizeVideoTrack(track){
  if(!track || typeof track.applyConstraints !== "function") return;
  try{
    const caps = typeof track.getCapabilities === "function" ? track.getCapabilities() : {};
    const advanced = [];
    if(Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) advanced.push({ focusMode: "continuous" });
    if(Array.isArray(caps.exposureMode) && caps.exposureMode.includes("continuous")) advanced.push({ exposureMode: "continuous" });
    if(Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes("continuous")) advanced.push({ whiteBalanceMode: "continuous" });
    if(caps.zoom && typeof caps.zoom.max === "number"){
      const targetZoom = Math.min(caps.zoom.max, Math.max(caps.zoom.min || 1, isHandheldDevice() ? 1.6 : 1.2));
      advanced.push({ zoom: targetZoom });
    }
    if(!advanced.length) return;
    await track.applyConstraints({ advanced });
  }catch(err){
    console.warn("[MRZ] camera optimize skipped:", err);
  }
}

const useLang = () => React.useContext(LangCtx); // same-origin, served by server.js

/* ─── API calls go through proxy ─────────────────────────── */
// Otel/hesap pasife alınınca sunucu 401 + passive döner: sayfa değişmez, ekranda bildirim kalır (giriş ekranına dönüş düğmesiyle)
(function () {
  const orig = window.fetch.bind(window);
  window.fetch = async function () {
    const res = await orig.apply(null, arguments);
    if (res.status === 401 && !document.getElementById("passive-notice")) {
      try {
        const d = await res.clone().json();
        if (d && d.passive) {
          const box = document.createElement("div");
          box.id = "passive-notice";
          box.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.6);display:flex;align-items:center;justify-content:center;padding:16px";
          const card = document.createElement("div");
          card.style.cssText = "background:#fff;border-radius:14px;padding:24px;max-width:380px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.3);font-family:inherit";
          const h = document.createElement("div"); h.textContent = t("Erişim kapalı"); h.style.cssText = "font-size:18px;font-weight:800;margin-bottom:8px;color:#b91c1c";
          const p = document.createElement("div"); p.textContent = t("Otel ya da hesap pasife alındı. Protel destek ekibiyle görüşün."); p.style.cssText = "font-size:14px;color:#334155;margin-bottom:16px";
          const b = document.createElement("button"); b.textContent = t("Giriş ekranına dön"); b.style.cssText = "background:#2563eb;color:#fff;border:0;border-radius:10px;padding:10px 16px;font-weight:700;cursor:pointer";
          b.onclick = function () { window.location.href = "/login"; };
          card.append(h, p, b); box.appendChild(card); document.body.appendChild(box);
        }
      } catch (_) {}
    }
    return res;
  };
})();

async function operaGetToken() {
  // Gizli bilgiler sunucuda; token oturumdaki otelin OHIP tanımıyla alınır
  const res = await fetch(`${PROXY}/api/opera/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  let d = {}; try { d = await res.json(); } catch (_) {}
  if (res.status === 401) { if (!document.getElementById("passive-notice")) window.location.href = "/login"; throw new Error(t("Oturum sona erdi")); }
  if (!res.ok || !d.access_token) throw new Error(d.error || t("OHIP token alınamadı (HTTP {durum})", { durum: res.status }));
  return d.access_token;
}

async function operaSearch({ hostName, hotelId, appKey, token, byType, query, tab, all, depFrom, depTo }) {
  // Token header'da gönder — URL boyut limitini aşmasın
  const params = new URLSearchParams({ hostName, hotelId, appKey, byType, query: query.trim(), tab });
  if(all) params.set("all","1");
  if(depFrom&&depTo){ params.set("depFrom",depFrom); params.set("depTo",depTo); }
  const res = await fetch(`${PROXY}/api/search?${params}`, {
    headers: { "x-opera-token": token }
  });
  if (res.status === 204) return [];
  let body = ""; try { body = await res.text(); } catch (_) {}
  if (!res.ok) {
    let detail = "";
    try { const j = JSON.parse(body); detail = j.detail || j.message || j.title || j["o:errorDetails"]?.[0]?.detail || body.slice(0,300); } catch { detail = body.slice(0,300); }
    throw new Error(t("Arama başarısız (HTTP {durum}):\n{ayrinti}", { durum: res.status, ayrinti: detail }));
  }
  let data; try { data = JSON.parse(body); } catch { return []; }
  return normalizeReservations(data);
}

// T.C. kimlik no standardı: 11 rakam, ilki 0 olamaz, 10. ve 11. hane sağlama (checksum) kurallarına uyar
function isValidTckn(v) {
  const s = String(v || "").replace(/\s/g, "");
  if (!/^[1-9]\d{10}$/.test(s)) return false;
  const d = s.split("").map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8], even = d[1] + d[3] + d[5] + d[7];
  if (((odd * 7 - even) % 10 + 10) % 10 !== d[9]) return false;
  return d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
}

// Değişen alanlar (eski → yeni): değişiklik loguna "Soyadı: Kepek → Koko" yazılır
function changedKeys(before, after, keys) {
  const nv = v => String(v ?? "").replace(/\s+/g, " ").trim();
  return keys.filter(k => k in before && nv(before[k]).toLowerCase() !== nv(after[k]).toLowerCase())
    .map(k => ({ k, from: nv(before[k]).slice(0, 80), to: nv(after[k]).slice(0, 80) }));
}

async function putProfile({ hostName, hotelId, appKey, token, profileId, docData, changed }) {
  const res = await fetch(`${PROXY}/api/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostName, hotelId, appKey, token, profileId, docData, changed }),
  });
  let body = ""; try { body = await res.text(); } catch (_) {}
  if (!res.ok) {
    let detail = "";
    try { const j = JSON.parse(body); detail = j.detail || j.message || j.title || j["o:errorDetails"]?.[0]?.detail || body.slice(0,300); } catch { detail = body.slice(0,300); }
    throw new Error(t("Profil güncelleme hatası (HTTP {durum}):\n{ayrinti}", { durum: res.status, ayrinti: detail }));
  }
  return true;
}

async function profileSearch({ hostName, hotelId, appKey, token, firstName, lastName }) {
  const params = new URLSearchParams({ hostName, hotelId, appKey, token });
  if (firstName) params.set("firstName", firstName);
  if (lastName)  params.set("lastName",  lastName);
  const r = await fetch("/api/profile-search?" + params);
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error || t("Arama başarısız"));
  // Response: profileSummaries.profileInfo[]  (summaryInfo=true)
  const list = d?.profileSummaries?.profileInfo ?? d?.profiles?.profileInfo ?? [];
  return [].concat(list).map(pi => {
    const prof   = pi.profile ?? pi;
    // summary modda isim formerName veya customer.personName içinde gelir
    const fn     = prof.formerName ?? {};
    const cust   = prof.customer ?? {};
    const pn     = [].concat(cust.personName ?? []).find(n => n.nameType === "Primary") ?? {};
    const firstName = pn.givenName  ?? fn.givenName  ?? fn.middleName ?? "";
    const lastName  = pn.surname    ?? fn.name        ?? fn.fullName?.split(",")[0]?.trim() ?? "";
    const idList = [].concat(pi.profileIdList ?? []);
    const id     = idList.find(i => i.type === "Profile")?.id ?? "";
    return { id, firstName, lastName };
  }).filter(p => p.id);
}

async function addAccompanying({ hostName, hotelId, appKey, token, reservationId, existingProfileId, mainProfileId, docData }) {
  const r = await fetch("/api/add-accompanying", {
    method: "POST",
    headers: { "Content-Type":"application/json", "X-SP-Version": window.__SP_VERSION || "" },
    body: JSON.stringify({ hostName, hotelId, appKey, token, reservationId, existingProfileId, mainProfileId, docData }),
  });
  const d = await r.json();
  if (!r.ok) {
    // OPERA'nın verdiği hata ayrıntısı da gösterilsin (ör. "Profile Type is not passed in the request.")
    let detail = "";
    try { const j = JSON.parse(d?.detail || "{}"); detail = j.detail || j.title || j["o:errorDetails"]?.[0]?.detail || ""; }
    catch { detail = String(d?.detail || "").slice(0, 200); }
    throw new Error([d?.error || t("Beraberindeki eklenemedi"), detail].filter(Boolean).join(": "));
  }
  return d;
}

// Yinelenen profil kontrolü: kimlik no / ad+soyad (+ e-posta, telefon) aynı olan başka profil var mı. Kontrol yapılamazsa kaydı engellemez.
async function findDuplicates({ hostName, hotelId, appKey, token, excludeProfileId, criteria }) {
  try {
    const res = await fetch(`${PROXY}/api/profile-duplicates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostName, hotelId, appKey, token, excludeProfileId, criteria }),
    });
    if (!res.ok) return [];
    const d = await res.json();
    return d.matches || [];
  } catch (e) { console.warn("findDuplicates:", e); return []; }
}

async function getProfileDetails({ hostName, hotelId, appKey, token, profileId, firstName, lastName, fresh }) {
  try {
    const params = new URLSearchParams({ hostName, hotelId, appKey, profileId });
    if (fresh) params.set("fresh", "1");
    const res = await fetch(`${PROXY}/api/profile?${params}`, {
      headers: { "x-opera-token": token }
    });
    if (!res.ok) return null;
    const data = await res.json();
    // profiles.profileInfo[0].profile.customer
    const p    = data?.matched ?? data;
    const prof = p?.profile ?? {};
    const cust = prof?.customer ?? {};
    const personName = [].concat(cust?.personName ?? []).find(n => n.nameType === "Primary")
                    ?? [].concat(cust?.personName ?? [])[0] ?? {};
    // Identification
    const identList = [].concat(cust?.identifications?.identificationInfo ?? []);
    // Hangi belge: Primary işaretli olan; yoksa (birden çok belge varken OPERA'dan gelen sıra belirsizdir) süresi dolmamış olanlar arasında en yeni verilen,
    // hiçbiri geçerli değilse en yeni verilen. Böylece yenilenen pasaport eskisinin önüne geçer.
    const d10 = v => String(v || "").slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const primary   = identList.find(i => i?.identification?.primaryInd === true || i?.identification?.primaryInd === "true")
                   ?? (() => {
                        if (identList.length < 2) return identList[0];
                        const valid = identList.filter(i => { const e = d10(i?.identification?.expirationDate); return !e || e >= today; });
                        const pool = valid.length ? valid : identList;
                        return [...pool].sort((a, b) =>
                          d10(b?.identification?.issuedDate).localeCompare(d10(a?.identification?.issuedDate)) ||
                          d10(b?.identification?.expirationDate).localeCompare(d10(a?.identification?.expirationDate)))[0];
                      })();
    const ident     = primary?.identification ?? null;
    return {
      identId:        primary?.id ?? null,
      idType:         ident?.idType         || "",
      documentNumber: ident?.idNumber       || "",
      issuingCountry: ident?.issuedCountry  || "",
      issuedDate:     ident?.issuedDate     || "",
      expiryDate:     ident?.expirationDate || "",
      issuedPlace:    ident?.issuedPlace    || "",
      birthDate:      cust?.birthDate       || "",
      birthPlace:     cust?.birthPlace      || "",
      nationality:    cust?.nationality || "",  // ISO kodu (TR, DE vb.)
      gender:         cust?.gender          || personName?.gender || "",
      firstName:      personName?.givenName  || firstName || "",
      middleName:     personName?.middleName || "",
      lastName:       personName?.surname    || lastName  || "",
    };
  } catch(e) { console.warn("getProfileDetails error:", e); return null; }
}

async function putIdentification({ hostName, hotelId, appKey, token, profileId, identId, docData }) {
  const res = await fetch(`${PROXY}/api/identification`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hostName, hotelId, appKey, token, profileId, identId, docData }),
  });
  let body = ""; try { body = await res.text(); } catch (_) {}
  if (!res.ok) {
    let detail = "";
    try { const j = JSON.parse(body); detail = j.detail||j.message||j.title||body.slice(0,300); } catch { detail = body.slice(0,300); }
    throw new Error(t("Kimlik belgesi güncelleme hatası (HTTP {durum}):\n{ayrinti}", { durum: res.status, ayrinti: detail }));
  }
  return true;
}

function normalizeReservations(data) {
  // OPERA Cloud gerçek response yapısı:
  // data.reservations.reservationInfo[] — her biri bir rezervasyon
  const raw =
    data?.reservations?.reservationInfo ??  // ← gerçek yapı (Postman doğruladı)
    data?.reservations?.reservation     ??
    data?.reservationInfo               ??
    data?.reservations                  ??
    [];
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);

  return list.flatMap((r, idx) => {
    // Guest adı doğrudan r.reservationGuest altında
    const g = r?.reservationGuest ?? {};
    const firstName = g.givenName ?? g.firstName ?? "";
    const lastName  = g.surname   ?? g.lastName  ?? "";
    const guestId   = g.id ?? `#${idx + 1}`;

    // Confirmation No: reservationIdList içinde type="Confirmation"
    const idList = r?.reservationIdList ?? [];
    const idArr  = Array.isArray(idList) ? idList : [idList];
    const confirmationNo =
      idArr.find(i => i?.type === "Confirmation")?.id ??
      idArr.find(i => i?.type === "Reservation")?.id  ??
      "—";

    // Stay bilgileri
    const rs       = r?.roomStay ?? {};
    const checkIn  = rs.arrivalDate   ?? "—";
    const checkOut = rs.departureDate ?? "—";
    const roomType = rs.roomType      ?? rs.roomClass ?? "";
    const room     = rs.roomId        ?? "";
    const status   = r?.reservationStatus ?? r?.computedReservationStatus ?? "";
    // Sahte (pseudo) oda: posting master vb. gerçek konaklayan değildir; listelere alınmaz
    const pseudoRoom = rs.pseudoRoom === true || String(rs.pseudoRoom) === "true";
    const adults   = rs.adultCount ?? 0;
    const children = rs.childCount ?? 0;

    // Reservation internal ID (for PUT reservation)
    const reservationId = idArr.find(i => i?.type === "Reservation")?.id ?? null;
    // Mevcut accompanyGuest profileId'lerini topla
    const accompanyProfileIds = [].concat(g.accompanyGuests ?? []).map(ag =>
      [].concat(ag.profileIdList ?? []).find(p => p.type === "Profile")?.id
    ).filter(Boolean);
    const mainGuest = { guestId, firstName, lastName, confirmationNo, reservationId, checkIn, checkOut, roomType, room, status, adults, children, isAccompany: false, accompanyProfileIds, pseudoRoom };

    // Accompany guests — r.reservationGuest.accompanyGuests[]
    const accompany = [].concat(g.accompanyGuests ?? []).map(ag => {
      const agId = [].concat(ag.profileIdList ?? []).find(p => p.type === "Profile")?.id ?? null;
      return {
        guestId:       agId,
        firstName:     ag.firstName ?? ag.givenName ?? "",
        lastName:      ag.lastName  ?? ag.surname   ?? "",
        confirmationNo,
        checkIn, checkOut, roomType, room, status,
        adults, children,
        reservationId,
        isAccompany:   true,
        accompanyOf:   guestId,
        pseudoRoom,
      };
    }).filter(ag => ag.guestId && (ag.firstName || ag.lastName));

    return [mainGuest, ...accompany];
  }).filter(g => (g.firstName || g.lastName) && !g.pseudoRoom);
}

const EMPTY_SCAN = { firstName:"", middleName:"", lastName:"", idNumber:"", gender:"M", dateOfBirth:"", birthPlace:"", documentType:"PASSPORT", documentNumber:"", nationality:"", issuedDate:"", expiryDate:"", issuingCountry:"", issuedPlace:"" };
const APP_W = 1120;

/* ─── Brand ───────────────────────────────────────────────── */
const S = {
  blue:"#4A90D9", navy:"#1A3A6E", navy2:"#2A5298", navy3:"#3A6BC4",
  orange:"#F7941D", orangeDk:"#F15A22", orangeLt:"#FAB860",
  bg:"#EEF4FB", text:"#1A2A3A", muted:"#6B7A8D", border:"#D8E3EF",
  green:"#27AE60", red:"#E53935", shadow:"0 2px 14px rgba(26,58,110,.10)",
};

const GS = `
  /* Marka kutusu (tüm ekran boyutlarında): küçük logo, beyazdan koyu zemin */
  .topbar-logo{background:#D3DEEE !important;padding:5px 10px !important;gap:9px !important;box-shadow:0 1px 6px rgba(8,20,42,.25) !important}
  .tb-logo-img{height:18px !important}
  .tb-logo-text{font-size:13px !important;padding-left:9px !important;border-left-color:#AEBBD0 !important}
  .app-footer{padding:14px 16px;text-align:center;font-size:12px;color:#6B7280;border-top:1px solid #E5E7EB;background:#fff}
  @media print{.app-footer{display:none !important}}
  /* KBS Geçmişi: telefonda gösterilmez; yazdırırken yalnız rapor basılır */
  @media (max-width: 760px){ .kbs-report-btn{display:none !important} }
  @media print{ body *{visibility:hidden !important} .kbs-print, .kbs-print *{visibility:visible !important} .kbs-print{position:absolute;left:0;top:0;width:100%;padding:0 !important;box-shadow:none !important;border:0 !important} .no-print{display:none !important} .kbs-print table{font-size:11px !important;min-width:0 !important} @page{size:A4 landscape;margin:10mm} }
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&family=Nunito:wght@700;800;900&display=swap');
  @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  @keyframes spin  {to{transform:rotate(360deg)}}
  @keyframes pulse {0%,100%{box-shadow:0 0 0 0 rgba(74,144,217,.5)}65%{box-shadow:0 0 0 14px rgba(74,144,217,0)}}
  @keyframes heroShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
  @keyframes glowFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
  .fadeUp{animation:fadeUp .38s ease both}.fadeIn{animation:fadeIn .28s ease both}
  .inp{width:100%;padding:11px 14px;border:1.5px solid ${S.border};border-radius:9px;font-size:14px;color:${S.text};background:#fff;outline:none;transition:border .15s,box-shadow .15s}
  .inp:focus{border-color:${S.blue};box-shadow:0 0 0 3px rgba(74,144,217,.14)}
  .inp::placeholder{color:#b8c8d8}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:none;border-radius:9px;font-size:14px;font-weight:700;cursor:pointer;transition:all .18s;padding:12px 22px}
  .btn-p{background:linear-gradient(135deg,${S.blue},${S.navy});color:#fff;box-shadow:0 4px 14px rgba(26,58,110,.25)}
  .btn-p:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(26,58,110,.35)}
  .btn-p:disabled{opacity:.55;cursor:not-allowed;transform:none}
  .tab{padding:9px 20px;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;transition:all .18s;border:none}
  .ton{background:linear-gradient(135deg,${S.blue},${S.navy});color:#fff;box-shadow:0 3px 10px rgba(26,58,110,.22)}
  .toff{background:#fff;color:${S.muted};border:1.5px solid ${S.border}}
  .toff:hover{border-color:${S.blue};color:${S.blue}}
  .card{background:#fff;border-radius:14px;padding:22px;box-shadow:${S.shadow}}
  .lbl{font-size:11px;font-weight:700;color:${S.muted};letter-spacing:.8px;text-transform:uppercase;display:block;margin-bottom:5px}
  .guest-row{display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:10px;border:1.5px solid ${S.border};background:#fff;cursor:pointer;transition:all .18s}
  .guest-row:hover{border-color:${S.blue};background:#F5F9FF;transform:translateX(3px)}
  .guest-row.sel{border-color:${S.blue};background:linear-gradient(135deg,#EEF5FF,#F5F9FF);box-shadow:0 4px 16px rgba(74,144,217,.14)}
  /* Dil değiştirici (TR | EN) */
  .lang-switch{display:inline-flex;border:1px solid rgba(255,255,255,.28);border-radius:10px;overflow:hidden;flex-shrink:0}
  .lang-switch button{background:transparent;border:none;color:rgba(255,255,255,.7);font-size:12px;font-weight:800;padding:7px 10px;cursor:pointer;min-width:38px;min-height:34px}
  .lang-switch button.on{background:rgba(255,255,255,.24);color:#fff}
  @media (max-width: 760px){ .lang-switch button{min-height:40px;min-width:42px} }
  /* Rezervasyon kartı eylemleri: tablet ve telefonda parmakla rahat basılır (en az 44px) */
  .row-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
  .row-actions .btn{padding:9px 16px;font-size:13px;min-height:40px;border-radius:9px}
  .btn-edit{background:#fff;color:${S.blue};border:1.5px solid ${S.blue}66 !important}
  .btn-edit:disabled{opacity:.5;cursor:not-allowed}
  .btn-acc{background:#7C3AED18;color:#7C3AED;border:1.5px solid #C4B5FD !important}
  .profile-info{font-size:12px}
  @media (max-width: 1024px){
    .row-actions .btn{min-height:46px;font-size:14px}
  }
  @media (max-width: 760px){
    .row-actions .btn-scan{flex:1 1 100%}
    .row-actions .btn-edit,.row-actions .btn-acc{flex:1 1 calc(50% - 4px)}
    .profile-info{font-size:13px;gap:8px 14px !important}
  }
  /* Yinelenen profil iletişim kutusu: telefonda alttan açılan sayfa, geniş ekranda ortada */
  .dup-overlay{position:fixed;inset:0;z-index:2000;background:rgba(9,17,31,.55);display:flex;align-items:flex-end;justify-content:center}
  .dup-panel{background:#fff;width:100%;max-width:560px;max-height:88dvh;overflow-y:auto;border-radius:18px 18px 0 0;padding:18px 16px calc(16px + env(safe-area-inset-bottom));box-shadow:0 -8px 40px rgba(0,0,0,.25)}
  @media (min-width: 761px){
    .dup-overlay{align-items:center;padding:20px}
    .dup-panel{border-radius:18px;padding:22px}
  }
  .auth-shell{display:grid;grid-template-columns:1.02fr .98fr;min-height:100vh}
  .ops-hero-grid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(320px,.9fr);gap:16px;align-items:stretch}
  .ops-stat-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  @media (max-width: 980px){
    .auth-shell,.ops-hero-grid{grid-template-columns:1fr}
    .ops-stat-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
    .ops-hero-title{font-size:32px !important}
  }
  /* Tablet dikey ve telefon: başlık kutusu ve bilgi kartları sıkışık düzen */
  @media (max-width: 760px){
    .ops-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .stat-card{padding:14px 14px 12px !important}
    .stat-value{font-size:21px !important;margin-top:7px !important}
    .stat-detail{margin-top:6px !important;font-size:11.5px !important;line-height:1.45 !important}
    .ops-hero{padding:20px 18px 18px !important;border-radius:18px !important}
    .ops-hero-title{margin-top:14px !important;font-size:26px !important;letter-spacing:-.5px !important}
    .ops-hero-sub{margin-top:10px !important;font-size:13.5px !important;line-height:1.6 !important}
    .ops-hero-cards{margin-top:16px !important;grid-template-columns:repeat(2,minmax(0,1fr)) !important;gap:10px !important}
    .ops-hero-card{padding:12px 13px !important;border-radius:14px !important}
    .topbar-chip{display:none !important}
    .topbar-title{min-width:0 !important}
    .topbar-row{flex-wrap:nowrap !important;min-height:58px !important;padding:8px 16px !important;gap:10px !important}
    .page-wrap{padding:16px 16px 48px !important}
    .inp{font-size:16px}
    .scan-hint{white-space:normal !important;max-width:88%;text-align:center}
    .scan-controls{padding:14px 16px calc(16px + env(safe-area-inset-bottom)) !important}
    .form-guest{flex-wrap:wrap;padding:12px 14px !important}
    .form-card{padding:16px !important}
  }
  /* Telefon: form alanları tek sütun */
  @media (max-width: 560px){
    .form-grid{grid-template-columns:1fr !important}
  }
  /* Telefon üst çubuğu: 1. satır logo + otel adı, 2. satır eşit genişlikte düğmeler (dil değişince düzen kaymaz) */
  @media (max-width: 600px){
    .topbar-row{flex-wrap:wrap !important;row-gap:8px !important;padding:8px 12px 10px !important;min-height:0 !important}
    .topbar-logo{padding:6px 9px !important;border-radius:12px !important}
    .topbar-title{flex:1 1 0 !important;min-width:0 !important}
    .tb-acts{flex:1 1 100% !important;margin-left:0 !important;display:grid !important;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:6px !important}
    .tb-acts .tb-btn{width:100%;min-height:40px !important;padding:6px 4px !important;display:inline-flex !important;align-items:center;justify-content:center;font-size:12.5px !important;white-space:nowrap;overflow:hidden}
    .tb-acts .lang-switch{display:flex;width:100%}
    .tb-acts .lang-switch button{flex:1;min-width:0;padding:6px 2px}
    .topbar-help-label{display:none}
  }
  @media (max-width: 480px){
    .topbar-logo.has-back{display:none !important}
    .ops-hero-title{font-size:22px !important}
    .ops-hero-sub{display:none}
    .ops-hero-cards{grid-template-columns:1fr !important}
    .stat-value{font-size:18px !important}
  }
`;

function Logo({ size="md", onDark=false }) {
  const H=size==="xl"?72:size==="lg"?50:size==="sm"?26:36, tSz=H*.5, sSz=H*.19;
  return (
    <div style={{display:"flex",alignItems:"center",gap:H*.26}}>
      <svg width={H} height={H} viewBox="0 0 52 52" fill="none">
        <defs>
          <linearGradient id="sp3" x1="9" y1="4" x2="15" y2="42" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={S.orangeLt}/><stop offset="100%" stopColor={S.orangeDk}/>
          </linearGradient>
          <linearGradient id="ln3" x1="26" y1="11" x2="26" y2="33" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#5BAAE8"/><stop offset="100%" stopColor="#2D6AA8"/>
          </linearGradient>
        </defs>
        <rect x="9" y="4" width="30" height="38" rx="3.5" fill="#fff" stroke={S.navy} strokeWidth="1.8"/>
        <rect x="9" y="4" width="6" height="38" rx="3.5" fill="url(#sp3)"/>
        <rect x="17" y="33" width="16" height="2" rx="1" fill={S.orange} opacity=".8"/>
        <rect x="17" y="37" width="12" height="2" rx="1" fill={S.orange} opacity=".5"/>
        <circle cx="26" cy="20" r="9" fill="url(#ln3)" opacity=".95"/>
        {[0,60,120,180,240,300].map((a,i)=>(<path key={i} transform={`rotate(${a} 26 20)`} d="M26 20 L26 12 A3 3 0 0 1 31.2 15 Z" fill={i%2===0?"#2D6AA8":"#1A5490"} opacity=".85"/>))}
        <circle cx="26" cy="20" r="5" fill="white" opacity=".9"/>
        <path d="M23.5 20.2 L25.2 22 L28.8 18.2" stroke="#2D6AA8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M33 14 L44 7 L41 16 Z" fill={S.orange}/>
        <line x1="31" y1="22" x2="44" y2="7" stroke={S.orange} strokeWidth="2.4" strokeLinecap="round"/>
      </svg>
      <div>
        <div style={{fontFamily:"'Nunito',sans-serif",fontWeight:900,fontSize:tSz,lineHeight:1}}>
          <span style={{color:S.blue}}>Snap</span><span style={{color:onDark?"#fff":S.navy}}>Pass</span>
        </div>
        {size!=="sm"&&<div style={{fontSize:sSz,color:onDark?"rgba(255,255,255,.5)":S.muted,letterSpacing:"1.1px",textTransform:"uppercase",marginTop:2,fontWeight:700}}>Document Scanner</div>}
      </div>
    </div>
  );
}

const AVTS=[`linear-gradient(135deg,${S.blue},${S.navy})`,`linear-gradient(135deg,${S.orange},${S.orangeDk})`,`linear-gradient(135deg,#5B9BD5,#2560A8)`,`linear-gradient(135deg,#27AE60,#1A7A43)`];
const inits=(f,l)=>`${f?.[0]??""}${l?.[0]??""}`.toUpperCase();
const Avt=({f,l,idx=0,sz=44,room,forceInitials})=><div style={{width:sz,height:sz,borderRadius:"50%",background:AVTS[idx%AVTS.length],display:"flex",alignItems:"center",justifyContent:"center",fontSize:room?sz*.30:sz*.36,fontWeight:800,color:"#fff",flexShrink:0,letterSpacing:"-0.5px"}}>{forceInitials?inits(f,l):(room||"")}</div>;
const Spin=({sz=16})=><span style={{width:sz,height:sz,border:"2.5px solid rgba(255,255,255,.3)",borderTopColor:"#fff",borderRadius:"50%",animation:"spin .7s linear infinite",display:"inline-block"}}/>;
const StatCard=({label,value,detail,tone="blue"})=>{
  const toneMap={
    blue:{bg:"#F4F8FF",bd:"rgba(74,144,217,.16)",fg:S.blue},
    navy:{bg:"#F7F9FD",bd:"rgba(26,58,110,.12)",fg:S.navy},
    orange:{bg:"#FFF7EE",bd:"rgba(247,148,29,.18)",fg:S.orangeDk},
    green:{bg:"#F0FDF4",bd:"rgba(39,174,96,.18)",fg:S.green},
  }[tone]||{bg:"#F7F9FD",bd:`1px solid ${S.border}`,fg:S.navy};
  return(
    <div className="card stat-card" style={{padding:"18px 18px 16px",background:toneMap.bg,border:`1px solid ${toneMap.bd}`}}>
      <div style={{fontSize:10.5,fontWeight:800,color:S.muted,letterSpacing:".55px"}}>{label}</div>
      <div className="stat-value" style={{marginTop:10,fontFamily:"'Nunito',sans-serif",fontSize:26,lineHeight:1.05,fontWeight:900,color:toneMap.fg,wordBreak:"break-word"}}>{value}</div>
      <div className="stat-detail" style={{marginTop:10,fontSize:12,color:S.muted,lineHeight:1.6}}>{detail}</div>
    </div>
  );
};
function WorkspaceHero({session,title,subtitle,chip,stats=[],selectedTitle,selectedMeta}){
  return(
    <div className="ops-hero-grid fadeUp" style={{marginBottom:18}}>
      <div className="ops-hero" style={{position:"relative",overflow:"hidden",borderRadius:24,padding:"26px 26px 22px",background:`linear-gradient(145deg, ${S.navy} 0%, ${S.navy2} 58%, ${S.blue} 100%)`,color:"#fff",boxShadow:"0 24px 56px rgba(18,41,80,.20)"}}>
        <div style={{position:"absolute",top:-78,right:-42,width:220,height:220,borderRadius:"50%",background:"rgba(255,255,255,.10)",animation:"glowFloat 10s ease-in-out infinite"}}/>
        <div style={{position:"absolute",bottom:-110,left:-62,width:280,height:280,borderRadius:"50%",background:"rgba(255,255,255,.08)",animation:"glowFloat 12s ease-in-out infinite 1s"}}/>
        <div style={{position:"relative",zIndex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <span style={{display:"inline-flex",alignItems:"center",gap:8,padding:"7px 12px",borderRadius:999,background:"rgba(255,255,255,.12)",border:"1px solid rgba(255,255,255,.15)",fontSize:11,fontWeight:800,letterSpacing:".35px"}}>{chip}</span>
            <span style={{fontSize:12,color:"rgba(255,255,255,.72)",fontWeight:700}}>{session?.hotelName||session?.hotelId||"Otel seçimi bekleniyor"}</span>
            <span style={{fontSize:12,color:"rgba(255,255,255,.52)",fontWeight:700}}>{session?.username||"Kullanıcı"}</span>
          </div>
          <h1 className="ops-hero-title" style={{marginTop:18,fontFamily:"'Nunito',sans-serif",fontSize:38,lineHeight:1.05,fontWeight:900,letterSpacing:"-.9px",maxWidth:560}}>{title}</h1>
          <p className="ops-hero-sub" style={{marginTop:14,maxWidth:560,fontSize:15,lineHeight:1.8,color:"rgba(255,255,255,.76)"}}>{subtitle}</p>
          <div className="ops-hero-cards" style={{marginTop:22,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:12}}>
            <div className="ops-hero-card" style={{borderRadius:18,padding:"14px 16px",background:"rgba(7,16,34,.22)",border:"1px solid rgba(255,255,255,.12)"}}>
              <div style={{fontSize:10.5,fontWeight:800,letterSpacing:".5px",color:"rgba(255,255,255,.58)"}}>AKTİF OTEL</div>
              <div style={{marginTop:7,fontSize:16,fontWeight:800}}>{session?.hotelName||"Tanımsız"}</div>
              <div style={{marginTop:4,fontSize:12,color:"rgba(255,255,255,.66)"}}>{session?.hotelId||"Hotel ID yok"}</div>
            </div>
            <div className="ops-hero-card" style={{borderRadius:18,padding:"14px 16px",background:"rgba(7,16,34,.22)",border:"1px solid rgba(255,255,255,.12)"}}>
              <div style={{fontSize:10.5,fontWeight:800,letterSpacing:".5px",color:"rgba(255,255,255,.58)"}}>{selectedTitle||"SEÇİLİ KAYIT"}</div>
              <div style={{marginTop:7,fontSize:16,fontWeight:800}}>{selectedMeta?.title||"Seçim bekleniyor"}</div>
              <div style={{marginTop:4,fontSize:12,color:"rgba(255,255,255,.66)"}}>{selectedMeta?.detail||"Devam etmek için kayıt seçin"}</div>
            </div>
          </div>
        </div>
      </div>
      <div className="ops-stat-grid">
        {stats.map((stat,idx)=><StatCard key={idx} {...stat}/>)}
      </div>
    </div>
  );
}
// Doğum tarihi — klavyeden GG.AA.YYYY yazılabilir; 📅 ile gün/ay/yıl seçici açılır. Değer ISO (YYYY-AA-GG) olarak tutulur.
const DateInput=({label,value,onChange,required,onInvalid})=>{
  const [show,setShow]=React.useState(false);
  const [y,setY]=React.useState((value||"").slice(0,4)||"");
  const [m,setM]=React.useState((value||"").slice(5,7)||"");
  const [d,setD]=React.useState((value||"").slice(8,10)||"");
  const isoToText=iso=>/^\d{4}-\d{2}-\d{2}/.test(iso||"") ? `${iso.slice(8,10)}.${iso.slice(5,7)}.${iso.slice(0,4)}` : "";
  // GG.AA.YYYY gerçek bir takvim tarihiyse ISO'ya çevirir (1900 - bu yıl); değilse ""
  const textToIso=t=>{
    const mm=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t);
    if(!mm) return "";
    const [,dd,mo,yyyy]=mm;
    const dt=new Date(Date.UTC(+yyyy,+mo-1,+dd));
    const ok=dt.getUTCFullYear()===+yyyy && dt.getUTCMonth()===+mo-1 && dt.getUTCDate()===+dd && +yyyy>=1900 && +yyyy<=new Date().getFullYear();
    return ok ? `${yyyy}-${mo}-${dd}` : "";
  };
  const [text,setText]=React.useState(isoToText(value));

  React.useEffect(()=>{
    if(value&&value.length>=10){
      setY(value.slice(0,4));setM(value.slice(5,7));setD(value.slice(8,10));
    } else if(!value){
      setY("");setM("");setD("");
    }
    // Değer dışarıdan (seçici, tarama) değiştiyse yazılı metni güncelle; yazarken yarım kalan metne dokunma
    if(value!==textToIso(text)) setText(isoToText(value));
  },[value]);

  const onType=e=>{
    const digits=e.target.value.replace(/\D/g,"").slice(0,8);
    const t=digits.slice(0,2)+(digits.length>2?"."+digits.slice(2,4):"")+(digits.length>4?"."+digits.slice(4,8):"");
    setText(t);
    const iso=textToIso(t);
    if(iso!==value) onChange(iso);
  };
  const badText = text.length===10 && !textToIso(text);
  // Yarım ya da geçersiz yazılmış tarih: form kaydı engelleyebilsin diye bildirilir
  const incomplete = text.length>0 && !textToIso(text);
  React.useEffect(()=>{ if(onInvalid) onInvalid(incomplete); },[incomplete]);

  const commit=(ny,nm,nd)=>{
    if(ny&&ny.length===4&&nm&&nd){
      onChange(ny+"-"+nm.padStart(2,"0")+"-"+nd.padStart(2,"0"));
    }
  };

  const curYear=new Date().getFullYear();
  const years=Array.from({length:100},(_,i)=>String(curYear-i));
  const months=["01","02","03","04","05","06","07","08","09","10","11","12"];
  const days=Array.from({length:31},(_,i)=>String(i+1).padStart(2,"0"));

  return(
    <div style={{position:"relative"}}>
      <label className="lbl">{label}{required&&<span style={{color:S.red}}> *</span>}</label>
      <div className="inp" style={{display:"flex",alignItems:"center",gap:8,...(badText?{borderColor:S.red}:{})}}>
        <input type="text" inputMode="numeric" autoComplete="off" maxLength={10} placeholder={t("GG.AA.YYYY")} value={text} onChange={onType}
          style={{flex:1,minWidth:0,border:"none",outline:"none",background:"transparent",font:"inherit",color:"inherit",padding:0}}/>
        <button type="button" onClick={()=>setShow(s=>!s)} title={t("Takvimden seç")} aria-label={t("Takvimden seç")} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,padding:"6px 4px",minWidth:36}}>📅</button>
      </div>
      {badText&&<div style={{fontSize:11,color:S.red,marginTop:3}}>{t("Geçerli bir tarih girin (GG.AA.YYYY)")}</div>}
      {show&&<div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:999,background:"#fff",border:`1.5px solid ${S.blue}`,borderRadius:12,boxShadow:"0 8px 28px rgba(26,58,110,.18)",padding:14,marginTop:4}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
          <div>
            <div style={{fontSize:10,fontWeight:700,color:S.muted,marginBottom:4,textAlign:"center"}}>{t("GÜN")}</div>
            <select value={d} onChange={e=>{setD(e.target.value);commit(y,m,e.target.value);}} className="inp" style={{padding:"10px 4px",textAlign:"center",fontSize:16}}>
              <option value="">--</option>
              {days.map(v=><option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <div style={{fontSize:10,fontWeight:700,color:S.muted,marginBottom:4,textAlign:"center"}}>{t("AY")}</div>
            <select value={m} onChange={e=>{setM(e.target.value);commit(y,e.target.value,d);}} className="inp" style={{padding:"10px 4px",textAlign:"center",fontSize:16}}>
              <option value="">--</option>
              {months.map(v=><option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <div style={{fontSize:10,fontWeight:700,color:S.muted,marginBottom:4,textAlign:"center"}}>{t("YIL")}</div>
            <select value={y} onChange={e=>{setY(e.target.value);commit(e.target.value,m,d);}} className="inp" style={{padding:"10px 4px",textAlign:"center",fontSize:16}}>
              <option value="">----</option>
              {years.map(v=><option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
        <button onClick={()=>setShow(false)} style={{width:"100%",background:`linear-gradient(135deg,${S.blue},${S.navy})`,color:"#fff",border:"none",borderRadius:8,padding:"12px",fontSize:14,fontWeight:700,cursor:"pointer"}}>{t("Tamam")}</button>
      </div>}
    </div>
  );
};

const Fld=({label,value,onChange,type="text",required,opts})=>(
  <div>
    <label className="lbl">{label}{required&&<span style={{color:S.red}}> *</span>}</label>
    {opts?<select value={value} onChange={e=>onChange(e.target.value)} className="inp" style={{appearance:"none"}}>{opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select>
        :<input type={type} value={value} onChange={e=>onChange(e.target.value)} className="inp"/>}
  </div>
);

const USERS_KEY = "snappass_users";
const RUNTIME_KEY = "snappass_runtime";
const RUNTIME_VERSION = "2026-03-22-ocrfix-1";

function normalizeUserRecord(user, idx=0){
  const username = (user?.username || "").trim();
  return {
    id: user?.id || `usr_${idx}_${Date.now()}`,
    username,
    password: user?.password || "",
    fullName: (user?.fullName || username || "Kullanici").trim(),
    role: user?.role === "admin" ? "admin" : "user",
    active: user?.active !== false,
    chainId: user?.chainId || "",
    hotelId: (user?.hotelId || "").trim(),
    createdAt: user?.createdAt || new Date().toISOString(),
  };
}

function normalizeHotelRecord(hotel, idx=0){
  const id = (hotel?.id || "").trim();
  const name = (hotel?.name || hotel?.hotelName || id || `Hotel ${idx + 1}`).trim();
  return {
    id: id || `hotel_${idx}_${Date.now()}`,
    name,
  };
}

function normalizeChainRecord(chain, idx=0){
  const id = (chain?.id || "").trim();
  const hotels = Array.isArray(chain?.hotels) ? chain.hotels.map((hotel, hotelIdx)=>normalizeHotelRecord(hotel, hotelIdx)).filter(hotel=>hotel.id) : [];
  return {
    id: id || `chain_${idx}_${Date.now()}`,
    name: (chain?.name || `Zincir ${idx + 1}`).trim(),
    hotels,
  };
}

function normalizeConfigModel(cfg){
  const merged = {...defaultConfig,...(cfg || {})};
  let chains = Array.isArray(merged.chains) ? merged.chains.map((chain, idx)=>normalizeChainRecord(chain, idx)).filter(chain=>chain.name) : [];
  if(!chains.length && merged.hotelId){
    chains = [{
      id: "chain_default",
      name: (merged.chainName || "Varsayilan Zincir").trim(),
      hotels: [normalizeHotelRecord({ id: merged.hotelId, name: merged.hotelName || merged.hotelId }, 0)],
    }];
  }
  const allHotels = chains.flatMap(chain => chain.hotels.map(hotel => ({...hotel, chainId: chain.id, chainName: chain.name})));
  const fallbackHotel = allHotels.find(hotel => hotel.id === merged.hotelId) || allHotels[0] || null;
  // Eski kayıtlardaki OPERA kullanıcı/şifre alanları artık kullanılmıyor
  delete merged.operaUsername;
  delete merged.operaPassword;
  return {
    ...merged,
    chainName: merged.chainName || fallbackHotel?.chainName || "",
    hotelId: merged.hotelId || fallbackHotel?.id || "",
    hotelName: merged.hotelName || fallbackHotel?.name || "",
    chains,
  };
}

function getAllHotels(cfg){
  return (cfg?.chains || []).flatMap(chain =>
    (chain.hotels || []).map(hotel => ({
      ...hotel,
      chainId: chain.id,
      chainName: chain.name,
      label: `${chain.name} / ${hotel.name} (${hotel.id})`,
    }))
  );
}

function resolveHotelAssignment(cfg, user){
  const normalizedCfg = normalizeConfigModel(cfg);
  const hotels = getAllHotels(normalizedCfg);
  const assigned = hotels.find(hotel => hotel.id === user?.hotelId) || null;
  if(assigned) return assigned;
  const fallback = hotels.find(hotel => hotel.id === normalizedCfg.hotelId) || hotels[0] || null;
  if(fallback) return fallback;
  return {
    id: normalizedCfg.hotelId || "",
    name: normalizedCfg.hotelName || normalizedCfg.hotelId || "",
    chainId: user?.chainId || normalizedCfg.chainId || "",
    chainName: normalizedCfg.chainName || "",
    label: normalizedCfg.hotelName || normalizedCfg.hotelId || "Tanimsiz Otel",
  };
}

function seedUsersFromConfig(cfg){
  const normalizedCfg = normalizeConfigModel(cfg);
  return [
    normalizeUserRecord({
      id: "admin_default",
      username: normalizedCfg?.appUser || "admin",
      password: normalizedCfg?.appPassword || "1234",
      fullName: "Sistem Yoneticisi",
      role: "admin",
      active: true,
      chainId: normalizedCfg?.chains?.[0]?.id || "",
      hotelId: normalizedCfg?.hotelId || "",
    }, 0)
  ];
}

function loadUsers(cfg){
  const normalizedCfg = normalizeConfigModel(cfg);
  try{
    const raw = JSON.parse(localStorage.getItem(USERS_KEY) || "[]");
    if(Array.isArray(raw) && raw.length){
      return raw.map((u,idx)=>normalizeUserRecord(u,idx)).filter(u=>u.username);
    }
  }catch{}
  const seeded = seedUsersFromConfig(normalizedCfg);
  try{ localStorage.setItem(USERS_KEY, JSON.stringify(seeded)); }catch{}
  return seeded;
}

function saveUsers(users){
  try{
    localStorage.setItem(
      USERS_KEY,
      JSON.stringify((users || []).map((u,idx)=>normalizeUserRecord(u,idx)).filter(u=>u.username))
    );
  }catch{}
}

function findUser(users, username){
  const key = (username || "").trim().toLowerCase();
  return (users || []).find(u => u.username.trim().toLowerCase() === key) || null;
}

function authenticateUser(users, username, password){
  const user = findUser(users, username);
  if(!user || !user.active || user.password !== password) return null;
  return user;
}

function isAdminUser(session){
  return session?.role === "admin";
}

function loadRuntimeState(){
  try{
    const data = JSON.parse(sessionStorage.getItem(RUNTIME_KEY) || "null");
    if(!data || data.version !== RUNTIME_VERSION) return null;
    return data;
  }catch{
    return null;
  }
}

function saveRuntimeState(state){
  try{ sessionStorage.setItem(RUNTIME_KEY, JSON.stringify({...state,version:RUNTIME_VERSION})); }catch{}
}

function clearRuntimeState(){
  try{ sessionStorage.removeItem(RUNTIME_KEY); }catch{}
}

// OHIP / KBS hata uyarıları: zil + sayaç; her kullanıcı yeni bir uyarıyı ilk kez gördüğünde bir kez popup çıkar.
function AlertBell(){
  const [items,setItems]=useState([]);
  const [open,setOpen]=useState(false);
  const [popup,setPopup]=useState([]);
  const dismissed=useRef(new Set());
  const load=useCallback(async()=>{
    try{
      const r=await fetch(`${PROXY}/api/alerts`);
      if(!r.ok)return;
      const d=await r.json();
      const list=d.alerts||[];
      setItems(list);
      setPopup(list.filter(a=>!a.resolved&&!a.seen&&!dismissed.current.has(a.id)));
    }catch(_){}
  },[]);
  useEffect(()=>{
    load();
    const iv=setInterval(load,60000);
    const onVis=()=>{ if(document.visibilityState==="visible")load(); };
    document.addEventListener("visibilitychange",onVis);
    return()=>{clearInterval(iv);document.removeEventListener("visibilitychange",onVis);};
  },[load]);
  const active=items.filter(a=>!a.resolved);
  const ack=async()=>{
    const ids=popup.map(a=>a.id);
    ids.forEach(i=>dismissed.current.add(i));
    setPopup([]);
    try{await fetch(`${PROXY}/api/alerts/seen`,{method:"POST",headers:{"Content-Type":"application/json","x-csrf":serverCsrf},body:JSON.stringify({ids})});}catch(_){}
    load();
  };
  const when=(d)=>{try{return new Date(d).toLocaleString(CUR_LANG==="en"?"en-GB":"tr-TR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});}catch(_){return "";}};
  const label=(a)=>a.source==="kbs"?"KBS":"OHIP";
  return(<>
    <button className="tb-btn" onClick={()=>setOpen(o=>!o)} title={t("Sistem uyarıları")} aria-label={t("Sistem uyarıları")} style={{position:"relative",background:active.length?"rgba(231,76,60,.22)":"rgba(255,255,255,.1)",border:active.length?"1px solid rgba(231,76,60,.5)":"1px solid rgba(255,255,255,.18)",color:"#fff",borderRadius:10,padding:"7px 11px",fontSize:14,cursor:"pointer",flexShrink:0,lineHeight:1}}>
      🔔{active.length>0&&<span style={{position:"absolute",top:-6,right:-6,minWidth:18,height:18,borderRadius:9,background:"#E74C3C",color:"#fff",fontSize:11,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 4px"}}>{active.length}</span>}
    </button>
    {open&&<Portal><div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:9000}}>
      <div onClick={e=>e.stopPropagation()} style={{position:"absolute",top:64,right:12,left:12,maxWidth:420,marginLeft:"auto",background:"#fff",borderRadius:14,boxShadow:"0 16px 48px rgba(0,0,0,.28)",padding:14,maxHeight:"70vh",overflow:"auto",color:"#1f2937"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <b style={{fontSize:14}}>{t("Sistem uyarıları")}</b>
          <button onClick={()=>setOpen(false)} style={{border:"none",background:"none",fontSize:20,cursor:"pointer",padding:"4px 8px"}}>×</button>
        </div>
        {items.length===0&&<div style={{fontSize:13,color:"#6b7280",padding:"10px 0"}}>{t("Şu an bir sorun yok.")}</div>}
        {items.map(a=><div key={a.id} style={{borderTop:"1px solid #eef0f3",padding:"10px 0",opacity:a.resolved?.55:1}}>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{fontSize:11,fontWeight:800,padding:"2px 8px",borderRadius:999,background:a.resolved?"#dcfce7":"#fee2e2",color:a.resolved?"#166534":"#991b1b"}}>{label(a)} · {a.resolved?t("Çözüldü"):t("Aktif")}</span>
            <span style={{fontSize:11,color:"#6b7280"}}>{when(a.lastAt)}{a.count>1?` · ${a.count}×`:""}</span>
          </div>
          <div style={{fontSize:13,marginTop:4}}>{a.message}</div>
        </div>)}
      </div>
    </div></Portal>}
    {popup.length>0&&<Portal><div style={{position:"fixed",inset:0,zIndex:9500,background:"rgba(10,20,40,.55)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div role="alertdialog" style={{background:"#fff",borderRadius:16,maxWidth:440,width:"100%",padding:20,boxShadow:"0 24px 64px rgba(0,0,0,.35)",color:"#1f2937",maxHeight:"85vh",overflow:"auto"}}>
        <div style={{fontSize:18,fontWeight:800,marginBottom:6}}>⚠️ {t("Sistem uyarısı")}</div>
        <div style={{fontSize:13,color:"#6b7280",marginBottom:10}}>{t("Aşağıdaki sorun bildirildi. Çözülene kadar zil simgesinde görünmeye devam eder.")}</div>
        {popup.map(a=><div key={a.id} style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"10px 12px",marginBottom:8}}>
          <b style={{fontSize:13}}>{label(a)}</b>
          <div style={{fontSize:13,marginTop:2}}>{a.message}</div>
        </div>)}
        <button onClick={ack} style={{width:"100%",marginTop:6,padding:"13px 16px",border:"none",borderRadius:12,background:"#102546",color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer"}}>{t("Anladım")}</button>
      </div>
    </div></Portal>}
  </>);
}

function TopBar({session,onLogout,onBack,onConfig}){
  return(
    <div style={{background:`linear-gradient(135deg,#102546,${S.navy2} 60%,${S.navy3})`,boxShadow:"0 8px 28px rgba(12,28,58,.22)"}}>
      <div className="topbar-row" style={{maxWidth:APP_W,margin:"0 auto",display:"flex",alignItems:"center",gap:14,minHeight:70,padding:"10px 18px",flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
          {onBack&&<button onClick={onBack} style={{background:"rgba(255,255,255,.12)",border:"1px solid rgba(255,255,255,.14)",color:"#fff",borderRadius:"10px",padding:"7px 12px",cursor:"pointer",fontSize:12,fontWeight:800,backdropFilter:"blur(8px)"}}>{t("← Geri")}</button>}
          <div className={onBack?"topbar-logo has-back":"topbar-logo"} style={{display:"inline-flex",alignItems:"center",gap:12,padding:"8px 14px",borderRadius:12,background:"#fff",boxShadow:"0 2px 10px rgba(8,20,42,.25)"}}>
            <img className="tb-logo-img" src="/admin/protel-logo.svg" alt="PROTEL" style={{height:22,width:"auto",display:"block"}}/>
            <span className="tb-logo-text" style={{paddingLeft:12,borderLeft:"1px solid #D9DEE7",fontSize:15,fontWeight:700,color:"#1F2937",lineHeight:1.2,whiteSpace:"nowrap"}}>SnapPass</span>
          </div>
        </div>
        <div className="topbar-title" style={{flex:1,minWidth:220}}>
          <div style={{fontSize:13,fontWeight:800,color:"rgba(255,255,255,.96)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{session?.hotelName||t("SnapPass Belge Tarayıcı")}</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.48)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{session?`${session.fullName || session.username} · ${session.hotelId}`:t("Oracle OPERA Cloud iş akışı")}</div>
        </div>
        {session?<div className="tb-acts" style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginLeft:"auto"}}>
          <span className="topbar-chip" style={{padding:"5px 10px",borderRadius:999,background:isAdminUser(session)?"rgba(39,174,96,.16)":"rgba(255,255,255,.08)",border:isAdminUser(session)?"1px solid rgba(39,174,96,.26)":"1px solid rgba(255,255,255,.12)",color:isAdminUser(session)?"#C7F4D4":"rgba(255,255,255,.82)",fontSize:11,fontWeight:800}}>{isAdminUser(session)?t("YÖNETİCİ"):t("KULLANICI")}</span>
          <span className="topbar-chip" style={{padding:"5px 10px",borderRadius:999,background:"rgba(247,148,29,.16)",border:"1px solid rgba(247,148,29,.22)",color:S.orangeLt,fontSize:11,fontWeight:800}}>{session.hotelId}</span>
          <AlertBell/>
          {session.hotelAdmin&&<a className="tb-btn" href="/otel" title={t("Otel yönetimi")} aria-label={t("Otel yönetimi")} style={{background:"rgba(247,148,29,.18)",border:"1px solid rgba(247,148,29,.34)",color:S.orangeLt,borderRadius:"10px",padding:"7px 11px",fontSize:12,fontWeight:800,textDecoration:"none",minHeight:34,display:"inline-flex",alignItems:"center"}}>🛠 <span className="topbar-help-label" style={{marginLeft:4}}>{t("Otel yönetimi")}</span></a>}
          <a className="tb-btn" href="/yardim" target="_blank" rel="noopener" title={t("Yardım")} aria-label={t("Yardım")} style={{background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.18)",color:"rgba(255,255,255,.85)",borderRadius:"10px",padding:"7px 11px",fontSize:12,fontWeight:800,textDecoration:"none",minHeight:34,display:"inline-flex",alignItems:"center"}}>❔ <span className="topbar-help-label" style={{marginLeft:4}}>{t("Yardım")}</span></a>
          {onConfig&&<button className="tb-btn" onClick={onConfig} title={t("Yönetim paneli")} aria-label={t("Yönetim paneli")} style={{background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.18)",color:"rgba(255,255,255,.78)",borderRadius:"10px",padding:"7px 11px",fontSize:12,cursor:"pointer",flexShrink:0}}>⚙</button>}
          <LangSwitch/>
          {onLogout&&<button className="tb-btn" onClick={onLogout} style={{background:"rgba(247,148,29,.18)",border:"1px solid rgba(247,148,29,.34)",color:S.orangeLt,borderRadius:"10px",padding:"7px 12px",fontSize:12,fontWeight:800,cursor:"pointer",flexShrink:0}}>{t("Çıkış")}</button>}
        </div>:<div style={{marginLeft:"auto"}}><LangSwitch/></div>}
      </div>
    </div>
  );
}

function AdminAccessGate({users,onGrant,onBack}){
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [err,setErr]=useState("");

  const submit=()=>{
    const user = authenticateUser(users, username, password);
    if(!user || user.role !== "admin"){
      setErr("Ayarlar alanina sadece aktif admin kullanici girebilir");
      return;
    }
    setErr("");
    onGrant(user);
  };

  return(
    <div style={{minHeight:"100dvh",background:`linear-gradient(155deg,#1B3C6D,${S.navy2} 48%,${S.navy3})`}}>
      <style>{GS}</style>
      <div style={{maxWidth:460,margin:"0 auto",padding:"34px 20px 60px"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:22}}>
          <button onClick={onBack} style={{background:"rgba(255,255,255,.12)",border:"none",color:"#fff",borderRadius:"8px",padding:"8px 14px",cursor:"pointer",fontSize:13,fontWeight:700}}>← Geri</button>
          <div>
            <div style={{fontFamily:"'Nunito',sans-serif",fontSize:22,fontWeight:900,color:"#fff"}}>Yonetici Dogrulamasi</div>
            <div style={{fontSize:12,color:"rgba(255,255,255,.45)"}}>Ayarlar ve kullanici yonetimi icin admin girisi gerekir</div>
          </div>
        </div>
        <div style={{background:"#fff",borderRadius:18,padding:"24px",display:"grid",gap:14,boxShadow:"0 20px 55px rgba(8,22,44,.24)"}}>
          <div><label className="lbl">Admin Kullanici Adi</label><input value={username} onChange={e=>setUsername(e.target.value)} className="inp" autoComplete="username"/></div>
          <div><label className="lbl">Admin Sifre</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} className="inp" autoComplete="current-password"/></div>
          {err&&<div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:12,padding:"12px 14px",fontSize:12.5,color:S.red,wordBreak:"break-word",lineHeight:1.6}}>⚠ {err}</div>}
          <button className="btn btn-p" onClick={submit} style={{width:"100%"}}>Ayarlar Alani Ac</button>
        </div>
      </div>
    </div>
  );
}

/* ── CONFIG ──────────────────────────────────────────────────────────────── */
function Config({config, users, currentUser, onSave, onUsersChange, onBack}){
  const [f,setF]=useState(()=>normalizeConfigModel(config));
  const [draft,setDraft]=useState({fullName:"",username:"",password:"",role:"user",chainId:"",hotelId:""});
  const [chainDraft,setChainDraft]=useState("");
  const [hotelDraft,setHotelDraft]=useState({chainId:"",id:"",name:""});
  const [pwdDrafts,setPwdDrafts]=useState({});
  const [userErr,setUserErr]=useState("");
  const [userInfo,setUserInfo]=useState("");
  const [ohipTest,setOhipTest]=useState({busy:false,ok:null,msg:""});
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));

  // Formdaki (henüz kaydedilmemiş) değerlerle OHIP'ten token almayı dener
  const testOhip=async()=>{
    if(!f.hostName||!f.clientId||!f.clientSecret||!f.appKey){
      setOhipTest({busy:false,ok:false,msg:"Host, App Key, Client ID ve Client Secret dolu olmalı"});
      return;
    }
    setOhipTest({busy:true,ok:null,msg:""});
    const started=Date.now();
    try{
      await operaGetToken({
        hostName:f.hostName.trim().replace(/\/+$/,""),
        clientId:f.clientId.trim(),
        clientSecret:f.clientSecret.trim(),
        appKey:f.appKey.trim(),
        scope:f.scope?.trim()||"",
        enterpriseId:(f.enterpriseId||"").trim(),
      });
      setOhipTest({busy:false,ok:true,msg:`OHIP bağlantısı başarılı — token alındı (${Date.now()-started} ms)`});
    }catch(e){
      setOhipTest({busy:false,ok:false,msg:e.message});
    }
  };
  const activeAdminCount = (users || []).filter(u=>u.active && u.role==="admin").length;
  const hotelOptions = getAllHotels(f);
  const chainOptions = (f.chains || []).map(chain => ({ v: chain.id, l: chain.name }));

  useEffect(()=>{
    setF(prev=>normalizeConfigModel(prev));
  },[]);

  const getHotelMeta = (hotelId)=>hotelOptions.find(hotel => hotel.id === hotelId) || null;
  const getHotelsByChain = (chainId)=>(f.chains || []).find(chain => chain.id === chainId)?.hotels || [];

  const setDefaultChain = (chainId)=>{
    const chain = (f.chains || []).find(item => item.id === chainId) || null;
    const fallbackHotel = chain?.hotels?.[0] || null;
    setF(prev=>({
      ...prev,
      chainName: chain?.name || "",
      hotelId: fallbackHotel?.id || "",
      hotelName: fallbackHotel?.name || "",
    }));
  };

  const setDefaultHotel = (hotelId)=>{
    const hotel = getHotelMeta(hotelId);
    setF(prev=>({
      ...prev,
      hotelId: hotel?.id || "",
      hotelName: hotel?.name || "",
      chainName: hotel?.chainName || prev.chainName || "",
    }));
  };

  const pushUsers = (nextUsers, infoText)=>{
    onUsersChange(nextUsers);
    setUserErr("");
    setUserInfo(infoText || "");
  };

  const addUser = ()=>{
    const username = draft.username.trim();
    const fullName = draft.fullName.trim();
    if(!username || !draft.password){
      setUserErr("Yeni kullanici icin kullanici adi ve sifre zorunlu");
      setUserInfo("");
      return;
    }
    if(findUser(users, username)){
      setUserErr("Bu kullanici adi zaten tanimli");
      setUserInfo("");
      return;
    }
    if(hotelOptions.length && !draft.hotelId){
      setUserErr("Yeni kullanici icin bir otel atamasi yapin");
      setUserInfo("");
      return;
    }
    const nextUsers = [...users, normalizeUserRecord({
      id:`usr_${Date.now()}`,
      username,
      password:draft.password,
      fullName:fullName || username,
      role:draft.role,
      active:true,
      chainId:draft.chainId || getHotelMeta(draft.hotelId)?.chainId || "",
      hotelId:draft.hotelId || "",
    })];
    pushUsers(nextUsers, "Kullanici eklendi");
    setDraft({fullName:"",username:"",password:"",role:"user",chainId:"",hotelId:""});
  };

  const updateUser = (id, patch)=>{
    const nextUsers = users.map(u=>u.id===id?normalizeUserRecord({...u,...patch}):u);
    pushUsers(nextUsers, "Kullanici guncellendi");
  };

  const toggleActive = (user)=>{
    if(user.id === currentUser?.userId && user.active){
      setUserErr("Aktif oturumdaki kullanici pasiflestirilemez");
      setUserInfo("");
      return;
    }
    if(user.role === "admin" && user.active && activeAdminCount <= 1){
      setUserErr("Son aktif admin pasiflestirilemez");
      setUserInfo("");
      return;
    }
    updateUser(user.id, { active: !user.active });
  };

  const changeRole = (user, role)=>{
    if(user.id === currentUser?.userId && user.role === "admin" && role !== "admin"){
      setUserErr("Kendi admin yetkinizi bu ekrandan kaldiramazsiniz");
      setUserInfo("");
      return;
    }
    if(user.role === "admin" && role !== "admin" && activeAdminCount <= 1){
      setUserErr("Son aktif admin kullanici rolu degistirilemez");
      setUserInfo("");
      return;
    }
    updateUser(user.id, { role });
  };

  const resetPassword = (user)=>{
    const nextPassword = (pwdDrafts[user.id] || "").trim();
    if(!nextPassword){
      setUserErr("Sifre sifirlama icin yeni sifre girin");
      setUserInfo("");
      return;
    }
    updateUser(user.id, { password: nextPassword });
    setPwdDrafts(prev=>({...prev,[user.id]:""}));
    setUserInfo(`${user.username} sifresi guncellendi`);
  };

  const removeUser = (user)=>{
    if(user.id === currentUser?.userId){
      setUserErr("Acilis yapmis kullanici silinemez");
      setUserInfo("");
      return;
    }
    if(user.role === "admin" && activeAdminCount <= 1){
      setUserErr("Son aktif admin silinemez");
      setUserInfo("");
      return;
    }
    pushUsers(users.filter(u=>u.id!==user.id), "Kullanici silindi");
  };

  const addChain = ()=>{
    const name = chainDraft.trim();
    if(!name){
      setUserErr("Zincir adi bos olamaz");
      setUserInfo("");
      return;
    }
    const nextChain = normalizeChainRecord({ id:`chain_${Date.now()}`, name, hotels:[] }, (f.chains || []).length);
    setF(prev=>({...prev, chains:[...(prev.chains || []), nextChain]}));
    setChainDraft("");
    setUserErr("");
    setUserInfo("Zincir eklendi");
  };

  const addHotel = ()=>{
    const chainId = hotelDraft.chainId || f.chains?.[0]?.id || "";
    const hotelId = hotelDraft.id.trim().toUpperCase();
    const hotelName = hotelDraft.name.trim();
    if(!chainId || !hotelId || !hotelName){
      setUserErr("Otel eklemek icin zincir, otel kodu ve otel adi zorunlu");
      setUserInfo("");
      return;
    }
    if(hotelOptions.some(hotel => hotel.id === hotelId)){
      setUserErr("Bu hotel ID zaten tanimli");
      setUserInfo("");
      return;
    }
    setF(prev=>({
      ...prev,
      chains:(prev.chains || []).map(chain => chain.id === chainId
        ? {...chain, hotels:[...(chain.hotels || []), normalizeHotelRecord({ id: hotelId, name: hotelName }, chain.hotels?.length || 0)]}
        : chain
      )
    }));
    setHotelDraft({chainId, id:"", name:""});
    setUserErr("");
    setUserInfo("Otel eklendi");
  };

  const removeChain = (chain)=>{
    const chainHotelIds = new Set((chain.hotels || []).map(hotel => hotel.id));
    if(users.some(user => chainHotelIds.has(user.hotelId))){
      setUserErr("Bu zincire bagli oteller kullanicilara atanmis. Once atamalari kaldirin.");
      setUserInfo("");
      return;
    }
    setF(prev=>{
      const nextChains = (prev.chains || []).filter(item => item.id !== chain.id);
      const fallback = getAllHotels({ ...prev, chains: nextChains })[0] || null;
      return {
        ...prev,
        chains: nextChains,
        hotelId: chainHotelIds.has(prev.hotelId) ? (fallback?.id || "") : prev.hotelId,
        hotelName: chainHotelIds.has(prev.hotelId) ? (fallback?.name || "") : prev.hotelName,
        chainName: chainHotelIds.has(prev.hotelId) ? (fallback?.chainName || "") : prev.chainName,
      };
    });
    setUserErr("");
    setUserInfo("Zincir silindi");
  };

  const removeHotel = (chain, hotel)=>{
    if(users.some(user => user.hotelId === hotel.id)){
      setUserErr("Bu otel kullanicilara atanmis. Once atamayi degistirin.");
      setUserInfo("");
      return;
    }
    setF(prev=>{
      const nextChains = (prev.chains || []).map(item =>
        item.id === chain.id ? {...item, hotels:(item.hotels || []).filter(entry => entry.id !== hotel.id)} : item
      );
      const fallback = getAllHotels({ ...prev, chains: nextChains })[0] || null;
      return {
        ...prev,
        chains: nextChains,
        hotelId: prev.hotelId === hotel.id ? (fallback?.id || "") : prev.hotelId,
        hotelName: prev.hotelId === hotel.id ? (fallback?.name || "") : prev.hotelName,
        chainName: prev.hotelId === hotel.id ? (fallback?.chainName || "") : prev.chainName,
      };
    });
    setUserErr("");
    setUserInfo("Otel silindi");
  };

  return(
    <div style={{minHeight:"100dvh",background:`linear-gradient(155deg,#1B3C6D,${S.navy2} 48%,${S.navy3})`}}>
      <style>{GS}</style>
      <div style={{maxWidth:960,margin:"0 auto",padding:"24px 20px 50px"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:22}}>
          <button onClick={onBack} style={{background:"rgba(255,255,255,.12)",border:"none",color:"#fff",borderRadius:"8px",padding:"8px 14px",cursor:"pointer",fontSize:13,fontWeight:700}}>← Geri</button>
          <div>
            <div style={{fontFamily:"'Nunito',sans-serif",fontSize:22,fontWeight:900,color:"#fff"}}>OPERA Cloud Bağlantısı</div>
            <div style={{fontSize:12,color:"rgba(255,255,255,.4)"}}>Ayarlar kaydedilir, her girişte tekrar girilmez</div>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(320px,.95fr)",gap:18,alignItems:"start"}}>
          <div style={{background:"#fff",borderRadius:18,padding:"22px 24px",display:"flex",flexDirection:"column",gap:13}}>
            <div>
              <label className="lbl">OPERA Host URL</label>
              <input value={f.hostName} onChange={set("hostName")} className="inp" style={{fontSize:12}}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:11}}>
              <div>
                <label className="lbl">Varsayilan Zincir</label>
                <select value={(getHotelMeta(f.hotelId)?.chainId || chainOptions[0]?.v || "")} onChange={e=>setDefaultChain(e.target.value)} className="inp">
                  <option value="">Zincir secin</option>
                  {chainOptions.map(opt=><option key={opt.v} value={opt.v}>{opt.l}</option>)}
                </select>
              </div>
              <div>
                <label className="lbl">Varsayilan Otel</label>
                <select value={f.hotelId} onChange={e=>setDefaultHotel(e.target.value)} className="inp">
                  <option value="">Otel secin</option>
                  {getHotelsByChain(getHotelMeta(f.hotelId)?.chainId || chainOptions[0]?.v || "").map(hotel=>(
                    <option key={hotel.id} value={hotel.id}>{hotel.name} ({hotel.id})</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:11}}>
              <div><label className="lbl">App Key</label><input value={f.appKey} onChange={set("appKey")} className="inp" style={{fontFamily:"monospace",fontSize:11}}/></div>
              <div><label className="lbl">Scope</label><input value={f.scope} onChange={set("scope")} className="inp" style={{fontSize:10}}/></div>
            </div>
            <div style={{background:"#F6F9FD",border:`1px solid ${S.border}`,borderRadius:10,padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>
              <div style={{fontSize:11,fontWeight:700,color:S.muted,letterSpacing:".7px",textTransform:"uppercase"}}>OAuth Client Credentials</div>
              <div><label className="lbl">Client ID</label><input value={f.clientId} onChange={set("clientId")} className="inp" style={{fontSize:12}}/></div>
              <div><label className="lbl">Client Secret</label><input type="password" value={f.clientSecret} onChange={set("clientSecret")} className="inp"/></div>
              <div><label className="lbl">Enterprise ID</label><input value={f.enterpriseId||""} onChange={set("enterpriseId")} className="inp" placeholder="Ornek: MAGTR"/></div>
              <button type="button" onClick={testOhip} disabled={ohipTest.busy} style={{background:"#fff",border:`1px solid ${S.blue}`,color:S.blue,borderRadius:10,padding:"10px 14px",fontSize:12,fontWeight:800,cursor:ohipTest.busy?"wait":"pointer",opacity:ohipTest.busy?.6:1}}>{ohipTest.busy?"Test ediliyor…":"OHIP TEST"}</button>
              {ohipTest.msg&&<div style={{background:ohipTest.ok?"#ECFDF3":"#FEF2F2",border:ohipTest.ok?"1px solid #A7F3D0":"1px solid #FECACA",borderRadius:10,padding:"10px 12px",fontSize:12,color:ohipTest.ok?"#166534":S.red,whiteSpace:"pre-wrap",wordBreak:"break-word",lineHeight:1.5}}>{ohipTest.ok?"✓ ":"⚠ "}{ohipTest.msg}</div>}
            </div>
            <div style={{background:"#F6F9FD",border:`1px solid ${S.border}`,borderRadius:10,padding:"12px 14px",display:"grid",gap:12}}>
              <div style={{fontSize:11,fontWeight:700,color:S.muted,letterSpacing:".7px",textTransform:"uppercase"}}>Zincir ve Otel Tanımları</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10,alignItems:"end"}}>
                <div><label className="lbl">Yeni Zincir</label><input value={chainDraft} onChange={e=>setChainDraft(e.target.value)} className="inp" placeholder="Ornek: MAG Hotels"/></div>
                <button type="button" onClick={addChain} style={{background:"#fff",border:`1px solid ${S.border}`,color:S.navy,borderRadius:10,padding:"11px 14px",fontSize:12,fontWeight:800,cursor:"pointer"}}>Zincir Ekle</button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1.1fr .9fr 1fr auto",gap:10,alignItems:"end"}}>
                <div><label className="lbl">Zincir</label><select value={hotelDraft.chainId} onChange={e=>setHotelDraft(prev=>({...prev,chainId:e.target.value}))} className="inp"><option value="">Zincir secin</option>{chainOptions.map(opt=><option key={opt.v} value={opt.v}>{opt.l}</option>)}</select></div>
                <div><label className="lbl">Hotel ID</label><input value={hotelDraft.id} onChange={e=>setHotelDraft(prev=>({...prev,id:e.target.value.toUpperCase()}))} className="inp" placeholder="MAGIST"/></div>
                <div><label className="lbl">Otel Adi</label><input value={hotelDraft.name} onChange={e=>setHotelDraft(prev=>({...prev,name:e.target.value}))} className="inp" placeholder="MAG HOTEL"/></div>
                <button type="button" onClick={addHotel} style={{background:"#fff",border:`1px solid ${S.border}`,color:S.navy,borderRadius:10,padding:"11px 14px",fontSize:12,fontWeight:800,cursor:"pointer"}}>Otel Ekle</button>
              </div>
              <div style={{display:"grid",gap:10}}>
                {(f.chains || []).map(chain=>(
                  <div key={chain.id} style={{border:`1px solid ${S.border}`,borderRadius:12,padding:"12px 14px",background:"#fff"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                      <div style={{flex:1,minWidth:180}}>
                        <div style={{fontSize:14,fontWeight:800,color:S.navy}}>{chain.name}</div>
                        <div style={{fontSize:11,color:S.muted}}>{chain.hotels?.length || 0} otel</div>
                      </div>
                      <button type="button" onClick={()=>removeChain(chain)} style={{background:"#FEF2F2",border:"1px solid #FECACA",color:S.red,borderRadius:10,padding:"8px 12px",fontSize:12,fontWeight:800,cursor:"pointer"}}>Zinciri Sil</button>
                    </div>
                    {!!chain.hotels?.length && <div style={{display:"grid",gap:8,marginTop:10}}>
                      {chain.hotels.map(hotel=>(
                        <div key={hotel.id} style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",padding:"10px 12px",borderRadius:10,background:"#F8FAFC",border:`1px solid ${S.border}`}}>
                          <div style={{flex:1,minWidth:180}}>
                            <div style={{fontSize:13,fontWeight:800,color:S.navy}}>{hotel.name}</div>
                            <div style={{fontSize:11,color:S.muted,fontFamily:"monospace"}}>{hotel.id}</div>
                          </div>
                          <button type="button" onClick={()=>setDefaultHotel(hotel.id)} style={{background:"#EEF5FF",border:`1px solid ${S.blue}33`,color:S.blue,borderRadius:10,padding:"8px 12px",fontSize:12,fontWeight:800,cursor:"pointer"}}>Varsayilan Yap</button>
                          <button type="button" onClick={()=>removeHotel(chain, hotel)} style={{background:"#FEF2F2",border:"1px solid #FECACA",color:S.red,borderRadius:10,padding:"8px 12px",fontSize:12,fontWeight:800,cursor:"pointer"}}>Sil</button>
                        </div>
                      ))}
                    </div>}
                  </div>
                ))}
              </div>
            </div>
            <button className="btn btn-p" onClick={()=>onSave(f)} style={{width:"100%",padding:13,fontSize:14,borderRadius:10,marginTop:4}}>
              💾 Kaydet
            </button>
          </div>

          <div style={{background:"#fff",borderRadius:18,padding:"22px 24px",display:"grid",gap:14}}>
            <div>
              <div style={{fontFamily:"'Nunito',sans-serif",fontSize:20,fontWeight:900,color:S.navy}}>Kullanici Yonetimi</div>
              <div style={{fontSize:12,color:S.muted,marginTop:4}}>Admin ve standart kullanici hesaplarini buradan ekleyin, pasiflestirin veya sifresini sifirlayin.</div>
            </div>

            <div style={{background:"#F6F9FD",border:`1px solid ${S.border}`,borderRadius:12,padding:"14px",display:"grid",gap:10}}>
              <div style={{fontSize:11,fontWeight:800,color:S.muted,letterSpacing:".7px",textTransform:"uppercase"}}>Yeni Kullanici</div>
              <div><label className="lbl">Ad Soyad</label><input value={draft.fullName} onChange={e=>setDraft(p=>({...p,fullName:e.target.value}))} className="inp"/></div>
              <div className="form-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label className="lbl">Kullanici Adi</label><input value={draft.username} onChange={e=>setDraft(p=>({...p,username:e.target.value}))} className="inp" autoComplete="off"/></div>
                <div><label className="lbl">Sifre</label><input type="password" value={draft.password} onChange={e=>setDraft(p=>({...p,password:e.target.value}))} className="inp" autoComplete="new-password"/></div>
              </div>
              <div className="form-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label className="lbl">Rol</label><select value={draft.role} onChange={e=>setDraft(p=>({...p,role:e.target.value}))} className="inp"><option value="user">Kullanici</option><option value="admin">Admin</option></select></div>
                <div><label className="lbl">Atanacak Otel</label><select value={draft.hotelId} onChange={e=>{const meta=getHotelMeta(e.target.value);setDraft(p=>({...p,hotelId:e.target.value,chainId:meta?.chainId||""}));}} className="inp"><option value="">Otel secin</option>{hotelOptions.map(opt=><option key={opt.id} value={opt.id}>{opt.label}</option>)}</select></div>
              </div>
              <button className="btn btn-p" onClick={addUser} style={{width:"100%"}}>Kullanici Ekle</button>
            </div>

            {userErr&&<div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:12,padding:"12px 14px",fontSize:12.5,color:S.red,lineHeight:1.6}}>⚠ {userErr}</div>}
            {userInfo&&<div style={{background:"#ECFDF3",border:"1px solid #A7F3D0",borderRadius:12,padding:"12px 14px",fontSize:12.5,color:"#166534",lineHeight:1.6}}>✓ {userInfo}</div>}

            <div style={{display:"grid",gap:12}}>
              {(users || []).map(user=>(
                <div key={user.id} style={{border:`1px solid ${S.border}`,borderRadius:14,padding:"14px",display:"grid",gap:10,background:user.active?"#fff":"#F8FAFC"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <div style={{flex:1,minWidth:160}}>
                      <div style={{fontSize:14,fontWeight:800,color:S.navy}}>{user.fullName || user.username}</div>
                      <div style={{fontSize:12,color:S.muted}}>@{user.username}</div>
                    </div>
                    <span style={{padding:"4px 9px",borderRadius:999,background:user.role==="admin"?"rgba(39,174,96,.14)":"#F4F8FF",border:user.role==="admin"?"1px solid rgba(39,174,96,.22)":`1px solid ${S.border}`,fontSize:11,fontWeight:800,color:user.role==="admin"?"#1E7A45":S.blue}}>{user.role==="admin"?"ADMIN":"KULLANICI"}</span>
                    <span style={{padding:"4px 9px",borderRadius:999,background:user.active?"rgba(74,144,217,.12)":"rgba(229,57,53,.1)",border:user.active?"1px solid rgba(74,144,217,.18)":"1px solid rgba(229,57,53,.16)",fontSize:11,fontWeight:800,color:user.active?S.blue:S.red}}>{user.active?"AKTIF":"PASIF"}</span>
                  </div>

                  <div className="form-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div><label className="lbl">Rol</label><select value={user.role} onChange={e=>changeRole(user,e.target.value)} className="inp"><option value="user">Kullanici</option><option value="admin">Admin</option></select></div>
                    <div><label className="lbl">Yeni Sifre</label><input type="password" value={pwdDrafts[user.id] || ""} onChange={e=>setPwdDrafts(prev=>({...prev,[user.id]:e.target.value}))} className="inp" autoComplete="new-password"/></div>
                  </div>
                  <div><label className="lbl">Atanmis Otel</label><select value={user.hotelId || ""} onChange={e=>{const meta=getHotelMeta(e.target.value);updateUser(user.id,{hotelId:e.target.value,chainId:meta?.chainId||""});}} className="inp"><option value="">Otel secin</option>{hotelOptions.map(opt=><option key={opt.id} value={opt.id}>{opt.label}</option>)}</select></div>
                  <div style={{fontSize:12,color:S.muted}}>
                    {user.hotelId ? `Atama: ${getHotelMeta(user.hotelId)?.chainName || "-"} / ${getHotelMeta(user.hotelId)?.name || user.hotelId}` : "Bu kullaniciya henüz otel atanmamış"}
                  </div>

                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <button onClick={()=>resetPassword(user)} style={{background:"#fff",border:`1px solid ${S.border}`,color:S.navy,borderRadius:10,padding:"9px 12px",fontSize:12,fontWeight:800,cursor:"pointer"}}>Sifreyi Sifirla</button>
                    <button onClick={()=>toggleActive(user)} style={{background:user.active?"#FFF7ED":"#ECFDF3",border:user.active?"1px solid #FCD6A8":"1px solid #A7F3D0",color:user.active?S.orangeDk:"#166534",borderRadius:10,padding:"9px 12px",fontSize:12,fontWeight:800,cursor:"pointer"}}>{user.active?"Pasiflestir":"Aktiflestir"}</button>
                    <button onClick={()=>removeUser(user)} style={{background:"#FEF2F2",border:"1px solid #FECACA",color:S.red,borderRadius:10,padding:"9px 12px",fontSize:12,fontWeight:800,cursor:"pointer"}}>Sil</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── LOGIN ─────────────────────────────────────────────────────────────── */
function Login({config, users, onLogin, onOpenConfig}){
  const [username,setUsername]=useState(()=>{ try{ return localStorage.getItem("sp_remember")==="1"?localStorage.getItem("sp_user")||"":""; }catch{ return ""; } });
  const [password,setPassword]=useState("");
  const [remember,setRemember]=useState(()=>{ try{ return localStorage.getItem("sp_remember")==="1"; }catch{ return false; } });
  const [err,setErr]=useState(""), [busy,setBusy]=useState(false);

  const connect=async()=>{
    if(!username.trim()||!password){setErr("Kullanıcı Adı"+" ve "+"Şifre"+" giriniz");return;}
    const appUser = authenticateUser(users, username.trim(), password);
    if(!appUser){
      setErr("Kullanıcı adı veya şifre hatalı");return;
    }
    if(!config.hostName||!config.clientId||!config.clientSecret||!config.appKey){
      setErr("Önce ⚙ Ayarlar'dan OPERA Cloud bağlantısını yapılandırın");return;
    }
    setBusy(true);setErr("");
    try{
      const assignedHotel = resolveHotelAssignment(config, appUser);
      const token=await operaGetToken({
        hostName:config.hostName.trim().replace(/\/+$/,""),
        clientId:config.clientId.trim(),
        clientSecret:config.clientSecret.trim(),
        appKey:config.appKey.trim(),
        scope:config.scope?.trim()||"",
        enterpriseId:(config.enterpriseId||"").trim(),
      });
      // Beni hatırla
      try{
        if(remember){ localStorage.setItem("sp_remember","1"); localStorage.setItem("sp_user",username.trim()); }
        else{ localStorage.removeItem("sp_remember"); localStorage.removeItem("sp_user"); }
      }catch(_){}
      onLogin({
        hostName:config.hostName.trim().replace(/\/+$/,""),
        hotelId:(assignedHotel?.id || config.hotelId || "").trim(),
        hotelName:(assignedHotel?.name || config.hotelName || config.hotelId || "").trim(),
        chainId:assignedHotel?.chainId || appUser.chainId || "",
        chainName:assignedHotel?.chainName || config.chainName || "",
        appKey:config.appKey.trim(),
        token,
        username:username.trim(),
        fullName:appUser.fullName || username.trim(),
        userId:appUser.id,
        role:appUser.role,
      });
    }catch(e){setErr(e.message);setBusy(false);}
  };

  return(
    <div style={{minHeight:"100dvh",background:"#F7FAFF",fontFamily:"'DM Sans','Segoe UI',sans-serif"}}>
      <style>{GS}</style>
      <div className="auth-shell">
        <div style={{position:"relative",overflow:"hidden",background:"linear-gradient(-45deg, #0A1628, #123D6F, #1565C0, #0D8ECF, #1A3A6E)",backgroundSize:"500% 500%",animation:"heroShift 16s ease infinite",display:"flex",flexDirection:"column",justifyContent:"space-between",padding:"48px 42px"}}>
          <div style={{position:"absolute",top:-110,right:-90,width:340,height:340,borderRadius:"50%",background:"radial-gradient(circle, rgba(13,142,207,.16), transparent 70%)",animation:"glowFloat 10s ease-in-out infinite"}}/>
          <div style={{position:"absolute",bottom:-70,left:-50,width:280,height:280,borderRadius:"50%",background:"radial-gradient(circle, rgba(247,148,29,.14), transparent 70%)",animation:"glowFloat 12s ease-in-out infinite 1s"}}/>
          <div style={{position:"relative",zIndex:1}}>
            <div style={{display:"inline-flex",flexDirection:"column",gap:10,padding:"18px 20px 16px",borderRadius:22,background:"linear-gradient(135deg, rgba(255,255,255,.14), rgba(255,255,255,.06))",border:"1px solid rgba(255,255,255,.14)",boxShadow:"0 18px 40px rgba(4,18,40,.18), inset 0 1px 0 rgba(255,255,255,.08)",backdropFilter:"blur(10px)",minWidth:280}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <Logo size="lg" onDark/>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,fontWeight:700,color:"rgba(255,255,255,.78)"}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:"#8FF0C8"}}/>
                MRZ, profil güncelleme ve resepsiyon akışı tek ekranda
              </div>
            </div>
          </div>
          <div style={{position:"relative",zIndex:1}}>
            <h1 style={{fontFamily:"'Nunito',sans-serif",fontSize:44,lineHeight:1.06,fontWeight:900,color:"#fff",letterSpacing:"-1.4px",maxWidth:420}}>Belge tarama için daha net, daha hızlı bir masaüstü akışı.</h1>
            <p style={{marginTop:20,fontSize:15.5,lineHeight:1.85,color:"rgba(255,255,255,.64)",maxWidth:380}}>OPERA Cloud rezervasyonlarını bulun, misafiri seçin, MRZ okutun ve belge bilgisini resepsiyon operasyonuna uygun akışla doğrulayın.</p>
          </div>
          <div style={{position:"relative",zIndex:1,display:"flex",gap:26,flexWrap:"wrap"}}>
            {[{n:"MRZ",l:"Desktop OCR"},{n:"1",l:"Tek Akış"},{n:"Live",l:"OPERA Sync"}].map(s=>(
              <div key={s.l}>
                <div style={{fontSize:28,fontWeight:900,color:"#fff",fontFamily:"'Nunito',sans-serif"}}>{s.n}</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,.4)",fontWeight:700,letterSpacing:".4px",marginTop:2}}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"42px 30px",position:"relative"}}>
          <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:`linear-gradient(90deg, #1565C0, #0D8ECF, ${S.orangeLt})`}} />
          <div className="fadeUp" style={{width:"100%",maxWidth:430}}>
            <div style={{fontSize:13,fontWeight:800,color:S.orangeDk,letterSpacing:".4px"}}>SnapPass Giriş</div>
            <h2 style={{marginTop:6,fontFamily:"'Nunito',sans-serif",fontSize:33,fontWeight:900,color:S.navy,letterSpacing:"-.7px",lineHeight:1.08}}>Resepsiyon çalışma alanına bağlanın</h2>
            <p style={{marginTop:10,fontSize:14,color:S.muted,lineHeight:1.75}}>Bu ekran `opera-setup` görsel diline uyarlanmıştır. Girişten sonra arama, tarama ve belge gönderim akışı aynı uygulama içinde devam eder.</p>

            <form onSubmit={e=>{e.preventDefault();connect();}} style={{marginTop:30,display:"grid",gap:18}}>
              <div style={{background:"#F6F9FD",border:`1px solid ${S.border}`,borderRadius:14,padding:"12px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                <div>
                  <div style={{fontSize:13,fontWeight:800,color:S.navy}}>{config.hotelName||config.hotelId||"—"}</div>
                  <div style={{fontSize:11,color:S.muted}}>{config.hotelId||"Hotel ID tanımlanmadı"}</div>
                </div>
                <button type="button" onClick={onOpenConfig} style={{background:"#fff",border:`1px solid ${S.border}`,color:S.muted,borderRadius:10,padding:"7px 12px",fontSize:11.5,fontWeight:800,cursor:"pointer"}}>⚙ Yonetici Ayarlari</button>
              </div>

              <div>
                <label className="lbl">Kullanıcı Adı</label>
                <div style={{display:"flex",alignItems:"center",border:`1.5px solid ${S.border}`,background:"#fff",borderRadius:12,padding:"0 16px",boxShadow:"0 1px 3px rgba(0,0,0,.03)"}}>
                  <span style={{fontSize:16,color:S.muted,opacity:.55}}>👤</span>
                  <input value={username} onChange={e=>setUsername(e.target.value)} className="inp" autoComplete="username" style={{border:"none",boxShadow:"none",padding:"15px 12px",background:"transparent",fontSize:14,flex:1}}/>
                </div>
              </div>

              <div>
                <label className="lbl">Şifre</label>
                <div style={{display:"flex",alignItems:"center",border:`1.5px solid ${S.border}`,background:"#fff",borderRadius:12,padding:"0 16px",boxShadow:"0 1px 3px rgba(0,0,0,.03)"}}>
                  <span style={{fontSize:16,color:S.muted,opacity:.55}}>🔒</span>
                  <input type="password" value={password} onChange={e=>setPassword(e.target.value)} className="inp" autoComplete="current-password" style={{border:"none",boxShadow:"none",padding:"15px 12px",background:"transparent",fontSize:14,flex:1}}/>
                </div>
              </div>

              <label style={{display:"flex",alignItems:"center",gap:9,cursor:"pointer",userSelect:"none",marginTop:-4}}>
                <div onClick={()=>setRemember(r=>!r)} style={{width:18,height:18,borderRadius:5,border:`2px solid ${remember?S.blue:S.border}`,background:remember?S.blue:"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .15s"}}>
                  {remember&&<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </div>
                <span style={{fontSize:13,color:S.muted,fontWeight:600}}>Beni hatırla</span>
              </label>

              {err&&<div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:12,padding:"12px 14px",fontSize:12.5,color:S.red,wordBreak:"break-word",whiteSpace:"pre-wrap",lineHeight:1.6}}>⚠ {err}</div>}

              <button className="btn btn-p" type="submit" disabled={busy} style={{width:"100%",padding:16,fontSize:15,borderRadius:12,marginTop:2}}>
                {busy?<><Spin/> Giriş yapılıyor…</>:"Giriş Yap ve Devam Et"}
              </button>
            </form>

            <div style={{marginTop:18,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <div style={{display:"inline-flex",alignItems:"center",gap:7,background:"#fff",borderRadius:999,padding:"6px 12px",border:`1px solid ${S.border}`}}>
                <span style={{width:7,height:7,borderRadius:"50%",background:S.green}}/>
                <span style={{fontSize:11,color:S.muted,fontWeight:700}}>Oracle Marketplace akışıyla uyumlu</span>
              </div>
              <div style={{fontSize:11,color:"#A3B3C5"}}>SnapPass v2.1 · Protel A.Ş.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── SEARCH ─────────────────────────────────────────────────────────────── */
// Oda numarasına göre sıralama: sayısal sıra, odası olmayanlar sonda; beraberindekiler kendi rezervasyonunun hemen altında kalır
function sortByRoom(list){
  const groups=[];
  (list||[]).forEach(g=>{ if(!g.isAccompany||!groups.length) groups.push([g]); else groups[groups.length-1].push(g); });
  const key=g=>{ const r=String(g[0].room||"").trim(); const n=parseInt(r,10); return { n:Number.isNaN(n)?Infinity:n, r }; };
  groups.sort((a,b)=>{ const ka=key(a), kb=key(b); return (ka.n-kb.n) || ka.r.localeCompare(kb.r,"tr",{numeric:true}); });
  return groups.flat();
}

// Profil özeti: belge formundaki alanlar; profilde olmayanlar "eksik" olarak işaretlenir (rezervasyon kartı ve profil arama sonuçlarında ortak)
function ProfileInfoLine({pd}){
  const miss=(icon,label)=><span style={{color:S.orangeDk,fontWeight:700}}><b>{icon}</b> {label}{t(": eksik")}</span>;
  // Kişisel alanlar (doğum tarihi/yeri, cinsiyet) yalnız uyruğu olan ve TR olmayan misafirde zorunlu → "eksik" yalnız orada gösterilir
  const natCode = pd.nationality ? toIso2(pd.nationality) : "";
  const personalMissing = !!natCode && natCode !== "TR";
  return(
    <div className="profile-info" style={{marginTop:6,padding:"8px 10px",background:"#F6F9FD",borderRadius:8,display:"flex",flexWrap:"wrap",gap:"6px 16px"}}>
      {pd.documentNumber?<span><b style={{color:S.muted}}>🪪</b> {idTypeLabel({v:pd.idType,l:pd.idType||"ID"})}: <b>{pd.documentNumber}</b></span>:miss("🪪",t("Belge no"))}
      {pd.birthDate?<span><b style={{color:S.muted}}>🎂</b> {fmtDateTR(pd.birthDate)}</span>:(personalMissing?miss("🎂",t("Doğum tarihi")):null)}
      {pd.birthPlace?<span><b style={{color:S.muted}}>📍</b> {pd.birthPlace}</span>:(personalMissing?miss("📍",t("Doğum yeri")):null)}
      {pd.nationality?<span><b style={{color:S.muted}}>🌍</b> {pd.nationality}</span>:miss("🌍",t("Uyruk"))}
      {pd.gender?<span><b style={{color:S.muted}}>⚥</b> {pd.gender==="M"?t("Erkek"):pd.gender==="F"?t("Kadın"):pd.gender}</span>:(personalMissing?miss("⚥",t("Cinsiyet")):null)}
    </div>
  );
}

// KBS (Kimlik Bildirim Sistemi): kullanıcının kendi KBS bilgileri. Parola sunucuda şifreli tutulur, geri gönderilmez.
// Authenticator kodu saklanmaz; KBS'ye bağlanırken her oturumda girilir.
function KbsSettings({session,kbsType}){
  const [form,setForm]=useState({username:"",tcNo:"",tssKod:"",password:""});
  const [hasPassword,setHasPassword]=useState(false);
  const [birthFromNat,setBirthFromNat]=useState(false);
  const [egmsec,setEgmsec]=useState("");          // yeni girilen EGMSEC gizli anahtarı (kayıtlı olan geri gösterilmez)
  const [hasEgmsec,setHasEgmsec]=useState(false);
  const [preview,setPreview]=useState(null);       // {code, remaining}: kayıtlı anahtardan üretilen şu anki kod
  const [pvErr,setPvErr]=useState("");
  // EGMSEC anahtarını KBS'nin kayıt sayfasından üretme (yeni kayıt / Kayıt Güncelle)
  const [regForm,setRegForm]=useState({firstName:"",lastName:"",update:false});
  const [regSt,setRegSt]=useState({state:"idle",step:"",message:""});
  const [regErr,setRegErr]=useState("");
  const [otp,setOtp]=useState(null); // görünen tek kullanımlık parola: {code, remaining}
  const [otpErr,setOtpErr]=useState("");
  const [regOnSave,setRegOnSave]=useState(false); // giriş formunda: kaydederken KBS'den kalıcı EGMSEC anahtarı üret
  const [state,setState]=useState("loading");
  const [msg,setMsg]=useState({kind:"",text:""});
  const [busy,setBusy]=useState(false);
  // KBS bilgileri otel başınadır; yalnız yetkili kullanıcı görür/değiştirir. Kullanıcı adı ve TC gizli gelir, "Düzenle" ile açılır.
  const [info,setInfo]=useState({canManage:false,configured:false,username:"",tcNo:"",updatedBy:"",updatedAt:null});
  const [editing,setEditing]=useState(false);
  const hdr={"Content-Type":"application/json","x-csrf":serverCsrf};
  const loadSettings=async(reveal)=>{
    const res=await fetch(`${PROXY}/api/kbs/settings${reveal?"?reveal=1":""}`,{cache:"no-store"});
    const d=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(d.error||t("KBS bilgileri alınamadı"));
    setInfo({canManage:!!d.canManage,configured:!!d.configured,username:d.username||"",tcNo:d.tcNo||"",tssKod:d.tssKod||"",updatedBy:d.updatedBy||"",updatedAt:d.updatedAt||null});
    setHasPassword(!!d.hasPassword); setBirthFromNat(!!d.birthFromNat); setHasEgmsec(!!d.hasEgmsec);
    return d;
  };
  useEffect(()=>{
    let live=true;
    loadSettings(false).then(()=>{ if(live) setState("ready"); }).catch(e=>{ if(live){ setMsg({kind:"err",text:e.message}); setState("ready"); } });
    return ()=>{ live=false; };
  },[]);
  const startEdit=async()=>{
    setMsg({kind:"",text:""});
    try{ const d=await loadSettings(true); setForm({username:d.username||"",tcNo:d.tcNo||"",tssKod:d.tssKod||"",password:""}); setEgmsec(""); setEditing(true); }
    catch(e){ setMsg({kind:"err",text:e.message}); }
  };
  const cancelEdit=async()=>{ setRegOnSave(false); setEditing(false); setForm({username:"",tcNo:"",tssKod:"",password:""}); setEgmsec(""); setPreview(null); try{ await loadSettings(false); }catch(_){} };
  const save=async()=>{
    setMsg({kind:"",text:""});
    if(regOnSave){
      if(egmsec.trim()){ setMsg({kind:"err",text:t("EGMSEC anahtarını elle girerken aynı anda KBS'den anahtar üretilemez; birini seçin.")}); return; }
      if(!regForm.firstName.trim()||!regForm.lastName.trim()){ setMsg({kind:"err",text:t("Ad ve soyad gerekli (KBS kullanıcısının adı ve soyadı).")}); return; }
    }
    setBusy(true);
    try{
      const res=await fetch(`${PROXY}/api/kbs/settings`,{method:"PUT",headers:hdr,body:JSON.stringify({...form,birthFromNat,egmsec})});
      const d=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(d.error||t("Kaydedilemedi"));
      setForm({username:"",tcNo:"",tssKod:"",password:""}); setEgmsec(""); setPreview(null); setEditing(false);
      await loadSettings(false);
      setMsg({kind:"ok",text:t("KBS bilgileri kaydedildi.")});
      // Kutu işaretliyse bilgiler saklandıktan sonra KBS'de yeni kayıt başlatılır (uyarı ve onay istenir)
      if(regOnSave){ setRegOnSave(false); await startReg(); }
      // "KBS'ye bağlan" bölümü kaydedince hemen görünür
      setTimeout(()=>{ const el=document.getElementById("kbs-conn"); if(el&&el.scrollIntoView) el.scrollIntoView({behavior:"smooth",block:"center"}); },150);
    }catch(e){ setMsg({kind:"err",text:e.message}); }
    setBusy(false);
  };
  // Kayıtlı anahtardan şimdi üretilen kod: kullanıcı EGMSEC uygulamasındaki kodla karşılaştırır
  const showPreview=async()=>{
    setPvErr(""); setPreview(null);
    try{
      const res=await fetch(`${PROXY}/api/kbs/egmsec-preview`,{cache:"no-store"});
      const d=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(d.error||t("Kod üretilemedi"));
      setPreview(d);
    }catch(e){ setPvErr(e.message); }
  };
  const clearEgmsec=async()=>{
    if(!await askConfirm(t("Kayıtlı EGMSEC anahtarı silinsin mi? Sonra kod her bağlanışta elle girilir."))) return;
    setBusy(true); setMsg({kind:"",text:""});
    try{
      const res=await fetch(`${PROXY}/api/kbs/settings`,{method:"PUT",headers:hdr,body:JSON.stringify({...form,birthFromNat,clearEgmsec:true})});
      const d=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(d.error||t("Silinemedi"));
      setHasEgmsec(false); setPreview(null);
      setMsg({kind:"ok",text:t("EGMSEC anahtarı silindi.")});
    }catch(e){ setMsg({kind:"err",text:e.message}); }
    setBusy(false);
  };
  // Tek kullanımlık parola (kayıtlı anahtardan): KBS'ye elle giriş yapacak yetkili için. Süre dolunca kendiliğinden yenilenir, 2 dk sonra gizlenir.
  const otpShownAt=useRef(0);
  const showOtp=async(first)=>{
    setOtpErr("");
    try{
      const res=await fetch(`${PROXY}/api/kbs/egmsec-preview${first?"?log=1":""}`,{cache:"no-store"});
      const d=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(d.error||t("Kod üretilemedi"));
      if(first) otpShownAt.current=Date.now();
      setOtp({code:d.code,remaining:d.remaining});
    }catch(e){ setOtpErr(e.message); setOtp(null); }
  };
  useEffect(()=>{
    if(!otp) return;
    const iv=setInterval(()=>{
      if(Date.now()-otpShownAt.current>120000){ setOtp(null); return; }
      setOtp(o=>{ if(!o) return o; if(o.remaining<=1){ showOtp(false); return o; } return {...o,remaining:o.remaining-1}; });
    },1000);
    return ()=>clearInterval(iv);
  },[!!otp]);
  const copyOtp=async()=>{ try{ await navigator.clipboard.writeText(otp.code); setMsg({kind:"ok",text:t("Kod kopyalandı.")}); }catch(_){ setMsg({kind:"err",text:t("Kopyalanamadı; kodu elle yazın.")}); } };
  const startReg=async()=>{
    setRegErr("");
    const f=regForm;
    if(!f.firstName.trim()||!f.lastName.trim()){ setRegErr(t("Ad ve soyad gerekli (KBS kullanıcısının adı ve soyadı).")); return; }
    const warn=f.update||hasEgmsec
      ? t("Kayıt Güncelle bu KBS hesabının MEVCUT EGMSEC anahtarını geçersiz kılar: telefondaki EGMSEC uygulaması ve bu hesabı kullanan başka programlar (ör. PMS'in KBS bildirimi) çalışmaz hale gelir. Devam edilsin mi?")
      : t("Bu hesap için KBS'den yeni EGMSEC kaydı yapılacak ve anahtar sunucuda şifreli saklanacak. Hesap daha önce kayıtlıysa KBS bunu reddeder. Açık KBS oturumu bu işlemle düşer. Devam edilsin mi?");
    if(!await askConfirm(warn)) return;
    try{
      const res=await fetch(`${PROXY}/api/kbs/egmsec-register`,{method:"POST",headers:hdr,body:JSON.stringify({firstName:f.firstName.trim(),lastName:f.lastName.trim(),update:!!f.update||hasEgmsec,confirm:true})});
      const d=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(d.error||t("Başlatılamadı"));
      setRegSt(d);
    }catch(e){ setRegErr(e.message); }
  };
  useEffect(()=>{
    if(regSt.state!=="running") return;
    let live=true;
    const iv=setInterval(async()=>{
      try{
        const r=await fetch(`${PROXY}/api/kbs/egmsec-register`,{cache:"no-store"});
        const d=r.ok?await r.json():null;
        if(!live||!d) return;
        setRegSt(d);
        if(d.state==="ok"){ setRegForm({firstName:"",lastName:"",update:false}); try{ await loadSettings(false); }catch(_){} setMsg({kind:"ok",text:t("EGMSEC anahtarı KBS'den oluşturuldu ve kaydedildi. Artık KBS'ye bağlanınca kod otomatik girilir.")}); }
      }catch(_){}
    },2000);
    return ()=>{ live=false; clearInterval(iv); };
  },[regSt.state]);
  // KBS oturumu: bağlan → EGMSEC kodu → bağlandı
  const [conn,setConn]=useState({state:"none",text:""});
  const [code,setCode]=useState("");
  const [cbusy,setCbusy]=useState(false);
  const [cerr,setCerr]=useState("");
  useEffect(()=>{
    fetch(`${PROXY}/api/kbs/status`,{cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>{ if(d) setConn(c=>({...c,state:d.state,by:d.by,since:d.since})); }).catch(()=>{});
  },[]);
  const callKbs=async(path,body)=>{
    setCbusy(true); setCerr("");
    try{
      const res=await fetch(`${PROXY}/api/kbs/${path}`,{method:"POST",headers:hdr,body:JSON.stringify(body||{})});
      const d=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(d.error||t("İşlem başarısız"));
      return d;
    }catch(e){ setCerr(e.message); return null; }
    finally{ setCbusy(false); }
  };
  const connect=async()=>{ const d=await callKbs("connect"); if(d){ setConn(d); setCode(""); setWait(0); } };
  const sendCode=async()=>{ const d=await callKbs("otp",{code}); if(d){ setConn(d); setCode(""); setWait(0); } };
  // KBS yavaş olabilir: bağlanma / doğrulama sunucuda arka planda sürer, ekran 2 sn'de bir durumu sorar
  const [wait,setWait]=useState(0);
  useEffect(()=>{
    if(conn.state!=="connecting"&&conn.state!=="verifying") return;
    let live=true;
    const iv=setInterval(async()=>{
      setWait(w=>w+2);
      try{
        const r=await fetch(`${PROXY}/api/kbs/status`,{cache:"no-store"});
        const d=r.ok?await r.json():null;
        if(live&&d&&d.state!==conn.state) setConn(d);
      }catch(_){}
    },2000);
    return ()=>{ live=false; clearInterval(iv); };
  },[conn.state]);
  const disconnect=async()=>{ const d=await callKbs("disconnect"); if(d) setConn({state:"none",text:""}); };
  const set=k=>e=>setForm(f=>({...f,[k]:e.target.value}));
  const tcOk=/^\d{11}$/.test(form.tcNo.replace(/\s/g,""));
  const isJ=kbsType==="jandarma";
  const canSave=!busy&&(isJ?String(form.tssKod||"").trim():form.username.trim())&&tcOk&&(form.password||hasPassword);
  // KBS tipi Protel yöneticisi tarafından otel ayarında belirlenir; burada yalnız gösterilir
  const typeCtl=(
    <div style={{fontSize:12,color:S.muted,marginBottom:14}}>{t("KBS tipi")}: <b style={{color:S.navy}}>{kbsType==="jandarma"?t("Jandarma (API)"):t("Polis (Emniyet)")}</b></div>
  );
  return(
    <div className="card" style={{padding:"18px 18px 16px"}}>
      <div style={{fontSize:11,fontWeight:800,color:S.muted,letterSpacing:".5px"}}>{t("KBS · KİMLİK BİLDİRİM SİSTEMİ")}</div>
      <div style={{marginTop:4,marginBottom:12,fontSize:15,fontWeight:800,color:S.navy}}>{t("KBS giriş bilgileri")}</div>
      {typeCtl}
      {state==="loading"?<div style={{padding:"16px 0"}}><Spin/></div>:(
        <div style={{display:"grid",gap:12}}>
          {info.canManage&&editing?(<>
          {!isJ&&<div><label className="lbl">{t("Kullanıcı adı")}</label><input className="inp" value={form.username} onChange={set("username")} autoComplete="off"/></div>}
          {isJ&&<div><label className="lbl">{t("Tesis kodu")}</label><input className="inp" value={form.tssKod} onChange={set("tssKod")} inputMode="numeric" maxLength={12} autoComplete="off"/></div>}
          <div><label className="lbl">{isJ?t("Kullanıcı TC kimlik no"):t("TC kimlik no")}</label><input className="inp" value={form.tcNo} onChange={set("tcNo")} inputMode="numeric" maxLength={11} autoComplete="off"/>
            {form.tcNo&&!tcOk&&<div style={{fontSize:12,color:S.red,marginTop:4}}>{t("TC kimlik no 11 haneli olmalı.")}</div>}</div>
          <div><label className="lbl">{t("Parola")}</label><input className="inp" type="password" value={form.password} onChange={set("password")} autoComplete="new-password" placeholder={hasPassword?t("Kayıtlı — değiştirmek için yeni parola yazın"):""}/></div>
          {!isJ&&<>
          <label style={{display:"flex",gap:10,alignItems:"flex-start",fontSize:13,color:S.text,lineHeight:1.5,cursor:"pointer"}}>
            <input type="checkbox" checked={birthFromNat} onChange={e=>setBirthFromNat(e.target.checked)} style={{width:20,height:20,marginTop:1,flexShrink:0}}/>
            <span>{t("Yabancı misafirde doğum yeri boşsa uyruğu (örn. US) doğum yeri olarak gönder")}<br/><span style={{fontSize:12,color:S.muted}}>{t("İşaretli değilse doğum yeri her yabancı misafir için zorunludur ve KBS listesinde ya da profilde doldurulmalıdır.")}</span></span>
          </label>
          <details open={!!egmsec||!!pvErr||!!preview} style={{border:`1px solid ${S.border}`,borderRadius:10,padding:"10px 14px"}}>
            <summary style={{cursor:"pointer",fontSize:13,fontWeight:800,color:S.navy}}>{t("Gelişmiş: mevcut EGMSEC anahtarını elle gir")}</summary>
            <div style={{marginTop:10}}>
            <label className="lbl">{t("EGMSEC gizli anahtarı (isteğe bağlı)")}</label>
            <input className="inp" type="password" value={egmsec} onChange={e=>setEgmsec(e.target.value)} autoComplete="off" placeholder={hasEgmsec?t("Kayıtlı — değiştirmek için yeni anahtar yazın"):t("Base32 anahtar ya da otpauth:// adresi")}/>
            <div style={{fontSize:12,color:S.muted,marginTop:4,lineHeight:1.5}}>{t("Kayıtlıysa kodu uygulama kendisi üretir, her bağlanışta kod girmeniz gerekmez. Anahtar sunucuda şifreli saklanır, ekrana geri gösterilmez.")}</div>
            {hasEgmsec&&(
              <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center",marginTop:8}}>
                <button type="button" className="btn" onClick={showPreview} style={{padding:"8px 14px",borderRadius:9,border:`1.5px solid ${S.border}`,background:"#fff",fontWeight:700}}>{t("Kodu önizle")}</button>
                {preview&&<span style={{fontSize:15,fontWeight:900,letterSpacing:"2px",color:S.navy}}>{preview.code} <span style={{fontSize:12,fontWeight:600,letterSpacing:0,color:S.muted}}>({preview.remaining} {t("sn")})</span></span>}
                <button type="button" className="btn" disabled={busy} onClick={clearEgmsec} style={{padding:"8px 14px",borderRadius:9,border:`1.5px solid ${S.border}`,background:"#fff",color:S.red,fontWeight:700}}>{t("Anahtarı sil")}</button>
              </div>
            )}
            {pvErr&&<div style={{fontSize:12,color:S.red,marginTop:6}}>{pvErr}</div>}
            {hasEgmsec&&<div style={{fontSize:12,color:S.muted,marginTop:6,lineHeight:1.5}}>{t("Önizlemede görünen kod, telefondaki EGMSEC uygulamasındaki kodla aynıysa anahtar doğrudur.")}</div>}
            </div>
          </details>
          <div style={{display:"grid",gap:10,padding:"12px 14px",borderRadius:10,background:regOnSave?"#FFF7ED":"#F6F9FD",border:`1px solid ${regOnSave?"#FED7AA":S.border}`}}>
            <label style={{display:"flex",gap:10,alignItems:"flex-start",fontSize:13,color:S.text,lineHeight:1.5,cursor:"pointer"}}>
              <input type="checkbox" checked={regOnSave} onChange={e=>{ setRegOnSave(e.target.checked); setRegErr(""); }} style={{width:20,height:20,marginTop:1,flexShrink:0}}/>
              <span><b>{hasEgmsec?t("Kalıcı EGMSEC anahtarını yeniden üret"):t("Kalıcı EGMSEC anahtarı üret (KBS'de yeni kayıt)")}</b><br/><span style={{fontSize:12,color:S.muted}}>{t("İşaretlenirse kaydedince KBS'nin kayıt sayfasından anahtar üretilir ve her bağlanışta kod otomatik girilir. İşaretlenmezse telefondaki EGMSEC ile giriş eskisi gibi sürer.")}</span></span>
            </label>
            {regOnSave&&(<>
              {hasEgmsec&&<div style={{fontSize:12,color:S.red,lineHeight:1.6,fontWeight:700}}>⚠ {t("Bu otelde anahtar zaten kayıtlı. Yeniden üretmek mevcut anahtarı geçersiz kılar (telefondaki EGMSEC ve bu hesabı kullanan başka programlar dahil).")}</div>}
              <div style={{fontSize:12,color:S.orangeDk,lineHeight:1.6}}>⚠ {t("Bu işlem canlı KBS'de çalışır. Hesabı başka bir program da kullanıyorsa önce o programda bu otelin KBS bildirimini durdurun. Ad ve soyad yalnızca KBS kayıt formu içindir, saklanmaz.")}</div>
              <div><label className="lbl">{t("KBS kullanıcısının adı")}</label><input className="inp" value={regForm.firstName} onChange={e=>setRegForm(f=>({...f,firstName:e.target.value}))} autoComplete="off"/></div>
              <div><label className="lbl">{t("KBS kullanıcısının soyadı")}</label><input className="inp" value={regForm.lastName} onChange={e=>setRegForm(f=>({...f,lastName:e.target.value}))} autoComplete="off"/></div>
              {!hasEgmsec&&<label style={{display:"flex",gap:10,alignItems:"flex-start",fontSize:13,color:S.text,lineHeight:1.5,cursor:"pointer"}}>
                <input type="checkbox" checked={regForm.update} onChange={e=>setRegForm(f=>({...f,update:e.target.checked}))} style={{width:20,height:20,marginTop:1,flexShrink:0}}/>
                <span>{t("Bu KBS kullanıcısı daha önce kayıt olmuş (Kayıt Güncelle)")}<br/><span style={{fontSize:12,color:S.red}}>{t("İşaretlenirse mevcut anahtar geçersiz olur (telefondaki EGMSEC dahil).")}</span></span>
              </label>}
            </>)}
          </div>
          </>}
          <div style={{fontSize:12,color:S.muted,lineHeight:1.5}}>{t("Parola sunucuda şifreli saklanır.")}</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <button className="btn btn-p" disabled={!canSave} onClick={save} style={{padding:"11px 22px",borderRadius:9}}>{busy?<Spin/>:t("Kaydet")}</button>
            <button className="btn" disabled={busy} onClick={cancelEdit} style={{padding:"11px 22px",borderRadius:9,border:`1.5px solid ${S.border}`,background:"#fff",fontWeight:700}}>{t("Vazgeç")}</button>
          </div>
          </>):info.canManage?(
            <div style={{display:"grid",gap:6,padding:"12px 14px",borderRadius:10,background:"#F6F9FD",border:`1px solid ${S.border}`}}>
              {info.configured?<>
                {!isJ&&<div style={{fontSize:13,color:S.text}}><span style={{color:S.muted}}>{t("Kullanıcı adı")}:</span> <b>{info.username}</b></div>}
                {isJ&&<div style={{fontSize:13,color:S.text}}><span style={{color:S.muted}}>{t("Tesis kodu")}:</span> <b>{info.tssKod}</b></div>}
                <div style={{fontSize:13,color:S.text}}><span style={{color:S.muted}}>{isJ?t("Kullanıcı TC kimlik no"):t("TC kimlik no")}:</span> <b>{info.tcNo}</b></div>
                <div style={{fontSize:13,color:S.text}}><span style={{color:S.muted}}>{t("Parola")}:</span> <b>{hasPassword?t("kayıtlı"):"—"}</b>{!isJ&&<> · <span style={{color:S.muted}}>EGMSEC:</span> <b>{hasEgmsec?t("kayıtlı"):t("yok")}</b></>}</div>
                {info.updatedBy&&<div style={{fontSize:12,color:S.muted}}>{t("Son değiştiren")}: {info.updatedBy}{info.updatedAt?` · ${fmtDateTR(String(info.updatedAt).slice(0,10))} ${hhmm(info.updatedAt)}`:""}</div>}
              </>:<div style={{fontSize:13,color:S.orangeDk,fontWeight:700}}>{t("Bu otelin KBS bilgileri henüz girilmedi.")}</div>}
              <div><button className="btn" onClick={startEdit} style={{marginTop:4,padding:"9px 16px",borderRadius:9,border:`1.5px solid ${S.border}`,background:"#fff",fontWeight:700,color:S.blue}}>✏️ {info.configured?t("Düzenle"):t("Bilgileri gir")}</button></div>
            </div>
          ):(
            <div style={{fontSize:13,color:info.configured?S.text:S.orangeDk,lineHeight:1.6,padding:"12px 14px",borderRadius:10,background:info.configured?"#F6F9FD":"#FFF7ED",border:`1px solid ${info.configured?S.border:"#FED7AA"}`}}>
              {info.configured?t("KBS giriş bilgileri otel için tanımlı. Bağlanmak için aşağıdaki düğmeyi kullanın; EGMSEC kodu istenirse telefonunuzdaki kodu girin."):t("Bu otelin KBS bilgileri henüz girilmedi.")}
            </div>
          )}
          {msg.text&&<div style={{fontSize:13,padding:"8px 10px",borderRadius:8,background:msg.kind==="ok"?"#E8F8EE":"#FEE2E2",color:msg.kind==="ok"?"#1E7B45":S.red}}>{msg.text}</div>}
          {info.canManage&&!isJ&&info.configured&&!editing&&(
            <div style={{marginTop:6,paddingTop:14,borderTop:`1px solid ${S.border}`,display:"grid",gap:10}}>
              <div style={{fontSize:13,fontWeight:800,color:S.navy}}>{t("EGMSEC anahtarı")}</div>
              <div style={{fontSize:13,color:S.text,lineHeight:1.6}}>{hasEgmsec?t("Bu otelde EGMSEC anahtarı kayıtlı; KBS'ye bağlanınca kod otomatik girilir. Anahtarı yeniden oluşturmak mevcut anahtarı geçersiz kılar."):t("Bu otelde EGMSEC anahtarı yok; her bağlanışta telefondaki kod girilir. Anahtarı KBS'nin kayıt sayfasından oluşturmak için bilgileri Düzenle ekranında 'Kalıcı EGMSEC anahtarı üret' kutusunu işaretleyin.")}</div>
              {hasEgmsec&&(
                <div style={{display:"grid",gap:8,padding:"12px 14px",borderRadius:10,background:"#F6F9FD",border:`1px solid ${S.border}`}}>
                  <div style={{fontSize:13,fontWeight:800,color:S.navy}}>{t("Tek kullanımlık parola")}</div>
                  {otp?(
                    <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                      <span style={{fontSize:28,fontWeight:900,letterSpacing:"3px",color:S.navy}}>{otp.code}</span>
                      <span style={{fontSize:12,color:otp.remaining<=8?S.red:S.muted}}>{otp.remaining} {t("sn")}</span>
                      <button type="button" className="btn" onClick={()=>showOtp(false)} style={{padding:"8px 14px",borderRadius:9,border:`1.5px solid ${S.border}`,background:"#fff",fontWeight:700}}>{t("Yenile")}</button>
                      <button type="button" className="btn" onClick={copyOtp} style={{padding:"8px 14px",borderRadius:9,border:`1.5px solid ${S.border}`,background:"#fff",fontWeight:700}}>{t("Kopyala")}</button>
                      <button type="button" className="btn" onClick={()=>setOtp(null)} style={{padding:"8px 14px",borderRadius:9,border:`1.5px solid ${S.border}`,background:"#fff",fontWeight:700}}>{t("Gizle")}</button>
                    </div>
                  ):(
                    <div><button type="button" className="btn" onClick={()=>showOtp(true)} style={{padding:"9px 16px",borderRadius:9,border:`1.5px solid ${S.border}`,background:"#fff",fontWeight:700,color:S.blue}}>{t("Kodu göster")}</button></div>
                  )}
                  <div style={{fontSize:12,color:S.muted,lineHeight:1.5}}>{t("KBS'ye siteden elle girmesi gereken yetkili için kayıtlı anahtardan üretilir; 30 saniyede bir yenilenir, 2 dakika sonra gizlenir. Gösterilmesi işlem kaydına yazılır.")}</div>
                  {otpErr&&<div style={{fontSize:12,color:S.red}}>{otpErr}</div>}
                </div>
              )}
              {regSt.state==="running"&&<div style={{fontSize:13,color:S.blue,fontWeight:800}}><Spin/> {regSt.step||t("KBS kaydı sürüyor…")} <span style={{fontWeight:500,color:S.muted}}>({t("KBS yavaş olabilir, bekleyin")})</span></div>}
              {regSt.state==="error"&&<div style={{fontSize:13,padding:"8px 10px",borderRadius:8,background:"#FEE2E2",color:S.red,lineHeight:1.5}}>{regSt.message}</div>}
              {regErr&&<div style={{fontSize:13,padding:"8px 10px",borderRadius:8,background:"#FEE2E2",color:S.red}}>{regErr}</div>}
                          </div>
          )}
          {info.configured&&!editing&&(
            <div id="kbs-conn" style={{marginTop:6,paddingTop:14,borderTop:`1px solid ${S.border}`,display:"grid",gap:10}}>
              <div style={{fontSize:13,fontWeight:800,color:S.navy}}>{t("KBS bağlantısı")}</div>
              <div style={{fontSize:13,color:S.text}}>
                {conn.state==="connecting"||conn.state==="verifying"?<span style={{color:S.blue,fontWeight:800}}><Spin/> {conn.state==="connecting"?t("KBS'ye bağlanılıyor… KBS yavaş yanıt verebilir, bekleyin."):t("Kod doğrulanıyor…")} {wait>0?`(${wait} ${t("sn")})`:""}</span>
                  :conn.state==="error"?<span style={{color:S.red,fontWeight:800}}>● {conn.error||t("Bağlanılamadı")}</span>
                  :conn.state==="ready"?<span style={{color:"#15803D",fontWeight:800}}>● {t("Bağlandı")}{conn.by?<span style={{fontWeight:500,color:S.muted}}> · {t("Bağlayan")}: {conn.by}{conn.since?` · ${t("Bağlantı saati")}: ${hhmm(conn.since)}`:""}</span>:null}</span>
                  :conn.state==="stopped"?<span style={{color:S.orangeDk,fontWeight:800}}>⏸ {t("Durduruldu")}<span style={{fontWeight:500,color:S.muted}}> · {t("KBS bağlantısı Protel yöneticisi tarafından durduruldu; yalnız Protel yöneticisi yeniden başlatabilir.")}</span></span>
                  :conn.state==="otp"?<span style={{color:S.orangeDk,fontWeight:800}}>● {t("EGMSEC kodu bekleniyor")}</span>
                  :conn.state==="unknown"?<span style={{color:S.orangeDk,fontWeight:800}}>● {t("Sonuç anlaşılamadı")}</span>
                  :<span style={{color:S.muted,fontWeight:700}}>○ {isJ?t("Doğrulanmadı"):t("Bağlı değil")}{isJ&&<span style={{fontWeight:500}}> · {t("Jandarma'da oturum yoktur; Bağlantıyı dene bilgileri doğrular")}</span>}</span>}
              </div>
              {conn.state==="otp"&&(
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  <input className="inp" style={{flex:"1 1 160px",maxWidth:240}} value={code} onChange={e=>setCode(e.target.value)} onKeyDown={e=>e.key==="Enter"&&code&&sendCode()} inputMode="numeric" autoComplete="one-time-code" placeholder={t("EGMSEC kodu")}/>
                  <button className="btn btn-p" disabled={cbusy||!code} onClick={sendCode} style={{padding:"11px 22px",borderRadius:9}}>{cbusy?<Spin/>:t("Doğrula")}</button>
                </div>
              )}
              {cerr&&<div style={{fontSize:13,padding:"8px 10px",borderRadius:8,background:"#FEE2E2",color:S.red}}>{cerr}</div>}
              {conn.error&&conn.state==="otp"&&<div style={{fontSize:13,padding:"8px 10px",borderRadius:8,background:"#FEE2E2",color:S.red}}>{conn.error}</div>}
              {conn.text&&conn.state!=="ready"&&conn.state!=="connecting"&&conn.state!=="verifying"&&<div style={{fontSize:12,color:S.muted,lineHeight:1.5}}>{t("KBS yanıtı")}: {conn.text}</div>}
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                {conn.state!=="ready"&&conn.state!=="otp"&&conn.state!=="connecting"&&conn.state!=="verifying"&&conn.state!=="stopped"&&<button className="btn btn-p" disabled={cbusy} onClick={connect} style={{padding:"11px 22px",borderRadius:9}}>{cbusy?<Spin/>:isJ?t("Bağlantıyı dene"):t("KBS'ye bağlan")}</button>}
                {conn.state==="otp"&&<button className="btn" disabled={cbusy} onClick={connect} style={{padding:"11px 22px",borderRadius:9,border:`1.5px solid ${S.border}`,background:"#fff",fontWeight:700}}>{t("Baştan başla")}</button>}
                {!isJ&&(conn.state==="ready"||conn.state==="unknown")&&<button className="btn" disabled={cbusy} onClick={disconnect} style={{padding:"11px 22px",borderRadius:9,border:`1.5px solid ${S.border}`,background:"#fff",fontWeight:700}}>{t("Bağlantıyı kes")}</button>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// KBS gönderim: oteldeki tüm konaklayanlar (InHouse) listelenir, her biri bilgi eksikliğine göre sınıflanır.
// Durumlar: bekleyen (bilgileri tam, gönderilmedi) · gönderildi · hata (gönderim hatası) · eksik bilgi · toplam = konaklayan sayısı.
const KBS_STATUS=[
  {k:"pending",label:"Bekleyen",color:"#B7791F",bg:"#FFFBEB",bd:"#FDE68A",icon:"🕒"},
  {k:"sent",label:"KBS'de kayıtlı",color:"#15803D",bg:"#F0FDF4",bd:"#BBF7D0",icon:"✓"},
  {k:"error",label:"Hata",color:"#DC2626",bg:"#FEF2F2",bd:"#FECACA",icon:"!"},
  {k:"missing",label:"Eksik bilgi",color:"#C2410C",bg:"#FFF7ED",bd:"#FED7AA",icon:"⚠"},
  {k:"all",label:"Toplam",color:"#2563EB",bg:"#EFF6FF",bd:"#BFDBFE",icon:"➤"},
];
// Misafirin KBS için eksik alanları (uyruk yoksa yalnız uyruk; T.C. ise 11 haneli kimlik no; yabancıda pasaport no, doğum tarihi, doğum yeri, cinsiyet)
function kbsMissing(pd,birthFromNat,noBirthPlace){
  if(!pd) return ["Profil bilgisi"];
  if(pd.fromKbs) return []; // KBS'de ad+oda ile zaten kayıtlı: profil okunmadı, gönderilmeyeceği için eksik aranmaz
  const nat=pd.nationality?toIso2(pd.nationality):"";
  if(!nat) return ["Uyruk"];
  const miss=[];
  // KBS ülke tablosunda karşılığı olmayan uyruk (ör. Åland) gönderilemez
  if(window.KbsCountries&&!window.KbsCountries.idOf(nat)) miss.push("Uyruk kodu (KBS)");
  // T.C. uyruklu: yalnız 11 haneli T.C. kimlik no yeterli
  if(nat==="TR"){ if(!isValidTckn(pd.documentNumber)) miss.push("Kimlik no (11 hane)"); return miss; }
  if(!pd.documentNumber) miss.push("Pasaport no");
  if(!pd.birthDate) miss.push("Doğum tarihi");
  if(!pd.birthPlace&&!birthFromNat&&!noBirthPlace) miss.push("Doğum yeri"); // Jandarma servisi doğum yeri istemez // "uyruğu doğum yeri say" açıksa zorunlu değil
  if(!pd.gender) miss.push("Cinsiyet");
  return miss;
}

// Yatay kaydırılan geniş tablo kutusu: sığmayan yönde ‹ › okları çıkar (dokunmatikte de kolay)
function HScroll({children,className,style}){
  const ref=useRef(null);
  const [st,setSt]=useState({l:false,r:false});
  const upd=()=>{
    const e=ref.current; if(!e) return;
    const l=e.scrollLeft>4, r=e.scrollLeft+e.clientWidth<e.scrollWidth-4;
    setSt(p=>(p.l===l&&p.r===r)?p:{l,r});
  };
  useEffect(()=>{
    upd();
    const e=ref.current; if(!e) return;
    const ro=typeof ResizeObserver!=="undefined"?new ResizeObserver(upd):null;
    if(ro){ ro.observe(e); if(e.firstElementChild) ro.observe(e.firstElementChild); }
    window.addEventListener("resize",upd);
    return ()=>{ if(ro) ro.disconnect(); window.removeEventListener("resize",upd); };
  },[]);
  const go=d=>{ const e=ref.current; if(e) e.scrollBy({left:d*Math.max(240,e.clientWidth*0.6),behavior:"smooth"}); };
  const arrow=(side,on)=>on&&(
    <button type="button" aria-label={side==="left"?t("Sola kaydır"):t("Sağa kaydır")} onClick={()=>go(side==="left"?-1:1)}
      style={{position:"absolute",top:4,[side]:4,zIndex:5,width:44,height:44,borderRadius:"50%",border:`1.5px solid ${S.border}`,background:"rgba(255,255,255,.96)",boxShadow:"0 2px 8px rgba(0,0,0,.18)",fontSize:22,lineHeight:1,cursor:"pointer",color:S.blue,fontWeight:900}}>{side==="left"?"‹":"›"}</button>
  );
  return(
    <div style={{position:"relative"}}>
      {arrow("left",st.l)}{arrow("right",st.r)}
      <div ref={ref} className={className} style={style} onScroll={upd}>{children}</div>
    </div>
  );
}

// KBS ortak yardımcılar (kayıt tutma); KBS'ye bir şey göndermez
function r_room(g){ return String((g&&g.room)||"").trim(); }
function kbsRowInfo(r){
  const p=r.pd||{};
  const nat=p.nationality?toIso2(p.nationality):"";
  const isTR=nat==="TR";
  const doc=String(p.documentNumber||"").replace(/\s/g,"");
  return {p,nat,isTR,doc};
}
function kbsNames(r){
  const p=r.pd||{};
  return {first:[p.firstName||r.g.firstName,p.middleName].filter(Boolean).join(" "),last:p.lastName||r.g.lastName};
}
// Kayıttan (kbs_submissions) gelen "OPERA'da artık yok" misafirini yardımcıların beklediği satır biçimine çevirir
function kbsLeavingRow(x){
  const parts=String(x.fullName||"").trim().split(/\s+/);
  const first=x.firstName||parts.slice(0,-1).join(" ")||parts[0]||"";
  const last=x.lastName||(parts.length>1?parts[parts.length-1]:"");
  return {g:{guestId:x.profileId,firstName:first,lastName:last,room:x.room},pd:{nationality:x.idNo?"TR":"ZZ",documentNumber:x.idNo||x.passportNo,firstName:first,lastName:last},leaving:true,active:x};
}
// Kayıt tutma: KBS'de kayıtlı olduğu bilinen misafirler (oda ve saatiyle) kbs_submissions'a yazılır
async function kbsMark(action,list){
  const items=list.map(r=>{
    const {isTR,doc}=kbsRowInfo(r);
    const {first,last}=kbsNames(r);
    return {profileId:r.g.guestId,fullName:`${first} ${last}`.trim(),firstName:first,lastName:last,idNo:isTR?doc:"",passportNo:isTR?"":doc,room:r.g.room||"",kbsId:r.kbsId||""};
  });
  const res=await fetch(`${PROXY}/api/kbs/mark`,{method:"POST",headers:{"Content-Type":"application/json","x-csrf":serverCsrf},body:JSON.stringify({action,items})});
  if(!res.ok){ const d=await res.json().catch(()=>({})); throw new Error(d.error||t("Kaydedilemedi")); }
}

// KBS'ye doğrudan gönderim için satırdan istek verisi (sunucu KBS'nin kendi API'sine çevirir)
function kbsPayload(r,bfn,oldRoom){
  const {p,nat,isTR,doc}=kbsRowInfo(r);
  const {first,last}=kbsNames(r);
  return {
    profileId:r.g.guestId,kind:isTR?"tr":"foreign",idNo:isTR?doc:"",docNo:isTR?"":doc,firstName:first,lastName:last,
    countryId:isTR?1:(window.KbsCountries?window.KbsCountries.idOf(nat):""),nationality:nat,gender:p.gender||"",
    birthDate:p.birthDate?String(p.birthDate).slice(0,10):"",birthPlace:p.birthPlace||(bfn?nat:""),
    room:r.g.room||"",oldRoom:oldRoom||"",kbsId:r.kbsId||"",
  };
}
const hhmm=v=>{ const d=new Date(v); return isNaN(d)?"":String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); };
// KBS kimlik/ad alanlarını maskeli döndürür ("ES**", "15******850"): görünen baş ve son kısım tutuyorsa eşleşir
// OPERA'da adlar çoğu zaman Türkçe harfsiz (BICER), KBS'de Türkçe harfli (BİÇER): karşılaştırmada harfler sadeleştirilir
const KBS_FOLD={"İ":"I","I":"I","Ş":"S","Ğ":"G","Ü":"U","Ö":"O","Ç":"C","Â":"A","Î":"I","Û":"U"};
const kbsNorm=s=>String(s??"").toLocaleUpperCase("tr-TR").replace(/[İŞĞÜÖÇÂÎÛ]/g,c=>KBS_FOLD[c]).replace(/\s+/g," ").trim();
function kbsMaskMatch(masked,full){
  const m=String(masked??""), f=kbsNorm(full);
  if(!m||!f) return true;
  if(!m.includes("*")) return kbsNorm(m)===f;
  const pre=kbsNorm(m.slice(0,m.indexOf("*"))), suf=kbsNorm(m.slice(m.lastIndexOf("*")+1));
  return f.startsWith(pre)&&(!suf||f.endsWith(suf));
}
// KBS kaydı (x) bu OPERA misafiriyle (g, profil pd) aynı kişi mi: ad, soyad ve (biliniyorsa) belge no
function kbsSamePerson(x,g,pd){
  const doc=String(pd?.documentNumber||"").replace(/\s/g,"");
  const kdoc=String(x.idNo||x.docNo||"").replace(/\s/g,"");
  // KBS kimlik/belge no maskesiz (tam) geliyorsa (ör. Jandarma) ve OPERA'dakiyle birebir aynıysa kişi aynıdır: ad farkı (ikinci ad, soyadı değişikliği) bakılmaz
  if(doc&&kdoc&&!kdoc.includes("*")&&kbsNorm(kdoc)===kbsNorm(doc)) return true;
  // OPERA'da ikinci ad ayrı alandadır: KBS'deki ad "JULIE ANN" ise OPERA "JULIE" + ikinci ad "ANN" ile de eşleşir
  const first=[g.firstName,[g.firstName,pd?.middleName].filter(Boolean).join(" ")];
  return first.some(f=>kbsMaskMatch(x.firstName,f))&&kbsMaskMatch(x.lastName,g.lastName)&&(!doc||kbsMaskMatch(x.idNo||x.docNo,doc));
}
// OPERA profilini okumadan önce: KBS'de AYNI ODADA ve aynı ad+soyadla zaten kayıtlı olan misafirler (profil okuması gereksiz).
// Ad farklıysa (ikinci ad, soyadı değişikliği vb.) eşleşmez ve profil okunur; böylece asıl eşleştirme eskisi gibi çalışır. KBS listesi yoksa boş döner (herkesin profili okunur).
function kbsPreMatch(act,list){
  const map=new Map();
  if(!act||!act.connected||act.error||!Array.isArray(act.items)||!act.items.length) return map;
  const used=new Set();
  for(const g of list){
    if(!g.guestId||String(g.guestId).startsWith("#")||!g.room) continue;
    const x=act.items.find(x=>!used.has(x.id)&&String(x.room)===String(g.room)&&kbsMaskMatch(x.firstName,g.firstName)&&kbsMaskMatch(x.lastName,g.lastName));
    if(x){ used.add(x.id); map.set(g.guestId,x); }
  }
  return map;
}
// Profili okunmayan (KBS'den eşleşen) misafir için yer tutucu ayrıntı
function kbsDetailFrom(x){
  const doc=String(x.idNo||x.docNo||"");
  return {fromKbs:true,identId:null,idType:"",documentNumber:doc.includes("*")?"":doc,issuingCountry:"",issuedDate:"",expiryDate:"",issuedPlace:"",birthDate:"",birthPlace:"",nationality:x.idNo?"TR":"",gender:"",firstName:x.firstName||"",middleName:"",lastName:x.lastName||""};
}
async function kbsSend(action,items,auto){
  const res=await fetch(`${PROXY}/api/kbs/send`,{method:"POST",headers:{"Content-Type":"application/json","x-csrf":serverCsrf},body:JSON.stringify({action,items,auto:!!auto})});
  const d=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(d.error||t("Gönderilemedi"));
  return d.results||[];
}

// Pencereler body'ye çizilir: .fadeUp gibi transform'lu bir üst öğe "fixed" konumu kendi akışına bağlar ve pencere ekran dışında kalır
function Portal({children}){ return ReactDOM.createPortal(children,document.body); }

// Onay penceresi: window.confirm bazı gömülü tarayıcılarda (uygulama içi görünüm, WebView) engellenir ve hep "hayır" döner
function askConfirm(message){
  return new Promise(resolve=>{
    const host=document.createElement("div"); document.body.appendChild(host);
    const root=ReactDOM.createRoot(host);
    const done=v=>{ root.unmount(); host.remove(); resolve(v); };
    root.render(
      <div role="dialog" aria-modal="true" style={{position:"fixed",inset:0,zIndex:5000,background:"rgba(10,25,45,.55)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>{ if(e.target===e.currentTarget) done(false); }}>
        <div style={{background:"#fff",borderRadius:14,padding:"18px 18px 14px",maxWidth:420,width:"100%"}}>
          <div style={{fontSize:15,color:S.navy,lineHeight:1.6,marginBottom:14,whiteSpace:"pre-line"}}>{message}</div>
          <div style={{display:"flex",gap:10,justifyContent:"flex-end",flexWrap:"wrap"}}>
            <button className="btn" onClick={()=>done(false)} style={{padding:"10px 16px",minHeight:44,borderRadius:9,border:`1.5px solid ${S.border}`,background:"#fff",fontWeight:700}}>{t("Vazgeç")}</button>
            <button className="btn btn-p" autoFocus onClick={()=>done(true)} style={{padding:"10px 16px",minHeight:44,borderRadius:9}}>{t("Evet")}</button>
          </div>
        </div>
      </div>
    );
  });
}

// KBS listesinden eksik bilgileri hızlıca düzeltir ve OPERA profiline geri yazar (kimlik okumadaki "Düzenle" ile aynı uçlar).
function KbsQuickEdit({g,pd,session,birthFromNat,noBirthPlace,onClose,onSaved,onChanged}){
  const p=pd||{};
  const [f,setF]=useState({
    nationality:p.nationality?toIso2(p.nationality):"",
    documentType:p.idType||"",
    documentNumber:p.documentNumber||"",
    dateOfBirth:p.birthDate?String(p.birthDate).slice(0,10):"",
    birthPlace:p.birthPlace||"",
    gender:p.gender||"",
  });
  const [dateBad,setDateBad]=useState(false);
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const set=k=>v=>setF(prev=>({...prev,[k]:v}));
  const setNat=v=>setF(prev=>applyNationalityRules(prev,v,""));
  const isTR=f.nationality==="TR";
  const natOpts=window.IsoCountries?window.IsoCountries.options(f.nationality,CUR_LANG):null;
  const [dupM,setDupM]=useState(null); // aynı kimlik/belge numarası başka profilde kayıtlıysa eşleşen profiller (öneri penceresi)
  const save=async(skipDup=false)=>{
    if(!f.nationality){ setErr(t("Uyruk seçin")); return; }
    const num=String(f.documentNumber||"").replace(/\s/g,"");
    if(isTR){
      if(!/^\d{11}$/.test(num)){ setErr(t("TC kimlik no 11 haneli olmalı.")); return; }
      if(!isValidTckn(num)){ setErr(t("TC kimlik no geçersiz (T.C. kimlik no doğrulama kuralına uymuyor).")); return; }
    }else{
      if(!num){ setErr(t("Belge numarası zorunlu")); return; }
      if(dateBad||!f.dateOfBirth){ setErr(t("Geçerli bir doğum tarihi girin (GG.AA.YYYY)")); return; }
      if(!f.gender){ setErr(t("Cinsiyet seçin")); return; }
      if(!birthFromNat&&!noBirthPlace&&!String(f.birthPlace||"").trim()){ setErr(t("Doğum yeri zorunlu")); return; }
    }
    setBusy(true); setErr("");
    try{
      const base={hostName:session.hostName,hotelId:session.hotelId,appKey:session.appKey,token:session.token,profileId:g.guestId};
      const idChanged=num!==String(p.documentNumber||"").replace(/\s/g,"");
      if(idChanged&&!skipDup){
        const dup=await findDuplicates({...base,excludeProfileId:g.guestId,criteria:{identificationNo:num}});
        // eşleşen profiller gösterilir (hangi profil olduğu, doğum tarihi, uyruk, belge no, eşleşme nedeni); kayıt ancak onayla sürer
        if(dup.length){ setBusy(false); setDupM({matches:dup}); return; }
      }
      const docData={
        firstName:p.firstName||g.firstName,middleName:p.middleName||"",lastName:p.lastName||g.lastName,
        dateOfBirth:f.dateOfBirth,birthPlace:String(f.birthPlace||"").trim(),gender:f.gender,nationality:f.nationality,
        documentType:isTR?"TCKN":(f.documentType&&f.documentType!=="TCKN"?f.documentType:"PASSPORT"),
        documentNumber:num,issuingCountry:p.issuingCountry||f.nationality,
        issuedDate:p.issuedDate||"",expiryDate:p.expiryDate||"",issuedPlace:p.issuedPlace||"",
      };
      const d10=v=>String(v||"").slice(0,10);
      const changed=changedKeys(
        {nationality:p.nationality?toIso2(p.nationality):"",documentType:p.idType||"",documentNumber:String(p.documentNumber||"").replace(/\s/g,""),dateOfBirth:d10(p.birthDate),birthPlace:p.birthPlace||"",gender:p.gender||""},
        {...f,documentNumber:num,dateOfBirth:d10(f.dateOfBirth)},
        ["nationality","documentType","documentNumber","dateOfBirth","birthPlace","gender"]);
      await putProfile({...base,docData,changed});
      if(idChanged||!p.documentNumber||(isTR&&p.idType!=="TCKN")||(!isTR&&p.idType==="TCKN")){
        await putIdentification({...base,identId:p.identId||null,docData});
      }
      const det=await getProfileDetails({...base,firstName:g.firstName,lastName:g.lastName});
      onSaved(g.guestId,det);
    }catch(e){ setErr(e.message); setBusy(false); }
  };
  return(
    <Portal><div role="dialog" aria-modal="true" style={{position:"fixed",inset:0,zIndex:3500,background:"rgba(10,25,45,.55)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff",borderRadius:14,padding:"18px 18px 14px",maxWidth:460,width:"100%",maxHeight:"90dvh",overflowY:"auto"}}>
        {dupM&&<Portal>
          <style>{GS}</style><style>{`.dup-overlay{z-index:4500!important}`}</style>
          <DuplicateDialog matches={dupM.matches} rule={t("Başka bir OPERA misafir profilinde (bu profil hariç) aynı kimlik / pasaport numarası kayıtlıysa listelenir. Boşluk ve harf büyüklüğü fark etmez; en alakalı 5 profil gösterilir.")}
            title={t("Bu kimlik numarası başka bir profilde kayıtlı")}
            note={t("Girdiğiniz kimlik / belge numarası sistemde aşağıdaki profilde zaten var. Rezervasyondaki profili değiştirmeden, yine de bu profile kaydetmek mi istiyorsunuz? Aynı kişiyse OPERA'da profilleri birleştirmeniz gerekebilir.")}
            canUse={false} forceLabel={t("Yine de bu profile kaydet")}
            ctx={{session,profileId:g.guestId,name:`${g.firstName} ${g.lastName}`.trim(),reservationId:g.reservationId,isAccompany:!!g.isAccompany,onChanged:()=>{setDupM(null);onChanged&&onChanged();}}}
            onForce={()=>{setDupM(null);save(true);}} onCancel={()=>setDupM(null)}/>
        </Portal>}
        <div style={{fontSize:16,fontWeight:800,color:S.navy}}>{g.firstName} {g.lastName}</div>
        <div style={{fontSize:12,color:S.muted,marginBottom:12,fontFamily:"monospace"}}>#{g.guestId}{g.room?` · ${t("Oda No")} ${g.room}`:""}</div>
        <div style={{display:"grid",gap:12}}>
          <Fld label={t("Uyruk")} value={f.nationality} onChange={setNat} required opts={natOpts}/>
          <Fld label={isTR?t("TC kimlik no"):t("Pasaport no")} value={f.documentNumber} onChange={set("documentNumber")} required/>
          {!isTR&&f.nationality&&<>
            <DateInput label={t("Doğum Tarihi")} value={f.dateOfBirth} onChange={set("dateOfBirth")} required onInvalid={setDateBad}/>
            <Fld label={t("Cinsiyet")} value={f.gender} onChange={set("gender")} required opts={[{v:"",l:"—"},{v:"M",l:t("Erkek")},{v:"F",l:t("Kadın")}]}/>
            {!noBirthPlace&&<Fld label={t("Doğum yeri")} value={f.birthPlace} onChange={set("birthPlace")} required={!birthFromNat}/>}
            {!noBirthPlace&&birthFromNat&&<div style={{fontSize:12,color:S.muted,marginTop:-6}}>{t("Boş bırakılırsa KBS'ye uyruk (örn. US) doğum yeri olarak gönderilir.")}</div>}
          </>}
        </div>
        {err&&<div style={{fontSize:13,padding:"8px 10px",borderRadius:8,background:"#FEE2E2",color:S.red,marginTop:12,whiteSpace:"pre-wrap"}}>{err}</div>}
        <div style={{fontSize:12,color:S.muted,marginTop:12}}>{t("Kaydedince bilgiler OPERA profiline yazılır.")}</div>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end",flexWrap:"wrap",marginTop:12}}>
          <button className="btn" disabled={busy} onClick={onClose} style={{padding:"10px 16px",borderRadius:9,border:`1.5px solid ${S.border}`,background:"#fff",fontWeight:700}}>{t("Vazgeç")}</button>
          <button className="btn btn-p" disabled={busy} onClick={()=>save()} style={{padding:"10px 16px",borderRadius:9}}>{busy?<Spin/>:t("Kaydet")}</button>
        </div>
      </div>
    </div></Portal>
  );
}

// Otel başına son yüklenen KBS Gönderim verisi: sekmeden çıkıp girince yeniden çekilmez; yalnız Yenile, gönderim ve (açıksa) otomatik yenileme günceller
const kbsViewCache={};
function KbsSend({session,kbsType}){
  const isJandarma=kbsType==="jandarma";
  const ck=(session&&session.hotelId)||"";
  const cached=kbsViewCache[ck]||null;
  const [guests,setGuests]=useState(cached?cached.guests:null);
  const [details,setDetails]=useState(cached?cached.details:{}); // profileId -> detay | null (okunamadı)
  const [err,setErr]=useState("");
  const [filter,setFilter]=useState("all");
  const [q,setQ]=useState("");
  const [loaded,setLoaded]=useState(0);
  const [subs,setSubs]=useState(cached?cached.subs:[]); // KBS gönderim kayıtları (en yeni önce)
  const [sel,setSel]=useState({}); // seçili bekleyen misafirler (profil id -> true)
  const [confirm,setConfirm]=useState(null); // onay penceresi: gönderilecek satırlar
  const [bfn,setBfn]=useState(cached?cached.bfn:false); // yabancıda doğum yeri boşsa uyruk (US gibi) doğum yeri olarak gönderilir
  const [editing,setEditing]=useState(null); // hızlı düzenleme: {g,pd}
  const [rcErr,setRcErr]=useState("");
  const [sendBusy,setSendBusy]=useState(false);
  const [sendRes,setSendRes]=useState(null); // son gönderim sonucu: {label, ok, bad:[{profileId,message}]}
  const [dateFilter,setDateFilter]=useState("all"); // all: hepsi · arr: bugün giriş yapanlar · dep: bugün çıkacaklar
  const [kbsAct,setKbsAct]=useState(cached?cached.kbsAct:null); // KBS'deki aktif konaklayanlar: {connected, items, error}
  const [notSame,setNotSame]=useState({});
  const autoSend=!!(session&&session.kbsAuto); // yönetim panelindeki "KBS otomatik gönderim" (varsayılan kapalı)
  const [autoPaused,setAutoPaused]=useState(""); // duraklatma nedeni (boş: çalışıyor)
  const autoRef=useRef({busy:false,tried:{}}); // tried: aynı kaydı 15 dk içinde yeniden denememek için
  const [bizDate,setBizDate]=useState(cached?cached.bizDate:null); // OPERA iş günü (YYYY-MM-DD)
  const loadBizDate=async()=>{ try{ const r=await fetch(`${PROXY}/api/opera/business-date`,{cache:"no-store"}); if(r.ok){ const d=await r.json(); if(d.date) setBizDate(d.date); } }catch(_){} }; // "farklı kişi" denen öneriler (profil|KBS kimliği), bu ekranda tekrar önerilmez
  const loadActive=async(fresh)=>{
    try{ const r=await fetch(`${PROXY}/api/kbs/active${fresh?"?fresh=1":""}`,{cache:"no-store"}); if(r.ok){ const d=await r.json(); setKbsAct(d); return d; } }catch(_){}
    return null;
  };
  const KBS_WAIT_MS=20000; // KBS listesi bu sürede gelmezse profiller eskisi gibi hepsi okunur
  const waitKbs=p=>Promise.race([p,new Promise(res=>setTimeout(()=>res(null),KBS_WAIT_MS))]);
  const isDay=(v,day)=>String(v||"").slice(0,10)===day;
  // action: checkin | room | checkout; list: satırlar. Sonuç özetlenir, liste yenilenir.
  // auto=true: otomatik gönderim turu (sunucu yalnız otel ayarı açıksa kabul eder). Hata olursa otomatik gönderim durur; sonrasında tam yükleme yerine hafif tazeleme yapılır.
  const doSend=async(action,list,label,auto=false)=>{
    setSendBusy(true); setRcErr(""); setSendRes(null);
    try{
      const items=list.map(r=>kbsPayload(r,bfn,action==="checkin"?"":(r.active?.room||r.g.room)));
      const results=await kbsSend(action,items,auto);
      const bad=results.filter(x=>!x.ok).map(x=>({...x,name:(()=>{ const r=list.find(y=>String(y.g.guestId)===String(x.profileId)); return r?`${r.g.firstName} ${r.g.lastName}`:x.profileId; })()}));
      setSendRes({label,ok:results.length-bad.length,bad});
      setSel({});
      if(auto&&bad.length) setAutoPaused(t("Otomatik gönderim, bir kayıt hata verdiği için duraklatıldı. Hatayı inceleyin; sonra Yenile'ye basınca devam eder."));
    }catch(e){ setRcErr(e.message); if(auto) setAutoPaused(t("Otomatik gönderim, hata nedeniyle duraklatıldı: ")+e.message); }
    finally{ setConfirm(null); setSendBusy(false); if(auto) await refreshAfterAuto(); else await load(); }
  };
  // Otomatik turdan sonra: yalnız gönderim kayıtları ve KBS listesi tazelenir (OPERA listesi ve profiller yeniden okunmaz)
  const refreshAfterAuto=async()=>{
    try{ const rs=await fetch(`${PROXY}/api/kbs/submissions`,{cache:"no-store"}); if(rs.ok){ const d=await rs.json(); setSubs(d.items||[]); } }catch(_){}
    await loadActive(true); setUpdatedAt(new Date());
  };
  // KBS'de oda güncelleme süresi (3 saat) geçtiyse: önce eski odadan çıkış, sonra yeni odayla yeniden giriş
  const doRelocate=async(r)=>{
    setSendBusy(true); setRcErr(""); setSendRes(null);
    try{
      const out=await kbsSend("checkout",[kbsPayload(r,bfn,r.active.room)]);
      if(!out[0]?.ok){ setSendRes({label:t("Oda değişimi"),ok:0,bad:[{name:`${r.g.firstName} ${r.g.lastName}`,message:out[0]?.message||""}]}); return; }
      const inn=await kbsSend("checkin",[kbsPayload(r,bfn,"")]);
      setSendRes({label:t("Oda değişimi"),ok:inn[0]?.ok?1:0,bad:inn[0]?.ok?[]:[{name:`${r.g.firstName} ${r.g.lastName}`,message:t("Çıkış yapıldı, yeniden giriş yapılamadı:")+" "+(inn[0]?.message||"")}]});
    }catch(e){ setRcErr(e.message); }
    finally{ setSendBusy(false); await load(); }
  };
  const load=async()=>{
    setAutoPaused(""); // elle Yenile otomatik gönderimi yeniden başlatır
    setErr(""); setGuests(null); setDetails({}); setLoaded(0);
    try{
      try{
        const rs=await fetch(`${PROXY}/api/kbs/submissions`,{cache:"no-store"});
        if(rs.ok){ const d=await rs.json(); setSubs(d.items||[]); }
      }catch(_){}
      try{
        const st=await fetch(`${PROXY}/api/kbs/settings`,{cache:"no-store"});
        if(st.ok){ const d=await st.json(); setBfn(!!d.birthFromNat); }
      }catch(_){}
      loadBizDate();
      // Önce KBS listesi (aynı anda OPERA araması başlar); KBS'de ad+oda ile kayıtlı olanların profili okunmaz
      const actP=waitKbs(loadActive(true));
      const found=await operaSearch({...session,byType:"lastName",query:"%",tab:"inhouse",all:true});
      const list=sortByRoom(found);
      const skip=kbsPreMatch(await actP,list);
      if(skip.size) setDetails(d=>{ const n={...d}; skip.forEach((x,id)=>{ n[id]=kbsDetailFrom(x); }); return n; });
      setGuests(list);
      const todo=list.filter(g=>!skip.has(g.guestId));
      let i=0, done=skip.size;
      const worker=async()=>{
        while(i<todo.length){
          const g=todo[i++];
          let det=null;
          if(g.guestId&&!String(g.guestId).startsWith("#")){
            det=await getProfileDetails({hostName:session.hostName,hotelId:session.hotelId,appKey:session.appKey,token:session.token,profileId:g.guestId,firstName:g.firstName,lastName:g.lastName});
          }
          setDetails(d=>({...d,[g.guestId]:det}));
          setLoaded(++done);
        }
      };
      await Promise.all(Array.from({length:5},worker));
      setUpdatedAt(new Date());
    }catch(e){ setErr(e.message); setGuests([]); }
  };
  useEffect(()=>{ if(!cached) load(); },[]);
  const [updatedAt,setUpdatedAt]=useState(cached?cached.updatedAt:null);
  // Otomatik yenileme: açıkken ekran görünürken autoMs'de bir; kapalıysa yalnız Yenile düğmesi. Tercih bu tarayıcıda hatırlanır.
  const [autoOn,setAutoOn]=useState(()=>{ try{ return localStorage.getItem("sp_kbs_auto")!=="0"; }catch(_){ return true; } });
  const autoOnRef=useRef(autoOn); autoOnRef.current=autoOn;
  const toggleAuto=v=>{ setAutoOn(v); try{ localStorage.setItem("sp_kbs_auto",v?"1":"0"); }catch(_){} };
  const bfnRef=useRef(false); bfnRef.current=bfn;
  const autoMs=(session&&session.ohipEnv==="customer")?60000:120000; // customer bedelsiz: 60 sn · partner (paralı) ve seçilmemiş: 120 sn
  const autoMsRef=useRef(autoMs); autoMsRef.current=autoMs;
  const detailsRef=useRef({}); detailsRef.current=details;
  const lightRef=useRef({busy:false,fn:null,last:cached?Date.now():0}); // sekmeye girince hemen yenilenmez: ilk otomatik yenileme autoMs sonra
  // Arka plan yenilemesi (ekran görünürken dakikada bir): liste canlı alınır; yalnız yeni misafirlerin ve eksik bilgili olanların profili okunur.
  // Tam profiller sunucu önbelleğinden gelir, eksik olanlar her seferinde OPERA'dan okunur (OPERA'da düzeltilince hemen görünür).
  const refreshLight=async()=>{
    const L=lightRef.current;
    if(L.busy||document.visibilityState!=="visible") return;
    L.busy=true; L.last=Date.now();
    try{
      try{ const rs=await fetch(`${PROXY}/api/kbs/submissions`,{cache:"no-store"}); if(rs.ok){ const d=await rs.json(); setSubs(d.items||[]); } }catch(_){}
      loadBizDate();
      const actP=waitKbs(loadActive(false));
      const found=await operaSearch({...session,byType:"lastName",query:"%",tab:"inhouse",all:true});
      const list=sortByRoom(found);
      const prev=detailsRef.current;
      const has=id=>Object.prototype.hasOwnProperty.call(prev,id);
      const noProfile=g=>!g.guestId||String(g.guestId).startsWith("#");
      const skip=kbsPreMatch(await actP,list);
      // KBS'de ad+oda ile kayıtlı ve profili henüz okunmamış (ya da okunamamış) misafirler yer tutucuyla işaretlenir, profili okunmaz
      const fill=list.filter(g=>skip.has(g.guestId)&&(!has(g.guestId)||prev[g.guestId]==null));
      if(fill.length) setDetails(d=>{ const n={...d}; fill.forEach(g=>{ n[g.guestId]=kbsDetailFrom(skip.get(g.guestId)); }); return n; });
      // yer tutucu taşıyan ama artık KBS'de eşleşmeyen (çıkmış, odası/adı değişmiş) misafirin profili okunur
      const need=list.filter(g=>!noProfile(g)&&!skip.has(g.guestId)&&(!has(g.guestId)||prev[g.guestId]==null||prev[g.guestId].fromKbs||kbsMissing(prev[g.guestId],bfnRef.current,isJandarma).length>0));
      const blanks=list.filter(g=>noProfile(g)&&!has(g.guestId));
      if(blanks.length) setDetails(d=>{ const n={...d}; blanks.forEach(g=>{ n[g.guestId]=null; }); return n; });
      setGuests(list);
      let i=0;
      const worker=async()=>{
        while(i<need.length){
          const g=need[i++];
          const det=await getProfileDetails({hostName:session.hostName,hotelId:session.hotelId,appKey:session.appKey,token:session.token,profileId:g.guestId,firstName:g.firstName,lastName:g.lastName});
          setDetails(d=>({...d,[g.guestId]:det}));
        }
      };
      await Promise.all(Array.from({length:5},worker));
      setUpdatedAt(new Date());
    }catch(_){ /* sessiz: bir sonraki turda yeniden denenir */ }
    L.busy=false;
  };
  lightRef.current.fn=refreshLight;
  useEffect(()=>{
    const tick=()=>{ const L=lightRef.current; if(autoOnRef.current&&L.fn&&Date.now()-(L.last||0)>=autoMsRef.current-1000) L.fn(); };
    const iv=setInterval(tick,15000);
    // tarayıcı sekmesine dönüldüğünde (otomatik açıksa) son yenilemeden 20 sn'den fazla geçtiyse hemen yenile
    const onVis=()=>{ const L=lightRef.current; if(autoOnRef.current&&document.visibilityState==="visible"&&L.fn&&Date.now()-(L.last||0)>20000) L.fn(); };
    document.addEventListener("visibilitychange",onVis);
    return ()=>{ clearInterval(iv); document.removeEventListener("visibilitychange",onVis); };
  },[]);
  useEffect(()=>{ if(ck&&guests&&updatedAt) kbsViewCache[ck]={guests,details,subs,bfn,kbsAct,bizDate,updatedAt}; },[guests,details,subs,bfn,kbsAct,bizDate,updatedAt]);
  const ready=!!guests&&guests.every(g=>Object.prototype.hasOwnProperty.call(details,g.guestId));
  // KBS'ye bağlıyken KBS'deki aktif kayıtlar OPERA misafirleriyle eşleştirilir (her KBS kaydı tek misafire; önce aynı odadakiler).
  // Eşleşen misafir, kim girmiş olursa olsun "KBS'de kayıtlı" sayılır; KBS'deki odası ve giriş saati oradan alınır.
  const kbsLive=!!(kbsAct&&kbsAct.connected&&!kbsAct.error);
  const kbsOf=new Map(), kbsUsed=new Set();
  if(kbsLive&&guests){
    const known=guests.filter(g=>Object.prototype.hasOwnProperty.call(details,g.guestId));
    // Önce elle "aynı kişi" diye bağlananlar (kayıttaki KBS kimliği hâlâ KBS'de aktifse)
    const byId=new Map(kbsAct.items.map(x=>[x.id,x]));
    for(const g of known){
      const link=subs.find(s=>String(s.profileId)===String(g.guestId)&&s.status==="sent"&&s.kbsId);
      const x=link&&byId.get(link.kbsId);
      if(x&&!kbsUsed.has(x.id)){ kbsOf.set(g.guestId,x); kbsUsed.add(x.id); }
    }
    for(const sameRoom of [true,false]) for(const g of known){
      if(kbsOf.has(g.guestId)) continue;
      const x=kbsAct.items.find(x=>!kbsUsed.has(x.id)&&(!sameRoom||String(x.room)===String(g.room))&&kbsSamePerson(x,g,details[g.guestId]));
      if(x){ kbsOf.set(g.guestId,x); kbsUsed.add(x.id); }
    }
  }
  const rows=(guests||[]).map(g=>{
    const pd=details[g.guestId];
    const known=Object.prototype.hasOwnProperty.call(details,g.guestId);
    const missing=known?kbsMissing(pd,bfn,isJandarma):[];
    const kx=kbsOf.get(g.guestId);
    if(kbsLive&&kx){
      const lastAny=subs.find(x=>String(x.profileId)===String(g.guestId));
      const lastErr=lastAny&&lastAny.status==="error"&&lastAny.action!=="checkin"?lastAny:null; // KBS'de kayıtlıysa eski giriş hatası geçersiz
      const active={room:kx.room,at:kx.at,kbs:true};
      const roomChanged=!!(!lastErr&&kx.room&&r_room(g)&&String(kx.room)!==String(r_room(g)));
      const ageMin=(Date.now()-new Date(kx.at).getTime())/60000;
      return {g,pd,missing,status:lastErr?"error":"sent",active,lastErr,roomChanged,ageMin,kbsId:kx.id};
    }
    // Son gönderim kaydı başarılıysa "gönderildi", hatalıysa "hata"; yoksa bilgisi tam olan "bekleyen", eksik olan "eksik bilgi"
    // subs en yeni önce; en son kayıt "çıkış" ise KBS'deki kayıt kapanmıştır (misafir tekrar bekleyen sayılır)
    // KBS'deki durum son BAŞARILI kayıttan çıkar; ondan yeni bir hatalı kayıt varsa misafir "hata"dadır (hatalı oda/çıkış KBS'deki kaydı değiştirmez)
    const lastSent=subs.find(x=>String(x.profileId)===String(g.guestId)&&x.status==="sent");
    const lastAny=subs.find(x=>String(x.profileId)===String(g.guestId));
    const active=lastSent&&lastSent.action!=="checkout"?lastSent:null;
    const lastErr=lastAny&&lastAny.status==="error"?lastAny:null;
    const status=lastErr?"error":active?"sent":!known?"loading":missing.length?"missing":"pending";
    // KBS'ye kaydedilen oda, OPERA'daki güncel odadan farklıysa oda değişmiştir
    const roomChanged=!!(!lastErr&&active&&active.room&&r_room(g)&&String(active.room)!==String(r_room(g)));
    // KBS oda güncelleme süresini konaklayanın eklendiği (giriş) saatten sayar
    const lastIn=active&&subs.find(x=>String(x.profileId)===String(g.guestId)&&x.status==="sent"&&x.action==="checkin");
    const ageMin=active?(Date.now()-new Date((lastIn||active).at).getTime())/60000:0;
    return {g,pd,missing,status,active,lastErr,roomChanged,ageMin};
  });
  const count=k=>k==="all"?rows.length:rows.filter(r=>r.status===k).length;
  const pendingRows=rows.filter(r=>r.status==="pending");
  const selRows=pendingRows.filter(r=>sel[r.g.guestId]);
  const changed=rows.filter(r=>r.roomChanged);
  // KBS'ye kayıt ettiğimiz ama OPERA'da artık konaklamayanlar = çıkış bekleyen (arama başarısızsa asla hesaplanmaz)
  const inIds=new Set((guests||[]).map(g=>String(g.guestId)));
  // subs en yeni önce: misafir başına son başarılı kayıt ve (ondan yeniyse) son hata
  const latestBy=new Map(), errBy=new Map();
  subs.forEach(x=>{ const k=String(x.profileId); if(x.status==="sent"){ if(!latestBy.has(k)) latestBy.set(k,x); } else if(!latestBy.has(k)&&!errBy.has(k)) errBy.set(k,x); });
  const oursLeaving=[...latestBy.values()].filter(x=>x.action!=="checkout"&&!inIds.has(String(x.profileId)));
  // KBS'ye bağlıyken: KBS'de aktif olup OPERA'da konaklamayan herkes (kim girmiş olursa olsun). Değilse yalnız bizim gönderdiklerimiz.
  const fromKbs=kbsLive;
  const leaving=(!err&&guests!==null&&ready)?(fromKbs
    ?kbsAct.items.filter(x=>!kbsUsed.has(x.id)).map(x=>{
        const own=oursLeaving.find(s=>String(s.room)===String(x.room)&&kbsMaskMatch(x.firstName,s.firstName||String(s.fullName).split(" ")[0])&&kbsMaskMatch(x.idNo||x.docNo,s.idNo||s.passportNo));
        const row=own?kbsLeavingRow(own):{g:{guestId:"kbs:"+x.id,firstName:x.firstName,lastName:x.lastName,room:x.room},pd:{nationality:x.idNo?"TR":"ZZ",documentNumber:x.idNo||x.docNo,firstName:x.firstName,lastName:x.lastName},leaving:true,active:{room:x.room,at:x.at}};
        return {...row,g:{...row.g,room:x.room},kbsId:x.id,kbsAt:x.at,lastErr:own?errBy.get(String(own.profileId))||null:null};
      })
    :oursLeaving.map(x=>({...kbsLeavingRow(x),lastErr:errBy.get(String(x.profileId))||null}))):[];
  // OPERA listesi eksik gelirse KBS'deki herkes "çıkış bekleyen" görünür: farkı büyükse toplu çıkış kapatılır
  const bulkOutOk=leaving.length<=Math.max(10,Math.round((fromKbs?kbsAct.items.length:leaving.length)*0.25));
  // Muhtemelen aynı kişi: aynı odada KBS ile eşleşmeyen bir misafir ve OPERA ile eşleşmeyen bir KBS kaydı (ad/belge yazımı farklı olabilir)
  const pairs=(fromKbs&&ready&&!err)?rows.filter(r=>!kbsOf.has(r.g.guestId)&&r.status!=="loading"&&r.g.room).flatMap(r=>
    kbsAct.items.filter(x=>!kbsUsed.has(x.id)&&String(x.room)===String(r.g.room)&&!notSame[r.g.guestId+"|"+x.id]).map(x=>({r,x}))):[];
  // Önerideki KBS kayıtları misafir otelde olabileceği için toplu çıkışa girmez
  const pairedKbs=new Map(pairs.map(p=>[p.x.id,p.r]));
  const leavingBulk=leaving.filter(r=>!pairedKbs.has(r.kbsId));
  // KBS'de mükerrer kayıtlar: aynı kimlik/belge no birden fazla aktif kayıtta (yalnız okuma; KBS'ye bir şey gönderilmez). Maskeli numaralarda ad+soyad da aynı olmalı.
  const dups=(()=>{
    if(!kbsLive) return [];
    const by=new Map();
    for(const x of kbsAct.items){
      const id=String(x.idNo||x.docNo||"").replace(/\s/g,"");
      if(!id) continue;
      const key=id.includes("*")?`${id}|${kbsNorm(x.firstName)}|${kbsNorm(x.lastName)}`:id;
      if(!by.has(key)) by.set(key,[]);
      by.get(key).push(x);
    }
    return [...by.values()].filter(g=>g.length>1);
  })();
  // Doluluk farkı: OPERA'daki doluluk (yetişkin + çocuk) ile rezervasyona bağlı misafir profili sayısı tutmuyor (ör. beraberindeki eklenmiş ama yetişkin sayısı güncellenmemiş).
  // OPERA arama yanıtında zaten gelen sayılar kullanılır; ek çağrı yapılmaz. Onay numarası olmayan satırlar (belirsiz oda paylaşımı) atlanır.
  const occDiffs=(()=>{
    if(!guests) return [];
    const by=new Map();
    for(const g of guests){
      const k=g.confirmationNo&&g.confirmationNo!=="—"?String(g.confirmationNo):"";
      if(!k) continue;
      const e=by.get(k)||{conf:k,room:g.room,adults:Number(g.adults)||0,children:Number(g.children)||0,names:[]};
      e.names.push(`${g.firstName} ${g.lastName}`.trim());
      by.set(k,e);
    }
    return [...by.values()].filter(e=>e.adults+e.children>0&&e.names.length!==e.adults+e.children).sort((a,b)=>String(a.room).localeCompare(String(b.room),undefined,{numeric:true}));
  })();
  // Otomatik gönderim (yönetim panelinde açıksa): ekran açık ve KBS listesi canlıyken, bilgisi tam bekleyenler kendiliğinden gönderilir.
  // Korumalar: yalnız ekran görünürken; öneri kutusundaki (belirsiz) eşleşmeler hariç; tur başına en çok 10 kayıt; aynı kayıt 15 dk içinde yeniden denenmez;
  // hata olunca durur; toplu çıkış yalnız OPERA-KBS farkı küçükse; oda değişimi yalnız KBS'nin 3 saatlik süresi içindeyse.
  useEffect(()=>{
    if(!autoSend||autoPaused||!ready||sendBusy||confirm||editing||!kbsLive) return;
    if(document.visibilityState!=="visible") return;
    const A=autoRef.current; if(A.busy) return;
    const now=Date.now(), fresh=k=>!(A.tried[k]&&now-A.tried[k]<15*60000);
    const pairedIds=new Set(pairs.map(p=>String(p.r.g.guestId)));
    let action="", list=[], label="", keyOf=null;
    const inRows=pendingRows.filter(r=>!pairedIds.has(String(r.g.guestId))&&fresh("in|"+r.g.guestId)).slice(0,10);
    if(inRows.length){ action="checkin"; list=inRows; label=t("Giriş"); keyOf=r=>"in|"+r.g.guestId; }
    else{
      const outRows=(bulkOutOk?leavingBulk:[]).filter(r=>r.kbsId&&fresh("out|"+r.kbsId)).slice(0,10);
      if(outRows.length){ action="checkout"; list=outRows; label=t("Çıkış"); keyOf=r=>"out|"+r.kbsId; }
      else{
        const rmRows=changed.filter(r=>r.active&&r.ageMin<150&&!r.lastErr&&fresh("rm|"+r.g.guestId)).slice(0,10);
        if(rmRows.length){ action="room"; list=rmRows; label=t("Oda değişimi"); keyOf=r=>"rm|"+r.g.guestId; }
      }
    }
    if(!list.length) return;
    list.forEach(r=>{ A.tried[keyOf(r)]=now; });
    A.busy=true;
    doSend(action,list,t("Otomatik")+": "+label,true).finally(()=>{ A.busy=false; });
  },[guests,details,subs,kbsAct,sendBusy,ready,autoPaused,confirm,editing]);
  const linkPair=async({r,x})=>{
    if(!await askConfirm(t("{ad} (oda {oda}) KBS'deki {kbs} kaydıyla aynı kişi olarak bağlansın mı? KBS'ye bir şey gönderilmez.",{ad:`${r.g.firstName} ${r.g.lastName}`,oda:r.g.room,kbs:`${x.firstName} ${x.lastName}`.trim()}))) return;
    try{ await kbsMark("checkin",[{...r,kbsId:x.id}]); await load(); }catch(e){ setRcErr(e.message); }
  };
  // Hatalı satırı yeniden dener: son hatalı işlem neyse o (oda güncelleme süresi geçtiyse çıkış + yeniden giriş)
  const retry=r=>{
    const a=r.lastErr?.action;
    if(a==="checkin") return doSend("checkin",[r],t("Giriş"));
    if(a==="room"&&r.active&&r.ageMin<180) return doSend("room",[r],t("Oda değişimi"));
    if(r.active) return doRelocate(r);
    return doSend("checkin",[r],t("Giriş"));
  };
  const toggle=id=>setSel(p=>({...p,[id]:!p[id]}));
  // "Bugün" OPERA iş günüdür (gün sonu çalışana kadar takvim gününden geride olabilir); okunamazsa takvim günü
  const todayIso=bizDate||todayLocalIso();
  // Tarih düğmelerindeki sayılar seçili karta göredir (ör. "KBS'de kayıtlı" seçiliyken yalnız onlar sayılır)
  const inCard=rows.filter(r=>filter==="all"||r.status===filter);
  const arrCount=inCard.filter(r=>isDay(r.g.checkIn,todayIso)).length;
  const depCount=inCard.filter(r=>isDay(r.g.checkOut,todayIso)).length;
  const shown=rows.filter(r=>(filter==="all"||r.status===filter)&&(dateFilter==="all"||(dateFilter==="arr"?isDay(r.g.checkIn,todayIso):isDay(r.g.checkOut,todayIso)))&&(!q.trim()||(`${r.g.firstName} ${r.g.lastName} ${r.g.room}`).toLowerCase().includes(q.trim().toLowerCase())));
  return(
    <div>
      <style>{`.kbs-mobile{display:none}@media(max-width:700px){.kbs-table{display:none!important}.kbs-mobile{display:grid!important}.kbs-cards button>div:first-child{white-space:normal!important;line-height:1.2}}`}</style>
      {autoSend&&<div style={{fontSize:13,lineHeight:1.6,padding:"10px 14px",borderRadius:10,marginBottom:12,background:autoPaused?"#FEF2F2":"#EEF7FF",border:`1px solid ${autoPaused?"#FCA5A5":"#BAD7F2"}`,color:autoPaused?S.red:S.navy}}>
        {autoPaused?<>⏸ {autoPaused}</>:<>🤖 <b>{t("Otomatik gönderim AÇIK")}</b> — {t("Bu ekran açıkken bilgisi tam misafirlerin giriş, çıkış ve oda değişimi KBS'ye kendiliğinden gönderilir; sonuçlar KBS Geçmişi'nde görünür. Ekran kapalıyken gönderim yapılmaz.")}</>}
      </div>}
      <div className="kbs-cards" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(104px,1fr))",gap:8,marginBottom:12}}>
        {(
          <button type="button" onClick={()=>setFilter("leaving")} style={{textAlign:"left",padding:"8px 10px",borderRadius:10,border:`1.5px dashed ${filter==="leaving"?"#6B7280":"#9CA3AF"}`,background:"#F9FAFB",cursor:"pointer",boxShadow:filter==="leaving"?"0 0 0 2px #6B728033":"none",order:9}}>
            <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:S.text,whiteSpace:"nowrap"}}><span style={{fontWeight:900,color:"#6B7280"}}>🚪</span>{t("Çıkış bekleyen")}</div>
            <div style={{fontSize:20,fontWeight:900,color:"#6B7280",marginTop:4}}>{guests===null||!ready?"…":leaving.length}</div>
          </button>
        )}
        {kbsLive&&(
          <button type="button" onClick={()=>setFilter("dup")} style={{textAlign:"left",padding:"8px 10px",borderRadius:10,border:`1.5px dashed ${filter==="dup"?"#B45309":"#D6B98A"}`,background:"#FFFBF3",cursor:"pointer",boxShadow:filter==="dup"?"0 0 0 2px #B4530933":"none",order:10}}>
            <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:S.text,whiteSpace:"nowrap"}}><span style={{fontWeight:900,color:"#B45309"}}>⧉</span>{t("Mükerrer kayıt")}</div>
            <div style={{fontSize:20,fontWeight:900,color:"#B45309",marginTop:4}}>{dups.length}</div>
          </button>
        )}
        {KBS_STATUS.map(s=>(
          <button key={s.k} type="button" onClick={()=>setFilter(s.k)} style={{textAlign:"left",padding:"8px 10px",borderRadius:10,border:`1.5px solid ${filter===s.k?s.color:s.bd}`,background:s.bg,cursor:"pointer",boxShadow:filter===s.k?`0 0 0 2px ${s.color}33`:"none"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:S.text,whiteSpace:"nowrap"}}><span style={{color:s.color,fontWeight:900}}>{s.icon}</span>{t(s.label)}</div>
            <div style={{fontSize:20,fontWeight:900,color:s.color,marginTop:4}}>{guests===null?"…":count(s.k)}</div>
          </button>
        ))}
      </div>
      {ready&&occDiffs.length>0&&(
        <details style={{marginBottom:12,border:"1px solid #FED7AA",background:"#FFFBF3",borderRadius:10,padding:"8px 12px"}}>
          <summary style={{cursor:"pointer",fontSize:13,fontWeight:800,color:S.orangeDk}}>⚠ {t("Doluluk farkı")} ({occDiffs.length}): {t("OPERA'daki kişi sayısı ile rezervasyona bağlı misafir sayısı farklı")}</summary>
          <div style={{fontSize:12,color:S.muted,lineHeight:1.6,margin:"8px 0"}}>{t("Çoğunlukla beraberindeki misafir eklenmiş ama yetişkin/çocuk sayısı güncellenmemiştir (ya da tersi). KBS bildirimi misafir profillerine göre yapılır; OPERA raporlarındaki kişi sayısı doluluk sayısına göre çıkar. Düzeltme OPERA'da yapılır.")}</div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr>{[t("Oda No"),t("Rezervasyon"),t("OPERA doluluğu"),t("Bağlı misafir"),t("Fark")].map(h=><th key={h} style={{textAlign:"left",padding:"6px 8px",borderBottom:`2px solid ${S.border}`,fontSize:11,fontWeight:800,color:S.muted,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
            <tbody>{occDiffs.map(e=>{ const occ=e.adults+e.children, d=e.names.length-occ; return(
              <tr key={e.conf}>
                <td style={{padding:"6px 8px",borderBottom:`1px solid ${S.border}`,fontWeight:700}}>{e.room||"—"}</td>
                <td style={{padding:"6px 8px",borderBottom:`1px solid ${S.border}`}}>{e.conf}<div style={{fontSize:11,color:S.muted}}>{e.names.join(" · ")}</div></td>
                <td style={{padding:"6px 8px",borderBottom:`1px solid ${S.border}`}}>{e.adults} {t("yetişkin")}{e.children?` + ${e.children} ${t("çocuk")}`:""}</td>
                <td style={{padding:"6px 8px",borderBottom:`1px solid ${S.border}`}}>{e.names.length}</td>
                <td style={{padding:"6px 8px",borderBottom:`1px solid ${S.border}`,fontWeight:800,color:d>0?S.orangeDk:S.red}}>{d>0?`+${d}`:d}</td>
              </tr>); })}</tbody>
          </table>
        </details>
      )}
      {editing&&<KbsQuickEdit g={editing.g} pd={editing.pd} session={session} birthFromNat={bfn} noBirthPlace={isJandarma} onClose={()=>setEditing(null)} onChanged={()=>{ setEditing(null); load(); }} onSaved={(id,det)=>{ setDetails(d=>({...d,[id]:det})); setEditing(null); }}/>}
      {confirm&&(
        <Portal><div role="dialog" aria-modal="true" style={{position:"fixed",inset:0,zIndex:3500,background:"rgba(10,25,45,.55)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:"#fff",borderRadius:14,padding:"18px 18px 14px",maxWidth:460,width:"100%",maxHeight:"85dvh",overflowY:"auto"}}>
            <div style={{fontSize:16,fontWeight:800,color:S.navy,marginBottom:6}}>{confirm.length===1?t("1 kayıt KBS'ye gönderilecek"):t("{n} kayıt KBS'ye gönderilecek",{n:confirm.length})}</div>
            <div style={{fontSize:13,color:S.text,margin:"6px 0 10px",maxHeight:"36dvh",overflowY:"auto",lineHeight:1.6}}>
              {confirm.map(r=><div key={r.g.guestId}>• {r.g.firstName} {r.g.lastName}{r.g.room?` · ${t("Oda No")} ${r.g.room}`:""}</div>)}
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end",flexWrap:"wrap"}}>
              <button className="btn" disabled={sendBusy} onClick={()=>setConfirm(null)} style={{padding:"10px 16px",borderRadius:9,border:`1.5px solid ${S.border}`,background:"#fff",fontWeight:700}}>{t("Vazgeç")}</button>
              <button className="btn btn-p" disabled={sendBusy} onClick={()=>doSend("checkin",confirm,t("Giriş"))} style={{padding:"10px 16px",borderRadius:9}}>{sendBusy?<Spin/>:t("Gönder")}</button>
            </div>
          </div>
        </div></Portal>
      )}
      <div className="card" style={{padding:"14px 14px 6px"}}>
        {filter!=="leaving"&&<div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
          {[["all",t("Hepsi"),inCard.length],["arr",t("Bugün giriş"),arrCount],["dep",t("Bugün çıkış"),depCount]].map(([k,l,n])=>(
            <button key={k} type="button" onClick={()=>setDateFilter(k)} style={{padding:"9px 14px",minHeight:40,borderRadius:999,border:`1.5px solid ${dateFilter===k?S.blue:S.border}`,background:dateFilter===k?"#EEF5FF":"#fff",color:dateFilter===k?S.blue:S.muted,fontWeight:800,fontSize:13,cursor:"pointer"}}>{l} ({n})</button>
          ))}
          {bizDate&&<span title={t("Bugün giriş / çıkış OPERA iş gününe göre hesaplanır")} style={{alignSelf:"center",fontSize:12,color:bizDate!==todayLocalIso()?S.orangeDk:S.muted,fontWeight:bizDate!==todayLocalIso()?700:500}}>{t("OPERA iş günü")}: {fmtDateTR(bizDate)}{bizDate!==todayLocalIso()?` (${t("gün sonu henüz yapılmadı")})`:""}</span>}
        </div>}
        <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center",marginBottom:10}}>
          <input className="inp" style={{flex:"1 1 200px"}} value={q} onChange={e=>setQ(e.target.value)} placeholder={t("Ara… ad, soyad veya oda no")}/>
          <button className="btn" onClick={load} style={{padding:"10px 16px",borderRadius:9,border:`1.5px solid ${S.border}`,background:"#fff",fontWeight:700}}>{t("Yenile")}</button>
          <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13,color:S.text,cursor:"pointer",whiteSpace:"nowrap"}}><input type="checkbox" checked={autoOn} onChange={e=>toggleAuto(e.target.checked)} style={{width:18,height:18}}/>{t("Otomatik yenile")}</label>
          {updatedAt&&<span style={{fontSize:12,color:S.muted,whiteSpace:"nowrap"}}>{t("Son güncelleme")}: {String(updatedAt.getHours()).padStart(2,"0")}:{String(updatedAt.getMinutes()).padStart(2,"0")}:{String(updatedAt.getSeconds()).padStart(2,"0")} · {autoOn?<>{t("otomatik")} {autoMs/1000} {t("sn")}</>:t("otomatik yenileme kapalı")}{kbsLive&&kbsAct.at?" · "+t("KBS listesi")+": "+hhmm(kbsAct.at)+" ("+t("5 dk'da bir, Yenile anında okur")+")":""}</span>}
        </div>
        {kbsAct&&kbsAct.stopped&&<div style={{fontSize:13,padding:"8px 10px",borderRadius:8,background:"#FEF2F2",border:"1px solid #FCA5A5",color:S.red,marginBottom:10,lineHeight:1.5}}>⏸ {t("KBS bağlantısı Protel yöneticisi tarafından durduruldu; KBS'ye istek gönderilmez. Yeniden başlatmak için Protel'e başvurun.")}</div>}
        {kbsAct&&!kbsAct.connected&&!kbsAct.stopped&&<div style={{fontSize:13,padding:"8px 10px",borderRadius:8,background:"#FFF7ED",border:"1px solid #FED7AA",color:S.orangeDk,marginBottom:10,lineHeight:1.5}}>⚠ {t("KBS'ye bağlı değilsiniz. Durumlar yalnız bu uygulamanın kayıtlarına göre gösteriliyor; başka uygulamanın KBS'ye girdiği misafirler \"Bekleyen\" görünebilir. Toplu gönderim kapalı; KBS Bilgileri'nden bağlanın.")}</div>}
        {kbsAct&&kbsAct.connected&&kbsAct.error&&<div style={{fontSize:13,padding:"8px 10px",borderRadius:8,background:"#FFF7ED",border:"1px solid #FED7AA",color:S.orangeDk,marginBottom:10,lineHeight:1.5}}>⚠ {t("KBS listesi okunamadı; durumlar yalnız bu uygulamanın kayıtlarına göre gösteriliyor ve eksik olabilir. Toplu gönderim kapalı.")} ({kbsAct.error})</div>}
        {(pendingRows.length>0||leaving.length>0||changed.length>0)&&(
          <div style={{border:`1.5px solid ${S.border}`,background:"#F6F9FD",borderRadius:12,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:14,fontWeight:800,color:S.navy,marginBottom:6}}>🔄 {t("KBS'yi OPERA ile eşitle")}</div>
            <div style={{fontSize:13,color:S.text,marginBottom:6,lineHeight:1.6}}>
              {t("Giriş")}: <b>{pendingRows.length}</b> · {t("Çıkış")}: <b>{leaving.length}</b> · {t("Oda değişimi")}: <b>{changed.length}</b>
            </div>
          </div>
        )}
        {rcErr&&<div style={{fontSize:13,padding:"8px 10px",borderRadius:8,background:"#FEE2E2",color:S.red,marginBottom:8}}>{rcErr}</div>}
        {sendRes&&(
          <div style={{border:`1.5px solid ${sendRes.bad.length?"#FECACA":"#BBF7D0"}`,background:sendRes.bad.length?"#FEF2F2":"#F0FDF4",borderRadius:12,padding:"10px 14px",marginBottom:12,fontSize:13,lineHeight:1.6}}>
            <b>{sendRes.label}: {sendRes.ok} {t("başarılı")}{sendRes.bad.length?`, ${sendRes.bad.length} ${t("hatalı")}`:""}</b>
            {sendRes.bad.map((b,i)=><div key={i} style={{color:S.red}}>• {b.name}: {b.message}</div>)}
          </div>
        )}
        {pairs.length>0&&(
          <div style={{border:"1.5px solid #BFDBFE",background:"#EFF6FF",borderRadius:12,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:14,fontWeight:800,color:S.navy,marginBottom:6}}>🔗 {t("Muhtemelen aynı kişi")} ({pairs.length})</div>
            <div style={{fontSize:12,color:S.text,marginBottom:6,lineHeight:1.5}}>{t("Aynı odada KBS ile eşleşmeyen bir misafir ve OPERA ile eşleşmeyen bir KBS kaydı var; ad ya da belge no farklı yazılmış olabilir. Aynı kişiyse bağlayın: misafir \"KBS'de kayıtlı\" olur, KBS kaydı çıkış bekleyen listesinden düşer. KBS'ye bir şey gönderilmez.")}</div>
            {pairs.map(p=>(
              <div key={p.r.g.guestId+"|"+p.x.id} style={{borderTop:"1px solid #BFDBFE",padding:"8px 0",display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                <div style={{flex:"1 1 260px",fontSize:13,lineHeight:1.5}}>
                  <div><b style={{color:S.navy}}>{t("Oda No")} {p.r.g.room}</b></div>
                  <div>OPERA: <b>{p.r.g.firstName} {p.r.g.lastName}</b>{p.r.pd?.documentNumber?` · ${p.r.pd.documentNumber}`:""}</div>
                  <div>KBS: <b>{p.x.firstName} {p.x.lastName}</b>{(p.x.idNo||p.x.docNo)?` · ${p.x.idNo||p.x.docNo}`:""}{p.x.at?` · ${t("KBS'ye giriş")} ${fmtDateTR(String(p.x.at).slice(0,10))} ${hhmm(p.x.at)}`:""}</div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button className="btn btn-p" disabled={sendBusy} onClick={()=>linkPair(p)} style={{padding:"9px 14px",borderRadius:9,minHeight:40}}>{t("Aynı kişi")}</button>
                  <button className="btn" onClick={()=>setNotSame(s=>({...s,[p.r.g.guestId+"|"+p.x.id]:true}))} style={{padding:"9px 14px",borderRadius:9,minHeight:40,border:`1.5px solid ${S.border}`,background:"#fff",fontWeight:700}}>{t("Farklı kişi")}</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {changed.length>0&&(
          <div style={{border:"1.5px solid #FED7AA",background:"#FFF7ED",borderRadius:12,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:14,fontWeight:800,color:S.orangeDk,marginBottom:6}}>🔁 {t("Oda değişti")} ({changed.length})</div>
            <div style={{fontSize:12,color:S.text,marginBottom:6,lineHeight:1.5}}>{t("OPERA'daki oda, KBS'ye kaydedilen odadan farklı. KBS'de oda güncellemesi yalnızca kayıttan sonraki 3 saat içinde yapılabilir; süre geçtiyse önce çıkış (düşüm), sonra yeni odayla yeniden giriş (ekleme) gerekir.")}</div>
            {rcErr&&<div style={{fontSize:13,padding:"8px 10px",borderRadius:8,background:"#FEE2E2",color:S.red,marginBottom:8}}>{rcErr}</div>}
            {changed.map(r=>{
              const fresh=r.ageMin<180;
              return(
                <div key={"rc-"+r.g.guestId} style={{borderTop:`1px solid #FED7AA`,padding:"8px 0"}}>
                  <div style={{fontWeight:700,color:S.navy}}>{r.g.firstName} {r.g.lastName} · {r.active.room} → {r.g.room}</div>
                  <div style={{fontSize:12,color:S.muted}}>{fresh?t("KBS'de oda güncellenebilir ({n} dk kaldı).",{n:180-Math.floor(r.ageMin)}):t("Kayıttan 3 saatten fazla geçti: çıkış + yeniden giriş gerekir.")}</div>
                  {<button className="btn btn-p" disabled={sendBusy} onClick={async()=>{ if(await askConfirm(fresh?t("KBS'de oda {a} → {b} olarak güncellensin mi?",{a:r.active.room,b:r.g.room}):t("KBS'de önce {a} odasından çıkış, sonra {b} odasıyla yeniden giriş yapılacak. Onaylıyor musunuz?",{a:r.active.room,b:r.g.room}))) (fresh?doSend("room",[r],t("Oda değişimi")):doRelocate(r)); }} style={{marginTop:6,padding:"9px 14px",borderRadius:9,minHeight:40}}>{sendBusy?<Spin/>:fresh?t("Odayı güncelle"):t("Çıkış + yeniden giriş")}</button>}
                </div>
              );
            })}
          </div>
        )}
        {guests!==null&&pendingRows.length>0&&(
          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:10}}>
            <button className="btn btn-p" disabled={selRows.length===0} onClick={()=>setConfirm(selRows)} style={{padding:"10px 16px",borderRadius:9}}>{t("Seçilenleri gönder")} ({selRows.length})</button>
            <button className="btn" disabled={selRows.length===0} onClick={async()=>{ if(!await askConfirm(t("Seçili {n} misafir KBS'de zaten kayıtlı olarak işaretlensin mi? KBS'ye bir şey gönderilmez.",{n:selRows.length}))) return; try{ await kbsMark("checkin",selRows); setSel({}); await load(); }catch(e){ setRcErr(e.message); } }} style={{padding:"10px 16px",borderRadius:9,border:`1.5px solid ${S.border}`,background:"#fff",fontWeight:700}}>{t("KBS'de zaten kayıtlı say")} ({selRows.length})</button>
            <button className="btn" disabled={!kbsLive} onClick={()=>setConfirm(pendingRows)} style={{padding:"10px 16px",borderRadius:9,border:`1.5px solid ${S.border}`,background:"#fff",fontWeight:700}}>{t("Bekleyenlerin tümünü gönder")} ({pendingRows.length})</button>
          </div>
        )}
        {guests!==null&&!ready&&<div style={{fontSize:12,color:S.muted,marginBottom:8}}>{t("Profil bilgileri okunuyor… {a}/{b}",{a:guests.filter(g=>Object.prototype.hasOwnProperty.call(details,g.guestId)).length,b:guests.length})}</div>}
        {err&&<div style={{color:S.red,fontSize:13,marginBottom:8}}>{err}</div>}
        {guests!==null&&filter==="dup"?(
          !kbsLive?<div style={{padding:"18px 0",textAlign:"center",color:S.muted,fontSize:13,lineHeight:1.6}}>{t("Mükerrer kayıtları görmek için KBS'ye bağlı olmalısınız.")}</div>
          :dups.length===0?<div style={{padding:"18px 0",textAlign:"center",color:S.muted,fontSize:13,lineHeight:1.6}}>{t("KBS'de mükerrer kayıt yok.")}</div>
          :(
            <div className="table-scroll" style={{overflowX:"auto",marginBottom:8}}>
              <div style={{fontSize:12,color:S.muted,marginBottom:8,lineHeight:1.5}}>{t("KBS'de aynı kimlik ya da belge numarasıyla birden fazla aktif kayıt görünen misafirler. Düzeltme KBS'de yapılır; bu liste yalnızca bilgi içindir, KBS'ye bir şey gönderilmez.")}</div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead><tr>{[t("Kimlik / Belge No"),t("Ad Soyad"),t("Oda No"),t("KBS'ye giriş"),t("Kayıt")].map(h=><th key={h} style={{textAlign:"left",padding:"8px 8px",borderBottom:`2px solid ${S.border}`,fontSize:11,fontWeight:800,color:S.muted,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
                <tbody>{dups.flatMap((g,gi)=>g.map((x,i)=>(
                  <tr key={gi+"-"+x.id} style={{background:gi%2?"#FFFBF3":"#fff"}}>
                    <td style={{padding:"8px 8px",borderBottom:`1px solid ${S.border}`,fontFamily:"monospace"}}>{x.idNo||x.docNo}</td>
                    <td style={{padding:"8px 8px",borderBottom:`1px solid ${S.border}`,fontWeight:700}}>{x.firstName} {x.lastName}</td>
                    <td style={{padding:"8px 8px",borderBottom:`1px solid ${S.border}`}}>{x.room||"—"}</td>
                    <td style={{padding:"8px 8px",borderBottom:`1px solid ${S.border}`,whiteSpace:"nowrap"}}>{x.at?`${fmtDateTR(String(x.at).slice(0,10))} ${hhmm(x.at)}`:"—"}</td>
                    <td style={{padding:"8px 8px",borderBottom:`1px solid ${S.border}`,color:"#B45309"}}>{i+1}/{g.length}</td>
                  </tr>)))}</tbody>
              </table>
            </div>
          )
        ):guests!==null&&filter==="leaving"?(leaving.length===0?<div style={{padding:"18px 0",textAlign:"center",color:S.muted,fontSize:13,lineHeight:1.6}}>{t("Kayıt yok")}{!fromKbs&&<div>{kbsAct?.error?kbsAct.error:t("KBS'ye bağlı değilsiniz: yalnız bu uygulamadan gönderilenler kontrol ediliyor. KBS Bilgileri'nden bağlanın.")}</div>}</div>:(
            <div className="table-scroll" style={{overflowX:"auto",marginBottom:8}}>
              <div style={{fontSize:12,color:S.muted,marginBottom:8,lineHeight:1.5}}>{fromKbs?t("KBS'de aktif görünen, ama OPERA'da konaklamayan misafirler. Çıkış (düşüm) bekliyorlar. KBS ad ve kimlik numarasını gizli (maskeli) gösterir; misafiri oda numarasından tanıyabilirsiniz."):t("KBS'ye bu uygulamadan kayıt ettiğiniz, ama OPERA'da artık konaklamayan misafirler. KBS'ye bağlanınca başka uygulamaların girdiği misafirler de burada görünür.")}</div>
              {!bulkOutOk&&<div style={{fontSize:12,color:S.orangeDk,background:"#FFF7ED",border:"1px solid #FED7AA",borderRadius:8,padding:"8px 10px",marginBottom:10}}>{t("OPERA ile KBS listesi arasındaki fark çok büyük ({n} kişi). Yanlışlıkla toplu çıkış yapılmaması için \"Hepsini çıkar\" kapalı; misafirleri tek tek çıkarın.",{n:leaving.length})}</div>}
              {<button className="btn btn-p" disabled={sendBusy||!bulkOutOk||!leavingBulk.length} onClick={async()=>{ if(await askConfirm(t("{n} misafirin KBS'de çıkışı yapılsın mı?",{n:leavingBulk.length}))) doSend("checkout",leavingBulk,t("Çıkış")); }} style={{padding:"10px 16px",borderRadius:9,marginBottom:10}}>{sendBusy?<Spin/>:`${t("Hepsini çıkar")} (${leavingBulk.length})`}</button>}
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:560}}>
                <thead><tr style={{textAlign:"left",color:S.muted,fontSize:11,textTransform:"uppercase",letterSpacing:".5px"}}>
                  {["Profil Id","Ad Soyad","Kayıtlı oda","KBS'ye giriş",""].map(h=><th key={h} style={{padding:"8px 8px",borderBottom:`1.5px solid ${S.border}`,whiteSpace:"nowrap"}}>{t(h)}</th>)}
                </tr></thead>
                <tbody>{leaving.map(r=>(
                  <tr key={"lv-"+r.g.guestId}>
                    <td style={{padding:"9px 8px",borderBottom:`1px solid ${S.border}`,fontFamily:"monospace"}}>{String(r.g.guestId).startsWith("kbs:")?"—":r.g.guestId}</td>
                    <td style={{padding:"9px 8px",borderBottom:`1px solid ${S.border}`,fontWeight:700,color:S.navy}}>{r.g.firstName} {r.g.lastName}{pairedKbs.has(r.kbsId)&&<div style={{fontSize:12,fontWeight:600,color:S.blue}}>🔗 {t("Muhtemelen OPERA'da konaklıyor")}: {pairedKbs.get(r.kbsId).g.firstName} {pairedKbs.get(r.kbsId).g.lastName}</div>}{r.lastErr&&<div style={{fontSize:12,fontWeight:500,color:S.red}}>{t("Son deneme hatalı")}: {r.lastErr.message}</div>}</td>
                    <td style={{padding:"9px 8px",borderBottom:`1px solid ${S.border}`}}>{r.g.room||"—"}</td>
                    <td style={{padding:"9px 8px",borderBottom:`1px solid ${S.border}`,whiteSpace:"nowrap"}}>{(()=>{const d=new Date(r.active.at);return isNaN(d)?String(r.active.at||"").slice(0,16):`${fmtDateTR(d.toISOString().slice(0,10))} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;})()}</td>
                    <td style={{padding:"9px 8px",borderBottom:`1px solid ${S.border}`}}>{<button className="btn" disabled={sendBusy} onClick={async()=>{ if(await askConfirm(t("{ad} (oda {oda}) için KBS'de çıkış yapılsın mı?",{ad:r.g.firstName+" "+r.g.lastName,oda:r.g.room||"—"}))) doSend("checkout",[r],t("Çıkış")); }} style={{padding:"8px 12px",borderRadius:9,border:`1.5px solid ${S.border}`,background:"#fff",fontWeight:700,minHeight:38}}>{t("Çıkar")}</button>}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )):guests!==null&&(filter==="sent"||filter==="error")?(()=>{
          const inDate=r=>dateFilter==="all"||(dateFilter==="arr"?isDay(r.g.checkIn,todayIso):isDay(r.g.checkOut,todayIso));
          // Kişi başına tek satır (kartlardaki sayıyla aynı). Hata: son hatalı işlem (yeniden denenecek olan).
          // KBS'de kayıtlı: KBS'deki giriş saati (KBS'ye bağlıyken KBS'den, değilse bizim kaydımızdan) ve varsa son oda güncellemesi.
          const list=rows.filter(r=>r.status===filter&&inDate(r)).map(r=>{
            const pid=String(r.g.guestId);
            const mine=subs.filter(x=>String(x.profileId)===pid&&x.status==="sent");
            const isTR=toIso2(r.pd?.nationality||"")==="TR", doc=r.pd?.documentNumber||"";
            const base={id:pid,fullName:`${r.g.firstName} ${r.g.lastName}`,profileId:r.g.guestId,room:r.g.room,idNo:isTR?doc:"",passportNo:isTR?"":doc,_r:r};
            if(filter==="error"){ const e=r.lastErr; return {...base,at:e.at,action:e.action,message:e.message,inAt:e.action==="checkin"?e.at:"",roomAt:e.action==="room"?e.at:"",outAt:e.action==="checkout"?e.at:""}; }
            const lastIn=mine.find(x=>x.action==="checkin"), lastRoom=mine.find(x=>x.action==="room");
            const inAt=r.active?.kbs?r.active.at:(lastIn||r.active)?.at||"";
            const roomAt=lastRoom&&(!inAt||new Date(lastRoom.at)>=new Date(inAt))?lastRoom.at:"";
            return {...base,at:roomAt||inAt,action:roomAt?"room":"checkin",inAt,roomAt,outAt:""};
          }).filter(x=>!q.trim()||`${x.fullName} ${x.room}`.toLowerCase().includes(q.trim().toLowerCase()));
          const act={checkin:"Otele Giriş",room:"Oda Güncelleme",checkout:"Otelden Ayrılma"};
          const dt=v=>{ const d=new Date(v); return isNaN(d)?"":`${fmtDateTR(d.toISOString().slice(0,10))} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
          const heads=["Sıra No","Ad Soyad","Oda No","Profil Id","Kimlik No","Pasaport No","İşlem Tarihi","İşlem","Otele Giriş","Oda Güncelleme","Otelden Ayrılma"].concat(filter==="error"?["Hata",""]:[]);
          const td={padding:"9px 8px",borderBottom:`1px solid ${S.border}`,verticalAlign:"top"};
          return list.length===0?<div style={{padding:"18px 0",textAlign:"center",color:S.muted,fontSize:13}}>{t("Kayıt yok")}</div>:(
            <div className="table-scroll" style={{overflowX:"auto",marginBottom:8}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:900}}>
                <thead><tr style={{textAlign:"left",color:S.muted,fontSize:11,textTransform:"uppercase",letterSpacing:".5px"}}>
                  {heads.map(h=><th key={h} style={{padding:"8px 8px",borderBottom:`1.5px solid ${S.border}`,whiteSpace:"nowrap"}}>{t(h)}</th>)}
                </tr></thead>
                <tbody>{list.map((x,i)=>(
                  <tr key={x.id}>
                    <td style={td}>{i+1}</td>
                    <td style={{...td,fontWeight:700,color:S.navy}}>{x.fullName}</td>
                    <td style={td}>{x.room||"—"}</td>
                    <td style={{...td,fontFamily:"monospace"}}>{x.profileId}</td>
                    <td style={td}>{x.idNo}</td>
                    <td style={td}>{x.passportNo}</td>
                    <td style={{...td,whiteSpace:"nowrap"}}>{dt(x.at)}</td>
                    <td style={td}>{t(act[x.action]||x.action)}</td>
                    <td style={{...td,whiteSpace:"nowrap"}}>{dt(x.inAt)}</td>
                    <td style={{...td,whiteSpace:"nowrap"}}>{dt(x.roomAt)}</td>
                    <td style={{...td,whiteSpace:"nowrap"}}>{dt(x.outAt)}</td>
                    {filter==="error"&&<td style={{...td,color:S.red,minWidth:240}}>{x.message}</td>}
                    {filter==="error"&&<td style={td}>{<button className="btn btn-p" disabled={sendBusy} onClick={async()=>{ if(await askConfirm(t("{ad} için KBS'ye tekrar gönderilsin mi?",{ad:x.fullName}))) retry(x._r); }} style={{padding:"8px 12px",borderRadius:9,minHeight:38,whiteSpace:"nowrap"}}>{sendBusy?<Spin/>:t("Tekrar gönder")}</button>}</td>}
                  </tr>))}</tbody>
              </table>
            </div>
          );
        })():guests===null?<div style={{padding:"18px 0"}}><Spin/></div>:shown.length===0?<div style={{padding:"18px 0",textAlign:"center",color:S.muted,fontSize:13}}>{t("Kayıt yok")}</div>:(
          <>
          <div className="kbs-mobile" style={{gap:8,marginBottom:8}}>
            {shown.some(r=>r.status==="pending")&&(
              <label style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:10,background:"#F6F9FD",border:`1px solid ${S.border}`,fontSize:14,fontWeight:700,color:S.navy,cursor:"pointer"}}>
                <input type="checkbox" style={{width:22,height:22}} aria-label={t("Tümünü seç")}
                  checked={shown.filter(r=>r.status==="pending").every(r=>sel[r.g.guestId])}
                  onChange={e=>{const on=e.target.checked;setSel(p=>{const n={...p};shown.filter(r=>r.status==="pending").forEach(r=>{n[r.g.guestId]=on;});return n;});}}/>
                {t("Tümünü seç")} ({shown.filter(r=>r.status==="pending").length})
              </label>
            )}
            {shown.map((r,i)=>{
              const pd=r.pd||{}; const nat=pd.nationality?toIso2(pd.nationality):""; const isTR=nat==="TR";
              const bits=[(r.g.checkIn&&r.g.checkIn!=="—")&&(fmtDateTR(r.g.checkIn)+" → "+((r.g.checkOut&&r.g.checkOut!=="—")?fmtDateTR(r.g.checkOut):"")),nat,pd.documentNumber&&((isTR?t("Kimlik no"):t("Pasaport no"))+": "+pd.documentNumber),pd.birthDate&&fmtDateTR(pd.birthDate),pd.birthPlace,pd.gender==="M"?t("Erkek"):pd.gender==="F"?t("Kadın"):pd.gender].filter(Boolean);
              return(
                <div key={r.g.guestId+"-m-"+i} style={{border:`1.5px solid ${r.status==="missing"?"#FED7AA":S.border}`,background:r.status==="missing"?"#FFFBF5":"#fff",borderRadius:12,padding:"10px 12px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"baseline"}}>
                    <b style={{color:S.navy}}>{r.status==="pending"&&<input type="checkbox" style={{marginRight:8,width:18,height:18,verticalAlign:"middle"}} checked={!!sel[r.g.guestId]} onChange={()=>toggle(r.g.guestId)}/>}{r.g.firstName} {r.g.lastName}</b>
                    <span style={{fontWeight:800,color:S.muted,whiteSpace:"nowrap"}}>{t("Oda No")}: {r.g.room||"—"}</span>
                  </div>
                  <div style={{fontSize:11,color:S.muted,fontFamily:"monospace"}}>#{r.g.guestId}</div>
                  {bits.length>0&&<div style={{fontSize:12,color:S.text,marginTop:4}}>{bits.join(" · ")}</div>}
                  {r.status==="loading"?<div style={{fontSize:12,color:S.muted,marginTop:4}}>…</div>:r.missing.length>0&&<div style={{fontSize:12,color:S.orangeDk,fontWeight:700,marginTop:4}}>{t("Eksik alanlar")}: {r.missing.map(m=>t(m)).join(", ")}</div>}
                  {r.status!=="loading"&&r.pd&&!String(r.g.guestId).startsWith("#")&&<button type="button" className="btn" onClick={()=>setEditing({g:r.g,pd:r.pd})} style={{marginTop:8,minHeight:40,padding:"6px 14px",borderRadius:9,border:`1.5px solid ${S.border}`,background:"#fff",fontSize:13,fontWeight:700,color:S.blue}}>✏️ {t("Düzenle")}</button>}
                </div>
              );
            })}
          </div>
          <HScroll className="table-scroll kbs-table" style={{overflowX:"auto",marginBottom:8}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:720}}>
              <thead><tr style={{textAlign:"left",color:S.muted,fontSize:11,textTransform:"uppercase",letterSpacing:".5px"}}>
                <th style={{padding:"8px 8px",borderBottom:`1.5px solid ${S.border}`,width:28}}><input type="checkbox" aria-label={t("Tümünü seç")} checked={shown.filter(r=>r.status==="pending").length>0&&shown.filter(r=>r.status==="pending").every(r=>sel[r.g.guestId])} onChange={e=>{const on=e.target.checked;setSel(p=>{const n={...p};shown.filter(r=>r.status==="pending").forEach(r=>{n[r.g.guestId]=on;});return n;});}}/></th>{["Profil Id","Ad Soyad","Oda No","Giriş tarihi","Çıkış tarihi","Uyruk","Kimlik No","Doğum Tarihi","Doğum Yeri","Cinsiyet","Eksik alanlar"].map(h=><th key={h} style={{padding:"8px 8px",borderBottom:`1.5px solid ${S.border}`,whiteSpace:"nowrap"}}>{t(h)}</th>)}
              </tr></thead>
              <tbody>
                {shown.map((r,i)=>{
                  const pd=r.pd||{}; const nat=pd.nationality?toIso2(pd.nationality):"";
                  const isTR=nat==="TR";
                  const td={padding:"9px 8px",borderBottom:`1px solid ${S.border}`,verticalAlign:"top"};
                  return(
                    <tr key={r.g.guestId+"-"+i} style={{background:r.status==="missing"?"#FFFBF5":"transparent"}}>
                      <td style={td}>{r.status==="pending"&&<input type="checkbox" checked={!!sel[r.g.guestId]} onChange={()=>toggle(r.g.guestId)}/>}</td>
                      <td style={{...td,fontFamily:"monospace",whiteSpace:"nowrap"}}>{String(r.g.guestId).startsWith("#")?"—":r.g.guestId}</td>
                      <td style={{...td,fontWeight:700,color:S.navy}}>{r.g.firstName} {r.g.lastName}</td>
                      <td style={td}>{r.g.room||"—"}</td>
                      <td style={{...td,whiteSpace:"nowrap"}}>{r.g.checkIn&&r.g.checkIn!=="—"?fmtDateTR(r.g.checkIn):""}</td>
                      <td style={{...td,whiteSpace:"nowrap"}}>{r.g.checkOut&&r.g.checkOut!=="—"?fmtDateTR(r.g.checkOut):""}</td>
                      <td style={td} title={(window.KbsCountries&&window.KbsCountries.idOf(nat))?"KBS: "+window.KbsCountries.idOf(nat):""}>{nat||"—"}</td>
                      <td style={{...td,whiteSpace:"nowrap"}}>{pd.documentNumber?<>
                        <span>{pd.documentNumber}</span>
                        <span style={{marginLeft:6,padding:"1px 7px",borderRadius:999,fontSize:10,fontWeight:800,letterSpacing:".3px",background:isTR?"#E8F8EE":"#EEF2F7",color:isTR?"#1E7B45":S.muted,border:`1px solid ${isTR?"#BBF7D0":S.border}`}}>{isTR?"TC":(pd.idType&&pd.idType!=="TCKN"&&pd.idType!=="PASSPORT"&&pd.idType!=="P"?String(pd.idType).slice(0,5):"PASS")}</span>
                      </>:""}</td>
                      <td style={td}>{pd.birthDate?fmtDateTR(pd.birthDate):""}</td>
                      <td style={{...td,maxWidth:"8ch",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={pd.birthPlace||""}>{pd.birthPlace||""}</td>
                      <td style={td}>{pd.gender==="M"?t("Erkek"):pd.gender==="F"?t("Kadın"):(pd.gender||"")}</td>
                      <td style={{...td,color:S.orangeDk,fontWeight:700}}>{r.status==="loading"?<span style={{color:S.muted,fontWeight:500}}>…</span>:r.missing.map(m=>t(m)).join(", ")}{r.status!=="loading"&&r.pd&&!String(r.g.guestId).startsWith("#")&&<button type="button" className="btn" onClick={()=>setEditing({g:r.g,pd:r.pd})} style={{display:"block",marginTop:r.missing.length?6:0,padding:"4px 12px",borderRadius:8,border:`1.5px solid ${S.border}`,background:"#fff",fontSize:12,fontWeight:700,color:S.blue}}>✏️ {t("Düzenle")}</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </HScroll>
          </>
        )}
      </div>
    </div>
  );
}

// KBS ekranı: üstte "KBS Gönderim" ve "KBS Bilgileri" düğmeleri
function KbsPanel({session}){
  const kbsType=session&&session.kbsType==="jandarma"?"jandarma":"polis"; // yalnız yönetim panelinden değişir
  const canReport=!!(session&&session.kbsReport);
  const [view,setView]=useState(()=>{ try{ const v=sessionStorage.getItem("sp-kbs-view"); return v==="settings"||v==="report"?v:"send"; }catch(_){ return "send"; } });
  const isPhone=()=>typeof window!=="undefined"&&window.matchMedia&&window.matchMedia("(max-width: 760px)").matches;
  const shown=view==="report"&&(!canReport||isPhone())?"send":view; // rapor telefonda ve yetkisiz kullanıcıda açılmaz
  useEffect(()=>{ try{ sessionStorage.setItem("sp-kbs-view",view); }catch(_){} },[view]);
  const btn=(k,label,cls)=><button type="button" onClick={()=>setView(k)} className={`tab ${shown===k?"ton":"toff"} ${cls||""}`} style={{flex:1}}>{t(label)}</button>;
  return(
    <div>
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        {btn("send","📤 KBS Gönderim")}
        {btn("settings","⚙️ KBS Bilgileri")}
        {canReport&&btn("report","📄 KBS Geçmişi","kbs-report-btn")}
      </div>
      {shown==="send"?<KbsSend session={session} kbsType={kbsType}/>:shown==="report"?<KbsReport session={session}/>:<KbsSettings session={session} kbsType={kbsType}/>}
    </div>
  );
}

// KBS Geçmişi raporu: otelin tüm KBS gönderim kayıtları (misafir, işlem, işlemi yapan, KBS yanıtı). Yazdır / PDF ile çıktı alınır.
function KbsReport({session}){
  const day=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const [q,setQ]=useState("");
  const [from,setFrom]=useState(()=>day(new Date(Date.now()-90*86400000)));
  const [to,setTo]=useState(()=>day(new Date()));
  const [data,setData]=useState(null),[err,setErr]=useState(""),[busy,setBusy]=useState(false);
  const load=async()=>{
    setBusy(true); setErr("");
    try{
      const r=await fetch(`${PROXY}/api/kbs/report?from=${from}&to=${to}&q=${encodeURIComponent(q.trim())}`,{cache:"no-store"});
      const d=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(d.error||t("Rapor alınamadı"));
      setData(d);
    }catch(e){ setErr(e.message); setData(null); }
    setBusy(false);
  };
  useEffect(()=>{ load(); },[]);
  const when=v=>{ const d=new Date(v); return isNaN(d)?"":`${fmtDateTR(day(d))} ${hhmm(v)}`; };
  const act={checkin:"Giriş",room:"Oda değişimi",checkout:"Çıkış"};
  const items=data?.items||[];
  const th={padding:"8px 8px",borderBottom:`1.5px solid ${S.border}`,whiteSpace:"nowrap",textAlign:"left",color:S.muted,fontSize:11,textTransform:"uppercase",letterSpacing:".4px"};
  const td={padding:"8px 8px",borderBottom:`1px solid ${S.border}`,verticalAlign:"top",fontSize:13};
  return(
    <div className="card kbs-print" style={{padding:"16px 16px 10px"}}>
      <div className="no-print" style={{fontSize:15,fontWeight:800,color:S.navy,marginBottom:4}}>📄 {t("KBS Geçmişi")}</div>
      <div className="no-print" style={{fontSize:12,color:S.muted,marginBottom:12,lineHeight:1.5}}>{t("Uygulamadan KBS'ye yapılan tüm giriş, çıkış ve oda değişimi kayıtları. Misafir adı, kimlik/pasaport no, oda veya profil no ile arayın. Her görüntüleme Değişiklikler'e kaydedilir.")}</div>
      <div className="no-print" style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end",marginBottom:12}}>
        <input className="inp" style={{flex:"1 1 240px"}} value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&load()} placeholder={t("Ad soyad, kimlik / pasaport no, oda veya profil no")}/>
        <label style={{display:"grid",gap:4,fontSize:11,fontWeight:800,color:S.muted}}>{t("BAŞLANGIÇ")}<input className="inp" type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)} style={{minWidth:150}}/></label>
        <label style={{display:"grid",gap:4,fontSize:11,fontWeight:800,color:S.muted}}>{t("BİTİŞ")}<input className="inp" type="date" value={to} min={from} onChange={e=>setTo(e.target.value)} style={{minWidth:150}}/></label>
        <button className="btn btn-p" disabled={busy} onClick={load} style={{padding:"10px 16px",borderRadius:9,minHeight:42}}>{busy?<Spin/>:t("Ara")}</button>
        <button className="btn" disabled={!items.length} onClick={()=>window.print()} style={{padding:"10px 16px",borderRadius:9,minHeight:42,border:`1.5px solid ${S.border}`,background:"#fff",fontWeight:700}}>🖨 {t("Yazdır / PDF")}</button>
      </div>
      {err&&<div className="no-print" style={{color:S.red,fontSize:13,marginBottom:8}}>{err}</div>}
      {data&&<div style={{fontSize:13,color:S.text,marginBottom:10,lineHeight:1.6}}>
        <b style={{color:S.navy}}>{data.hotelName}{data.hotelCode?` (${data.hotelCode})`:""}</b> · {t("KBS gönderim kayıtları")} · {fmtDateTR(data.from)} – {fmtDateTR(data.to)}{q.trim()?` · "${q.trim()}"`:""} · <b>{items.length}</b> {t("kayıt")}
        <span style={{color:S.muted}}> · {t("Rapor alan")}: {session.fullName||session.username} · {when(new Date())}</span>
        {data.truncated&&<div className="no-print" style={{color:S.orangeDk,fontWeight:700}}>{t("İlk 3000 kayıt gösteriliyor; aralığı daraltın.")}</div>}
      </div>}
      {data&&(items.length===0?<div style={{padding:"18px 0",textAlign:"center",color:S.muted,fontSize:13}}>{t("Kayıt yok")}</div>:(
        <div style={{overflowX:"auto",marginBottom:8}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:980}}>
            <thead><tr>{["Tarih","Ad Soyad","Kimlik / Pasaport No","Oda","İşlem","Sonuç","İşlemi yapan","KBS yanıtı","KBS kayıt no"].map(h=><th key={h} style={th}>{t(h)}</th>)}</tr></thead>
            <tbody>{items.map(x=>(
              <tr key={x.id}>
                <td style={{...td,whiteSpace:"nowrap"}}>{when(x.at)}</td>
                <td style={{...td,fontWeight:700,color:S.navy}}>{x.fullName||"—"}<div style={{fontSize:11,fontWeight:400,color:S.muted,fontFamily:"monospace"}}>#{x.profileId}</div></td>
                <td style={{...td,fontFamily:"monospace"}}>{x.idNo||x.passportNo||"—"}</td>
                <td style={td}>{x.room||"—"}</td>
                <td style={td}>{t(act[x.action]||x.action)}</td>
                <td style={{...td,fontWeight:700,color:x.status==="sent"?"#15803D":S.red}}>{x.status==="sent"?t("Başarılı"):t("Hata")}</td>
                <td style={td}>{x.user||"—"}</td>
                <td style={{...td,color:x.status==="sent"?S.text:S.red}}>{x.message||"—"}</td>
                <td style={{...td,fontFamily:"monospace",fontSize:11}}>{x.kbsId||"—"}</td>
              </tr>))}</tbody>
          </table>
        </div>))}
    </div>
  );
}

function todayLocalIso(){
  const d=new Date(); const p=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

// Kullanıcı logu: bu otelin kullanıcı arayüzündeki işlemleri (kim, ne zaman, ne yaptı). Misafir kişi verisi tutulmaz.
function UserLog(){
  const day=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const [from,setFrom]=useState(()=>day(new Date(Date.now()-6*86400000)));
  const [to,setTo]=useState(()=>day(new Date()));
  const [items,setItems]=useState(null),[err,setErr]=useState(""),[q,setQ]=useState("");
  const load=async()=>{
    setErr(""); setItems(null);
    try{ const r=await fetch(`${PROXY}/api/logs?from=${from}&to=${to}`,{cache:"no-store"}); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||t("Log alınamadı")); setItems(d.items||[]); }
    catch(e){ setErr(e.message); setItems([]); }
  };
  useEffect(()=>{ load(); },[]);
  const when=v=>{ const d=new Date(v); return isNaN(d)?"":`${fmtDateTR(day(d))} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
  const shown=(items||[]).filter(x=>!q.trim()||`${x.user} ${x.action} ${x.detail}`.toLocaleLowerCase("tr-TR").includes(q.trim().toLocaleLowerCase("tr-TR")));
  return(
    <div className="card" style={{padding:"16px 16px 10px"}}>
      <div style={{fontSize:15,fontWeight:800,color:S.navy,marginBottom:4}}>📜 {t("Değişiklikler")}</div>
      <div style={{fontSize:12,color:S.muted,marginBottom:12,lineHeight:1.5}}>{t("Bu oteldeki kullanıcıların işlemleri: giriş/çıkış, OPERA'ya kaydedilen profil ve belgeler, KBS bağlantısı ve gönderimleri. Profil ve belge kayıtlarında değişen alanların eski ve yeni değeri yazılır; bunun dışında misafir adı ve kimlik numarası tutulmaz.")}</div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end",marginBottom:12}}>
        <label style={{display:"grid",gap:4,fontSize:11,fontWeight:800,color:S.muted,letterSpacing:".4px"}}>{t("BAŞLANGIÇ")}<input className="inp" type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)} style={{minWidth:150}}/></label>
        <label style={{display:"grid",gap:4,fontSize:11,fontWeight:800,color:S.muted,letterSpacing:".4px"}}>{t("BİTİŞ")}<input className="inp" type="date" value={to} min={from} onChange={e=>setTo(e.target.value)} style={{minWidth:150}}/></label>
        <button className="btn btn-p" onClick={load} style={{padding:"10px 16px",borderRadius:9,minHeight:42}}>{t("Göster")}</button>
        <input className="inp" style={{flex:"1 1 200px"}} value={q} onChange={e=>setQ(e.target.value)} placeholder={t("Ara… kişi, işlem, profil no")}/>
      </div>
      {err&&<div style={{color:S.red,fontSize:13,marginBottom:8}}>{err}</div>}
      {items===null?<div style={{padding:"18px 0"}}><Spin/></div>:shown.length===0?<div style={{padding:"18px 0",textAlign:"center",color:S.muted,fontSize:13}}>{t("Kayıt yok")}</div>:(
        <div style={{display:"grid",gap:0}}>
          {shown.map(x=>(
            <div key={x.id} style={{display:"grid",gridTemplateColumns:"minmax(120px,150px) minmax(90px,160px) 1fr",gap:"4px 12px",padding:"9px 4px",borderTop:`1px solid ${S.border}`,fontSize:13,alignItems:"baseline"}} className="log-row">
              <span style={{color:S.muted,whiteSpace:"nowrap"}}>{when(x.at)}</span>
              <span style={{fontWeight:700,color:S.navy,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={x.user}>{x.user||"—"}</span>
              <span><b style={{fontWeight:700}}>{t(x.action)}</b>{x.detail?<span style={{color:S.muted}}> · {x.detail}</span>:null}</span>
            </div>
          ))}
          <style>{`@media(max-width:600px){.log-row{grid-template-columns:1fr 1fr!important}.log-row>span:last-child{grid-column:1/-1}}`}</style>
        </div>
      )}
      {items&&items.length>=1000&&<div style={{fontSize:12,color:S.muted,marginTop:8}}>{t("En son 1000 kayıt gösteriliyor; aralığı daraltın.")}</div>}
    </div>
  );
}

function Search({session,onSelect,onEdit,onAddAccompany,onLogout,onConfig,refreshRef,reloadProfileRef}){
  const [tab,setTab]=useState(()=>{ try{ const v=sessionStorage.getItem("sp-tab"); return v==="kbs"||v==="log"?v:"arrivals"; }catch(_){ return "arrivals"; } }),[byType,setByType]=useState("lastName");
  // KBS sekmesi sayfa yenilense de açık kalır; KBS kapalı otelde varsayılana döner
  useEffect(()=>{ try{ sessionStorage.setItem("sp-tab",tab==="kbs"||tab==="log"?tab:""); }catch(_){} },[tab]);
  useEffect(()=>{ if(session && tab==="kbs" && !session.kbsEnabled) setTab("arrivals"); },[session,tab]);
  const [q,setQ]=useState(""),[results,setResults]=useState(null),[busy,setBusy]=useState(false);
  // Dışarıdan tetiklenebilir yenileme
  React.useEffect(()=>{
    if(refreshRef) refreshRef.current=(confNo, mainGuest, newInfo)=>{
      setProfileMap({});
      if(confNo&&mainGuest){
        setBusy(true);
        // Önce client-side olarak anında göster (OPERA gecikmesine gerek yok)
        setResults(prev=>{
          const base = (prev||[]).filter(r=>r.confirmationNo!==confNo);
          // Mevcut confNo'ya ait kayıtları tut
          const existing = (prev||[]).filter(r=>r.confirmationNo===confNo);
          if(newInfo?.newProfileId){
            const newGuest = {
              guestId: newInfo.newProfileId,
              firstName: newInfo.firstName||"",
              lastName: newInfo.lastName||"",
              confirmationNo: confNo,
              reservationId: mainGuest.reservationId,
              checkIn: mainGuest.checkIn,
              checkOut: mainGuest.checkOut,
              roomType: mainGuest.roomType,
              room: mainGuest.room,
              status: mainGuest.status,
              adults: mainGuest.adults,
              children: mainGuest.children,
              isAccompany: true,
              accompanyOf: mainGuest.guestId,
            };
            // Daha önce yoksa ekle
            const alreadyExists = existing.some(g=>g.guestId===newInfo.newProfileId);
            return [...base, ...existing, ...(alreadyExists?[]:[newGuest])];
          }
          return [...base, ...existing];
        });
        setSelected(null);
        // Arkaplanda OPERA'dan tazele
        setTimeout(async()=>{
          try{
            const data=await operaSearch({...session,byType:"confirmationNo",query:confNo,tab});
            const norm=normalizeReservations(data);
            if(norm.length>0) setResults(norm);
            norm.forEach(g=>{
              if(g.guestId&&!g.guestId.startsWith("#")){
                getProfileDetails({hostName:session.hostName,hotelId:session.hotelId,appKey:session.appKey,token:session.token,profileId:g.guestId,firstName:g.firstName,lastName:g.lastName})
                  .then(det=>{if(det)setProfileMap(pm=>({...pm,[g.guestId]:det}));}).catch(()=>{});
              }
            });
          }catch(e){}
          setBusy(false);
        },1500);
      } else {
        setResults(null);setSelected(null);setQ("");
      }
    };
  },[session,tab]);
  const [apiErr,setApiErr]=useState(""),[selected,setSelected]=useState(null);
  const [profileMap,setProfileMap]=useState({}); // profileId -> profile details
  // Kaydedip dönünce seçili profilin bilgilerini OPERA'dan yeniden okur (App çağırır)
  React.useEffect(()=>{
    if(reloadProfileRef) reloadProfileRef.current=async(guestId)=>{
      if(!guestId) return;
      const det=await getProfileDetails({hostName:session.hostName,hotelId:session.hotelId,appKey:session.appKey,token:session.token,profileId:guestId,firstName:"",lastName:""});
      if(det) setProfileMap(pm=>({...pm,[guestId]:det}));
    };
  },[session]);
  // Sekme değişince arama türü (soyad / oda no) korunur
  const reset=nt=>{setResults(null);setQ("");setSelected(null);setApiErr("");setProfileMap({});if(nt){setTab(nt);}};
  const selectGuest=async(g)=>{
    setSelected(g);
    if(!profileMap[g.guestId]){
      const det=await getProfileDetails({hostName:session.hostName,hotelId:session.hotelId,appKey:session.appKey,token:session.token,profileId:g.guestId,firstName:g.firstName,lastName:g.lastName,fresh:true});
      if(det) setProfileMap(pm=>({...pm,[g.guestId]:det}));
    }
  };

  const doSearch=async()=>{
    const normalizedQuery = q.trim();
    // Kimlik okuma ekranları: tüm kayıtlar listelenmez, yalnız aranan gelir (sunucu da aynısını zorunlu kılar)
    if(!normalizedQuery){ setSelected(null); setResults(null); setApiErr(t("Aramak için bir ölçüt girin: soyad, oda no ya da rezervasyon no.")); return; }
    if(byType==="lastName" && normalizedQuery.replace(/[%*\s]/g,"").length<2){ setSelected(null); setResults(null); setApiErr(t("Soyad için en az 2 harf girin.")); return; }
    setBusy(true);setSelected(null);setApiErr("");setResults(null);
    try{
      const list=await operaSearch({
        hostName:session.hostName,
        hotelId:session.hotelId,
        appKey:session.appKey,
        token:session.token,
        byType,
        query:normalizedQuery,
        tab
      });
      setResults(byType==="roomId" ? sortByRoom(list) : list);
    }
    catch(e){setApiErr(e.message);setResults([]);}
    setBusy(false);
  };

  return(
    <div style={{minHeight:"calc(100dvh - 46px)",background:S.bg}}>
      <style>{GS}</style>
      <TopBar session={session} onLogout={onLogout} onConfig={onConfig}/>
      <div className="page-wrap" style={{maxWidth:APP_W,margin:"0 auto",padding:"24px 18px 60px"}}>
        <div className="fadeUp">
          <style>{`@media(max-width:600px){.main-tabs{display:grid!important;grid-template-columns:1fr 1fr}.main-tabs .tab{width:100%;justify-content:center}}`}</style>
          <div className="main-tabs" style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
            <button className={`tab ${tab==="arrivals"?"ton":"toff"}`} onClick={()=>reset("arrivals")}>{t("🛬 Gelenler")}</button>
            <button className={`tab ${tab==="inhouse"?"ton":"toff"}`}  onClick={()=>reset("inhouse")} >{t("🏨 Konaklayanlar")}</button>
            {session?.kbsEnabled&&<button className={`tab ${tab==="kbs"?"ton":"toff"}`} onClick={()=>reset("kbs")}>{t("🛡 KBS")}</button>}
            <button className={`tab ${tab==="log"?"ton":"toff"}`} onClick={()=>reset("log")}>{t("📜 Değişiklikler")}</button>
          </div>
          {tab==="log"?<UserLog/>:tab==="kbs"&&session?.kbsEnabled?<KbsPanel session={session}/>:<>

          <div className="card" style={{marginBottom:14,padding:"18px 18px 16px",border:`1px solid ${S.border}`,background:"linear-gradient(180deg,#FFFFFF 0%, #F9FBFF 100%)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap",marginBottom:12}}>
              <div>
                <div style={{fontSize:11,fontWeight:800,color:S.muted,letterSpacing:".5px"}}>{t("ARAMA KONSOLU")}</div>
                <div style={{marginTop:4,fontSize:15,fontWeight:800,color:S.navy}}>{t("Rezervasyon ve profil tarama ekranı")}</div>
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:13}}>
              {[["lastName",t("🔤 Soyada Göre")],["roomId",t("🛏 Oda No'ya Göre")]].map(([v,l])=>(
                <button key={v} onClick={()=>{setByType(v);reset();}} style={{flex:1,padding:"9px 6px",borderRadius:9,border:`1.5px solid ${byType===v?S.blue:S.border}`,background:byType===v?"#EEF5FF":"#fff",color:byType===v?S.blue:S.muted,fontSize:13,fontWeight:700,cursor:"pointer",transition:"all .18s"}}>{l}</button>
              ))}
            </div>
            <div style={{display:"flex",gap:10,marginBottom:10}}>
              <div style={{flex:1,position:"relative"}}>
                <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:16,color:S.muted}}>🔍</span>
                <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doSearch()}
                  placeholder={byType==="roomId"?t("Oda numarası girin"):t("Soyad girin")} className="inp" style={{paddingLeft:40}}/>
              </div>
              <button className="btn btn-p" onClick={doSearch} style={{padding:"11px 22px",flexShrink:0,borderRadius:9}}>{busy?<Spin/>:t("Ara")}</button>
            </div>

          </div>

          {apiErr&&(
            <div className="fadeIn" style={{background:"#FEF2F2",border:"1.5px solid #FECACA",borderRadius:10,padding:"14px 16px",marginBottom:14}}>
              <div style={{fontWeight:800,color:S.red,fontSize:13,marginBottom:6}}>{t("⚠ API Hatası")}</div>
              <pre style={{fontFamily:"monospace",fontSize:11,color:"#B91C1C",wordBreak:"break-word",whiteSpace:"pre-wrap",margin:0}}>{apiErr}</pre>
            </div>
          )}

          {results!==null&&(
            <div className="fadeUp">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:11}}>
                <span style={{fontSize:13,fontWeight:700,color:S.muted}}>{results.length===0?t("Sonuç bulunamadı"):results.length+" "+t("rezervasyon bulundu")}</span>
                <span style={{fontSize:11,fontWeight:800,color:S.muted,background:"#fff",border:`1px solid ${S.border}`,padding:"5px 10px",borderRadius:999}}>{tab==="arrivals"?t("GELENLER"):t("KONAKLAYANLAR")}</span>
              </div>
              {results.length===0&&!apiErr&&(
                <div className="card" style={{textAlign:"center",padding:"44px 20px",border:`1px solid ${S.border}`,background:"linear-gradient(180deg,#FFFFFF 0%, #F9FBFF 100%)"}}>
                  <div style={{fontSize:38,marginBottom:10}}>🔍</div>
                  <p style={{color:S.navy,fontSize:16,fontWeight:800}}>"{q}{t("\" için rezervasyon bulunamadı")}</p>
                  <p style={{color:S.muted,fontSize:12,marginTop:8}}>{t("Farklı yazım deneyin veya Gelenler ↔ Konaklayanlar arasında geçiş yapın")}</p>
                </div>
              )}
              <div style={{display:"flex",flexDirection:"column",gap:9}}>
                {results.map((g,i)=>{
                  const sel=selected?.confirmationNo===g.confirmationNo&&selected?.guestId===g.guestId;
                  const sc=g.status==="CheckedIn"?S.green:g.status==="Reserved"?S.blue:S.orange;
                  return(
                    <div key={i} className={`guest-row${sel?" sel":""}`} onClick={()=>selectGuest(g)} style={g.isAccompany?{marginLeft:20,borderLeft:`3px solid #C4B5FD`,borderRadius:"0 10px 10px 0"}:{}}>
                      <Avt f={g.firstName} l={g.lastName} idx={i} sz={46} room={g.room||""}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                          {g.isAccompany&&<span style={{fontSize:10,background:"#F3E8FF",color:"#7C3AED",border:"1px solid #C4B5FD",padding:"2px 7px",borderRadius:8,fontWeight:700}}>{t("👥 Beraberindeki")}</span>}
                          <span style={{fontSize:15,fontWeight:800,color:S.navy}}>{g.firstName} {g.lastName}</span>
                          {sel&&<span style={{fontSize:10,background:`linear-gradient(135deg,${S.blue},${S.navy})`,color:"#fff",padding:"2px 8px",borderRadius:9,fontWeight:800}}>{t("SEÇİLDİ")}</span>}
                          {g.status&&<span style={{fontSize:10,background:sc+"18",color:sc,border:`1px solid ${sc}30`,padding:"2px 8px",borderRadius:9,fontWeight:700}}>{statusText(g.status)}</span>}
                        </div>
                        <div style={{fontSize:12,color:S.muted,marginTop:3,display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                          <span>📋 {g.confirmationNo}</span>
                          {g.roomType&&<span>🛏 {g.roomType}</span>}
                          <span style={{color:S.muted,fontSize:11,background:"#F0F4F8",padding:"1px 7px",borderRadius:5,fontFamily:"monospace"}}>#{g.guestId}</span>
                        </div>
                        <div style={{fontSize:12,color:S.muted,marginTop:3,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                          {g.adults>0&&<span style={{display:"inline-flex",alignItems:"center",gap:3,fontWeight:600}}>
                            {/* Yetişkin — büyük insan ikonu */}
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={S.navy} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="6" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                            <span style={{color:S.navy,fontSize:13}}>{g.adults}</span>
                          </span>}
                          {g.children>0&&<span style={{display:"inline-flex",alignItems:"center",gap:3,fontWeight:600}}>
                            {/* Çocuk — küçük insan ikonu, turuncu */}
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={S.orange} strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="6" r="3.2"/><path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg>
                            <span style={{color:S.orange,fontSize:12}}>{g.children}</span>

                          </span>}
                        </div>
                        {(g.checkIn!=="—"||g.checkOut!=="—")&&<div style={{fontSize:12,color:S.muted,marginTop:2}}>
                          {g.checkIn!=="—"&&(t("Giriş tarihi")+": "+fmtDateTR(g.checkIn))}{g.checkIn!=="—"&&g.checkOut!=="—"&&" · "}{g.checkOut!=="—"&&(t("Çıkış tarihi")+": "+fmtDateTR(g.checkOut))}
                        </div>}
                        {/* Eylemler kendi satırında (dokunmaya uygun büyüklükte): Belge Tara birinci seçenek, ardından Düzenle ve Beraberindeki Ekle */}
                        {sel&&(()=>{
                          const curIds=(results||[]).filter(r=>r.confirmationNo===g.confirmationNo&&r.isAccompany&&r.guestId).map(r=>r.guestId);
                          const total=1+curIds.length;
                          const max=(g.adults||0)+(g.children||0);
                          const canAddMore=!g.isAccompany&&(max===0||total<max);
                          return(
                            <div className="row-actions">
                              <button className="btn btn-p btn-scan" onClick={e=>{e.stopPropagation();onSelect(g,profileMap[g.guestId]);}}>{t("📷 Belge Tara")}</button>
                              <button className="btn btn-edit" disabled={!profileMap[g.guestId]} title={profileMap[g.guestId]?"":t("Profil bilgileri yükleniyor")} onClick={e=>{e.stopPropagation();onEdit(g,profileMap[g.guestId]);}}>{t("✏️ Düzenle")}</button>
                              {canAddMore&&<button className="btn btn-acc" onClick={e=>{e.stopPropagation();onAddAccompany({...g,accompanyProfileIds:curIds});}}>{t("👥 Beraberindeki Ekle")}</button>}
                            </div>
                          );
                        })()}
                        {/* Profile detayları — seçilince yüklenir */}
                        {sel&&profileMap[g.guestId]&&<ProfileInfoLine pd={profileMap[g.guestId]}/>}
                      </div>
                      <div style={{color:sel?S.blue:S.border,fontSize:22}}>›</div>
                    </div>
                  );
                })}
              </div>

            </div>
          )}
          </>}
        </div>
      </div>
    </div>
  );
}

/* ── MRZ PARSER ───────────────────────────────────────────────────────────── */
const MRZ_WEIGHTS = [7,3,1];
const MRZ_DIGIT_FIX = { O:"0", D:"0", Q:"0", U:"0", I:"1", L:"1", Z:"2", S:"5", G:"6", B:"8" };
const MRZ_ALPHA_FIX = { "0":"O", "1":"I", "2":"Z", "5":"S", "6":"G", "8":"B" };

function mrzValidDate(s){
  if(!s || s.length !== 6 || !/^[0-9]{6}$/.test(s)) return false;
  const mm = parseInt(s.slice(2,4),10);
  const dd = parseInt(s.slice(4,6),10);
  if(mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
  const maxDays = [0,31,29,31,30,31,30,31,31,30,31,30,31];
  return dd <= maxDays[mm];
}

function mrzDateToIso(yymmdd, isBirth){
  if(!mrzValidDate(yymmdd)) return "";
  const yy = parseInt(yymmdd.slice(0,2),10);
  const mm = yymmdd.slice(2,4);
  const dd = yymmdd.slice(4,6);
  const cutoff = new Date().getFullYear() - 2000;
  // Bitiş tarihleri her zaman 20xx (SnapPass MrzParser ile aynı kural)
  const yyyy = isBirth ? (yy > cutoff ? 1900 + yy : 2000 + yy) : 2000 + yy;
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeCountryCode(value){
  const code = String(value || "").replace(/</g,"").trim().toUpperCase();
  if(!code) return "";
  if(code === "TUR") return "TR";
  return code;
}

// Ekrandaki tüm tarihler GG.AA.YYYY gösterilir; OPERA'ya giden değerler ISO (YYYY-AA-GG) kalır
function fmtDateTR(value){
  const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(value||""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (value||"");
}

// Uyruk iki harfli ISO koduyla tutulur (MRZ'den gelen TUR/FRA/D gibi kodlar çevrilir); liste public/iso-countries.js
function toIso2(value){
  return window.IsoCountries ? window.IsoCountries.toIso2(value) : normalizeCountryCode(value);
}

// Uyruk TR ise yalnız belge tipi (T.C. vatandaşı = TCKN) ve belge numarası zorunludur; diğer uyruklarda tüm kişisel alanlar zorunlu.
// Belge tipi seçeneği TR iken tek seçenektir: TCKN (T.C. vatandaşı)
function turkishIdTypeOpts(){
  return [{ v:"TCKN", l:t("TCKN · T.C. vatandaşı") }];
}
// Uyruk değişince belge tipini uyruğa uydurur. TR → TCKN; belge numarası geçerli bir T.C. kimlik numarası değilse (ör. pasaport no)
// yanlış tiple gitmesin diye temizlenir (taramadaki kişisel numara geçerli TCKN ise o kullanılır). TR dışı → TCKN ise PASAPORT.
function applyNationalityRules(f, nat, scanIdNumber){
  const next={ ...f, nationality: nat };
  if(nat==="TR"){
    if(next.documentType!=="TCKN"){
      next.documentType="TCKN";
      const candidates=[next.documentNumber, scanIdNumber].map(v=>String(v||"").replace(/\D/g,""));
      next.documentNumber = candidates.find(isValidTurkishIdentityNumber) || "";
    }
  }else if(next.documentType==="TCKN"){
    next.documentType="PASSPORT";
    if(isValidTurkishIdentityNumber(next.documentNumber)) next.documentNumber="";
  }
  return next;
}

function normalizeDocType(value){
  const raw = String(value || "").trim().toUpperCase();
  if(!raw) return "";
  if(["NATIONAL_ID","ID_CARD","IDENTITY_CARD","TCKN"].includes(raw)) return "TCKN";
  if(raw === "PASSPORT") return "PASSPORT";
  return raw;
}

function pickFieldValue(...values){
  for(const value of values){
    if(typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeBirthPlace(value, fallbackCountry=""){
  const text = String(value || "").trim();
  if(!text) return "";
  const upper = text.toUpperCase();
  const country = String(fallbackCountry || "").trim().toUpperCase();
  if(["TR","TUR"].includes(upper)) return "";
  if(country && upper === country) return "";
  return text;
}

function isValidTurkishIdentityNumber(value){
  const digits = String(value || "").replace(/\D/g,"");
  if(!/^[1-9][0-9]{10}$/.test(digits)) return false;
  const nums = digits.split("").map(Number);
  const odd = nums[0] + nums[2] + nums[4] + nums[6] + nums[8];
  const even = nums[1] + nums[3] + nums[5] + nums[7];
  const digit10 = ((odd * 7) - even) % 10;
  const digit11 = nums.slice(0,10).reduce((a,b)=>a+b,0) % 10;
  return digit10 === nums[9] && digit11 === nums[10];
}

function mrzChecksum(input){
  let total = 0;
  for(let i=0;i<input.length;i++){
    const ch = input[i];
    let val = 0;
    if(ch >= "0" && ch <= "9") val = ch.charCodeAt(0) - 48;
    else if(ch >= "A" && ch <= "Z") val = ch.charCodeAt(0) - 55;
    else if(ch === "<") val = 0;
    else return null;
    total += val * MRZ_WEIGHTS[i % MRZ_WEIGHTS.length];
  }
  return String(total % 10);
}

function fixMrzDigits(s){
  return s.replace(/[A-Z]/g, ch => MRZ_DIGIT_FIX[ch] || ch);
}

function fixMrzAlpha(s){
  return s.replace(/[0-9]/g, ch => MRZ_ALPHA_FIX[ch] || ch);
}

function normalizeMrzText(text){
  const cleaned = text
    .split(/\r?\n/)
    .map(l=>{
      let line = l.toUpperCase();
      // Yaygın OCR yanlış okumaları düzelt
      line = line.replace(/[|]/g, "I");    // | → I
      line = line.replace(/[!]/g, "1");    // ! → 1
      line = line.replace(/[{(]/g, "<");   // ( veya { → <
      line = line.replace(/[})]/g, ">");   // > olarak bırak
      line = line.replace(/[$]/g, "S");    // $ → S
      line = line.replace(/[@]/g, "O");    // @ → O
      line = line.replace(/[#]/g, "H");    // # → H
      // Boşlukları kaldır
      line = line.replace(/\s+/g, "");
      // Sadece MRZ karakterleri tut
      line = line.replace(/[^A-Z0-9<]/g,"");
      return line.trim();
    })
    .filter(Boolean);

  const combined = [...cleaned];
  for(let i=0;i<cleaned.length-1;i++){
    const joined = cleaned[i] + cleaned[i+1];
    if(joined.length >= 30 && joined.length <= 48) combined.push(joined);
  }
  const chunked = [...combined];
  const tryChunk = (line, size, minPartLength = size - 4) => {
    if(line.length < size * 2) return;
    const parts = [];
    for(let i=0;i<line.length;i+=size){
      const part = line.slice(i,i+size);
      if(part.length >= minPartLength) parts.push(part);
    }
    if(parts.length >= 2) chunked.push(...parts);
  };
  combined.forEach(line=>{
    tryChunk(line, 30);
    tryChunk(line, 44);
  });
  // Çok fazla aday satır gürültü yaratır — en iyi 40 adayla sınırla
  const unique = Array.from(new Set(chunked)).filter(l=>l.length >= 18);
  // MRZ karakteristiklerine göre sırala: < içerenler ve 28-44 uzunluktakiler önce
  unique.sort((a,b)=>{
    const sa = (a.includes("<<") ? 100 : 0) + (a.includes("<") ? 50 : 0) + (a.length >= 28 && a.length <= 44 ? 30 : 0);
    const sb = (b.includes("<<") ? 100 : 0) + (b.includes("<") ? 50 : 0) + (b.length >= 28 && b.length <= 44 ? 30 : 0);
    return sb - sa;
  });
  return unique.slice(0, 40);
}

function pickMrzField(rawField, checkDigit, transforms){
  const candidates = Array.from(new Set(transforms.map(fn=>fn(rawField))));
  if(/^[0-9]$/.test(checkDigit)){
    const match = candidates.find(candidate => mrzChecksum(candidate) === checkDigit);
    if(match) return match;
  }
  return candidates[0];
}

function parseTD1Triplet(line1Raw, line2Raw, line3Raw){
  const line1Base = line1Raw.padEnd(30,"<").slice(0,30);
  const line2Base = line2Raw.padEnd(30,"<").slice(0,30);
  const line3 = fixMrzAlpha(line3Raw).padEnd(30,"<").slice(0,30);

  let score = 0;
  if(/^[ACI]/.test(line1Base)) score += 16;
  if(line1Base.includes("TUR")) score += 14;
  if(line3.includes("<<")) score += 14;
  if(/^[A-Z0-9<]{30}$/.test(line1Base)) score += 6;
  if(/^[A-Z0-9<]{30}$/.test(line2Base)) score += 6;
  if(/^[A-Z<]{24,30}$/.test(line3)) score += 8;

  const issuingCountry = fixMrzAlpha(line1Base.slice(2,5)).replace(/</g,"");
  const documentCheck = fixMrzDigits(line1Base[14] || "<");
  const documentField = pickMrzField(line1Base.slice(5,14), documentCheck, [
    s=>s,
    s=>fixMrzAlpha(s),
    s=>fixMrzDigits(s),
  ]);
  const optional1 = line1Base.slice(15,30);
  const optional1Fixed = fixMrzDigits(optional1);
  const optional1Digits = (optional1Fixed.match(/\d{11}/) || [])[0] || "";

  const birth = fixMrzDigits(line2Base.slice(0,6));
  const birthCheck = fixMrzDigits(line2Base[6] || "<");
  const sexRaw = (line2Base[7] || "<").replace(/[^MF<]/g,"<");
  const expiry = fixMrzDigits(line2Base.slice(8,14));
  const expiryCheck = fixMrzDigits(line2Base[14] || "<");
  const nationalityField = fixMrzAlpha(line2Base.slice(15,18));
  const nationality = nationalityField.replace(/</g,"");
  const optional2 = line2Base.slice(18,29);
  const finalCheck = fixMrzDigits(line2Base[29] || "<");

  const [lastRaw="", firstRaw=""] = line3.split("<<");
  const lastName = lastRaw.replace(/<+/g," ").trim();
  const nameParts = firstRaw.replace(/<+/g," ").trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || "";
  const middleName = nameParts.slice(1).join(" ");
  const isTurkishId = [issuingCountry, nationalityField].includes("TUR") || line1Base.includes("TUR") || line2Base.includes("TUR");
  const documentNumber = (isTurkishId && optional1Digits) ? optional1Digits : documentField.replace(/</g,"");

  if(isTurkishId){
    if(!optional1Digits || optional1Digits.length !== 11) return null;
    if(!isValidTurkishIdentityNumber(optional1Digits)) return null;
    if(!mrzValidDate(birth)) return null;
    if(!line2Base.includes("TUR")) return null;
    if(!lastName || lastName.length < 2) return null;
    if(!firstName || firstName.length < 2) return null;
    if(!line3.includes("<<")) return null;
  }

  if(documentNumber.length >= 4) score += 10;
  if(lastName) score += 10;
  if(firstName) score += 8;
  if(/^[A-Z]{3}$/.test(nationality || issuingCountry)) score += 6;
  if(mrzValidDate(birth)) score += 18;
  if(mrzValidDate(expiry)) score += 14;
  if(["M","F","<"].includes(sexRaw)) score += 4;
  if(line2Base.includes("TUR")) score += 6;
  if(optional1Digits) score += 16;
  if(isTurkishId) score += 12;

  const checks = [
    [documentField, documentCheck],
    [birth, birthCheck],
    [expiry, expiryCheck],
    [documentField + documentCheck + optional1 + birth + birthCheck + expiry + expiryCheck + optional2, finalCheck],
  ];
  for(const [value, digit] of checks){
    if(/^[0-9]$/.test(digit) && mrzChecksum(value) === digit) score += 10;
  }

  if(score < (isTurkishId ? 68 : 46)) return null;
  return {
    score,
    firstName,
    middleName,
    lastName,
    nationality: normalizeCountryCode(nationality || issuingCountry || "TUR"),
    dateOfBirth: mrzDateToIso(birth, true),
    expiryDate: mrzDateToIso(expiry, false),
    documentNumber,
    documentType: isTurkishId ? "TCKN" : "NATIONAL_ID",
    issuingCountry: normalizeCountryCode(issuingCountry || nationality || "TUR"),
    gender: sexRaw === "<" ? "U" : sexRaw,
    mrzRaw: [line1Raw, line2Raw, line3Raw],
  };
}

function parseTD3Pair(topRaw, bottomRaw){
  const top = fixMrzAlpha(topRaw).padEnd(44,"<").slice(0,44);
  const bottomBase = bottomRaw.padEnd(44,"<").slice(0,44);

  let score = 0;
  if(/^[PVIAC]/.test(top)) score += 18;
  if(top.includes("<<")) score += 12;
  if(/^[A-Z<]{30,44}$/.test(top)) score += 8;
  if(/^[A-Z0-9<]{30,44}$/.test(bottomBase)) score += 6;

  const issuingCountry = fixMrzAlpha(top.slice(2,5)).replace(/</g,"");
  // TD3 top line must start with P, V, I, A, or C — reject if first char is a name letter
  if(!/^[PVIAC]/.test(top)) return null;
  // The << separator must appear after position 5 (after type+country)
  const dblChevIdx = top.indexOf("<<");
  if(dblChevIdx < 5) return null;
  const namesField = top.slice(5);
  const [lastRaw="", firstRaw=""] = namesField.split("<<");
  const lastName = lastRaw.replace(/<+/g," ").trim();
  const nameParts = firstRaw.replace(/<+/g," ").trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || "";
  const middleName = nameParts.slice(1).join(" ");

  if(lastName) score += 10;
  if(firstName) score += 8;

  const documentCheck = fixMrzDigits(bottomBase[9] || "<");
  const documentField = pickMrzField(bottomBase.slice(0,9), documentCheck, [
    s=>s,
    s=>fixMrzDigits(s),
    s=>fixMrzAlpha(s),
  ]);
  const documentNumber = documentField.replace(/</g,"");
  const nationalityField = fixMrzAlpha(bottomBase.slice(10,13));
  const nationality = nationalityField.replace(/</g,"");
  const birth = fixMrzDigits(bottomBase.slice(13,19));
  const birthCheck = fixMrzDigits(bottomBase[19] || "<");
  const sexRaw = (bottomBase[20] || "<").replace(/[^MF<]/g,"<");
  const expiry = fixMrzDigits(bottomBase.slice(21,27));
  const expiryCheck = fixMrzDigits(bottomBase[27] || "<");
  const optionalData = bottomBase.slice(28,42);
  const finalCheck = fixMrzDigits(bottomBase[43] || "<");

  if(documentNumber.length >= 6) score += 10;
  if(/^[A-Z]{3}$/.test(nationality)) score += 6;
  if(mrzValidDate(birth)) score += 18;
  if(mrzValidDate(expiry)) score += 14;
  if(["M","F","<"].includes(sexRaw)) score += 4;

  const checks = [
    [documentField, documentCheck],
    [birth, birthCheck],
    [expiry, expiryCheck],
    [documentField + documentCheck + nationalityField + birth + birthCheck + sexRaw + expiry + expiryCheck + optionalData, finalCheck],
  ];
  for(const [value, digit] of checks){
    if(/^[0-9]$/.test(digit) && mrzChecksum(value) === digit) score += 10;
  }

  if(score < 60) return null;
  return {
    score,
    firstName,
    middleName,
    lastName,
    nationality: nationality || issuingCountry || "TUR",
    dateOfBirth: mrzDateToIso(birth, true),
    expiryDate: mrzDateToIso(expiry, false),
    documentNumber,
    documentType: "PASSPORT",
    issuingCountry: issuingCountry || nationality || "TUR",
    gender: sexRaw === "<" ? "U" : sexRaw,
    mrzRaw: [topRaw, bottomRaw],
  };
}

function parseMRZLegacy(lines){
  try{
    const raw = lines.map(l=>l.replace(/[^A-Z0-9<]/g,"").toUpperCase());
    const countDates = l => {
      const fixed = fixMrzDigits(l);
      let n = 0;
      for(let i=0;i<=fixed.length-6;i++) if(mrzValidDate(fixed.slice(i,i+6))) n++;
      return n;
    };
    const nameScore = l => {
      if(l.length < 10) return -99;
      if(countDates(l) >= 2) return -99;
      const a = (l.match(/[A-Z]/g) || []).length;
      const d = (l.match(/[0-9]/g) || []).length;
      if(a / l.length < 0.6) return -99;
      return a - d * 3 + (l.includes("<<") ? 20 : 0);
    };

    const dataLine = raw.filter(l=>countDates(l)>=2).sort((a,b)=>b.length-a.length)[0]
      || raw.filter(l=>countDates(l)>=1).sort((a,b)=>b.length-a.length)[0]
      || "";

    const nameLine = raw
      .filter(l=>l!==dataLine)
      .map(l=>({l,s:nameScore(l)}))
      .filter(x=>x.s>-99)
      .sort((a,b)=>b.s-a.s)[0]?.l || "";

    let firstName="",lastName="",middleName="",country="";
    if(nameLine){
      let sepIdx=nameLine.indexOf("<<"),sepLen=2;
      if(sepIdx<0){ sepIdx=nameLine.indexOf("<"); sepLen=1; }
      if(sepIdx>=0){
        let lnRaw=nameLine.slice(0,sepIdx);
        lnRaw=lnRaw.replace(/^[A-Z0-9]{1,2}(?=[A-Z]{4,})/,"").replace(/[^A-Z]/g,"");
        lastName=lnRaw;
        const fnRaw=nameLine.slice(sepIdx+sepLen);
        const fnWords=fnRaw.split(/[<0-9]+/).filter(w=>w.length>=2&&/^[A-Z]+$/.test(w));
        firstName=fnWords[0]||"";
        middleName=fnWords.slice(1,3).join(" ");
        const cm=nameLine.match(/[A-Z]<([A-Z]{3})/);
        if(cm) country=cm[1];
      }
    }

    let dob="",exp="",sex="U",docNum="";
    if(dataLine){
      const dl=fixMrzDigits(dataLine);
      let dobIdx=-1;
      for(let i=0;i<=dl.length-6;i++){
        if(mrzValidDate(dl.slice(i,i+6))){ dobIdx=i; break; }
      }
      if(dobIdx>=0){
        dob=dl.slice(dobIdx,dobIdx+6);
        const sc=dl[dobIdx+7]||"";
        sex=sc==="M"?"M":sc==="F"?"F":"U";
        for(let i=dobIdx+8;i<=dl.length-6;i++){
          if(mrzValidDate(dl.slice(i,i+6))){ exp=dl.slice(i,i+6); break; }
        }
        if(dobIdx>=10) docNum=dl.slice(Math.max(0,dobIdx-13),dobIdx-4).replace(/[^A-Z0-9]/g,"");
        if(!country && dl.includes("TUR")) country="TUR";
      }
    }

    if(!dob && !lastName) return null;
    // Sanity check: firstName zorunlu, sadece garbage lastName ile devam etme
    if(!firstName || firstName.length < 2) return null;
    if(!lastName || lastName.length < 2) return null;
    // Tek kelime 18+ karakter isim büyük ihtimalle OCR gürültüsü (ör: "SSTCICISLERTBAKAMLITTV")
    if(lastName.length > 18 && !lastName.includes(" ")) return null;
    if(firstName.length > 18 && !firstName.includes(" ")) return null;
    // nameLine'da << ayırıcı yoksa güvenilmez
    if(!nameLine.includes("<<")) return null;
    return {
      firstName, middleName, lastName,
      nationality:country||"TUR",
      dateOfBirth:mrzDateToIso(dob,true),
      expiryDate:mrzDateToIso(exp,false),
      documentNumber:docNum,
      documentType:"PASSPORT",
      issuingCountry:country||"TUR",
      gender:sex,
      mrzRaw:lines
    };
  }catch(e){ console.warn("MRZ legacy parse error:",e); }
  return null;
}

function parseTurkishIdLoose(lines){
  try{
    const raw = Array.from(new Set(lines.map(l=>l.replace(/[^A-Z0-9<]/g,"").toUpperCase()).filter(Boolean)));
    if(raw.length < 2) return null;

    const candidates30 = raw.filter(l=>l.length >= 24).map(l=>l.padEnd(30,"<").slice(0,30));
    const line1 = candidates30.find(l=>l.startsWith("I<TUR") || l.includes("TUR"));
    const line2 = candidates30.find(l=>{
      // fixMrzDigits sadece rakam bölümlerine uygula — TUR gibi harf alanlarını bozmasın (U→0 yapıyor)
      const datePart = fixMrzDigits(l.slice(0,15));
      const natPart = l.slice(15,18).replace(/[0-9]/g, ch => MRZ_ALPHA_FIX[ch] || ch).replace(/</g,"");
      return /^\d{6}\d[MFX<]\d{6}\d$/.test(datePart) && /^[A-Z]{2,3}$/.test(natPart);
    });
    const line3 = candidates30.find(l=>l.includes("<<") && /[A-Z<]{10,}/.test(fixMrzAlpha(l)));

    if(!line2 || !line3) return null;

    const fixedLine1 = line1 || "";
    const fixedLine2digits = fixMrzDigits(line2);  // rakam alanları için
    const fixedLine2alpha = fixMrzAlpha(line2);     // harf alanları için (TUR korunur)
    const fixedLine3 = fixMrzAlpha(line3);

    const tckn = ((fixMrzDigits(fixedLine1).match(/\d{11}/) || [])[0] || "").trim();
    const birth = fixedLine2digits.slice(0,6);
    const sexRaw = (line2[7] || "<").replace(/[^MF<]/g,"<");
    const expiry = fixedLine2digits.slice(8,14);
    const nationality = normalizeCountryCode(fixedLine2alpha.slice(15,18).replace(/</g,""));

    const [lastRaw="", restRaw=""] = fixedLine3.split("<<");
    const lastName = lastRaw.replace(/<+/g," ").trim();
    const nameParts = restRaw.replace(/<+/g," ").trim().split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || "";
    const middleName = nameParts.slice(1).join(" ");

    if(!tckn || !isValidTurkishIdentityNumber(tckn) || !mrzValidDate(birth) || !lastName || !firstName) return null;

    return {
      score: 999,
      firstName,
      middleName,
      lastName,
      nationality: nationality || "TR",
      dateOfBirth: mrzDateToIso(birth, true),
      expiryDate: mrzValidDate(expiry) ? mrzDateToIso(expiry, false) : "",
      documentNumber: tckn,
      documentType: "TCKN",
      issuingCountry: "TR",
      gender: sexRaw === "<" ? "U" : sexRaw,
      mrzRaw: [fixedLine1, fixedLine2, fixedLine3],
    };
  }catch(e){
    console.warn("Turkish ID loose parse error:", e);
  }
  return null;
}

function parseTurkishIdPartial(rawLines){
  // Fallback: extract name, DOB, gender from TD1 lines even when TCKN is unreadable
  try{
    // Daha düşük eşik — template matching kısa satırlar döndürebilir
    const candidates = rawLines.filter(l=>l.length >= 16);

    // Find name line (has << and mostly letters)
    const nameLine = candidates.find(l=>l.includes("<<") && (fixMrzAlpha(l).match(/[A-Z]/g)||[]).length >= 8);
    if(!nameLine) return null;

    // Find data line — TÜM satırlarda geçerli tarih ara (uzunluk kısıtlaması yok)
    let dataLine = null;
    for(const l of candidates){
      if(l === nameLine) continue;
      const fixed = fixMrzDigits(l);
      // Satır içinde herhangi bir yerde 6 basamaklı geçerli tarih ara
      for(let pos=0; pos<=fixed.length-6; pos++){
        if(mrzValidDate(fixed.slice(pos,pos+6))){
          dataLine = l;
          break;
        }
      }
      if(dataLine) break;
    }

    const fixedName = fixMrzAlpha(nameLine);
    const [lastRaw="", restRaw=""] = fixedName.split("<<");
    const lastName = lastRaw.replace(/<+/g," ").trim();
    const nameParts = restRaw.replace(/<+/g," ").trim().split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || "";
    const middleName = nameParts.slice(1).join(" ");

    if(!firstName || firstName.length < 2 || !lastName || lastName.length < 2) return null;
    if(lastName.length > 18 && !lastName.includes(" ")) return null;

    let dob = "", gender = "U", expiry = "", nationality = "TR";
    if(dataLine){
      const dl = fixMrzDigits(dataLine);
      // İlk 6 basamak tarih olmayabilir — doğru pozisyonu bul
      // TD1 line2 formatı: YYMMDD[check]S[YYMMDD][check][NAT]...
      if(dl.length >= 6 && mrzValidDate(dl.slice(0,6))){
        dob = dl.slice(0,6);
      } else {
        // Satır boyunca tarih ara
        for(let pos=0; pos<=dl.length-6; pos++){
          if(mrzValidDate(dl.slice(pos,pos+6))){ dob = dl.slice(pos,pos+6); break; }
        }
      }
      // Gender: DOB'dan sonra check digit + sex char
      if(dob && dl.length >= 8){
        const dobIdx = dl.indexOf(dob);
        const sexPos = dobIdx + 7; // DOB(6) + check(1) = sex position
        const sexChar = (dataLine[sexPos] || "").replace(/[^MF]/g,"");
        if(sexChar) gender = sexChar;
        // Expiry: sex'ten sonra
        if(dl.length >= sexPos + 7){
          const expCandidate = dl.slice(sexPos+1, sexPos+7);
          if(mrzValidDate(expCandidate)) expiry = expCandidate;
        }
      }
      // Nationality: pozisyon 15-18 veya TUR içeren kısım
      const natField = fixMrzAlpha(dataLine.slice(15,18)).replace(/</g,"");
      if(/^[A-Z]{2,3}$/.test(natField)) nationality = normalizeCountryCode(natField);
      else if(dataLine.includes("TUR")) nationality = "TR";
    }

    // Find TCKN in any line (11-digit valid Turkish ID) — fixMrzDigits uygulayarak da ara
    let tckn = "";
    for(const l of rawLines){
      // Önce ham satırda ara
      const match = l.match(/\d{11}/);
      if(match && isValidTurkishIdentityNumber(match[0])){ tckn = match[0]; break; }
      // fixMrzDigits ile de dene (D→0, O→0 gibi düzeltmeler)
      const fixed = fixMrzDigits(l);
      const matchFixed = fixed.match(/\d{11}/);
      if(matchFixed && isValidTurkishIdentityNumber(matchFixed[0])){ tckn = matchFixed[0]; break; }
    }

    return {
      firstName,
      middleName,
      lastName,
      nationality,
      dateOfBirth: dob ? mrzDateToIso(dob, true) : "",
      expiryDate: expiry ? mrzDateToIso(expiry, false) : "",
      documentNumber: tckn,
      documentType: tckn ? "TCKN" : "NATIONAL_ID",
      issuingCountry: "TR",
      gender,
      mrzRaw: rawLines.slice(0,5),
    };
  }catch(e){ console.warn("Turkish ID partial parse error:", e); }
  return null;
}

// Bir sonucun MRZ satırlarında SnapPass kurallarıyla kaç kontrol hanesi tuttuğu.
// Satırlar en yakın TD uzunluğuna (30/36/44) "<" ile tamamlanır.
function countMrzChecks(mrzRaw){
  try{
    if(!window.SnapPassMrz || !Array.isArray(mrzRaw)) return 0;
    const lines = mrzRaw.map(l=>String(l || "").toUpperCase().replace(/[^A-Z0-9<]/g,"")).filter(Boolean);
    const maxLen = Math.max(0, ...lines.map(l=>l.length));
    const target = [30,36,44].find(n=>n >= maxLen) || maxLen;
    const parsed = window.SnapPassMrz.parse(lines.map(l=>l.padEnd(target,"<")).join("\n"));
    return parsed.success ? window.SnapPassMrz.countValidChecks(parsed) : 0;
  }catch(e){ return 0; }
}

// SnapPass.Service MrzParser'ın JS portu (public/mrz-parser.js).
// Yalnızca en az 2 kontrol hanesi tutan ve soyadı olan sonuçlar kabul edilir.
function parseMRZSnapPass(lines){
  try{
    if(!window.SnapPassMrz) return null;
    const parsed = window.SnapPassMrz.parse(lines.join("\n"));
    const checks = parsed.success ? window.SnapPassMrz.countValidChecks(parsed) : 0;
    if(checks < 2) return null;
    const r = window.SnapPassMrz.toMrzResult(parsed);
    if(!r.lastName) return null;
    const tckn = (r.idNumber.match(/\d{11}/) || [])[0] || "";
    // Türk pasaportunda da kişisel numara TCKN'dir; TCKN belge tipi yalnız kimlik kartı (TD1/TD2) için
    const isTckn = r.documentType === "NATIONAL_ID" && r.issuingCountry === "TUR" && isValidTurkishIdentityNumber(tckn);
    return { checks, result: {
      firstName: r.firstName,
      middleName: r.middleName,
      lastName: r.lastName,
      nationality: normalizeCountryCode(r.nationality || r.issuingCountry),
      dateOfBirth: r.dateOfBirth,
      expiryDate: r.expiryDate,
      documentNumber: isTckn ? tckn : r.documentNumber,
      idNumber: isValidTurkishIdentityNumber(tckn) ? tckn : "",
      documentType: isTckn ? "TCKN" : r.documentType,
      issuingCountry: normalizeCountryCode(r.issuingCountry || r.nationality),
      gender: r.gender || "U",
      mrzRaw: parsed.lines,
    }};
  }catch(e){ console.warn("SnapPass MRZ parse error:",e); }
  return null;
}

// Mevcut parser önce çalışır; SnapPass sonucu daha fazla kontrol hanesi tutuyorsa (veya mevcut null ise) o kullanılır.
function parseMRZ(lines){
  const primary = parseMRZPrimary(lines);
  const snap = parseMRZSnapPass(lines);
  if(!snap) return primary;
  const primaryChecks = primary ? countMrzChecks(primary.mrzRaw) : -1;
  if(snap.checks <= primaryChecks) return primary;
  console.log("[MRZ] snappass matched checks=", snap.checks, "primaryChecks=", primaryChecks, snap.result);
  return snap.result;
}

function parseMRZPrimary(lines){
  try{
    const raw = Array.from(new Set(lines.map(l=>l.replace(/[^A-Z0-9<]/g,"").toUpperCase()).filter(Boolean)));
    const hasTurkishSignals = raw.some(l=>l.includes("TUR")) || raw.some(l=>l.startsWith("I<"))
      || raw.some(l=>/^I[^A-Z]/.test(l))  // "I4TUR", "I<TUR" garbled
      || raw.some(l=>/\d{11}/.test(l))     // 11-digit TCKN anywhere
      || raw.some(l=>l.includes("<<") && l.length >= 24 && l.length <= 34); // TD1 name line
    const turkishId = parseTurkishIdLoose(raw);
    if(turkishId){
      const { score, ...result } = turkishId;
      console.log("[MRZ] turkish-id matched score=", score, result);
      return result;
    }
    if(hasTurkishSignals){
      let bestTurkish = null;
      for(let i=0;i<=raw.length-3;i++){
        const parsed = parseTD1Triplet(raw[i], raw[i+1], raw[i+2]);
        if(parsed && parsed.documentType === "TCKN" && (!bestTurkish || parsed.score > bestTurkish.score)){
          bestTurkish = parsed;
        }
      }
      if(bestTurkish){
        const { score, ...result } = bestTurkish;
        console.log("[MRZ] td1-turkish matched score=", score, result);
        return result;
      }
      return null;
    }
    let best = null;
    for(let i=0;i<raw.length;i++){
      for(let j=0;j<raw.length;j++){
        for(let k=0;k<raw.length;k++){
          if(i===j || j===k || i===k) continue;
          const parsed = parseTD1Triplet(raw[i], raw[j], raw[k]);
          if(parsed && (!best || parsed.score > best.score)) best = parsed;
        }
      }
    }
    for(let i=0;i<raw.length;i++){
      for(let j=0;j<raw.length;j++){
        if(i===j) continue;
        const parsed = parseTD3Pair(raw[i], raw[j]);
        if(parsed && (!best || parsed.score > best.score)) best = parsed;
      }
    }
    if(best){
      const { score, ...result } = best;
      console.log("[MRZ] td3 matched score=", score, result);
      return result;
    }
    const legacy = parseMRZLegacy(raw);
    if(legacy){
      if(!hasTurkishSignals) return null;
      if((legacy.documentType || "").toUpperCase() === "PASSPORT" && raw.some(l=>l.includes("TUR"))){
        return null;
      }
    }
    return legacy;
  }catch(e){ console.warn("MRZ parse error:",e); }
  return null;
}

/* ── TEMPLATE-MATCHING MRZ SCANNER (OCR-B optimized) ─────────────────────── */
function templateMatchMRZ(canvas){
  // Canvas'tan binary harita oluştur ve template matching ile MRZ oku
  // paucapo/mrz-reader algoritmasını temel alır
  if(!window.MRZ_TEMPLATES) return null;
  const templates = window.MRZ_TEMPLATES;
  const AVG_MOD = 0.9;

  const ctx = canvas.getContext("2d");
  if(canvas.width <= 0 || canvas.height <= 0) return null;
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // 1) Luminosity → binary
  let lumAvg = 0;
  const lum = [];
  for(let y=0; y<pixels.height; y++){
    lum[y] = [];
    for(let x=0; x<pixels.width; x++){
      const pos = (y * pixels.width + x) * 4;
      lum[y][x] = 0.2126*pixels.data[pos] + 0.7152*pixels.data[pos+1] + 0.0722*pixels.data[pos+2];
      lumAvg += lum[y][x];
    }
  }
  lumAvg = (lumAvg / (pixels.width * pixels.height)) * AVG_MOD;
  const binary = lum.map(row => row.map(v => v <= lumAvg ? 0 : 1));

  // 2) Find rows (satır tespiti)
  const height = binary.length;
  const width = binary[0].length;
  const rows = [];
  let lastRow = 1;
  for(let y=0; y<height; y++){
    let rowSum = 0;
    for(let x=0; x<width; x++) rowSum += binary[y][x];
    const isWhite = (rowSum / width) >= 0.97; // Küçük gürültü toleransı
    if(!isWhite){
      if(lastRow !== 0) rows.push({start:y, end:y, columns:[]});
      lastRow = 0;
    } else {
      if(lastRow !== 1 && rows.length) rows[rows.length-1].end = y;
      lastRow = 1;
    }
  }

  // MRZ satırları genellikle 2 veya 3 satır — çok fazla veya çok az satır varsa filtrele
  if(rows.length < 2) return null;
  // En yüksek satırları tercih et (minimum yükseklik filtresi)
  const minRowHeight = height * 0.04;
  const validRows = rows.filter(r => (r.end - r.start) >= minRowHeight);
  if(validRows.length < 2) return null;
  // Son 2-3 satırı al (MRZ genellikle altta)
  const mrzRows = validRows.slice(-Math.min(validRows.length, 3));

  // 3) Find columns per row
  for(const row of mrzRows){
    const sub = binary.slice(row.start, row.end);
    const subH = sub.length;
    if(subH <= 0) continue;
    const subW = sub[0].length;
    let lastCol = 1;
    for(let x=0; x<subW; x++){
      let colSum = 0;
      for(let y=0; y<subH; y++) colSum += sub[y][x];
      const isWhite = (colSum / subH) >= 0.95; // Gürültü toleransı
      if(!isWhite){
        if(lastCol !== 0) row.columns.push({start:x, end:x});
        lastCol = 0;
      } else {
        if(lastCol !== 1 && row.columns.length) row.columns[row.columns.length-1].end = x;
        lastCol = 1;
      }
    }
  }

  // 4) Auto-crop + template match per character
  function autoCrop(bin){
    const bpX = {}, bpY = {};
    for(let y=0; y<bin.length; y++)
      for(let x=0; x<bin[y].length; x++)
        if(bin[y][x] === 0){ bpX[x] = true; bpY[y] = true; }
    const xs = Object.keys(bpX).map(Number).sort((a,b)=>a-b);
    const ys = Object.keys(bpY).map(Number).sort((a,b)=>a-b);
    if(!xs.length || !ys.length) return null;
    const nx = xs[0], ny = ys[0];
    const nw = xs[xs.length-1] - nx;
    const nh = ys[ys.length-1] - ny;
    if(nw <= 0 || nh <= 0) return null;
    const nb = [];
    for(let y=0; y<nh; y++){
      nb[y] = [];
      for(let x=0; x<nw; x++) nb[y][x] = bin[y+ny][x+nx];
    }
    return nb;
  }

  function matchChar(charBin){
    let best = "", bestAff = -(charBin[0].length * charBin.length);
    const ch = charBin[0].length, cH = charBin.length;
    for(const key in templates){
      const tpl = templates[key];
      const tW = tpl[0].length, tH = tpl.length;
      let aff = 0;
      for(let y=0; y<cH; y++){
        const ty = Math.floor(y * tH / cH);
        for(let x=0; x<ch; x++){
          const tx = Math.floor(x * tW / ch);
          aff += (charBin[y][x] === tpl[ty][tx]) ? 1 : -1;
        }
      }
      if(aff > bestAff){ bestAff = aff; best = key; }
    }
    return best;
  }

  // Post-process: MRZ'de C ve L karakterleri genellikle '<' yanlış okuması
  function fixChevrons(line){
    // Kural 1: 2+ ardışık C, L veya < karışımı → hepsini '<' yap
    line = line.replace(/[CL<]{2,}/g, m => "<".repeat(m.length));
    // Kural 2: Satır sonundaki tek C veya L → '<'
    line = line.replace(/[CL]+$/, m => "<".repeat(m.length));
    // Kural 3: Bilinen MRZ kalıplarında tek C/L → '<'
    // "X<Y" formatında X ve Y harf ise ortadaki '<' doğru, ama "XCY" veya "XLY" yanlış olabilir
    // Sadece sayılardan sonra gelen tek C → '<' (ör: "276C153" → "276<153")
    line = line.replace(/(\d)C(\d)/g, "$1<$2");
    line = line.replace(/(\d)L(\d)/g, "$1<$2");
    // Kural 4: Satır başındaki "I" + tek C/L → "I<"
    line = line.replace(/^(I)[CL]/, "$1<");
    return line;
  }

  // 5) Recognize all characters — boşluklardaki '<' karakterlerini de say
  const mrzLines = [];
  for(const row of mrzRows){
    let line = "";
    const cols = row.columns;
    if(!cols.length) continue;

    // Ortalama karakter genişliği hesapla
    const widths = cols.map(c => c.end - c.start).filter(w => w > 1);
    const avgCharW = widths.length ? widths.reduce((a,b)=>a+b,0) / widths.length : 10;

    for(let ci=0; ci<cols.length; ci++){
      const col = cols[ci];
      const charH = row.end - row.start;
      const charW = col.end - col.start;

      // Önceki sütunla arasındaki boşluğu ölç — büyük boşluk = '<' karakterleri
      if(ci > 0){
        const gap = col.start - cols[ci-1].end;
        // Her karakter genişliğindeki boşluk = 1 adet '<'
        if(gap > avgCharW * 0.6){
          const chevronCount = Math.round(gap / avgCharW);
          line += "<".repeat(chevronCount);
        }
      }

      if(charW <= 1 || charH <= 1) continue;

      // Dar karakter → büyük ihtimalle '<' (OCR-B'de < en dar karakter)
      if(charW < avgCharW * 0.55){
        line += "<";
        continue;
      }

      const charBin = [];
      for(let y=0; y<charH; y++){
        charBin[y] = [];
        for(let x=0; x<charW; x++){
          charBin[y][x] = binary[row.start+y][col.start+x];
        }
      }
      const cropped = autoCrop(charBin);
      if(!cropped) continue;
      const ch = matchChar(cropped);
      if(ch) line += ch;
    }
    // Satır sonuna da kalan '<' ekle (30 karaktere tamamla)
    if(line.length >= 18 && line.length < 30) line = line.padEnd(30, "<");
    // Post-process: C/L → '<' düzeltmesi
    line = fixChevrons(line);
    if(line.length >= 18) mrzLines.push(line);
  }

  console.log(`[MRZ-TPL] rows=${mrzRows.length} cols=[${mrzRows.map(r=>r.columns.length).join(",")}] avgCharW=${mrzRows.length?Math.round(mrzRows[0].columns.reduce((a,c)=>a+(c.end-c.start),0)/Math.max(1,mrzRows[0].columns.length)):0}`);
  console.log("[MRZ-TPL] lines (raw→fixed):", mrzLines);
  if(mrzLines.length < 2) return null;
  return mrzLines;
}

function orderQuadPoints(points){
  if(!Array.isArray(points) || points.length !== 4) return null;
  const withMeta = points.map(p=>({
    x: Number(p.x || 0),
    y: Number(p.y || 0),
    sum: Number(p.x || 0) + Number(p.y || 0),
    diff: Number(p.x || 0) - Number(p.y || 0),
  }));
  const tl = withMeta.reduce((best,p)=>p.sum < best.sum ? p : best, withMeta[0]);
  const br = withMeta.reduce((best,p)=>p.sum > best.sum ? p : best, withMeta[0]);
  const tr = withMeta.reduce((best,p)=>p.diff > best.diff ? p : best, withMeta[0]);
  const bl = withMeta.reduce((best,p)=>p.diff < best.diff ? p : best, withMeta[0]);
  return [tl, tr, br, bl];
}

function detectPerspectiveCorrectedCanvas(source){
  const cv = window.cv;
  if(!cv || typeof cv.imread !== "function" || !source) return null;
  const sw = source.videoWidth || source.width || 0;
  const sh = source.videoHeight || source.height || 0;
  if(sw < 320 || sh < 240) return null;

  const workCanvas = document.createElement("canvas");
  const maxWorkW = 1280;
  const scale = Math.min(1, maxWorkW / sw);
  workCanvas.width = Math.max(320, Math.round(sw * scale));
  workCanvas.height = Math.max(180, Math.round(sh * scale));
  workCanvas.getContext("2d",{willReadFrequently:true}).drawImage(source, 0, 0, workCanvas.width, workCanvas.height);

  let src = null, gray = null, blur = null, edge = null, kernel = null, contours = null, hierarchy = null;
  try{
    src = cv.imread(workCanvas);
    gray = new cv.Mat();
    blur = new cv.Mat();
    edge = new cv.Mat();
    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(blur, edge, 60, 180, 3, false);
    cv.dilate(edge, edge, kernel);

    cv.findContours(edge, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    let best = null;
    const frameArea = src.cols * src.rows;
    for(let i=0; i<contours.size(); i++){
      const cnt = contours.get(i);
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      try{
        cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
        if(approx.rows !== 4) continue;
        const area = Math.abs(cv.contourArea(approx));
        if(area < frameArea * 0.06) continue;
        const pts = [];
        for(let j=0; j<4; j++){
          pts.push({
            x: approx.data32S[j * 2],
            y: approx.data32S[j * 2 + 1],
          });
        }
        const ordered = orderQuadPoints(pts);
        if(!ordered) continue;
        const widthA = Math.hypot(ordered[2].x - ordered[3].x, ordered[2].y - ordered[3].y);
        const widthB = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
        const heightA = Math.hypot(ordered[1].x - ordered[2].x, ordered[1].y - ordered[2].y);
        const heightB = Math.hypot(ordered[0].x - ordered[3].x, ordered[0].y - ordered[3].y);
        const maxWidth = Math.max(widthA, widthB);
        const maxHeight = Math.max(heightA, heightB);
        if(maxWidth < 220 || maxHeight < 120) continue;
        const ratio = maxWidth / Math.max(1, maxHeight);
        if(ratio < 0.95 || ratio > 2.15) continue;
        const score = area * (ratio >= 1.32 && ratio <= 1.7 ? 1.15 : 1);
        if(!best || score > best.score){
          best = { ordered, maxWidth: Math.round(maxWidth), maxHeight: Math.round(maxHeight), score };
        }
      }finally{
        approx.delete();
        cnt.delete();
      }
    }

    if(!best) return null;

    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      best.ordered[0].x, best.ordered[0].y,
      best.ordered[1].x, best.ordered[1].y,
      best.ordered[2].x, best.ordered[2].y,
      best.ordered[3].x, best.ordered[3].y,
    ]);
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      best.maxWidth - 1, 0,
      best.maxWidth - 1, best.maxHeight - 1,
      0, best.maxHeight - 1,
    ]);
    const transform = cv.getPerspectiveTransform(srcTri, dstTri);
    const dst = new cv.Mat();
    try{
      cv.warpPerspective(
        src,
        dst,
        transform,
        new cv.Size(best.maxWidth, best.maxHeight),
        cv.INTER_LINEAR,
        cv.BORDER_REPLICATE,
        new cv.Scalar()
      );
      const outCanvas = document.createElement("canvas");
      outCanvas.width = best.maxWidth;
      outCanvas.height = best.maxHeight;
      cv.imshow(outCanvas, dst);
      return outCanvas;
    }finally{
      srcTri.delete();
      dstTri.delete();
      transform.delete();
      dst.delete();
    }
  }catch(err){
    console.warn("[MRZ] perspective correction failed:", err);
    return null;
  }finally{
    if(src) src.delete();
    if(gray) gray.delete();
    if(blur) blur.delete();
    if(edge) edge.delete();
    if(kernel) kernel.delete();
    if(contours) contours.delete();
    if(hierarchy) hierarchy.delete();
  }
}

function buildMrzCanvases(source, scratchCanvas){
  const vw = source.videoWidth || source.width;
  const vh = source.videoHeight || source.height;
  const rois = [
    // Bu kaynak artık zaten MRZ bandına crop edilmiş durumda.
    { label:"MRZ-band", sx:0.0, sy:0.0, sw:1.0, sh:1.0 },
    { label:"MRZ-band-ust", sx:0.0, sy:0.0, sw:1.0, sh:0.88 },
    { label:"MRZ-band-alt", sx:0.0, sy:0.12, sw:1.0, sh:0.88 },
  ];

  const variants = [];
  const scratchCtx = scratchCanvas.getContext("2d",{willReadFrequently:true});
  const toLineCanvases = (sourceCanvas) => {
    const lineCanvases = [];
    const srcW = sourceCanvas.width;
    const srcH = sourceCanvas.height;
    const lineH = srcH / 3;
    const overlap = Math.max(10, Math.round(lineH * 0.14));

    for(let idx=0; idx<3; idx++){
      const sy = Math.max(0, Math.round((idx * lineH) - overlap));
      const ey = Math.min(srcH, Math.round(((idx + 1) * lineH) + overlap));
      const sh = Math.max(4, ey - sy);
      // Kaynak boyut çok küçükse atla
      if(srcW < 10 || sh < 4) continue;
      const lineCanvas = document.createElement("canvas");
      lineCanvas.width = Math.max(900, srcW);
      lineCanvas.height = Math.max(60, Math.round((sh / srcW) * lineCanvas.width * 1.2));
      lineCanvas.getContext("2d",{willReadFrequently:true}).drawImage(
        sourceCanvas,
        0, sy, srcW, sh,
        0, 0, lineCanvas.width, lineCanvas.height
      );
      lineCanvases.push(lineCanvas);
    }
    return lineCanvases;
  };

  const buildVariantPair = (roiDef) => {
    const roi = {
      sx: Math.round(vw * roiDef.sx),
      sy: Math.round(vh * roiDef.sy),
      sw: Math.round(vw * roiDef.sw),
      sh: Math.round(vh * roiDef.sh),
    };

    scratchCanvas.width = roi.sw;
    scratchCanvas.height = roi.sh;
    scratchCtx.clearRect(0,0,roi.sw,roi.sh);
    scratchCtx.drawImage(source, roi.sx, roi.sy, roi.sw, roi.sh, 0, 0, roi.sw, roi.sh);
    const lighting = analyzeCanvasLighting(scratchCanvas);

    const targetW = Math.max(1200, Math.round(roi.sw * 1.5));
    const targetH = Math.round((roi.sh / roi.sw) * targetW);
    const makeCanvas = () => {
      const c = document.createElement("canvas");
      c.width = targetW;
      c.height = targetH;
      return c;
    };

    // ── Canvas 1: Temiz gri tonlama (minimum işleme — Tesseract'a en uygun) ──
    const baseCanvas = makeCanvas();
    const baseCtx = baseCanvas.getContext("2d",{willReadFrequently:true});
    if("filter" in baseCtx) baseCtx.filter = "grayscale(1)";
    baseCtx.drawImage(scratchCanvas, 0, 0, targetW, targetH);
    if("filter" in baseCtx) baseCtx.filter = "none";

    // ── Canvas 2: Yüksek kontrastlı gri tonlama ──
    const highContrastCanvas = makeCanvas();
    const hcCtx = highContrastCanvas.getContext("2d",{willReadFrequently:true});
    if("filter" in hcCtx) hcCtx.filter = "grayscale(1) contrast(3.0) brightness(1.2)";
    hcCtx.drawImage(scratchCanvas, 0, 0, targetW, targetH);
    if("filter" in hcCtx) hcCtx.filter = "none";

    // ── Canvas 2b: Ortama göre ayarlanmış varyant ──
    const adaptiveCanvas = makeCanvas();
    const adaptiveCtx = adaptiveCanvas.getContext("2d",{willReadFrequently:true});
    if("filter" in adaptiveCtx) adaptiveCtx.filter = getAdaptiveMrzFilter(lighting);
    adaptiveCtx.drawImage(scratchCanvas, 0, 0, targetW, targetH);
    if("filter" in adaptiveCtx) adaptiveCtx.filter = "none";

    // ── Canvas 3: Siyah-beyaz (basit threshold) ──
    const binaryCanvas = makeCanvas();
    const binCtx = binaryCanvas.getContext("2d",{willReadFrequently:true});
    binCtx.drawImage(baseCanvas, 0, 0);
    const img = binCtx.getImageData(0, 0, targetW, targetH);
    const d = img.data;
    // Otsu threshold hesapla
    const hist = new Array(256).fill(0);
    for(let i=0;i<d.length;i+=4){
      hist[Math.round(0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2])]++;
    }
    const total = d.length / 4;
    let sum = 0; for(let t=0;t<256;t++) sum += t * hist[t];
    let sumB=0, wB=0, maxVar=0, threshold=128;
    for(let t=0;t<256;t++){
      wB += hist[t]; if(!wB) continue;
      const wF = total - wB; if(!wF) break;
      sumB += t * hist[t];
      const mB = sumB/wB, mF = (sum-sumB)/wF;
      const v = wB * wF * (mB-mF) * (mB-mF);
      if(v > maxVar){ maxVar = v; threshold = t; }
    }
    for(let i=0;i<d.length;i+=4){
      const g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      d[i] = d[i+1] = d[i+2] = g > threshold ? 255 : 0;
    }
    binCtx.putImageData(img, 0, 0);

    // 0) Işık durumuna göre ayarlanmış satırlar
    const adaptiveLines = toLineCanvases(adaptiveCanvas);
    if(adaptiveLines.length >= 3) variants.push({ label:`${roiDef.label}-adaptif-satir-wl`, canvases:adaptiveLines, psm:"7", useWhitelist:true });
    variants.push({ label:`${roiDef.label}-adaptif-blok-wl`, canvas:adaptiveCanvas, psm:"6", useWhitelist:true });
    // 1) Satır bazlı yüksek kontrast + whitelist
    const hcLines = toLineCanvases(highContrastCanvas);
    if(hcLines.length >= 3) variants.push({ label:`${roiDef.label}-satir-wl`, canvases:hcLines, psm:"7", useWhitelist:true });
    // 2) Satır bazlı temiz gri — whitelist yok
    const gLines = toLineCanvases(baseCanvas);
    if(gLines.length >= 3) variants.push({ label:`${roiDef.label}-satir-free`, canvases:gLines, psm:"7", useWhitelist:false });
    // 3) Tam blok yüksek kontrast + whitelist
    variants.push({ label:`${roiDef.label}-blok-wl`, canvas:highContrastCanvas, psm:"6", useWhitelist:true });
    // 4) Ana band için ekstra siyah-beyaz satır fallback'i bırak
    if(roiDef.label === "MRZ-band"){
      const bwLines = toLineCanvases(binaryCanvas);
      if(bwLines.length >= 3) variants.push({ label:`${roiDef.label}-satir-bw-wl`, canvases:bwLines, psm:"7", useWhitelist:true });
    }
  };

  rois.forEach(buildVariantPair);
  return variants;
}

function getFastMrzCanvases(source, scratchCanvas){
  const all = buildMrzCanvases(source, scratchCanvas);
  const preferred = [
    "MRZ-band-adaptif-satir-wl",
    "MRZ-band-adaptif-blok-wl",
    "MRZ-band-satir-wl",
    "MRZ-band-blok-wl",
    "MRZ-band-alt-satir-wl",
  ];
  const picked = preferred
    .map(label => all.find(v => v.label === label))
    .filter(Boolean);
  return picked.length ? picked : all.slice(0, 2);
}

function analyzeCanvasLighting(canvas){
  const sample = document.createElement("canvas");
  sample.width = 160;
  sample.height = Math.max(48, Math.round((canvas.height / Math.max(1, canvas.width)) * sample.width));
  const ctx = sample.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
  const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
  let sum = 0;
  let sumSq = 0;
  let brightPixels = 0;
  let darkPixels = 0;
  const total = data.length / 4;
  for(let i=0; i<data.length; i+=4){
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += g;
    sumSq += g * g;
    if(g >= 235) brightPixels++;
    if(g <= 40) darkPixels++;
  }
  const mean = sum / Math.max(1, total);
  const variance = Math.max(0, (sumSq / Math.max(1, total)) - (mean * mean));
  return {
    mean,
    deviation: Math.sqrt(variance),
    brightRatio: brightPixels / Math.max(1, total),
    darkRatio: darkPixels / Math.max(1, total),
  };
}

function getAdaptiveMrzFilter(lighting){
  if(!lighting) return "grayscale(1) contrast(3.0) brightness(1.15)";
  if(lighting.brightRatio > 0.16 || lighting.mean > 185){
    return "grayscale(1) contrast(4.6) brightness(0.68)";
  }
  if(lighting.darkRatio > 0.20 || lighting.mean < 95){
    return "grayscale(1) contrast(3.35) brightness(1.52)";
  }
  if(lighting.deviation < 36){
    return "grayscale(1) contrast(3.8) brightness(1.14)";
  }
  return "grayscale(1) contrast(3.0) brightness(1.15)";
}

function buildDirectMrzLineCanvases(sourceCanvas){
  const lighting = analyzeCanvasLighting(sourceCanvas);
  const renderVariant = (filterText) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1500, sourceCanvas.width);
    canvas.height = Math.max(260, Math.round((sourceCanvas.height / Math.max(1, sourceCanvas.width)) * canvas.width));
    const ctx = canvas.getContext("2d",{willReadFrequently:true});
    if("filter" in ctx) ctx.filter = filterText;
    ctx.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
    if("filter" in ctx) ctx.filter = "none";
    return canvas;
  };

  const work = renderVariant(getAdaptiveMrzFilter(lighting));
  const glareReduced = renderVariant("grayscale(1) contrast(4.8) brightness(0.66)");
  const lowLightBoost = renderVariant("grayscale(1) contrast(3.35) brightness(1.52)");

  const binary = document.createElement("canvas");
  binary.width = work.width;
  binary.height = work.height;
  const binCtx = binary.getContext("2d",{willReadFrequently:true});
  binCtx.drawImage(work, 0, 0);
  const img = binCtx.getImageData(0, 0, binary.width, binary.height);
  const d = img.data;
  const threshold = lighting.mean > 175 ? 150 : lighting.mean < 95 ? 92 : 120;
  for(let i=0;i<d.length;i+=4){
    const g = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
    const v = g > threshold ? 255 : 0;
    d[i] = d[i+1] = d[i+2] = v;
  }
  binCtx.putImageData(img, 0, 0);

  const splitLines = (canvas) => {
    const lines = [];
    const lineH = canvas.height / 3;
    const overlap = Math.max(12, Math.round(lineH * 0.18));
    for(let idx=0; idx<3; idx++){
      const sy = Math.max(0, Math.round((idx * lineH) - overlap));
      const ey = Math.min(canvas.height, Math.round(((idx + 1) * lineH) + overlap));
      const sh = Math.max(8, ey - sy);
      const lineCanvas = document.createElement("canvas");
      lineCanvas.width = canvas.width;
      lineCanvas.height = Math.max(72, Math.round((sh / Math.max(1, canvas.width)) * lineCanvas.width * 1.16));
      lineCanvas.getContext("2d",{willReadFrequently:true}).drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, lineCanvas.width, lineCanvas.height);
      lines.push(lineCanvas);
    }
    return lines;
  };

  return {
    lighting,
    adaptiveLines: splitLines(work),
    glareReducedLines: splitLines(glareReduced),
    lowLightLines: splitLines(lowLightBoost),
    binaryLines: splitLines(binary),
  };
}

const IS_ANDROID_DEVICE = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || "");
const IS_MOBILE_DEVICE = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
const IS_DESKTOP_WEBCAM = !IS_MOBILE_DEVICE;

const MRZ_SOURCE_BOX = IS_ANDROID_DEVICE
  ? {
      sx: 0.008,
      sy: 0.46,
      sw: 0.984,
      sh: 0.40,
    }
  : IS_DESKTOP_WEBCAM
  ? {
      sx: 0.008,
      sy: 0.47,
      sw: 0.984,
      sh: 0.40,
    }
  : {
      sx: 0.01,
      sy: 0.52,
      sw: 0.98,
      sh: 0.34,
    };

// Resepsiyon terminalindeki yerel OCR aracı (ocr-agent.js). Şimdilik kapalı: telefon, tablet ve bilgisayar aynı şekilde
// bulut OCR (/api/mrz/scan) kullanır. Fiziksel kimlik okuyucu bağlanınca true yapılır.
const USE_LOCAL_OCR_AGENT = false;
const OCR_AGENT_URL = "http://127.0.0.1:5102";
let ocrAgentState = null; // null: henüz denenmedi
async function ocrAgentAvailable(force){
  if(!USE_LOCAL_OCR_AGENT) return false;
  if(ocrAgentState !== null && !force) return ocrAgentState;
  try{
    const res = await fetch(`${OCR_AGENT_URL}/health`, { signal:AbortSignal.timeout(800) });
    ocrAgentState = res.ok;
  }catch(_){
    ocrAgentState = false;
  }
  return ocrAgentState;
}

// Kart çerçevesi: kimlik kartı / pasaport sayfası oranında (≈1.5:1), sahnenin ortasında.
// Okuma bu çerçevenin videodaki karşılığından yapılır; MRZ'nin çerçeve içinde olması yeterli.
const CARD_GUIDE_RATIO = 1.5;
function computeCardGuide(stageW, stageH){
  const w = Math.min(stageW * 0.92, stageH * 0.86 * CARD_GUIDE_RATIO);
  const h = w / CARD_GUIDE_RATIO;
  return { left:(stageW - w) / 2, top:(stageH - h) / 2, width:w, height:h };
}
// Kart kırpımında MRZ bölgesi (kartın alt kısmı)
const CARD_MRZ_BOX = { sx:0.02, sy:0.52, sw:0.96, sh:0.47 };

// Ekrandaki çerçeveyi (video object-fit: cover) video piksellerine çevirip kenar payıyla kırpar
function cropVideoToGuide(video, stageEl, margin=0.06){
  const vw = video.videoWidth, vh = video.videoHeight;
  const sw = stageEl.clientWidth, sh = stageEl.clientHeight;
  const g = computeCardGuide(sw, sh);
  const scale = Math.max(sw / vw, sh / vh);
  const offX = (vw * scale - sw) / 2, offY = (vh * scale - sh) / 2;
  const mx = g.width * margin, my = g.height * margin;
  const x = Math.max(0, (g.left - mx + offX) / scale);
  const y = Math.max(0, (g.top - my + offY) / scale);
  const w = Math.min(vw - x, (g.width + 2 * mx) / scale);
  const h = Math.min(vh - y, (g.height + 2 * my) / scale);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w);
  canvas.height = Math.round(h);
  canvas.getContext("2d").drawImage(video, x, y, w, h, 0, 0, canvas.width, canvas.height);
  canvas.isCardCrop = true;
  return canvas;
}

// Yerel (adaptif) eşikleme: her piksel çevresindeki pencerenin ortalamasıyla karşılaştırılır.
// Soluk / arkadan ışık alan karelerde Tesseract'ın satırları bulmasını sağlar.
function adaptiveThresholdCanvas(source, scale=1, k=0.12){
  const W = Math.max(1, Math.round(source.width * scale));
  const H = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently:true });
  ctx.drawImage(source, 0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const gray = new Float32Array(W * H);
  for(let i=0; i<W*H; i++) gray[i] = d[i*4] * 0.299 + d[i*4+1] * 0.587 + d[i*4+2] * 0.114;
  const I = new Float64Array((W + 1) * (H + 1));
  for(let y=1; y<=H; y++){
    let row = 0;
    for(let x=1; x<=W; x++){
      row += gray[(y - 1) * W + x - 1];
      I[y * (W + 1) + x] = I[(y - 1) * (W + 1) + x] + row;
    }
  }
  const r = Math.max(4, Math.round(W * 0.03));
  for(let y=0; y<H; y++){
    const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
    for(let x=0; x<W; x++){
      const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
      const sum = I[(y1 + 1) * (W + 1) + x1 + 1] - I[y0 * (W + 1) + x1 + 1] - I[(y1 + 1) * (W + 1) + x0] + I[y0 * (W + 1) + x0];
      const v = gray[y * W + x] < (sum / ((x1 - x0 + 1) * (y1 - y0 + 1))) * (1 - k) ? 0 : 255;
      const i = (y * W + x) * 4;
      d[i] = d[i+1] = d[i+2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function wait(ms){
  return new Promise(resolve=>setTimeout(resolve, ms));
}

function captureVideoFrameToCanvas(video){
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d",{willReadFrequently:true}).drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Kaynağın alt kısmını (ratio oranında) yeni bir canvas'a kırpar
function cropBottomCanvas(source, ratio){
  const w = source.videoWidth || source.width;
  const h = source.videoHeight || source.height;
  const top = Math.floor(h * (1 - ratio));
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h - top;
  out.getContext("2d").drawImage(source, 0, top, w, h - top, 0, 0, w, h - top);
  return out;
}

function scoreMrzFrameQuality(source){
  const bandCanvas = extractMrzBandCanvas(source);
  const sw = bandCanvas.width;
  const sh = bandCanvas.height;
  if(!sw || !sh) return 0;
  const lighting = analyzeCanvasLighting(bandCanvas);

  const probe = document.createElement("canvas");
  probe.width = 320;
  probe.height = Math.max(100, Math.round((sh / Math.max(1, sw)) * probe.width));
  const ctx = probe.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(bandCanvas, 0, 0, sw, sh, 0, 0, probe.width, probe.height);
  const data = ctx.getImageData(0, 0, probe.width, probe.height).data;

  let edgeScore = 0;
  let contrastSum = 0;
  const rowStride = probe.width * 4;
  for(let y=1; y<probe.height; y++){
    for(let x=1; x<probe.width; x++){
      const idx = (y * probe.width + x) * 4;
      const left = idx - 4;
      const up = idx - rowStride;
      const g = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      const gl = 0.299 * data[left] + 0.587 * data[left + 1] + 0.114 * data[left + 2];
      const gu = 0.299 * data[up] + 0.587 * data[up + 1] + 0.114 * data[up + 2];
      edgeScore += Math.abs(g - gl) + Math.abs(g - gu);
      contrastSum += g;
    }
  }
  const pxCount = Math.max(1, (probe.width - 1) * (probe.height - 1));
  const mean = contrastSum / pxCount;
  const clipPenalty = (lighting?.brightRatio || 0) * 34 + (lighting?.darkRatio || 0) * 18;
  const balanceBonus = Math.min(14, (lighting?.deviation || 0) * 0.16);
  return (edgeScore / pxCount) + Math.abs(mean - 127) * 0.08 + balanceBonus - clipPenalty;
}

function tightenMrzContentCanvas(sourceCanvas){
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  if(!width || !height) return sourceCanvas;

  const lighting = analyzeCanvasLighting(sourceCanvas);
  const probe = document.createElement("canvas");
  probe.width = Math.min(720, width);
  probe.height = Math.max(120, Math.round((height / Math.max(1, width)) * probe.width));
  const probeCtx = probe.getContext("2d",{willReadFrequently:true});
  probeCtx.drawImage(sourceCanvas, 0, 0, probe.width, probe.height);
  const img = probeCtx.getImageData(0, 0, probe.width, probe.height);
  const data = img.data;
  const darkThreshold = Math.max(68, Math.min(160, Math.round((lighting.mean || 120) - 24)));
  const rowHits = new Array(probe.height).fill(0);

  for(let y=0; y<probe.height; y++){
    for(let x=0; x<probe.width; x++){
      const idx = (y * probe.width + x) * 4;
      const g = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      if(g <= darkThreshold){
        rowHits[y]++;
      }
    }
  }

  const minRowHits = Math.max(4, Math.round(probe.width * 0.015));
  const maxRowGap = Math.max(8, Math.round(probe.height * 0.04));
  const rowBands = [];
  let activeStart = -1;
  for(let y=0; y<probe.height; y++){
    if(rowHits[y] >= minRowHits){
      if(activeStart < 0) activeStart = y;
    }else if(activeStart >= 0){
      rowBands.push({ start:activeStart, end:y - 1 });
      activeStart = -1;
    }
  }
  if(activeStart >= 0) rowBands.push({ start:activeStart, end:probe.height - 1 });
  if(!rowBands.length) return sourceCanvas;

  const mergedBands = [];
  for(const band of rowBands){
    const prev = mergedBands[mergedBands.length - 1];
    if(prev && (band.start - prev.end) <= maxRowGap){
      prev.end = band.end;
    }else{
      mergedBands.push({ ...band });
    }
  }

  let bestBand = null;
  for(const band of mergedBands){
    const bandHeight = band.end - band.start + 1;
    if(bandHeight < Math.max(10, Math.round(probe.height * 0.10))) continue;
    let sumHits = 0;
    let peakHits = 0;
    for(let y=band.start; y<=band.end; y++){
      sumHits += rowHits[y];
      if(rowHits[y] > peakHits) peakHits = rowHits[y];
    }
    const center = (band.start + band.end) / 2;
    const upperBias = 1 - Math.min(0.75, center / Math.max(1, probe.height));
    const score = (sumHits * 1.2) + (peakHits * 2.4) + (bandHeight * probe.width * 0.08) + (upperBias * probe.width * 18);
    if(!bestBand || score > bestBand.score){
      bestBand = { start:band.start, end:band.end, score };
    }
  }
  if(!bestBand) return sourceCanvas;

  let top = bestBand.start;
  let bottom = bestBand.end;
  const colHits = new Array(probe.width).fill(0);
  for(let y=top; y<=bottom; y++){
    for(let x=0; x<probe.width; x++){
      const idx = (y * probe.width + x) * 4;
      const g = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      if(g <= darkThreshold) colHits[x]++;
    }
  }
  const minColHits = Math.max(3, Math.round((bottom - top + 1) * 0.12));
  let left = colHits.findIndex(v => v >= minColHits);
  let right = -1;
  for(let i=probe.width - 1; i>=0; i--){
    if(colHits[i] >= minColHits){ right = i; break; }
  }

  if(top < 0 || left < 0 || bottom <= top || right <= left) return sourceCanvas;

  const bboxW = right - left + 1;
  const bboxH = bottom - top + 1;
  if(bboxW < probe.width * 0.28 || bboxH < probe.height * 0.10) return sourceCanvas;

  const expandX = Math.round(bboxW * 0.08);
  const expandTop = Math.round(bboxH * 0.24);
  const expandBottom = Math.round(bboxH * 0.14);
  left = Math.max(0, left - expandX);
  right = Math.min(probe.width - 1, right + expandX);
  top = Math.max(0, top - expandTop);
  bottom = Math.min(probe.height - 1, bottom + expandBottom);

  const sx = Math.round((left / probe.width) * width);
  const sy = Math.round((top / probe.height) * height);
  const sw = Math.max(1, Math.round(((right - left + 1) / probe.width) * width));
  const sh = Math.max(1, Math.round(((bottom - top + 1) / probe.height) * height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1600, sw);
  canvas.height = Math.max(260, Math.round((sh / Math.max(1, sw)) * canvas.width));
  canvas.getContext("2d",{willReadFrequently:true}).drawImage(
    sourceCanvas,
    sx, sy, sw, sh,
    0, 0, canvas.width, canvas.height
  );
  return canvas;
}

function extractMrzBandCanvas(source){
  const { tightCanvas } = extractMrzBandDebugCanvases(source);
  return tightCanvas;
}

function extractMrzBandDebugCanvases(source){
  const box = source.isCardCrop ? CARD_MRZ_BOX : MRZ_SOURCE_BOX;
  const sw = source.videoWidth || source.width;
  const sh = source.videoHeight || source.height;
  const sx = Math.round(sw * box.sx);
  const sy = Math.round(sh * box.sy);
  const rw = Math.round(sw * box.sw);
  const rh = Math.round(sh * box.sh);
  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = Math.max(1400, rw);
  rawCanvas.height = Math.max(220, Math.round((rh / Math.max(1, rw)) * rawCanvas.width));
  rawCanvas.getContext("2d",{willReadFrequently:true}).drawImage(
    source,
    sx, sy, rw, rh,
    0, 0, rawCanvas.width, rawCanvas.height
  );
  return {
    rawCanvas,
    tightCanvas: tightenMrzContentCanvas(rawCanvas),
  };
}

function getSafeErrorMessage(err){
  if(!err) return t("Bilinmeyen hata");
  if(typeof err === "string") return err;
  if(typeof err?.message === "string" && err.message.trim()) return err.message;
  if(typeof err?.toString === "function"){
    const text = String(err);
    if(text && text !== "[object Object]") return text;
  }
  return t("Bilinmeyen hata");
}

async function safeTerminateWorker(worker){
  if(!worker || typeof worker.terminate !== "function") return;
  try{
    await worker.terminate();
  }catch(termErr){
    console.warn("[MRZ] worker terminate warning:", termErr);
  }
}

/* ── CAMERA SCAN ──────────────────────────────────────────────────────────── */
function CameraScan({guest,session,onDone,onBack,onLogout}){
  const vidRef=useRef(null),canRef=useRef(null),strRef=useRef(null),workerRef=useRef(null),scanRef=useRef(false);
  const debugSessionIdRef=useRef(`mrz_${Date.now()}`);
  const pendingDebugRef=useRef([]);
  const pendingImageWritesRef=useRef([]);
  const debugFlushTimerRef=useRef(null);
  const [phase,setPhase]=useState("ready"),[pct,setPct]=useState(0),[camOk,setCamOk]=useState(true);
  const [status,setStatus]=useState(t("Taramak için dokun"));
  const [tLoaded,setTLoaded]=useState(false);
  const [ocrPreview,setOcrPreview]=useState("");
  const [debugLogs,setDebugLogs]=useState([]);
  const [scanStageHeight,setScanStageHeight]=useState(()=>getScanViewportHeight());
  const insecureCameraContext = !window.isSecureContext;
  const stageRef = useRef(null);
  const [guide,setGuide]=useState(null);
  useEffect(()=>{ ocrAgentAvailable(); },[]);
  // Flaş (torch): yalnız destekleyen cihazlarda (çoğu Android Chrome) görünür
  const [torch,setTorch]=useState({ supported:false, on:false });
  const toggleTorch = async ()=>{
    const track = strRef.current?.getVideoTracks?.()[0];
    if(!track) return;
    try{
      await track.applyConstraints({ advanced:[{ torch:!torch.on }] });
      setTorch(t=>({ ...t, on:!t.on }));
    }catch(err){ console.warn("[MRZ] torch:", err); }
  };
  useEffect(()=>{
    const el = stageRef.current;
    if(!el) return;
    const update = ()=>setGuide(computeCardGuide(el.clientWidth, el.clientHeight));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return ()=>ro.disconnect();
  },[]);

  const pushDebug=(stage,message,meta)=>{
    const line = `${new Date().toLocaleTimeString("tr-TR", { hour12:false })} [${stage}] ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}`;
    setDebugLogs(prev=>[...prev.slice(-39), line]);
    pendingDebugRef.current.push(line);
    if(debugFlushTimerRef.current) clearTimeout(debugFlushTimerRef.current);
    debugFlushTimerRef.current = setTimeout(async ()=>{
      const lines = pendingDebugRef.current.splice(0, pendingDebugRef.current.length);
      debugFlushTimerRef.current = null;
      if(lines.length){
        await writeDebugLogFile({
          sessionId: debugSessionIdRef.current,
          guest: {
            firstName: guest?.firstName || "",
            lastName: guest?.lastName || "",
            confirmationNo: guest?.confirmationNo || "",
          },
          lines,
        });
      }
    }, 250);
  };

  const flushDebugToFile=async()=>{
    if(debugFlushTimerRef.current){
      clearTimeout(debugFlushTimerRef.current);
      debugFlushTimerRef.current = null;
    }
    const lines = pendingDebugRef.current.splice(0, pendingDebugRef.current.length);
    if(!lines.length) return;
    await writeDebugLogFile({
      sessionId: debugSessionIdRef.current,
      guest: {
        firstName: guest?.firstName || "",
        lastName: guest?.lastName || "",
        confirmationNo: guest?.confirmationNo || "",
      },
      lines,
    });
  };

  const queueDebugImageFile=(label, canvas)=>{
    if(!label || !canvas) return;
    const writePromise = writeDebugImageFile({
      sessionId: debugSessionIdRef.current,
      label,
      canvas,
    }).finally(()=>{
      pendingImageWritesRef.current = pendingImageWritesRef.current.filter(item => item !== writePromise);
    });
    pendingImageWritesRef.current.push(writePromise);
  };

  const flushDebugArtifacts=async()=>{
    await flushDebugToFile();
    if(!pendingImageWritesRef.current.length) return;
    const writes = pendingImageWritesRef.current.slice();
    pendingImageWritesRef.current = [];
    await Promise.allSettled(writes);
  };

  // Tesseract + OpenCV yükle
  const [cvLoaded,setCvLoaded]=useState(false);
  useEffect(()=>{
    let loaded=0;
    const check=()=>{ loaded++; if(loaded===2) setTLoaded(true); };
    // Tesseract
    const s=document.createElement("script");
    s.src="/tesseract.min.js";
    s.onload=check;
    document.head.appendChild(s);
    // OpenCV
    const o=document.createElement("script");
    o.src="/opencv.js";
    o.onload=()=>{ setCvLoaded(true); check(); };
    document.head.appendChild(o);
    return()=>{
      if(debugFlushTimerRef.current) clearTimeout(debugFlushTimerRef.current);
      pendingImageWritesRef.current = [];
      safeTerminateWorker(workerRef.current);
      workerRef.current = null;
      strRef.current?.getTracks().forEach(t=>t.stop());
    };
  },[]);

  // Kamera başlat
  useEffect(()=>{
    (async()=>{try{
      const s=await openPreferredCameraStream();
      strRef.current=s;
      const track = s.getVideoTracks?.()[0];
      if(track) await optimizeVideoTrack(track);
      try{ if(track?.getCapabilities?.().torch) setTorch({ supported:true, on:false }); }catch(_){}
      if(vidRef.current) vidRef.current.srcObject=s;
    }catch{ setCamOk(false); }})();
  },[]);

  useEffect(()=>{
    const updateStage = ()=>setScanStageHeight(getScanViewportHeight());
    window.addEventListener("resize", updateStage);
    window.addEventListener("orientationchange", updateStage);
    return ()=>{
      window.removeEventListener("resize", updateStage);
      window.removeEventListener("orientationchange", updateStage);
    };
  },[]);

  const resetScanState=()=>{
    debugSessionIdRef.current = `mrz_${Date.now()}`;
    pendingDebugRef.current = [];
    pendingImageWritesRef.current = [];
    if(debugFlushTimerRef.current) clearTimeout(debugFlushTimerRef.current);
    debugFlushTimerRef.current = null;
    scanRef.current=false;
    safeTerminateWorker(workerRef.current);
    workerRef.current = null;
    setPhase("ready");
    setPct(0);
    setStatus(t("Taramak için dokun"));
    setOcrPreview("");
    setDebugLogs([]);
  };

  const finalizeParsed = async (parsed, worker, successText)=>{
    pushDebug("success","MRZ parse tamamlandi", {
      documentType: parsed?.documentType || "",
      documentNumber: parsed?.documentNumber || "",
      firstName: parsed?.firstName || "",
      lastName: parsed?.lastName || "",
    });
    await flushDebugArtifacts();
    setPct(100);
    setPhase("done");
    setStatus(successText);
    scanRef.current=false;
    await safeTerminateWorker(worker);
    workerRef.current = null;
    setTimeout(()=>{
      try{
        strRef.current?.getTracks().forEach(t=>t.stop());
        onDone({...EMPTY_SCAN,...parsed});
      }catch(doneErr){
        console.error("[MRZ] onDone",doneErr);
        setPhase("failed");
        setStatus(t("Hata: {mesaj}", { mesaj: getSafeErrorMessage(doneErr) }));
      }
    },800);
    return true;
  };

  const createOcrWorker = async ()=>{
    const worker=await Tesseract.createWorker({
      workerPath: "/tess-worker.js",
      corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@4.0.4/tesseract-core.wasm.js",
      langPath: "/tessdata",
      logger: m=>{
        if(m.status==="loading tesseract core") setPct(8);
        if(m.status==="initializing tesseract") setPct(12);
        if(m.status==="loading language traineddata") setPct(15);
        if(m.status==="initialized tesseract") setPct(18);
        if(m.status==="recognizing text") setPct(20+Math.round(m.progress*60));
      },
    });
    // Önce SnapPass.Service'in MRZ modeli (mrzsp), olmazsa eski mrz modeli, en son eng
    let activeLang = "";
    for(const lang of ["mrzsp","mrz","eng"]){
      try{
        await worker.loadLanguage(lang);
        await worker.initialize(lang);
        activeLang = lang;
        break;
      }catch(modelErr){
        console.warn(`[MRZ] model '${lang}' load failed:`, modelErr);
        pushDebug("warn",`OCR modeli yuklenemedi: ${lang}`, { error:getSafeErrorMessage(modelErr) });
        if(lang === "eng") throw modelErr;
      }
    }
    await worker.setParameters({
      tessedit_pageseg_mode: "6",
      preserve_interword_spaces: "0",
      user_defined_dpi: "300",
    });
    workerRef.current=worker;
    console.log("[MRZ] OCR language:", activeLang);
    pushDebug("ocr","Worker hazir", { language:activeLang });
    return worker;
  };

  const parseSourceOnce = async (scanSource, worker, passLabel, mode="live")=>{
    const cvEl = canRef.current;
    const { rawCanvas:mrzRawCanvas, tightCanvas:mrzBandCanvas } = extractMrzBandDebugCanvases(scanSource);
    const bandLighting = analyzeCanvasLighting(mrzBandCanvas);
    queueDebugImageFile(`${passLabel}-mrz-raw`, mrzRawCanvas);
    queueDebugImageFile(`${passLabel}-mrz-tight`, mrzBandCanvas);
    pushDebug("crop","MRZ bandi hazir", {
      width: mrzBandCanvas.width,
      height: mrzBandCanvas.height,
      mean: Math.round(bandLighting.mean || 0),
      bright: Number((bandLighting.brightRatio || 0).toFixed(3)),
      dark: Number((bandLighting.darkRatio || 0).toFixed(3)),
    });
    if(window.MRZ_TEMPLATES){
      try{
        const tplLines = templateMatchMRZ(mrzBandCanvas);
        if(tplLines && tplLines.length >= 2){
          setOcrPreview(tplLines.join("\n"));
          pushDebug("template","Template satirlari bulundu", { lines:tplLines });
          const parsed = parseMRZ(tplLines);
          if(parsed && parsed.firstName && parsed.firstName.length >= 2 && parsed.lastName && parsed.lastName.length >= 2){
            if(!((parsed.lastName||"").length > 20 && !(parsed.lastName||"").includes(" "))){
              console.log("[MRZ-TPL] ✓ Başarılı!", parsed);
              return await finalizeParsed(parsed, worker, t("✓ MRZ okundu! ({etiket})", { etiket: passLabel }));
            }
          }
          pushDebug("template","Template parse reddedildi", { lines:tplLines });
        }else{
          pushDebug("template","Template satiri bulunamadi");
        }
      }catch(tplErr){ console.warn("[MRZ-TPL] error:", tplErr); pushDebug("warn","Template asamasi hata verdi", { error:getSafeErrorMessage(tplErr) }); }
    }

    try{
      const direct = buildDirectMrzLineCanvases(mrzBandCanvas);
      const directAttempts = [{ label:"dogrudan-satir-adaptif", canvases: direct.adaptiveLines }];
      if((direct.lighting?.brightRatio || 0) > 0.10 || (direct.lighting?.mean || 0) > 168){
        directAttempts.push({ label:"dogrudan-satir-gun", canvases: direct.glareReducedLines });
      }
      if((direct.lighting?.darkRatio || 0) > 0.10 || (direct.lighting?.mean || 0) < 118){
        directAttempts.push({ label:"dogrudan-satir-dusuk-isik", canvases: direct.lowLightLines });
      }
      directAttempts.push({ label:"dogrudan-satir-binary", canvases: direct.binaryLines });
      for(const directAttempt of directAttempts){
        setStatus(`${passLabel} — ${directAttempt.label}`);
        await worker.setParameters({
          tessedit_pageseg_mode: "7",
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
        });
        const rawLines = [];
        for(const lineCanvas of directAttempt.canvases){
          const {data:{text:lineText}} = await worker.recognize(lineCanvas);
          rawLines.push((lineText || "").replace(/\s+/g,""));
        }
        const normalizedLines = rawLines.flatMap(text => normalizeMrzText(text));
        const mrzLike = normalizedLines.filter(l=>l.includes("<") || /^[A-Z0-9]{24,}$/.test(l));
        setOcrPreview((mrzLike.length ? mrzLike : normalizedLines).slice(0,3).join("\n"));
        pushDebug("direct",`Dogrudan OCR denemesi: ${directAttempt.label}`, {
          rawLines,
          normalizedLines,
        });
        const directParsed = parseMRZ(normalizedLines);
        if(directParsed && directParsed.firstName && directParsed.lastName){
          return await finalizeParsed(directParsed, worker, t("✓ MRZ okundu! ({etiket})", { etiket: passLabel }));
        }
        pushDebug("direct",`Parse cikmadi: ${directAttempt.label}`);
      }
    }catch(directErr){
      console.warn("[MRZ-DIRECT] error:", directErr);
      pushDebug("warn","Dogrudan satir OCR hata verdi", { error:getSafeErrorMessage(directErr) });
    }

    const variants = mode === "photo"
      ? getFastMrzCanvases(mrzBandCanvas, cvEl)
      : buildMrzCanvases(mrzBandCanvas, cvEl);
    for(let vIdx=0; vIdx<variants.length; vIdx++){
      const variant = variants[vIdx];
      setStatus(`${passLabel} — ${variant.label}`);
      const varParams = { tessedit_pageseg_mode: variant.psm || "6" };
      if(variant.useWhitelist) varParams.tessedit_char_whitelist = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";
      else varParams.tessedit_char_whitelist = "";
      await worker.setParameters(varParams);
      let text = "";
      if(Array.isArray(variant.canvases) && variant.canvases.length){
        const parts = [];
        for(const lineCanvas of variant.canvases){
          const {data:{text:lineText}} = await worker.recognize(lineCanvas);
          parts.push(lineText || "");
        }
        text = parts.join("\n");
      }else{
        const {data:{text:singleText}}=await worker.recognize(variant.canvas);
        text = singleText || "";
      }
      console.log(`[MRZ] variant=${variant.label} raw:`, JSON.stringify(text.slice(0,300)));
      const lines = normalizeMrzText(text);
      console.log(`[MRZ] variant=${variant.label} lines:`,lines);
      const mrzLike = lines.filter(l=>l.includes("<") || /^[A-Z0-9]{28,}$/.test(l));
      setOcrPreview((mrzLike.length ? mrzLike : lines).slice(0,6).join("\n"));
      pushDebug("variant",`Fallback OCR: ${variant.label}`, { lines });

      const parsed=parseMRZ(lines);
      if(parsed && (!parsed.firstName || parsed.firstName.length < 2 || !parsed.lastName || parsed.lastName.length < 2)){
        console.warn("[MRZ] sanity fail — firstName/lastName geçersiz:", parsed.firstName, parsed.lastName);
        pushDebug("variant",`Reddedildi: ${variant.label} isim gecersiz`, { firstName:parsed.firstName || "", lastName:parsed.lastName || "" });
        continue;
      }
      if(parsed && (parsed.lastName||"").length > 20 && !(parsed.lastName||"").includes(" ")){
        console.warn("[MRZ] sanity fail — lastName çok uzun tek kelime:", parsed.lastName);
        pushDebug("variant",`Reddedildi: ${variant.label} soyad uzun`, { lastName:parsed.lastName || "" });
        continue;
      }
      if(parsed){
        return await finalizeParsed(parsed, worker, t("✓ MRZ okundu! ({etiket})", { etiket: passLabel }));
      }
      pushDebug("variant",`Parse cikmadi: ${variant.label}`);
    }

    // SnapPass.Service stratejisi: tam kare ve alt %40 ayrı okunur, MRZ'ye daha çok benzeyen metin parse edilir
    if(window.SnapPassMrz){
      try{
        setStatus(`${passLabel} — snappass-tam-kare`);
        await worker.setParameters({
          tessedit_pageseg_mode: "6",
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
        });
        const {data:{text:fullText}} = await worker.recognize(scanSource);
        setStatus(`${passLabel} — snappass-alt-40`);
        const {data:{text:cropText}} = await worker.recognize(cropBottomCanvas(scanSource, 0.4));
        const fullScore = window.SnapPassMrz.scoreMrzLikeness(fullText || "");
        const cropScore = window.SnapPassMrz.scoreMrzLikeness(cropText || "");
        const useCrop = cropScore > fullScore;
        const lines = normalizeMrzText((useCrop ? cropText : fullText) || "");
        setOcrPreview(lines.slice(0,3).join("\n"));
        pushDebug("snappass","SnapPass OCR denemesi", { strategy: useCrop ? "bottom-crop-40%" : "full-image", fullScore, cropScore, lines });
        const parsed = parseMRZ(lines);
        if(parsed && parsed.firstName && parsed.firstName.length >= 2 && parsed.lastName && parsed.lastName.length >= 2){
          return await finalizeParsed(parsed, worker, t("✓ MRZ okundu! ({etiket})", { etiket: passLabel }));
        }
        pushDebug("snappass","Parse cikmadi: snappass");
      }catch(spErr){
        console.warn("[MRZ-SNAPPASS] error:", spErr);
        pushDebug("warn","SnapPass OCR asamasi hata verdi", { error:getSafeErrorMessage(spErr) });
      }
    }

    pushDebug("error","Bu kareden MRZ parse edilemedi");
    return false;
  };

  // MRZ motoruyla (yerel araç ya da bulut) sürekli tarama: her turda en keskin kare seçilir; önce ham, gerekirse
  // yerel eşiklenmiş hali okunur. Tüm kontrol haneleri tutunca ya da süre dolunca biter.
  const SERVER_SCAN_MS = 14000;
  const readWithServer = async (canvas)=>{
    const image = canvas.toDataURL("image/jpeg", 0.92);
    // Önce terminaldeki yerel OCR aracı (görüntü bilgisayardan çıkmaz)
    if(await ocrAgentAvailable()){
      try{
        const res = await fetch(`${OCR_AGENT_URL}/mrz/scan`, {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body:JSON.stringify({ image }),
        });
        if(res.ok) return { ...(await res.json()), source:"agent" };
        pushDebug("agent","Yerel OCR araci hata verdi", { status:res.status });
      }catch(e){
        pushDebug("agent","Yerel OCR aracina ulasilamadi", { error:getSafeErrorMessage(e) });
        ocrAgentState = false;
      }
    }
    try{
      const res = await fetch(`${PROXY}/api/mrz/scan`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ image }),
      });
      const r = await res.json().catch(()=>({}));
      if(res.status === 503){ pushDebug("server","MRZ motoru yapilandirilmamis"); return "unavailable"; }
      if(!res.ok){ pushDebug("server","MRZ motoru hata verdi", { error:r.error || res.status }); return res.status === 502 ? "unavailable" : null; }
      return r;
    }catch(e){
      pushDebug("server","MRZ motoruna ulasilamadi", { error:getSafeErrorMessage(e) });
      return "unavailable";
    }
  };

  const runServerScanLoop = async (vid)=>{
    const started = Date.now();
    let best = null, lastFrame = null, round = 0;
    while(scanRef.current && Date.now() - started < SERVER_SCAN_MS){
      round++;
      // 3 kare çek, en keskinini seç (elde tutarken bulanık kareleri eler)
      let pick = null;
      for(let i=0; i<3; i++){
        const frame = stageRef.current ? cropVideoToGuide(vid, stageRef.current) : captureVideoFrameToCanvas(vid);
        const quality = scoreMrzFrameQuality(frame);
        if(!pick || quality > pick.quality) pick = { frame, quality };
        if(i < 2) await wait(90);
      }
      lastFrame = pick.frame;
      setStatus(round === 1 ? t("Okunuyor… kartı sabit tutun") : t("Okunuyor… kartı sabit tutun ({n}. deneme)", { n: round }));
      setPct(Math.min(95, 10 + Math.round(((Date.now() - started) / SERVER_SCAN_MS) * 85)));
      for(const variant of ["ham", "esik"]){
        const image = variant === "ham" ? pick.frame : adaptiveThresholdCanvas(pick.frame, pick.frame.width > 1000 ? 0.6 : 1);
        const r = await readWithServer(image);
        if(r === "unavailable") return best ? { status:"ok", ...best } : { status:"unavailable" };
        if(!r) continue;
        const valid = r.checksum?.validCount || 0;
        const total = r.checksum?.totalCount || 0;
        const lines = String(r.rawMrz || "").split("\n").map(l=>l.trim()).filter(Boolean);
        pushDebug("server","OCR sonucu", { source:r.source || "cloud", round, variant, quality:Number(pick.quality.toFixed(1)), valid, total, lines });
        if(lines.length) setOcrPreview(lines.join("\n"));
        if(valid < 2 || !lines.length) continue;
        const parsed = parseMRZ(lines);
        if(!parsed || !parsed.firstName || !parsed.lastName) continue;
        if(!best || valid > best.valid) best = { valid, total, parsed, frame:pick.frame };
        if(valid >= total) break;
      }
      if(best && (best.valid >= best.total || best.valid >= 3)) break;
    }
    if(lastFrame) queueDebugImageFile("best-frame", best?.frame || lastFrame);
    return best ? { status:"ok", ...best } : { status:"failed" };
  };

  const runSnapshotMrzScan = async (actionLabel=t("Net kare"))=>{
    if(!tLoaded || !camOk) return;
    const vid = vidRef.current;
    if(!vid || !vid.videoWidth) return;
    setPhase("scanning");
    scanRef.current=true;
    setPct(5);
    setStatus(t("Kamera netleniyor…"));
    setOcrPreview("");
    setDebugLogs([]);
    pushDebug("scan","Snapshot tarama basladi", { action:actionLabel });
    let worker = null;
    try{
      // Önce SnapPass.Service MRZ motoru (sunucu)
      const server = await runServerScanLoop(vid);
      if(server.status === "ok"){
        pushDebug("scan","MRZ motoru sonucu kabul edildi", { valid:server.valid, total:server.total });
        return await finalizeParsed(server.parsed, null, t("✓ MRZ okundu!"));
      }
      if(server.status === "failed"){
        setPct(100);
        setPhase("failed");
        setStatus(t("MRZ okunamadı — kartı çerçevede sabit tutun, ışığı artırın ya da manuel giriş yapın"));
        pushDebug("error","MRZ motoru sure icinde okuyamadi");
        await flushDebugArtifacts();
        scanRef.current=false;
        return;
      }
      // Motor yoksa: tarayıcı içi okuma (tesseract.js)
      const workerPromise = createOcrWorker();
      await wait(120);
      const burst = [];
      const burstCount = 3;
      for(let i=0; i<burstCount; i++){
        if(!scanRef.current) return;
        setPct(8 + Math.round(((i + 1) / burstCount) * 18));
        setStatus(t("En net kare seçiliyor… ({i}/{n})", { i: i+1, n: burstCount }));
        const sourceCanvas = stageRef.current ? cropVideoToGuide(vid, stageRef.current) : captureVideoFrameToCanvas(vid);
        const correctedCanvas = cvLoaded ? detectPerspectiveCorrectedCanvas(sourceCanvas) : null;
        if(correctedCanvas) correctedCanvas.isCardCrop = true;
        const scanSource = correctedCanvas || sourceCanvas;
        const quality = scoreMrzFrameQuality(scanSource);
        burst.push({ scanSource, quality });
        pushDebug("frame","Aday kare alindi", {
          index:i+1,
          quality:Number(quality.toFixed(2)),
          corrected:!!correctedCanvas,
          width:(scanSource.videoWidth || scanSource.width || 0),
          height:(scanSource.videoHeight || scanSource.height || 0),
        });
        if(correctedCanvas){
          console.log("[MRZ] still-frame perspective normalized:", correctedCanvas.width, correctedCanvas.height, "quality=", quality);
        }else{
          console.log("[MRZ] still-frame raw quality=", quality);
        }
        if(i < burstCount - 1) await wait(80);
      }

      burst.sort((a,b)=>b.quality - a.quality);
      pushDebug("frame","En iyi kareler secildi", {
        best: burst.slice(0,2).map((item, idx)=>({ rank:idx+1, quality:Number(item.quality.toFixed(2)) }))
      });
      const candidates = burst.slice(0, 2);
      candidates.forEach((candidate, idx)=>{
        queueDebugImageFile(`best-frame-${idx+1}`, candidate.scanSource);
      });
      worker = await workerPromise;
      for(let i=0; i<candidates.length; i++){
        const label = i === 0 ? actionLabel : t("Yedek kare {n}", { n: i+1 });
        pushDebug("scan","Kare parse ediliyor", { label, quality:Number(candidates[i].quality.toFixed(2)) });
        const success = await parseSourceOnce(candidates[i].scanSource, worker, label, "photo");
        if(success) return;
      }
      setPct(100);
      setPhase("failed");
      setStatus(t("MRZ okunamadı — net kareyi yeniden alın ya da manuel giriş yapın"));
      pushDebug("error","Tarama sonunda parse cikmadi");
      await flushDebugArtifacts();
      scanRef.current=false;
      await safeTerminateWorker(worker);
      workerRef.current = null;
    }catch(e){
      console.error("[MRZ-STILL]",e);
      setPhase("failed");
      setStatus(t("Hata: {mesaj}", { mesaj: getSafeErrorMessage(e) }));
      pushDebug("error","Snapshot tarama exception", { error:getSafeErrorMessage(e) });
      await flushDebugArtifacts();
      scanRef.current=false;
      await safeTerminateWorker(worker);
      workerRef.current = null;
    }
  };

  const captureStillFrame = async ()=>{
    await runSnapshotMrzScan(t("Net kare"));
  };

  const startScan=async()=>{
    await runSnapshotMrzScan(t("MRZ taraması"));
  };

  const skipToManual=()=>{ strRef.current?.getTracks().forEach(t=>t.stop()); onDone({...EMPTY_SCAN,firstName:guest.firstName,lastName:guest.lastName}); };
  // Ekrandaki kart çerçevesi ve içindeki MRZ bölgesi (piksel)
  const mrzArea = guide ? {
    left: guide.left + guide.width * CARD_MRZ_BOX.sx,
    top: guide.top + guide.height * CARD_MRZ_BOX.sy,
    width: guide.width * CARD_MRZ_BOX.sw,
    height: guide.height * CARD_MRZ_BOX.sh,
  } : null;
  return(
    <div style={{minHeight:"100dvh",background:"#09111F",display:"flex",flexDirection:"column"}}>
      <style>{GS}</style>
      <TopBar session={session} onBack={()=>{strRef.current?.getTracks().forEach(t=>t.stop());onBack();}}
        onLogout={onLogout&&(()=>{strRef.current?.getTracks().forEach(t=>t.stop());onLogout();})}/>
      <div style={{background:`linear-gradient(90deg,#1B3C6D,${S.navy2})`,padding:"10px 18px"}}>
        <div style={{maxWidth:700,margin:"0 auto",display:"flex",alignItems:"center",gap:10}}>
          <Avt f={guest.firstName} l={guest.lastName} sz={34}/><div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:800,color:"#fff"}}>{guest.firstName} {guest.lastName}</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.4)"}}>{guest.confirmationNo}</div></div>
          <span style={{fontSize:11,color:S.orangeLt,fontWeight:800,background:"rgba(247,148,29,.16)",padding:"3px 10px",borderRadius:10}}>{t("TARAMA")}</span>
        </div>
      </div>
      <div ref={stageRef} style={{height:scanStageHeight,position:"relative",overflow:"hidden",flexShrink:0}}>
        {camOk?<video ref={vidRef} autoPlay playsInline muted style={{width:"100%",height:"100%",objectFit:"cover"}}/>
          :<div style={{width:"100%",minHeight:340,height:"100%",background:"#111827",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14}}>
            <div style={{fontSize:48}}>📷</div>
            <p style={{color:"rgba(255,255,255,.35)",fontSize:13,textAlign:"center",padding:"0 30px"}}>
              {insecureCameraContext
                ? t("Kamera kullanılamıyor — mobilde HTTPS gerekli")
                : t("Kamera kullanılamıyor — simülasyon modu")}
            </p>
            {insecureCameraContext && <p style={{color:"rgba(255,255,255,.28)",fontSize:11,textAlign:"center",padding:"0 28px",lineHeight:1.5}}>
              {t("Telefonda kamera için sayfanın HTTPS adresinden açılması gerekir.")}
            </p>}
            <div style={{width:290,height:180,border:`2px dashed ${S.blue}44`,borderRadius:10,background:`${S.blue}07`,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{color:"rgba(255,255,255,.18)",fontSize:12}}>{t("Belge Alanı")}</span>
            </div>
          </div>}
        {guide&&mrzArea&&<div style={{position:"absolute",inset:0,pointerEvents:"none"}}>
          {/* Kart çerçevesi; dışı karartılır */}
          <div style={{position:"absolute",left:guide.left,top:guide.top,width:guide.width,height:guide.height,borderRadius:14,border:"2px solid rgba(255,255,255,.8)",boxShadow:"0 0 0 9999px rgba(5,10,20,.42)"}}/>
          {[["top","left"],["top","right"],["bottom","left"],["bottom","right"]].map(([v,h])=>(
            <div key={v+h} style={{position:"absolute",
              left:h==="left" ? guide.left - 3 : guide.left + guide.width - 31,
              top:v==="top" ? guide.top - 3 : guide.top + guide.height - 31,
              width:34,height:34,
              borderTop:v==="top"?`4px solid ${S.blue}`:"none",borderBottom:v==="bottom"?`4px solid ${S.blue}`:"none",
              borderLeft:h==="left"?`4px solid ${S.blue}`:"none",borderRight:h==="right"?`4px solid ${S.blue}`:"none",
              borderRadius:`${v==="top"&&h==="left"?"14px":"0"} ${v==="top"&&h==="right"?"14px":"0"} ${v==="bottom"&&h==="right"?"14px":"0"} ${v==="bottom"&&h==="left"?"14px":"0"}`
            }}/>
          ))}
          {/* MRZ bölgesi: kartın alt kısmı */}
          <div style={{position:"absolute",left:mrzArea.left,top:mrzArea.top,width:mrzArea.width,height:mrzArea.height,border:"2px dashed rgba(247,148,29,.9)",background:"rgba(247,148,29,.08)",borderRadius:10}}/>
          <div style={{position:"absolute",left:mrzArea.left + 8,top:mrzArea.top + 6,background:"rgba(9,17,31,.78)",color:S.orangeLt,fontSize:10,fontWeight:800,padding:"3px 8px",borderRadius:999,letterSpacing:".4px"}}>{t("MRZ (‹‹‹ satırları)")}</div>
          {phase==="scanning"&&<div style={{position:"absolute",left:mrzArea.left,width:mrzArea.width,height:2,top:mrzArea.top + (pct / 100) * mrzArea.height,background:`linear-gradient(90deg,transparent,${S.orange},${S.orangeLt},transparent)`,boxShadow:`0 0 10px ${S.orange}`,transition:"top .1s linear"}}/>}
          <div className="scan-hint" style={{position:"absolute",top:guide.top + 12,left:"50%",transform:"translateX(-50%)",background:"rgba(0,0,0,.7)",color:"rgba(255,255,255,.9)",fontSize:12,padding:"5px 16px",borderRadius:20,whiteSpace:"nowrap",backdropFilter:"blur(6px)",fontWeight:700}}>
            {phase==="ready"?t("Kartı / pasaport sayfasını çerçeveye sığdırın"):phase==="scanning"?status:t("✓ Tarama tamamlandı!")}
          </div>
        </div>}
        {phase==="scanning"&&<div style={{position:"absolute",bottom:0,left:0,right:0,height:3,background:"rgba(255,255,255,.07)"}}><div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,${S.blue},${S.orange})`,transition:"width .14s"}}/></div>}
      </div>
      <div className="scan-controls" style={{background:"rgba(9,17,31,.92)",backdropFilter:"blur(10px)",padding:"20px 24px",borderTop:"1px solid rgba(255,255,255,.07)",textAlign:"center"}}>
        {/* Canvas: frame yakalamak için gizli */}
        <canvas ref={canRef} style={{display:"none"}}/>

        {(phase==="ready"||!tLoaded)&&<>
          <button onClick={startScan} disabled={!camOk} style={{width:70,height:70,borderRadius:"50%",background:tLoaded?`linear-gradient(135deg,${S.blue},${S.navy})`:"#334",border:"4px solid rgba(255,255,255,.18)",color:"#fff",fontSize:26,cursor:"pointer",animation:tLoaded?"pulse 2s infinite":"none",display:"inline-flex",alignItems:"center",justifyContent:"center"}}>
            {tLoaded?"📸":<Spin sz={24}/>}
          </button>
          <p style={{color:"rgba(255,255,255,.32)",fontSize:12,marginTop:8,fontWeight:600}}>{tLoaded?t("MRZ taramak için dokun"):t("Okuma motoru yükleniyor…")}</p>
          <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap",marginTop:8}}>
            {camOk&&<button onClick={captureStillFrame} style={{background:"transparent",border:"1px solid rgba(255,255,255,.24)",color:"rgba(255,255,255,.82)",borderRadius:8,padding:"8px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>{t("Net Kare Al")}</button>}
            {camOk&&torch.supported&&<button onClick={toggleTorch} style={{background:torch.on?"rgba(247,148,29,.22)":"transparent",border:`1px solid ${torch.on?"rgba(247,148,29,.6)":"rgba(255,255,255,.24)"}`,color:torch.on?S.orangeLt:"rgba(255,255,255,.82)",borderRadius:8,padding:"8px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>🔦 {torch.on?t("Işığı Kapat"):t("Işık Aç")}</button>}
            {!camOk&&<button onClick={skipToManual} style={{background:"transparent",border:"1px solid rgba(255,255,255,.2)",color:"rgba(255,255,255,.5)",borderRadius:8,padding:"8px 14px",fontSize:12,cursor:"pointer"}}>{t("Manuel Giriş →")}</button>}
          </div>
        </>}
        {phase==="scanning"&&<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:10,color:"#fff",fontSize:14,fontWeight:700}}><Spin sz={18}/> {status}</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.35)"}}>%{Math.round(pct)}</div>
          {camOk&&torch.supported&&<button onClick={toggleTorch} style={{background:torch.on?"rgba(247,148,29,.22)":"transparent",border:`1px solid ${torch.on?"rgba(247,148,29,.6)":"rgba(255,255,255,.24)"}`,color:torch.on?S.orangeLt:"rgba(255,255,255,.82)",borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}}>🔦 {torch.on?t("Işığı Kapat"):t("Işık Aç")}</button>}
          {ocrPreview&&<pre style={{maxWidth:620,whiteSpace:"pre-wrap",wordBreak:"break-all",textAlign:"left",background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.12)",borderRadius:8,padding:"6px 10px",color:"rgba(255,255,255,.7)",fontSize:10,lineHeight:1.4,margin:0,maxHeight:80,overflow:"auto"}}>{ocrPreview}</pre>}
          {SHOW_MRZ_DEBUG_UI&&!!debugLogs.length&&<pre style={{maxWidth:700,width:"100%",whiteSpace:"pre-wrap",wordBreak:"break-word",textAlign:"left",background:"rgba(6,12,22,.72)",border:"1px solid rgba(74,144,217,.22)",borderRadius:10,padding:"10px 12px",color:"#BFD8FF",fontSize:10.5,lineHeight:1.5,margin:0,maxHeight:160,overflow:"auto"}}>{debugLogs.slice(-8).join("\n")}</pre>}
        </div>}
        {phase==="done"&&<div style={{display:"inline-flex",alignItems:"center",gap:8,color:S.green,fontSize:15,fontWeight:800}}><span style={{fontSize:20}}>✓</span> {t("MRZ okundu!")}</div>}
        {phase==="failed"&&<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
          <div style={{color:"#FCA5A5",fontSize:13,fontWeight:700}}>⚠ {status}</div>
          {ocrPreview&&<pre style={{maxWidth:620,whiteSpace:"pre-wrap",wordBreak:"break-word",textAlign:"left",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,padding:"10px 12px",color:"rgba(255,255,255,.78)",fontSize:11,lineHeight:1.5,margin:0}}>{ocrPreview}</pre>}
          {SHOW_MRZ_DEBUG_UI&&!!debugLogs.length&&<pre style={{maxWidth:700,width:"100%",whiteSpace:"pre-wrap",wordBreak:"break-word",textAlign:"left",background:"rgba(6,12,22,.72)",border:"1px solid rgba(252,165,165,.24)",borderRadius:10,padding:"10px 12px",color:"#D7E5FF",fontSize:10.5,lineHeight:1.5,margin:0,maxHeight:220,overflow:"auto"}}>{debugLogs.join("\n")}</pre>}
          <div style={{display:"flex",gap:10,flexWrap:"wrap",justifyContent:"center"}}>
            <button onClick={resetScanState} style={{background:"#fff",color:S.navy,border:`1px solid ${S.border}`,borderRadius:9,padding:"10px 22px",fontSize:13,fontWeight:700,cursor:"pointer"}}>{t("Yeniden Tara")}</button>
            {camOk&&<button onClick={captureStillFrame} style={{background:"transparent",color:"#fff",border:"1px solid rgba(255,255,255,.2)",borderRadius:9,padding:"10px 22px",fontSize:13,fontWeight:700,cursor:"pointer"}}>{t("Net Kare Al")}</button>}
            <button onClick={skipToManual} style={{background:`linear-gradient(135deg,${S.blue},${S.navy})`,color:"#fff",border:"none",borderRadius:9,padding:"10px 22px",fontSize:13,fontWeight:700,cursor:"pointer"}}>{t("Manuel Devam Et →")}</button>
          </div>
        </div>}
      </div>
    </div>
  );
}

/* ── YİNELENEN PROFİL İLETİŞİM KUTUSU ─────────────────────────────────────── */
// Sistemde aynı kimlik no / ad+soyad ile profil varsa gösterilir. Telefonda alttan açılan sayfa, bilgisayarda ortada kutu.
// Eşleşen profil kartındaki yetkiye bağlı işlemler: birleştir (kalacak profil seçilir) / rezervasyonun ana ya da beraberindeki profilini değiştir.
// ctx: {session, profileId, name, reservationId, isAccompany, onChanged}
function DupActions({ m, ctx }){
  const u=ctx.session||{};
  const canMerge=!!u.canMerge&&ctx.profileId&&String(ctx.profileId)!==String(m.id);
  const canChg=ctx.reservationId&&String(ctx.profileId)!==String(m.id)&&(ctx.isAccompany?!!u.canChangeAccompany:!!u.canChangeMain);
  const [keepListed,setKeepListed]=useState(true); // true: listedeki profil kalır, rezervasyondaki birleşir
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  if(!canMerge&&!canChg) return null;
  const cur=`${ctx.name||""} #${ctx.profileId}`.trim();
  const lst=`${m.firstName} ${m.lastName} #${m.id}`.trim();
  const post=async(path,body)=>{
    const res=await fetch(`${PROXY}${path}`,{method:"POST",headers:{"Content-Type":"application/json","x-csrf":serverCsrf},body:JSON.stringify(body)});
    const d=await res.json().catch(()=>({}));
    if(!res.ok||d.error) throw new Error(d.error||`HTTP ${res.status}`);
    return d;
  };
  const run=async(fn)=>{ setBusy(true); setErr(""); try{ await fn(); ctx.onChanged&&ctx.onChanged(); }catch(e){ setErr(e.message); setBusy(false); } };
  const merge=async()=>{
    const survivor=keepListed?m:{id:ctx.profileId,firstName:ctx.name||"",lastName:""};
    const victim=keepListed?{id:ctx.profileId,firstName:ctx.name||"",lastName:""}:m;
    const sTxt=keepListed?lst:cur, vTxt=keepListed?cur:lst;
    if(!await askConfirm(t("Profiller birleştirilsin mi?\n\nKalacak profil: {s}\nBirleşip kaybolacak profil: {v}\n\nBu işlem OPERA'da geri alınamaz.",{s:sTxt,v:vTxt}))) return;
    if(!await askConfirm(t("Son onay: {v} profili {s} içine birleştirilecek. Emin misiniz?",{s:sTxt,v:vTxt}))) return;
    const full=x=>`${x.firstName||""} ${x.lastName||""}`.trim();
    await run(()=>post("/api/profile-merge",{survivorId:survivor.id,victimId:victim.id,survivorName:full(survivor),victimName:full(victim),reservationId:ctx.reservationId||""}));
  };
  const change=async()=>{
    const what=ctx.isAccompany?t("beraberindeki"):t("ana");
    if(!await askConfirm(t("Rezervasyonun {w} profili değiştirilsin mi?\n\nŞimdiki: {c}\nYeni: {n}\n\nSadece misafir profili değişir; yetişkin / çocuk sayısı, oda ve fiyat değişmez.",{w:what,c:cur,n:lst}))) return;
    await run(()=>post("/api/reservation-profile",ctx.isAccompany
      ?{mode:"accompany",reservationId:ctx.reservationId,newProfileId:m.id,oldProfileId:ctx.profileId,newName:`${m.firstName} ${m.lastName}`.trim(),oldName:ctx.name||""}
      :{mode:"main",reservationId:ctx.reservationId,newProfileId:m.id,newName:`${m.firstName} ${m.lastName}`.trim(),oldName:ctx.name||""}));
  };
  const btn={width:"100%",minHeight:42,background:"#fff",color:S.blue,border:`1.5px solid ${S.blue}66`};
  return(
    <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:8}}>
      {canChg&&<button type="button" className="btn" disabled={busy} onClick={change} style={btn}>{ctx.isAccompany?t("Beraberindeki profili bununla değiştir"):t("Rezervasyonun ana profilini bununla değiştir")}</button>}
      {canMerge&&<div style={{border:`1px dashed ${S.border}`,borderRadius:10,padding:8}}>
        <div style={{fontSize:12,color:S.muted,marginBottom:6}}>{t("Kalacak profil")}:</div>
        <div style={{display:"flex",gap:6,marginBottom:8}}>
          <button type="button" className="btn" onClick={()=>setKeepListed(true)} style={{flex:1,minHeight:38,fontSize:12,fontWeight:700,background:keepListed?S.blue:"#fff",color:keepListed?"#fff":S.navy,border:`1.5px solid ${S.blue}66`}}>{t("Listedeki")} #{m.id}</button>
          <button type="button" className="btn" onClick={()=>setKeepListed(false)} style={{flex:1,minHeight:38,fontSize:12,fontWeight:700,background:!keepListed?S.blue:"#fff",color:!keepListed?"#fff":S.navy,border:`1.5px solid ${S.blue}66`}}>{t("Rezervasyondaki")} #{ctx.profileId}</button>
        </div>
        <button type="button" className="btn" disabled={busy} onClick={merge} style={btn}>{busy?<Spin/>:t("Profilleri birleştir")}</button>
      </div>}
      {err&&<div style={{fontSize:12,color:S.red||"#C0392B"}}>{err}</div>}
    </div>
  );
}

function DuplicateDialog({ matches, title, note, rule, canUse, forceLabel, ctx, onUse, onForce, onCancel }){
  return(
    <div className="dup-overlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="dup-panel" onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:16,fontWeight:800,color:S.navy,marginBottom:4}}>{title}</div>
        <p style={{fontSize:13,color:S.muted,marginBottom:8,lineHeight:1.5}}>{note}</p>
        {rule&&<p style={{fontSize:12,color:S.muted,margin:"0 0 12px",lineHeight:1.5,padding:"8px 10px",background:"#F6F9FD",border:`1px solid ${S.border}`,borderRadius:8}}>ℹ️ <b>{t("Eşleşme koşulu")}:</b> {rule}</p>}
        {matches.slice(0,5).map(m=>(
          <div key={m.id} style={{border:`1.5px solid ${S.border}`,borderRadius:12,padding:12,marginBottom:10,background:"#F9FBFF"}}>
            <div style={{fontWeight:800,color:S.navy,fontSize:15}}>{m.firstName} {m.lastName} <span style={{fontSize:11,color:S.muted,fontFamily:"monospace",fontWeight:600}}>#{m.id}</span></div>
            <div style={{fontSize:13,color:S.muted,marginTop:4,display:"flex",flexWrap:"wrap",gap:"4px 12px"}}>
              <span>🎂 {fmtDateTR(m.birthDate)||"—"}</span>
              <span>🌍 {m.nationality||"—"}</span>
              {m.idNumber&&<span>🪪 {idTypeLabel({v:m.idType,l:m.idType||"ID"})}: <b style={{color:S.navy}}>{m.idNumber}</b></span>}
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
              {m.reasons.map(r=><span key={r} style={{fontSize:11,fontWeight:700,color:S.orangeDk,background:"#FFF7ED",border:`1px solid ${S.orange}44`,borderRadius:999,padding:"2px 9px"}}>{t("Eşleşen:")} {t(r)}</span>)}
            </div>
            {canUse&&<button type="button" className="btn btn-p" onClick={()=>onUse(m)} style={{width:"100%",marginTop:10,minHeight:46}}>{t("Bu profili kullan")}</button>}
            {ctx&&<DupActions m={m} ctx={ctx}/>}
          </div>
        ))}
        {matches.length>5&&<p style={{fontSize:12,color:S.muted,margin:"0 0 8px"}}>{t("… ve")} {matches.length-5} {t("eşleşen profil daha (en alakalı 5 gösteriliyor)")}</p>}
        <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:6}}>
          <button type="button" className="btn" onClick={onForce} style={{minHeight:46,background:"#fff",color:S.blue,border:`1.5px solid ${S.blue}66`}}>{forceLabel}</button>
          <button type="button" className="btn" onClick={onCancel} style={{minHeight:46,background:"transparent",color:S.muted}}>{t("Vazgeç")}</button>
        </div>
      </div>
    </div>
  );
}

/* ── DOC FORM ─────────────────────────────────────────────────────────────── */
function DocForm({guest,scan,session,onSubmit,onBack,onLogout,manual}){
  const pd = guest?.profileDetails;
  const scanCountry = normalizeCountryCode(scan?.nationality || scan?.issuingCountry || "");
  const profileCountry = normalizeCountryCode(pd?.nationality || pd?.issuingCountry || "");
  const resolvedGender = pickFieldValue(scan?.gender === "U" ? "" : (scan?.gender || ""), pd?.gender || "", "M");
  const resolvedDocType = normalizeDocType(pickFieldValue(scan?.documentType, pd?.idType, "PASSPORT")) || "PASSPORT";
  const isTcknDoc = resolvedDocType === "TCKN";
  const safeScanDocNumber = isValidTurkishIdentityNumber(scan?.documentNumber || "") ? String(scan.documentNumber).trim() : "";
  const safeProfileDocNumber = isValidTurkishIdentityNumber(pd?.documentNumber || "") ? String(pd.documentNumber).trim() : "";
  const resolvedNationality = isTcknDoc ? "TR" : toIso2(pickFieldValue(scanCountry, profileCountry));
  const resolvedIssuingCountry = isTcknDoc ? "TR" : pickFieldValue(
    normalizeCountryCode(scan?.issuingCountry || ""),
    normalizeCountryCode(pd?.issuingCountry || ""),
    resolvedNationality
  );
  // TCKN taramasında eski profil verisi karışmasın (yalnız tarama); taramasız düzenlemede profil değerleri esas alınır
  const scanOnly = isTcknDoc && !manual;
  const resolvedBirthPlace = scanOnly
    ? normalizeBirthPlace(scan?.birthPlace || "", "TR")
    : normalizeBirthPlace(
        pickFieldValue(scan?.birthPlace, pd?.birthPlace),
        resolvedNationality || resolvedIssuingCountry
      );
  const [f,setF]=useState(()=>applyNationalityRules({
    ...scan,
    firstName:      scanOnly ? pickFieldValue(scan?.firstName) : pickFieldValue(scan?.firstName, pd?.firstName, guest?.firstName),
    middleName:     scanOnly ? pickFieldValue(scan?.middleName) : pickFieldValue(scan?.middleName, pd?.middleName),
    lastName:       scanOnly ? pickFieldValue(scan?.lastName) : pickFieldValue(scan?.lastName, pd?.lastName, guest?.lastName),
    dateOfBirth:    scanOnly ? pickFieldValue(scan?.dateOfBirth) : pickFieldValue(scan?.dateOfBirth, pd?.birthDate),
    birthPlace:     resolvedBirthPlace,
    gender:         resolvedGender || "M",
    nationality:    resolvedNationality,
    documentType:   resolvedDocType,
    documentNumber: isTcknDoc
      ? pickFieldValue(safeScanDocNumber, safeProfileDocNumber)
      : pickFieldValue(scan?.documentNumber, pd?.documentNumber),
    issuingCountry: resolvedIssuingCountry,
    issuedDate:     scanOnly ? pickFieldValue(scan?.issuedDate) : pickFieldValue(scan?.issuedDate, pd?.issuedDate),
    expiryDate:     scanOnly ? pickFieldValue(scan?.expiryDate) : pickFieldValue(scan?.expiryDate, pd?.expiryDate),
    issuedPlace:    scanOnly ? pickFieldValue(scan?.issuedPlace) : pickFieldValue(scan?.issuedPlace, pd?.issuedPlace),
  }, resolvedNationality, scan?.idNumber));
  const [busy,setBusy]=useState(false),[done,setDone]=useState(false);
  const [submitErr, setSubmitErr]=useState("");
  const [idTypeOpts,setIdTypeOpts]=useState([{v:"PASSPORT",l:"Pasaport"},{v:"TCKN",l:"TCKN"}]);
  useEffect(()=>{
    if(!session?.hostName||!session?.appKey||!session?.token) return;
    fetch(`/api/id-types?hostName=${encodeURIComponent(session.hostName)}&hotelId=${encodeURIComponent(session.hotelId||"")}&appKey=${encodeURIComponent(session.appKey)}&token=${encodeURIComponent(session.token)}`)
      .then(r=>r.json()).then(d=>{
        if(d.opts&&d.opts.length>0) setIdTypeOpts(d.opts);
      }).catch(()=>{});
  },[]);
  // Uyruk değişince belge tipi uyruğa uydurulur (TR → TCKN)
  const set=k=>v=>setF(p=>k==="nationality" ? applyNationalityRules(p,v) : ({...p,[k]:v}));
  // Uyruk TR ise yalnız belge tipi (TCKN) ve belge numarası zorunlu; diğer uyruklarda kişisel alanların hepsi zorunlu
  const [dateBad,setDateBad]=useState(false);
  const isTR = f.nationality === "TR";
  const personalRequired = !isTR;
  const birthPlaceRequired = personalRequired;
  const countryOpts = window.IsoCountries ? window.IsoCountries.options(f.nationality, CUR_LANG) : null;
  const docTypeOpts = isTR ? turkishIdTypeOpts() : idTypeOpts.map(o=>({...o,l:idTypeLabel(o)}));
  const [dup,setDup]=useState(null); // aynı kimlik numarası başka profilde varsa uyarı
  const submit=async(skipDup=false)=>{
    if(dateBad){setSubmitErr(t("Geçerli bir doğum tarihi girin (GG.AA.YYYY)"));return;}
    if(!f.nationality){setSubmitErr(t("Uyruk seçin"));return;}
    if(isTR && f.documentType!=="TCKN"){setSubmitErr(t("T.C. vatandaşı için belge tipi T.C. kimlik (TCKN) olmalı"));return;}
    if(!f.documentNumber){setSubmitErr(t("Belge numarası zorunlu"));return;}
    if(f.documentType==="TCKN"){
      const tc=String(f.documentNumber).replace(/\s/g,"");
      if(!/^\d{11}$/.test(tc)){setSubmitErr(t("TC kimlik no 11 haneli olmalı."));return;}
      if(!isValidTckn(tc)){setSubmitErr(t("TC kimlik no geçersiz (T.C. kimlik no doğrulama kuralına uymuyor)."));return;}
    }
    if(personalRequired){
      if(!String(f.firstName||"").trim()){setSubmitErr(t("Ad zorunlu"));return;}
      if(!String(f.lastName||"").trim()){setSubmitErr(t("Soyad zorunlu"));return;}
      if(!f.dateOfBirth){setSubmitErr(t("Doğum tarihi zorunlu"));return;}
      if(!String(f.birthPlace||"").trim()){setSubmitErr(t("T.C. vatandaşı olmayanlar için doğum yeri zorunlu"));return;}
    }
    setBusy(true);setSubmitErr("");
    // Kimlik numarası değiştiyse (ya da profilde hiç yoksa): aynı numara başka bir profilde kayıtlı mı?
    const idChanged = String(f.documentNumber||"").trim() !== String(pd?.documentNumber||"").trim();
    if(!skipDup && idChanged){
      const matches = await findDuplicates({
        hostName:session.hostName, hotelId:session.hotelId, appKey:session.appKey, token:session.token,
        excludeProfileId:guest.guestId,
        criteria:{ identificationNo:String(f.documentNumber).trim() },
      });
      if(matches.length){ setBusy(false); setDup({matches}); return; }
    }
    try{
      const identId = guest?.profileDetails?.identId;
      // Her zaman Step 1: personName, birthDate, gender, nationality, birthPlace güncelle
      await putProfile({
        hostName:  session.hostName,
        hotelId:   session.hotelId,
        appKey:    session.appKey,
        token:     session.token,
        profileId: guest.guestId,
        docData:   f,
        changed:   (()=>{ const d10=v=>String(v||"").slice(0,10); return changedKeys(
          {firstName:pd?.firstName||guest?.firstName,middleName:pd?.middleName,lastName:pd?.lastName||guest?.lastName,dateOfBirth:d10(pd?.birthDate),birthPlace:pd?.birthPlace,documentNumber:pd?.documentNumber,issuedDate:d10(pd?.issuedDate),expiryDate:d10(pd?.expiryDate),issuedPlace:pd?.issuedPlace},
          {...f,dateOfBirth:d10(f.dateOfBirth),issuedDate:d10(f.issuedDate),expiryDate:d10(f.expiryDate)},
          ["firstName","middleName","lastName","dateOfBirth","birthPlace","documentNumber","issuedDate","expiryDate","issuedPlace"]); })(),
      });
      // Step 2: Identification güncelle veya yeni ekle
      await putIdentification({
        hostName:  session.hostName,
        hotelId:   session.hotelId,
        appKey:    session.appKey,
        token:     session.token,
        profileId: guest.guestId,
        identId:   identId || null,
        docData:   f,
      });
      setDone(true);
      setTimeout(()=>onSubmit(f), 1800);
    }catch(e){
      setSubmitErr(e.message);
      setBusy(false);
    }
  };
  if(done)return(
    <div style={{minHeight:"100dvh",background:S.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <style>{GS}</style>
      <div className="fadeUp" style={{textAlign:"center",padding:40}}>
        <div style={{width:82,height:82,borderRadius:"50%",background:`linear-gradient(135deg,${S.green},#1A7A43)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:34,margin:"0 auto 18px",boxShadow:"0 8px 28px rgba(39,174,96,.28)"}}>✓</div>
        <h2 style={{fontFamily:"'Nunito',sans-serif",fontSize:24,fontWeight:900,color:S.navy,marginBottom:8}}>{t("Başarıyla Gönderildi")}</h2>
        <p style={{color:S.muted,fontSize:14}}>{t("Belge SnapPass aracılığıyla Protel PMS'e iletildi")}</p>
        <p style={{color:S.muted,fontSize:14,marginTop:4}}><strong>{guest.firstName} {guest.lastName}</strong> · {guest.confirmationNo}</p>
      </div>
    </div>
  );
  return(
    <div style={{minHeight:"calc(100dvh - 46px)",background:S.bg}}>
      <style>{GS}</style>
      {dup&&<DuplicateDialog matches={dup.matches} rule={t("Başka bir OPERA misafir profilinde (bu profil hariç) aynı kimlik / pasaport numarası kayıtlıysa listelenir. Boşluk ve harf büyüklüğü fark etmez; en alakalı 5 profil gösterilir.")}
        title={t("Bu kimlik numarası başka bir profilde kayıtlı")}
        note={t("Girdiğiniz kimlik numarası sistemde aşağıdaki profilde zaten var. Rezervasyondaki profili değiştirmeden, yine de bu profile kaydetmek mi istiyorsunuz?")}
        canUse={false} forceLabel={t("Yine de bu profile kaydet")}
        ctx={{session,profileId:guest.guestId,name:`${guest.firstName||""} ${guest.lastName||""}`.trim(),reservationId:guest.reservationId,isAccompany:!!guest.isAccompany,onChanged:()=>{setDup(null);onBack&&onBack();}}}
        onForce={()=>{setDup(null);submit(true);}} onCancel={()=>setDup(null)}/>}
      <TopBar session={session} onBack={onBack} onLogout={onLogout}/>
      <div className="page-wrap" style={{maxWidth:660,margin:"0 auto",padding:"22px 18px 50px"}}>
        <div className="fadeUp">
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
            <div style={{width:4,height:34,background:`linear-gradient(${S.blue},${S.navy})`,borderRadius:4}}/>
            <div>
              <h1 style={{fontFamily:"'Nunito',sans-serif",fontSize:26,fontWeight:900,color:S.navy}}>{t("Belge Verisi")}</h1>
              <p style={{fontSize:13,color:S.muted}}>{manual?t("Profildeki bilgileri kontrol edin, eksikleri tamamlayın"):t("Okuma sonuçlarını gözden geçirin, gerekirse düzenleyin")}</p>
            </div>
          </div>
          <div className="form-guest" style={{background:"linear-gradient(135deg,#EEF5FF,#F4F8FF)",border:`1.5px solid ${S.blue}28`,borderRadius:12,padding:"14px 18px",marginBottom:14,display:"flex",alignItems:"center",gap:14}}>
            <Avt f={guest.firstName} l={guest.lastName} sz={48}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:16,fontWeight:800,color:S.navy}}>{guest.firstName} {guest.lastName}</div>
              <div style={{fontSize:12,color:S.muted,marginTop:2}}>📋 {guest.confirmationNo} · 🛏 {guest.roomType||"—"}</div>
            </div>
            <span style={{background:`linear-gradient(135deg,${S.blue},${S.navy})`,color:"#fff",fontSize:10,fontWeight:800,padding:"4px 10px",borderRadius:9}}>{manual?t("✏️ PROFİL"):t("✓ TARAMA TAMAM")}</span>
          </div>
          <div className="card form-card" style={{marginBottom:18}}>
            <div style={{display:"flex",alignItems:"center",gap:8,paddingBottom:12,marginBottom:12,borderBottom:`1px solid ${S.border}`}}>
              <div style={{width:30,height:30,borderRadius:8,background:`linear-gradient(135deg,${S.blue},${S.navy})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>👤</div>
              <span style={{fontSize:15,fontWeight:800,color:S.navy,fontFamily:"'Nunito',sans-serif"}}>{t("Kişisel Bilgiler")}</span>
              <span style={{marginLeft:"auto",fontSize:11,color:S.muted,background:S.bg,padding:"2px 9px",borderRadius:7,border:`1px solid ${S.border}`}}>{manual?t("Profil · Düzenlenebilir"):t("Okuma · Düzenlenebilir")}</span>
            </div>
            <div className="form-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <Fld label={t("Ad")} value={f.firstName} onChange={set("firstName")} required={personalRequired}/>
              <Fld label={t("İkinci Ad")} value={f.middleName} onChange={set("middleName")}/>
              <div style={{gridColumn:"1/-1"}}><Fld label={t("Soyad")} value={f.lastName} onChange={set("lastName")} required={personalRequired}/></div>
              <DateInput label={t("Doğum Tarihi")} value={f.dateOfBirth} onChange={set("dateOfBirth")} required={personalRequired} onInvalid={setDateBad}/>
              <Fld label={t("Cinsiyet")} value={f.gender} onChange={set("gender")} required={personalRequired} opts={[{v:"M",l:t("Erkek (M)")},{v:"F",l:t("Kadın (F)")},{v:"X",l:t("Belirtilmemiş")}]}/>
              <div style={{gridColumn:"1/-1"}}><Fld label={t("Doğum Yeri")} value={f.birthPlace} onChange={set("birthPlace")} required={birthPlaceRequired}/></div>
              <Fld label={t("Uyruk")} value={f.nationality} onChange={set("nationality")} required opts={countryOpts}/>
              <Fld label={t("Belge Tipi")} value={f.documentType} onChange={set("documentType")} required opts={docTypeOpts}/>
              <div style={{gridColumn:"1/-1"}}><Fld label={t("Belge Numarası")} value={f.documentNumber} onChange={set("documentNumber")} required/></div>
            </div>
          </div>
          {submitErr&&<div style={{background:"#FEF2F2",border:"1.5px solid #FECACA",borderRadius:9,padding:"11px 14px",fontSize:12,color:S.red,wordBreak:"break-word",whiteSpace:"pre-wrap",marginBottom:10}}>⚠ {submitErr}</div>}
          <button className="btn btn-p" onClick={()=>submit()} disabled={busy} style={{width:"100%",fontSize:15,padding:15,borderRadius:11}}>
            {busy?<><Spin sz={18}/> {manual?"Kaydediliyor…":t("Profil güncelleniyor…")}</>:manual?<><span style={{fontSize:17}}>💾</span> {t("Kaydet")}</>:<><span style={{fontSize:17}}>🏨</span> {t("Operacloud Gönder")}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── ROOT ─────────────────────────────────────────────────────────────────── */
// Config localStorage'da saklanır
const CFG_KEY = "snappass_config";
const defaultConfig = {
  hostName:"https://mtce2-oc.hospitality-api.eu-frankfurt-1.ocs.oraclecloud.com",
  hotelId:"MAGIST", hotelName:"MAG HOTEL",
  chainName:"MAG Hotels",
  appKey:"",
  scope:"urn:opc:hgbu:ws:__myscopes__",
  clientId:"",
  clientSecret:"",
  enterpriseId:"",
  appUser:"admin",
  appPassword:"1234",
  chains:[{
    id:"chain_default",
    name:"MAG Hotels",
    hotels:[{ id:"MAGIST", name:"MAG HOTEL" }]
  }],
};
function loadConfig(){
  try{
    return normalizeConfigModel(JSON.parse(localStorage.getItem(CFG_KEY)||"{}"));
  }catch{
    return normalizeConfigModel(defaultConfig);
  }
}
function saveConfig(cfg){ try{ localStorage.setItem(CFG_KEY,JSON.stringify(normalizeConfigModel(cfg))); }catch{} }

/* ── ACCOMPANY FORM ──────────────────────────────────────────────────────── */
function AccompanyForm({target, session, onBack, onDone}){
  const [step,setStep]=React.useState("search");
  const [sq,setSq]=React.useState({firstName:"",lastName:""});
  const [searching,setSearching]=React.useState(false);
  const [searchResults,setSearchResults]=React.useState(null);
  // Profil arama sonuçlarının ayrıntıları (id -> detay | false); yük binmesin diye en çok 30 sonuç, 4'er 4'er yüklenir
  const PROFILE_INFO_MAX=30, PROFILE_INFO_PARALLEL=4;
  const [profileInfo,setProfileInfo]=React.useState({});
  React.useEffect(()=>{
    if(!searchResults||!searchResults.length) return;
    let cancelled=false;
    const queue=searchResults.slice(0,PROFILE_INFO_MAX);
    const worker=async()=>{
      while(queue.length&&!cancelled){
        const p=queue.shift();
        let det=null;
        try{ det=await getProfileDetails({hostName:session.hostName,hotelId:session.hotelId,appKey:session.appKey,token:session.token,profileId:p.id,firstName:p.firstName,lastName:p.lastName}); }catch(_){}
        if(!cancelled) setProfileInfo(m=>({...m,[p.id]:det||false}));
      }
    };
    for(let k=0;k<PROFILE_INFO_PARALLEL;k++) worker();
    return ()=>{ cancelled=true; };
  },[searchResults]);
  const [selectedProfile,setSelectedProfile]=React.useState(null);
  const [f,setF]=React.useState({...EMPTY_SCAN, documentType:"TCKN"});
  const [busy,setBusy]=React.useState(false);
  const [done,setDone]=React.useState(false);
  const [err,setErr]=React.useState("");
  const [idTypeOpts,setIdTypeOpts]=React.useState([{v:"PASSPORT",l:"Pasaport"},{v:"TCKN",l:"TCKN"}]);
  // Uyruk değişince belge tipi uyruğa uydurulur (TR → TCKN)
  const set=k=>v=>setF(p=>k==="nationality" ? applyNationalityRules(p,v) : ({...p,[k]:v}));
  // Uyruk TR ise yalnız belge tipi (TCKN) ve belge numarası zorunlu; diğer uyruklarda kişisel alanların hepsi zorunlu
  const [dateBad,setDateBad]=React.useState(false);
  const isTR = f.nationality === "TR";
  const personalRequired = !isTR;
  const birthPlaceRequired = personalRequired;
  const nationalityOpts = window.IsoCountries ? window.IsoCountries.options(f.nationality, CUR_LANG) : null;
  const docTypeOpts = isTR ? turkishIdTypeOpts() : idTypeOpts.map(o=>({...o,l:idTypeLabel(o)}));
  const scanGuest = { firstName: sq.firstName || t("Yeni"), lastName: sq.lastName || t("Profil"), confirmationNo: target.confirmationNo };

  React.useEffect(()=>{
    if(!session?.hostName||!session?.appKey||!session?.token) return;
    fetch(`/api/id-types?hostName=${encodeURIComponent(session.hostName)}&hotelId=${encodeURIComponent(session.hotelId||"")}&appKey=${encodeURIComponent(session.appKey)}&token=${encodeURIComponent(session.token)}`)
      .then(r=>r.json()).then(d=>{
        if(d.opts&&d.opts.length>0) setIdTypeOpts(d.opts);
      }).catch(()=>{});
  },[]);

  const seedNewProfile = ()=>({
    ...EMPTY_SCAN,
    documentType:"TCKN",
    nationality:"TR",
    firstName:(sq.firstName || "").trim(),
    lastName:(sq.lastName || "").trim(),
  });

  const openManualNewProfile = ()=>{
    setErr("");
    setF(seedNewProfile());
    setStep("new");
  };

  const openScanNewProfile = ()=>{
    setErr("");
    setF(seedNewProfile());
    setStep("scan");
  };

  const doSearch=async()=>{
    if(!sq.firstName&&!sq.lastName){setErr(t("En az ad veya soyad girin"));return;}
    setSearching(true);setErr("");setSearchResults(null);
    try{
      const results=await profileSearch({...session,firstName:sq.firstName,lastName:sq.lastName});
      setSearchResults(results);
    }catch(e){setErr(e.message);}
    setSearching(false);
  };

  const [dup,setDup]=React.useState(null); // sistemde aynı kimlik no / ad+soyad ile profil varsa uyarı
  const doAdd=async(existingProfileId,opts={})=>{
    if(!existingProfileId){
      if(dateBad){setErr(t("Geçerli bir doğum tarihi girin (GG.AA.YYYY)"));return;}
      if(!f.nationality){setErr(t("Uyruk seçin"));return;}
      if(isTR && f.documentType!=="TCKN"){setErr(t("T.C. vatandaşı için belge tipi T.C. kimlik (TCKN) olmalı"));return;}
      if(!f.documentNumber){setErr(t("Belge numarası zorunlu"));return;}
      if(personalRequired){
        if(!String(f.firstName||"").trim()){setErr(t("Ad zorunlu"));return;}
        if(!String(f.lastName||"").trim()){setErr(t("Soyad zorunlu"));return;}
        if(!f.dateOfBirth){setErr(t("Doğum tarihi zorunlu"));return;}
        if(!String(f.birthPlace||"").trim()){setErr(t("T.C. vatandaşı olmayanlar için doğum yeri zorunlu"));return;}
      }
    }
    setBusy(true);setErr("");
    // Yeni profil oluşturmadan önce: aynı kimlik no veya aynı ad+soyad(+doğum tarihi) ile kayıtlı profil var mı?
    if(!existingProfileId && !opts.skipDup){
      const matches = await findDuplicates({
        hostName:session.hostName,hotelId:session.hotelId,appKey:session.appKey,token:session.token,
        criteria:{ identificationNo:String(f.documentNumber||"").trim(), firstName:String(f.firstName||"").trim(), lastName:String(f.lastName||"").trim(), birthDate:f.dateOfBirth||"" },
      });
      if(matches.length){ setBusy(false); setDup({matches}); return; }
    }
    try{
      const result = await addAccompanying({
        hostName:session.hostName,hotelId:session.hotelId,appKey:session.appKey,token:session.token,
        reservationId:target.reservationId,
        confirmationNo:target.confirmationNo,
        mainProfileId:target.guestId,
        existingAccompanyIds: target.accompanyProfileIds || [],
        existingProfileId:existingProfileId||null,
        docData:existingProfileId?null:f,
      });
      setDone(true);
      const resolvedFirst = existingProfileId ? (opts.display?.firstName ?? selectedProfile?.firstName ?? "") : (f?.firstName||"");
      const resolvedLast  = existingProfileId ? (opts.display?.lastName ?? selectedProfile?.lastName ?? "")  : (f?.lastName||"");
      setTimeout(()=>onDone({newProfileId: existingProfileId || result?.newProfileId, firstName: resolvedFirst, lastName: resolvedLast}),1800);
    }catch(e){setErr(e.message);setBusy(false);}
  };

  if(step==="scan"){
    return (
      <CameraScan
        guest={scanGuest}
        onDone={doc=>{
          setF(prev=>applyNationalityRules({
            ...prev,
            ...doc,
            firstName: doc?.firstName || prev.firstName || sq.firstName || "",
            lastName: doc?.lastName || prev.lastName || sq.lastName || "",
            documentType: doc?.documentType || prev.documentType || "TCKN",
            issuingCountry: toIso2(doc?.issuingCountry || prev.issuingCountry),
          }, toIso2(doc?.nationality || prev.nationality), doc?.idNumber));
          setStep("new");
        }}
        onBack={()=>setStep("search")}
      />
    );
  }

  if(done)return(
    <div style={{minHeight:"100dvh",background:S.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:60,marginBottom:16}}>✅</div>
        <div style={{fontSize:18,fontWeight:800,color:S.navy}}>{t("Beraberindeki Eklendi!")}</div>
      </div>
    </div>
  );

  return(
    <div style={{minHeight:"calc(100dvh - 46px)",background:S.bg}}>
      <style>{GS}</style>
      {dup&&<DuplicateDialog matches={dup.matches} rule={t("İki ölçüte bakılır: (1) aynı kimlik / pasaport numarası; (2) aynı ad + soyad (ilk ad ve soyad aynı, aksan ve harf büyüklüğü fark etmez; doğum tarihi iki tarafta da varsa aynı olmalı). Her kartta eşleşen ölçüt yazar.")}
        title={t("Sistemde bu kişiyle eşleşen profil var")}
        note={t("Yeni profil oluşturmak yerine kayıtlı profili rezervasyona eklemek ister misiniz? Aynı kişi için ikinci bir profil açılmaması önerilir.")}
        canUse={true} forceLabel={t("Yine de yeni profil oluştur")}
        onUse={m=>{setDup(null);doAdd(m.id,{display:{firstName:m.firstName,lastName:m.lastName}});}}
        onForce={()=>{setDup(null);doAdd(null,{skipDup:true});}}
        onCancel={()=>setDup(null)}/>}
      <TopBar onBack={step==="new"||step==="confirm"?()=>setStep("search"):onBack}/>
      <div style={{background:"linear-gradient(90deg,#1B3C6D,#2A5298)",padding:"12px 18px"}}>
        <div style={{maxWidth:700,margin:"0 auto"}}>
          <div style={{fontSize:13,fontWeight:800,color:"#fff"}}>{t("Beraberindeki Ekle")}</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.5)",marginTop:2}}>{target.firstName} {target.lastName} - {target.confirmationNo}</div>
        </div>
      </div>
      <div style={{maxWidth:700,margin:"0 auto",padding:"20px 16px",display:"flex",flexDirection:"column",gap:14}}>

        {step==="search"&&(
          <div>
            <div className="card" style={{marginBottom:12}}>
              <div style={{fontWeight:800,color:S.navy,fontSize:15,marginBottom:14}}>{t("Profil Ara")}</div>
              <div className="form-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                <Fld label={t("Ad")} value={sq.firstName} onChange={v=>setSq(p=>({...p,firstName:v}))}/>
                <Fld label={t("Soyad")} value={sq.lastName} onChange={v=>setSq(p=>({...p,lastName:v}))}/>
              </div>
              <div className="form-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <button className="btn btn-p" onClick={doSearch} disabled={searching} style={{width:"100%",padding:12,borderRadius:10,fontSize:14}}>
                  {searching?t("Aranıyor…"):t("Profil Ara")}
                </button>
                <button type="button" onClick={openScanNewProfile} style={{width:"100%",padding:12,borderRadius:10,fontSize:14,background:"#fff",border:`1.5px solid ${S.blue}`,color:S.blue,fontWeight:800,cursor:"pointer"}}>
                  {t("Tara ve Yeni Profil Oluştur")}
                </button>
              </div>
            </div>
            {searchResults!==null&&(
              <div className="card">
                {searchResults.length===0
                  ?<div style={{display:"grid",gap:12}}>
                    <div style={{textAlign:"center",padding:"10px 0",color:S.muted,fontSize:13}}>{t("Sonuç bulunamadı")}</div>
                    <div className="form-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      <button type="button" onClick={openManualNewProfile} style={{width:"100%",padding:"10px",border:"1.5px dashed #4A90D9",borderRadius:10,background:"transparent",color:S.blue,fontWeight:700,fontSize:13,cursor:"pointer"}}>
                        {t("+ Yeni Profil Oluştur")}
                      </button>
                      <button type="button" onClick={openScanNewProfile} style={{width:"100%",padding:"10px",border:`1.5px solid ${S.orange}`,borderRadius:10,background:"#FFF7ED",color:S.orangeDk,fontWeight:800,fontSize:13,cursor:"pointer"}}>
                        {t("Tara ve Yeni Profil Oluştur")}
                      </button>
                    </div>
                  </div>
                  :<div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {searchResults.map((p,i)=>(
                      <div key={i} onClick={()=>{setSelectedProfile(p);setStep("confirm");}}
                        style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:"4px 12px",padding:"10px 12px",border:"1.5px solid #E2EAF4",borderRadius:10,cursor:"pointer",background:"#FAFBFD"}}>
                        <Avt f={p.firstName} l={p.lastName} sz={36}/>
                        <div style={{flex:1}}>
                          <div style={{fontWeight:800,color:S.navy,fontSize:14}}>{p.firstName} {p.lastName}</div>
                          <div style={{fontSize:11,color:S.muted,fontFamily:"monospace"}}>{"#"+p.id}</div>
                        </div>
                        <span style={{fontSize:13,color:S.blue,fontWeight:800,padding:"8px 6px"}}>{t("Seç")}</span>
                        {/* Bilgi satırı kartın altında tam genişlikte: telefonda sıkışmaz */}
                        {profileInfo[p.id]
                          ? <div style={{flex:"1 1 100%",minWidth:0}}><ProfileInfoLine pd={profileInfo[p.id]}/></div>
                          : (i<PROFILE_INFO_MAX && profileInfo[p.id]!==false && <div style={{flex:"1 1 100%",fontSize:12,color:S.muted}}>{t("Bilgiler yükleniyor…")}</div>)}
                      </div>
                    ))}
                  </div>
                }
                {searchResults.length > 0 && <div className="form-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:12}}>
                  <button onClick={openManualNewProfile} style={{width:"100%",padding:"10px",border:"1.5px dashed #4A90D9",borderRadius:10,background:"transparent",color:S.blue,fontWeight:700,fontSize:13,cursor:"pointer"}}>
                    {t("+ Yeni Profil Oluştur")}
                  </button>
                  <button type="button" onClick={openScanNewProfile} style={{width:"100%",padding:"10px",border:`1.5px solid ${S.orange}`,borderRadius:10,background:"#FFF7ED",color:S.orangeDk,fontWeight:800,fontSize:13,cursor:"pointer"}}>
                    {t("Tara ve Yeni Profil Oluştur")}
                  </button>
                </div>}
              </div>
            )}
            {err&&<div style={{color:S.red,fontSize:13,textAlign:"center",padding:"8px",background:"#FEE2E2",borderRadius:8,marginTop:10}}>{err}</div>}
          </div>
        )}

        {step==="confirm"&&selectedProfile&&(
          <div className="card">
            <div style={{fontWeight:800,color:S.navy,fontSize:15,marginBottom:14}}>{t("Profil Onay")}</div>
            <div style={{display:"flex",alignItems:"center",gap:14,padding:"12px",background:S.bg,borderRadius:10,marginBottom:14}}>
              <Avt f={selectedProfile.firstName} l={selectedProfile.lastName} sz={46}/>
              <div>
                <div style={{fontWeight:800,color:S.navy,fontSize:16}}>{selectedProfile.firstName} {selectedProfile.lastName}</div>
                <div style={{fontSize:12,color:S.muted,fontFamily:"monospace"}}>{"#"+selectedProfile.id}</div>
              </div>
            </div>
            <p style={{fontSize:13,color:S.muted,marginBottom:14}}>{t("Bu profili rezervasyona beraberindeki olarak eklemek istiyor musunuz?")}</p>
            {err&&<div style={{color:S.red,fontSize:13,padding:"8px",background:"#FEE2E2",borderRadius:8,marginBottom:10}}>{err}</div>}
            <button className="btn btn-p" onClick={()=>doAdd(selectedProfile.id)} disabled={busy} style={{width:"100%",padding:13,fontSize:14,borderRadius:10}}>
              {busy?"Ekleniyor...":t("Rezervasyona Ekle")}
            </button>
          </div>
        )}

        {step==="new"&&(
          <div>
            {/* Ana profil (belge formu) ile aynı alanlar, tek form */}
            <div className="card form-card" style={{marginBottom:18}}>
              <div style={{display:"flex",alignItems:"center",gap:8,paddingBottom:12,marginBottom:12,borderBottom:`1px solid ${S.border}`}}>
                <div style={{width:30,height:30,borderRadius:8,background:`linear-gradient(135deg,${S.blue},${S.navy})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>👤</div>
                <span style={{fontSize:15,fontWeight:800,color:S.navy,fontFamily:"'Nunito',sans-serif"}}>{t("Yeni Profil · Kişisel Bilgiler")}</span>
                <button type="button" onClick={openScanNewProfile} style={{marginLeft:"auto",background:"#FFF7ED",border:`1px solid ${S.orange}55`,color:S.orangeDk,borderRadius:10,padding:"8px 12px",fontSize:12,fontWeight:800,cursor:"pointer"}}>{t("MRZ Tara")}</button>
              </div>
              <div className="form-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <Fld label={t("Ad")} value={f.firstName} onChange={set("firstName")} required={personalRequired}/>
                <Fld label={t("İkinci Ad")} value={f.middleName} onChange={set("middleName")}/>
                <div style={{gridColumn:"1/-1"}}><Fld label={t("Soyad")} value={f.lastName} onChange={set("lastName")} required={personalRequired}/></div>
                <DateInput label={t("Doğum Tarihi")} value={f.dateOfBirth} onChange={set("dateOfBirth")} required={personalRequired} onInvalid={setDateBad}/>
                <Fld label={t("Cinsiyet")} value={f.gender} onChange={set("gender")} required={personalRequired} opts={[{v:"M",l:t("Erkek (M)")},{v:"F",l:t("Kadın (F)")},{v:"X",l:t("Belirtilmemiş")}]}/>
                <div style={{gridColumn:"1/-1"}}><Fld label={t("Doğum Yeri")} value={f.birthPlace} onChange={set("birthPlace")} required={birthPlaceRequired}/></div>
                <Fld label={t("Uyruk")} value={f.nationality} onChange={set("nationality")} required opts={nationalityOpts}/>
                <Fld label={t("Belge Tipi")} value={f.documentType} onChange={set("documentType")} required opts={docTypeOpts}/>
                <div style={{gridColumn:"1/-1"}}><Fld label={t("Belge Numarası")} value={f.documentNumber} onChange={set("documentNumber")} required/></div>
              </div>
            </div>
            {err&&<div style={{color:S.red,fontSize:13,padding:"8px",background:"#FEE2E2",borderRadius:8,marginBottom:10}}>{err}</div>}
            <button className="btn btn-p" onClick={()=>doAdd(null)} disabled={busy} style={{width:"100%",padding:16,fontSize:15,borderRadius:12}}>
              {busy?"Kaydediliyor...":t("Rezervasyona Ekle")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


// Oturum sunucuda (lib/web.js): kullanıcı ve otel /api/me'den, OHIP token /api/opera/token'dan gelir
let serverCsrf = "";
async function fetchServerSession(){
  const res = await fetch(`${PROXY}/api/me`, { cache:"no-store" });
  if(res.status === 401){ if(!document.getElementById("passive-notice")) window.location.href = "/login"; return null; }
  if(!res.ok) throw new Error(t("Oturum bilgisi alınamadı (HTTP {durum})", { durum: res.status }));
  const me = await res.json();
  serverCsrf = me.csrf || "";
  if(!me.hotel){ window.location.href = me.user?.role === "admin" ? "/admin" : "/login"; return null; }
  const token = await operaGetToken();
  return {
    hostName: me.hotel.hostName,
    hotelId: me.hotel.hotelCode,
    hotelName: me.hotel.name,
    chainId: "",
    chainName: me.hotel.chainName || "",
    appKey: me.hotel.appKey,
    token,
    username: me.user.username,
    fullName: me.user.fullName,
    userId: me.user.id,
    role: me.user.role,
    kbsEnabled: !!me.hotel.kbsEnabled,
    kbsReport: !!(me.user&&me.user.kbsReport),
    canMerge: !!(me.user&&me.user.canMerge),
    canChangeMain: !!(me.user&&me.user.canChangeMain),
    canChangeAccompany: !!(me.user&&me.user.canChangeAccompany),
    hotelAdmin: !!(me.user&&me.user.hotelAdmin),
    kbsType: me.hotel.kbsType==="jandarma"?"jandarma":"polis",
    kbsAuto: !!me.hotel.kbsAuto,
    ohipEnv: me.hotel.ohipEnv==="customer"?"customer":me.hotel.ohipEnv==="partner"?"partner":"",
    csrf: me.csrf,
  };
}

function App(){
  const runtimeRef=React.useRef(loadRuntimeState());
  const initialRuntime=runtimeRef.current || {};
  const [screen,setScreen]=useState(()=>initialRuntime?.session ? (initialRuntime.screen || "search") : "loading");
  const [session,setSession]=useState(null);
  const [bootError,setBootError]=useState("");
  const [guest,setGuest]=useState(()=>initialRuntime?.guest || null);
  const [scan,setScan]=useState(()=>initialRuntime?.scan || null);
  const [manualEdit,setManualEdit]=useState(false); // tarama yapmadan profil düzenleme
  const [accompanyTarget,setAccompanyTarget]=useState(()=>initialRuntime?.accompanyTarget || null);
  const searchRefreshRef=React.useRef(null);
  const reloadProfileRef=React.useRef(null);
  // Sayfa eski kalmışsa (sunucuda yeni sürüm varsa) uyarı: açık sekmeler eski kodla çalışıp yeni kontrolleri atlamasın
  // Dil değişince (TR | EN) tüm ekran yeniden çizilir
  const [,setLangTick]=React.useState(0);
  React.useEffect(()=>{
    const h=()=>setLangTick(n=>n+1);
    window.addEventListener("sp-lang",h);
    return ()=>window.removeEventListener("sp-lang",h);
  },[]);
  const [stale,setStale]=React.useState(false);
  React.useEffect(()=>{
    const mine = window.__SP_VERSION;
    if(!mine) return;
    let stop=false;
    const check=async()=>{
      try{
        const r=await fetch(`${PROXY}/api/version`,{ cache:"no-store" });
        if(!r.ok) return;
        const d=await r.json();
        if(!stop && d.v && d.v!==mine) setStale(true);
      }catch(_){}
    };
    const onVis=()=>{ if(document.visibilityState==="visible") check(); };
    document.addEventListener("visibilitychange",onVis);
    const timer=setInterval(check,5*60*1000);
    check();
    return ()=>{ stop=true; document.removeEventListener("visibilitychange",onVis); clearInterval(timer); };
  },[]);
  // Düzenle / Geri / Kaydet sonrası arama ekranına aynı sonuçlar ve seçili profille dönülür
  const backToSearch=(reloadGuestId)=>{
    setScreen("search");
    if(reloadGuestId) setTimeout(()=>{ reloadProfileRef.current && reloadProfileRef.current(reloadGuestId).catch(()=>{}); },400);
  };

  React.useEffect(()=>{
    let cancelled = false;
    fetchServerSession()
      .then(s=>{
        if(cancelled || !s) return;
        setSession(s);
        setScreen(prev=>prev==="loading" ? "search" : prev);
      })
      .catch(err=>{ if(!cancelled) setBootError(getSafeErrorMessage(err)); });
    // OHIP token'ı süresi dolmadan yenile
    const timer = setInterval(async()=>{
      try{
        const token = await operaGetToken();
        setSession(prev=>prev?({...prev,token}):prev);
      }catch(err){ console.error("[AUTH] token refresh failed:", err); }
    }, 40*60*1000);
    return ()=>{ cancelled = true; clearInterval(timer); };
  },[]);

  React.useEffect(()=>{
    if(!session) return;
    saveRuntimeState({ screen, guest, scan, accompanyTarget, session:{ userId:session.userId } });
  },[screen,session,guest,scan,accompanyTarget]);

  React.useEffect(()=>{
    if(!session) return;
    if(screen==="scan" && !guest) setScreen("search");
    if(screen==="form" && (!guest || !scan)) setScreen("search");
    if(screen==="accompany" && !accompanyTarget) setScreen("search");
  },[screen,session,guest,scan,accompanyTarget]);

  const goLogin = async ()=>{
    clearRuntimeState();
    try{
      await fetch(`${PROXY}/logout`, {
        method:"POST",
        headers:{ "Content-Type":"application/x-www-form-urlencoded" },
        body:new URLSearchParams({ csrf: serverCsrf }).toString(),
      });
    }catch(_){}
    window.location.href = "/login";
  };

  if(!session){
    return <div className="boot" style={{flexDirection:"column",gap:14,textAlign:"center",padding:20}}>
      <div>{bootError ? t("Hata: {mesaj}", { mesaj: bootError }) : t("SnapPass yükleniyor…")}</div>
      {bootError&&<button onClick={goLogin} style={{background:"#fff",border:"1px solid #C9D6E8",color:"#1B3C6D",borderRadius:10,padding:"9px 16px",fontWeight:800,cursor:"pointer"}}>{t("Çıkış")}</button>}
    </div>;
  }

  return<React.Fragment>
    {stale&&<div role="alert" style={{position:"fixed",left:0,right:0,bottom:0,zIndex:3000,background:S.navy,color:"#fff",padding:"12px 16px calc(12px + env(safe-area-inset-bottom))",display:"flex",alignItems:"center",gap:12,boxShadow:"0 -6px 24px rgba(0,0,0,.3)"}}>
      <span style={{flex:1,fontSize:14,fontWeight:700}}>{t("Uygulamanın yeni sürümü var. Yenileyin.")}</span>
      <button className="btn btn-p" onClick={()=>window.location.reload()} style={{minHeight:44,padding:"8px 18px"}}>{t("Yenile")}</button>
    </div>}
    {/* Arama ekranı diğer ekranlarda gizlenerek açık tutulur: geri dönünce sonuçlar ve seçili profil aynı kalır */}
    <div style={{display:screen==="search"?"block":"none"}}>
      <Search session={session}
        onSelect={(g,pd)=>{setManualEdit(false);setScan(null);setGuest({...g,profileDetails:pd});setScreen("scan");}}
        onEdit={(g,pd)=>{setManualEdit(true);setScan({});setGuest({...g,profileDetails:pd});setScreen("form");}}
        onAddAccompany={(g)=>{setAccompanyTarget(g);setScreen("accompany");}}
        onLogout={goLogin}
        onConfig={isAdminUser(session)?()=>{ window.location.href = "/admin"; }:null}
        refreshRef={searchRefreshRef}
        reloadProfileRef={reloadProfileRef}/>
    </div>
    {screen==="accompany"&&accompanyTarget&&<AccompanyForm target={accompanyTarget} session={session} onBack={()=>setScreen("search")} onDone={(newInfo)=>{
      const tgt=accompanyTarget;
      setAccompanyTarget(null);
      setScreen("search");
      // Client-side yeni guest ekle + confirmationNo araması
      if(searchRefreshRef.current) setTimeout(()=>searchRefreshRef.current(tgt?.confirmationNo, tgt, newInfo),200);
    }}/>}
    {screen==="scan"&&guest&&<CameraScan guest={guest} session={session} onDone={d=>{setScan(d);setScreen("form");}} onBack={()=>setScreen("search")} onLogout={goLogin}/>}
    {screen==="form"&&guest&&scan&&<DocForm guest={guest} scan={scan} session={session} manual={manualEdit} onSubmit={()=>{const gid=guest?.guestId;setGuest(null);setScan(null);setManualEdit(false);backToSearch(gid);}} onBack={()=>setScreen(manualEdit?"search":"scan")} onLogout={goLogin}/>}
    {session&&screen!=="scan"&&<footer className="app-footer">© {t("Bütün hakları saklıdır.")} PROTEL Bilgisayar A.Ş.</footer>}
  </React.Fragment>;
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
  
