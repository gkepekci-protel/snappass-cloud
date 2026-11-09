/* ─── PostgreSQL ───────────────────────────────────────────────────────────
   Bağlantı: SNAPPASS_DATABASE_URL (varsayılan postgresql://snappass_app@127.0.0.1:5432/snappass_cloud)
   Tablolar başlangıçta yoksa oluşturulur.
── */
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.SNAPPASS_DATABASE_URL || "postgresql://snappass_app@127.0.0.1:5432/snappass_cloud",
  max: 10,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS hotels (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  chain_name  TEXT NOT NULL DEFAULT '',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  ohip_enc    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chains (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  chain_code  TEXT NOT NULL DEFAULT '',
  ohip_enc    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS chain_id BIGINT REFERENCES chains(id) ON DELETE RESTRICT;
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS hotel_code TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS users (
  id             BIGSERIAL PRIMARY KEY,
  username       TEXT NOT NULL,
  full_name      TEXT NOT NULL DEFAULT '',
  email          TEXT,
  role           TEXT NOT NULL CHECK (role IN ('admin','hotel')),
  hotel_id       BIGINT REFERENCES hotels(id) ON DELETE CASCADE,
  password_hash  TEXT,
  google_sub     TEXT,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  must_change    BOOLEAN NOT NULL DEFAULT FALSE,
  failed_logins  INTEGER NOT NULL DEFAULT 0,
  locked_until   TIMESTAMPTZ,
  last_login     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS two_factor BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scope TEXT NOT NULL,
  hotel_id INTEGER,
  user_id INTEGER,
  username TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_log_scope_at ON audit_log (scope, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_hotel_at ON audit_log (hotel_id, at DESC);
-- Profil işlemleri yetkileri (varsayılan kapalı; Protel yöneticisi verir): OPERA profillerini birleştirme, rezervasyonun ana profilini değiştirme, beraberindeki değiştirme
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_merge BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_change_main BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_change_accompany BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hotel_admin BOOLEAN NOT NULL DEFAULT FALSE;
-- Zincir (Chain): birden fazla oteli olan Enterprise. Zincir değilse OHIP tanımı otel ekranında düzenlenir, Enterprise ekranı gösterilmez.
ALTER TABLE chains ADD COLUMN IF NOT EXISTS is_chain BOOLEAN;
CREATE TABLE IF NOT EXISTS ohip_calls (
  day         DATE NOT NULL,
  hotel_code  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  n           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, hotel_code, kind)
);
CREATE TABLE IF NOT EXISTS alerts (
  id          BIGSERIAL PRIMARY KEY,
  hotel_code  TEXT NOT NULL,
  source      TEXT NOT NULL,
  code        TEXT NOT NULL,
  message     TEXT NOT NULL DEFAULT '',
  n           INTEGER NOT NULL DEFAULT 1,
  first_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS alerts_hotel_idx ON alerts(hotel_code, resolved_at);
CREATE TABLE IF NOT EXISTS alert_seen (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_id    BIGINT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, alert_id)
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_mode TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enc TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step BIGINT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS invites (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_by  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS password_resets (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash  TEXT PRIMARY KEY,
  verifier    TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS login_pins (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trusted_devices (
  token_hash  TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT
);
`;

const query = (text, params) => pool.query(text, params);
const one   = async (text, params) => (await pool.query(text, params)).rows[0] || null;
const all   = async (text, params) => (await pool.query(text, params)).rows;

async function getSetting(key) {
  const row = await one("SELECT value FROM settings WHERE key=$1", [key]);
  return row ? row.value : null;
}

async function setSetting(key, value) {
  await query(
    "INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
    [key, value]
  );
}

// Eski kayıt: OHIP tanımı otelde ise zincire taşınır (OHIP zincir için ortak, otelde yalnız HotelId kalır)
async function migrateHotelOhip() {
  const { decryptJson, encryptJson } = require("./security");
  const rows = await all("SELECT * FROM hotels WHERE chain_id IS NULL AND ohip_enc IS NOT NULL");
  for (const h of rows) {
    const { hotel_code = "", ...chainOhip } = decryptJson(h.ohip_enc, {});
    const chain = await one("INSERT INTO chains(name,ohip_enc) VALUES($1,$2) RETURNING id", [h.chain_name || "", encryptJson(chainOhip)]);
    await query("UPDATE hotels SET chain_id=$2, hotel_code=$3, ohip_enc=NULL WHERE id=$1", [h.id, chain.id, String(hotel_code).toUpperCase()]);
    console.log(`[DB] ${h.name}: OHIP tanımı zincire taşındı (zincir #${chain.id})`);
  }
}

// İlk yönetici: hiç admin yoksa SNAPPASS_ADMIN_EMAIL ile (Google girişinde e-postayla eşleşir)
async function init() {
  await pool.query(SCHEMA);
  await migrateHotelOhip();
  // İki adımlı doğrulama genel ayardan otel bazına taşındı: genel ayar açıksa bir kez tüm otellerde açılır
  if ((await getSetting("two_factor")) === "1" && (await getSetting("two_factor_per_hotel")) !== "1") {
    await query("UPDATE hotels SET two_factor=TRUE");
    console.log("[DB] İki adımlı doğrulama tüm otellerde açıldı (genel ayardan taşındı)");
  }
  await setSetting("two_factor_per_hotel", "1");
  await query("UPDATE chains c SET is_chain = ((SELECT count(*) FROM hotels h WHERE h.chain_id=c.id) > 1) WHERE is_chain IS NULL");
  await query("UPDATE users SET two_factor_mode=NULL WHERE two_factor_mode='email'"); // e-posta kodu artık varsayılan yöntem
  const email = (process.env.SNAPPASS_ADMIN_EMAIL || "").trim().toLowerCase();
  const admin = await one("SELECT id FROM users WHERE role='admin' LIMIT 1");
  if (!admin && email) {
    await query("INSERT INTO users(username,email,role) VALUES($1,$1,'admin')", [email]);
    console.log(`[DB] İlk yönetici eklendi: ${email}`);
  }
}

module.exports = { pool, query, one, all, getSetting, setSetting, init };
