(() => {
  const { useState, useRef, useEffect, useCallback } = React;
  const PROXY = window.location.origin;
  const SHOW_MRZ_DEBUG_UI = false;
  const SP_I18N = window.SP_I18N || { en: {}, tr: {} };
  function readLang() {
    const m = /(?:^|;\s*)sp_lang=(tr|en)\b/.exec(document.cookie || "");
    return m ? m[1] : window.__SP_DEFAULT_LANG === "en" ? "en" : "tr";
  }
  let CUR_LANG = readLang();
  document.documentElement.lang = CUR_LANG;
  function t(src, vars) {
    let s = SP_I18N[CUR_LANG] && SP_I18N[CUR_LANG][src] || src;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => k in vars ? vars[k] : m);
    return s;
  }
  function setLang(l) {
    CUR_LANG = l === "en" ? "en" : "tr";
    document.cookie = `sp_lang=${CUR_LANG}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = CUR_LANG;
    window.dispatchEvent(new Event("sp-lang"));
  }
  const STATUS_TR = { reserved: "Rezerve", inhouse: "Konakl\u0131yor", checkedin: "Giri\u015F yap\u0131ld\u0131", checkedout: "\xC7\u0131k\u0131\u015F yap\u0131ld\u0131", cancelled: "\u0130ptal", canceled: "\u0130ptal", noshow: "Gelmedi", duein: "Bug\xFCn gelecek", dueout: "Bug\xFCn \xE7\u0131kacak", waitlist: "Bekleme listesi", pending: "Beklemede" };
  function statusText(status) {
    const key = String(status || "").toLowerCase().replace(/[^a-z]/g, "");
    return STATUS_TR[key] ? t(STATUS_TR[key]) : status;
  }
  function idTypeLabel(o) {
    if (o.v === "PASSPORT") return t("Pasaport");
    if (o.v === "TCKN") return t("TCKN");
    return o.l;
  }
  function LangSwitch() {
    return /* @__PURE__ */ React.createElement("div", { className: "lang-switch", role: "group", "aria-label": t("Dil") }, [["tr", "TR"], ["en", "EN"]].map(([code, label]) => /* @__PURE__ */ React.createElement("button", { key: code, type: "button", onClick: () => setLang(code), "aria-pressed": CUR_LANG === code, className: CUR_LANG === code ? "on" : "" }, label)));
  }
  async function writeDebugLogFile({ sessionId, guest, lines }) {
    if (!sessionId || !Array.isArray(lines) || !lines.length) return;
    try {
      await fetch(`${PROXY}/api/debug-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, guest, lines })
      });
    } catch (err) {
      console.warn("[MRZ-DEBUG] log file write failed:", err);
    }
  }
  async function writeDebugImageFile({ sessionId, label, canvas }) {
    if (!sessionId || !label || !canvas || typeof canvas.toDataURL !== "function") return;
    try {
      const imageData = canvas.toDataURL("image/jpeg", 0.86);
      await fetch(`${PROXY}/api/debug-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, label, imageData })
      });
    } catch (err) {
      console.warn("[MRZ-DEBUG] image file write failed:", err);
    }
  }
  function isHandheldDevice() {
    try {
      return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "") || window.matchMedia && window.matchMedia("(max-width: 820px)").matches;
    } catch {
      return false;
    }
  }
  function getScanViewportHeight() {
    const vh = window.innerHeight || 800;
    return isHandheldDevice() ? Math.max(360, Math.min(620, Math.round(vh * 0.58))) : 380;
  }
  async function openPreferredCameraStream() {
    const handheld = isHandheldDevice();
    const attempts = [
      {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: handheld ? 2560 : 1920 },
          height: { ideal: handheld ? 1440 : 1080 },
          aspectRatio: { ideal: 16 / 9 }
        },
        audio: false
      },
      {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      },
      {
        video: true,
        audio: false
      }
    ];
    let lastError = null;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error(t("Kamera kullan\u0131lam\u0131yor"));
  }
  async function optimizeVideoTrack(track) {
    if (!track || typeof track.applyConstraints !== "function") return;
    try {
      const caps = typeof track.getCapabilities === "function" ? track.getCapabilities() : {};
      const advanced = [];
      if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) advanced.push({ focusMode: "continuous" });
      if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes("continuous")) advanced.push({ exposureMode: "continuous" });
      if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes("continuous")) advanced.push({ whiteBalanceMode: "continuous" });
      if (caps.zoom && typeof caps.zoom.max === "number") {
        const targetZoom = Math.min(caps.zoom.max, Math.max(caps.zoom.min || 1, isHandheldDevice() ? 1.6 : 1.2));
        advanced.push({ zoom: targetZoom });
      }
      if (!advanced.length) return;
      await track.applyConstraints({ advanced });
    } catch (err) {
      console.warn("[MRZ] camera optimize skipped:", err);
    }
  }
  (function() {
    const orig = window.fetch.bind(window);
    window.fetch = async function() {
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
            const h = document.createElement("div");
            h.textContent = t("Eri\u015Fim kapal\u0131");
            h.style.cssText = "font-size:18px;font-weight:800;margin-bottom:8px;color:#b91c1c";
            const p = document.createElement("div");
            p.textContent = t("Otel ya da hesap pasife al\u0131nd\u0131. Protel destek ekibiyle g\xF6r\xFC\u015F\xFCn.");
            p.style.cssText = "font-size:14px;color:#334155;margin-bottom:16px";
            const b = document.createElement("button");
            b.textContent = t("Giri\u015F ekran\u0131na d\xF6n");
            b.style.cssText = "background:#2563eb;color:#fff;border:0;border-radius:10px;padding:10px 16px;font-weight:700;cursor:pointer";
            b.onclick = function() {
              window.location.href = "/login";
            };
            card.append(h, p, b);
            box.appendChild(card);
            document.body.appendChild(box);
          }
        } catch (_) {
        }
      }
      return res;
    };
  })();
  async function operaGetToken() {
    const res = await fetch(`${PROXY}/api/opera/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    let d = {};
    try {
      d = await res.json();
    } catch (_) {
    }
    if (res.status === 401) {
      if (!document.getElementById("passive-notice")) window.location.href = "/login";
      throw new Error(t("Oturum sona erdi"));
    }
    if (!res.ok || !d.access_token) throw new Error(d.error || t("OHIP token al\u0131namad\u0131 (HTTP {durum})", { durum: res.status }));
    return d.access_token;
  }
  async function operaSearch({ hostName, hotelId, appKey, token, byType, query, tab }) {
    var _a, _b;
    const params = new URLSearchParams({ hostName, hotelId, appKey, byType, query: query.trim(), tab });
    const res = await fetch(`${PROXY}/api/search?${params}`, {
      headers: { "x-opera-token": token }
    });
    if (res.status === 204) return [];
    let body = "";
    try {
      body = await res.text();
    } catch (_) {
    }
    if (!res.ok) {
      let detail = "";
      try {
        const j = JSON.parse(body);
        detail = j.detail || j.message || j.title || ((_b = (_a = j["o:errorDetails"]) == null ? void 0 : _a[0]) == null ? void 0 : _b.detail) || body.slice(0, 300);
      } catch {
        detail = body.slice(0, 300);
      }
      throw new Error(t("Arama ba\u015Far\u0131s\u0131z (HTTP {durum}):\n{ayrinti}", { durum: res.status, ayrinti: detail }));
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return [];
    }
    return normalizeReservations(data);
  }
  function isValidTckn(v) {
    const s = String(v || "").replace(/\s/g, "");
    if (!/^[1-9]\d{10}$/.test(s)) return false;
    const d = s.split("").map(Number);
    const odd = d[0] + d[2] + d[4] + d[6] + d[8], even = d[1] + d[3] + d[5] + d[7];
    if (((odd * 7 - even) % 10 + 10) % 10 !== d[9]) return false;
    return d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
  }
  function changedKeys(before, after, keys) {
    const nv = (v) => String(v != null ? v : "").replace(/\s+/g, " ").trim();
    return keys.filter((k) => k in before && nv(before[k]).toLowerCase() !== nv(after[k]).toLowerCase()).map((k) => ({ k, from: nv(before[k]).slice(0, 80), to: nv(after[k]).slice(0, 80) }));
  }
  async function putProfile({ hostName, hotelId, appKey, token, profileId, docData, changed }) {
    var _a, _b;
    const res = await fetch(`${PROXY}/api/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostName, hotelId, appKey, token, profileId, docData, changed })
    });
    let body = "";
    try {
      body = await res.text();
    } catch (_) {
    }
    if (!res.ok) {
      let detail = "";
      try {
        const j = JSON.parse(body);
        detail = j.detail || j.message || j.title || ((_b = (_a = j["o:errorDetails"]) == null ? void 0 : _a[0]) == null ? void 0 : _b.detail) || body.slice(0, 300);
      } catch {
        detail = body.slice(0, 300);
      }
      throw new Error(t("Profil g\xFCncelleme hatas\u0131 (HTTP {durum}):\n{ayrinti}", { durum: res.status, ayrinti: detail }));
    }
    return true;
  }
  async function profileSearch({ hostName, hotelId, appKey, token, firstName, lastName }) {
    var _a, _b, _c, _d;
    const params = new URLSearchParams({ hostName, hotelId, appKey, token });
    if (firstName) params.set("firstName", firstName);
    if (lastName) params.set("lastName", lastName);
    const r = await fetch("/api/profile-search?" + params);
    const d = await r.json();
    if (!r.ok) throw new Error((d == null ? void 0 : d.error) || t("Arama ba\u015Far\u0131s\u0131z"));
    const list = (_d = (_c = (_a = d == null ? void 0 : d.profileSummaries) == null ? void 0 : _a.profileInfo) != null ? _c : (_b = d == null ? void 0 : d.profiles) == null ? void 0 : _b.profileInfo) != null ? _d : [];
    return [].concat(list).map((pi) => {
      var _a2, _b2, _c2, _d2, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p;
      const prof = (_a2 = pi.profile) != null ? _a2 : pi;
      const fn = (_b2 = prof.formerName) != null ? _b2 : {};
      const cust = (_c2 = prof.customer) != null ? _c2 : {};
      const pn = (_e = [].concat((_d2 = cust.personName) != null ? _d2 : []).find((n) => n.nameType === "Primary")) != null ? _e : {};
      const firstName2 = (_h = (_g = (_f = pn.givenName) != null ? _f : fn.givenName) != null ? _g : fn.middleName) != null ? _h : "";
      const lastName2 = (_m = (_l = (_i = pn.surname) != null ? _i : fn.name) != null ? _l : (_k = (_j = fn.fullName) == null ? void 0 : _j.split(",")[0]) == null ? void 0 : _k.trim()) != null ? _m : "";
      const idList = [].concat((_n = pi.profileIdList) != null ? _n : []);
      const id = (_p = (_o = idList.find((i) => i.type === "Profile")) == null ? void 0 : _o.id) != null ? _p : "";
      return { id, firstName: firstName2, lastName: lastName2 };
    }).filter((p) => p.id);
  }
  async function addAccompanying({ hostName, hotelId, appKey, token, reservationId, existingProfileId, mainProfileId, docData }) {
    var _a, _b;
    const r = await fetch("/api/add-accompanying", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-SP-Version": window.__SP_VERSION || "" },
      body: JSON.stringify({ hostName, hotelId, appKey, token, reservationId, existingProfileId, mainProfileId, docData })
    });
    const d = await r.json();
    if (!r.ok) {
      let detail = "";
      try {
        const j = JSON.parse((d == null ? void 0 : d.detail) || "{}");
        detail = j.detail || j.title || ((_b = (_a = j["o:errorDetails"]) == null ? void 0 : _a[0]) == null ? void 0 : _b.detail) || "";
      } catch {
        detail = String((d == null ? void 0 : d.detail) || "").slice(0, 200);
      }
      throw new Error([(d == null ? void 0 : d.error) || t("Beraberindeki eklenemedi"), detail].filter(Boolean).join(": "));
    }
    return d;
  }
  async function findDuplicates({ hostName, hotelId, appKey, token, excludeProfileId, criteria }) {
    try {
      const res = await fetch(`${PROXY}/api/profile-duplicates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostName, hotelId, appKey, token, excludeProfileId, criteria })
      });
      if (!res.ok) return [];
      const d = await res.json();
      return d.matches || [];
    } catch (e) {
      console.warn("findDuplicates:", e);
      return [];
    }
  }
  async function getProfileDetails({ hostName, hotelId, appKey, token, profileId, firstName, lastName, fresh }) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
    try {
      const params = new URLSearchParams({ hostName, hotelId, appKey, profileId });
      if (fresh) params.set("fresh", "1");
      const res = await fetch(`${PROXY}/api/profile?${params}`, {
        headers: { "x-opera-token": token }
      });
      if (!res.ok) return null;
      const data = await res.json();
      const p = (_a = data == null ? void 0 : data.matched) != null ? _a : data;
      const prof = (_b = p == null ? void 0 : p.profile) != null ? _b : {};
      const cust = (_c = prof == null ? void 0 : prof.customer) != null ? _c : {};
      const personName = (_g = (_f = [].concat((_d = cust == null ? void 0 : cust.personName) != null ? _d : []).find((n) => n.nameType === "Primary")) != null ? _f : [].concat((_e = cust == null ? void 0 : cust.personName) != null ? _e : [])[0]) != null ? _g : {};
      const identList = [].concat((_i = (_h = cust == null ? void 0 : cust.identifications) == null ? void 0 : _h.identificationInfo) != null ? _i : []);
      const d10 = (v) => String(v || "").slice(0, 10);
      const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const primary = (_j = identList.find((i) => {
        var _a2, _b2;
        return ((_a2 = i == null ? void 0 : i.identification) == null ? void 0 : _a2.primaryInd) === true || ((_b2 = i == null ? void 0 : i.identification) == null ? void 0 : _b2.primaryInd) === "true";
      })) != null ? _j : (() => {
        if (identList.length < 2) return identList[0];
        const valid = identList.filter((i) => {
          var _a2;
          const e = d10((_a2 = i == null ? void 0 : i.identification) == null ? void 0 : _a2.expirationDate);
          return !e || e >= today;
        });
        const pool = valid.length ? valid : identList;
        return [...pool].sort((a, b) => {
          var _a2, _b2, _c2, _d2;
          return d10((_a2 = b == null ? void 0 : b.identification) == null ? void 0 : _a2.issuedDate).localeCompare(d10((_b2 = a == null ? void 0 : a.identification) == null ? void 0 : _b2.issuedDate)) || d10((_c2 = b == null ? void 0 : b.identification) == null ? void 0 : _c2.expirationDate).localeCompare(d10((_d2 = a == null ? void 0 : a.identification) == null ? void 0 : _d2.expirationDate));
        })[0];
      })();
      const ident = (_k = primary == null ? void 0 : primary.identification) != null ? _k : null;
      return {
        identId: (_l = primary == null ? void 0 : primary.id) != null ? _l : null,
        idType: (ident == null ? void 0 : ident.idType) || "",
        documentNumber: (ident == null ? void 0 : ident.idNumber) || "",
        issuingCountry: (ident == null ? void 0 : ident.issuedCountry) || "",
        issuedDate: (ident == null ? void 0 : ident.issuedDate) || "",
        expiryDate: (ident == null ? void 0 : ident.expirationDate) || "",
        issuedPlace: (ident == null ? void 0 : ident.issuedPlace) || "",
        birthDate: (cust == null ? void 0 : cust.birthDate) || "",
        birthPlace: (cust == null ? void 0 : cust.birthPlace) || "",
        nationality: (cust == null ? void 0 : cust.nationality) || "",
        // ISO kodu (TR, DE vb.)
        gender: (cust == null ? void 0 : cust.gender) || (personName == null ? void 0 : personName.gender) || "",
        firstName: (personName == null ? void 0 : personName.givenName) || firstName || "",
        middleName: (personName == null ? void 0 : personName.middleName) || "",
        lastName: (personName == null ? void 0 : personName.surname) || lastName || ""
      };
    } catch (e) {
      console.warn("getProfileDetails error:", e);
      return null;
    }
  }
  async function putIdentification({ hostName, hotelId, appKey, token, profileId, identId, docData }) {
    const res = await fetch(`${PROXY}/api/identification`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostName, hotelId, appKey, token, profileId, identId, docData })
    });
    let body = "";
    try {
      body = await res.text();
    } catch (_) {
    }
    if (!res.ok) {
      let detail = "";
      try {
        const j = JSON.parse(body);
        detail = j.detail || j.message || j.title || body.slice(0, 300);
      } catch {
        detail = body.slice(0, 300);
      }
      throw new Error(t("Kimlik belgesi g\xFCncelleme hatas\u0131 (HTTP {durum}):\n{ayrinti}", { durum: res.status, ayrinti: detail }));
    }
    return true;
  }
  function normalizeReservations(data) {
    var _a, _b, _c, _d, _e, _f;
    const raw = (_f = (_e = (_d = (_c = (_a = data == null ? void 0 : data.reservations) == null ? void 0 : _a.reservationInfo) != null ? _c : (
      // ← gerçek yapı (Postman doğruladı)
      (_b = data == null ? void 0 : data.reservations) == null ? void 0 : _b.reservation
    )) != null ? _d : data == null ? void 0 : data.reservationInfo) != null ? _e : data == null ? void 0 : data.reservations) != null ? _f : [];
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list.flatMap((r, idx) => {
      var _a2, _b2, _c2, _d2, _e2, _f2, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y;
      const g = (_a2 = r == null ? void 0 : r.reservationGuest) != null ? _a2 : {};
      const firstName = (_c2 = (_b2 = g.givenName) != null ? _b2 : g.firstName) != null ? _c2 : "";
      const lastName = (_e2 = (_d2 = g.surname) != null ? _d2 : g.lastName) != null ? _e2 : "";
      const guestId = (_f2 = g.id) != null ? _f2 : `#${idx + 1}`;
      const idList = (_g = r == null ? void 0 : r.reservationIdList) != null ? _g : [];
      const idArr = Array.isArray(idList) ? idList : [idList];
      const confirmationNo = (_k = (_j = (_h = idArr.find((i) => (i == null ? void 0 : i.type) === "Confirmation")) == null ? void 0 : _h.id) != null ? _j : (_i = idArr.find((i) => (i == null ? void 0 : i.type) === "Reservation")) == null ? void 0 : _i.id) != null ? _k : "\u2014";
      const rs = (_l = r == null ? void 0 : r.roomStay) != null ? _l : {};
      const checkIn = (_m = rs.arrivalDate) != null ? _m : "\u2014";
      const checkOut = (_n = rs.departureDate) != null ? _n : "\u2014";
      const roomType = (_p = (_o = rs.roomType) != null ? _o : rs.roomClass) != null ? _p : "";
      const room = (_q = rs.roomId) != null ? _q : "";
      const status = (_s = (_r = r == null ? void 0 : r.reservationStatus) != null ? _r : r == null ? void 0 : r.computedReservationStatus) != null ? _s : "";
      const pseudoRoom = rs.pseudoRoom === true || String(rs.pseudoRoom) === "true";
      const adults = (_t = rs.adultCount) != null ? _t : 0;
      const children = (_u = rs.childCount) != null ? _u : 0;
      const reservationId = (_w = (_v = idArr.find((i) => (i == null ? void 0 : i.type) === "Reservation")) == null ? void 0 : _v.id) != null ? _w : null;
      const accompanyProfileIds = [].concat((_x = g.accompanyGuests) != null ? _x : []).map(
        (ag) => {
          var _a3, _b3;
          return (_b3 = [].concat((_a3 = ag.profileIdList) != null ? _a3 : []).find((p) => p.type === "Profile")) == null ? void 0 : _b3.id;
        }
      ).filter(Boolean);
      const mainGuest = { guestId, firstName, lastName, confirmationNo, reservationId, checkIn, checkOut, roomType, room, status, adults, children, isAccompany: false, accompanyProfileIds, pseudoRoom };
      const accompany = [].concat((_y = g.accompanyGuests) != null ? _y : []).map((ag) => {
        var _a3, _b3, _c3, _d3, _e3, _f3, _g2;
        const agId = (_c3 = (_b3 = [].concat((_a3 = ag.profileIdList) != null ? _a3 : []).find((p) => p.type === "Profile")) == null ? void 0 : _b3.id) != null ? _c3 : null;
        return {
          guestId: agId,
          firstName: (_e3 = (_d3 = ag.firstName) != null ? _d3 : ag.givenName) != null ? _e3 : "",
          lastName: (_g2 = (_f3 = ag.lastName) != null ? _f3 : ag.surname) != null ? _g2 : "",
          confirmationNo,
          checkIn,
          checkOut,
          roomType,
          room,
          status,
          adults,
          children,
          reservationId,
          isAccompany: true,
          accompanyOf: guestId,
          pseudoRoom
        };
      }).filter((ag) => ag.guestId && (ag.firstName || ag.lastName));
      return [mainGuest, ...accompany];
    }).filter((g) => (g.firstName || g.lastName) && !g.pseudoRoom);
  }
  const EMPTY_SCAN = { firstName: "", middleName: "", lastName: "", idNumber: "", gender: "M", dateOfBirth: "", birthPlace: "", documentType: "PASSPORT", documentNumber: "", nationality: "", issuedDate: "", expiryDate: "", issuingCountry: "", issuedPlace: "" };
  const APP_W = 1120;
  const S = {
    blue: "#4A90D9",
    navy: "#1A3A6E",
    navy2: "#2A5298",
    navy3: "#3A6BC4",
    orange: "#F7941D",
    orangeDk: "#F15A22",
    orangeLt: "#FAB860",
    bg: "#EEF4FB",
    text: "#1A2A3A",
    muted: "#6B7A8D",
    border: "#D8E3EF",
    green: "#27AE60",
    red: "#E53935",
    shadow: "0 2px 14px rgba(26,58,110,.10)"
  };
  const GS = `
  /* Marka kutusu (t\xFCm ekran boyutlar\u0131nda): k\xFC\xE7\xFCk logo, beyazdan koyu zemin */
  .topbar-logo{background:#D3DEEE !important;padding:5px 10px !important;gap:9px !important;box-shadow:0 1px 6px rgba(8,20,42,.25) !important}
  .tb-logo-img{height:18px !important}
  .tb-logo-text{font-size:13px !important;padding-left:9px !important;border-left-color:#AEBBD0 !important}
  .app-footer{padding:14px 16px;text-align:center;font-size:12px;color:#6B7280;border-top:1px solid #E5E7EB;background:#fff}
  @media print{.app-footer{display:none !important}}
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
  /* Dil de\u011Fi\u015Ftirici (TR | EN) */
  .lang-switch{display:inline-flex;border:1px solid rgba(255,255,255,.28);border-radius:10px;overflow:hidden;flex-shrink:0}
  .lang-switch button{background:transparent;border:none;color:rgba(255,255,255,.7);font-size:12px;font-weight:800;padding:7px 10px;cursor:pointer;min-width:38px;min-height:34px}
  .lang-switch button.on{background:rgba(255,255,255,.24);color:#fff}
  @media (max-width: 760px){ .lang-switch button{min-height:40px;min-width:42px} }
  /* Rezervasyon kart\u0131 eylemleri: tablet ve telefonda parmakla rahat bas\u0131l\u0131r (en az 44px) */
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
  /* Yinelenen profil ileti\u015Fim kutusu: telefonda alttan a\xE7\u0131lan sayfa, geni\u015F ekranda ortada */
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
  /* Tablet dikey ve telefon: ba\u015Fl\u0131k kutusu ve bilgi kartlar\u0131 s\u0131k\u0131\u015F\u0131k d\xFCzen */
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
  /* Telefon: form alanlar\u0131 tek s\xFCtun */
  @media (max-width: 560px){
    .form-grid{grid-template-columns:1fr !important}
  }
  /* Telefon \xFCst \xE7ubu\u011Fu: 1. sat\u0131r logo + otel ad\u0131, 2. sat\u0131r e\u015Fit geni\u015Flikte d\xFC\u011Fmeler (dil de\u011Fi\u015Fince d\xFCzen kaymaz) */
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
  const AVTS = [`linear-gradient(135deg,${S.blue},${S.navy})`, `linear-gradient(135deg,${S.orange},${S.orangeDk})`, `linear-gradient(135deg,#5B9BD5,#2560A8)`, `linear-gradient(135deg,#27AE60,#1A7A43)`];
  const inits = (f, l) => {
    var _a, _b;
    return `${(_a = f == null ? void 0 : f[0]) != null ? _a : ""}${(_b = l == null ? void 0 : l[0]) != null ? _b : ""}`.toUpperCase();
  };
  const Avt = ({ f, l, idx = 0, sz = 44, room, forceInitials }) => /* @__PURE__ */ React.createElement("div", { style: { width: sz, height: sz, borderRadius: "50%", background: AVTS[idx % AVTS.length], display: "flex", alignItems: "center", justifyContent: "center", fontSize: room ? sz * 0.3 : sz * 0.36, fontWeight: 800, color: "#fff", flexShrink: 0, letterSpacing: "-0.5px" } }, forceInitials ? inits(f, l) : room || "");
  const Spin = ({ sz = 16 }) => /* @__PURE__ */ React.createElement("span", { style: { width: sz, height: sz, border: "2.5px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin .7s linear infinite", display: "inline-block" } });
  const DateInput = ({ label, value, onChange, required, onInvalid }) => {
    const [show, setShow] = React.useState(false);
    const [y, setY] = React.useState((value || "").slice(0, 4) || "");
    const [m, setM] = React.useState((value || "").slice(5, 7) || "");
    const [d, setD] = React.useState((value || "").slice(8, 10) || "");
    const isoToText = (iso) => /^\d{4}-\d{2}-\d{2}/.test(iso || "") ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "";
    const textToIso = (t2) => {
      const mm = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t2);
      if (!mm) return "";
      const [, dd, mo, yyyy] = mm;
      const dt = new Date(Date.UTC(+yyyy, +mo - 1, +dd));
      const ok = dt.getUTCFullYear() === +yyyy && dt.getUTCMonth() === +mo - 1 && dt.getUTCDate() === +dd && +yyyy >= 1900 && +yyyy <= (/* @__PURE__ */ new Date()).getFullYear();
      return ok ? `${yyyy}-${mo}-${dd}` : "";
    };
    const [text, setText] = React.useState(isoToText(value));
    React.useEffect(() => {
      if (value && value.length >= 10) {
        setY(value.slice(0, 4));
        setM(value.slice(5, 7));
        setD(value.slice(8, 10));
      } else if (!value) {
        setY("");
        setM("");
        setD("");
      }
      if (value !== textToIso(text)) setText(isoToText(value));
    }, [value]);
    const onType = (e) => {
      const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
      const t2 = digits.slice(0, 2) + (digits.length > 2 ? "." + digits.slice(2, 4) : "") + (digits.length > 4 ? "." + digits.slice(4, 8) : "");
      setText(t2);
      const iso = textToIso(t2);
      if (iso !== value) onChange(iso);
    };
    const badText = text.length === 10 && !textToIso(text);
    const incomplete = text.length > 0 && !textToIso(text);
    React.useEffect(() => {
      if (onInvalid) onInvalid(incomplete);
    }, [incomplete]);
    const commit = (ny, nm, nd) => {
      if (ny && ny.length === 4 && nm && nd) {
        onChange(ny + "-" + nm.padStart(2, "0") + "-" + nd.padStart(2, "0"));
      }
    };
    const curYear = (/* @__PURE__ */ new Date()).getFullYear();
    const years = Array.from({ length: 100 }, (_, i) => String(curYear - i));
    const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
    const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));
    return /* @__PURE__ */ React.createElement("div", { style: { position: "relative" } }, /* @__PURE__ */ React.createElement("label", { className: "lbl" }, label, required && /* @__PURE__ */ React.createElement("span", { style: { color: S.red } }, " *")), /* @__PURE__ */ React.createElement("div", { className: "inp", style: { display: "flex", alignItems: "center", gap: 8, ...badText ? { borderColor: S.red } : {} } }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        inputMode: "numeric",
        autoComplete: "off",
        maxLength: 10,
        placeholder: t("GG.AA.YYYY"),
        value: text,
        onChange: onType,
        style: { flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", font: "inherit", color: "inherit", padding: 0 }
      }
    ), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setShow((s) => !s), title: t("Takvimden se\xE7"), "aria-label": t("Takvimden se\xE7"), style: { background: "none", border: "none", cursor: "pointer", fontSize: 18, padding: "6px 4px", minWidth: 36 } }, "\u{1F4C5}")), badText && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: S.red, marginTop: 3 } }, t("Ge\xE7erli bir tarih girin (GG.AA.YYYY)")), show && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: "100%", left: 0, right: 0, zIndex: 999, background: "#fff", border: `1.5px solid ${S.blue}`, borderRadius: 12, boxShadow: "0 8px 28px rgba(26,58,110,.18)", padding: 14, marginTop: 4 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: S.muted, marginBottom: 4, textAlign: "center" } }, t("G\xDCN")), /* @__PURE__ */ React.createElement("select", { value: d, onChange: (e) => {
      setD(e.target.value);
      commit(y, m, e.target.value);
    }, className: "inp", style: { padding: "10px 4px", textAlign: "center", fontSize: 16 } }, /* @__PURE__ */ React.createElement("option", { value: "" }, "--"), days.map((v) => /* @__PURE__ */ React.createElement("option", { key: v, value: v }, v)))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: S.muted, marginBottom: 4, textAlign: "center" } }, t("AY")), /* @__PURE__ */ React.createElement("select", { value: m, onChange: (e) => {
      setM(e.target.value);
      commit(y, e.target.value, d);
    }, className: "inp", style: { padding: "10px 4px", textAlign: "center", fontSize: 16 } }, /* @__PURE__ */ React.createElement("option", { value: "" }, "--"), months.map((v) => /* @__PURE__ */ React.createElement("option", { key: v, value: v }, v)))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: S.muted, marginBottom: 4, textAlign: "center" } }, t("YIL")), /* @__PURE__ */ React.createElement("select", { value: y, onChange: (e) => {
      setY(e.target.value);
      commit(e.target.value, m, d);
    }, className: "inp", style: { padding: "10px 4px", textAlign: "center", fontSize: 16 } }, /* @__PURE__ */ React.createElement("option", { value: "" }, "----"), years.map((v) => /* @__PURE__ */ React.createElement("option", { key: v, value: v }, v))))), /* @__PURE__ */ React.createElement("button", { onClick: () => setShow(false), style: { width: "100%", background: `linear-gradient(135deg,${S.blue},${S.navy})`, color: "#fff", border: "none", borderRadius: 8, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer" } }, t("Tamam"))));
  };
  const Fld = ({ label, value, onChange, type = "text", required, opts }) => /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "lbl" }, label, required && /* @__PURE__ */ React.createElement("span", { style: { color: S.red } }, " *")), opts ? /* @__PURE__ */ React.createElement("select", { value, onChange: (e) => onChange(e.target.value), className: "inp", style: { appearance: "none" } }, opts.map((o) => /* @__PURE__ */ React.createElement("option", { key: o.v, value: o.v }, o.l))) : /* @__PURE__ */ React.createElement("input", { type, value, onChange: (e) => onChange(e.target.value), className: "inp" }));
  const RUNTIME_KEY = "snappass_runtime";
  const RUNTIME_VERSION = "2026-03-22-ocrfix-1";
  function isAdminUser(session) {
    return (session == null ? void 0 : session.role) === "admin";
  }
  function loadRuntimeState() {
    try {
      const data = JSON.parse(sessionStorage.getItem(RUNTIME_KEY) || "null");
      if (!data || data.version !== RUNTIME_VERSION) return null;
      return data;
    } catch {
      return null;
    }
  }
  function saveRuntimeState(state) {
    try {
      sessionStorage.setItem(RUNTIME_KEY, JSON.stringify({ ...state, version: RUNTIME_VERSION }));
    } catch {
    }
  }
  function clearRuntimeState() {
    try {
      sessionStorage.removeItem(RUNTIME_KEY);
    } catch {
    }
  }
  function AlertBell() {
    const [items, setItems] = useState([]);
    const [open, setOpen] = useState(false);
    const [popup, setPopup] = useState([]);
    const dismissed = useRef(/* @__PURE__ */ new Set());
    const load = useCallback(async () => {
      try {
        const r = await fetch(`${PROXY}/api/alerts`);
        if (!r.ok) return;
        const d = await r.json();
        const list = d.alerts || [];
        setItems(list);
        setPopup(list.filter((a) => !a.resolved && !a.seen && !dismissed.current.has(a.id)));
      } catch (_) {
      }
    }, []);
    useEffect(() => {
      load();
      const iv = setInterval(load, 6e4);
      const onVis = () => {
        if (document.visibilityState === "visible") load();
      };
      document.addEventListener("visibilitychange", onVis);
      return () => {
        clearInterval(iv);
        document.removeEventListener("visibilitychange", onVis);
      };
    }, [load]);
    const active = items.filter((a) => !a.resolved);
    const ack = async () => {
      const ids = popup.map((a) => a.id);
      ids.forEach((i) => dismissed.current.add(i));
      setPopup([]);
      try {
        await fetch(`${PROXY}/api/alerts/seen`, { method: "POST", headers: { "Content-Type": "application/json", "x-csrf": serverCsrf }, body: JSON.stringify({ ids }) });
      } catch (_) {
      }
      load();
    };
    const when = (d) => {
      try {
        return new Date(d).toLocaleString(CUR_LANG === "en" ? "en-GB" : "tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      } catch (_) {
        return "";
      }
    };
    const label = () => "OHIP";
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { className: "tb-btn", onClick: () => setOpen((o) => !o), title: t("Sistem uyar\u0131lar\u0131"), "aria-label": t("Sistem uyar\u0131lar\u0131"), style: { position: "relative", background: active.length ? "rgba(231,76,60,.22)" : "rgba(255,255,255,.1)", border: active.length ? "1px solid rgba(231,76,60,.5)" : "1px solid rgba(255,255,255,.18)", color: "#fff", borderRadius: 10, padding: "7px 11px", fontSize: 14, cursor: "pointer", flexShrink: 0, lineHeight: 1 } }, "\u{1F514}", active.length > 0 && /* @__PURE__ */ React.createElement("span", { style: { position: "absolute", top: -6, right: -6, minWidth: 18, height: 18, borderRadius: 9, background: "#E74C3C", color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" } }, active.length)), open && /* @__PURE__ */ React.createElement(Portal, null, /* @__PURE__ */ React.createElement("div", { onClick: () => setOpen(false), style: { position: "fixed", inset: 0, zIndex: 9e3 } }, /* @__PURE__ */ React.createElement("div", { onClick: (e) => e.stopPropagation(), style: { position: "absolute", top: 64, right: 12, left: 12, maxWidth: 420, marginLeft: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 16px 48px rgba(0,0,0,.28)", padding: 14, maxHeight: "70vh", overflow: "auto", color: "#1f2937" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 } }, /* @__PURE__ */ React.createElement("b", { style: { fontSize: 14 } }, t("Sistem uyar\u0131lar\u0131")), /* @__PURE__ */ React.createElement("button", { onClick: () => setOpen(false), style: { border: "none", background: "none", fontSize: 20, cursor: "pointer", padding: "4px 8px" } }, "\xD7")), items.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "#6b7280", padding: "10px 0" } }, t("\u015Eu an bir sorun yok.")), items.map((a) => /* @__PURE__ */ React.createElement("div", { key: a.id, style: { borderTop: "1px solid #eef0f3", padding: "10px 0", opacity: a.resolved ? 0.55 : 1 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999, background: a.resolved ? "#dcfce7" : "#fee2e2", color: a.resolved ? "#166534" : "#991b1b" } }, label(a), " \xB7 ", a.resolved ? t("\xC7\xF6z\xFCld\xFC") : t("Aktif")), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "#6b7280" } }, when(a.lastAt), a.count > 1 ? ` \xB7 ${a.count}\xD7` : "")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, marginTop: 4 } }, a.message)))))), popup.length > 0 && /* @__PURE__ */ React.createElement(Portal, null, /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", inset: 0, zIndex: 9500, background: "rgba(10,20,40,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 } }, /* @__PURE__ */ React.createElement("div", { role: "alertdialog", style: { background: "#fff", borderRadius: 16, maxWidth: 440, width: "100%", padding: 20, boxShadow: "0 24px 64px rgba(0,0,0,.35)", color: "#1f2937", maxHeight: "85vh", overflow: "auto" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 18, fontWeight: 800, marginBottom: 6 } }, "\u26A0\uFE0F ", t("Sistem uyar\u0131s\u0131")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "#6b7280", marginBottom: 10 } }, t("A\u015Fa\u011F\u0131daki sorun bildirildi. \xC7\xF6z\xFClene kadar zil simgesinde g\xF6r\xFCnmeye devam eder.")), popup.map((a) => /* @__PURE__ */ React.createElement("div", { key: a.id, style: { background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 12px", marginBottom: 8 } }, /* @__PURE__ */ React.createElement("b", { style: { fontSize: 13 } }, label(a)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, marginTop: 2 } }, a.message))), /* @__PURE__ */ React.createElement("button", { onClick: ack, style: { width: "100%", marginTop: 6, padding: "13px 16px", border: "none", borderRadius: 12, background: "#102546", color: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer" } }, t("Anlad\u0131m"))))));
  }
  function TopBar({ session, onLogout, onBack, onConfig }) {
    return /* @__PURE__ */ React.createElement("div", { style: { background: `linear-gradient(135deg,#102546,${S.navy2} 60%,${S.navy3})`, boxShadow: "0 8px 28px rgba(12,28,58,.22)" } }, /* @__PURE__ */ React.createElement("div", { className: "topbar-row", style: { maxWidth: APP_W, margin: "0 auto", display: "flex", alignItems: "center", gap: 14, minHeight: 70, padding: "10px 18px", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 } }, onBack && /* @__PURE__ */ React.createElement("button", { onClick: onBack, style: { background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.14)", color: "#fff", borderRadius: "10px", padding: "7px 12px", cursor: "pointer", fontSize: 12, fontWeight: 800, backdropFilter: "blur(8px)" } }, t("\u2190 Geri")), /* @__PURE__ */ React.createElement("div", { className: onBack ? "topbar-logo has-back" : "topbar-logo", style: { display: "inline-flex", alignItems: "center", gap: 12, padding: "8px 14px", borderRadius: 12, background: "#fff", boxShadow: "0 2px 10px rgba(8,20,42,.25)" } }, /* @__PURE__ */ React.createElement("img", { className: "tb-logo-img", src: "/admin/protel-logo.svg", alt: "PROTEL", style: { height: 22, width: "auto", display: "block" } }), /* @__PURE__ */ React.createElement("span", { className: "tb-logo-text", style: { paddingLeft: 12, borderLeft: "1px solid #D9DEE7", fontSize: 15, fontWeight: 700, color: "#1F2937", lineHeight: 1.2, whiteSpace: "nowrap" } }, "SnapPass"))), /* @__PURE__ */ React.createElement("div", { className: "topbar-title", style: { flex: 1, minWidth: 220 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 800, color: "rgba(255,255,255,.96)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, (session == null ? void 0 : session.hotelName) || t("SnapPass Belge Taray\u0131c\u0131")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(255,255,255,.48)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, session ? `${session.fullName || session.username} \xB7 ${session.hotelId}` : t("Oracle OPERA Cloud i\u015F ak\u0131\u015F\u0131"))), session ? /* @__PURE__ */ React.createElement("div", { className: "tb-acts", style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginLeft: "auto" } }, /* @__PURE__ */ React.createElement("span", { className: "topbar-chip", style: { padding: "5px 10px", borderRadius: 999, background: isAdminUser(session) ? "rgba(39,174,96,.16)" : "rgba(255,255,255,.08)", border: isAdminUser(session) ? "1px solid rgba(39,174,96,.26)" : "1px solid rgba(255,255,255,.12)", color: isAdminUser(session) ? "#C7F4D4" : "rgba(255,255,255,.82)", fontSize: 11, fontWeight: 800 } }, isAdminUser(session) ? t("Y\xD6NET\u0130C\u0130") : t("KULLANICI")), /* @__PURE__ */ React.createElement("span", { className: "topbar-chip", style: { padding: "5px 10px", borderRadius: 999, background: "rgba(247,148,29,.16)", border: "1px solid rgba(247,148,29,.22)", color: S.orangeLt, fontSize: 11, fontWeight: 800 } }, session.hotelId), /* @__PURE__ */ React.createElement(AlertBell, null), session.hotelAdmin && /* @__PURE__ */ React.createElement("a", { className: "tb-btn", href: "/otel", title: t("Otel y\xF6netimi"), "aria-label": t("Otel y\xF6netimi"), style: { background: "rgba(247,148,29,.18)", border: "1px solid rgba(247,148,29,.34)", color: S.orangeLt, borderRadius: "10px", padding: "7px 11px", fontSize: 12, fontWeight: 800, textDecoration: "none", minHeight: 34, display: "inline-flex", alignItems: "center" } }, "\u{1F6E0} ", /* @__PURE__ */ React.createElement("span", { className: "topbar-help-label", style: { marginLeft: 4 } }, t("Otel y\xF6netimi"))), /* @__PURE__ */ React.createElement("a", { className: "tb-btn", href: "/yardim", target: "_blank", rel: "noopener", title: t("Yard\u0131m"), "aria-label": t("Yard\u0131m"), style: { background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.18)", color: "rgba(255,255,255,.85)", borderRadius: "10px", padding: "7px 11px", fontSize: 12, fontWeight: 800, textDecoration: "none", minHeight: 34, display: "inline-flex", alignItems: "center" } }, "\u2754 ", /* @__PURE__ */ React.createElement("span", { className: "topbar-help-label", style: { marginLeft: 4 } }, t("Yard\u0131m"))), onConfig && /* @__PURE__ */ React.createElement("button", { className: "tb-btn", onClick: onConfig, title: t("Y\xF6netim paneli"), "aria-label": t("Y\xF6netim paneli"), style: { background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.18)", color: "rgba(255,255,255,.78)", borderRadius: "10px", padding: "7px 11px", fontSize: 12, cursor: "pointer", flexShrink: 0 } }, "\u2699"), /* @__PURE__ */ React.createElement(LangSwitch, null), onLogout && /* @__PURE__ */ React.createElement("button", { className: "tb-btn", onClick: onLogout, style: { background: "rgba(247,148,29,.18)", border: "1px solid rgba(247,148,29,.34)", color: S.orangeLt, borderRadius: "10px", padding: "7px 12px", fontSize: 12, fontWeight: 800, cursor: "pointer", flexShrink: 0 } }, t("\xC7\u0131k\u0131\u015F"))) : /* @__PURE__ */ React.createElement("div", { style: { marginLeft: "auto" } }, /* @__PURE__ */ React.createElement(LangSwitch, null))));
  }
  function sortByRoom(list) {
    const groups = [];
    (list || []).forEach((g) => {
      if (!g.isAccompany || !groups.length) groups.push([g]);
      else groups[groups.length - 1].push(g);
    });
    const key = (g) => {
      const r = String(g[0].room || "").trim();
      const n = parseInt(r, 10);
      return { n: Number.isNaN(n) ? Infinity : n, r };
    };
    groups.sort((a, b) => {
      const ka = key(a), kb = key(b);
      return ka.n - kb.n || ka.r.localeCompare(kb.r, "tr", { numeric: true });
    });
    return groups.flat();
  }
  function ProfileInfoLine({ pd }) {
    const miss = (icon, label) => /* @__PURE__ */ React.createElement("span", { style: { color: S.orangeDk, fontWeight: 700 } }, /* @__PURE__ */ React.createElement("b", null, icon), " ", label, t(": eksik"));
    const natCode = pd.nationality ? toIso2(pd.nationality) : "";
    const personalMissing = !!natCode && natCode !== "TR";
    return /* @__PURE__ */ React.createElement("div", { className: "profile-info", style: { marginTop: 6, padding: "8px 10px", background: "#F6F9FD", borderRadius: 8, display: "flex", flexWrap: "wrap", gap: "6px 16px" } }, pd.documentNumber ? /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: S.muted } }, "\u{1FAAA}"), " ", idTypeLabel({ v: pd.idType, l: pd.idType || "ID" }), ": ", /* @__PURE__ */ React.createElement("b", null, pd.documentNumber)) : miss("\u{1FAAA}", t("Belge no")), pd.birthDate ? /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: S.muted } }, "\u{1F382}"), " ", fmtDateTR(pd.birthDate)) : personalMissing ? miss("\u{1F382}", t("Do\u011Fum tarihi")) : null, pd.birthPlace ? /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: S.muted } }, "\u{1F4CD}"), " ", pd.birthPlace) : personalMissing ? miss("\u{1F4CD}", t("Do\u011Fum yeri")) : null, pd.nationality ? /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: S.muted } }, "\u{1F30D}"), " ", pd.nationality) : miss("\u{1F30D}", t("Uyruk")), pd.gender ? /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: S.muted } }, "\u26A5"), " ", pd.gender === "M" ? t("Erkek") : pd.gender === "F" ? t("Kad\u0131n") : pd.gender) : personalMissing ? miss("\u26A5", t("Cinsiyet")) : null);
  }
  function Portal({ children }) {
    return ReactDOM.createPortal(children, document.body);
  }
  function askConfirm(message) {
    return new Promise((resolve) => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = ReactDOM.createRoot(host);
      const done = (v) => {
        root.unmount();
        host.remove();
        resolve(v);
      };
      root.render(
        /* @__PURE__ */ React.createElement("div", { role: "dialog", "aria-modal": "true", style: { position: "fixed", inset: 0, zIndex: 5e3, background: "rgba(10,25,45,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }, onClick: (e) => {
          if (e.target === e.currentTarget) done(false);
        } }, /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", borderRadius: 14, padding: "18px 18px 14px", maxWidth: 420, width: "100%" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, color: S.navy, lineHeight: 1.6, marginBottom: 14, whiteSpace: "pre-line" } }, message), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("button", { className: "btn", onClick: () => done(false), style: { padding: "10px 16px", minHeight: 44, borderRadius: 9, border: `1.5px solid ${S.border}`, background: "#fff", fontWeight: 700 } }, t("Vazge\xE7")), /* @__PURE__ */ React.createElement("button", { className: "btn btn-p", autoFocus: true, onClick: () => done(true), style: { padding: "10px 16px", minHeight: 44, borderRadius: 9 } }, t("Evet")))))
      );
    });
  }
  function UserLog() {
    const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const [from, setFrom] = useState(() => day(new Date(Date.now() - 6 * 864e5)));
    const [to, setTo] = useState(() => day(/* @__PURE__ */ new Date()));
    const [items, setItems] = useState(null), [err, setErr] = useState(""), [q, setQ] = useState("");
    const load = async () => {
      setErr("");
      setItems(null);
      try {
        const r = await fetch(`${PROXY}/api/logs?from=${from}&to=${to}`, { cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || t("Log al\u0131namad\u0131"));
        setItems(d.items || []);
      } catch (e) {
        setErr(e.message);
        setItems([]);
      }
    };
    useEffect(() => {
      load();
    }, []);
    const when = (v) => {
      const d = new Date(v);
      return isNaN(d) ? "" : `${fmtDateTR(day(d))} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };
    const shown = (items || []).filter((x) => !q.trim() || `${x.user} ${x.action} ${x.detail}`.toLocaleLowerCase("tr-TR").includes(q.trim().toLocaleLowerCase("tr-TR")));
    return /* @__PURE__ */ React.createElement("div", { className: "card", style: { padding: "16px 16px 10px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 800, color: S.navy, marginBottom: 4 } }, "\u{1F4DC} ", t("De\u011Fi\u015Fiklikler")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: S.muted, marginBottom: 12, lineHeight: 1.5 } }, t("Bu oteldeki kullan\u0131c\u0131lar\u0131n i\u015Flemleri: giri\u015F/\xE7\u0131k\u0131\u015F, OPERA'ya kaydedilen profil ve belgeler. Profil ve belge kay\u0131tlar\u0131nda de\u011Fi\u015Fen alanlar\u0131n eski ve yeni de\u011Feri yaz\u0131l\u0131r; bunun d\u0131\u015F\u0131nda misafir ad\u0131 ve kimlik numaras\u0131 tutulmaz.")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 } }, /* @__PURE__ */ React.createElement("label", { style: { display: "grid", gap: 4, fontSize: 11, fontWeight: 800, color: S.muted, letterSpacing: ".4px" } }, t("BA\u015ELANGI\xC7"), /* @__PURE__ */ React.createElement("input", { className: "inp", type: "date", value: from, max: to, onChange: (e) => setFrom(e.target.value), style: { minWidth: 150 } })), /* @__PURE__ */ React.createElement("label", { style: { display: "grid", gap: 4, fontSize: 11, fontWeight: 800, color: S.muted, letterSpacing: ".4px" } }, t("B\u0130T\u0130\u015E"), /* @__PURE__ */ React.createElement("input", { className: "inp", type: "date", value: to, min: from, onChange: (e) => setTo(e.target.value), style: { minWidth: 150 } })), /* @__PURE__ */ React.createElement("button", { className: "btn btn-p", onClick: load, style: { padding: "10px 16px", borderRadius: 9, minHeight: 42 } }, t("G\xF6ster")), /* @__PURE__ */ React.createElement("input", { className: "inp", style: { flex: "1 1 200px" }, value: q, onChange: (e) => setQ(e.target.value), placeholder: t("Ara\u2026 ki\u015Fi, i\u015Flem, profil no") })), err && /* @__PURE__ */ React.createElement("div", { style: { color: S.red, fontSize: 13, marginBottom: 8 } }, err), items === null ? /* @__PURE__ */ React.createElement("div", { style: { padding: "18px 0" } }, /* @__PURE__ */ React.createElement(Spin, null)) : shown.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { padding: "18px 0", textAlign: "center", color: S.muted, fontSize: 13 } }, t("Kay\u0131t yok")) : /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 0 } }, shown.map((x) => /* @__PURE__ */ React.createElement("div", { key: x.id, style: { display: "grid", gridTemplateColumns: "minmax(120px,150px) minmax(90px,160px) 1fr", gap: "4px 12px", padding: "9px 4px", borderTop: `1px solid ${S.border}`, fontSize: 13, alignItems: "baseline" }, className: "log-row" }, /* @__PURE__ */ React.createElement("span", { style: { color: S.muted, whiteSpace: "nowrap" } }, when(x.at)), /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 700, color: S.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: x.user }, x.user || "\u2014"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { fontWeight: 700 } }, t(x.action)), x.detail ? /* @__PURE__ */ React.createElement("span", { style: { color: S.muted } }, " \xB7 ", x.detail) : null))), /* @__PURE__ */ React.createElement("style", null, `@media(max-width:600px){.log-row{grid-template-columns:1fr 1fr!important}.log-row>span:last-child{grid-column:1/-1}}`)), items && items.length >= 1e3 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: S.muted, marginTop: 8 } }, t("En son 1000 kay\u0131t g\xF6steriliyor; aral\u0131\u011F\u0131 daralt\u0131n.")));
  }
  function Search({ session, onSelect, onEdit, onAddAccompany, onLogout, onConfig, refreshRef, reloadProfileRef }) {
    const [tab, setTab] = useState(() => {
      try {
        const v = sessionStorage.getItem("sp-tab");
        return v === "log" ? v : "arrivals";
      } catch (_) {
        return "arrivals";
      }
    }), [byType, setByType] = useState("lastName");
    useEffect(() => {
      try {
        sessionStorage.setItem("sp-tab", tab === "log" ? tab : "");
      } catch (_) {
      }
    }, [tab]);
    const [q, setQ] = useState(""), [results, setResults] = useState(null), [busy, setBusy] = useState(false);
    React.useEffect(() => {
      if (refreshRef) refreshRef.current = (confNo, mainGuest, newInfo) => {
        setProfileMap({});
        if (confNo && mainGuest) {
          setBusy(true);
          setResults((prev) => {
            const base = (prev || []).filter((r) => r.confirmationNo !== confNo);
            const existing = (prev || []).filter((r) => r.confirmationNo === confNo);
            if (newInfo == null ? void 0 : newInfo.newProfileId) {
              const newGuest = {
                guestId: newInfo.newProfileId,
                firstName: newInfo.firstName || "",
                lastName: newInfo.lastName || "",
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
                accompanyOf: mainGuest.guestId
              };
              const alreadyExists = existing.some((g) => g.guestId === newInfo.newProfileId);
              return [...base, ...existing, ...alreadyExists ? [] : [newGuest]];
            }
            return [...base, ...existing];
          });
          setSelected(null);
          setTimeout(async () => {
            try {
              const data = await operaSearch({ ...session, byType: "confirmationNo", query: confNo, tab });
              const norm = normalizeReservations(data);
              if (norm.length > 0) setResults(norm);
              norm.forEach((g) => {
                if (g.guestId && !g.guestId.startsWith("#")) {
                  getProfileDetails({ hostName: session.hostName, hotelId: session.hotelId, appKey: session.appKey, token: session.token, profileId: g.guestId, firstName: g.firstName, lastName: g.lastName }).then((det) => {
                    if (det) setProfileMap((pm) => ({ ...pm, [g.guestId]: det }));
                  }).catch(() => {
                  });
                }
              });
            } catch (e) {
            }
            setBusy(false);
          }, 1500);
        } else {
          setResults(null);
          setSelected(null);
          setQ("");
        }
      };
    }, [session, tab]);
    const [apiErr, setApiErr] = useState(""), [selected, setSelected] = useState(null);
    const [profileMap, setProfileMap] = useState({});
    React.useEffect(() => {
      if (reloadProfileRef) reloadProfileRef.current = async (guestId, confNo) => {
        if (!guestId) return;
        const base = { hostName: session.hostName, hotelId: session.hotelId, appKey: session.appKey, token: session.token };
        const det = await getProfileDetails({ ...base, profileId: guestId, firstName: "", lastName: "", fresh: true });
        if (det) setProfileMap((pm) => ({ ...pm, [guestId]: det }));
        if (confNo) {
          try {
            const norm = normalizeReservations(await operaSearch({ ...session, byType: "confirmationNo", query: confNo, tab }));
            if (norm.length) {
              setResults((prev) => prev ? [...prev.filter((r) => r.confirmationNo !== confNo), ...norm] : prev);
              setSelected((sel) => sel && sel.confirmationNo === confNo ? norm.find((x) => String(x.guestId) === String(sel.guestId)) || sel : sel);
              norm.forEach((g) => {
                if (g.guestId && String(g.guestId) !== String(guestId) && !String(g.guestId).startsWith("#")) getProfileDetails({ ...base, profileId: g.guestId, firstName: g.firstName, lastName: g.lastName, fresh: true }).then((d) => {
                  if (d) setProfileMap((pm) => ({ ...pm, [g.guestId]: d }));
                }).catch(() => {
                });
              });
            }
          } catch (_) {
          }
        }
      };
    }, [session, tab]);
    const reset = (nt) => {
      setResults(null);
      setQ("");
      setSelected(null);
      setApiErr("");
      setProfileMap({});
      if (nt) {
        setTab(nt);
      }
    };
    const selectGuest = async (g) => {
      setSelected(g);
      if (!profileMap[g.guestId]) {
        const det = await getProfileDetails({ hostName: session.hostName, hotelId: session.hotelId, appKey: session.appKey, token: session.token, profileId: g.guestId, firstName: g.firstName, lastName: g.lastName, fresh: true });
        if (det) setProfileMap((pm) => ({ ...pm, [g.guestId]: det }));
      }
    };
    const doSearch = async () => {
      const normalizedQuery = q.trim();
      if (!normalizedQuery) {
        setSelected(null);
        setResults(null);
        setApiErr(t("Aramak i\xE7in bir \xF6l\xE7\xFCt girin: soyad, oda no ya da rezervasyon no."));
        return;
      }
      if (byType === "lastName" && normalizedQuery.replace(/[%*\s]/g, "").length < 2) {
        setSelected(null);
        setResults(null);
        setApiErr(t("Soyad i\xE7in en az 2 harf girin."));
        return;
      }
      setBusy(true);
      setSelected(null);
      setApiErr("");
      setResults(null);
      try {
        const list = await operaSearch({
          hostName: session.hostName,
          hotelId: session.hotelId,
          appKey: session.appKey,
          token: session.token,
          byType,
          query: normalizedQuery,
          tab
        });
        setResults(byType === "roomId" ? sortByRoom(list) : list);
      } catch (e) {
        setApiErr(e.message);
        setResults([]);
      }
      setBusy(false);
    };
    return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "calc(100dvh - 46px)", background: S.bg } }, /* @__PURE__ */ React.createElement("style", null, GS), /* @__PURE__ */ React.createElement(TopBar, { session, onLogout, onConfig }), /* @__PURE__ */ React.createElement("div", { className: "page-wrap", style: { maxWidth: APP_W, margin: "0 auto", padding: "24px 18px 60px" } }, /* @__PURE__ */ React.createElement("div", { className: "fadeUp" }, /* @__PURE__ */ React.createElement("style", null, `@media(max-width:600px){.main-tabs{display:grid!important;grid-template-columns:1fr 1fr}.main-tabs .tab{width:100%;justify-content:center}}`), /* @__PURE__ */ React.createElement("div", { className: "main-tabs", style: { display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("button", { className: `tab ${tab === "arrivals" ? "ton" : "toff"}`, onClick: () => reset("arrivals") }, t("\u{1F6EC} Gelenler")), /* @__PURE__ */ React.createElement("button", { className: `tab ${tab === "inhouse" ? "ton" : "toff"}`, onClick: () => reset("inhouse") }, t("\u{1F3E8} Konaklayanlar")), /* @__PURE__ */ React.createElement("button", { className: `tab ${tab === "log" ? "ton" : "toff"}`, onClick: () => reset("log") }, t("\u{1F4DC} De\u011Fi\u015Fiklikler"))), tab === "log" ? /* @__PURE__ */ React.createElement(UserLog, null) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "card", style: { marginBottom: 14, padding: "18px 18px 16px", border: `1px solid ${S.border}`, background: "linear-gradient(180deg,#FFFFFF 0%, #F9FBFF 100%)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, fontWeight: 800, color: S.muted, letterSpacing: ".5px" } }, t("ARAMA KONSOLU")), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 4, fontSize: 15, fontWeight: 800, color: S.navy } }, t("Rezervasyon ve profil tarama ekran\u0131")))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 13 } }, [["lastName", t("\u{1F524} Soyada G\xF6re")], ["roomId", t("\u{1F6CF} Oda No'ya G\xF6re")]].map(([v, l]) => /* @__PURE__ */ React.createElement("button", { key: v, onClick: () => {
      setByType(v);
      reset();
    }, style: { flex: 1, padding: "9px 6px", borderRadius: 9, border: `1.5px solid ${byType === v ? S.blue : S.border}`, background: byType === v ? "#EEF5FF" : "#fff", color: byType === v ? S.blue : S.muted, fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all .18s" } }, l))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, marginBottom: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, position: "relative" } }, /* @__PURE__ */ React.createElement("span", { style: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: S.muted } }, "\u{1F50D}"), /* @__PURE__ */ React.createElement(
      "input",
      {
        value: q,
        onChange: (e) => setQ(e.target.value),
        onKeyDown: (e) => e.key === "Enter" && doSearch(),
        placeholder: byType === "roomId" ? t("Oda numaras\u0131 girin") : t("Soyad girin"),
        className: "inp",
        style: { paddingLeft: 40 }
      }
    )), /* @__PURE__ */ React.createElement("button", { className: "btn btn-p", onClick: doSearch, style: { padding: "11px 22px", flexShrink: 0, borderRadius: 9 } }, busy ? /* @__PURE__ */ React.createElement(Spin, null) : t("Ara")))), apiErr && /* @__PURE__ */ React.createElement("div", { className: "fadeIn", style: { background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 10, padding: "14px 16px", marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, color: S.red, fontSize: 13, marginBottom: 6 } }, t("\u26A0 API Hatas\u0131")), /* @__PURE__ */ React.createElement("pre", { style: { fontFamily: "monospace", fontSize: 11, color: "#B91C1C", wordBreak: "break-word", whiteSpace: "pre-wrap", margin: 0 } }, apiErr)), results !== null && /* @__PURE__ */ React.createElement("div", { className: "fadeUp" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 11 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, fontWeight: 700, color: S.muted } }, results.length === 0 ? t("Sonu\xE7 bulunamad\u0131") : results.length + " " + t("rezervasyon bulundu")), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, fontWeight: 800, color: S.muted, background: "#fff", border: `1px solid ${S.border}`, padding: "5px 10px", borderRadius: 999 } }, tab === "arrivals" ? t("GELENLER") : t("KONAKLAYANLAR"))), results.length === 0 && !apiErr && /* @__PURE__ */ React.createElement("div", { className: "card", style: { textAlign: "center", padding: "44px 20px", border: `1px solid ${S.border}`, background: "linear-gradient(180deg,#FFFFFF 0%, #F9FBFF 100%)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 38, marginBottom: 10 } }, "\u{1F50D}"), /* @__PURE__ */ React.createElement("p", { style: { color: S.navy, fontSize: 16, fontWeight: 800 } }, '"', q, t('" i\xE7in rezervasyon bulunamad\u0131')), /* @__PURE__ */ React.createElement("p", { style: { color: S.muted, fontSize: 12, marginTop: 8 } }, t("Farkl\u0131 yaz\u0131m deneyin veya Gelenler \u2194 Konaklayanlar aras\u0131nda ge\xE7i\u015F yap\u0131n"))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 9 } }, results.map((g, i) => {
      const sel = (selected == null ? void 0 : selected.confirmationNo) === g.confirmationNo && (selected == null ? void 0 : selected.guestId) === g.guestId;
      const sc = g.status === "CheckedIn" ? S.green : g.status === "Reserved" ? S.blue : S.orange;
      return /* @__PURE__ */ React.createElement("div", { key: i, className: `guest-row${sel ? " sel" : ""}`, onClick: () => selectGuest(g), style: g.isAccompany ? { marginLeft: 20, borderLeft: `3px solid #C4B5FD`, borderRadius: "0 10px 10px 0" } : {} }, /* @__PURE__ */ React.createElement(Avt, { f: g.firstName, l: g.lastName, idx: i, sz: 46, room: g.room || "" }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } }, g.isAccompany && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, background: "#F3E8FF", color: "#7C3AED", border: "1px solid #C4B5FD", padding: "2px 7px", borderRadius: 8, fontWeight: 700 } }, t("\u{1F465} Beraberindeki")), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 15, fontWeight: 800, color: S.navy } }, g.firstName, " ", g.lastName), sel && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, background: `linear-gradient(135deg,${S.blue},${S.navy})`, color: "#fff", padding: "2px 8px", borderRadius: 9, fontWeight: 800 } }, t("SE\xC7\u0130LD\u0130")), g.status && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, background: sc + "18", color: sc, border: `1px solid ${sc}30`, padding: "2px 8px", borderRadius: 9, fontWeight: 700 } }, statusText(g.status))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: S.muted, marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", null, "\u{1F4CB} ", g.confirmationNo), g.roomType && /* @__PURE__ */ React.createElement("span", null, "\u{1F6CF} ", g.roomType), /* @__PURE__ */ React.createElement("span", { style: { color: S.muted, fontSize: 11, background: "#F0F4F8", padding: "1px 7px", borderRadius: 5, fontFamily: "monospace" } }, "#", g.guestId)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: S.muted, marginTop: 3, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" } }, g.adults > 0 && /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 3, fontWeight: 600 } }, /* @__PURE__ */ React.createElement("svg", { width: "15", height: "15", viewBox: "0 0 24 24", fill: "none", stroke: S.navy, strokeWidth: "2", strokeLinecap: "round" }, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "6", r: "4" }), /* @__PURE__ */ React.createElement("path", { d: "M4 20c0-4 3.6-7 8-7s8 3 8 7" })), /* @__PURE__ */ React.createElement("span", { style: { color: S.navy, fontSize: 13 } }, g.adults)), g.children > 0 && /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 3, fontWeight: 600 } }, /* @__PURE__ */ React.createElement("svg", { width: "11", height: "11", viewBox: "0 0 24 24", fill: "none", stroke: S.orange, strokeWidth: "2.2", strokeLinecap: "round" }, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "6", r: "3.2" }), /* @__PURE__ */ React.createElement("path", { d: "M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6" })), /* @__PURE__ */ React.createElement("span", { style: { color: S.orange, fontSize: 12 } }, g.children))), (g.checkIn !== "\u2014" || g.checkOut !== "\u2014") && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: S.muted, marginTop: 2 } }, g.checkIn !== "\u2014" && t("Giri\u015F tarihi") + ": " + fmtDateTR(g.checkIn), g.checkIn !== "\u2014" && g.checkOut !== "\u2014" && " \xB7 ", g.checkOut !== "\u2014" && t("\xC7\u0131k\u0131\u015F tarihi") + ": " + fmtDateTR(g.checkOut)), sel && (() => {
        const curIds = (results || []).filter((r) => r.confirmationNo === g.confirmationNo && r.isAccompany && r.guestId).map((r) => r.guestId);
        const total = 1 + curIds.length;
        const max = (g.adults || 0) + (g.children || 0);
        const canAddMore = !g.isAccompany && (max === 0 || total < max);
        return /* @__PURE__ */ React.createElement("div", { className: "row-actions" }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-p btn-scan", onClick: (e) => {
          e.stopPropagation();
          onSelect(g, profileMap[g.guestId]);
        } }, t("\u{1F4F7} Belge Tara")), /* @__PURE__ */ React.createElement("button", { className: "btn btn-edit", disabled: !profileMap[g.guestId], title: profileMap[g.guestId] ? "" : t("Profil bilgileri y\xFCkleniyor"), onClick: (e) => {
          e.stopPropagation();
          onEdit(g, profileMap[g.guestId]);
        } }, t("\u270F\uFE0F D\xFCzenle")), canAddMore && /* @__PURE__ */ React.createElement("button", { className: "btn btn-acc", onClick: (e) => {
          e.stopPropagation();
          onAddAccompany({ ...g, accompanyProfileIds: curIds });
        } }, t("\u{1F465} Beraberindeki Ekle")));
      })(), sel && profileMap[g.guestId] && /* @__PURE__ */ React.createElement(ProfileInfoLine, { pd: profileMap[g.guestId] })), /* @__PURE__ */ React.createElement("div", { style: { color: sel ? S.blue : S.border, fontSize: 22 } }, "\u203A"));
    })))))));
  }
  const MRZ_WEIGHTS = [7, 3, 1];
  const MRZ_DIGIT_FIX = { O: "0", D: "0", Q: "0", U: "0", I: "1", L: "1", Z: "2", S: "5", G: "6", B: "8" };
  const MRZ_ALPHA_FIX = { "0": "O", "1": "I", "2": "Z", "5": "S", "6": "G", "8": "B" };
  function mrzValidDate(s) {
    if (!s || s.length !== 6 || !/^[0-9]{6}$/.test(s)) return false;
    const mm = parseInt(s.slice(2, 4), 10);
    const dd = parseInt(s.slice(4, 6), 10);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
    const maxDays = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return dd <= maxDays[mm];
  }
  function mrzDateToIso(yymmdd, isBirth) {
    if (!mrzValidDate(yymmdd)) return "";
    const yy = parseInt(yymmdd.slice(0, 2), 10);
    const mm = yymmdd.slice(2, 4);
    const dd = yymmdd.slice(4, 6);
    const cutoff = (/* @__PURE__ */ new Date()).getFullYear() - 2e3;
    const yyyy = isBirth ? yy > cutoff ? 1900 + yy : 2e3 + yy : 2e3 + yy;
    return `${yyyy}-${mm}-${dd}`;
  }
  function normalizeCountryCode(value) {
    const code = String(value || "").replace(/</g, "").trim().toUpperCase();
    if (!code) return "";
    if (code === "TUR") return "TR";
    return code;
  }
  function fmtDateTR(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
    return m ? `${m[3]}.${m[2]}.${m[1]}` : value || "";
  }
  function toIso2(value) {
    return window.IsoCountries ? window.IsoCountries.toIso2(value) : normalizeCountryCode(value);
  }
  function turkishIdTypeOpts() {
    return [{ v: "TCKN", l: t("TCKN \xB7 T.C. vatanda\u015F\u0131") }];
  }
  function applyNationalityRules(f, nat, scanIdNumber) {
    const next = { ...f, nationality: nat };
    if (nat === "TR") {
      if (next.documentType !== "TCKN") {
        next.documentType = "TCKN";
        const candidates = [next.documentNumber, scanIdNumber].map((v) => String(v || "").replace(/\D/g, ""));
        next.documentNumber = candidates.find(isValidTurkishIdentityNumber) || "";
      }
    } else if (next.documentType === "TCKN") {
      next.documentType = "PASSPORT";
      if (isValidTurkishIdentityNumber(next.documentNumber)) next.documentNumber = "";
    }
    return next;
  }
  function normalizeDocType(value) {
    const raw = String(value || "").trim().toUpperCase();
    if (!raw) return "";
    if (["NATIONAL_ID", "ID_CARD", "IDENTITY_CARD", "TCKN"].includes(raw)) return "TCKN";
    if (raw === "PASSPORT") return "PASSPORT";
    return raw;
  }
  function pickFieldValue(...values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  }
  function normalizeBirthPlace(value, fallbackCountry = "") {
    const text = String(value || "").trim();
    if (!text) return "";
    const upper = text.toUpperCase();
    const country = String(fallbackCountry || "").trim().toUpperCase();
    if (["TR", "TUR"].includes(upper)) return "";
    if (country && upper === country) return "";
    return text;
  }
  function isValidTurkishIdentityNumber(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (!/^[1-9][0-9]{10}$/.test(digits)) return false;
    const nums = digits.split("").map(Number);
    const odd = nums[0] + nums[2] + nums[4] + nums[6] + nums[8];
    const even = nums[1] + nums[3] + nums[5] + nums[7];
    const digit10 = (odd * 7 - even) % 10;
    const digit11 = nums.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
    return digit10 === nums[9] && digit11 === nums[10];
  }
  function mrzChecksum(input) {
    let total = 0;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      let val = 0;
      if (ch >= "0" && ch <= "9") val = ch.charCodeAt(0) - 48;
      else if (ch >= "A" && ch <= "Z") val = ch.charCodeAt(0) - 55;
      else if (ch === "<") val = 0;
      else return null;
      total += val * MRZ_WEIGHTS[i % MRZ_WEIGHTS.length];
    }
    return String(total % 10);
  }
  function fixMrzDigits(s) {
    return s.replace(/[A-Z]/g, (ch) => MRZ_DIGIT_FIX[ch] || ch);
  }
  function fixMrzAlpha(s) {
    return s.replace(/[0-9]/g, (ch) => MRZ_ALPHA_FIX[ch] || ch);
  }
  function normalizeMrzText(text) {
    const cleaned = text.split(/\r?\n/).map((l) => {
      let line = l.toUpperCase();
      line = line.replace(/[|]/g, "I");
      line = line.replace(/[!]/g, "1");
      line = line.replace(/[{(]/g, "<");
      line = line.replace(/[})]/g, ">");
      line = line.replace(/[$]/g, "S");
      line = line.replace(/[@]/g, "O");
      line = line.replace(/[#]/g, "H");
      line = line.replace(/\s+/g, "");
      line = line.replace(/[^A-Z0-9<]/g, "");
      return line.trim();
    }).filter(Boolean);
    const combined = [...cleaned];
    for (let i = 0; i < cleaned.length - 1; i++) {
      const joined = cleaned[i] + cleaned[i + 1];
      if (joined.length >= 30 && joined.length <= 48) combined.push(joined);
    }
    const chunked = [...combined];
    const tryChunk = (line, size, minPartLength = size - 4) => {
      if (line.length < size * 2) return;
      const parts = [];
      for (let i = 0; i < line.length; i += size) {
        const part = line.slice(i, i + size);
        if (part.length >= minPartLength) parts.push(part);
      }
      if (parts.length >= 2) chunked.push(...parts);
    };
    combined.forEach((line) => {
      tryChunk(line, 30);
      tryChunk(line, 44);
    });
    const unique = Array.from(new Set(chunked)).filter((l) => l.length >= 18);
    unique.sort((a, b) => {
      const sa = (a.includes("<<") ? 100 : 0) + (a.includes("<") ? 50 : 0) + (a.length >= 28 && a.length <= 44 ? 30 : 0);
      const sb = (b.includes("<<") ? 100 : 0) + (b.includes("<") ? 50 : 0) + (b.length >= 28 && b.length <= 44 ? 30 : 0);
      return sb - sa;
    });
    return unique.slice(0, 40);
  }
  function pickMrzField(rawField, checkDigit, transforms) {
    const candidates = Array.from(new Set(transforms.map((fn) => fn(rawField))));
    if (/^[0-9]$/.test(checkDigit)) {
      const match = candidates.find((candidate) => mrzChecksum(candidate) === checkDigit);
      if (match) return match;
    }
    return candidates[0];
  }
  function parseTD1Triplet(line1Raw, line2Raw, line3Raw) {
    const line1Base = line1Raw.padEnd(30, "<").slice(0, 30);
    const line2Base = line2Raw.padEnd(30, "<").slice(0, 30);
    const line3 = fixMrzAlpha(line3Raw).padEnd(30, "<").slice(0, 30);
    let score = 0;
    if (/^[ACI]/.test(line1Base)) score += 16;
    if (line1Base.includes("TUR")) score += 14;
    if (line3.includes("<<")) score += 14;
    if (/^[A-Z0-9<]{30}$/.test(line1Base)) score += 6;
    if (/^[A-Z0-9<]{30}$/.test(line2Base)) score += 6;
    if (/^[A-Z<]{24,30}$/.test(line3)) score += 8;
    const issuingCountry = fixMrzAlpha(line1Base.slice(2, 5)).replace(/</g, "");
    const documentCheck = fixMrzDigits(line1Base[14] || "<");
    const documentField = pickMrzField(line1Base.slice(5, 14), documentCheck, [
      (s) => s,
      (s) => fixMrzAlpha(s),
      (s) => fixMrzDigits(s)
    ]);
    const optional1 = line1Base.slice(15, 30);
    const optional1Fixed = fixMrzDigits(optional1);
    const optional1Digits = (optional1Fixed.match(/\d{11}/) || [])[0] || "";
    const birth = fixMrzDigits(line2Base.slice(0, 6));
    const birthCheck = fixMrzDigits(line2Base[6] || "<");
    const sexRaw = (line2Base[7] || "<").replace(/[^MF<]/g, "<");
    const expiry = fixMrzDigits(line2Base.slice(8, 14));
    const expiryCheck = fixMrzDigits(line2Base[14] || "<");
    const nationalityField = fixMrzAlpha(line2Base.slice(15, 18));
    const nationality = nationalityField.replace(/</g, "");
    const optional2 = line2Base.slice(18, 29);
    const finalCheck = fixMrzDigits(line2Base[29] || "<");
    const [lastRaw = "", firstRaw = ""] = line3.split("<<");
    const lastName = lastRaw.replace(/<+/g, " ").trim();
    const nameParts = firstRaw.replace(/<+/g, " ").trim().split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || "";
    const middleName = nameParts.slice(1).join(" ");
    const isTurkishId = [issuingCountry, nationalityField].includes("TUR") || line1Base.includes("TUR") || line2Base.includes("TUR");
    const documentNumber = isTurkishId && optional1Digits ? optional1Digits : documentField.replace(/</g, "");
    if (isTurkishId) {
      if (!optional1Digits || optional1Digits.length !== 11) return null;
      if (!isValidTurkishIdentityNumber(optional1Digits)) return null;
      if (!mrzValidDate(birth)) return null;
      if (!line2Base.includes("TUR")) return null;
      if (!lastName || lastName.length < 2) return null;
      if (!firstName || firstName.length < 2) return null;
      if (!line3.includes("<<")) return null;
    }
    if (documentNumber.length >= 4) score += 10;
    if (lastName) score += 10;
    if (firstName) score += 8;
    if (/^[A-Z]{3}$/.test(nationality || issuingCountry)) score += 6;
    if (mrzValidDate(birth)) score += 18;
    if (mrzValidDate(expiry)) score += 14;
    if (["M", "F", "<"].includes(sexRaw)) score += 4;
    if (line2Base.includes("TUR")) score += 6;
    if (optional1Digits) score += 16;
    if (isTurkishId) score += 12;
    const checks = [
      [documentField, documentCheck],
      [birth, birthCheck],
      [expiry, expiryCheck],
      [documentField + documentCheck + optional1 + birth + birthCheck + expiry + expiryCheck + optional2, finalCheck]
    ];
    for (const [value, digit] of checks) {
      if (/^[0-9]$/.test(digit) && mrzChecksum(value) === digit) score += 10;
    }
    if (score < (isTurkishId ? 68 : 46)) return null;
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
      mrzRaw: [line1Raw, line2Raw, line3Raw]
    };
  }
  function parseTD3Pair(topRaw, bottomRaw) {
    const top = fixMrzAlpha(topRaw).padEnd(44, "<").slice(0, 44);
    const bottomBase = bottomRaw.padEnd(44, "<").slice(0, 44);
    let score = 0;
    if (/^[PVIAC]/.test(top)) score += 18;
    if (top.includes("<<")) score += 12;
    if (/^[A-Z<]{30,44}$/.test(top)) score += 8;
    if (/^[A-Z0-9<]{30,44}$/.test(bottomBase)) score += 6;
    const issuingCountry = fixMrzAlpha(top.slice(2, 5)).replace(/</g, "");
    if (!/^[PVIAC]/.test(top)) return null;
    const dblChevIdx = top.indexOf("<<");
    if (dblChevIdx < 5) return null;
    const namesField = top.slice(5);
    const [lastRaw = "", firstRaw = ""] = namesField.split("<<");
    const lastName = lastRaw.replace(/<+/g, " ").trim();
    const nameParts = firstRaw.replace(/<+/g, " ").trim().split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || "";
    const middleName = nameParts.slice(1).join(" ");
    if (lastName) score += 10;
    if (firstName) score += 8;
    const documentCheck = fixMrzDigits(bottomBase[9] || "<");
    const documentField = pickMrzField(bottomBase.slice(0, 9), documentCheck, [
      (s) => s,
      (s) => fixMrzDigits(s),
      (s) => fixMrzAlpha(s)
    ]);
    const documentNumber = documentField.replace(/</g, "");
    const nationalityField = fixMrzAlpha(bottomBase.slice(10, 13));
    const nationality = nationalityField.replace(/</g, "");
    const birth = fixMrzDigits(bottomBase.slice(13, 19));
    const birthCheck = fixMrzDigits(bottomBase[19] || "<");
    const sexRaw = (bottomBase[20] || "<").replace(/[^MF<]/g, "<");
    const expiry = fixMrzDigits(bottomBase.slice(21, 27));
    const expiryCheck = fixMrzDigits(bottomBase[27] || "<");
    const optionalData = bottomBase.slice(28, 42);
    const finalCheck = fixMrzDigits(bottomBase[43] || "<");
    if (documentNumber.length >= 6) score += 10;
    if (/^[A-Z]{3}$/.test(nationality)) score += 6;
    if (mrzValidDate(birth)) score += 18;
    if (mrzValidDate(expiry)) score += 14;
    if (["M", "F", "<"].includes(sexRaw)) score += 4;
    const checks = [
      [documentField, documentCheck],
      [birth, birthCheck],
      [expiry, expiryCheck],
      [documentField + documentCheck + nationalityField + birth + birthCheck + sexRaw + expiry + expiryCheck + optionalData, finalCheck]
    ];
    for (const [value, digit] of checks) {
      if (/^[0-9]$/.test(digit) && mrzChecksum(value) === digit) score += 10;
    }
    if (score < 60) return null;
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
      mrzRaw: [topRaw, bottomRaw]
    };
  }
  function parseMRZLegacy(lines) {
    var _a;
    try {
      const raw = lines.map((l) => l.replace(/[^A-Z0-9<]/g, "").toUpperCase());
      const countDates = (l) => {
        const fixed = fixMrzDigits(l);
        let n = 0;
        for (let i = 0; i <= fixed.length - 6; i++) if (mrzValidDate(fixed.slice(i, i + 6))) n++;
        return n;
      };
      const nameScore = (l) => {
        if (l.length < 10) return -99;
        if (countDates(l) >= 2) return -99;
        const a = (l.match(/[A-Z]/g) || []).length;
        const d = (l.match(/[0-9]/g) || []).length;
        if (a / l.length < 0.6) return -99;
        return a - d * 3 + (l.includes("<<") ? 20 : 0);
      };
      const dataLine = raw.filter((l) => countDates(l) >= 2).sort((a, b) => b.length - a.length)[0] || raw.filter((l) => countDates(l) >= 1).sort((a, b) => b.length - a.length)[0] || "";
      const nameLine = ((_a = raw.filter((l) => l !== dataLine).map((l) => ({ l, s: nameScore(l) })).filter((x) => x.s > -99).sort((a, b) => b.s - a.s)[0]) == null ? void 0 : _a.l) || "";
      let firstName = "", lastName = "", middleName = "", country = "";
      if (nameLine) {
        let sepIdx = nameLine.indexOf("<<"), sepLen = 2;
        if (sepIdx < 0) {
          sepIdx = nameLine.indexOf("<");
          sepLen = 1;
        }
        if (sepIdx >= 0) {
          let lnRaw = nameLine.slice(0, sepIdx);
          lnRaw = lnRaw.replace(/^[A-Z0-9]{1,2}(?=[A-Z]{4,})/, "").replace(/[^A-Z]/g, "");
          lastName = lnRaw;
          const fnRaw = nameLine.slice(sepIdx + sepLen);
          const fnWords = fnRaw.split(/[<0-9]+/).filter((w) => w.length >= 2 && /^[A-Z]+$/.test(w));
          firstName = fnWords[0] || "";
          middleName = fnWords.slice(1, 3).join(" ");
          const cm = nameLine.match(/[A-Z]<([A-Z]{3})/);
          if (cm) country = cm[1];
        }
      }
      let dob = "", exp = "", sex = "U", docNum = "";
      if (dataLine) {
        const dl = fixMrzDigits(dataLine);
        let dobIdx = -1;
        for (let i = 0; i <= dl.length - 6; i++) {
          if (mrzValidDate(dl.slice(i, i + 6))) {
            dobIdx = i;
            break;
          }
        }
        if (dobIdx >= 0) {
          dob = dl.slice(dobIdx, dobIdx + 6);
          const sc = dl[dobIdx + 7] || "";
          sex = sc === "M" ? "M" : sc === "F" ? "F" : "U";
          for (let i = dobIdx + 8; i <= dl.length - 6; i++) {
            if (mrzValidDate(dl.slice(i, i + 6))) {
              exp = dl.slice(i, i + 6);
              break;
            }
          }
          if (dobIdx >= 10) docNum = dl.slice(Math.max(0, dobIdx - 13), dobIdx - 4).replace(/[^A-Z0-9]/g, "");
          if (!country && dl.includes("TUR")) country = "TUR";
        }
      }
      if (!dob && !lastName) return null;
      if (!firstName || firstName.length < 2) return null;
      if (!lastName || lastName.length < 2) return null;
      if (lastName.length > 18 && !lastName.includes(" ")) return null;
      if (firstName.length > 18 && !firstName.includes(" ")) return null;
      if (!nameLine.includes("<<")) return null;
      return {
        firstName,
        middleName,
        lastName,
        nationality: country || "TUR",
        dateOfBirth: mrzDateToIso(dob, true),
        expiryDate: mrzDateToIso(exp, false),
        documentNumber: docNum,
        documentType: "PASSPORT",
        issuingCountry: country || "TUR",
        gender: sex,
        mrzRaw: lines
      };
    } catch (e) {
      console.warn("MRZ legacy parse error:", e);
    }
    return null;
  }
  function parseTurkishIdLoose(lines) {
    try {
      const raw = Array.from(new Set(lines.map((l) => l.replace(/[^A-Z0-9<]/g, "").toUpperCase()).filter(Boolean)));
      if (raw.length < 2) return null;
      const candidates30 = raw.filter((l) => l.length >= 24).map((l) => l.padEnd(30, "<").slice(0, 30));
      const line1 = candidates30.find((l) => l.startsWith("I<TUR") || l.includes("TUR"));
      const line2 = candidates30.find((l) => {
        const datePart = fixMrzDigits(l.slice(0, 15));
        const natPart = l.slice(15, 18).replace(/[0-9]/g, (ch) => MRZ_ALPHA_FIX[ch] || ch).replace(/</g, "");
        return /^\d{6}\d[MFX<]\d{6}\d$/.test(datePart) && /^[A-Z]{2,3}$/.test(natPart);
      });
      const line3 = candidates30.find((l) => l.includes("<<") && /[A-Z<]{10,}/.test(fixMrzAlpha(l)));
      if (!line2 || !line3) return null;
      const fixedLine1 = line1 || "";
      const fixedLine2digits = fixMrzDigits(line2);
      const fixedLine2alpha = fixMrzAlpha(line2);
      const fixedLine3 = fixMrzAlpha(line3);
      const tckn = ((fixMrzDigits(fixedLine1).match(/\d{11}/) || [])[0] || "").trim();
      const birth = fixedLine2digits.slice(0, 6);
      const sexRaw = (line2[7] || "<").replace(/[^MF<]/g, "<");
      const expiry = fixedLine2digits.slice(8, 14);
      const nationality = normalizeCountryCode(fixedLine2alpha.slice(15, 18).replace(/</g, ""));
      const [lastRaw = "", restRaw = ""] = fixedLine3.split("<<");
      const lastName = lastRaw.replace(/<+/g, " ").trim();
      const nameParts = restRaw.replace(/<+/g, " ").trim().split(/\s+/).filter(Boolean);
      const firstName = nameParts[0] || "";
      const middleName = nameParts.slice(1).join(" ");
      if (!tckn || !isValidTurkishIdentityNumber(tckn) || !mrzValidDate(birth) || !lastName || !firstName) return null;
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
        mrzRaw: [fixedLine1, fixedLine2, fixedLine3]
      };
    } catch (e) {
      console.warn("Turkish ID loose parse error:", e);
    }
    return null;
  }
  function countMrzChecks(mrzRaw) {
    try {
      if (!window.SnapPassMrz || !Array.isArray(mrzRaw)) return 0;
      const lines = mrzRaw.map((l) => String(l || "").toUpperCase().replace(/[^A-Z0-9<]/g, "")).filter(Boolean);
      const maxLen = Math.max(0, ...lines.map((l) => l.length));
      const target = [30, 36, 44].find((n) => n >= maxLen) || maxLen;
      const parsed = window.SnapPassMrz.parse(lines.map((l) => l.padEnd(target, "<")).join("\n"));
      return parsed.success ? window.SnapPassMrz.countValidChecks(parsed) : 0;
    } catch (e) {
      return 0;
    }
  }
  function parseMRZSnapPass(lines) {
    try {
      if (!window.SnapPassMrz) return null;
      const parsed = window.SnapPassMrz.parse(lines.join("\n"));
      const checks = parsed.success ? window.SnapPassMrz.countValidChecks(parsed) : 0;
      if (checks < 2) return null;
      const r = window.SnapPassMrz.toMrzResult(parsed);
      if (!r.lastName) return null;
      const tckn = (r.idNumber.match(/\d{11}/) || [])[0] || "";
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
        mrzRaw: parsed.lines
      } };
    } catch (e) {
      console.warn("SnapPass MRZ parse error:", e);
    }
    return null;
  }
  function parseMRZ(lines) {
    const primary = parseMRZPrimary(lines);
    const snap = parseMRZSnapPass(lines);
    if (!snap) return primary;
    const primaryChecks = primary ? countMrzChecks(primary.mrzRaw) : -1;
    if (snap.checks <= primaryChecks) return primary;
    console.log("[MRZ] snappass matched checks=", snap.checks, "primaryChecks=", primaryChecks, snap.result);
    return snap.result;
  }
  function parseMRZPrimary(lines) {
    try {
      const raw = Array.from(new Set(lines.map((l) => l.replace(/[^A-Z0-9<]/g, "").toUpperCase()).filter(Boolean)));
      const hasTurkishSignals = raw.some((l) => l.includes("TUR")) || raw.some((l) => l.startsWith("I<")) || raw.some((l) => /^I[^A-Z]/.test(l)) || raw.some((l) => /\d{11}/.test(l)) || raw.some((l) => l.includes("<<") && l.length >= 24 && l.length <= 34);
      const turkishId = parseTurkishIdLoose(raw);
      if (turkishId) {
        const { score, ...result } = turkishId;
        console.log("[MRZ] turkish-id matched score=", score, result);
        return result;
      }
      if (hasTurkishSignals) {
        let bestTurkish = null;
        for (let i = 0; i <= raw.length - 3; i++) {
          const parsed = parseTD1Triplet(raw[i], raw[i + 1], raw[i + 2]);
          if (parsed && parsed.documentType === "TCKN" && (!bestTurkish || parsed.score > bestTurkish.score)) {
            bestTurkish = parsed;
          }
        }
        if (bestTurkish) {
          const { score, ...result } = bestTurkish;
          console.log("[MRZ] td1-turkish matched score=", score, result);
          return result;
        }
        return null;
      }
      let best = null;
      for (let i = 0; i < raw.length; i++) {
        for (let j = 0; j < raw.length; j++) {
          for (let k = 0; k < raw.length; k++) {
            if (i === j || j === k || i === k) continue;
            const parsed = parseTD1Triplet(raw[i], raw[j], raw[k]);
            if (parsed && (!best || parsed.score > best.score)) best = parsed;
          }
        }
      }
      for (let i = 0; i < raw.length; i++) {
        for (let j = 0; j < raw.length; j++) {
          if (i === j) continue;
          const parsed = parseTD3Pair(raw[i], raw[j]);
          if (parsed && (!best || parsed.score > best.score)) best = parsed;
        }
      }
      if (best) {
        const { score, ...result } = best;
        console.log("[MRZ] td3 matched score=", score, result);
        return result;
      }
      const legacy = parseMRZLegacy(raw);
      if (legacy) {
        if (!hasTurkishSignals) return null;
        if ((legacy.documentType || "").toUpperCase() === "PASSPORT" && raw.some((l) => l.includes("TUR"))) {
          return null;
        }
      }
      return legacy;
    } catch (e) {
      console.warn("MRZ parse error:", e);
    }
    return null;
  }
  function templateMatchMRZ(canvas) {
    if (!window.MRZ_TEMPLATES) return null;
    const templates = window.MRZ_TEMPLATES;
    const AVG_MOD = 0.9;
    const ctx = canvas.getContext("2d");
    if (canvas.width <= 0 || canvas.height <= 0) return null;
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let lumAvg = 0;
    const lum = [];
    for (let y = 0; y < pixels.height; y++) {
      lum[y] = [];
      for (let x = 0; x < pixels.width; x++) {
        const pos = (y * pixels.width + x) * 4;
        lum[y][x] = 0.2126 * pixels.data[pos] + 0.7152 * pixels.data[pos + 1] + 0.0722 * pixels.data[pos + 2];
        lumAvg += lum[y][x];
      }
    }
    lumAvg = lumAvg / (pixels.width * pixels.height) * AVG_MOD;
    const binary = lum.map((row) => row.map((v) => v <= lumAvg ? 0 : 1));
    const height = binary.length;
    const width = binary[0].length;
    const rows = [];
    let lastRow = 1;
    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      for (let x = 0; x < width; x++) rowSum += binary[y][x];
      const isWhite = rowSum / width >= 0.97;
      if (!isWhite) {
        if (lastRow !== 0) rows.push({ start: y, end: y, columns: [] });
        lastRow = 0;
      } else {
        if (lastRow !== 1 && rows.length) rows[rows.length - 1].end = y;
        lastRow = 1;
      }
    }
    if (rows.length < 2) return null;
    const minRowHeight = height * 0.04;
    const validRows = rows.filter((r) => r.end - r.start >= minRowHeight);
    if (validRows.length < 2) return null;
    const mrzRows = validRows.slice(-Math.min(validRows.length, 3));
    for (const row of mrzRows) {
      const sub = binary.slice(row.start, row.end);
      const subH = sub.length;
      if (subH <= 0) continue;
      const subW = sub[0].length;
      let lastCol = 1;
      for (let x = 0; x < subW; x++) {
        let colSum = 0;
        for (let y = 0; y < subH; y++) colSum += sub[y][x];
        const isWhite = colSum / subH >= 0.95;
        if (!isWhite) {
          if (lastCol !== 0) row.columns.push({ start: x, end: x });
          lastCol = 0;
        } else {
          if (lastCol !== 1 && row.columns.length) row.columns[row.columns.length - 1].end = x;
          lastCol = 1;
        }
      }
    }
    function autoCrop(bin) {
      const bpX = {}, bpY = {};
      for (let y = 0; y < bin.length; y++)
        for (let x = 0; x < bin[y].length; x++)
          if (bin[y][x] === 0) {
            bpX[x] = true;
            bpY[y] = true;
          }
      const xs = Object.keys(bpX).map(Number).sort((a, b) => a - b);
      const ys = Object.keys(bpY).map(Number).sort((a, b) => a - b);
      if (!xs.length || !ys.length) return null;
      const nx = xs[0], ny = ys[0];
      const nw = xs[xs.length - 1] - nx;
      const nh = ys[ys.length - 1] - ny;
      if (nw <= 0 || nh <= 0) return null;
      const nb = [];
      for (let y = 0; y < nh; y++) {
        nb[y] = [];
        for (let x = 0; x < nw; x++) nb[y][x] = bin[y + ny][x + nx];
      }
      return nb;
    }
    function matchChar(charBin) {
      let best = "", bestAff = -(charBin[0].length * charBin.length);
      const ch = charBin[0].length, cH = charBin.length;
      for (const key in templates) {
        const tpl = templates[key];
        const tW = tpl[0].length, tH = tpl.length;
        let aff = 0;
        for (let y = 0; y < cH; y++) {
          const ty = Math.floor(y * tH / cH);
          for (let x = 0; x < ch; x++) {
            const tx = Math.floor(x * tW / ch);
            aff += charBin[y][x] === tpl[ty][tx] ? 1 : -1;
          }
        }
        if (aff > bestAff) {
          bestAff = aff;
          best = key;
        }
      }
      return best;
    }
    function fixChevrons(line) {
      line = line.replace(/[CL<]{2,}/g, (m) => "<".repeat(m.length));
      line = line.replace(/[CL]+$/, (m) => "<".repeat(m.length));
      line = line.replace(/(\d)C(\d)/g, "$1<$2");
      line = line.replace(/(\d)L(\d)/g, "$1<$2");
      line = line.replace(/^(I)[CL]/, "$1<");
      return line;
    }
    const mrzLines = [];
    for (const row of mrzRows) {
      let line = "";
      const cols = row.columns;
      if (!cols.length) continue;
      const widths = cols.map((c) => c.end - c.start).filter((w) => w > 1);
      const avgCharW = widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : 10;
      for (let ci = 0; ci < cols.length; ci++) {
        const col = cols[ci];
        const charH = row.end - row.start;
        const charW = col.end - col.start;
        if (ci > 0) {
          const gap = col.start - cols[ci - 1].end;
          if (gap > avgCharW * 0.6) {
            const chevronCount = Math.round(gap / avgCharW);
            line += "<".repeat(chevronCount);
          }
        }
        if (charW <= 1 || charH <= 1) continue;
        if (charW < avgCharW * 0.55) {
          line += "<";
          continue;
        }
        const charBin = [];
        for (let y = 0; y < charH; y++) {
          charBin[y] = [];
          for (let x = 0; x < charW; x++) {
            charBin[y][x] = binary[row.start + y][col.start + x];
          }
        }
        const cropped = autoCrop(charBin);
        if (!cropped) continue;
        const ch = matchChar(cropped);
        if (ch) line += ch;
      }
      if (line.length >= 18 && line.length < 30) line = line.padEnd(30, "<");
      line = fixChevrons(line);
      if (line.length >= 18) mrzLines.push(line);
    }
    console.log(`[MRZ-TPL] rows=${mrzRows.length} cols=[${mrzRows.map((r) => r.columns.length).join(",")}] avgCharW=${mrzRows.length ? Math.round(mrzRows[0].columns.reduce((a, c) => a + (c.end - c.start), 0) / Math.max(1, mrzRows[0].columns.length)) : 0}`);
    console.log("[MRZ-TPL] lines (raw\u2192fixed):", mrzLines);
    if (mrzLines.length < 2) return null;
    return mrzLines;
  }
  function orderQuadPoints(points) {
    if (!Array.isArray(points) || points.length !== 4) return null;
    const withMeta = points.map((p) => ({
      x: Number(p.x || 0),
      y: Number(p.y || 0),
      sum: Number(p.x || 0) + Number(p.y || 0),
      diff: Number(p.x || 0) - Number(p.y || 0)
    }));
    const tl = withMeta.reduce((best, p) => p.sum < best.sum ? p : best, withMeta[0]);
    const br = withMeta.reduce((best, p) => p.sum > best.sum ? p : best, withMeta[0]);
    const tr = withMeta.reduce((best, p) => p.diff > best.diff ? p : best, withMeta[0]);
    const bl = withMeta.reduce((best, p) => p.diff < best.diff ? p : best, withMeta[0]);
    return [tl, tr, br, bl];
  }
  function detectPerspectiveCorrectedCanvas(source) {
    const cv = window.cv;
    if (!cv || typeof cv.imread !== "function" || !source) return null;
    const sw = source.videoWidth || source.width || 0;
    const sh = source.videoHeight || source.height || 0;
    if (sw < 320 || sh < 240) return null;
    const workCanvas = document.createElement("canvas");
    const maxWorkW = 1280;
    const scale = Math.min(1, maxWorkW / sw);
    workCanvas.width = Math.max(320, Math.round(sw * scale));
    workCanvas.height = Math.max(180, Math.round(sh * scale));
    workCanvas.getContext("2d", { willReadFrequently: true }).drawImage(source, 0, 0, workCanvas.width, workCanvas.height);
    let src = null, gray = null, blur = null, edge = null, kernel = null, contours = null, hierarchy = null;
    try {
      src = cv.imread(workCanvas);
      gray = new cv.Mat();
      blur = new cv.Mat();
      edge = new cv.Mat();
      kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
      cv.Canny(blur, edge, 60, 180, 3, false);
      cv.dilate(edge, edge, kernel);
      cv.findContours(edge, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      let best = null;
      const frameArea = src.cols * src.rows;
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const peri = cv.arcLength(cnt, true);
        const approx = new cv.Mat();
        try {
          cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
          if (approx.rows !== 4) continue;
          const area = Math.abs(cv.contourArea(approx));
          if (area < frameArea * 0.06) continue;
          const pts = [];
          for (let j = 0; j < 4; j++) {
            pts.push({
              x: approx.data32S[j * 2],
              y: approx.data32S[j * 2 + 1]
            });
          }
          const ordered = orderQuadPoints(pts);
          if (!ordered) continue;
          const widthA = Math.hypot(ordered[2].x - ordered[3].x, ordered[2].y - ordered[3].y);
          const widthB = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
          const heightA = Math.hypot(ordered[1].x - ordered[2].x, ordered[1].y - ordered[2].y);
          const heightB = Math.hypot(ordered[0].x - ordered[3].x, ordered[0].y - ordered[3].y);
          const maxWidth = Math.max(widthA, widthB);
          const maxHeight = Math.max(heightA, heightB);
          if (maxWidth < 220 || maxHeight < 120) continue;
          const ratio = maxWidth / Math.max(1, maxHeight);
          if (ratio < 0.95 || ratio > 2.15) continue;
          const score = area * (ratio >= 1.32 && ratio <= 1.7 ? 1.15 : 1);
          if (!best || score > best.score) {
            best = { ordered, maxWidth: Math.round(maxWidth), maxHeight: Math.round(maxHeight), score };
          }
        } finally {
          approx.delete();
          cnt.delete();
        }
      }
      if (!best) return null;
      const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        best.ordered[0].x,
        best.ordered[0].y,
        best.ordered[1].x,
        best.ordered[1].y,
        best.ordered[2].x,
        best.ordered[2].y,
        best.ordered[3].x,
        best.ordered[3].y
      ]);
      const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0,
        0,
        best.maxWidth - 1,
        0,
        best.maxWidth - 1,
        best.maxHeight - 1,
        0,
        best.maxHeight - 1
      ]);
      const transform = cv.getPerspectiveTransform(srcTri, dstTri);
      const dst = new cv.Mat();
      try {
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
      } finally {
        srcTri.delete();
        dstTri.delete();
        transform.delete();
        dst.delete();
      }
    } catch (err) {
      console.warn("[MRZ] perspective correction failed:", err);
      return null;
    } finally {
      if (src) src.delete();
      if (gray) gray.delete();
      if (blur) blur.delete();
      if (edge) edge.delete();
      if (kernel) kernel.delete();
      if (contours) contours.delete();
      if (hierarchy) hierarchy.delete();
    }
  }
  function buildMrzCanvases(source, scratchCanvas) {
    const vw = source.videoWidth || source.width;
    const vh = source.videoHeight || source.height;
    const rois = [
      // Bu kaynak artık zaten MRZ bandına crop edilmiş durumda.
      { label: "MRZ-band", sx: 0, sy: 0, sw: 1, sh: 1 },
      { label: "MRZ-band-ust", sx: 0, sy: 0, sw: 1, sh: 0.88 },
      { label: "MRZ-band-alt", sx: 0, sy: 0.12, sw: 1, sh: 0.88 }
    ];
    const variants = [];
    const scratchCtx = scratchCanvas.getContext("2d", { willReadFrequently: true });
    const toLineCanvases = (sourceCanvas) => {
      const lineCanvases = [];
      const srcW = sourceCanvas.width;
      const srcH = sourceCanvas.height;
      const lineH = srcH / 3;
      const overlap = Math.max(10, Math.round(lineH * 0.14));
      for (let idx = 0; idx < 3; idx++) {
        const sy = Math.max(0, Math.round(idx * lineH - overlap));
        const ey = Math.min(srcH, Math.round((idx + 1) * lineH + overlap));
        const sh = Math.max(4, ey - sy);
        if (srcW < 10 || sh < 4) continue;
        const lineCanvas = document.createElement("canvas");
        lineCanvas.width = Math.max(900, srcW);
        lineCanvas.height = Math.max(60, Math.round(sh / srcW * lineCanvas.width * 1.2));
        lineCanvas.getContext("2d", { willReadFrequently: true }).drawImage(
          sourceCanvas,
          0,
          sy,
          srcW,
          sh,
          0,
          0,
          lineCanvas.width,
          lineCanvas.height
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
        sh: Math.round(vh * roiDef.sh)
      };
      scratchCanvas.width = roi.sw;
      scratchCanvas.height = roi.sh;
      scratchCtx.clearRect(0, 0, roi.sw, roi.sh);
      scratchCtx.drawImage(source, roi.sx, roi.sy, roi.sw, roi.sh, 0, 0, roi.sw, roi.sh);
      const lighting = analyzeCanvasLighting(scratchCanvas);
      const targetW = Math.max(1200, Math.round(roi.sw * 1.5));
      const targetH = Math.round(roi.sh / roi.sw * targetW);
      const makeCanvas = () => {
        const c = document.createElement("canvas");
        c.width = targetW;
        c.height = targetH;
        return c;
      };
      const baseCanvas = makeCanvas();
      const baseCtx = baseCanvas.getContext("2d", { willReadFrequently: true });
      if ("filter" in baseCtx) baseCtx.filter = "grayscale(1)";
      baseCtx.drawImage(scratchCanvas, 0, 0, targetW, targetH);
      if ("filter" in baseCtx) baseCtx.filter = "none";
      const highContrastCanvas = makeCanvas();
      const hcCtx = highContrastCanvas.getContext("2d", { willReadFrequently: true });
      if ("filter" in hcCtx) hcCtx.filter = "grayscale(1) contrast(3.0) brightness(1.2)";
      hcCtx.drawImage(scratchCanvas, 0, 0, targetW, targetH);
      if ("filter" in hcCtx) hcCtx.filter = "none";
      const adaptiveCanvas = makeCanvas();
      const adaptiveCtx = adaptiveCanvas.getContext("2d", { willReadFrequently: true });
      if ("filter" in adaptiveCtx) adaptiveCtx.filter = getAdaptiveMrzFilter(lighting);
      adaptiveCtx.drawImage(scratchCanvas, 0, 0, targetW, targetH);
      if ("filter" in adaptiveCtx) adaptiveCtx.filter = "none";
      const binaryCanvas = makeCanvas();
      const binCtx = binaryCanvas.getContext("2d", { willReadFrequently: true });
      binCtx.drawImage(baseCanvas, 0, 0);
      const img = binCtx.getImageData(0, 0, targetW, targetH);
      const d = img.data;
      const hist = new Array(256).fill(0);
      for (let i = 0; i < d.length; i += 4) {
        hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++;
      }
      const total = d.length / 4;
      let sum = 0;
      for (let t2 = 0; t2 < 256; t2++) sum += t2 * hist[t2];
      let sumB = 0, wB = 0, maxVar = 0, threshold = 128;
      for (let t2 = 0; t2 < 256; t2++) {
        wB += hist[t2];
        if (!wB) continue;
        const wF = total - wB;
        if (!wF) break;
        sumB += t2 * hist[t2];
        const mB = sumB / wB, mF = (sum - sumB) / wF;
        const v = wB * wF * (mB - mF) * (mB - mF);
        if (v > maxVar) {
          maxVar = v;
          threshold = t2;
        }
      }
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = d[i + 1] = d[i + 2] = g > threshold ? 255 : 0;
      }
      binCtx.putImageData(img, 0, 0);
      const adaptiveLines = toLineCanvases(adaptiveCanvas);
      if (adaptiveLines.length >= 3) variants.push({ label: `${roiDef.label}-adaptif-satir-wl`, canvases: adaptiveLines, psm: "7", useWhitelist: true });
      variants.push({ label: `${roiDef.label}-adaptif-blok-wl`, canvas: adaptiveCanvas, psm: "6", useWhitelist: true });
      const hcLines = toLineCanvases(highContrastCanvas);
      if (hcLines.length >= 3) variants.push({ label: `${roiDef.label}-satir-wl`, canvases: hcLines, psm: "7", useWhitelist: true });
      const gLines = toLineCanvases(baseCanvas);
      if (gLines.length >= 3) variants.push({ label: `${roiDef.label}-satir-free`, canvases: gLines, psm: "7", useWhitelist: false });
      variants.push({ label: `${roiDef.label}-blok-wl`, canvas: highContrastCanvas, psm: "6", useWhitelist: true });
      if (roiDef.label === "MRZ-band") {
        const bwLines = toLineCanvases(binaryCanvas);
        if (bwLines.length >= 3) variants.push({ label: `${roiDef.label}-satir-bw-wl`, canvases: bwLines, psm: "7", useWhitelist: true });
      }
    };
    rois.forEach(buildVariantPair);
    return variants;
  }
  function getFastMrzCanvases(source, scratchCanvas) {
    const all = buildMrzCanvases(source, scratchCanvas);
    const preferred = [
      "MRZ-band-adaptif-satir-wl",
      "MRZ-band-adaptif-blok-wl",
      "MRZ-band-satir-wl",
      "MRZ-band-blok-wl",
      "MRZ-band-alt-satir-wl"
    ];
    const picked = preferred.map((label) => all.find((v) => v.label === label)).filter(Boolean);
    return picked.length ? picked : all.slice(0, 2);
  }
  function analyzeCanvasLighting(canvas) {
    const sample = document.createElement("canvas");
    sample.width = 160;
    sample.height = Math.max(48, Math.round(canvas.height / Math.max(1, canvas.width) * sample.width));
    const ctx = sample.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, sample.width, sample.height);
    const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
    let sum = 0;
    let sumSq = 0;
    let brightPixels = 0;
    let darkPixels = 0;
    const total = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += g;
      sumSq += g * g;
      if (g >= 235) brightPixels++;
      if (g <= 40) darkPixels++;
    }
    const mean = sum / Math.max(1, total);
    const variance = Math.max(0, sumSq / Math.max(1, total) - mean * mean);
    return {
      mean,
      deviation: Math.sqrt(variance),
      brightRatio: brightPixels / Math.max(1, total),
      darkRatio: darkPixels / Math.max(1, total)
    };
  }
  function getAdaptiveMrzFilter(lighting) {
    if (!lighting) return "grayscale(1) contrast(3.0) brightness(1.15)";
    if (lighting.brightRatio > 0.16 || lighting.mean > 185) {
      return "grayscale(1) contrast(4.6) brightness(0.68)";
    }
    if (lighting.darkRatio > 0.2 || lighting.mean < 95) {
      return "grayscale(1) contrast(3.35) brightness(1.52)";
    }
    if (lighting.deviation < 36) {
      return "grayscale(1) contrast(3.8) brightness(1.14)";
    }
    return "grayscale(1) contrast(3.0) brightness(1.15)";
  }
  function buildDirectMrzLineCanvases(sourceCanvas) {
    const lighting = analyzeCanvasLighting(sourceCanvas);
    const renderVariant = (filterText) => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1500, sourceCanvas.width);
      canvas.height = Math.max(260, Math.round(sourceCanvas.height / Math.max(1, sourceCanvas.width) * canvas.width));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if ("filter" in ctx) ctx.filter = filterText;
      ctx.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
      if ("filter" in ctx) ctx.filter = "none";
      return canvas;
    };
    const work = renderVariant(getAdaptiveMrzFilter(lighting));
    const glareReduced = renderVariant("grayscale(1) contrast(4.8) brightness(0.66)");
    const lowLightBoost = renderVariant("grayscale(1) contrast(3.35) brightness(1.52)");
    const binary = document.createElement("canvas");
    binary.width = work.width;
    binary.height = work.height;
    const binCtx = binary.getContext("2d", { willReadFrequently: true });
    binCtx.drawImage(work, 0, 0);
    const img = binCtx.getImageData(0, 0, binary.width, binary.height);
    const d = img.data;
    const threshold = lighting.mean > 175 ? 150 : lighting.mean < 95 ? 92 : 120;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = g > threshold ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    binCtx.putImageData(img, 0, 0);
    const splitLines = (canvas) => {
      const lines = [];
      const lineH = canvas.height / 3;
      const overlap = Math.max(12, Math.round(lineH * 0.18));
      for (let idx = 0; idx < 3; idx++) {
        const sy = Math.max(0, Math.round(idx * lineH - overlap));
        const ey = Math.min(canvas.height, Math.round((idx + 1) * lineH + overlap));
        const sh = Math.max(8, ey - sy);
        const lineCanvas = document.createElement("canvas");
        lineCanvas.width = canvas.width;
        lineCanvas.height = Math.max(72, Math.round(sh / Math.max(1, canvas.width) * lineCanvas.width * 1.16));
        lineCanvas.getContext("2d", { willReadFrequently: true }).drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, lineCanvas.width, lineCanvas.height);
        lines.push(lineCanvas);
      }
      return lines;
    };
    return {
      lighting,
      adaptiveLines: splitLines(work),
      glareReducedLines: splitLines(glareReduced),
      lowLightLines: splitLines(lowLightBoost),
      binaryLines: splitLines(binary)
    };
  }
  const IS_ANDROID_DEVICE = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || "");
  const IS_MOBILE_DEVICE = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  const IS_DESKTOP_WEBCAM = !IS_MOBILE_DEVICE;
  const MRZ_SOURCE_BOX = IS_ANDROID_DEVICE ? {
    sx: 8e-3,
    sy: 0.46,
    sw: 0.984,
    sh: 0.4
  } : IS_DESKTOP_WEBCAM ? {
    sx: 8e-3,
    sy: 0.47,
    sw: 0.984,
    sh: 0.4
  } : {
    sx: 0.01,
    sy: 0.52,
    sw: 0.98,
    sh: 0.34
  };
  const USE_LOCAL_OCR_AGENT = false;
  const OCR_AGENT_URL = "http://127.0.0.1:5102";
  let ocrAgentState = null;
  async function ocrAgentAvailable(force) {
    if (!USE_LOCAL_OCR_AGENT) return false;
    if (ocrAgentState !== null && !force) return ocrAgentState;
    try {
      const res = await fetch(`${OCR_AGENT_URL}/health`, { signal: AbortSignal.timeout(800) });
      ocrAgentState = res.ok;
    } catch (_) {
      ocrAgentState = false;
    }
    return ocrAgentState;
  }
  const CARD_GUIDE_RATIO = 1.5;
  function computeCardGuide(stageW, stageH) {
    const w = Math.min(stageW * 0.92, stageH * 0.86 * CARD_GUIDE_RATIO);
    const h = w / CARD_GUIDE_RATIO;
    return { left: (stageW - w) / 2, top: (stageH - h) / 2, width: w, height: h };
  }
  const CARD_MRZ_BOX = { sx: 0.02, sy: 0.52, sw: 0.96, sh: 0.47 };
  function cropVideoToGuide(video, stageEl, margin = 0.06) {
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
  function adaptiveThresholdCanvas(source, scale = 1, k = 0.12) {
    const W = Math.max(1, Math.round(source.width * scale));
    const H = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const gray = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) gray[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
    const I = new Float64Array((W + 1) * (H + 1));
    for (let y = 1; y <= H; y++) {
      let row = 0;
      for (let x = 1; x <= W; x++) {
        row += gray[(y - 1) * W + x - 1];
        I[y * (W + 1) + x] = I[(y - 1) * (W + 1) + x] + row;
      }
    }
    const r = Math.max(4, Math.round(W * 0.03));
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
        const sum = I[(y1 + 1) * (W + 1) + x1 + 1] - I[y0 * (W + 1) + x1 + 1] - I[(y1 + 1) * (W + 1) + x0] + I[y0 * (W + 1) + x0];
        const v = gray[y * W + x] < sum / ((x1 - x0 + 1) * (y1 - y0 + 1)) * (1 - k) ? 0 : 255;
        const i = (y * W + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function captureVideoFrameToCanvas(video) {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  function cropBottomCanvas(source, ratio) {
    const w = source.videoWidth || source.width;
    const h = source.videoHeight || source.height;
    const top = Math.floor(h * (1 - ratio));
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h - top;
    out.getContext("2d").drawImage(source, 0, top, w, h - top, 0, 0, w, h - top);
    return out;
  }
  function scoreMrzFrameQuality(source) {
    const bandCanvas = extractMrzBandCanvas(source);
    const sw = bandCanvas.width;
    const sh = bandCanvas.height;
    if (!sw || !sh) return 0;
    const lighting = analyzeCanvasLighting(bandCanvas);
    const probe = document.createElement("canvas");
    probe.width = 320;
    probe.height = Math.max(100, Math.round(sh / Math.max(1, sw) * probe.width));
    const ctx = probe.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bandCanvas, 0, 0, sw, sh, 0, 0, probe.width, probe.height);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let edgeScore = 0;
    let contrastSum = 0;
    const rowStride = probe.width * 4;
    for (let y = 1; y < probe.height; y++) {
      for (let x = 1; x < probe.width; x++) {
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
    const clipPenalty = ((lighting == null ? void 0 : lighting.brightRatio) || 0) * 34 + ((lighting == null ? void 0 : lighting.darkRatio) || 0) * 18;
    const balanceBonus = Math.min(14, ((lighting == null ? void 0 : lighting.deviation) || 0) * 0.16);
    return edgeScore / pxCount + Math.abs(mean - 127) * 0.08 + balanceBonus - clipPenalty;
  }
  function tightenMrzContentCanvas(sourceCanvas) {
    const width = sourceCanvas.width;
    const height = sourceCanvas.height;
    if (!width || !height) return sourceCanvas;
    const lighting = analyzeCanvasLighting(sourceCanvas);
    const probe = document.createElement("canvas");
    probe.width = Math.min(720, width);
    probe.height = Math.max(120, Math.round(height / Math.max(1, width) * probe.width));
    const probeCtx = probe.getContext("2d", { willReadFrequently: true });
    probeCtx.drawImage(sourceCanvas, 0, 0, probe.width, probe.height);
    const img = probeCtx.getImageData(0, 0, probe.width, probe.height);
    const data = img.data;
    const darkThreshold = Math.max(68, Math.min(160, Math.round((lighting.mean || 120) - 24)));
    const rowHits = new Array(probe.height).fill(0);
    for (let y = 0; y < probe.height; y++) {
      for (let x = 0; x < probe.width; x++) {
        const idx = (y * probe.width + x) * 4;
        const g = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        if (g <= darkThreshold) {
          rowHits[y]++;
        }
      }
    }
    const minRowHits = Math.max(4, Math.round(probe.width * 0.015));
    const maxRowGap = Math.max(8, Math.round(probe.height * 0.04));
    const rowBands = [];
    let activeStart = -1;
    for (let y = 0; y < probe.height; y++) {
      if (rowHits[y] >= minRowHits) {
        if (activeStart < 0) activeStart = y;
      } else if (activeStart >= 0) {
        rowBands.push({ start: activeStart, end: y - 1 });
        activeStart = -1;
      }
    }
    if (activeStart >= 0) rowBands.push({ start: activeStart, end: probe.height - 1 });
    if (!rowBands.length) return sourceCanvas;
    const mergedBands = [];
    for (const band of rowBands) {
      const prev = mergedBands[mergedBands.length - 1];
      if (prev && band.start - prev.end <= maxRowGap) {
        prev.end = band.end;
      } else {
        mergedBands.push({ ...band });
      }
    }
    let bestBand = null;
    for (const band of mergedBands) {
      const bandHeight = band.end - band.start + 1;
      if (bandHeight < Math.max(10, Math.round(probe.height * 0.1))) continue;
      let sumHits = 0;
      let peakHits = 0;
      for (let y = band.start; y <= band.end; y++) {
        sumHits += rowHits[y];
        if (rowHits[y] > peakHits) peakHits = rowHits[y];
      }
      const center = (band.start + band.end) / 2;
      const upperBias = 1 - Math.min(0.75, center / Math.max(1, probe.height));
      const score = sumHits * 1.2 + peakHits * 2.4 + bandHeight * probe.width * 0.08 + upperBias * probe.width * 18;
      if (!bestBand || score > bestBand.score) {
        bestBand = { start: band.start, end: band.end, score };
      }
    }
    if (!bestBand) return sourceCanvas;
    let top = bestBand.start;
    let bottom = bestBand.end;
    const colHits = new Array(probe.width).fill(0);
    for (let y = top; y <= bottom; y++) {
      for (let x = 0; x < probe.width; x++) {
        const idx = (y * probe.width + x) * 4;
        const g = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        if (g <= darkThreshold) colHits[x]++;
      }
    }
    const minColHits = Math.max(3, Math.round((bottom - top + 1) * 0.12));
    let left = colHits.findIndex((v) => v >= minColHits);
    let right = -1;
    for (let i = probe.width - 1; i >= 0; i--) {
      if (colHits[i] >= minColHits) {
        right = i;
        break;
      }
    }
    if (top < 0 || left < 0 || bottom <= top || right <= left) return sourceCanvas;
    const bboxW = right - left + 1;
    const bboxH = bottom - top + 1;
    if (bboxW < probe.width * 0.28 || bboxH < probe.height * 0.1) return sourceCanvas;
    const expandX = Math.round(bboxW * 0.08);
    const expandTop = Math.round(bboxH * 0.24);
    const expandBottom = Math.round(bboxH * 0.14);
    left = Math.max(0, left - expandX);
    right = Math.min(probe.width - 1, right + expandX);
    top = Math.max(0, top - expandTop);
    bottom = Math.min(probe.height - 1, bottom + expandBottom);
    const sx = Math.round(left / probe.width * width);
    const sy = Math.round(top / probe.height * height);
    const sw = Math.max(1, Math.round((right - left + 1) / probe.width * width));
    const sh = Math.max(1, Math.round((bottom - top + 1) / probe.height * height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1600, sw);
    canvas.height = Math.max(260, Math.round(sh / Math.max(1, sw) * canvas.width));
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(
      sourceCanvas,
      sx,
      sy,
      sw,
      sh,
      0,
      0,
      canvas.width,
      canvas.height
    );
    return canvas;
  }
  function extractMrzBandCanvas(source) {
    const { tightCanvas } = extractMrzBandDebugCanvases(source);
    return tightCanvas;
  }
  function extractMrzBandDebugCanvases(source) {
    const box = source.isCardCrop ? CARD_MRZ_BOX : MRZ_SOURCE_BOX;
    const sw = source.videoWidth || source.width;
    const sh = source.videoHeight || source.height;
    const sx = Math.round(sw * box.sx);
    const sy = Math.round(sh * box.sy);
    const rw = Math.round(sw * box.sw);
    const rh = Math.round(sh * box.sh);
    const rawCanvas = document.createElement("canvas");
    rawCanvas.width = Math.max(1400, rw);
    rawCanvas.height = Math.max(220, Math.round(rh / Math.max(1, rw) * rawCanvas.width));
    rawCanvas.getContext("2d", { willReadFrequently: true }).drawImage(
      source,
      sx,
      sy,
      rw,
      rh,
      0,
      0,
      rawCanvas.width,
      rawCanvas.height
    );
    return {
      rawCanvas,
      tightCanvas: tightenMrzContentCanvas(rawCanvas)
    };
  }
  function getSafeErrorMessage(err) {
    if (!err) return t("Bilinmeyen hata");
    if (typeof err === "string") return err;
    if (typeof (err == null ? void 0 : err.message) === "string" && err.message.trim()) return err.message;
    if (typeof (err == null ? void 0 : err.toString) === "function") {
      const text = String(err);
      if (text && text !== "[object Object]") return text;
    }
    return t("Bilinmeyen hata");
  }
  async function safeTerminateWorker(worker) {
    if (!worker || typeof worker.terminate !== "function") return;
    try {
      await worker.terminate();
    } catch (termErr) {
      console.warn("[MRZ] worker terminate warning:", termErr);
    }
  }
  function CameraScan({ guest, session, onDone, onBack, onLogout }) {
    const vidRef = useRef(null), canRef = useRef(null), strRef = useRef(null), workerRef = useRef(null), scanRef = useRef(false);
    const debugSessionIdRef = useRef(`mrz_${Date.now()}`);
    const pendingDebugRef = useRef([]);
    const pendingImageWritesRef = useRef([]);
    const debugFlushTimerRef = useRef(null);
    const [phase, setPhase] = useState("ready"), [pct, setPct] = useState(0), [camOk, setCamOk] = useState(true);
    const [status, setStatus] = useState(t("Taramak i\xE7in dokun"));
    const [tLoaded, setTLoaded] = useState(false);
    const [ocrPreview, setOcrPreview] = useState("");
    const [debugLogs, setDebugLogs] = useState([]);
    const [scanStageHeight, setScanStageHeight] = useState(() => getScanViewportHeight());
    const insecureCameraContext = !window.isSecureContext;
    const stageRef = useRef(null);
    const [guide, setGuide] = useState(null);
    useEffect(() => {
      ocrAgentAvailable();
    }, []);
    const [torch, setTorch] = useState({ supported: false, on: false });
    const toggleTorch = async () => {
      var _a, _b;
      const track = (_b = (_a = strRef.current) == null ? void 0 : _a.getVideoTracks) == null ? void 0 : _b.call(_a)[0];
      if (!track) return;
      try {
        await track.applyConstraints({ advanced: [{ torch: !torch.on }] });
        setTorch((t2) => ({ ...t2, on: !t2.on }));
      } catch (err) {
        console.warn("[MRZ] torch:", err);
      }
    };
    useEffect(() => {
      const el = stageRef.current;
      if (!el) return;
      const update = () => setGuide(computeCardGuide(el.clientWidth, el.clientHeight));
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);
    const pushDebug = (stage, message, meta) => {
      const line = `${(/* @__PURE__ */ new Date()).toLocaleTimeString("tr-TR", { hour12: false })} [${stage}] ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}`;
      setDebugLogs((prev) => [...prev.slice(-39), line]);
      pendingDebugRef.current.push(line);
      if (debugFlushTimerRef.current) clearTimeout(debugFlushTimerRef.current);
      debugFlushTimerRef.current = setTimeout(async () => {
        const lines = pendingDebugRef.current.splice(0, pendingDebugRef.current.length);
        debugFlushTimerRef.current = null;
        if (lines.length) {
          await writeDebugLogFile({
            sessionId: debugSessionIdRef.current,
            guest: {
              firstName: (guest == null ? void 0 : guest.firstName) || "",
              lastName: (guest == null ? void 0 : guest.lastName) || "",
              confirmationNo: (guest == null ? void 0 : guest.confirmationNo) || ""
            },
            lines
          });
        }
      }, 250);
    };
    const flushDebugToFile = async () => {
      if (debugFlushTimerRef.current) {
        clearTimeout(debugFlushTimerRef.current);
        debugFlushTimerRef.current = null;
      }
      const lines = pendingDebugRef.current.splice(0, pendingDebugRef.current.length);
      if (!lines.length) return;
      await writeDebugLogFile({
        sessionId: debugSessionIdRef.current,
        guest: {
          firstName: (guest == null ? void 0 : guest.firstName) || "",
          lastName: (guest == null ? void 0 : guest.lastName) || "",
          confirmationNo: (guest == null ? void 0 : guest.confirmationNo) || ""
        },
        lines
      });
    };
    const queueDebugImageFile = (label, canvas) => {
      if (!label || !canvas) return;
      const writePromise = writeDebugImageFile({
        sessionId: debugSessionIdRef.current,
        label,
        canvas
      }).finally(() => {
        pendingImageWritesRef.current = pendingImageWritesRef.current.filter((item) => item !== writePromise);
      });
      pendingImageWritesRef.current.push(writePromise);
    };
    const flushDebugArtifacts = async () => {
      await flushDebugToFile();
      if (!pendingImageWritesRef.current.length) return;
      const writes = pendingImageWritesRef.current.slice();
      pendingImageWritesRef.current = [];
      await Promise.allSettled(writes);
    };
    const [cvLoaded, setCvLoaded] = useState(false);
    useEffect(() => {
      let loaded = 0;
      const check = () => {
        loaded++;
        if (loaded === 2) setTLoaded(true);
      };
      const s = document.createElement("script");
      s.src = "/tesseract.min.js";
      s.onload = check;
      document.head.appendChild(s);
      const o = document.createElement("script");
      o.src = "/opencv.js";
      o.onload = () => {
        setCvLoaded(true);
        check();
      };
      document.head.appendChild(o);
      return () => {
        var _a;
        if (debugFlushTimerRef.current) clearTimeout(debugFlushTimerRef.current);
        pendingImageWritesRef.current = [];
        safeTerminateWorker(workerRef.current);
        workerRef.current = null;
        (_a = strRef.current) == null ? void 0 : _a.getTracks().forEach((t2) => t2.stop());
      };
    }, []);
    useEffect(() => {
      (async () => {
        var _a, _b;
        try {
          const s = await openPreferredCameraStream();
          strRef.current = s;
          const track = (_a = s.getVideoTracks) == null ? void 0 : _a.call(s)[0];
          if (track) await optimizeVideoTrack(track);
          try {
            if ((_b = track == null ? void 0 : track.getCapabilities) == null ? void 0 : _b.call(track).torch) setTorch({ supported: true, on: false });
          } catch (_) {
          }
          if (vidRef.current) vidRef.current.srcObject = s;
        } catch {
          setCamOk(false);
        }
      })();
    }, []);
    useEffect(() => {
      const updateStage = () => setScanStageHeight(getScanViewportHeight());
      window.addEventListener("resize", updateStage);
      window.addEventListener("orientationchange", updateStage);
      return () => {
        window.removeEventListener("resize", updateStage);
        window.removeEventListener("orientationchange", updateStage);
      };
    }, []);
    const resetScanState = () => {
      debugSessionIdRef.current = `mrz_${Date.now()}`;
      pendingDebugRef.current = [];
      pendingImageWritesRef.current = [];
      if (debugFlushTimerRef.current) clearTimeout(debugFlushTimerRef.current);
      debugFlushTimerRef.current = null;
      scanRef.current = false;
      safeTerminateWorker(workerRef.current);
      workerRef.current = null;
      setPhase("ready");
      setPct(0);
      setStatus(t("Taramak i\xE7in dokun"));
      setOcrPreview("");
      setDebugLogs([]);
    };
    const finalizeParsed = async (parsed, worker, successText) => {
      pushDebug("success", "MRZ parse tamamlandi", {
        documentType: (parsed == null ? void 0 : parsed.documentType) || "",
        documentNumber: (parsed == null ? void 0 : parsed.documentNumber) || "",
        firstName: (parsed == null ? void 0 : parsed.firstName) || "",
        lastName: (parsed == null ? void 0 : parsed.lastName) || ""
      });
      await flushDebugArtifacts();
      setPct(100);
      setPhase("done");
      setStatus(successText);
      scanRef.current = false;
      await safeTerminateWorker(worker);
      workerRef.current = null;
      setTimeout(() => {
        var _a;
        try {
          (_a = strRef.current) == null ? void 0 : _a.getTracks().forEach((t2) => t2.stop());
          onDone({ ...EMPTY_SCAN, ...parsed });
        } catch (doneErr) {
          console.error("[MRZ] onDone", doneErr);
          setPhase("failed");
          setStatus(t("Hata: {mesaj}", { mesaj: getSafeErrorMessage(doneErr) }));
        }
      }, 800);
      return true;
    };
    const createOcrWorker = async () => {
      const worker = await Tesseract.createWorker({
        workerPath: "/tess-worker.js",
        corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@4.0.4/tesseract-core.wasm.js",
        langPath: "/tessdata",
        logger: (m) => {
          if (m.status === "loading tesseract core") setPct(8);
          if (m.status === "initializing tesseract") setPct(12);
          if (m.status === "loading language traineddata") setPct(15);
          if (m.status === "initialized tesseract") setPct(18);
          if (m.status === "recognizing text") setPct(20 + Math.round(m.progress * 60));
        }
      });
      let activeLang = "";
      for (const lang of ["mrzsp", "mrz", "eng"]) {
        try {
          await worker.loadLanguage(lang);
          await worker.initialize(lang);
          activeLang = lang;
          break;
        } catch (modelErr) {
          console.warn(`[MRZ] model '${lang}' load failed:`, modelErr);
          pushDebug("warn", `OCR modeli yuklenemedi: ${lang}`, { error: getSafeErrorMessage(modelErr) });
          if (lang === "eng") throw modelErr;
        }
      }
      await worker.setParameters({
        tessedit_pageseg_mode: "6",
        preserve_interword_spaces: "0",
        user_defined_dpi: "300"
      });
      workerRef.current = worker;
      console.log("[MRZ] OCR language:", activeLang);
      pushDebug("ocr", "Worker hazir", { language: activeLang });
      return worker;
    };
    const parseSourceOnce = async (scanSource, worker, passLabel, mode = "live") => {
      var _a, _b, _c, _d;
      const cvEl = canRef.current;
      const { rawCanvas: mrzRawCanvas, tightCanvas: mrzBandCanvas } = extractMrzBandDebugCanvases(scanSource);
      const bandLighting = analyzeCanvasLighting(mrzBandCanvas);
      queueDebugImageFile(`${passLabel}-mrz-raw`, mrzRawCanvas);
      queueDebugImageFile(`${passLabel}-mrz-tight`, mrzBandCanvas);
      pushDebug("crop", "MRZ bandi hazir", {
        width: mrzBandCanvas.width,
        height: mrzBandCanvas.height,
        mean: Math.round(bandLighting.mean || 0),
        bright: Number((bandLighting.brightRatio || 0).toFixed(3)),
        dark: Number((bandLighting.darkRatio || 0).toFixed(3))
      });
      if (window.MRZ_TEMPLATES) {
        try {
          const tplLines = templateMatchMRZ(mrzBandCanvas);
          if (tplLines && tplLines.length >= 2) {
            setOcrPreview(tplLines.join("\n"));
            pushDebug("template", "Template satirlari bulundu", { lines: tplLines });
            const parsed = parseMRZ(tplLines);
            if (parsed && parsed.firstName && parsed.firstName.length >= 2 && parsed.lastName && parsed.lastName.length >= 2) {
              if (!((parsed.lastName || "").length > 20 && !(parsed.lastName || "").includes(" "))) {
                console.log("[MRZ-TPL] \u2713 Ba\u015Far\u0131l\u0131!", parsed);
                return await finalizeParsed(parsed, worker, t("\u2713 MRZ okundu! ({etiket})", { etiket: passLabel }));
              }
            }
            pushDebug("template", "Template parse reddedildi", { lines: tplLines });
          } else {
            pushDebug("template", "Template satiri bulunamadi");
          }
        } catch (tplErr) {
          console.warn("[MRZ-TPL] error:", tplErr);
          pushDebug("warn", "Template asamasi hata verdi", { error: getSafeErrorMessage(tplErr) });
        }
      }
      try {
        const direct = buildDirectMrzLineCanvases(mrzBandCanvas);
        const directAttempts = [{ label: "dogrudan-satir-adaptif", canvases: direct.adaptiveLines }];
        if ((((_a = direct.lighting) == null ? void 0 : _a.brightRatio) || 0) > 0.1 || (((_b = direct.lighting) == null ? void 0 : _b.mean) || 0) > 168) {
          directAttempts.push({ label: "dogrudan-satir-gun", canvases: direct.glareReducedLines });
        }
        if ((((_c = direct.lighting) == null ? void 0 : _c.darkRatio) || 0) > 0.1 || (((_d = direct.lighting) == null ? void 0 : _d.mean) || 0) < 118) {
          directAttempts.push({ label: "dogrudan-satir-dusuk-isik", canvases: direct.lowLightLines });
        }
        directAttempts.push({ label: "dogrudan-satir-binary", canvases: direct.binaryLines });
        for (const directAttempt of directAttempts) {
          setStatus(`${passLabel} \u2014 ${directAttempt.label}`);
          await worker.setParameters({
            tessedit_pageseg_mode: "7",
            tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"
          });
          const rawLines = [];
          for (const lineCanvas of directAttempt.canvases) {
            const { data: { text: lineText } } = await worker.recognize(lineCanvas);
            rawLines.push((lineText || "").replace(/\s+/g, ""));
          }
          const normalizedLines = rawLines.flatMap((text) => normalizeMrzText(text));
          const mrzLike = normalizedLines.filter((l) => l.includes("<") || /^[A-Z0-9]{24,}$/.test(l));
          setOcrPreview((mrzLike.length ? mrzLike : normalizedLines).slice(0, 3).join("\n"));
          pushDebug("direct", `Dogrudan OCR denemesi: ${directAttempt.label}`, {
            rawLines,
            normalizedLines
          });
          const directParsed = parseMRZ(normalizedLines);
          if (directParsed && directParsed.firstName && directParsed.lastName) {
            return await finalizeParsed(directParsed, worker, t("\u2713 MRZ okundu! ({etiket})", { etiket: passLabel }));
          }
          pushDebug("direct", `Parse cikmadi: ${directAttempt.label}`);
        }
      } catch (directErr) {
        console.warn("[MRZ-DIRECT] error:", directErr);
        pushDebug("warn", "Dogrudan satir OCR hata verdi", { error: getSafeErrorMessage(directErr) });
      }
      const variants = mode === "photo" ? getFastMrzCanvases(mrzBandCanvas, cvEl) : buildMrzCanvases(mrzBandCanvas, cvEl);
      for (let vIdx = 0; vIdx < variants.length; vIdx++) {
        const variant = variants[vIdx];
        setStatus(`${passLabel} \u2014 ${variant.label}`);
        const varParams = { tessedit_pageseg_mode: variant.psm || "6" };
        if (variant.useWhitelist) varParams.tessedit_char_whitelist = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";
        else varParams.tessedit_char_whitelist = "";
        await worker.setParameters(varParams);
        let text = "";
        if (Array.isArray(variant.canvases) && variant.canvases.length) {
          const parts = [];
          for (const lineCanvas of variant.canvases) {
            const { data: { text: lineText } } = await worker.recognize(lineCanvas);
            parts.push(lineText || "");
          }
          text = parts.join("\n");
        } else {
          const { data: { text: singleText } } = await worker.recognize(variant.canvas);
          text = singleText || "";
        }
        console.log(`[MRZ] variant=${variant.label} raw:`, JSON.stringify(text.slice(0, 300)));
        const lines = normalizeMrzText(text);
        console.log(`[MRZ] variant=${variant.label} lines:`, lines);
        const mrzLike = lines.filter((l) => l.includes("<") || /^[A-Z0-9]{28,}$/.test(l));
        setOcrPreview((mrzLike.length ? mrzLike : lines).slice(0, 6).join("\n"));
        pushDebug("variant", `Fallback OCR: ${variant.label}`, { lines });
        const parsed = parseMRZ(lines);
        if (parsed && (!parsed.firstName || parsed.firstName.length < 2 || !parsed.lastName || parsed.lastName.length < 2)) {
          console.warn("[MRZ] sanity fail \u2014 firstName/lastName ge\xE7ersiz:", parsed.firstName, parsed.lastName);
          pushDebug("variant", `Reddedildi: ${variant.label} isim gecersiz`, { firstName: parsed.firstName || "", lastName: parsed.lastName || "" });
          continue;
        }
        if (parsed && (parsed.lastName || "").length > 20 && !(parsed.lastName || "").includes(" ")) {
          console.warn("[MRZ] sanity fail \u2014 lastName \xE7ok uzun tek kelime:", parsed.lastName);
          pushDebug("variant", `Reddedildi: ${variant.label} soyad uzun`, { lastName: parsed.lastName || "" });
          continue;
        }
        if (parsed) {
          return await finalizeParsed(parsed, worker, t("\u2713 MRZ okundu! ({etiket})", { etiket: passLabel }));
        }
        pushDebug("variant", `Parse cikmadi: ${variant.label}`);
      }
      if (window.SnapPassMrz) {
        try {
          setStatus(`${passLabel} \u2014 snappass-tam-kare`);
          await worker.setParameters({
            tessedit_pageseg_mode: "6",
            tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"
          });
          const { data: { text: fullText } } = await worker.recognize(scanSource);
          setStatus(`${passLabel} \u2014 snappass-alt-40`);
          const { data: { text: cropText } } = await worker.recognize(cropBottomCanvas(scanSource, 0.4));
          const fullScore = window.SnapPassMrz.scoreMrzLikeness(fullText || "");
          const cropScore = window.SnapPassMrz.scoreMrzLikeness(cropText || "");
          const useCrop = cropScore > fullScore;
          const lines = normalizeMrzText((useCrop ? cropText : fullText) || "");
          setOcrPreview(lines.slice(0, 3).join("\n"));
          pushDebug("snappass", "SnapPass OCR denemesi", { strategy: useCrop ? "bottom-crop-40%" : "full-image", fullScore, cropScore, lines });
          const parsed = parseMRZ(lines);
          if (parsed && parsed.firstName && parsed.firstName.length >= 2 && parsed.lastName && parsed.lastName.length >= 2) {
            return await finalizeParsed(parsed, worker, t("\u2713 MRZ okundu! ({etiket})", { etiket: passLabel }));
          }
          pushDebug("snappass", "Parse cikmadi: snappass");
        } catch (spErr) {
          console.warn("[MRZ-SNAPPASS] error:", spErr);
          pushDebug("warn", "SnapPass OCR asamasi hata verdi", { error: getSafeErrorMessage(spErr) });
        }
      }
      pushDebug("error", "Bu kareden MRZ parse edilemedi");
      return false;
    };
    const SERVER_SCAN_MS = 14e3;
    const readWithServer = async (canvas) => {
      const image = canvas.toDataURL("image/jpeg", 0.92);
      if (await ocrAgentAvailable()) {
        try {
          const res = await fetch(`${OCR_AGENT_URL}/mrz/scan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image })
          });
          if (res.ok) return { ...await res.json(), source: "agent" };
          pushDebug("agent", "Yerel OCR araci hata verdi", { status: res.status });
        } catch (e) {
          pushDebug("agent", "Yerel OCR aracina ulasilamadi", { error: getSafeErrorMessage(e) });
          ocrAgentState = false;
        }
      }
      try {
        const res = await fetch(`${PROXY}/api/mrz/scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image })
        });
        const r = await res.json().catch(() => ({}));
        if (res.status === 503) {
          pushDebug("server", "MRZ motoru yapilandirilmamis");
          return "unavailable";
        }
        if (!res.ok) {
          pushDebug("server", "MRZ motoru hata verdi", { error: r.error || res.status });
          return res.status === 502 ? "unavailable" : null;
        }
        return r;
      } catch (e) {
        pushDebug("server", "MRZ motoruna ulasilamadi", { error: getSafeErrorMessage(e) });
        return "unavailable";
      }
    };
    const runServerScanLoop = async (vid) => {
      var _a, _b;
      const started = Date.now();
      let best = null, lastFrame = null, round = 0;
      while (scanRef.current && Date.now() - started < SERVER_SCAN_MS) {
        round++;
        let pick = null;
        for (let i = 0; i < 3; i++) {
          const frame = stageRef.current ? cropVideoToGuide(vid, stageRef.current) : captureVideoFrameToCanvas(vid);
          const quality = scoreMrzFrameQuality(frame);
          if (!pick || quality > pick.quality) pick = { frame, quality };
          if (i < 2) await wait(90);
        }
        lastFrame = pick.frame;
        setStatus(round === 1 ? t("Okunuyor\u2026 kart\u0131 sabit tutun") : t("Okunuyor\u2026 kart\u0131 sabit tutun ({n}. deneme)", { n: round }));
        setPct(Math.min(95, 10 + Math.round((Date.now() - started) / SERVER_SCAN_MS * 85)));
        for (const variant of ["ham", "esik"]) {
          const image = variant === "ham" ? pick.frame : adaptiveThresholdCanvas(pick.frame, pick.frame.width > 1e3 ? 0.6 : 1);
          const r = await readWithServer(image);
          if (r === "unavailable") return best ? { status: "ok", ...best } : { status: "unavailable" };
          if (!r) continue;
          const valid = ((_a = r.checksum) == null ? void 0 : _a.validCount) || 0;
          const total = ((_b = r.checksum) == null ? void 0 : _b.totalCount) || 0;
          const lines = String(r.rawMrz || "").split("\n").map((l) => l.trim()).filter(Boolean);
          pushDebug("server", "OCR sonucu", { source: r.source || "cloud", round, variant, quality: Number(pick.quality.toFixed(1)), valid, total, lines });
          if (lines.length) setOcrPreview(lines.join("\n"));
          if (valid < 2 || !lines.length) continue;
          const parsed = parseMRZ(lines);
          if (!parsed || !parsed.firstName || !parsed.lastName) continue;
          if (!best || valid > best.valid) best = { valid, total, parsed, frame: pick.frame };
          if (valid >= total) break;
        }
        if (best && (best.valid >= best.total || best.valid >= 3)) break;
      }
      if (lastFrame) queueDebugImageFile("best-frame", (best == null ? void 0 : best.frame) || lastFrame);
      return best ? { status: "ok", ...best } : { status: "failed" };
    };
    const runSnapshotMrzScan = async (actionLabel = t("Net kare")) => {
      if (!tLoaded || !camOk) return;
      const vid = vidRef.current;
      if (!vid || !vid.videoWidth) return;
      setPhase("scanning");
      scanRef.current = true;
      setPct(5);
      setStatus(t("Kamera netleniyor\u2026"));
      setOcrPreview("");
      setDebugLogs([]);
      pushDebug("scan", "Snapshot tarama basladi", { action: actionLabel });
      let worker = null;
      try {
        const server = await runServerScanLoop(vid);
        if (server.status === "ok") {
          pushDebug("scan", "MRZ motoru sonucu kabul edildi", { valid: server.valid, total: server.total });
          return await finalizeParsed(server.parsed, null, t("\u2713 MRZ okundu!"));
        }
        if (server.status === "failed") {
          setPct(100);
          setPhase("failed");
          setStatus(t("MRZ okunamad\u0131 \u2014 kart\u0131 \xE7er\xE7evede sabit tutun, \u0131\u015F\u0131\u011F\u0131 art\u0131r\u0131n ya da manuel giri\u015F yap\u0131n"));
          pushDebug("error", "MRZ motoru sure icinde okuyamadi");
          await flushDebugArtifacts();
          scanRef.current = false;
          return;
        }
        const workerPromise = createOcrWorker();
        await wait(120);
        const burst = [];
        const burstCount = 3;
        for (let i = 0; i < burstCount; i++) {
          if (!scanRef.current) return;
          setPct(8 + Math.round((i + 1) / burstCount * 18));
          setStatus(t("En net kare se\xE7iliyor\u2026 ({i}/{n})", { i: i + 1, n: burstCount }));
          const sourceCanvas = stageRef.current ? cropVideoToGuide(vid, stageRef.current) : captureVideoFrameToCanvas(vid);
          const correctedCanvas = cvLoaded ? detectPerspectiveCorrectedCanvas(sourceCanvas) : null;
          if (correctedCanvas) correctedCanvas.isCardCrop = true;
          const scanSource = correctedCanvas || sourceCanvas;
          const quality = scoreMrzFrameQuality(scanSource);
          burst.push({ scanSource, quality });
          pushDebug("frame", "Aday kare alindi", {
            index: i + 1,
            quality: Number(quality.toFixed(2)),
            corrected: !!correctedCanvas,
            width: scanSource.videoWidth || scanSource.width || 0,
            height: scanSource.videoHeight || scanSource.height || 0
          });
          if (correctedCanvas) {
            console.log("[MRZ] still-frame perspective normalized:", correctedCanvas.width, correctedCanvas.height, "quality=", quality);
          } else {
            console.log("[MRZ] still-frame raw quality=", quality);
          }
          if (i < burstCount - 1) await wait(80);
        }
        burst.sort((a, b) => b.quality - a.quality);
        pushDebug("frame", "En iyi kareler secildi", {
          best: burst.slice(0, 2).map((item, idx) => ({ rank: idx + 1, quality: Number(item.quality.toFixed(2)) }))
        });
        const candidates = burst.slice(0, 2);
        candidates.forEach((candidate, idx) => {
          queueDebugImageFile(`best-frame-${idx + 1}`, candidate.scanSource);
        });
        worker = await workerPromise;
        for (let i = 0; i < candidates.length; i++) {
          const label = i === 0 ? actionLabel : t("Yedek kare {n}", { n: i + 1 });
          pushDebug("scan", "Kare parse ediliyor", { label, quality: Number(candidates[i].quality.toFixed(2)) });
          const success = await parseSourceOnce(candidates[i].scanSource, worker, label, "photo");
          if (success) return;
        }
        setPct(100);
        setPhase("failed");
        setStatus(t("MRZ okunamad\u0131 \u2014 net kareyi yeniden al\u0131n ya da manuel giri\u015F yap\u0131n"));
        pushDebug("error", "Tarama sonunda parse cikmadi");
        await flushDebugArtifacts();
        scanRef.current = false;
        await safeTerminateWorker(worker);
        workerRef.current = null;
      } catch (e) {
        console.error("[MRZ-STILL]", e);
        setPhase("failed");
        setStatus(t("Hata: {mesaj}", { mesaj: getSafeErrorMessage(e) }));
        pushDebug("error", "Snapshot tarama exception", { error: getSafeErrorMessage(e) });
        await flushDebugArtifacts();
        scanRef.current = false;
        await safeTerminateWorker(worker);
        workerRef.current = null;
      }
    };
    const captureStillFrame = async () => {
      await runSnapshotMrzScan(t("Net kare"));
    };
    const startScan = async () => {
      await runSnapshotMrzScan(t("MRZ taramas\u0131"));
    };
    const skipToManual = () => {
      var _a;
      (_a = strRef.current) == null ? void 0 : _a.getTracks().forEach((t2) => t2.stop());
      onDone({ ...EMPTY_SCAN, firstName: guest.firstName, lastName: guest.lastName });
    };
    const mrzArea = guide ? {
      left: guide.left + guide.width * CARD_MRZ_BOX.sx,
      top: guide.top + guide.height * CARD_MRZ_BOX.sy,
      width: guide.width * CARD_MRZ_BOX.sw,
      height: guide.height * CARD_MRZ_BOX.sh
    } : null;
    return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "100dvh", background: "#09111F", display: "flex", flexDirection: "column" } }, /* @__PURE__ */ React.createElement("style", null, GS), /* @__PURE__ */ React.createElement(
      TopBar,
      {
        session,
        onBack: () => {
          var _a;
          (_a = strRef.current) == null ? void 0 : _a.getTracks().forEach((t2) => t2.stop());
          onBack();
        },
        onLogout: onLogout && (() => {
          var _a;
          (_a = strRef.current) == null ? void 0 : _a.getTracks().forEach((t2) => t2.stop());
          onLogout();
        })
      }
    ), /* @__PURE__ */ React.createElement("div", { style: { background: `linear-gradient(90deg,#1B3C6D,${S.navy2})`, padding: "10px 18px" } }, /* @__PURE__ */ React.createElement("div", { style: { maxWidth: 700, margin: "0 auto", display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement(Avt, { f: guest.firstName, l: guest.lastName, sz: 34 }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 800, color: "#fff" } }, guest.firstName, " ", guest.lastName), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(255,255,255,.4)" } }, guest.confirmationNo)), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: S.orangeLt, fontWeight: 800, background: "rgba(247,148,29,.16)", padding: "3px 10px", borderRadius: 10 } }, t("TARAMA")))), /* @__PURE__ */ React.createElement("div", { ref: stageRef, style: { height: scanStageHeight, position: "relative", overflow: "hidden", flexShrink: 0 } }, camOk ? /* @__PURE__ */ React.createElement("video", { ref: vidRef, autoPlay: true, playsInline: true, muted: true, style: { width: "100%", height: "100%", objectFit: "cover" } }) : /* @__PURE__ */ React.createElement("div", { style: { width: "100%", minHeight: 340, height: "100%", background: "#111827", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 48 } }, "\u{1F4F7}"), /* @__PURE__ */ React.createElement("p", { style: { color: "rgba(255,255,255,.35)", fontSize: 13, textAlign: "center", padding: "0 30px" } }, insecureCameraContext ? t("Kamera kullan\u0131lam\u0131yor \u2014 mobilde HTTPS gerekli") : t("Kamera kullan\u0131lam\u0131yor \u2014 sim\xFClasyon modu")), insecureCameraContext && /* @__PURE__ */ React.createElement("p", { style: { color: "rgba(255,255,255,.28)", fontSize: 11, textAlign: "center", padding: "0 28px", lineHeight: 1.5 } }, t("Telefonda kamera i\xE7in sayfan\u0131n HTTPS adresinden a\xE7\u0131lmas\u0131 gerekir.")), /* @__PURE__ */ React.createElement("div", { style: { width: 290, height: 180, border: `2px dashed ${S.blue}44`, borderRadius: 10, background: `${S.blue}07`, display: "flex", alignItems: "center", justifyContent: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { color: "rgba(255,255,255,.18)", fontSize: 12 } }, t("Belge Alan\u0131")))), guide && mrzArea && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", inset: 0, pointerEvents: "none" } }, /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", left: guide.left, top: guide.top, width: guide.width, height: guide.height, borderRadius: 14, border: "2px solid rgba(255,255,255,.8)", boxShadow: "0 0 0 9999px rgba(5,10,20,.42)" } }), [["top", "left"], ["top", "right"], ["bottom", "left"], ["bottom", "right"]].map(([v, h]) => /* @__PURE__ */ React.createElement("div", { key: v + h, style: {
      position: "absolute",
      left: h === "left" ? guide.left - 3 : guide.left + guide.width - 31,
      top: v === "top" ? guide.top - 3 : guide.top + guide.height - 31,
      width: 34,
      height: 34,
      borderTop: v === "top" ? `4px solid ${S.blue}` : "none",
      borderBottom: v === "bottom" ? `4px solid ${S.blue}` : "none",
      borderLeft: h === "left" ? `4px solid ${S.blue}` : "none",
      borderRight: h === "right" ? `4px solid ${S.blue}` : "none",
      borderRadius: `${v === "top" && h === "left" ? "14px" : "0"} ${v === "top" && h === "right" ? "14px" : "0"} ${v === "bottom" && h === "right" ? "14px" : "0"} ${v === "bottom" && h === "left" ? "14px" : "0"}`
    } })), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", left: mrzArea.left, top: mrzArea.top, width: mrzArea.width, height: mrzArea.height, border: "2px dashed rgba(247,148,29,.9)", background: "rgba(247,148,29,.08)", borderRadius: 10 } }), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", left: mrzArea.left + 8, top: mrzArea.top + 6, background: "rgba(9,17,31,.78)", color: S.orangeLt, fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 999, letterSpacing: ".4px" } }, t("MRZ (\u2039\u2039\u2039 sat\u0131rlar\u0131)")), phase === "scanning" && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", left: mrzArea.left, width: mrzArea.width, height: 2, top: mrzArea.top + pct / 100 * mrzArea.height, background: `linear-gradient(90deg,transparent,${S.orange},${S.orangeLt},transparent)`, boxShadow: `0 0 10px ${S.orange}`, transition: "top .1s linear" } }), /* @__PURE__ */ React.createElement("div", { className: "scan-hint", style: { position: "absolute", top: guide.top + 12, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,.7)", color: "rgba(255,255,255,.9)", fontSize: 12, padding: "5px 16px", borderRadius: 20, whiteSpace: "nowrap", backdropFilter: "blur(6px)", fontWeight: 700 } }, phase === "ready" ? t("Kart\u0131 / pasaport sayfas\u0131n\u0131 \xE7er\xE7eveye s\u0131\u011Fd\u0131r\u0131n") : phase === "scanning" ? status : t("\u2713 Tarama tamamland\u0131!"))), phase === "scanning" && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "rgba(255,255,255,.07)" } }, /* @__PURE__ */ React.createElement("div", { style: { height: "100%", width: `${pct}%`, background: `linear-gradient(90deg,${S.blue},${S.orange})`, transition: "width .14s" } }))), /* @__PURE__ */ React.createElement("div", { className: "scan-controls", style: { background: "rgba(9,17,31,.92)", backdropFilter: "blur(10px)", padding: "20px 24px", borderTop: "1px solid rgba(255,255,255,.07)", textAlign: "center" } }, /* @__PURE__ */ React.createElement("canvas", { ref: canRef, style: { display: "none" } }), (phase === "ready" || !tLoaded) && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { onClick: startScan, disabled: !camOk, style: { width: 70, height: 70, borderRadius: "50%", background: tLoaded ? `linear-gradient(135deg,${S.blue},${S.navy})` : "#334", border: "4px solid rgba(255,255,255,.18)", color: "#fff", fontSize: 26, cursor: "pointer", animation: tLoaded ? "pulse 2s infinite" : "none", display: "inline-flex", alignItems: "center", justifyContent: "center" } }, tLoaded ? "\u{1F4F8}" : /* @__PURE__ */ React.createElement(Spin, { sz: 24 })), /* @__PURE__ */ React.createElement("p", { style: { color: "rgba(255,255,255,.32)", fontSize: 12, marginTop: 8, fontWeight: 600 } }, tLoaded ? t("MRZ taramak i\xE7in dokun") : t("Okuma motoru y\xFCkleniyor\u2026")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 8 } }, camOk && /* @__PURE__ */ React.createElement("button", { onClick: captureStillFrame, style: { background: "transparent", border: "1px solid rgba(255,255,255,.24)", color: "rgba(255,255,255,.82)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" } }, t("Net Kare Al")), camOk && torch.supported && /* @__PURE__ */ React.createElement("button", { onClick: toggleTorch, style: { background: torch.on ? "rgba(247,148,29,.22)" : "transparent", border: `1px solid ${torch.on ? "rgba(247,148,29,.6)" : "rgba(255,255,255,.24)"}`, color: torch.on ? S.orangeLt : "rgba(255,255,255,.82)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" } }, "\u{1F526} ", torch.on ? t("I\u015F\u0131\u011F\u0131 Kapat") : t("I\u015F\u0131k A\xE7")), !camOk && /* @__PURE__ */ React.createElement("button", { onClick: skipToManual, style: { background: "transparent", border: "1px solid rgba(255,255,255,.2)", color: "rgba(255,255,255,.5)", borderRadius: 8, padding: "8px 14px", fontSize: 12, cursor: "pointer" } }, t("Manuel Giri\u015F \u2192")))), phase === "scanning" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "inline-flex", alignItems: "center", gap: 10, color: "#fff", fontSize: 14, fontWeight: 700 } }, /* @__PURE__ */ React.createElement(Spin, { sz: 18 }), " ", status), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(255,255,255,.35)" } }, "%", Math.round(pct)), camOk && torch.supported && /* @__PURE__ */ React.createElement("button", { onClick: toggleTorch, style: { background: torch.on ? "rgba(247,148,29,.22)" : "transparent", border: `1px solid ${torch.on ? "rgba(247,148,29,.6)" : "rgba(255,255,255,.24)"}`, color: torch.on ? S.orangeLt : "rgba(255,255,255,.82)", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" } }, "\u{1F526} ", torch.on ? t("I\u015F\u0131\u011F\u0131 Kapat") : t("I\u015F\u0131k A\xE7")), ocrPreview && /* @__PURE__ */ React.createElement("pre", { style: { maxWidth: 620, whiteSpace: "pre-wrap", wordBreak: "break-all", textAlign: "left", background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "6px 10px", color: "rgba(255,255,255,.7)", fontSize: 10, lineHeight: 1.4, margin: 0, maxHeight: 80, overflow: "auto" } }, ocrPreview), SHOW_MRZ_DEBUG_UI && !!debugLogs.length && /* @__PURE__ */ React.createElement("pre", { style: { maxWidth: 700, width: "100%", whiteSpace: "pre-wrap", wordBreak: "break-word", textAlign: "left", background: "rgba(6,12,22,.72)", border: "1px solid rgba(74,144,217,.22)", borderRadius: 10, padding: "10px 12px", color: "#BFD8FF", fontSize: 10.5, lineHeight: 1.5, margin: 0, maxHeight: 160, overflow: "auto" } }, debugLogs.slice(-8).join("\n"))), phase === "done" && /* @__PURE__ */ React.createElement("div", { style: { display: "inline-flex", alignItems: "center", gap: 8, color: S.green, fontSize: 15, fontWeight: 800 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 20 } }, "\u2713"), " ", t("MRZ okundu!")), phase === "failed" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { color: "#FCA5A5", fontSize: 13, fontWeight: 700 } }, "\u26A0 ", status), ocrPreview && /* @__PURE__ */ React.createElement("pre", { style: { maxWidth: 620, whiteSpace: "pre-wrap", wordBreak: "break-word", textAlign: "left", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 10, padding: "10px 12px", color: "rgba(255,255,255,.78)", fontSize: 11, lineHeight: 1.5, margin: 0 } }, ocrPreview), SHOW_MRZ_DEBUG_UI && !!debugLogs.length && /* @__PURE__ */ React.createElement("pre", { style: { maxWidth: 700, width: "100%", whiteSpace: "pre-wrap", wordBreak: "break-word", textAlign: "left", background: "rgba(6,12,22,.72)", border: "1px solid rgba(252,165,165,.24)", borderRadius: 10, padding: "10px 12px", color: "#D7E5FF", fontSize: 10.5, lineHeight: 1.5, margin: 0, maxHeight: 220, overflow: "auto" } }, debugLogs.join("\n")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" } }, /* @__PURE__ */ React.createElement("button", { onClick: resetScanState, style: { background: "#fff", color: S.navy, border: `1px solid ${S.border}`, borderRadius: 9, padding: "10px 22px", fontSize: 13, fontWeight: 700, cursor: "pointer" } }, t("Yeniden Tara")), camOk && /* @__PURE__ */ React.createElement("button", { onClick: captureStillFrame, style: { background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.2)", borderRadius: 9, padding: "10px 22px", fontSize: 13, fontWeight: 700, cursor: "pointer" } }, t("Net Kare Al")), /* @__PURE__ */ React.createElement("button", { onClick: skipToManual, style: { background: `linear-gradient(135deg,${S.blue},${S.navy})`, color: "#fff", border: "none", borderRadius: 9, padding: "10px 22px", fontSize: 13, fontWeight: 700, cursor: "pointer" } }, t("Manuel Devam Et \u2192"))))));
  }
  function DupActions({ m, ctx }) {
    const u = ctx.session || {};
    const canMerge = !!u.canMerge && ctx.profileId && String(ctx.profileId) !== String(m.id);
    const canChg = ctx.reservationId && String(ctx.profileId) !== String(m.id) && (ctx.isAccompany ? !!u.canChangeAccompany : !!u.canChangeMain);
    const [keepListed, setKeepListed] = useState(true);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    if (!canMerge && !canChg) return null;
    const cur = `${ctx.name || ""} #${ctx.profileId}`.trim();
    const lst = `${m.firstName} ${m.lastName} #${m.id}`.trim();
    const post = async (path, body) => {
      const res = await fetch(`${PROXY}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-csrf": serverCsrf }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`);
      return d;
    };
    const run = async (fn) => {
      setBusy(true);
      setErr("");
      try {
        await fn();
        ctx.onChanged && ctx.onChanged();
      } catch (e) {
        setErr(e.message);
        setBusy(false);
      }
    };
    const merge = async () => {
      const survivor = keepListed ? m : { id: ctx.profileId, firstName: ctx.name || "", lastName: "" };
      const victim = keepListed ? { id: ctx.profileId, firstName: ctx.name || "", lastName: "" } : m;
      const sTxt = keepListed ? lst : cur, vTxt = keepListed ? cur : lst;
      if (!await askConfirm(t("Profiller birle\u015Ftirilsin mi?\n\nKalacak profil: {s}\nBirle\u015Fip kaybolacak profil: {v}\n\nBu i\u015Flem OPERA'da geri al\u0131namaz.", { s: sTxt, v: vTxt }))) return;
      if (!await askConfirm(t("Son onay: {v} profili {s} i\xE7ine birle\u015Ftirilecek. Emin misiniz?", { s: sTxt, v: vTxt }))) return;
      const full = (x) => `${x.firstName || ""} ${x.lastName || ""}`.trim();
      await run(() => post("/api/profile-merge", { survivorId: survivor.id, victimId: victim.id, survivorName: full(survivor), victimName: full(victim), reservationId: ctx.reservationId || "" }));
    };
    const change = async () => {
      const what = ctx.isAccompany ? t("beraberindeki") : t("ana");
      if (!await askConfirm(t("Rezervasyonun {w} profili de\u011Fi\u015Ftirilsin mi?\n\n\u015Eimdiki: {c}\nYeni: {n}\n\nSadece misafir profili de\u011Fi\u015Fir; yeti\u015Fkin / \xE7ocuk say\u0131s\u0131, oda ve fiyat de\u011Fi\u015Fmez.", { w: what, c: cur, n: lst }))) return;
      await run(() => post("/api/reservation-profile", ctx.isAccompany ? { mode: "accompany", reservationId: ctx.reservationId, newProfileId: m.id, oldProfileId: ctx.profileId, newName: `${m.firstName} ${m.lastName}`.trim(), oldName: ctx.name || "" } : { mode: "main", reservationId: ctx.reservationId, newProfileId: m.id, newName: `${m.firstName} ${m.lastName}`.trim(), oldName: ctx.name || "" }));
    };
    const btn = { width: "100%", minHeight: 42, background: "#fff", color: S.blue, border: `1.5px solid ${S.blue}66` };
    return /* @__PURE__ */ React.createElement("div", { style: { marginTop: 10, display: "flex", flexDirection: "column", gap: 8 } }, canChg && /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn", disabled: busy, onClick: change, style: btn }, ctx.isAccompany ? t("Beraberindeki profili bununla de\u011Fi\u015Ftir") : t("Rezervasyonun ana profilini bununla de\u011Fi\u015Ftir")), canMerge && /* @__PURE__ */ React.createElement("div", { style: { border: `1px dashed ${S.border}`, borderRadius: 10, padding: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: S.muted, marginBottom: 6 } }, t("Kalacak profil"), ":"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 8 } }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn", onClick: () => setKeepListed(true), style: { flex: 1, minHeight: 38, fontSize: 12, fontWeight: 700, background: keepListed ? S.blue : "#fff", color: keepListed ? "#fff" : S.navy, border: `1.5px solid ${S.blue}66` } }, t("Listedeki"), " #", m.id), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn", onClick: () => setKeepListed(false), style: { flex: 1, minHeight: 38, fontSize: 12, fontWeight: 700, background: !keepListed ? S.blue : "#fff", color: !keepListed ? "#fff" : S.navy, border: `1.5px solid ${S.blue}66` } }, t("Rezervasyondaki"), " #", ctx.profileId)), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn", disabled: busy, onClick: merge, style: btn }, busy ? /* @__PURE__ */ React.createElement(Spin, null) : t("Profilleri birle\u015Ftir"))), err && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: S.red || "#C0392B" } }, err));
  }
  function DuplicateDialog({ matches, title, note, rule, canUse, forceLabel, ctx, onUse, onForce, onCancel }) {
    return /* @__PURE__ */ React.createElement("div", { className: "dup-overlay", role: "dialog", "aria-modal": "true", onClick: onCancel }, /* @__PURE__ */ React.createElement("div", { className: "dup-panel", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 800, color: S.navy, marginBottom: 4 } }, title), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13, color: S.muted, marginBottom: 8, lineHeight: 1.5 } }, note), rule && /* @__PURE__ */ React.createElement("p", { style: { fontSize: 12, color: S.muted, margin: "0 0 12px", lineHeight: 1.5, padding: "8px 10px", background: "#F6F9FD", border: `1px solid ${S.border}`, borderRadius: 8 } }, "\u2139\uFE0F ", /* @__PURE__ */ React.createElement("b", null, t("E\u015Fle\u015Fme ko\u015Fulu"), ":"), " ", rule), matches.slice(0, 5).map((m) => /* @__PURE__ */ React.createElement("div", { key: m.id, style: { border: `1.5px solid ${S.border}`, borderRadius: 12, padding: 12, marginBottom: 10, background: "#F9FBFF" } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, color: S.navy, fontSize: 15 } }, m.firstName, " ", m.lastName, " ", /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: S.muted, fontFamily: "monospace", fontWeight: 600 } }, "#", m.id)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: S.muted, marginTop: 4, display: "flex", flexWrap: "wrap", gap: "4px 12px" } }, /* @__PURE__ */ React.createElement("span", null, "\u{1F382} ", fmtDateTR(m.birthDate) || "\u2014"), /* @__PURE__ */ React.createElement("span", null, "\u{1F30D} ", m.nationality || "\u2014"), m.idNumber && /* @__PURE__ */ React.createElement("span", null, "\u{1FAAA} ", idTypeLabel({ v: m.idType, l: m.idType || "ID" }), ": ", /* @__PURE__ */ React.createElement("b", { style: { color: S.navy } }, m.idNumber))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 } }, m.reasons.map((r) => /* @__PURE__ */ React.createElement("span", { key: r, style: { fontSize: 11, fontWeight: 700, color: S.orangeDk, background: "#FFF7ED", border: `1px solid ${S.orange}44`, borderRadius: 999, padding: "2px 9px" } }, t("E\u015Fle\u015Fen:"), " ", t(r)))), canUse && /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-p", onClick: () => onUse(m), style: { width: "100%", marginTop: 10, minHeight: 46 } }, t("Bu profili kullan")), ctx && /* @__PURE__ */ React.createElement(DupActions, { m, ctx }))), matches.length > 5 && /* @__PURE__ */ React.createElement("p", { style: { fontSize: 12, color: S.muted, margin: "0 0 8px" } }, t("\u2026 ve"), " ", matches.length - 5, " ", t("e\u015Fle\u015Fen profil daha (en alakal\u0131 5 g\xF6steriliyor)")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginTop: 6 } }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn", onClick: onForce, style: { minHeight: 46, background: "#fff", color: S.blue, border: `1.5px solid ${S.blue}66` } }, forceLabel), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn", onClick: onCancel, style: { minHeight: 46, background: "transparent", color: S.muted } }, t("Vazge\xE7")))));
  }
  function DocForm({ guest, scan, session, onSubmit, onBack, onLogout, manual }) {
    const pd = guest == null ? void 0 : guest.profileDetails;
    const scanCountry = normalizeCountryCode((scan == null ? void 0 : scan.nationality) || (scan == null ? void 0 : scan.issuingCountry) || "");
    const profileCountry = normalizeCountryCode((pd == null ? void 0 : pd.nationality) || (pd == null ? void 0 : pd.issuingCountry) || "");
    const resolvedGender = pickFieldValue((scan == null ? void 0 : scan.gender) === "U" ? "" : (scan == null ? void 0 : scan.gender) || "", (pd == null ? void 0 : pd.gender) || "", "M");
    const resolvedDocType = normalizeDocType(pickFieldValue(scan == null ? void 0 : scan.documentType, pd == null ? void 0 : pd.idType, "PASSPORT")) || "PASSPORT";
    const isTcknDoc = resolvedDocType === "TCKN";
    const safeScanDocNumber = isValidTurkishIdentityNumber((scan == null ? void 0 : scan.documentNumber) || "") ? String(scan.documentNumber).trim() : "";
    const safeProfileDocNumber = isValidTurkishIdentityNumber((pd == null ? void 0 : pd.documentNumber) || "") ? String(pd.documentNumber).trim() : "";
    const resolvedNationality = isTcknDoc ? "TR" : toIso2(pickFieldValue(scanCountry, profileCountry));
    const resolvedIssuingCountry = isTcknDoc ? "TR" : pickFieldValue(
      normalizeCountryCode((scan == null ? void 0 : scan.issuingCountry) || ""),
      normalizeCountryCode((pd == null ? void 0 : pd.issuingCountry) || ""),
      resolvedNationality
    );
    const scanOnly = isTcknDoc && !manual;
    const resolvedBirthPlace = scanOnly ? normalizeBirthPlace((scan == null ? void 0 : scan.birthPlace) || "", "TR") : normalizeBirthPlace(
      pickFieldValue(scan == null ? void 0 : scan.birthPlace, pd == null ? void 0 : pd.birthPlace),
      resolvedNationality || resolvedIssuingCountry
    );
    const [f, setF] = useState(() => applyNationalityRules({
      ...scan,
      firstName: scanOnly ? pickFieldValue(scan == null ? void 0 : scan.firstName) : pickFieldValue(scan == null ? void 0 : scan.firstName, pd == null ? void 0 : pd.firstName, guest == null ? void 0 : guest.firstName),
      middleName: scanOnly ? pickFieldValue(scan == null ? void 0 : scan.middleName) : pickFieldValue(scan == null ? void 0 : scan.middleName, pd == null ? void 0 : pd.middleName),
      lastName: scanOnly ? pickFieldValue(scan == null ? void 0 : scan.lastName) : pickFieldValue(scan == null ? void 0 : scan.lastName, pd == null ? void 0 : pd.lastName, guest == null ? void 0 : guest.lastName),
      dateOfBirth: scanOnly ? pickFieldValue(scan == null ? void 0 : scan.dateOfBirth) : pickFieldValue(scan == null ? void 0 : scan.dateOfBirth, pd == null ? void 0 : pd.birthDate),
      birthPlace: resolvedBirthPlace,
      gender: resolvedGender || "M",
      nationality: resolvedNationality,
      documentType: resolvedDocType,
      documentNumber: isTcknDoc ? pickFieldValue(safeScanDocNumber, safeProfileDocNumber) : pickFieldValue(scan == null ? void 0 : scan.documentNumber, pd == null ? void 0 : pd.documentNumber),
      issuingCountry: resolvedIssuingCountry,
      issuedDate: scanOnly ? pickFieldValue(scan == null ? void 0 : scan.issuedDate) : pickFieldValue(scan == null ? void 0 : scan.issuedDate, pd == null ? void 0 : pd.issuedDate),
      expiryDate: scanOnly ? pickFieldValue(scan == null ? void 0 : scan.expiryDate) : pickFieldValue(scan == null ? void 0 : scan.expiryDate, pd == null ? void 0 : pd.expiryDate),
      issuedPlace: scanOnly ? pickFieldValue(scan == null ? void 0 : scan.issuedPlace) : pickFieldValue(scan == null ? void 0 : scan.issuedPlace, pd == null ? void 0 : pd.issuedPlace)
    }, resolvedNationality, scan == null ? void 0 : scan.idNumber));
    const [busy, setBusy] = useState(false), [done, setDone] = useState(false);
    const [submitErr, setSubmitErr] = useState("");
    const [idTypeOpts, setIdTypeOpts] = useState([{ v: "PASSPORT", l: "Pasaport" }, { v: "TCKN", l: "TCKN" }]);
    useEffect(() => {
      if (!(session == null ? void 0 : session.hostName) || !(session == null ? void 0 : session.appKey) || !(session == null ? void 0 : session.token)) return;
      fetch(`/api/id-types?hostName=${encodeURIComponent(session.hostName)}&hotelId=${encodeURIComponent(session.hotelId || "")}&appKey=${encodeURIComponent(session.appKey)}&token=${encodeURIComponent(session.token)}`).then((r) => r.json()).then((d) => {
        if (d.opts && d.opts.length > 0) setIdTypeOpts(d.opts);
      }).catch(() => {
      });
    }, []);
    const set = (k) => (v) => setF((p) => k === "nationality" ? applyNationalityRules(p, v) : { ...p, [k]: v });
    const [dateBad, setDateBad] = useState(false);
    const isTR = f.nationality === "TR";
    const personalRequired = !isTR;
    const birthPlaceRequired = personalRequired;
    const countryOpts = window.IsoCountries ? window.IsoCountries.options(f.nationality, CUR_LANG) : null;
    const docTypeOpts = isTR ? turkishIdTypeOpts() : idTypeOpts.map((o) => ({ ...o, l: idTypeLabel(o) }));
    const [dup, setDup] = useState(null);
    const submit = async (skipDup = false) => {
      var _a;
      if (dateBad) {
        setSubmitErr(t("Ge\xE7erli bir do\u011Fum tarihi girin (GG.AA.YYYY)"));
        return;
      }
      if (!f.nationality) {
        setSubmitErr(t("Uyruk se\xE7in"));
        return;
      }
      if (isTR && f.documentType !== "TCKN") {
        setSubmitErr(t("T.C. vatanda\u015F\u0131 i\xE7in belge tipi T.C. kimlik (TCKN) olmal\u0131"));
        return;
      }
      if (!f.documentNumber) {
        setSubmitErr(t("Belge numaras\u0131 zorunlu"));
        return;
      }
      if (f.documentType === "TCKN") {
        const tc = String(f.documentNumber).replace(/\s/g, "");
        if (!/^\d{11}$/.test(tc)) {
          setSubmitErr(t("TC kimlik no 11 haneli olmal\u0131."));
          return;
        }
        if (!isValidTckn(tc)) {
          setSubmitErr(t("TC kimlik no ge\xE7ersiz (T.C. kimlik no do\u011Frulama kural\u0131na uymuyor)."));
          return;
        }
      }
      if (personalRequired) {
        if (!String(f.firstName || "").trim()) {
          setSubmitErr(t("Ad zorunlu"));
          return;
        }
        if (!String(f.lastName || "").trim()) {
          setSubmitErr(t("Soyad zorunlu"));
          return;
        }
        if (!f.dateOfBirth) {
          setSubmitErr(t("Do\u011Fum tarihi zorunlu"));
          return;
        }
        if (!String(f.birthPlace || "").trim()) {
          setSubmitErr(t("T.C. vatanda\u015F\u0131 olmayanlar i\xE7in do\u011Fum yeri zorunlu"));
          return;
        }
      }
      setBusy(true);
      setSubmitErr("");
      const idChanged = String(f.documentNumber || "").trim() !== String((pd == null ? void 0 : pd.documentNumber) || "").trim();
      if (!skipDup && idChanged) {
        const matches = await findDuplicates({
          hostName: session.hostName,
          hotelId: session.hotelId,
          appKey: session.appKey,
          token: session.token,
          excludeProfileId: guest.guestId,
          criteria: { identificationNo: String(f.documentNumber).trim() }
        });
        if (matches.length) {
          setBusy(false);
          setDup({ matches });
          return;
        }
      }
      try {
        const identId = (_a = guest == null ? void 0 : guest.profileDetails) == null ? void 0 : _a.identId;
        await putProfile({
          hostName: session.hostName,
          hotelId: session.hotelId,
          appKey: session.appKey,
          token: session.token,
          profileId: guest.guestId,
          docData: f,
          changed: (() => {
            const d10 = (v) => String(v || "").slice(0, 10);
            return changedKeys(
              { firstName: (pd == null ? void 0 : pd.firstName) || (guest == null ? void 0 : guest.firstName), middleName: pd == null ? void 0 : pd.middleName, lastName: (pd == null ? void 0 : pd.lastName) || (guest == null ? void 0 : guest.lastName), dateOfBirth: d10(pd == null ? void 0 : pd.birthDate), birthPlace: pd == null ? void 0 : pd.birthPlace, documentNumber: pd == null ? void 0 : pd.documentNumber, issuedDate: d10(pd == null ? void 0 : pd.issuedDate), expiryDate: d10(pd == null ? void 0 : pd.expiryDate), issuedPlace: pd == null ? void 0 : pd.issuedPlace },
              { ...f, dateOfBirth: d10(f.dateOfBirth), issuedDate: d10(f.issuedDate), expiryDate: d10(f.expiryDate) },
              ["firstName", "middleName", "lastName", "dateOfBirth", "birthPlace", "documentNumber", "issuedDate", "expiryDate", "issuedPlace"]
            );
          })()
        });
        await putIdentification({
          hostName: session.hostName,
          hotelId: session.hotelId,
          appKey: session.appKey,
          token: session.token,
          profileId: guest.guestId,
          identId: identId || null,
          docData: f
        });
        setDone(true);
        setTimeout(() => onSubmit(f), 1800);
      } catch (e) {
        setSubmitErr(e.message);
        setBusy(false);
      }
    };
    if (done) return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "100dvh", background: S.bg, display: "flex", alignItems: "center", justifyContent: "center" } }, /* @__PURE__ */ React.createElement("style", null, GS), /* @__PURE__ */ React.createElement("div", { className: "fadeUp", style: { textAlign: "center", padding: 40 } }, /* @__PURE__ */ React.createElement("div", { style: { width: 82, height: 82, borderRadius: "50%", background: `linear-gradient(135deg,${S.green},#1A7A43)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, margin: "0 auto 18px", boxShadow: "0 8px 28px rgba(39,174,96,.28)" } }, "\u2713"), /* @__PURE__ */ React.createElement("h2", { style: { fontFamily: "'Nunito',sans-serif", fontSize: 24, fontWeight: 900, color: S.navy, marginBottom: 8 } }, t("Ba\u015Far\u0131yla G\xF6nderildi")), /* @__PURE__ */ React.createElement("p", { style: { color: S.muted, fontSize: 14 } }, t("Belge SnapPass arac\u0131l\u0131\u011F\u0131yla Protel PMS'e iletildi")), /* @__PURE__ */ React.createElement("p", { style: { color: S.muted, fontSize: 14, marginTop: 4 } }, /* @__PURE__ */ React.createElement("strong", null, guest.firstName, " ", guest.lastName), " \xB7 ", guest.confirmationNo)));
    return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "calc(100dvh - 46px)", background: S.bg } }, /* @__PURE__ */ React.createElement("style", null, GS), dup && /* @__PURE__ */ React.createElement(
      DuplicateDialog,
      {
        matches: dup.matches,
        rule: t("Ba\u015Fka bir OPERA misafir profilinde (bu profil hari\xE7) ayn\u0131 kimlik / pasaport numaras\u0131 kay\u0131tl\u0131ysa listelenir. Bo\u015Fluk ve harf b\xFCy\xFCkl\xFC\u011F\xFC fark etmez; en alakal\u0131 5 profil g\xF6sterilir."),
        title: t("Bu kimlik numaras\u0131 ba\u015Fka bir profilde kay\u0131tl\u0131"),
        note: t("Girdi\u011Finiz kimlik numaras\u0131 sistemde a\u015Fa\u011F\u0131daki profilde zaten var. Rezervasyondaki profili de\u011Fi\u015Ftirmeden, yine de bu profile kaydetmek mi istiyorsunuz?"),
        canUse: false,
        forceLabel: t("Yine de bu profile kaydet"),
        ctx: { session, profileId: guest.guestId, name: `${guest.firstName || ""} ${guest.lastName || ""}`.trim(), reservationId: guest.reservationId, isAccompany: !!guest.isAccompany, onChanged: () => {
          setDup(null);
          onSubmit && onSubmit();
        } },
        onForce: () => {
          setDup(null);
          submit(true);
        },
        onCancel: () => setDup(null)
      }
    ), /* @__PURE__ */ React.createElement(TopBar, { session, onBack, onLogout }), /* @__PURE__ */ React.createElement("div", { className: "page-wrap", style: { maxWidth: 660, margin: "0 auto", padding: "22px 18px 50px" } }, /* @__PURE__ */ React.createElement("div", { className: "fadeUp" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 18 } }, /* @__PURE__ */ React.createElement("div", { style: { width: 4, height: 34, background: `linear-gradient(${S.blue},${S.navy})`, borderRadius: 4 } }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h1", { style: { fontFamily: "'Nunito',sans-serif", fontSize: 26, fontWeight: 900, color: S.navy } }, t("Belge Verisi")), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13, color: S.muted } }, manual ? t("Profildeki bilgileri kontrol edin, eksikleri tamamlay\u0131n") : t("Okuma sonu\xE7lar\u0131n\u0131 g\xF6zden ge\xE7irin, gerekirse d\xFCzenleyin")))), /* @__PURE__ */ React.createElement("div", { className: "form-guest", style: { background: "linear-gradient(135deg,#EEF5FF,#F4F8FF)", border: `1.5px solid ${S.blue}28`, borderRadius: 12, padding: "14px 18px", marginBottom: 14, display: "flex", alignItems: "center", gap: 14 } }, /* @__PURE__ */ React.createElement(Avt, { f: guest.firstName, l: guest.lastName, sz: 48 }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 800, color: S.navy } }, guest.firstName, " ", guest.lastName), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: S.muted, marginTop: 2 } }, "\u{1F4CB} ", guest.confirmationNo, " \xB7 \u{1F6CF} ", guest.roomType || "\u2014")), /* @__PURE__ */ React.createElement("span", { style: { background: `linear-gradient(135deg,${S.blue},${S.navy})`, color: "#fff", fontSize: 10, fontWeight: 800, padding: "4px 10px", borderRadius: 9 } }, manual ? t("\u270F\uFE0F PROF\u0130L") : t("\u2713 TARAMA TAMAM"))), /* @__PURE__ */ React.createElement("div", { className: "card form-card", style: { marginBottom: 18 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, paddingBottom: 12, marginBottom: 12, borderBottom: `1px solid ${S.border}` } }, /* @__PURE__ */ React.createElement("div", { style: { width: 30, height: 30, borderRadius: 8, background: `linear-gradient(135deg,${S.blue},${S.navy})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 } }, "\u{1F464}"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 15, fontWeight: 800, color: S.navy, fontFamily: "'Nunito',sans-serif" } }, t("Ki\u015Fisel Bilgiler")), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontSize: 11, color: S.muted, background: S.bg, padding: "2px 9px", borderRadius: 7, border: `1px solid ${S.border}` } }, manual ? t("Profil \xB7 D\xFCzenlenebilir") : t("Okuma \xB7 D\xFCzenlenebilir"))), /* @__PURE__ */ React.createElement("div", { className: "form-grid", style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } }, /* @__PURE__ */ React.createElement(Fld, { label: t("Ad"), value: f.firstName, onChange: set("firstName"), required: personalRequired }), /* @__PURE__ */ React.createElement(Fld, { label: t("\u0130kinci Ad"), value: f.middleName, onChange: set("middleName") }), /* @__PURE__ */ React.createElement("div", { style: { gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement(Fld, { label: t("Soyad"), value: f.lastName, onChange: set("lastName"), required: personalRequired })), /* @__PURE__ */ React.createElement(DateInput, { label: t("Do\u011Fum Tarihi"), value: f.dateOfBirth, onChange: set("dateOfBirth"), required: personalRequired, onInvalid: setDateBad }), /* @__PURE__ */ React.createElement(Fld, { label: t("Cinsiyet"), value: f.gender, onChange: set("gender"), required: personalRequired, opts: [{ v: "M", l: t("Erkek (M)") }, { v: "F", l: t("Kad\u0131n (F)") }, { v: "X", l: t("Belirtilmemi\u015F") }] }), /* @__PURE__ */ React.createElement("div", { style: { gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement(Fld, { label: t("Do\u011Fum Yeri"), value: f.birthPlace, onChange: set("birthPlace"), required: birthPlaceRequired })), /* @__PURE__ */ React.createElement(Fld, { label: t("Uyruk"), value: f.nationality, onChange: set("nationality"), required: true, opts: countryOpts }), /* @__PURE__ */ React.createElement(Fld, { label: t("Belge Tipi"), value: f.documentType, onChange: set("documentType"), required: true, opts: docTypeOpts }), /* @__PURE__ */ React.createElement("div", { style: { gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement(Fld, { label: t("Belge Numaras\u0131"), value: f.documentNumber, onChange: set("documentNumber"), required: true })))), submitErr && /* @__PURE__ */ React.createElement("div", { style: { background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 9, padding: "11px 14px", fontSize: 12, color: S.red, wordBreak: "break-word", whiteSpace: "pre-wrap", marginBottom: 10 } }, "\u26A0 ", submitErr), /* @__PURE__ */ React.createElement("button", { className: "btn btn-p", onClick: () => submit(), disabled: busy, style: { width: "100%", fontSize: 15, padding: 15, borderRadius: 11 } }, busy ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Spin, { sz: 18 }), " ", manual ? "Kaydediliyor\u2026" : t("Profil g\xFCncelleniyor\u2026")) : manual ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 17 } }, "\u{1F4BE}"), " ", t("Kaydet")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 17 } }, "\u{1F3E8}"), " ", t("Operacloud G\xF6nder"))))));
  }
  function AccompanyForm({ target, session, onBack, onDone }) {
    const [step, setStep] = React.useState("search");
    const [sq, setSq] = React.useState({ firstName: "", lastName: "" });
    const [searching, setSearching] = React.useState(false);
    const [searchResults, setSearchResults] = React.useState(null);
    const PROFILE_INFO_MAX = 30, PROFILE_INFO_PARALLEL = 4;
    const [profileInfo, setProfileInfo] = React.useState({});
    React.useEffect(() => {
      if (!searchResults || !searchResults.length) return;
      let cancelled = false;
      const queue = searchResults.slice(0, PROFILE_INFO_MAX);
      const worker = async () => {
        while (queue.length && !cancelled) {
          const p = queue.shift();
          let det = null;
          try {
            det = await getProfileDetails({ hostName: session.hostName, hotelId: session.hotelId, appKey: session.appKey, token: session.token, profileId: p.id, firstName: p.firstName, lastName: p.lastName });
          } catch (_) {
          }
          if (!cancelled) setProfileInfo((m) => ({ ...m, [p.id]: det || false }));
        }
      };
      for (let k = 0; k < PROFILE_INFO_PARALLEL; k++) worker();
      return () => {
        cancelled = true;
      };
    }, [searchResults]);
    const [selectedProfile, setSelectedProfile] = React.useState(null);
    const [f, setF] = React.useState({ ...EMPTY_SCAN, documentType: "TCKN" });
    const [busy, setBusy] = React.useState(false);
    const [done, setDone] = React.useState(false);
    const [err, setErr] = React.useState("");
    const [idTypeOpts, setIdTypeOpts] = React.useState([{ v: "PASSPORT", l: "Pasaport" }, { v: "TCKN", l: "TCKN" }]);
    const set = (k) => (v) => setF((p) => k === "nationality" ? applyNationalityRules(p, v) : { ...p, [k]: v });
    const [dateBad, setDateBad] = React.useState(false);
    const isTR = f.nationality === "TR";
    const personalRequired = !isTR;
    const birthPlaceRequired = personalRequired;
    const nationalityOpts = window.IsoCountries ? window.IsoCountries.options(f.nationality, CUR_LANG) : null;
    const docTypeOpts = isTR ? turkishIdTypeOpts() : idTypeOpts.map((o) => ({ ...o, l: idTypeLabel(o) }));
    const scanGuest = { firstName: sq.firstName || t("Yeni"), lastName: sq.lastName || t("Profil"), confirmationNo: target.confirmationNo };
    React.useEffect(() => {
      if (!(session == null ? void 0 : session.hostName) || !(session == null ? void 0 : session.appKey) || !(session == null ? void 0 : session.token)) return;
      fetch(`/api/id-types?hostName=${encodeURIComponent(session.hostName)}&hotelId=${encodeURIComponent(session.hotelId || "")}&appKey=${encodeURIComponent(session.appKey)}&token=${encodeURIComponent(session.token)}`).then((r) => r.json()).then((d) => {
        if (d.opts && d.opts.length > 0) setIdTypeOpts(d.opts);
      }).catch(() => {
      });
    }, []);
    const seedNewProfile = () => ({
      ...EMPTY_SCAN,
      documentType: "TCKN",
      nationality: "TR",
      firstName: (sq.firstName || "").trim(),
      lastName: (sq.lastName || "").trim()
    });
    const openManualNewProfile = () => {
      setErr("");
      setF(seedNewProfile());
      setStep("new");
    };
    const openScanNewProfile = () => {
      setErr("");
      setF(seedNewProfile());
      setStep("scan");
    };
    const doSearch = async () => {
      if (!sq.firstName && !sq.lastName) {
        setErr(t("En az ad veya soyad girin"));
        return;
      }
      setSearching(true);
      setErr("");
      setSearchResults(null);
      try {
        const results = await profileSearch({ ...session, firstName: sq.firstName, lastName: sq.lastName });
        setSearchResults(results);
      } catch (e) {
        setErr(e.message);
      }
      setSearching(false);
    };
    const [dup, setDup] = React.useState(null);
    const doAdd = async (existingProfileId, opts = {}) => {
      var _a, _b, _c, _d, _e, _f;
      if (!existingProfileId) {
        if (dateBad) {
          setErr(t("Ge\xE7erli bir do\u011Fum tarihi girin (GG.AA.YYYY)"));
          return;
        }
        if (!f.nationality) {
          setErr(t("Uyruk se\xE7in"));
          return;
        }
        if (isTR && f.documentType !== "TCKN") {
          setErr(t("T.C. vatanda\u015F\u0131 i\xE7in belge tipi T.C. kimlik (TCKN) olmal\u0131"));
          return;
        }
        if (!f.documentNumber) {
          setErr(t("Belge numaras\u0131 zorunlu"));
          return;
        }
        if (personalRequired) {
          if (!String(f.firstName || "").trim()) {
            setErr(t("Ad zorunlu"));
            return;
          }
          if (!String(f.lastName || "").trim()) {
            setErr(t("Soyad zorunlu"));
            return;
          }
          if (!f.dateOfBirth) {
            setErr(t("Do\u011Fum tarihi zorunlu"));
            return;
          }
          if (!String(f.birthPlace || "").trim()) {
            setErr(t("T.C. vatanda\u015F\u0131 olmayanlar i\xE7in do\u011Fum yeri zorunlu"));
            return;
          }
        }
      }
      setBusy(true);
      setErr("");
      if (!existingProfileId && !opts.skipDup) {
        const matches = await findDuplicates({
          hostName: session.hostName,
          hotelId: session.hotelId,
          appKey: session.appKey,
          token: session.token,
          criteria: { identificationNo: String(f.documentNumber || "").trim(), firstName: String(f.firstName || "").trim(), lastName: String(f.lastName || "").trim(), birthDate: f.dateOfBirth || "" }
        });
        if (matches.length) {
          setBusy(false);
          setDup({ matches });
          return;
        }
      }
      try {
        const result = await addAccompanying({
          hostName: session.hostName,
          hotelId: session.hotelId,
          appKey: session.appKey,
          token: session.token,
          reservationId: target.reservationId,
          confirmationNo: target.confirmationNo,
          mainProfileId: target.guestId,
          existingAccompanyIds: target.accompanyProfileIds || [],
          existingProfileId: existingProfileId || null,
          docData: existingProfileId ? null : f
        });
        setDone(true);
        const resolvedFirst = existingProfileId ? (_c = (_b = (_a = opts.display) == null ? void 0 : _a.firstName) != null ? _b : selectedProfile == null ? void 0 : selectedProfile.firstName) != null ? _c : "" : (f == null ? void 0 : f.firstName) || "";
        const resolvedLast = existingProfileId ? (_f = (_e = (_d = opts.display) == null ? void 0 : _d.lastName) != null ? _e : selectedProfile == null ? void 0 : selectedProfile.lastName) != null ? _f : "" : (f == null ? void 0 : f.lastName) || "";
        setTimeout(() => onDone({ newProfileId: existingProfileId || (result == null ? void 0 : result.newProfileId), firstName: resolvedFirst, lastName: resolvedLast }), 1800);
      } catch (e) {
        setErr(e.message);
        setBusy(false);
      }
    };
    if (step === "scan") {
      return /* @__PURE__ */ React.createElement(
        CameraScan,
        {
          guest: scanGuest,
          onDone: (doc) => {
            setF((prev) => applyNationalityRules({
              ...prev,
              ...doc,
              firstName: (doc == null ? void 0 : doc.firstName) || prev.firstName || sq.firstName || "",
              lastName: (doc == null ? void 0 : doc.lastName) || prev.lastName || sq.lastName || "",
              documentType: (doc == null ? void 0 : doc.documentType) || prev.documentType || "TCKN",
              issuingCountry: toIso2((doc == null ? void 0 : doc.issuingCountry) || prev.issuingCountry)
            }, toIso2((doc == null ? void 0 : doc.nationality) || prev.nationality), doc == null ? void 0 : doc.idNumber));
            setStep("new");
          },
          onBack: () => setStep("search")
        }
      );
    }
    if (done) return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "100dvh", background: S.bg, display: "flex", alignItems: "center", justifyContent: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 60, marginBottom: 16 } }, "\u2705"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 18, fontWeight: 800, color: S.navy } }, t("Beraberindeki Eklendi!"))));
    return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "calc(100dvh - 46px)", background: S.bg } }, /* @__PURE__ */ React.createElement("style", null, GS), dup && /* @__PURE__ */ React.createElement(
      DuplicateDialog,
      {
        matches: dup.matches,
        rule: t("\u0130ki \xF6l\xE7\xFCte bak\u0131l\u0131r: (1) ayn\u0131 kimlik / pasaport numaras\u0131; (2) ayn\u0131 ad + soyad (ilk ad ve soyad ayn\u0131, aksan ve harf b\xFCy\xFCkl\xFC\u011F\xFC fark etmez; do\u011Fum tarihi iki tarafta da varsa ayn\u0131 olmal\u0131). Her kartta e\u015Fle\u015Fen \xF6l\xE7\xFCt yazar."),
        title: t("Sistemde bu ki\u015Fiyle e\u015Fle\u015Fen profil var"),
        note: t("Yeni profil olu\u015Fturmak yerine kay\u0131tl\u0131 profili rezervasyona eklemek ister misiniz? Ayn\u0131 ki\u015Fi i\xE7in ikinci bir profil a\xE7\u0131lmamas\u0131 \xF6nerilir."),
        canUse: true,
        forceLabel: t("Yine de yeni profil olu\u015Ftur"),
        onUse: (m) => {
          setDup(null);
          doAdd(m.id, { display: { firstName: m.firstName, lastName: m.lastName } });
        },
        onForce: () => {
          setDup(null);
          doAdd(null, { skipDup: true });
        },
        onCancel: () => setDup(null)
      }
    ), /* @__PURE__ */ React.createElement(TopBar, { onBack: step === "new" || step === "confirm" ? () => setStep("search") : onBack }), /* @__PURE__ */ React.createElement("div", { style: { background: "linear-gradient(90deg,#1B3C6D,#2A5298)", padding: "12px 18px" } }, /* @__PURE__ */ React.createElement("div", { style: { maxWidth: 700, margin: "0 auto" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 800, color: "#fff" } }, t("Beraberindeki Ekle")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(255,255,255,.5)", marginTop: 2 } }, target.firstName, " ", target.lastName, " - ", target.confirmationNo))), /* @__PURE__ */ React.createElement("div", { style: { maxWidth: 700, margin: "0 auto", padding: "20px 16px", display: "flex", flexDirection: "column", gap: 14 } }, step === "search" && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "card", style: { marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, color: S.navy, fontSize: 15, marginBottom: 14 } }, t("Profil Ara")), /* @__PURE__ */ React.createElement("div", { className: "form-grid", style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 } }, /* @__PURE__ */ React.createElement(Fld, { label: t("Ad"), value: sq.firstName, onChange: (v) => setSq((p) => ({ ...p, firstName: v })) }), /* @__PURE__ */ React.createElement(Fld, { label: t("Soyad"), value: sq.lastName, onChange: (v) => setSq((p) => ({ ...p, lastName: v })) })), /* @__PURE__ */ React.createElement("div", { className: "form-grid", style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-p", onClick: doSearch, disabled: searching, style: { width: "100%", padding: 12, borderRadius: 10, fontSize: 14 } }, searching ? t("Aran\u0131yor\u2026") : t("Profil Ara")), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: openScanNewProfile, style: { width: "100%", padding: 12, borderRadius: 10, fontSize: 14, background: "#fff", border: `1.5px solid ${S.blue}`, color: S.blue, fontWeight: 800, cursor: "pointer" } }, t("Tara ve Yeni Profil Olu\u015Ftur")))), searchResults !== null && /* @__PURE__ */ React.createElement("div", { className: "card" }, searchResults.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "10px 0", color: S.muted, fontSize: 13 } }, t("Sonu\xE7 bulunamad\u0131")), /* @__PURE__ */ React.createElement("div", { className: "form-grid", style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } }, /* @__PURE__ */ React.createElement("button", { type: "button", onClick: openManualNewProfile, style: { width: "100%", padding: "10px", border: "1.5px dashed #4A90D9", borderRadius: 10, background: "transparent", color: S.blue, fontWeight: 700, fontSize: 13, cursor: "pointer" } }, t("+ Yeni Profil Olu\u015Ftur")), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: openScanNewProfile, style: { width: "100%", padding: "10px", border: `1.5px solid ${S.orange}`, borderRadius: 10, background: "#FFF7ED", color: S.orangeDk, fontWeight: 800, fontSize: 13, cursor: "pointer" } }, t("Tara ve Yeni Profil Olu\u015Ftur")))) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, searchResults.map((p, i) => /* @__PURE__ */ React.createElement(
      "div",
      {
        key: i,
        onClick: () => {
          setSelectedProfile(p);
          setStep("confirm");
        },
        style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px 12px", padding: "10px 12px", border: "1.5px solid #E2EAF4", borderRadius: 10, cursor: "pointer", background: "#FAFBFD" }
      },
      /* @__PURE__ */ React.createElement(Avt, { f: p.firstName, l: p.lastName, sz: 36 }),
      /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, color: S.navy, fontSize: 14 } }, p.firstName, " ", p.lastName), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: S.muted, fontFamily: "monospace" } }, "#" + p.id)),
      /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: S.blue, fontWeight: 800, padding: "8px 6px" } }, t("Se\xE7")),
      profileInfo[p.id] ? /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 100%", minWidth: 0 } }, /* @__PURE__ */ React.createElement(ProfileInfoLine, { pd: profileInfo[p.id] })) : i < PROFILE_INFO_MAX && profileInfo[p.id] !== false && /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 100%", fontSize: 12, color: S.muted } }, t("Bilgiler y\xFCkleniyor\u2026"))
    ))), searchResults.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "form-grid", style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 } }, /* @__PURE__ */ React.createElement("button", { onClick: openManualNewProfile, style: { width: "100%", padding: "10px", border: "1.5px dashed #4A90D9", borderRadius: 10, background: "transparent", color: S.blue, fontWeight: 700, fontSize: 13, cursor: "pointer" } }, t("+ Yeni Profil Olu\u015Ftur")), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: openScanNewProfile, style: { width: "100%", padding: "10px", border: `1.5px solid ${S.orange}`, borderRadius: 10, background: "#FFF7ED", color: S.orangeDk, fontWeight: 800, fontSize: 13, cursor: "pointer" } }, t("Tara ve Yeni Profil Olu\u015Ftur")))), err && /* @__PURE__ */ React.createElement("div", { style: { color: S.red, fontSize: 13, textAlign: "center", padding: "8px", background: "#FEE2E2", borderRadius: 8, marginTop: 10 } }, err)), step === "confirm" && selectedProfile && /* @__PURE__ */ React.createElement("div", { className: "card" }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, color: S.navy, fontSize: 15, marginBottom: 14 } }, t("Profil Onay")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 14, padding: "12px", background: S.bg, borderRadius: 10, marginBottom: 14 } }, /* @__PURE__ */ React.createElement(Avt, { f: selectedProfile.firstName, l: selectedProfile.lastName, sz: 46 }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, color: S.navy, fontSize: 16 } }, selectedProfile.firstName, " ", selectedProfile.lastName), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: S.muted, fontFamily: "monospace" } }, "#" + selectedProfile.id))), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13, color: S.muted, marginBottom: 14 } }, t("Bu profili rezervasyona beraberindeki olarak eklemek istiyor musunuz?")), err && /* @__PURE__ */ React.createElement("div", { style: { color: S.red, fontSize: 13, padding: "8px", background: "#FEE2E2", borderRadius: 8, marginBottom: 10 } }, err), /* @__PURE__ */ React.createElement("button", { className: "btn btn-p", onClick: () => doAdd(selectedProfile.id), disabled: busy, style: { width: "100%", padding: 13, fontSize: 14, borderRadius: 10 } }, busy ? "Ekleniyor..." : t("Rezervasyona Ekle"))), step === "new" && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "card form-card", style: { marginBottom: 18 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, paddingBottom: 12, marginBottom: 12, borderBottom: `1px solid ${S.border}` } }, /* @__PURE__ */ React.createElement("div", { style: { width: 30, height: 30, borderRadius: 8, background: `linear-gradient(135deg,${S.blue},${S.navy})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 } }, "\u{1F464}"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 15, fontWeight: 800, color: S.navy, fontFamily: "'Nunito',sans-serif" } }, t("Yeni Profil \xB7 Ki\u015Fisel Bilgiler")), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: openScanNewProfile, style: { marginLeft: "auto", background: "#FFF7ED", border: `1px solid ${S.orange}55`, color: S.orangeDk, borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 800, cursor: "pointer" } }, t("MRZ Tara"))), /* @__PURE__ */ React.createElement("div", { className: "form-grid", style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } }, /* @__PURE__ */ React.createElement(Fld, { label: t("Ad"), value: f.firstName, onChange: set("firstName"), required: personalRequired }), /* @__PURE__ */ React.createElement(Fld, { label: t("\u0130kinci Ad"), value: f.middleName, onChange: set("middleName") }), /* @__PURE__ */ React.createElement("div", { style: { gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement(Fld, { label: t("Soyad"), value: f.lastName, onChange: set("lastName"), required: personalRequired })), /* @__PURE__ */ React.createElement(DateInput, { label: t("Do\u011Fum Tarihi"), value: f.dateOfBirth, onChange: set("dateOfBirth"), required: personalRequired, onInvalid: setDateBad }), /* @__PURE__ */ React.createElement(Fld, { label: t("Cinsiyet"), value: f.gender, onChange: set("gender"), required: personalRequired, opts: [{ v: "M", l: t("Erkek (M)") }, { v: "F", l: t("Kad\u0131n (F)") }, { v: "X", l: t("Belirtilmemi\u015F") }] }), /* @__PURE__ */ React.createElement("div", { style: { gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement(Fld, { label: t("Do\u011Fum Yeri"), value: f.birthPlace, onChange: set("birthPlace"), required: birthPlaceRequired })), /* @__PURE__ */ React.createElement(Fld, { label: t("Uyruk"), value: f.nationality, onChange: set("nationality"), required: true, opts: nationalityOpts }), /* @__PURE__ */ React.createElement(Fld, { label: t("Belge Tipi"), value: f.documentType, onChange: set("documentType"), required: true, opts: docTypeOpts }), /* @__PURE__ */ React.createElement("div", { style: { gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement(Fld, { label: t("Belge Numaras\u0131"), value: f.documentNumber, onChange: set("documentNumber"), required: true })))), err && /* @__PURE__ */ React.createElement("div", { style: { color: S.red, fontSize: 13, padding: "8px", background: "#FEE2E2", borderRadius: 8, marginBottom: 10 } }, err), /* @__PURE__ */ React.createElement("button", { className: "btn btn-p", onClick: () => doAdd(null), disabled: busy, style: { width: "100%", padding: 16, fontSize: 15, borderRadius: 12 } }, busy ? "Kaydediliyor..." : t("Rezervasyona Ekle")))));
  }
  let serverCsrf = "";
  async function fetchServerSession() {
    var _a;
    const res = await fetch(`${PROXY}/api/me`, { cache: "no-store" });
    if (res.status === 401) {
      if (!document.getElementById("passive-notice")) window.location.href = "/login";
      return null;
    }
    if (!res.ok) throw new Error(t("Oturum bilgisi al\u0131namad\u0131 (HTTP {durum})", { durum: res.status }));
    const me = await res.json();
    serverCsrf = me.csrf || "";
    if (!me.hotel) {
      window.location.href = ((_a = me.user) == null ? void 0 : _a.role) === "admin" ? "/admin" : "/login";
      return null;
    }
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
      canMerge: !!(me.user && me.user.canMerge),
      canChangeMain: !!(me.user && me.user.canChangeMain),
      canChangeAccompany: !!(me.user && me.user.canChangeAccompany),
      hotelAdmin: !!(me.user && me.user.hotelAdmin),
      ohipEnv: me.hotel.ohipEnv === "customer" ? "customer" : me.hotel.ohipEnv === "partner" ? "partner" : "",
      csrf: me.csrf
    };
  }
  function App() {
    const runtimeRef = React.useRef(loadRuntimeState());
    const initialRuntime = runtimeRef.current || {};
    const [screen, setScreen] = useState(() => (initialRuntime == null ? void 0 : initialRuntime.session) ? initialRuntime.screen || "search" : "loading");
    const [session, setSession] = useState(null);
    const [bootError, setBootError] = useState("");
    const [guest, setGuest] = useState(() => (initialRuntime == null ? void 0 : initialRuntime.guest) || null);
    const [scan, setScan] = useState(() => (initialRuntime == null ? void 0 : initialRuntime.scan) || null);
    const [manualEdit, setManualEdit] = useState(false);
    const [accompanyTarget, setAccompanyTarget] = useState(() => (initialRuntime == null ? void 0 : initialRuntime.accompanyTarget) || null);
    const searchRefreshRef = React.useRef(null);
    const reloadProfileRef = React.useRef(null);
    const [, setLangTick] = React.useState(0);
    React.useEffect(() => {
      const h = () => setLangTick((n) => n + 1);
      window.addEventListener("sp-lang", h);
      return () => window.removeEventListener("sp-lang", h);
    }, []);
    const [stale, setStale] = React.useState(false);
    React.useEffect(() => {
      const mine = window.__SP_VERSION;
      if (!mine) return;
      let stop = false;
      const check = async () => {
        try {
          const r = await fetch(`${PROXY}/api/version`, { cache: "no-store" });
          if (!r.ok) return;
          const d = await r.json();
          if (!stop && d.v && d.v !== mine) setStale(true);
        } catch (_) {
        }
      };
      const onVis = () => {
        if (document.visibilityState === "visible") check();
      };
      document.addEventListener("visibilitychange", onVis);
      const timer = setInterval(check, 5 * 60 * 1e3);
      check();
      return () => {
        stop = true;
        document.removeEventListener("visibilitychange", onVis);
        clearInterval(timer);
      };
    }, []);
    const backToCleanSearch = () => {
      setScreen("search");
      setTimeout(() => {
        searchRefreshRef.current && searchRefreshRef.current();
      }, 100);
    };
    const backToSearch = (reloadGuestId, confNo) => {
      setScreen("search");
      if (reloadGuestId) setTimeout(() => {
        reloadProfileRef.current && reloadProfileRef.current(reloadGuestId, confNo).catch(() => {
        });
      }, 400);
    };
    React.useEffect(() => {
      let cancelled = false;
      fetchServerSession().then((s) => {
        if (cancelled || !s) return;
        setSession(s);
        setScreen((prev) => prev === "loading" ? "search" : prev);
      }).catch((err) => {
        if (!cancelled) setBootError(getSafeErrorMessage(err));
      });
      const timer = setInterval(async () => {
        try {
          const token = await operaGetToken();
          setSession((prev) => prev ? { ...prev, token } : prev);
        } catch (err) {
          console.error("[AUTH] token refresh failed:", err);
        }
      }, 40 * 60 * 1e3);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }, []);
    React.useEffect(() => {
      if (!session) return;
      saveRuntimeState({ screen, guest, scan, accompanyTarget, session: { userId: session.userId } });
    }, [screen, session, guest, scan, accompanyTarget]);
    React.useEffect(() => {
      if (!session) return;
      if (screen === "scan" && !guest) setScreen("search");
      if (screen === "form" && (!guest || !scan)) setScreen("search");
      if (screen === "accompany" && !accompanyTarget) setScreen("search");
    }, [screen, session, guest, scan, accompanyTarget]);
    const goLogin = async () => {
      clearRuntimeState();
      try {
        await fetch(`${PROXY}/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ csrf: serverCsrf }).toString()
        });
      } catch (_) {
      }
      window.location.href = "/login";
    };
    if (!session) {
      return /* @__PURE__ */ React.createElement("div", { className: "boot", style: { flexDirection: "column", gap: 14, textAlign: "center", padding: 20 } }, /* @__PURE__ */ React.createElement("div", null, bootError ? t("Hata: {mesaj}", { mesaj: bootError }) : t("SnapPass y\xFCkleniyor\u2026")), bootError && /* @__PURE__ */ React.createElement("button", { onClick: goLogin, style: { background: "#fff", border: "1px solid #C9D6E8", color: "#1B3C6D", borderRadius: 10, padding: "9px 16px", fontWeight: 800, cursor: "pointer" } }, t("\xC7\u0131k\u0131\u015F")));
    }
    return /* @__PURE__ */ React.createElement(React.Fragment, null, stale && /* @__PURE__ */ React.createElement("div", { role: "alert", style: { position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 3e3, background: S.navy, color: "#fff", padding: "12px 16px calc(12px + env(safe-area-inset-bottom))", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 -6px 24px rgba(0,0,0,.3)" } }, /* @__PURE__ */ React.createElement("span", { style: { flex: 1, fontSize: 14, fontWeight: 700 } }, t("Uygulaman\u0131n yeni s\xFCr\xFCm\xFC var. Yenileyin.")), /* @__PURE__ */ React.createElement("button", { className: "btn btn-p", onClick: () => window.location.reload(), style: { minHeight: 44, padding: "8px 18px" } }, t("Yenile"))), /* @__PURE__ */ React.createElement("div", { style: { display: screen === "search" ? "block" : "none" } }, /* @__PURE__ */ React.createElement(
      Search,
      {
        session,
        onSelect: (g, pd) => {
          setManualEdit(false);
          setScan(null);
          setGuest({ ...g, profileDetails: pd });
          setScreen("scan");
        },
        onEdit: (g, pd) => {
          setManualEdit(true);
          setScan({});
          setGuest({ ...g, profileDetails: pd });
          setScreen("form");
        },
        onAddAccompany: (g) => {
          setAccompanyTarget(g);
          setScreen("accompany");
        },
        onLogout: goLogin,
        onConfig: isAdminUser(session) ? () => {
          window.location.href = "/admin";
        } : null,
        refreshRef: searchRefreshRef,
        reloadProfileRef
      }
    )), screen === "accompany" && accompanyTarget && /* @__PURE__ */ React.createElement(AccompanyForm, { target: accompanyTarget, session, onBack: () => setScreen("search"), onDone: (newInfo) => {
      const tgt = accompanyTarget;
      setAccompanyTarget(null);
      setScreen("search");
      if (searchRefreshRef.current) setTimeout(() => searchRefreshRef.current(tgt == null ? void 0 : tgt.confirmationNo, tgt, newInfo), 200);
    } }), screen === "scan" && guest && /* @__PURE__ */ React.createElement(CameraScan, { guest, session, onDone: (d) => {
      setScan(d);
      setScreen("form");
    }, onBack: backToCleanSearch, onLogout: goLogin }), screen === "form" && guest && scan && /* @__PURE__ */ React.createElement(DocForm, { guest, scan, session, manual: manualEdit, onSubmit: () => {
      setGuest(null);
      setScan(null);
      setManualEdit(false);
      setScreen("search");
      setTimeout(() => {
        searchRefreshRef.current && searchRefreshRef.current();
      }, 100);
    }, onBack: () => {
      if (manualEdit) backToCleanSearch();
      else setScreen("scan");
    }, onLogout: goLogin }), session && screen !== "scan" && /* @__PURE__ */ React.createElement("footer", { className: "app-footer" }, "\xA9 ", t("B\xFCt\xFCn haklar\u0131 sakl\u0131d\u0131r."), " PROTEL Bilgisayar A.\u015E."));
  }
  ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ React.createElement(App, null));
})();
