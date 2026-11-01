/* ─── OHIP ─────────────────────────────────────────────────────────────────
   OHIP tanımı zincir için ortaktır: { host, app_key, client_id, client_secret, enterprise_id, scope }.
   Otel yalnız HotelId (hotel_code) taşır. Token isteği TGA engine/ohip.py ile aynıdır (client_credentials).
   Enterprise Configuration API (/ent/config/v1): zincir adı, zincirin otelleri ve otel adı.
── */
const crypto = require("crypto");

const DEFAULT_SCOPE = "urn:opc:hgbu:ws:__myscopes__";
const REQUIRED = { host: "Host", app_key: "App Key", client_id: "Client ID", client_secret: "Client Secret", enterprise_id: "Enterprise ID" };

const missingFields = (cfg) => Object.entries(REQUIRED).filter(([k]) => !String(cfg?.[k] || "").trim()).map(([, label]) => label);
const hostOf = (cfg) => String(cfg.host || "").trim().replace(/\/+$/, "");

async function call(url, init, host) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(60000) }).catch(err => {
    throw new Error(`OHIP sunucusuna bağlanılamadı (${host}): ${err.cause?.code || err.cause?.message || err.message}`);
  });
}

async function getToken(cfg) {
  const host = hostOf(cfg);
  const basic = Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString("base64");
  const res = await call(`${host}/oauth/v1/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-app-key": cfg.app_key,
      "Authorization": `Basic ${basic}`,
      "X-Request-Id": crypto.randomUUID(),
      "enterpriseId": cfg.enterprise_id,
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: cfg.scope || DEFAULT_SCOPE }).toString(),
  }, host);
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || data.title || data.detail || data.raw || "";
    const wait = /unsupported client id/i.test(detail) ? " — Not: Yeni oluşturulan App Key / Client ID'nin etkinleşmesi 1 ile 24 saat arasında sürebilir; bilgiler doğruysa bir süre sonra yeniden deneyin." : "";
    throw new Error(`OHIP token alınamadı (HTTP ${res.status})${detail ? ": " + detail : ""}${wait}`);
  }
  return { token: data.access_token, expiresIn: Number(data.expires_in) || 3600 };
}

// Enterprise Configuration API isteği; hotelCode verilirse x-hotelId olarak gider
async function entConfig(cfg, token, path, hotelCode, what) {
  const host = hostOf(cfg);
  const headers = {
    "Authorization": `Bearer ${token}`,
    "x-app-key": cfg.app_key,
    "X-Request-Id": crypto.randomUUID(),
    "Accept": "application/json",
  };
  if (hotelCode) headers["x-hotelId"] = hotelCode;
  const res = await call(`${host}/ent/config/v1${path}`, { headers }, host);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.detail || data.title || data["o:errorDetails"]?.[0]?.title || "";
    throw new Error(`${what} alınamadı (HTTP ${res.status})${detail ? ": " + detail : ""}`);
  }
  return data;
}

// GET /chain → ilk zincirin adı ve kodu
async function getChainInfo(cfg, token, hotelCode) {
  const data = await entConfig(cfg, token, "/chain", hotelCode, "Zincir bilgisi");
  const chain = (data.chains || [])[0] || {};
  return { name: String(chain.chainName || "").trim(), code: String(chain.chainCode || "").trim() };
}

// GET /hotels → zincirdeki oteller
async function getHotels(cfg, token, hotelCode) {
  const data = await entConfig(cfg, token, "/hotels", hotelCode, "Otel listesi");
  return (data.hotelSummaryInfoList || [])
    .map(h => ({ hotelId: String(h.hotelId || "").trim().toUpperCase(), name: String(h.hotelName || "").trim(), chainCode: h.chainCode || "", inactive: !!h.inactiveDate }))
    .filter(h => h.hotelId)
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

// GET /hotels/{hotelId} → hotelConfigInfo.hotelName / chainName
async function getHotelInfo(cfg, token, hotelCode) {
  const data = await entConfig(cfg, token, `/hotels/${encodeURIComponent(hotelCode)}`, hotelCode, "Otel bilgisi");
  const info = data.hotelConfigInfo || {};
  return { name: String(info.hotelName || "").trim(), chainName: String(info.chainName || "").trim() };
}

module.exports = { getToken, getChainInfo, getHotels, getHotelInfo, missingFields, DEFAULT_SCOPE };
