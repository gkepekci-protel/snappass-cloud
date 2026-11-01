/* ─── Google ile Protel yönetici girişi (OpenID Connect + PKCE) ───────────
   TGA google_sso.py karşılığı. Ortam değişkenleri:
     GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI (ops.),
     SSO_ALLOWED_DOMAINS (virgülle, varsayılan protel.com.tr)
   SNAPPASS_GOOGLE_CLIENT_ID / _SECRET verilirse onlar önceliklidir.
── */
const crypto = require("crypto");

const DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration";
const CACHE_MS = 60 * 60 * 1000;
let discoveryCache = null, jwksCache = null;

function config() {
  return {
    clientId: process.env.SNAPPASS_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.SNAPPASS_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: process.env.SNAPPASS_GOOGLE_REDIRECT_URI || "",
    domains: (process.env.SSO_ALLOWED_DOMAINS || "protel.com.tr").split(",").map(d => d.trim().toLowerCase()).filter(Boolean),
  };
}

const enabled = () => { const c = config(); return !!(c.clientId && c.clientSecret); };

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Google isteği başarısız (HTTP ${res.status})`);
  return res.json();
}

async function discovery() {
  if (!discoveryCache || Date.now() - discoveryCache.at > CACHE_MS) discoveryCache = { at: Date.now(), doc: await getJson(DISCOVERY_URL) };
  return discoveryCache.doc;
}

async function jwks(force = false) {
  if (force || !jwksCache || Date.now() - jwksCache.at > CACHE_MS) jwksCache = { at: Date.now(), keys: (await getJson((await discovery()).jwks_uri)).keys || [] };
  return jwksCache.keys;
}

function newPkce() {
  const state = crypto.randomBytes(32).toString("base64url");
  const verifier = crypto.randomBytes(64).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { state, verifier, challenge };
}

async function authUrl({ state, challenge, redirectUri }) {
  const c = config();
  const params = new URLSearchParams({
    client_id: c.clientId, redirect_uri: redirectUri, response_type: "code",
    scope: "openid email profile", state, code_challenge: challenge,
    code_challenge_method: "S256", prompt: "select_account",
  });
  // Tek alan adı varsa Google'a ipucu; asıl kontrol dönüşte yapılır
  if (c.domains.length === 1) params.set("hd", c.domains[0]);
  return `${(await discovery()).authorization_endpoint}?${params}`;
}

async function exchangeCode({ code, verifier, redirectUri }) {
  const c = config();
  const res = await fetch((await discovery()).token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, code_verifier: verifier,
      client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri,
    }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id_token) throw new Error(`Google token alınamadı: ${data.error_description || data.error || res.status}`);
  return data.id_token;
}

async function verifyIdToken(idToken) {
  const [h, p, s] = String(idToken).split(".");
  const header = JSON.parse(Buffer.from(h, "base64url").toString());
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  if (header.alg !== "RS256") throw new Error("Beklenmeyen imza algoritması");
  let jwk = (await jwks()).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await jwks(true)).find(k => k.kid === header.kid);
  if (!jwk) throw new Error("İmza anahtarı bulunamadı");
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(s, "base64url"));
  if (!ok) throw new Error("id_token imzası geçersiz");
  const now = Math.floor(Date.now() / 1000);
  if (!["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)) throw new Error("Geçersiz iss");
  if (claims.aud !== config().clientId) throw new Error("Geçersiz aud");
  if (!claims.exp || claims.exp + 120 < now) throw new Error("id_token süresi dolmuş");
  if (!claims.sub) throw new Error("sub yok");
  if (claims.email_verified === false) throw new Error("E-posta doğrulanmamış");
  return claims;
}

const allowedEmail = (email) => config().domains.includes(String(email || "").split("@").pop().toLowerCase());

module.exports = { config, enabled, newPkce, authUrl, exchangeCode, verifyIdToken, allowedEmail };
