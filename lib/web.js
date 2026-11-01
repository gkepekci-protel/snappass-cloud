/* ─── Giriş, davetiye, iki adımlı doğrulama ve Protel yönetim ekranları ───
   TGA web.py akışlarının Express karşılığı:
     /login, /login/pin            otel kullanıcısı: parola + e-posta kodu (2FA)
     /auth/google/*, /auth/totp    Protel yöneticisi: Google hesabı (@protel.com.tr) + Authenticator kodu
     /invite/:token                davetiyeyle parola belirleme
     /admin, /admin/hotels/:id     oteller, OHIP tanımları, kullanıcılar, SMTP, 2FA
     /api/me, /api/opera/token     tarama uygulaması (SPA) için oturum ve OHIP token
── */
const express = require("express");
const path    = require("path");
const crypto  = require("crypto");
const db      = require("./db");
const sec     = require("./security");
const google  = require("./google");
const totp    = require("./totp");
const mailer  = require("./mailer");
const ohip    = require("./ohip");
const ocr     = require("./ocr");
const alerts  = require("./alerts");
const views   = require("./views");
const i18nSrv = require("./i18n-server");

const router = express.Router();

const COOKIE        = "sp_sess";
const DEVICE_COOKIE = "sp_device";
const deviceCookieName = (uid) => `${DEVICE_COOKIE}_${uid}`; // her kullanıcının kendi cihaz çerezi
const LANG_COOKIE   = "sp_lang";
const SESSION_HOURS = 8;
const INVITE_DAYS   = 7;
const PIN_MINUTES   = 10;
const PIN_ATTEMPTS  = 5;
const DEVICE_DAYS   = 15;
const MAX_FAILED    = 5;
const LOCK_MINUTES  = 15;
const TOTP_MINUTES  = 10;
const HTTPS         = process.env.SNAPPASS_HTTPS === "1";
const DEFAULT_APP_URL = "https://snappass.protel.com.tr";
const INDEX_HTML    = path.join(__dirname, "..", "public", "index.html");

/* ── Çerez ve oturum ── */
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, name, value, { maxAge, sameSite = "Lax" } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", `SameSite=${sameSite}`];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  if (HTTPS) parts.push("Secure");
  const prev = res.getHeader("Set-Cookie") || [];
  res.setHeader("Set-Cookie", [...(Array.isArray(prev) ? prev : [prev]).filter(c => !c.startsWith(name + "=")), parts.join("; ")]);
}

router.use(express.urlencoded({ extended: false, limit: "64kb" }));

router.use((req, res, next) => {
  req.cookies = parseCookies(req);
  const data = sec.readSession(req.cookies[COOKIE]);
  req.session = data && data.exp > Date.now() ? data : {};
  if (!req.session.csrf) req.session.csrf = sec.newToken();
  res.saveSession = () => {
    req.session.exp = Date.now() + SESSION_HOURS * 3600 * 1000;
    setCookie(res, COOKIE, sec.signSession(req.session), { maxAge: SESSION_HOURS * 3600 });
  };
  res.flash = (kind, msg) => { (req.session.flash = req.session.flash || []).push([kind, msg]); };
  res.go = (url) => { res.saveSession(); res.redirect(303, url); };
  res.page = (title, body) => {
    const flash = req.session.flash || [];
    delete req.session.flash;
    res.saveSession();
    res.set("X-Frame-Options", "DENY").set("Referrer-Policy", "same-origin").set("X-Content-Type-Options", "nosniff");
    // Dil: yalnız otel kullanıcısına dönük sayfalar çevrilir ve dil düğmesi gösterilir (Protel yönetim ekranları Türkçe)
    const admin = (req.user && req.user.role === "admin") || /^\/(admin|otel)(\/|$)/.test(req.path); // otel yöneticisinin yönetim sayfaları da Türkçe
    const lang = admin ? "tr" : (req.lang || "tr");
    const next = req.method === "GET" ? req.originalUrl : "/login";
    let html = views.layout({ title: lang === "en" ? (i18nSrv.lookup(title) ?? title) : title, body, user: req.user, csrf: req.session.csrf, flash, lang, showLang: !admin, next });
    if (lang === "en") html = i18nSrv.translateHtml(html);
    res.send(html);
  };
  next();
});

/* ── Dil: çerez sp_lang (kullanıcı seçimi; tarama uygulaması da aynı çerezi okur) → yoksa kurulumdaki varsayılan dil ── */
router.use(async (req, res, next) => {
  const c = req.cookies[LANG_COOKIE];
  try { req.lang = (c === "en" || c === "tr") ? c : await defaultLang(); } catch (_) { req.lang = "tr"; }
  next();
});

router.get("/lang/:code", (req, res) => {
  const code = req.params.code === "en" ? "en" : "tr";
  res.append("Set-Cookie", `${LANG_COOKIE}=${code}; Path=/; Max-Age=31536000; SameSite=Lax${HTTPS ? "; Secure" : ""}`);
  const next = String(req.query.next || "/");
  res.redirect(303, next.startsWith("/") && !next.startsWith("//") ? next : "/");
});

/* ── Oturumdaki kullanıcı ── */
router.use(async (req, res, next) => {
  req.user = null;
  if (!req.session.uid) return next();
  try {
    const u = await db.one(
      `SELECT u.*, h.name AS hotel_name, h.active AS hotel_active, h.two_factor AS hotel_two_factor
         FROM users u LEFT JOIN hotels h ON h.id = u.hotel_id WHERE u.id=$1`, [req.session.uid]);
    if (u && u.active && (u.role === "admin" || u.hotel_active)) req.user = u;
    else {
      delete req.session.uid;
      // Otel ya da hesap pasife alındıysa sessizce atmak yerine nedeni bildir (giriş sayfasında ve tarama uygulamasında)
      if (u) {
        req.passiveMsg = u.active ? `${u.hotel_name || "Otel"} pasife alındı; erişim kapalı. Protel destek ekibiyle görüşün.` : "Hesabınız pasife alındı. Protel destek ekibiyle görüşün.";
        res.flash("error", req.passiveMsg);
      }
    }
    next();
  } catch (e) { next(e); }
});

/* ── İşlem logu: tanımlı uçlar başarıyla bitince kaydedilir (lib/audit.js) ── */
const audit = require("./audit");
router.use(audit.middleware((req) => scanHotelId(req)));

const checkCsrf = (req, res, next) =>
  sec.safeEqual(req.body?.csrf, req.session.csrf) ? next() : res.status(400).send("Geçersiz form (CSRF). Sayfayı yenileyip tekrar deneyin.");

function requireUser(req, res, next) {
  if (!req.user) return res.go("/login");
  if (req.user.must_change && req.path !== "/account/password" && req.path !== "/logout") return res.go("/account/password");
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.go("/login");
  if (req.user.role !== "admin") return res.status(403).send("Bu sayfa yalnız Protel yöneticileri içindir.");
  next();
}

/* ── Otel yöneticisi (users.hotel_admin): yalnız Protel yöneticisi verir. Yalnız KENDİ OTELİNİN sayfasını ve kullanıcı / otel tanımı işlemlerini yapar;
   Ayarlar, Enterprise, OHIP tanımı yazma, otel ekleme-silme-pasife alma, KBS tipi / durdurma ve diğer oteller Protel'e özeldir.
   Otelde iki adımlı doğrulama AÇIKSA her oturumda e-posta kodu ya da Authenticator ile ikinci doğrulama şarttır (/otel); doğrulama kayan HA_MINUTES dakika geçerlidir. Kapalıysa istenmez. ── */
const HA_MINUTES = 30;
// İkinci doğrulama otelin "iki adımlı doğrulama" ayarına bağlıdır: otelde kapalıysa otel yöneticisi ekranı doğrulamasız açılır, açıksa her oturumda sorulur
const haNeedsVerify = (req) => process.env.SNAPPASS_2FA_OFF !== "1" && !!req.user?.hotel_two_factor;
const haVerified = (req) => !haNeedsVerify(req) || (req.session.ha_until || 0) > Date.now();
async function staffOwn(req, res, next) {
  if (!req.user) return res.go("/login");
  if (req.user.role === "admin") return next();
  if (req.user.role !== "hotel" || !req.user.hotel_admin) return res.status(403).send("Bu sayfa yalnız Protel yöneticileri içindir.");
  if (!haVerified(req)) return res.go("/otel");
  try {
    if (req.path.startsWith("/admin/users/")) {
      const t = await db.one("SELECT id, hotel_id, role FROM users WHERE id=$1", [Number(req.params.id) || 0]);
      if (!t || t.role !== "hotel" || String(t.hotel_id) !== String(req.user.hotel_id)) return res.status(403).send("Bu kullanıcı otelinize ait değil.");
      // Otel yöneticisi kendi ve diğer otel yöneticilerinin hesaplarını da düzenleyebilir; yalnız "Otel yöneticisi" yetkisini veremez / alamaz / göremez (Protel)
    } else if (String(req.params.id) !== String(req.user.hotel_id)) {
      return res.status(403).send("Bu otele erişiminiz yok.");
    }
    req.session.ha_until = Date.now() + HA_MINUTES * 60000;
    next();
  } catch (e) { next(e); }
}

async function appUrl(req) {
  return ((await db.getSetting("app_url")) || process.env.SNAPPASS_APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
}

const maskEmail = (email) => {
  const [name, domain] = String(email || "").split("@");
  return name && domain ? `${name.slice(0, 2)}${"*".repeat(Math.max(1, name.length - 2))}@${domain}` : "";
};

async function finishLogin(req, res, user) {
  await db.query("UPDATE users SET failed_logins=0, locked_until=NULL, last_login=now() WHERE id=$1", [user.id]);
  audit.log({ scope: user.role === "admin" ? "admin" : "user", hotelId: user.hotel_id || null, user, action: "Giriş yapıldı", ip: req.ip });
  req.session = { uid: user.id, csrf: sec.newToken(), flash: req.session.flash };
  if (user.must_change) return res.go("/account/password");
  res.go(user.role === "admin" ? "/admin" : "/");
}

/* ── Giriş sayfası (otel kullanıcıları) ── */
router.get("/login", (req, res) => {
  if (req.user) return res.go(req.user.role === "admin" ? "/admin" : "/");
  const g = google.config();
  res.page("Giriş", views.loginPage({ csrf: req.session.csrf, sso: google.enabled(), domains: g.domains }));
});

router.post("/login", checkCsrf, async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const u = await db.one(
      `SELECT u.*, h.active AS hotel_active, h.two_factor AS hotel_two_factor FROM users u LEFT JOIN hotels h ON h.id=u.hotel_id
        WHERE lower(u.username)=lower($1) AND u.role='hotel'`, [username]);
    const fail = (msg) => { res.flash("error", msg); res.go("/login"); };
    if (!u || !u.password_hash) return fail("Kullanıcı adı veya parola hatalı.");
    if (u.locked_until && new Date(u.locked_until) > new Date()) return fail(`Çok fazla hatalı deneme. ${LOCK_MINUTES} dakika sonra tekrar deneyin.`);
    if (!sec.verifyPassword(password, u.password_hash)) {
      const failed = u.failed_logins + 1;
      if (failed >= MAX_FAILED) {
        await db.query("UPDATE users SET failed_logins=0, locked_until=now() + make_interval(mins => $2::int) WHERE id=$1", [u.id, LOCK_MINUTES]);
        return fail(`Çok fazla hatalı deneme. Hesap ${LOCK_MINUTES} dakika kilitlendi.`);
      }
      await db.query("UPDATE users SET failed_logins=$2 WHERE id=$1", [u.id, failed]);
      return fail("Kullanıcı adı veya parola hatalı.");
    }
    if (!u.active || !u.hotel_active) return fail("Hesabınız ya da oteliniz pasif. Protel destek ekibiyle görüşün.");

    // Yöntem: kullanıcıya özel (email | totp) ya da otel ayarı (otelde açıksa e-posta kodu). Kullanıcı bazında kapatma yoktur.
    // İki adımlı doğrulama otel ayarıdır: kapalıysa herkes yalnız parolayla girer; açıksa kullanıcının yöntemi (e-posta kodu ya da Authenticator)
    const method = u.two_factor_mode === "totp" ? "totp" : "email";
    if (process.env.SNAPPASS_2FA_OFF !== "1" && u.hotel_two_factor) {
      const device = req.cookies[deviceCookieName(u.id)] || req.cookies[DEVICE_COOKIE];
      const trusted = device && await db.one(
        "SELECT 1 FROM trusted_devices WHERE token_hash=$1 AND user_id=$2 AND expires_at > now()", [sec.sha256Hex(device), u.id]);
      if (!trusted) {
        if (method === "totp") {
          // Authenticator (Google/Microsoft Authenticator vb.): kurulu değilse önce QR ile kurulum
          req.session = { totp_uid: u.id, totp_started: Date.now(), csrf: sec.newToken() };
          if (!u.totp_enc) req.session.totp_pending = sec.encryptJson({ secret: totp.newSecret() });
          return res.go("/auth/totp");
        }
        if (!u.email) return fail("İki adımlı doğrulama için hesabınızda e-posta adresi yok. Protel destek ekibiyle görüşün.");
        await sendPin(u, req.lang);
        req.session = { pin_uid: u.id, pin_sent: Date.now(), csrf: sec.newToken() };
        return res.go("/login/pin");
      }
    }
    await finishLogin(req, res, u);
  } catch (e) { next(e); }
});

/* ── E-posta ile 6 haneli giriş kodu ── */
async function sendPin(user, lang = "tr") {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await db.query("UPDATE login_pins SET used=TRUE WHERE user_id=$1 AND NOT used", [user.id]);
  await db.query(
    "INSERT INTO login_pins(user_id,code_hash,expires_at) VALUES($1,$2, now() + make_interval(mins => $3::int))",
    [user.id, sec.sha256Hex(`${user.id}:${code}`), PIN_MINUTES]);
  await mailer.sendMail({
    to: user.email,
    ...i18nSrv.translateMail({
      subject: `SnapPass giriş kodu: ${code}`,
      text: `SnapPass giriş kodunuz: ${code}\n\nKod ${PIN_MINUTES} dakika geçerlidir. Bu girişi siz yapmadıysanız parolanızı değiştirin.`,
      html: `<p>SnapPass giriş kodunuz:</p><p style="font-size:24px;letter-spacing:6px"><b>${code}</b></p>
<p style="color:#646b78">Kod ${PIN_MINUTES} dakika geçerlidir. Bu girişi siz yapmadıysanız parolanızı değiştirin.</p>`,
    }, lang),
  });
}

router.get("/login/pin", async (req, res, next) => {
  try {
    if (!req.session.pin_uid) return res.go("/login");
    const u = await db.one("SELECT email FROM users WHERE id=$1", [req.session.pin_uid]);
    res.page("Giriş kodu", views.pinPage({ csrf: req.session.csrf, email: maskEmail(u?.email), minutes: PIN_MINUTES, deviceDays: DEVICE_DAYS }));
  } catch (e) { next(e); }
});

router.post("/login/pin", checkCsrf, async (req, res, next) => {
  try {
    const uid = req.session.pin_uid;
    if (!uid) return res.go("/login");
    const pin = await db.one(
      "SELECT * FROM login_pins WHERE user_id=$1 AND NOT used AND expires_at > now() ORDER BY id DESC LIMIT 1", [uid]);
    if (!pin || pin.attempts >= PIN_ATTEMPTS) {
      res.flash("error", "Kodun süresi doldu ya da deneme hakkı bitti. Yeniden giriş yapın.");
      req.session = { csrf: sec.newToken() };
      return res.go("/login");
    }
    const code = String(req.body.code || "").trim();
    if (!sec.safeEqual(sec.sha256Hex(`${uid}:${code}`), pin.code_hash)) {
      await db.query("UPDATE login_pins SET attempts=attempts+1 WHERE id=$1", [pin.id]);
      res.flash("error", `Kod hatalı. Kalan deneme: ${PIN_ATTEMPTS - pin.attempts - 1}`);
      return res.go("/login/pin");
    }
    await db.query("UPDATE login_pins SET used=TRUE WHERE id=$1", [pin.id]);
    const u = await db.one("SELECT * FROM users WHERE id=$1 AND active", [uid]);
    if (!u) return res.go("/login");
    if (req.body.remember === "1") {
      const token = sec.newToken();
      await db.query(
        "INSERT INTO trusted_devices(token_hash,user_id,expires_at) VALUES($1,$2, now() + make_interval(days => $3::int))",
        [sec.sha256Hex(token), u.id, DEVICE_DAYS]);
      setCookie(res, deviceCookieName(u.id), token, { maxAge: DEVICE_DAYS * 86400 });
    }
    await finishLogin(req, res, u);
  } catch (e) { next(e); }
});

router.post("/login/pin/resend", checkCsrf, async (req, res, next) => {
  try {
    const uid = req.session.pin_uid;
    if (!uid) return res.go("/login");
    if (Date.now() - (req.session.pin_sent || 0) < 60000) {
      res.flash("error", "Yeni kod için bir dakika bekleyin.");
      return res.go("/login/pin");
    }
    const u = await db.one("SELECT * FROM users WHERE id=$1 AND active", [uid]);
    if (!u) return res.go("/login");
    await sendPin(u, req.lang);
    req.session.pin_sent = Date.now();
    res.flash("ok", "Yeni kod gönderildi.");
    res.go("/login/pin");
  } catch (e) { next(e); }
});

/* ── Otel yönetimi girişi: ikinci doğrulama (Authenticator kuruluysa onunla, değilse e-posta kodu) ── */
const haMethod = (u) => (u.two_factor_mode === "totp" && u.totp_enc ? "totp" : "email");
const haUser = (req, res) => {
  const u = req.user;
  if (!u || u.role !== "hotel" || !u.hotel_admin) { res.status(403).send("Bu sayfa yalnız otel yöneticileri içindir."); return null; }
  return u;
};

router.get("/otel", requireUser, async (req, res, next) => {
  try {
    const u = haUser(req, res); if (!u) return;
    if (haVerified(req)) return res.go(`/admin/hotels/${u.hotel_id}`);
    const method = haMethod(u);
    if (method === "email") {
      if (!u.email) { res.flash("error", "Hesabınızda e-posta adresi yok. Protel destek ekibiyle görüşün."); return res.go("/"); }
      const live = await db.one("SELECT 1 FROM login_pins WHERE user_id=$1 AND NOT used AND expires_at > now() AND attempts < $2", [u.id, PIN_ATTEMPTS]);
      if (!live) { await sendPin(u, "tr"); req.session.ha_sent = Date.now(); }
    }
    res.page("Otel yönetimi doğrulaması", views.haVerifyPage({ csrf: req.session.csrf, method, email: maskEmail(u.email), minutes: PIN_MINUTES }));
  } catch (e) { next(e); }
});

router.post("/otel/tekrar", requireUser, checkCsrf, async (req, res, next) => {
  try {
    const u = haUser(req, res); if (!u) return;
    if (haMethod(u) !== "email") return res.go("/otel");
    if (Date.now() - (req.session.ha_sent || 0) < 60000) { res.flash("error", "Yeni kod için bir dakika bekleyin."); return res.go("/otel"); }
    await sendPin(u, "tr");
    req.session.ha_sent = Date.now();
    res.flash("ok", "Yeni kod gönderildi.");
    res.go("/otel");
  } catch (e) { next(e); }
});

router.post("/otel/dogrula", requireUser, checkCsrf, async (req, res, next) => {
  try {
    const u = haUser(req, res); if (!u) return;
    if (u.locked_until && new Date(u.locked_until) > new Date()) { res.flash("error", `Çok fazla hatalı kod. ${LOCK_MINUTES} dakika sonra tekrar deneyin.`); return res.go("/"); }
    const code = String(req.body.code || "").trim();
    let ok = false;
    if (haMethod(u) === "totp") {
      const secret = sec.decryptJson(u.totp_enc, {}).secret;
      const step = secret ? totp.verify(secret, code, Number(u.totp_last_step)) : null;
      if (step !== null) { ok = true; await db.query("UPDATE users SET totp_last_step=$2 WHERE id=$1", [u.id, step]); }
    } else {
      const pin = await db.one("SELECT * FROM login_pins WHERE user_id=$1 AND NOT used AND expires_at > now() ORDER BY id DESC LIMIT 1", [u.id]);
      if (pin && pin.attempts < PIN_ATTEMPTS) {
        if (sec.safeEqual(sec.sha256Hex(`${u.id}:${code}`), pin.code_hash)) { ok = true; await db.query("UPDATE login_pins SET used=TRUE WHERE id=$1", [pin.id]); }
        else await db.query("UPDATE login_pins SET attempts=attempts+1 WHERE id=$1", [pin.id]);
      }
    }
    if (!ok) {
      const failed = u.failed_logins + 1;
      if (failed >= MAX_FAILED) {
        await db.query("UPDATE users SET failed_logins=0, locked_until=now() + make_interval(mins => $2::int) WHERE id=$1", [u.id, LOCK_MINUTES]);
        res.flash("error", `Çok fazla hatalı kod. Hesap ${LOCK_MINUTES} dakika kilitlendi.`);
        return res.go("/");
      }
      await db.query("UPDATE users SET failed_logins=$2 WHERE id=$1", [u.id, failed]);
      res.flash("error", "Kod hatalı ya da süresi doldu. Kalan deneme: " + (MAX_FAILED - failed));
      return res.go("/otel");
    }
    await db.query("UPDATE users SET failed_logins=0 WHERE id=$1", [u.id]);
    req.session.ha_until = Date.now() + HA_MINUTES * 60000;
    res.go(`/admin/hotels/${u.hotel_id}`);
  } catch (e) { next(e); }
});

router.post("/logout", checkCsrf, (req, res) => {
  if (req.user) audit.log({ scope: req.user.role === "admin" ? "admin" : "user", hotelId: req.user.hotel_id || null, user: req.user, action: "Çıkış yapıldı", ip: req.ip });
  req.session = { csrf: sec.newToken() };
  res.go("/login");
});

/* ── Google ile Protel yönetici girişi ── */
const redirectUri = (req) => google.config().redirectUri || `${req.protocol}://${req.get("host")}/auth/google/callback`;

router.get("/auth/google/start", async (req, res, next) => {
  try {
    if (!google.enabled()) { res.flash("error", "Google girişi yapılandırılmamış (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)."); return res.go("/login"); }
    // Google Console'da localhost kayıtlı; 127.0.0.1 / [::1] ile açıldıysa aynı akışı localhost'tan başlat
    if (!google.config().redirectUri && /^(127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.get("host"))) {
      return res.redirect(303, `${req.protocol}://${req.get("host").replace(/^(127\.0\.0\.1|\[::1\])/, "localhost")}/auth/google/start`);
    }
    const { state, verifier, challenge } = google.newPkce();
    await db.query("DELETE FROM oauth_states WHERE expires_at < now()");
    await db.query("INSERT INTO oauth_states(state_hash,verifier,expires_at) VALUES($1,$2, now() + interval '10 minutes')", [sec.sha256Hex(state), verifier]);
    res.saveSession();
    res.redirect(303, await google.authUrl({ state, challenge, redirectUri: redirectUri(req) }));
  } catch (e) { next(e); }
});

router.get("/auth/google/callback", async (req, res, next) => {
  const fail = (msg) => { res.flash("error", msg); res.go("/login"); };
  try {
    if (req.query.error) return fail(`Google girişi iptal edildi (${req.query.error}).`);
    const row = await db.one("DELETE FROM oauth_states WHERE state_hash=$1 RETURNING *", [sec.sha256Hex(req.query.state || "")]);
    if (!row || new Date(row.expires_at) < new Date()) return fail("Google girişinin süresi doldu, tekrar deneyin.");
    const idToken = await google.exchangeCode({ code: String(req.query.code || ""), verifier: row.verifier, redirectUri: redirectUri(req) });
    const claims = await google.verifyIdToken(idToken);
    const email = String(claims.email || "").toLowerCase();
    if (!google.allowedEmail(email)) return fail(`${email} bir Protel hesabı değil.`);
    let u = await db.one("SELECT * FROM users WHERE google_sub=$1 AND role='admin'", [claims.sub]);
    if (!u) {
      u = await db.one("SELECT * FROM users WHERE lower(email)=$1 AND role='admin' AND google_sub IS NULL", [email]);
      if (u) await db.query("UPDATE users SET google_sub=$2 WHERE id=$1", [u.id, claims.sub]);
    }
    if (!u || !u.active) return fail(`${email} SnapPass yöneticisi olarak tanımlı değil.`);
    if (claims.name && !u.full_name) await db.query("UPDATE users SET full_name=$2 WHERE id=$1", [u.id, claims.name]);
    if (process.env.SNAPPASS_2FA_OFF === "1") return finishLogin(req, res, { ...u, must_change: false });
    // İkinci adım: Authenticator kodu (kurulu değilse önce QR ile kurulum)
    req.session = { totp_uid: u.id, totp_started: Date.now(), csrf: sec.newToken() };
    if (!u.totp_enc) req.session.totp_pending = sec.encryptJson({ secret: totp.newSecret() });
    res.go("/auth/totp");
  } catch (e) {
    console.error("[GOOGLE]", e.message);
    fail(`Google girişi başarısız: ${e.message}`);
  }
});

/* ── Authenticator (Google Authenticator vb.) — Protel yöneticisinin ikinci adımı ── */
async function totpUser(req, res) {
  const uid = req.session.totp_uid;
  if (!uid || Date.now() - (req.session.totp_started || 0) > TOTP_MINUTES * 60000) {
    if (uid) res.flash("error", "Doğrulama süresi doldu, yeniden giriş yapın.");
    req.session = { csrf: sec.newToken() };
    res.go("/login");
    return null;
  }
  const u = await db.one("SELECT * FROM users WHERE id=$1 AND role IN ('admin','hotel') AND active", [uid]);
  if (!u) { req.session = { csrf: sec.newToken() }; res.go("/login"); }
  return u;
}

router.get("/auth/totp", async (req, res, next) => {
  try {
    const u = await totpUser(req, res); if (!u) return;
    const pending = req.session.totp_pending && sec.decryptJson(req.session.totp_pending, {}).secret;
    const account = u.email || u.username;
    res.page(pending ? "Authenticator kurulumu" : "Doğrulama kodu", views.totpPage({
      csrf: req.session.csrf, email: account, remember: u.role === "hotel", deviceDays: DEVICE_DAYS, admin: u.role === "admin",
      setup: pending ? { qr: totp.qrSvg(totp.otpauthUri(pending, account)), secret: totp.formatSecret(pending) } : null,
    }));
  } catch (e) { next(e); }
});

router.post("/auth/totp", checkCsrf, async (req, res, next) => {
  try {
    const u = await totpUser(req, res); if (!u) return;
    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      req.session = { csrf: sec.newToken() };
      res.flash("error", `Çok fazla hatalı kod. ${LOCK_MINUTES} dakika sonra tekrar deneyin.`);
      return res.go("/login");
    }
    const pending = req.session.totp_pending && sec.decryptJson(req.session.totp_pending, {}).secret;
    const secret = pending || sec.decryptJson(u.totp_enc, {}).secret;
    if (!secret) { req.session = { csrf: sec.newToken() }; return res.go("/login"); }
    const step = totp.verify(secret, req.body.code, pending ? 0 : Number(u.totp_last_step));
    if (step === null) {
      // Hata sayacı veritabanında: imzalı çerez geri alınarak sıfırlanamaz
      const failed = u.failed_logins + 1;
      if (failed >= MAX_FAILED) {
        await db.query("UPDATE users SET failed_logins=0, locked_until=now() + make_interval(mins => $2::int) WHERE id=$1", [u.id, LOCK_MINUTES]);
        req.session = { csrf: sec.newToken() };
        res.flash("error", `Çok fazla hatalı kod. Hesap ${LOCK_MINUTES} dakika kilitlendi.`);
        return res.go("/login");
      }
      await db.query("UPDATE users SET failed_logins=$2 WHERE id=$1", [u.id, failed]);
      res.flash("error", `Kod hatalı. Telefonunuzun saatinin doğru olduğundan emin olun. Kalan deneme: ${MAX_FAILED - failed}`);
      return res.go("/auth/totp");
    }
    if (pending) await db.query("UPDATE users SET totp_enc=$2, totp_last_step=$3 WHERE id=$1", [u.id, sec.encryptJson({ secret: pending }), step]);
    else await db.query("UPDATE users SET totp_last_step=$2 WHERE id=$1", [u.id, step]);
    if (pending) res.flash("ok", "Authenticator kuruldu. Sonraki girişlerde uygulamadaki kod sorulacak.");
    if (u.role === "hotel" && req.body.remember === "1") {
      const token = sec.newToken();
      await db.query(
        "INSERT INTO trusted_devices(token_hash,user_id,expires_at) VALUES($1,$2, now() + make_interval(days => $3::int))",
        [sec.sha256Hex(token), u.id, DEVICE_DAYS]);
      setCookie(res, deviceCookieName(u.id), token, { maxAge: DEVICE_DAYS * 86400 });
    }
    await finishLogin(req, res, u.role === "admin" ? { ...u, must_change: false } : u);
  } catch (e) { next(e); }
});

/* ── Davetiye: kullanıcı parolasını kendisi belirler ── */
async function findInvite(token) {
  return db.one(
    `SELECT i.id AS invite_id, u.*, h.name AS hotel_name FROM invites i
       JOIN users u ON u.id=i.user_id LEFT JOIN hotels h ON h.id=u.hotel_id
      WHERE i.token_hash=$1 AND i.used_at IS NULL AND i.expires_at > now() AND u.active`, [sec.sha256Hex(token)]);
}

router.get("/invite/:token", async (req, res, next) => {
  try {
    const invited = await findInvite(req.params.token);
    res.page("Parolanızı belirleyin", views.invitePage({ csrf: req.session.csrf, token: req.params.token, invited, invalid: !invited }));
  } catch (e) { next(e); }
});

router.post("/invite/:token", checkCsrf, async (req, res, next) => {
  try {
    const invited = await findInvite(req.params.token);
    if (!invited) return res.go(`/invite/${encodeURIComponent(req.params.token)}`);
    const pw = String(req.body.new || "");
    if (pw !== String(req.body.new2 || "")) { res.flash("error", "Parolalar aynı değil."); return res.go(`/invite/${encodeURIComponent(req.params.token)}`); }
    const err = sec.passwordError(pw, invited.username);
    if (err) { res.flash("error", err); return res.go(`/invite/${encodeURIComponent(req.params.token)}`); }
    await db.query("UPDATE invites SET used_at=now() WHERE id=$1", [invited.invite_id]);
    await db.query("UPDATE users SET password_hash=$2, must_change=FALSE, failed_logins=0, locked_until=NULL WHERE id=$1", [invited.id, sec.hashPassword(pw)]);
    await db.query("DELETE FROM trusted_devices WHERE user_id=$1", [invited.id]);
    res.flash("ok", "Parolanız belirlendi.");
    await finishLogin(req, res, { ...invited, must_change: false });
  } catch (e) { next(e); }
});

/* ── Parolamı unuttum: e-postaya tek kullanımlık, 60 dakikalık bağlantı ──
   Hesap olsa da olmasa da aynı mesaj gösterilir; aynı hesaba 2 dakikada bir e-posta gider.
   Google ile giren Protel yöneticileri hariçtir. */
const RESET_MINUTES  = 60;
const RESET_COOLDOWN = 2;
const FORGOT_SENT    = "Bu bilgiyle kayıtlı bir hesap varsa, parola sıfırlama bağlantısı hesabın e-posta adresine gönderildi. Bağlantı 60 dakika geçerlidir.";

router.get("/forgot", async (req, res, next) => {
  try {
    if (req.user) return res.go("/");
    res.page("Parolamı unuttum", views.forgotPage({ csrf: req.session.csrf, available: mailer.smtpReady(await mailer.smtpConfig()) }));
  } catch (e) { next(e); }
});

router.post("/forgot", checkCsrf, async (req, res, next) => {
  try {
    if (!mailer.smtpReady(await mailer.smtpConfig())) return res.go("/forgot");
    const who = String(req.body.who || "").trim().toLowerCase();
    const users = who ? await db.all(
      `SELECT u.* FROM users u JOIN hotels h ON h.id=u.hotel_id
        WHERE u.role='hotel' AND u.active AND h.active AND u.email IS NOT NULL
          AND (lower(u.username)=$1 OR lower(u.email)=$1)`, [who]) : [];
    for (const u of users) {
      const recent = await db.one(
        "SELECT 1 FROM password_resets WHERE user_id=$1 AND created_at > now() - make_interval(mins => $2::int)", [u.id, RESET_COOLDOWN]);
      if (recent) continue;
      await db.query("UPDATE password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [u.id]);
      const token = sec.newToken();
      await db.query(
        "INSERT INTO password_resets(user_id,token_hash,expires_at) VALUES($1,$2, now() + make_interval(mins => $3::int))",
        [u.id, sec.sha256Hex(token), RESET_MINUTES]);
      try {
        await mailer.sendMail({ to: u.email, ...i18nSrv.translateMail(views.resetMail({ link: `${await appUrl(req)}/reset/${token}`, username: u.username, fullName: u.full_name, minutes: RESET_MINUTES }), req.lang) });
        console.log(`[RESET] ${u.username} için sıfırlama bağlantısı gönderildi`);
      } catch (e) {
        console.error(`[RESET] ${u.username} e-postası gönderilemedi:`, e.message);
      }
    }
    res.flash("ok", FORGOT_SENT);
    res.go("/login");
  } catch (e) { next(e); }
});

async function findReset(token) {
  return db.one(
    `SELECT r.id AS reset_id, u.* FROM password_resets r JOIN users u ON u.id=r.user_id JOIN hotels h ON h.id=u.hotel_id
      WHERE r.token_hash=$1 AND r.used_at IS NULL AND r.expires_at > now() AND u.active AND h.active AND u.role='hotel'`,
    [sec.sha256Hex(token)]);
}

router.get("/reset/:token", async (req, res, next) => {
  try {
    const target = await findReset(req.params.token);
    res.page("Yeni parola", views.resetPage({ csrf: req.session.csrf, token: req.params.token, target, invalid: !target }));
  } catch (e) { next(e); }
});

router.post("/reset/:token", checkCsrf, async (req, res, next) => {
  try {
    const back = `/reset/${encodeURIComponent(req.params.token)}`;
    const target = await findReset(req.params.token);
    if (!target) return res.go(back);
    const pw = String(req.body.new || "");
    if (pw !== String(req.body.new2 || "")) { res.flash("error", "Parolalar aynı değil."); return res.go(back); }
    const err = sec.passwordError(pw, target.username);
    if (err) { res.flash("error", err); return res.go(back); }
    await db.query("UPDATE password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [target.id]);
    await db.query("UPDATE users SET password_hash=$2, must_change=FALSE, failed_logins=0, locked_until=NULL WHERE id=$1", [target.id, sec.hashPassword(pw)]);
    await db.query("DELETE FROM trusted_devices WHERE user_id=$1", [target.id]);
    console.log(`[RESET] ${target.username} parolasını sıfırladı`);
    res.flash("ok", "Yeni parolanız kaydedildi.");
    await finishLogin(req, res, { ...target, must_change: false });
  } catch (e) { next(e); }
});

/* ── Parola değiştir ── */
router.get("/account/password", requireUser, (req, res) => {
  if (req.user.role === "admin") return res.go("/admin");
  res.page("Parola", views.passwordPage({ csrf: req.session.csrf, forced: req.user.must_change }));
});

router.post("/account/password", requireUser, checkCsrf, async (req, res, next) => {
  try {
    const back = (kind, msg) => { res.flash(kind, msg); res.go("/account/password"); };
    if (!sec.verifyPassword(String(req.body.current || ""), req.user.password_hash)) return back("error", "Mevcut parola hatalı.");
    const pw = String(req.body.new || "");
    if (pw !== String(req.body.new2 || "")) return back("error", "Parolalar aynı değil.");
    const err = sec.passwordError(pw, req.user.username);
    if (err) return back("error", err);
    await db.query("UPDATE users SET password_hash=$2, must_change=FALSE WHERE id=$1", [req.user.id, sec.hashPassword(pw)]);
    await db.query("DELETE FROM trusted_devices WHERE user_id=$1", [req.user.id]);
    res.flash("ok", "Parolanız değiştirildi.");
    res.go("/");
  } catch (e) { next(e); }
});

/* ── Protel yönetim: oteller ve Enterprise ──
   OHIP tanımı Enterprise için ortaktır; Chain adı/kodu OHIP'ten alınır.
   Otel Enterprise'a bağlıdır ve yalnız HotelId taşır; adı OPERA'dan gelir. Kullanıcılar otel bazlıdır. */
const chainOhip = (c) => sec.decryptJson(c?.ohip_enc, {});
const operaHotelList = new Map();   // zincir id → OPERA'daki otel listesi (yönetim ekranında gösterim için)

async function createInvite(req, res, user, hotelName) {
  await db.query("UPDATE invites SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [user.id]);
  const token = sec.newToken();
  await db.query(
    "INSERT INTO invites(user_id,token_hash,expires_at,created_by) VALUES($1,$2, now() + make_interval(days => $3::int), $4)",
    [user.id, sec.sha256Hex(token), INVITE_DAYS, req.user.id]);
  const link = `${await appUrl(req)}/invite/${token}`;
  const smtp = await mailer.smtpConfig();
  if (mailer.smtpReady(smtp) && user.email) {
    try {
      await mailer.sendMail({ to: user.email, ...i18nSrv.translateMail(views.inviteMail({ link, username: user.username, fullName: user.full_name, hotelName }), await defaultLang()) });
      res.flash("ok", `${user.email} adresine davetiye gönderildi.`);
      return;
    } catch (e) {
      res.flash("error", `Davetiye e-postası gönderilemedi: ${e.message}`);
    }
  }
  req.session.invite_link = [user.username, link];
}

// Zincirin token'ı (otel tarama ekranlarıyla aynı önbellek)
async function chainToken(chain, { force = false } = {}) {
  const key = String(chain.id);
  const cached = tokenCache.get(key);
  if (!force && cached && cached.until > Date.now()) return cached.token;
  let got;
  try { got = await ohip.getToken(chainOhip(chain)); }
  catch (e) {
    alerts.raiseChain(chain.id, "ohip", "token", "OHIP oturum anahtarı alınamadı. OHIP tanımları (client/secret/host) kontrol edilmeli.").catch(() => {});
    throw e;
  }
  alerts.resolveChain(chain.id, "ohip").catch(() => {});
  const { token, expiresIn } = got;
  tokenCache.set(key, { token, until: Date.now() + (expiresIn - 120) * 1000 });
  return token;
}

// Enterprise'a ikinci otel eklenince otomatik zincir olur
const markChainIfMulti = async (chainId) => { await db.query("UPDATE chains SET is_chain=TRUE WHERE id=$1 AND (SELECT count(*) FROM hotels WHERE chain_id=$1) > 1", [chainId]); };
const firstHotelCode = async (chainId) => (await db.one("SELECT hotel_code FROM hotels WHERE chain_id=$1 AND hotel_code<>'' ORDER BY id LIMIT 1", [chainId]))?.hotel_code || "";

router.get("/admin", requireAdmin, async (req, res, next) => {
  try {
    const chains = await db.all(
      `SELECT c.*, (SELECT count(*)::int FROM hotels h WHERE h.chain_id=c.id) AS hotel_count,
              (SELECT count(*)::int FROM users u JOIN hotels h ON h.id=u.hotel_id WHERE h.chain_id=c.id) AS user_count
         FROM chains c ORDER BY lower(c.name), c.id`);
    for (const c of chains) c.ohip_missing = ohip.missingFields(chainOhip(c));
    const orphans = await db.all("SELECT * FROM hotels WHERE chain_id IS NULL ORDER BY lower(name)");
    const admins = await db.all(`SELECT u.*, (u.last_login IS NOT NULL OR EXISTS (SELECT 1 FROM audit_log a WHERE a.user_id=u.id) OR EXISTS (SELECT 1 FROM kbs_submissions k WHERE k.user_id=u.id)) AS has_activity
                                   FROM users u WHERE u.role='admin' ORDER BY lower(coalesce(u.email,u.username))`);
    const smtp = await mailer.smtpConfig();
    const inviteLink = req.session.invite_link; delete req.session.invite_link;
    // OHIP sayacı: bu ay ve bugün, otel bazında (jeton çağrıları zincir bazında "" otel koduyla gelir)
    await require("./ohip-meter").flush().catch(() => {});
    const usageRows = await db.all(`SELECT hotel_code, SUM(n)::int AS month_n, COALESCE(SUM(n) FILTER (WHERE day = current_date), 0)::int AS today_n
                                     FROM ohip_calls WHERE day >= date_trunc('month', now())::date GROUP BY hotel_code ORDER BY month_n DESC`);
    // Sayaç sekmesi: seçilen tarih aralığı (varsayılan: bu ayın 1'i – bugün)
    const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const now = new Date(), validDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !isNaN(new Date(v));
    let from = validDay(req.query.from) ? String(req.query.from) : isoDay(new Date(now.getFullYear(), now.getMonth(), 1));
    let to = validDay(req.query.to) ? String(req.query.to) : isoDay(now);
    if (from > to) [from, to] = [to, from];
    const rangeRows = await db.all(`SELECT hotel_code, COALESCE(SUM(n) FILTER (WHERE day BETWEEN $1::date AND $2::date), 0)::int AS range_n,
                                           COALESCE(SUM(n) FILTER (WHERE day = current_date), 0)::int AS today_n
                                      FROM ohip_calls WHERE (day BETWEEN $1::date AND $2::date) OR day = current_date
                                     GROUP BY hotel_code ORDER BY range_n DESC`, [from, to]);
    const hotelInfo = await db.all("SELECT h.hotel_code, h.name, c.ohip_enc FROM hotels h LEFT JOIN chains c ON c.id=h.chain_id WHERE h.hotel_code <> ''");
    const infoByCode = new Map(hotelInfo.map(h => [String(h.hotel_code).toUpperCase(), h]));
    const ohipUsage = rangeRows.filter(r => (r.range_n || r.today_n) && r.hotel_code && !String(r.hotel_code).startsWith("@")).map(r => {
      const code = String(r.hotel_code);
      const h = infoByCode.get(code.toUpperCase());
      return { code, name: h ? h.name : code, env: h ? (sec.decryptJson(h.ohip_enc, {}).env || "") : "", month: r.range_n, today: r.today_n, kinds: {}, days: {} };
    });
    // Otele tıklanınca açılan ayrıntı: seçili aralıkta API türüne (profil / rezervasyon okuma-yazma) ve güne göre
    const byCode = new Map(ohipUsage.map(u => [u.code.toUpperCase(), u]));
    for (const d of await db.all("SELECT hotel_code, kind, to_char(day,'YYYY-MM-DD') AS d, SUM(n)::int AS n FROM ohip_calls WHERE day BETWEEN $1::date AND $2::date GROUP BY hotel_code, kind, day", [from, to])) {
      const u = byCode.get(String(d.hotel_code).toUpperCase()); if (!u) continue;
      u.kinds[d.kind] = (u.kinds[d.kind] || 0) + d.n;
      (u.days[d.d] = u.days[d.d] || {})[d.kind] = d.n;
    }
    const usageRange = { from, to, monthStart: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), today: isoDay(now),
      prevStart: isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)), prevEnd: isoDay(new Date(now.getFullYear(), now.getMonth(), 0)) };
    const entLabel = (c) => chainOhip(c).enterprise_id || c.name || `Enterprise #${c.id}`;
    const chainById = new Map(chains.map(c => [String(c.id), c]));
    const monthByCode = new Map(usageRows.map(r => [String(r.hotel_code).toUpperCase(), r.month_n]));
    const hotelList = await db.all(`SELECT h.id, h.name, h.hotel_code, h.active, h.chain_id, h.kbs_enabled, h.kbs_type, h.kbs_stopped, h.two_factor,
                                           (SELECT count(*)::int FROM users u WHERE u.hotel_id=h.id) AS user_count FROM hotels h`);
    // KBS bağlantı durumu (yalnız bellekteki oturum bilgisi; KBS'ye istek göndermez)
    const kbsLinkOf = (h) => {
      if (!h.kbs_enabled) return "off";
      if (h.kbs_stopped) return "stopped";
      if (h.kbs_type === "jandarma") { const j = jState.get("h" + h.id); return !j ? "unknown" : j.state === "ready" ? "on" : j.state === "error" ? "down" : "unknown"; }
      const st = kbsClient.status("h" + h.id).state;
      return st === "ready" ? "on" : (st === "connecting" || st === "otp" || st === "verifying") ? "busy" : "down";
    };
    const isChainById = new Map(chains.map(c => [String(c.id), !!c.is_chain]));
    const hotels = hotelList.map(h => {
      const c = chainById.get(String(h.chain_id));
      return { ...h, kbs_link: kbsLinkOf(h), is_chain: isChainById.get(String(h.chain_id)) || false, enterprise: c ? entLabel(c) : "", env: c ? (chainOhip(c).env || "") : "", month: monthByCode.get(String(h.hotel_code || "").toUpperCase()) || 0 };
    }).sort((a, b) => (a.enterprise || "~").localeCompare(b.enterprise || "~", "tr") || String(a.name).localeCompare(String(b.name), "tr"));
    // "Zincir otel" seçildiğinde yalnız zincir (is_chain) Enterprise'lar listelenir; tek otelli Enterprise'lar (ör. MAG) listede çıkmaz
    const enterprises = chains.filter(c => c.is_chain).map(c => ({ id: c.id, label: entLabel(c), hotel_count: c.hotel_count }));
    res.page("Oteller", views.adminPage({
      ohipUsage, usageRange, hotels, enterprises, ...(await (async () => {
        // Admin logu: tarih aralığı (varsayılan son 7 gün)
        let lfrom = validDay(req.query.lfrom) ? String(req.query.lfrom) : isoDay(new Date(Date.now() - 6 * 86400000));
        let lto = validDay(req.query.lto) ? String(req.query.lto) : isoDay(now);
        if (lfrom > lto) [lfrom, lto] = [lto, lfrom];
        return { logRange: { from: lfrom, to: lto, today: isoDay(now) }, adminLog: await audit.list({ scope: "admin", from: lfrom, to: lto, limit: 1000 }) };
      })()), alertRows: await alerts.listAll().catch(() => []),
      csrf: req.session.csrf, user: req.user, chains, orphans, admins, smtp, smtpOk: mailer.smtpReady(smtp),
      appUrl: await appUrl(req), inviteLink, google: google.config(),
      defaultLang: await defaultLang(), retentionMonths: await kbsRetentionMonths(),
    }));
  } catch (e) { next(e); }
});

// Otel ekle: OHIP bilgileri + HotelId. Aynı EnterpriseId varsa mevcut Enterprise (OHIP tanımı paylaşılır), yoksa yeni Enterprise açılır.
// Chain adı/kodu OPERA'dan alınıp kayıtta saklanır (yalnız Enterprise ekranında görünür).
const enterpriseLabel = (c) => chainOhip(c).enterprise_id || c.name || `Enterprise #${c.id}`;
// Birden fazla HotelId: her biri (OHIP tanımı tamamsa) OPERA'dan doğrulanıp ad alınarak eklenir; geçersiz, kayıtlı ve OPERA'da okunamayanlar atlanır
async function addHotelsBulk(chain, codes) {
  const cfg = chainOhip(chain), canCheck = !ohip.missingFields(cfg).length;
  const token = canCheck ? await chainToken(chain).catch(() => null) : null;
  const added = [], skipped = [];
  for (const c of codes) {
    if (!/^[A-Z0-9_\-]{2,20}$/.test(c)) { skipped.push(`${c} (geçersiz)`); continue; }
    if (await db.one("SELECT 1 FROM hotels WHERE chain_id=$1 AND hotel_code=$2", [chain.id, c])) { skipped.push(`${c} (zaten kayıtlı)`); continue; }
    let name = c;
    if (token) {
      try { name = (await ohip.getHotelInfo(cfg, token, c)).name || c; }
      catch (e) { skipped.push(`${c} (OPERA'da okunamadı)`); continue; }
    }
    await db.query("INSERT INTO hotels(name,chain_id,hotel_code,chain_name) VALUES($1,$2,$3,$4)", [name, chain.id, c, chain.name]);
    added.push(name === c ? c : `${name} (${c})`);
  }
  await markChainIfMulti(chain.id);
  return { added, skipped };
}

router.post("/admin/hotels/new", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    const b = req.body;
    const back = "/admin#ekle";
    // Birden fazla HotelId virgülle yazılabilir (Enterprise ekranındaki gibi); OHIP tanımı ve zincir ilk koda göre kurulur
    const codes = [...new Set(String(b.hotel_code || "").toUpperCase().split(/[\s,;]+/).filter(Boolean))];
    const code = codes[0] || "";
    if (!codes.length || !codes.every(c => /^[A-Z0-9_\-]{2,20}$/.test(c))) { res.flash("error", "Geçerli HotelId girin (birden fazla ise virgülle ayırın)."); return res.go(back); }
    let chain = null, created = false;
    const isChain = b.is_chain === "1";
    const choice = isChain ? String(b.enterprise_choice || "new") : "new"; // zincir değilse her zaman kendi OHIP tanımı
    if (choice !== "new") {
      chain = await db.one("SELECT * FROM chains WHERE id=$1", [Number(choice) || 0]);
      if (!chain) { res.flash("error", "Enterprise bulunamadı."); return res.go(back); }
    } else {
      const host = String(b.host || "").trim().replace(/\/+$/, "");
      if (!/^https:\/\/[A-Za-z0-9.\-]+(:\d+)?(\/[\w\-./]*)?$/.test(host)) { res.flash("error", "HostName https:// ile başlayan geçerli bir adres olmalı."); return res.go(back); }
      const cfg = {
        host,
        app_key: String(b.app_key || "").trim(),
        client_id: String(b.client_id || "").trim(),
        client_secret: String(b.client_secret || ""),
        enterprise_id: String(b.enterprise_id || "").trim(),
        scope: String(b.scope || "").trim() || ohip.DEFAULT_SCOPE,
        env: ["customer", "partner"].includes(b.env) ? b.env : "",
      };
      const missing = ohip.missingFields(cfg);
      if (missing.length) { res.flash("error", `Eksik OHIP alanları: ${missing.join(", ")}.`); return res.go(back); }
      if (!cfg.env) { res.flash("error", "Ortam (Customer ya da Partner) seçin."); return res.go(back); }
      // aynı EnterpriseId zaten kayıtlıysa onu kullan (OHIP tanımı paylaşılır)
      const all = await db.all("SELECT * FROM chains");
      chain = all.find(c => String(chainOhip(c).enterprise_id || "").toLowerCase() === cfg.enterprise_id.toLowerCase()) || null;
      if (chain) {
        res.flash("ok", `Enterprise ${enterpriseLabel(chain)} zaten kayıtlı; mevcut OHIP tanımı kullanıldı.`);
      } else {
        chain = await db.one("INSERT INTO chains(name, ohip_enc, is_chain) VALUES($1,$2,$3) RETURNING *", [cfg.enterprise_id, sec.encryptJson(cfg), isChain]);
        created = true;
        let token;
        try { token = await chainToken(chain, { force: true }); }
        catch (e) {
          await db.query("DELETE FROM chains WHERE id=$1", [chain.id]); // bağlantı kurulamadıysa yarım kayıt bırakılmaz
          res.flash("error", `OHIP bağlantısı kurulamadı, kayıt yapılmadı: ${e.message}`);
          return res.go(back);
        }
        try {
          const info = await ohip.getChainInfo(cfg, token, code);
          if (info.name) await db.query("UPDATE chains SET name=$2, chain_code=$3 WHERE id=$1", [chain.id, info.name, info.code]);
          chain = await db.one("SELECT * FROM chains WHERE id=$1", [chain.id]);
        } catch (e) {
          res.flash("error", `${e.message} — Chain bilgisi alınamadı (sonradan Enterprise ekranından yenilenebilir).`);
        }
      }
    }
    if (codes.length > 1) {
      const { added, skipped } = await addHotelsBulk(chain, codes);
      // hiç otel eklenemediyse bu istekte açılan boş Enterprise geri alınır
      if (!added.length && created && !(await db.one("SELECT 1 FROM hotels WHERE chain_id=$1 LIMIT 1", [chain.id]))) {
        await db.query("DELETE FROM chains WHERE id=$1", [chain.id]);
        tokenCache.delete(String(chain.id));
      }
      if (added.length) res.flash("ok", `${added.length} otel eklendi: ${added.join(", ")}. Kullanıcıları otel ekranından davet edin.`);
      if (skipped.length) res.flash("error", `Eklenmeyenler: ${skipped.join(", ")}.${!added.length && choice === "new" ? " Form bilgileri korundu; yalnız Client Secret'ı yeniden girin." : ""}`);
      return res.go(added.length ? `/admin/chains/${chain.id}#hotels` : back);
    }
    if (await db.one("SELECT 1 FROM hotels WHERE chain_id=$1 AND hotel_code=$2", [chain.id, code])) {
      res.flash("error", `${code} bu Enterprise'da zaten kayıtlı.`);
      return res.go(`/admin/chains/${chain.id}`);
    }
    let name = String(b.name || "").trim();
    if (!ohip.missingFields(chainOhip(chain)).length) {
      let token = null;
      try { token = await chainToken(chain); }
      catch (e) { res.flash("error", `${e.message} — otel adı OPERA'dan alınamadı (OHIP bağlantısı çalışınca doğrulanır).`); }
      if (token) {
        try {
          const info = await ohip.getHotelInfo(chainOhip(chain), token, code);
          name = info.name || name;
        } catch (e) {
          // Token alındı ama otel okunamadı (yanlış HotelId ya da Client ID'ye atanmamış): otel açılmaz, bu istekte açılan boş Enterprise geri alınır, forma dönülür
          if (created && !(await db.one("SELECT 1 FROM hotels WHERE chain_id=$1 LIMIT 1", [chain.id]))) {
            await db.query("DELETE FROM chains WHERE id=$1", [chain.id]);
            tokenCache.delete(String(chain.id));
          }
          res.flash("error", `${code} eklenmedi: OPERA'da okunamadı (HotelId'yi ve Client ID'ye atanmış otelleri kontrol edin). ${e.message}${choice === "new" ? " Form bilgileri korundu; yalnız Client Secret'ı yeniden girin." : ""}`);
          return res.go(back);
        }
      }
    }
    const h = await db.one("INSERT INTO hotels(name,chain_id,hotel_code,chain_name) VALUES($1,$2,$3,$4) RETURNING id", [name || code, chain.id, code, chain.name]);
    await markChainIfMulti(chain.id);
    if (created) res.flash("ok", "Hatırlatma: Sensitive Data kapalıysa kimlik no bilgisi okunamaz. Ayrıntı: Kurulum rehberi.");
    res.flash("ok", `${name || code} (${code}) ${created ? "yeni Enterprise ile" : "Enterprise " + enterpriseLabel(chain) + " altına"} eklendi. Kullanıcıları bu ekrandan davet edin.`);
    res.go(`/admin/hotels/${h.id}`);
  } catch (e) { next(e); }
});

router.post("/admin/chains", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    const c = await db.one("INSERT INTO chains(name) VALUES($1) RETURNING id", [String(req.body.name || "").replace(/\s+/g, " ").trim()]);
    res.flash("ok", "Enterprise kaydı açıldı. OHIP tanımlarını girip kaydedin; Chain adı/kodu OHIP'ten alınır.");
    res.go(`/admin/chains/${c.id}`);
  } catch (e) { next(e); }
});

async function loadChain(req, res) {
  const c = await db.one("SELECT * FROM chains WHERE id=$1", [Number(req.params.id) || 0]);
  if (!c) { res.flash("error", "Enterprise bulunamadı."); res.go("/admin"); }
  return c;
}

router.get("/admin/chains/:id", requireAdmin, async (req, res, next) => {
  try {
    const chain = await loadChain(req, res); if (!chain) return;
    const o = chainOhip(chain);
    const hotels = await db.all(
      `SELECT h.*, (SELECT count(*)::int FROM users u WHERE u.hotel_id=h.id) AS user_count
         FROM hotels h WHERE h.chain_id=$1 ORDER BY lower(h.name)`, [chain.id]);
    res.page(o.enterprise_id || chain.name || "Enterprise", views.chainPage({
      csrf: req.session.csrf, chain, ohip: { ...o, client_secret: "" }, ohipHasSecret: !!o.client_secret,
      ohipMissing: ohip.missingFields(o), hotels, operaHotels: operaHotelList.get(String(chain.id)) || null,
      defaultScope: ohip.DEFAULT_SCOPE,
    }));
  } catch (e) { next(e); }
});

router.post("/admin/chains/:id/ohip", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    const chain = await loadChain(req, res); if (!chain) return;
    const backHotel = /^\d+$/.test(String(req.body.back_hotel || "")) ? Number(req.body.back_hotel) : 0;
    const back = backHotel ? `/admin/hotels/${backHotel}` : `/admin/chains/${chain.id}#ohip`;
    const prev = chainOhip(chain);
    const b = req.body;
    const host = String(b.host || "").trim().replace(/\/+$/, "");
    if (host && !/^https:\/\/[A-Za-z0-9.\-]+(:\d+)?(\/[\w\-./]*)?$/.test(host)) {
      res.flash("error", "HostName https:// ile başlayan geçerli bir adres olmalı.");
      return res.go(back);
    }
    const cfg = {
      host,
      app_key: String(b.app_key || "").trim(),
      client_id: String(b.client_id || "").trim(),
      client_secret: String(b.client_secret || "") || prev.client_secret || "",
      enterprise_id: String(b.enterprise_id || "").trim(),
      scope: String(b.scope || "").trim() || ohip.DEFAULT_SCOPE,
      env: ["customer", "partner"].includes(b.env) ? b.env : (prev.env || ""),
    };
    const enc = sec.encryptJson(cfg);
    await db.query("UPDATE chains SET ohip_enc=$2 WHERE id=$1", [chain.id, enc]);
    tokenCache.delete(String(chain.id));
    operaHotelList.delete(String(chain.id));
    const missing = ohip.missingFields(cfg);
    if (missing.length) { res.flash("error", `Kaydedildi; eksik alanlar: ${missing.join(", ")}.`); return res.go(back); }
    // Tanımlar tamamsa token alınır; zincir adı ve kodu OHIP'ten güncellenir
    let token;
    try {
      const t0 = Date.now();
      token = await chainToken({ ...chain, ohip_enc: enc }, { force: true });
      res.flash("ok", b.action === "test" ? `OHIP bağlantısı başarılı — token alındı (${Date.now() - t0} ms).` : "OHIP tanımları kaydedildi.");
    } catch (e) {
      res.flash("error", b.action === "test" ? e.message : `Kaydedildi, ancak ${e.message}`);
      return res.go(back);
    }
    try {
      const info = await ohip.getChainInfo(cfg, token, await firstHotelCode(chain.id));
      if (info.name) {
        await db.query("UPDATE chains SET name=$2, chain_code=$3 WHERE id=$1", [chain.id, info.name, info.code]);
        await db.query("UPDATE hotels SET chain_name=$2 WHERE chain_id=$1", [chain.id, info.name]);
        res.flash("ok", `Chain bilgisi OHIP'ten alındı: ${info.name}${info.code ? ` (${info.code})` : ""}.`);
      }
    } catch (e) {
      res.flash("error", `${e.message} — Chain bilgisi güncellenmedi.`);
    }
    res.go(back);
  } catch (e) { next(e); }
});

// OHIP testi (kaydetmeden): token + HotelId ile otel adı. Sonuç JSON; form üstünde gösterilir.
// /admin/ohip-test: yeni Enterprise (kayıt yok; secret formdan gelir); /admin/chains/:id/ohip-test: kayıtlı secret korunur
router.post(["/admin/ohip-test", "/admin/chains/:id/ohip-test"], requireAdmin, checkCsrf, async (req, res) => {
  try {
    let prev = {};
    if (req.params.id) { const chain = await loadChain(req, res); if (!chain) return; prev = chainOhip(chain); }
    const b = req.body;
    const cfg = {
      host: String(b.host || "").trim().replace(/\/+$/, ""),
      app_key: String(b.app_key || "").trim(),
      client_id: String(b.client_id || "").trim(),
      client_secret: String(b.client_secret || "") || prev.client_secret || "",
      enterprise_id: String(b.enterprise_id || "").trim(),
      scope: String(b.scope || "").trim() || ohip.DEFAULT_SCOPE,
    };
    const code = String(b.test_hotel || "").trim().toUpperCase();
    const missing = ohip.missingFields(cfg);
    if (missing.length) return res.json({ ok: false, message: "Eksik alanlar: " + missing.join(", ") + "." });
    if (!/^[A-Z0-9_\-]{2,20}$/.test(code)) return res.json({ ok: false, message: "HotelId girin; test HotelId olmadan yapılmaz." });
    if (!/^https:\/\/[A-Za-z0-9.\-]+(:\d+)?(\/[\w\-./]*)?$/.test(cfg.host)) return res.json({ ok: false, message: "HostName https:// ile başlayan geçerli bir adres olmalı." });
    const t0 = Date.now();
    let token;
    try { token = (await ohip.getToken(cfg)).token; }
    catch (e) { return res.json({ ok: false, message: e.message }); }
    try {
      const info = await ohip.getHotelInfo(cfg, token, code);
      return res.json({ ok: true, message: "OHIP bağlantısı başarılı (" + (Date.now() - t0) + " ms). Otel: " + (info.name || code) + (info.chainName ? " · Chain: " + info.chainName : "") + ". Kaydetmeyi unutmayın." });
    } catch (e) {
      return res.json({ ok: false, message: "Token alındı ama otel bilgisi okunamadı (" + code + "): " + e.message });
    }
  } catch (e) { res.json({ ok: false, message: "Test hatası: " + e.message }); }
});

router.post("/admin/chains/:id/opera-hotels", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    const chain = await loadChain(req, res); if (!chain) return;
    try {
      // OHIP listesi x-hotelId başlığındaki oteli döndürür; bağlı her otel koduyla sorulup birleştirilir
      const cfg = chainOhip(chain), token = await chainToken(chain);
      const codes = (await db.all("SELECT hotel_code FROM hotels WHERE chain_id=$1 AND hotel_code<>'' ORDER BY id", [chain.id])).map(r => r.hotel_code);
      const byId = new Map(); let lastErr = null;
      for (const code of (codes.length ? codes : [""])) {
        try { for (const h of await ohip.getHotels(cfg, token, code)) byId.set(h.hotelId, h); }
        catch (e) { lastErr = e; }
      }
      if (!byId.size && lastErr) throw lastErr;
      const list = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
      operaHotelList.set(String(chain.id), list);
      res.flash("ok", `OPERA'da ${list.length} otel bulundu.`);
    } catch (e) {
      res.flash("error", `${e.message}. Otel kodunu (HotelId) elle girerek ekleyebilirsiniz.`);
    }
    res.go(`/admin/chains/${chain.id}#hotels`);
  } catch (e) { next(e); }
});

// Zincire otel ekle: HotelId ile; ad OPERA'dan alınır (alınamazsa listeden gelen ad ya da HotelId)
router.post("/admin/chains/:id/hotels", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    const chain = await loadChain(req, res); if (!chain) return;
    const back = `/admin/chains/${chain.id}#hotels`;
    const codes = [...new Set(String(req.body.hotel_code || "").toUpperCase().split(/[\s,;]+/).filter(Boolean))];
    if (codes.length > 1) {
      const { added, skipped } = await addHotelsBulk(chain, codes);
      if (added.length) res.flash("ok", `${added.length} otel eklendi: ${added.join(", ")}.`);
      if (skipped.length) res.flash("error", `Eklenmeyenler: ${skipped.join(", ")}.`);
      return res.go(back);
    }
    const code = codes[0] || "";
    if (!/^[A-Z0-9_\-]{2,20}$/.test(code)) { res.flash("error", "Geçerli bir HotelId girin."); return res.go(back); }
    if (await db.one("SELECT 1 FROM hotels WHERE chain_id=$1 AND hotel_code=$2", [chain.id, code])) { res.flash("error", `${code} bu Enterprise'da zaten kayıtlı.`); return res.go(back); }
    let name = String(req.body.name || "").trim();
    if (!ohip.missingFields(chainOhip(chain)).length) {
      let token = null;
      try { token = await chainToken(chain); }
      catch (e) { res.flash("error", `${e.message} — otel adı OPERA'dan alınamadı (OHIP bağlantısı çalışınca doğrulanır).`); }
      if (token) {
        try {
          const info = await ohip.getHotelInfo(chainOhip(chain), token, code);
          name = info.name || name;
        } catch (e) {
          // Token alındı ama otel okunamadı: HotelId yanlış ya da Client ID'ye atanmamış; kayıt açılmaz
          res.flash("error", `${code} eklenmedi: OPERA'da okunamadı (HotelId'yi ve Client ID'ye atanmış otelleri kontrol edin). ${e.message}`);
          return res.go(back);
        }
      }
    }
    const h = await db.one("INSERT INTO hotels(name,chain_id,hotel_code,chain_name) VALUES($1,$2,$3,$4) RETURNING id",
      [name || code, chain.id, code, chain.name]);
    await markChainIfMulti(chain.id);
    res.flash("ok", `${name || code} (${code}) eklendi. Kullanıcıları otel ekranından davet edin.`);
    res.go(`/admin/hotels/${h.id}`);
  } catch (e) { next(e); }
});

router.post("/admin/chains/:id/delete", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    const chain = await loadChain(req, res); if (!chain) return;
    if (await db.one("SELECT 1 FROM hotels WHERE chain_id=$1 LIMIT 1", [chain.id])) {
      res.flash("error", "Enterprise'da otel varken silinemez; önce otelleri silin.");
      return res.go(`/admin/chains/${chain.id}`);
    }
    await db.query("DELETE FROM chains WHERE id=$1", [chain.id]);
    tokenCache.delete(String(chain.id));
    res.flash("ok", `Enterprise ${enterpriseLabel(chain)} silindi.`);
    res.go("/admin");
  } catch (e) { next(e); }
});

async function loadHotel(req, res) {
  const h = await db.one(
    "SELECT h.*, c.name AS chain_title, c.ohip_enc AS chain_ohip_enc, COALESCE(c.is_chain, FALSE) AS chain_is_chain, (SELECT count(*)::int FROM hotels x WHERE x.chain_id=h.chain_id) AS chain_hotel_count FROM hotels h LEFT JOIN chains c ON c.id=h.chain_id WHERE h.id=$1",
    [Number(req.params.id) || 0]);
  if (!h) { res.flash("error", "Otel bulunamadı."); res.go("/admin"); }
  return h;
}
const hotelBack = (h) => (h.chain_id ? `/admin/chains/${h.chain_id}` : "/admin");

// Otel yöneticisinin kendi otelini gördüğü ek bölümler: OHIP sayacı, uyarılar, değişiklikler (yalnız bu otelin verisi)
async function hotelAdminData(req, hotel, cfg) {
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const validDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !isNaN(new Date(v));
  const now = new Date();
  let from = validDay(req.query.from) ? String(req.query.from) : isoDay(new Date(now.getFullYear(), now.getMonth(), 1));
  let to = validDay(req.query.to) ? String(req.query.to) : isoDay(now);
  if (from > to) [from, to] = [to, from];
  let lfrom = validDay(req.query.lfrom) ? String(req.query.lfrom) : isoDay(new Date(Date.now() - 6 * 86400000));
  let lto = validDay(req.query.lto) ? String(req.query.lto) : isoDay(now);
  if (lfrom > lto) [lfrom, lto] = [lto, lfrom];
  const code = String(hotel.hotel_code || "");
  await require("./ohip-meter").flush().catch(() => {});
  const kinds = {}, days = {};
  let today = 0, total = 0;
  if (code) {
    for (const d of await db.all("SELECT kind, to_char(day,'YYYY-MM-DD') AS d, SUM(n)::int AS n FROM ohip_calls WHERE upper(hotel_code)=upper($1) AND day BETWEEN $2::date AND $3::date GROUP BY kind, day", [code, from, to])) {
      kinds[d.kind] = (kinds[d.kind] || 0) + d.n; (days[d.d] = days[d.d] || {})[d.kind] = d.n; total += d.n;
    }
    today = (await db.one("SELECT COALESCE(SUM(n),0)::int AS n FROM ohip_calls WHERE upper(hotel_code)=upper($1) AND day=current_date", [code]))?.n || 0;
  }
  const mine = (await alerts.listAll().catch(() => [])).filter(a => String(a.hotel_code || "").toUpperCase() === code.toUpperCase());
  const lg = [...await audit.list({ scope: "user", hotelId: hotel.id, from: lfrom, to: lto, limit: 1000 }), ...await audit.list({ scope: "admin", hotelId: hotel.id, from: lfrom, to: lto, limit: 500 })]
    .sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 1000);
  return {
    usage: { from, to, today, total, kinds, days, env: cfg.env || "", monthStart: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), todayDay: isoDay(now),
      prevStart: isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)), prevEnd: isoDay(new Date(now.getFullYear(), now.getMonth(), 0)) },
    alertRows: mine, log: lg, logRange: { from: lfrom, to: lto, today: isoDay(now) },
    missing: ["host", "app_key", "client_id", "client_secret", "enterprise_id"].filter(k => !cfg[k]).length,
  };
}

router.get("/admin/hotels/:id", staffOwn, async (req, res, next) => {
  try {
    const hotel = await loadHotel(req, res); if (!hotel) return;
    // has_activity: kullanıcının hareketi (giriş, işlem kaydı, KBS kaydı) varsa Sil düğmesi pasif gösterilir (sunucu da silmeyi reddeder)
    const users = await db.all(`SELECT u.*, (u.last_login IS NOT NULL OR EXISTS (SELECT 1 FROM audit_log a WHERE a.user_id=u.id) OR EXISTS (SELECT 1 FROM kbs_submissions k WHERE k.user_id=u.id)) AS has_activity
                                  FROM users u WHERE u.hotel_id=$1 ORDER BY lower(u.username)`, [hotel.id]);
    const chains = hotel.chain_id ? [] : (await db.all("SELECT id, name, ohip_enc FROM chains ORDER BY id")).map(c => ({ id: c.id, name: chainOhip(c).enterprise_id || c.name }));
    const smtp = await mailer.smtpConfig();
    const inviteLink = req.session.invite_link; delete req.session.invite_link;
    const cfgFull = sec.decryptJson(hotel.chain_ohip_enc, {});
    const ha = req.user.role === "admin" ? null : await hotelAdminData(req, hotel, cfgFull);
    res.page(hotel.name, views.hotelPage({
      csrf: req.session.csrf, hotel, chains: ha ? [] : chains, users, smtpOk: mailer.smtpReady(smtp), inviteLink, ohipEnv: cfgFull.env || "", enterpriseId: cfgFull.enterprise_id || "",
      ohipReady: !!hotel.chain_id && !!hotel.hotel_code && !ohip.missingFields(cfgFull).length,
      hasActivity: await audit.hotelHasActivity(hotel),
      // zincir değilse OHIP tanımı otel ekranında düzenlenir. Otel yöneticisine gizli alanlar (secret, AppKey, host) hiç gönderilmez.
      ohipCfg: ha ? { enterprise_id: cfgFull.enterprise_id || "", env: cfgFull.env || "" } : cfgFull, defaultScope: ohip.DEFAULT_SCOPE,
      ha, viewerId: req.user.id,
    }));
  } catch (e) { next(e); }
});

// Zincirsiz (eski) otel: zincire bağla ve HotelId gir
router.post("/admin/hotels/:id/chain", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    const hotel = await loadHotel(req, res); if (!hotel) return;
    const chain = await db.one("SELECT * FROM chains WHERE id=$1", [Number(req.body.chain_id) || 0]);
    const code = String(req.body.hotel_code || "").trim().toUpperCase();
    if (!chain || !/^[A-Z0-9_\-]{2,20}$/.test(code)) { res.flash("error", "Enterprise seçin ve geçerli bir HotelId girin."); return res.go(`/admin/hotels/${hotel.id}`); }
    await db.query("UPDATE hotels SET chain_id=$2, hotel_code=$3, chain_name=$4 WHERE id=$1", [hotel.id, chain.id, code, chain.name]);
    res.flash("ok", `${hotel.name}, Enterprise ${enterpriseLabel(chain)} altına bağlandı.`);
    res.go(`/admin/hotels/${hotel.id}`);
  } catch (e) { next(e); }
});

router.post("/admin/hotels/:id/refresh", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    const hotel = await loadHotel(req, res); if (!hotel) return;
    const chain = await db.one("SELECT * FROM chains WHERE id=$1", [hotel.chain_id || 0]);
    if (!chain || !hotel.hotel_code) { res.flash("error", "Otel bir Enterprise'a bağlı değil ya da HotelId yok."); return res.go(`/admin/hotels/${hotel.id}`); }
    try {
      const info = await ohip.getHotelInfo(chainOhip(chain), await chainToken(chain), hotel.hotel_code);
      if (info.name) await db.query("UPDATE hotels SET name=$2, chain_name=$3 WHERE id=$1", [hotel.id, info.name, chain.name]);
      res.flash("ok", info.name === hotel.name ? `Otel adı OPERA ile aynı: ${info.name}.` : `Otel adı OPERA'dan güncellendi: ${info.name}.`);
    } catch (e) {
      res.flash("error", e.message);
    }
    res.go(`/admin/hotels/${hotel.id}`);
  } catch (e) { next(e); }
});

router.post("/admin/hotels/:id/active", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    const hotel = await loadHotel(req, res); if (!hotel) return;
    await db.query("UPDATE hotels SET active=NOT active WHERE id=$1", [hotel.id]);
    res.flash("ok", `${hotel.name} ${hotel.active ? "pasife alındı" : "aktife alındı"}.`);
    res.go(req.body.back === "chain" ? hotelBack(hotel) : `/admin/hotels/${hotel.id}`);
  } catch (e) { next(e); }
});

// Zincir (Chain) anahtarı: açıkken OHIP tanımı Enterprise ekranında (birden fazla otel paylaşır), kapalıyken otel ekranında
router.post("/admin/hotels/:id/chain-mode", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    const hotel = await loadHotel(req, res); if (!hotel) return;
    if (!hotel.chain_id) { res.flash("error", "Otel bir OHIP tanımına bağlı değil."); return res.go(`/admin/hotels/${hotel.id}`); }
    const on = req.body.on === "1";
    if (!on && hotel.chain_hotel_count > 1) {
      // Zincirde başka oteller var: yalnız bu otel ayrılır. OHIP tanımının bir kopyası bu otele ait yeni (tek otel) kayda alınır;
      // zincir ve diğer oteller hiç etkilenmez.
      const own = await db.one(
        "INSERT INTO chains(name, chain_code, ohip_enc, is_chain) SELECT name, chain_code, ohip_enc, FALSE FROM chains WHERE id=$1 RETURNING id",
        [hotel.chain_id]);
      await db.query("UPDATE hotels SET chain_id=$2 WHERE id=$1", [hotel.id, own.id]);
      res.flash("ok", `${hotel.name}: zincirden ayrıldı, tek otel oldu. OHIP tanımı bu otele kopyalandı; zincirdeki diğer oteller etkilenmedi.`);
      return res.go(`/admin/hotels/${hotel.id}`);
    }
    await db.query("UPDATE chains SET is_chain=$2 WHERE id=$1", [hotel.chain_id, on]);
    res.flash("ok", `${hotel.name}: ${on ? "zincir otel olarak işaretlendi (OHIP tanımı Enterprise ekranında)" : "tek otel (OHIP tanımı otel ekranında)"}.`);
    res.go(`/admin/hotels/${hotel.id}`);
  } catch (e) { next(e); }
});

router.post("/admin/hotels/:id/kbs", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    const hotel = await loadHotel(req, res); if (!hotel) return;
    const on = req.body.kbs_enabled === "1";
    // Kapatmak hiçbir şeyi silmez (KBS bilgileri, gönderim kayıtları, tip korunur); yalnız KBS sekmesi gizlenir ve açık oturum kapanır
    await db.query("UPDATE hotels SET kbs_enabled=$2 WHERE id=$1", [hotel.id, on]);
    if (!on) kbsClient.disconnect("h" + hotel.id);
    res.flash("ok", `${hotel.name}: KBS bildirimi ${on ? "açıldı" : "kapatıldı (bilgiler korunuyor)"}.`);
    res.go(`/admin/hotels/${hotel.id}`);
  } catch (e) { next(e); }
});

// KBS bağlantısını DURDUR / başlat (yalnız Protel yöneticisi): durdurulunca otel için KBS'ye hiçbir istek gitmez (bağlanma, liste, gönderim, otomatik yeniden bağlanma)
router.post("/admin/hotels/:id/kbs-stop", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    const hotel = await loadHotel(req, res); if (!hotel) return;
    const stop = req.body.stopped === "1";
    await db.query("UPDATE hotels SET kbs_stopped=$2 WHERE id=$1", [hotel.id, stop]);
    if (stop) { kbsClient.disconnect("h" + hotel.id); jState.delete("h" + hotel.id); kbsAuto.delete("h" + hotel.id); }
    res.flash("ok", `${hotel.name}: KBS bağlantısı ${stop ? "DURDURULDU (açık oturum kapatıldı; KBS'ye istek gitmez)" : "yeniden başlatıldı"}.`);
    res.go(`/admin/hotels/${hotel.id}`);
  } catch (e) { next(e); }
});

// KBS otomatik gönderim (varsayılan KAPALI): açıkken KBS Gönderim ekranı açık olan kullanıcının ekranında bilgisi tam misafirler kendiliğinden gönderilir
router.post("/admin/hotels/:id/kbs-auto", staffOwn, checkCsrf, async (req, res, next) => {
  try {
    const hotel = await loadHotel(req, res); if (!hotel) return;
    const on = req.body.kbs_auto === "1";
    await db.query("UPDATE hotels SET kbs_auto=$2 WHERE id=$1", [hotel.id, on]);
    res.flash("ok", `${hotel.name}: KBS otomatik gönderim ${on ? "AÇILDI" : "kapatıldı"}.`);
    res.go(`/admin/hotels/${hotel.id}`);
  } catch (e) { next(e); }
});

router.post("/admin/hotels/:id/kbs-type", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    const hotel = await loadHotel(req, res); if (!hotel) return;
    const type = req.body.kbs_type === "jandarma" ? "jandarma" : "polis";
    await db.query("UPDATE hotels SET kbs_type=$2 WHERE id=$1", [hotel.id, type]);
    if (type === "jandarma") kbsClient.disconnect("h" + hotel.id); // otelin açık Polis KBS oturumu kapanır
    res.flash("ok", `${hotel.name}: KBS tipi ${type === "jandarma" ? "Jandarma" : "Polis"} olarak ayarlandı.`);
    res.go(`/admin/hotels/${hotel.id}`);
  } catch (e) { next(e); }
});

router.post("/admin/hotels/:id/delete", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    const hotel = await loadHotel(req, res); if (!hotel) return;
    if (await audit.hotelHasActivity(hotel)) {
      res.flash("error", `${hotel.name} silinemez: otelde kullanıcı hareketi var (giriş, OPERA / KBS işlemi). Gerekirse pasife alın.`);
      return res.go(`/admin/hotels/${hotel.id}`);
    }
    await db.query("DELETE FROM hotels WHERE id=$1", [hotel.id]);
    res.flash("ok", `${hotel.name} ve kullanıcıları silindi.`);
    // Enterprise'ın son oteliyse Enterprise kaydı (OHIP tanımı) da silinir
    if (hotel.chain_id && !(await db.one("SELECT 1 FROM hotels WHERE chain_id=$1 LIMIT 1", [hotel.chain_id]))) {
      await db.query("DELETE FROM chains WHERE id=$1", [hotel.chain_id]);
      tokenCache.delete(String(hotel.chain_id));
      operaHotelList.delete(String(hotel.chain_id));
      res.flash("ok", `Enterprise ${hotel.chain_title || ""} da silindi (son oteliydi).`.replace("  ", " "));
      return res.go("/admin");
    }
    res.go(hotelBack(hotel));
  } catch (e) { next(e); }
});

router.post("/admin/hotels/:id/scanner", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    const hotel = await loadHotel(req, res); if (!hotel) return;
    req.session.scan_hotel_id = hotel.id;
    res.go("/");
  } catch (e) { next(e); }
});

/* ── Protel yönetim: kullanıcılar ── */
router.post("/admin/hotels/:id/users", staffOwn, checkCsrf, async (req, res, next) => {
  try {
    const hotel = await loadHotel(req, res); if (!hotel) return;
    const back = (msg) => { res.flash("error", msg); res.go(`/admin/hotels/${hotel.id}`); };
    const username = String(req.body.username || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!/^[A-Za-z0-9._@\-]{3,60}$/.test(username)) return back("Kullanıcı adı 3-60 karakter; harf, rakam ve . _ @ - içerebilir.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return back("Geçerli bir e-posta girin.");
    if (await db.one("SELECT 1 FROM users WHERE lower(username)=lower($1)", [username])) return back(`${username} kullanıcı adı zaten kullanılıyor.`);
    // Otelin ilk kullanıcısı KBS bilgilerini girme/değiştirme yetkisiyle açılır (Protel her otelde ayrıca yetki vermek zorunda kalmasın)
    const first = !(await db.one("SELECT 1 FROM users WHERE hotel_id=$1 LIMIT 1", [hotel.id]));
    const user = await db.one(
      "INSERT INTO users(username,full_name,email,role,hotel_id,kbs_manage) VALUES($1,$2,$3,'hotel',$4,$5) RETURNING *",
      [username, String(req.body.full_name || "").trim(), email, hotel.id, first]);
    if (first) res.flash("ok", `${username} otelin ilk kullanıcısı olduğu için "KBS bilgilerini düzenleyebilir" yetkisiyle açıldı.`);
    await createInvite(req, res, user, hotel.name);
    res.go(`/admin/hotels/${hotel.id}`);
  } catch (e) { next(e); }
});

async function loadUser(req, res) {
  const u = await db.one("SELECT u.*, h.name AS hotel_name FROM users u LEFT JOIN hotels h ON h.id=u.hotel_id WHERE u.id=$1", [Number(req.params.id) || 0]);
  if (!u) { res.flash("error", "Kullanıcı bulunamadı."); res.go("/admin"); }
  return u;
}
const userBack = (u) => (u.role === "admin" ? "/admin#yoneticiler" : `/admin/hotels/${u.hotel_id}`);

router.post("/admin/users/:id/invite", staffOwn, checkCsrf, async (req, res, next) => {
  try {
    const u = await loadUser(req, res); if (!u) return;
    if (u.role !== "hotel") return res.go("/admin");
    await createInvite(req, res, u, u.hotel_name);
    res.go(userBack(u));
  } catch (e) { next(e); }
});

// Otel kullanıcısı tek formda: e-posta, giriş doğrulaması (2FA yöntemi), KBS bilgileri yetkisi
router.post("/admin/users/:id/update", staffOwn, checkCsrf, async (req, res, next) => {
  try {
    const u = await loadUser(req, res); if (!u) return;
    if (u.role !== "hotel") return res.go(userBack(u));
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { res.flash("error", "Geçerli bir e-posta girin."); return res.go(userBack(u)); }
    const mode = "mode" in req.body ? (req.body.mode === "totp" ? "totp" : null) : u.two_factor_mode; // 2FA kapalı otelde alan gelmez: değişmez
    const hasKbsFields = "kbs_present" in req.body;
    const kbs = hasKbsFields ? req.body.kbs_manage === "1" : u.kbs_manage;
    const rpt = hasKbsFields ? req.body.kbs_report === "1" : u.kbs_report;
    await db.query("UPDATE users SET email=$2, two_factor_mode=$3, kbs_manage=$4, kbs_report=$5 WHERE id=$1", [u.id, email, mode, kbs, rpt]);
    // Profil işlemleri yetkileri (birleştirme / ana profil değiştirme / beraberindeki değiştirme); form gelmediyse değişmez
    const hasProf = "prof_present" in req.body;
    const pm = hasProf ? req.body.can_merge === "1" : !!u.can_merge, pc = hasProf ? req.body.can_change_main === "1" : !!u.can_change_main, pa = hasProf ? req.body.can_change_accompany === "1" : !!u.can_change_accompany;
    if (hasProf) await db.query("UPDATE users SET can_merge=$2, can_change_main=$3, can_change_accompany=$4 WHERE id=$1", [u.id, pm, pc, pa]);
    // Otel yöneticisi bayrağı YALNIZ Protel yöneticisi tarafından verilir / alınır (otel yöneticisi kendi ya da başkasının bayrağını değiştiremez)
    const wasHa = !!u.hotel_admin;
    if (req.user.role === "admin" && "ha_present" in req.body && (req.body.hotel_admin === "1") !== wasHa) {
      await db.query("UPDATE users SET hotel_admin=$2 WHERE id=$1", [u.id, req.body.hotel_admin === "1"]);
      res.flash("ok", `${u.username}: otel yöneticisi yetkisi ${req.body.hotel_admin === "1" ? "verildi" : "kaldırıldı"}.`);
    }
    if ((mode || null) !== (u.two_factor_mode || null)) await db.query("DELETE FROM trusted_devices WHERE user_id=$1", [u.id]); // yöntem değişince hatırlanan cihazlar geçersiz
    const changes = [email !== (u.email || "") && "e-posta", (mode || null) !== (u.two_factor_mode || null) && `2FA: ${mode === "totp" ? "Authenticator" : "e-posta kodu"}`, kbs !== !!u.kbs_manage && `KBS giriş bilgileri yetkisi: ${kbs ? "var" : "yok"}`, rpt !== !!u.kbs_report && `KBS geçmişi yetkisi: ${rpt ? "var" : "yok"}`, pm !== !!u.can_merge && `profil birleştirme yetkisi: ${pm ? "var" : "yok"}`, pc !== !!u.can_change_main && `ana profil değiştirme yetkisi: ${pc ? "var" : "yok"}`, pa !== !!u.can_change_accompany && `beraberindeki değiştirme yetkisi: ${pa ? "var" : "yok"}`].filter(Boolean);
    res.flash("ok", `${u.username}: ${changes.length ? changes.join(", ") + " kaydedildi" : "değişiklik yok"}.`);
    res.go(userBack(u));
  } catch (e) { next(e); }
});

router.post("/admin/users/:id/email", staffOwn, checkCsrf, async (req, res, next) => {
  try {
    const u = await loadUser(req, res); if (!u) return;
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { res.flash("error", "Geçerli bir e-posta girin."); return res.go(userBack(u)); }
    await db.query("UPDATE users SET email=$2 WHERE id=$1", [u.id, email]);
    res.flash("ok", `${u.username} e-postası kaydedildi.`);
    res.go(userBack(u));
  } catch (e) { next(e); }
});

router.post("/admin/users/:id/toggle", staffOwn, checkCsrf, async (req, res, next) => {
  try {
    const u = await loadUser(req, res); if (!u) return;
    if (String(u.id) === String(req.user.id)) { res.flash("error", "Kendi hesabınızı pasifleştiremezsiniz."); return res.go(userBack(u)); }
    await db.query("UPDATE users SET active=NOT active, failed_logins=0, locked_until=NULL WHERE id=$1", [u.id]);
    res.flash("ok", `${u.email || u.username} ${u.active ? "pasifleştirildi" : "aktifleştirildi"}.`);
    res.go(userBack(u));
  } catch (e) { next(e); }
});

// Otel kullanıcısının doğrulama yöntemi: "" (genel ayar) · email (e-posta kodu) · totp (Authenticator). Kapatma seçeneği yoktur.
router.post("/admin/users/:id/2fa", staffOwn, checkCsrf, async (req, res, next) => {
  try {
    const u = await loadUser(req, res); if (!u) return;
    if (u.role !== "hotel") return res.go(userBack(u));
    const m = String(req.body.mode || "");
    const mode = m === "totp" ? "totp" : null; // null = e-posta kodu (varsayılan)
    await db.query("UPDATE users SET two_factor_mode=$2 WHERE id=$1", [u.id, mode]);
    await db.query("DELETE FROM trusted_devices WHERE user_id=$1", [u.id]); // yöntem değişince hatırlanan cihazlar geçersiz olur
    const label = mode === "totp" ? "Authenticator" : "e-posta kodu";
    res.flash("ok", `${u.email || u.username}: doğrulama yöntemi ${label} olarak ayarlandı.`);
    res.go(userBack(u));
  } catch (e) { next(e); }
});

// Telefonu kaybolan / değişen yönetici: sonraki girişte QR ile yeniden kurar
// KBS bilgileri yetkisi: KBS kullanıcı adı / parola / TC kimlik no görme ve değiştirme (diğer kullanıcılar yalnız bağlanır)
router.post("/admin/users/:id/kbs-manage", staffOwn, checkCsrf, async (req, res, next) => {
  try {
    const u = await db.one("SELECT * FROM users WHERE id=$1 AND role<>'admin'", [Number(req.params.id) || 0]);
    if (!u) { res.flash("error", "Kullanıcı bulunamadı."); return res.go("/admin"); }
    const on = req.body.on === "1";
    await db.query("UPDATE users SET kbs_manage=$2 WHERE id=$1", [u.id, on]);
    res.flash("ok", `${u.username}: KBS bilgileri yetkisi ${on ? "verildi" : "kaldırıldı"}.`);
    res.go(userBack(u));
  } catch (e) { next(e); }
});

router.post("/admin/users/:id/totp-reset", staffOwn, checkCsrf, async (req, res, next) => {
  try {
    const u = await loadUser(req, res); if (!u) return;
    await db.query("UPDATE users SET totp_enc=NULL, totp_last_step=0, failed_logins=0, locked_until=NULL WHERE id=$1", [u.id]);
    await db.query("DELETE FROM trusted_devices WHERE user_id=$1", [u.id]);
    res.flash("ok", `${u.email || u.username} için Authenticator sıfırlandı; sonraki girişte yeniden kuracak.`);
    res.go(userBack(u));
  } catch (e) { next(e); }
});

router.post("/admin/users/:id/delete", staffOwn, checkCsrf, async (req, res, next) => {
  try {
    const u = await loadUser(req, res); if (!u) return;
    if (String(u.id) === String(req.user.id)) { res.flash("error", "Kendi hesabınızı silemezsiniz."); return res.go(userBack(u)); }
    if (await audit.userHasActivity(u)) {
      res.flash("error", `${u.email || u.username} silinemez: kullanıcı hareketi var (giriş, işlem ya da KBS kaydı). Gerekirse pasifleştirin.`);
      return res.go(userBack(u));
    }
    await db.query("DELETE FROM users WHERE id=$1", [u.id]);
    res.flash("ok", `${u.email || u.username} silindi.`);
    res.go(userBack(u));
  } catch (e) { next(e); }
});

router.post("/admin/admins", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!google.allowedEmail(email)) { res.flash("error", `Yalnız ${google.config().domains.map(d => "@" + d).join(", ")} hesapları yönetici olabilir.`); return res.go("/admin#yoneticiler"); }
    if (await db.one("SELECT 1 FROM users WHERE lower(username)=$1 OR lower(email)=$1", [email])) { res.flash("error", `${email} zaten kayıtlı.`); return res.go("/admin#yoneticiler"); }
    await db.query("INSERT INTO users(username,email,role) VALUES($1,$1,'admin')", [email]);
    res.flash("ok", `${email} yönetici olarak eklendi; Protel yönetici girişiyle girebilir.`);
    res.go("/admin#yoneticiler");
  } catch (e) { next(e); }
});

/* ── Protel yönetim: kurulum ── */
router.post("/admin/mail", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    await saveSmtp(req);
    res.flash("ok", "E-posta ayarları kaydedildi.");
    res.go("/admin#mail");
  } catch (e) { next(e); }
});

// E-posta ayarları ve davetiye bağlantılarındaki uygulama adresi aynı formdan kaydedilir
async function saveSmtp(req) {
  const prev = await mailer.smtpConfig();
  const b = req.body;
  const url = String(b.app_url || "").trim().replace(/\/+$/, "");
  if (/^https?:\/\/[^\s]+$/.test(url)) await db.setSetting("app_url", url);
  await db.setSetting("smtp_enc", sec.encryptJson({
    host: String(b.host || "").trim(),
    port: Number(b.port) || 587,
    security: ["starttls", "ssl", "none"].includes(b.security) ? b.security : "starttls",
    username: String(b.username || "").trim(),
    password: String(b.password || "") || prev.password || "",
    sender: String(b.sender || "").trim(),
    sender_name: String(b.sender_name || "").trim() || "SnapPass",
  }));
}

router.post("/admin/mail/test", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    await saveSmtp(req);
    const to = req.user.email || req.user.username;
    try {
      await mailer.sendMail({ to, subject: "SnapPass test e-postası", text: "SMTP ayarları çalışıyor.", html: "<p>SMTP ayarları çalışıyor.</p>" });
      res.flash("ok", `Test e-postası ${to} adresine gönderildi.`);
    } catch (e) {
      res.flash("error", `Test e-postası gönderilemedi: ${e.message}`);
    }
    res.go("/admin#mail");
  } catch (e) { next(e); }
});

// Uygulamanın varsayılan dili (kullanıcı kendi dilini seçmediyse); kurulumdan değiştirilir
let langCache = { v: "tr", t: 0 };
async function defaultLang() {
  if (Date.now() - langCache.t < 15000) return langCache.v;
  const v = (await db.getSetting("default_lang")) === "en" ? "en" : "tr";
  langCache = { v, t: Date.now() };
  return v;
}

// KBS gönderim kayıtlarının saklama süresi (ay). Süre dolunca kayıtlar silinir; varsayılan 36 ay.
const kbsRetentionMonths = async () => { const v = parseInt(await db.getSetting("kbs_retention_months"), 10); return v >= 12 && v <= 240 ? v : 36; };
async function purgeKbsRecords() {
  try {
    const months = await kbsRetentionMonths();
    const r = await db.query("DELETE FROM kbs_submissions WHERE created_at < now() - make_interval(months => $1::int)", [months]);
    if (r.rowCount) console.log(`[KBS] saklama süresi (${months} ay) dolan ${r.rowCount} gönderim kaydı silindi`);
  } catch (e) { console.warn("[KBS] kayıt temizliği yapılamadı:", e.message); }
}
router.post("/admin/retention", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    const m = parseInt(req.body.months, 10);
    if (!(m >= 12 && m <= 240)) { res.flash("error", "Saklama süresi 12 ile 240 ay arasında olmalı."); return res.go("/admin#retention"); }
    await db.setSetting("kbs_retention_months", String(m));
    res.flash("ok", `KBS gönderim kayıtları ${m} ay saklanacak (${(m / 12).toFixed(m % 12 ? 1 : 0)} yıl). Süresi dolanlar günde bir silinir.`);
    res.go("/admin#retention");
  } catch (e) { next(e); }
});

router.post("/admin/language", requireAdmin, checkCsrf, async (req, res, next) => {
  try {
    const lang = req.body.lang === "en" ? "en" : "tr";
    await db.setSetting("default_lang", lang);
    langCache = { v: lang, t: Date.now() };
    res.flash("ok", `Varsayılan dil ${lang === "en" ? "English" : "Türkçe"} olarak kaydedildi.`);
    res.go("/admin#language");
  } catch (e) { next(e); }
});

// İki adımlı doğrulama otel bazındadır: açıkken otel kullanıcıları paroladan sonra e-postayla gelen kodu da girer
router.post("/admin/hotels/:id/two-factor", staffOwn, checkCsrf, async (req, res, next) => {
  try {
    const hotel = await loadHotel(req, res); if (!hotel) return;
    const on = req.body.enabled === "1";
    if (on && !mailer.smtpReady(await mailer.smtpConfig())) { res.flash("error", "Önce Ayarlar'da e-posta ayarlarını girin."); return res.go(`/admin/hotels/${hotel.id}`); }
    await db.query("UPDATE hotels SET two_factor=$2 WHERE id=$1", [hotel.id, on]);
    res.flash("ok", `${hotel.name}: iki adımlı doğrulama ${on ? "açıldı" : "kapatıldı"}.`);
    res.go(`/admin/hotels/${hotel.id}`);
  } catch (e) { next(e); }
});

/* ── Tarama uygulaması (SPA) ── */
const scanHotelId = (req) => (req.user?.role === "admin" ? req.session.scan_hotel_id : req.user?.hotel_id);

/* ── Rehberler (docs/): kullanıcı rehberi giriş yapmış herkese, kurulum rehberi yalnız Protel yöneticilerine. Yazdırılabilir (PDF). ── */
const DOCS_DIR = path.join(__dirname, "..", "docs");
const sendDoc = (file) => (req, res) => res.set("Cache-Control", "no-cache").sendFile(path.join(DOCS_DIR, file));
router.get("/yardim", requireUser, sendDoc("kullanici.html"));
router.get("/yardim/doc.css", requireUser, sendDoc("doc.css"));
router.get("/admin/kurulum-rehberi", requireAdmin, sendDoc("kurulum.html"));
router.get("/admin/ohip-rehberi", requireAdmin, sendDoc("ohip.html"));
router.get("/admin/ohip-sihirbazi", requireAdmin, (req, res) => {
  const ref = String(req.get("referer") || "");
  let back = "/admin#oteller";
  try { const u = new URL(ref); if (u.host === req.get("host") && u.pathname.startsWith("/admin") && !u.pathname.includes("ohip-sihirbazi")) back = u.pathname + u.search; } catch (_) {}
  res.page("OHIP Kurulum Sihirbazı", views.ohipWizardPage({ backUrl: back }));
});

router.get(["/", "/index.html"], requireUser, (req, res) => {
  if (!scanHotelId(req)) return res.go("/admin");
  res.saveSession();
  res.set("Cache-Control", "no-cache, no-store, must-revalidate").sendFile(INDEX_HTML);
});

// /api/* yalnız oturum açmış kullanıcıya
router.use("/api", (req, res, next) => {
  if (req.passiveMsg) { delete req.session.flash; return res.status(401).json({ error: req.passiveMsg, passive: req.passiveMsg, login: "/login" }); }
  if (!req.user || req.user.must_change) return res.status(401).json({ error: "Oturum yok", login: "/login" });
  next();
});

// Taramadaki otel ve bağlı olduğu zincir (OHIP tanımı zincirde)
const scanHotel = (req) => db.one(
  "SELECT h.*, c.name AS chain_title, c.ohip_enc AS chain_ohip_enc FROM hotels h LEFT JOIN chains c ON c.id=h.chain_id WHERE h.id=$1",
  [scanHotelId(req) || 0]);

router.get("/api/me", async (req, res, next) => {
  try {
    const hotel = await scanHotel(req);
    const o = sec.decryptJson(hotel?.chain_ohip_enc, {});
    res.saveSession();
    res.json({
      user: { id: req.user.id, hotelAdmin: !!req.user.hotel_admin, username: req.user.username, fullName: req.user.full_name || req.user.username, role: req.user.role, kbsReport: kbsCanReport(req), canMerge: profCan(req, "can_merge"), canChangeMain: profCan(req, "can_change_main"), canChangeAccompany: profCan(req, "can_change_accompany") },
      hotel: hotel ? { id: hotel.id, name: hotel.name, chainName: hotel.chain_title || hotel.chain_name || "", hotelCode: hotel.hotel_code || "", ohipEnv: o.env === "customer" ? "customer" : o.env === "partner" ? "partner" : "", kbsEnabled: !!hotel.kbs_enabled, kbsType: hotel.kbs_type === "jandarma" ? "jandarma" : "polis", kbsAuto: !!hotel.kbs_auto, kbsStopped: !!hotel.kbs_stopped, hostName: o.host || "", appKey: o.app_key || "" } : null,
      csrf: req.session.csrf,
    });
  } catch (e) { next(e); }
});

/* ─── KBS (Kimlik Bildirim Sistemi) giriş bilgileri ─────────────────────
   Otel başınadır (otelin tek KBS hesabı): kullanıcı adı, TC kimlik no, parola ve EGMSEC anahtarı şifreli saklanır.
   Yalnız yetkili kullanıcı (yönetim panelinde "KBS bilgileri" yetkisi verilen) ya da Protel yöneticisi görür / değiştirir;
   kullanıcı adı ve TC varsayılan olarak gizli gelir, düzenlerken açılır; parola ve anahtar hiç geri gönderilmez.
   Diğer kullanıcılar yalnız bağlanır (gerekirse EGMSEC kodunu girer). */
const kbsHotelOn = async (req) => { const h = await scanHotel(req); return !!(h && h.active && h.kbs_enabled); };
const kbsCsrf = (req) => sec.safeEqual(req.get("x-csrf") || "", req.session.csrf);
// KBS geçmişi (gönderim kayıtları raporu): yalnız yetkili otel kullanıcısı; Protel yöneticisi Kullanıcı arayüzü üzerinden
const kbsCanReport = (req) => req.user?.role === "admin" || !!req.user?.kbs_report;
// Profil işlemleri yetkisi (can_merge / can_change_main / can_change_accompany): Protel yöneticisi (Kullanıcı arayüzü) ya da yetki verilmiş otel kullanıcısı
const profCan = (req, flag) => req.user?.role === "admin" || !!req.user?.[flag];
const kbsCanManage = (req) => req.user?.role === "admin" || !!req.user?.kbs_manage;
const kbsCreds = async (hotelId) => {
  const row = hotelId ? await db.one("SELECT enc, birth_from_nat, updated_at, updated_by FROM kbs_hotel_credentials WHERE hotel_id=$1", [hotelId]) : null;
  return { row, c: row ? sec.decryptJson(row.enc, {}) : {} };
};
const maskMid = (v, keep = 3) => { const s = String(v || ""); return s.length <= keep * 2 ? "•••••" : s.slice(0, keep) + "•••••" + s.slice(-keep); };

router.get("/api/kbs/settings", async (req, res, next) => {
  try {
    if (!(await kbsHotelOn(req))) return res.status(403).json({ error: "Bu otelde KBS kapalı." });
    const hotel = await scanHotel(req);
    const { row, c } = await kbsCreds(hotel?.id);
    const canManage = kbsCanManage(req);
    const reveal = canManage && req.query.reveal === "1";
    res.json({
      kbsType: hotel?.kbs_type === "jandarma" ? "jandarma" : "polis", stopped: !!hotel?.kbs_stopped, canManage, configured: hotel?.kbs_type === "jandarma" ? !!(c.tcNo && c.tssKod && c.password) : !!(c.username && c.tcNo && c.password),
      tssKod: !canManage || !c.tssKod ? "" : reveal ? c.tssKod : maskMid(c.tssKod, 1),
      // yetkisiz kullanıcıya kullanıcı adı / TC hiç gönderilmez; yetkiliye gizli, düzenlerken açık
      username: !canManage || !c.username ? "" : reveal ? c.username : maskMid(c.username, 2), tcNo: !canManage || !c.tcNo ? "" : reveal ? c.tcNo : maskMid(c.tcNo, 3),
      hasPassword: !!c.password, hasEgmsec: !!c.egmsec, birthFromNat: !!row?.birth_from_nat, updatedAt: row?.updated_at || null, updatedBy: row?.updated_by || "",
    });
  } catch (e) { next(e); }
});

router.put("/api/kbs/settings", async (req, res, next) => {
  try {
    if (!(await kbsHotelOn(req))) return res.status(403).json({ error: "Bu otelde KBS kapalı." });
    if (!kbsCsrf(req)) return res.status(400).json({ error: "Geçersiz istek. Sayfayı yenileyin." });
    if (!kbsCanManage(req)) return res.status(403).json({ error: "KBS bilgilerini değiştirme yetkiniz yok." });
    const hotel = await scanHotel(req);
    const { c: old } = await kbsCreds(hotel.id);
    const b = req.body || {};
    const username = String(b.username ?? "").trim().slice(0, 100);
    const tcNo = String(b.tcNo ?? "").replace(/\s/g, "");
    const password = b.password ? String(b.password).slice(0, 200) : (old.password || "");
    // EGMSEC gizli anahtarı: boş bırakılırsa eskisi korunur; clearEgmsec ile silinir; geçersizse reddedilir
    let egmsec = old.egmsec || "";
    if (b.clearEgmsec === true) egmsec = "";
    else if (String(b.egmsec || "").trim()) {
      if (!require("./totp").parseSecretInput(b.egmsec)) return res.status(400).json({ error: "EGMSEC anahtarı geçersiz (Base32 anahtar ya da otpauth:// adresi olmalı)." });
      egmsec = String(b.egmsec).trim().slice(0, 500);
    }
    const isJ = hotel.kbs_type === "jandarma";
    // Jandarma: kullanıcı adı yok; tesis kodu gerekir. Boş ya da maskeli ("•") gelirse eski tesis kodu korunur.
    let tssKod = String(b.tssKod ?? "").replace(/\s/g, "");
    if (isJ && (!tssKod || /•/.test(tssKod))) tssKod = old.tssKod || "";
    if (!isJ && !username) return res.status(400).json({ error: "Kullanıcı adı gerekli." });
    if (isJ && !/^\d{1,12}$/.test(tssKod)) return res.status(400).json({ error: "Tesis kodu rakamlardan oluşmalı." });
    if (!/^\d{11}$/.test(tcNo)) return res.status(400).json({ error: "TC kimlik no 11 haneli olmalı." });
    if (!password) return res.status(400).json({ error: "Parola gerekli." });
    const birthFromNat = b.birthFromNat === true;
    await db.query(
      "INSERT INTO kbs_hotel_credentials(hotel_id,enc,birth_from_nat,updated_at,updated_by) VALUES($1,$2,$3,now(),$4) ON CONFLICT(hotel_id) DO UPDATE SET enc=EXCLUDED.enc, birth_from_nat=EXCLUDED.birth_from_nat, updated_at=now(), updated_by=EXCLUDED.updated_by",
      [hotel.id, sec.encryptJson(isJ ? { username: "", tcNo, tssKod, password, egmsec: "" } : { username, tcNo, password, egmsec }), birthFromNat, req.user.username || req.user.email || ""]);
    res.json({ ok: true, hasPassword: true, hasEgmsec: !!egmsec, birthFromNat });
  } catch (e) { next(e); }
});

// KBS oturumu (lib/kbs.js): bağlan → (EGMSEC kodu) → hazır. Yanlış parola ile hesabın kilitlenmemesi için deneme aralığı sınırlıdır.
const kbsClient = require("./kbs");
const jandarma = require("./jandarma");
const kbsLastTry = new Map();
// Jandarma KBS oturumsuzdur (her çağrıda TC + tesis kodu + şifre): "bağlantı" yalnız bilgilerin bir okuma çağrısıyla doğrulanmasıdır
const jState = new Map(); // oturum anahtarı → { state: ready|connecting|error, error, at, by, since }
const isJandarma = async (req) => (await scanHotel(req))?.kbs_type === "jandarma";
const kbsStopped = async (req) => !!(await scanHotel(req))?.kbs_stopped; // Protel yöneticisi KBS bağlantısını durdurdu: hiçbir KBS isteği yapılmaz
const kbsStoppedMsg = "KBS bağlantısı Protel yöneticisi tarafından durduruldu.";
const jCreds = async (req) => { const { c } = await kbsCreds(scanHotelId(req)); return c.tcNo && c.tssKod && c.password ? c : null; };
// KBS oturumu otel başınadır: otelde biri bağlanınca o otelin tüm kullanıcıları (ve Kullanıcı arayüzündeki yönetici) aynı oturumu kullanır.
// Bağlanırken bağlanan kullanıcının kendi KBS bilgileri kullanılır; gönderimler yine kimin yaptığıyla kaydedilir.
const kbsKey = (req) => { const h = scanHotelId(req); return h ? "h" + h : "u" + req.user.id; };

/* Otomatik yeniden bağlanma: oturum düşmüşse (boşta kalma, KBS tarafında sonlanma, sunucu yeniden başlaması) ve otelde EGMSEC anahtarı
   kayıtlıysa, KBS paneli açıldığında / liste istendiğinde arka planda yeniden bağlanılır (kod anahtardan üretilir, kullanıcıdan bir şey istenmez).
   Hesap kilitlenmesin diye: en çok 5 dakikada bir deneme; art arda 2 başarısızlıkta durur (elle "KBS'ye bağlan" sayacı sıfırlar);
   "failed" (parola/kod reddi) durumunda hiç denenmez. */
const kbsAuto = new Map(); // oturum anahtarı → { last, fails }
const KBS_AUTO_GAP_MS = 5 * 60 * 1000, KBS_AUTO_MAX_FAILS = 2;
async function kbsAutoReconnect(req) {
  try {
    if (await isJandarma(req) || await kbsStopped(req)) return;
    const key = kbsKey(req);
    if (kbsClient.registerStatus(key).state === "running") return; // EGMSEC kaydı sürerken yeniden bağlanma denenmez
    const st = kbsClient.status(key);
    if (st.state === "ready") { kbsAuto.delete(key); return; }
    if (st.state !== "none" && st.state !== "error") return; // bağlanıyor / kod bekliyor / reddedildi: dokunma
    const a = kbsAuto.get(key) || { last: 0, fails: 0 };
    if (a.fails >= KBS_AUTO_MAX_FAILS || Date.now() - a.last < KBS_AUTO_GAP_MS) return;
    const { c } = await kbsCreds(scanHotelId(req));
    if (!c.username || !c.tcNo || !c.password || !c.egmsec || !require("./totp").parseSecretInput(c.egmsec)) return;
    a.last = Date.now(); kbsAuto.set(key, a);
    console.log(`[KBS] ${key}: oturum yok, otomatik yeniden bağlanılıyor`);
    kbsClient.login(key, c, { by: "otomatik" });
    // sonucu izle (KBS yavaş olabilir): hazır → sayaç sıfır, değilse başarısızlık say
    let waited = 0;
    const iv = setInterval(() => {
      waited += 10;
      const s = kbsClient.status(key).state;
      if (s === "connecting" || s === "verifying") { if (waited < 900) return; }
      clearInterval(iv);
      if (s === "ready") kbsAuto.delete(key); else a.fails++;
    }, 10000);
    iv.unref();
  } catch (e) { console.warn("[KBS] otomatik yeniden bağlanma:", e.message); }
}

router.get("/api/kbs/status", async (req, res, next) => {
  try {
    if (!(await kbsHotelOn(req))) return res.status(403).json({ error: "Bu otelde KBS kapalı." });
    if (await kbsStopped(req)) return res.json({ state: "stopped", error: "", text: "", path: "", rejected: false, at: 0, by: "", since: null });
    if (await isJandarma(req)) {
      const s = jState.get(kbsKey(req)) || { state: "none" };
      const st = { state: s.state, error: s.error || "", text: "", path: "", rejected: false, at: s.at || 0, by: s.by || "", since: s.since || null };
      kbsReport(req, st);
      return res.json(st);
    }
    await kbsAutoReconnect(req);
    const st = kbsClient.status(kbsKey(req));
    kbsReport(req, st);
    res.json(st);
  } catch (e) { next(e); }
});

// KBS bağlantı sonucunu otel uyarısına yansıtır (başarısız/hata → uyarı, bağlandı → kapanır)
async function kbsReport(req, st) {
  try {
    const hotel = await scanHotel(req);
    const hotelCode = hotel?.hotel_code;
    if (!hotelCode) return;
    if (st.state === "failed" || st.state === "error") {
      const locked = /kilit/i.test(st.error || "");
      alerts.raise({ hotelCode, source: "kbs", code: locked ? "locked" : st.state, message: "KBS bağlantısı kurulamadı" + (st.error ? ": " + String(st.error).slice(0, 200) : ".") });
    } else if (st.state === "ready") alerts.resolve({ hotelCode, source: "kbs" });
  } catch (_) {}
}

// Uyarılar: otelin açık OHIP/KBS sorunları. Yalnız veritabanından okunur (OHIP'e çağrı yapmaz).
// Kullanıcı logu: bu otelin kullanıcı arayüzündeki işlemleri (tarih aralığı, bitiş dahil; varsayılan son 7 gün)
router.get("/api/logs", async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Oturum yok." });
    const hotelId = scanHotelId(req);
    if (!hotelId) return res.json({ items: [] });
    const day = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null;
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const to = day(req.query.to) || iso(new Date());
    const from = day(req.query.from) || iso(new Date(Date.now() - 6 * 86400000));
    const rows = await audit.list({ scope: "user", hotelId, from: from <= to ? from : to, to: from <= to ? to : from, limit: 1000 });
    res.json({ from, to, items: rows.map(r => ({ id: String(r.id), at: r.at, user: r.username, action: r.action, detail: r.detail })) });
  } catch (e) { next(e); }
});

// KBS bağlantı durumunu uyarı çanına yansıtır (yalnız bellekteki oturum durumuna bakar; KBS'ye istek göndermez).
// Polis KBS açık ve giriş bilgileri tanımlı otelde oturum yoksa (sunucu yeniden başlaması, oturumun düşmesi, hiç bağlanılmamış) uyarı açılır; bağlanınca kapanır.
// Jandarma'da oturum olmadığı için uyarı üretilmez.
async function kbsLinkAlert(hotel) {
  try {
    if (!hotel || !hotel.hotel_code || !hotel.active || !hotel.kbs_enabled || hotel.kbs_stopped || hotel.kbs_type === "jandarma") return;
    const st = kbsClient.status("h" + hotel.id).state;
    if (st === "ready") return alerts.resolve({ hotelCode: hotel.hotel_code, source: "kbs" });
    if (st !== "none") return; // bağlanıyor / kod bekliyor / hata: kendi uyarıları var (kbsReport)
    const { c } = await kbsCreds(hotel.id);
    if (!(c.username && c.tcNo && c.password)) return;
    alerts.raise({ hotelCode: hotel.hotel_code, source: "kbs", code: "none", message: "KBS'ye bağlı değilsiniz. KBS Bilgileri'nden bağlanın; bağlanana kadar bildirimler KBS'ye gitmez." });
  } catch (_) {}
}
router.get("/api/alerts", async (req, res, next) => {
  try {
    const hotel = await scanHotel(req);
    await kbsLinkAlert(hotel);
    res.json({ alerts: hotel?.hotel_code ? await alerts.list(hotel.hotel_code, req.user.id) : [] });
  } catch (e) { next(e); }
});
router.post("/api/alerts/seen", async (req, res, next) => {
  try {
    if (!kbsCsrf(req)) return res.status(400).json({ error: "Geçersiz istek. Sayfayı yenileyin." });
    await alerts.markSeen(req.user.id, req.body?.ids);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Kayıtlı anahtardan üretilen şu anki kod: kullanıcı EGMSEC uygulamasındakiyle karşılaştırıp doğru üretildiğini görür
router.get("/api/kbs/egmsec-preview", async (req, res, next) => {
  try {
    if (!(await kbsHotelOn(req))) return res.status(403).json({ error: "Bu otelde KBS kapalı." });
    if (!kbsCanManage(req)) return res.status(403).json({ error: "Yetkiniz yok." });
    const { c } = await kbsCreds(scanHotelId(req));
    const cfg = c.egmsec ? require("./totp").parseSecretInput(c.egmsec) : null;
    if (!cfg) return res.status(400).json({ error: "EGMSEC anahtarı kayıtlı değil." });
    // Kod ilk gösterildiğinde işlem kaydına yazılır (yenilemeler yazılmaz); kod hiçbir yere kaydedilmez
    if (req.query.log === "1") audit.log({ scope: "user", hotelId: scanHotelId(req), user: req.user, action: "EGMSEC kodu gösterildi", detail: "", ip: req.ip });
    res.set("Cache-Control", "no-store").json(require("./totp").codeNow(cfg));
  } catch (e) { next(e); }
});

/* EGMSEC anahtarını KBS'nin kayıt sayfasından üretir (yeni kayıt; kayıtlı hesapta yalnız "Kayıt Güncelle" ile).
   DİKKAT: Kayıt Güncelle hesabın eski anahtarını geçersiz kılar (telefondaki EGMSEC ve KBS'yi aynı hesapla kullanan başka programlar dahil).
   Yalnız KBS bilgileri yetkisi olan kullanıcı; açık onay ister; ad/soyad KBS kayıt formu içindir, saklanmaz. */
const kbsLastReg = new Map();
router.post("/api/kbs/egmsec-register", async (req, res, next) => {
  try {
    if (!(await kbsHotelOn(req))) return res.status(403).json({ error: "Bu otelde KBS kapalı." });
    if (!kbsCsrf(req)) return res.status(400).json({ error: "Geçersiz istek. Sayfayı yenileyin." });
    if (!kbsCanManage(req)) return res.status(403).json({ error: "KBS bilgilerini değiştirme yetkiniz yok." });
    const hotel = await scanHotel(req);
    if (hotel.kbs_type === "jandarma") return res.status(400).json({ error: "Jandarma KBS'de EGMSEC yoktur." });
    if (hotel.kbs_stopped) return res.status(403).json({ error: kbsStoppedMsg });
    const b = req.body || {};
    if (b.confirm !== true) return res.status(400).json({ error: "Onay gerekli." });
    const update = b.update === true;
    const firstName = String(b.firstName || "").trim().slice(0, 60), lastName = String(b.lastName || "").trim().slice(0, 60);
    if (!firstName || !lastName) return res.status(400).json({ error: "Ad ve soyad gerekli (KBS kullanıcısının adı ve soyadı)." });
    const { c } = await kbsCreds(hotel.id);
    if (!c.username || !c.tcNo || !c.password) return res.status(400).json({ error: "Önce KBS giriş bilgilerini kaydedin." });
    if (c.egmsec && !update) return res.status(400).json({ error: "Bu otelde zaten bir EGMSEC anahtarı kayıtlı. Yeniden üretmek için 'Kayıt Güncelle' seçeneğini işaretleyin." });
    const key = kbsKey(req);
    const last = kbsLastReg.get(key) || 0;
    if (Date.now() - last < 10 * 60 * 1000 && kbsClient.registerStatus(key).state !== "running") return res.status(429).json({ error: "Hesabın kilitlenmemesi için kayıt denemeleri arasında en az 10 dakika beklenir." });
    kbsLastReg.set(key, Date.now());
    const by = req.user.username || req.user.email || "", ip = req.ip, hotelId = hotel.id;
    const st = kbsClient.register(key, c, { firstName, lastName, update }, async (secret) => {
      const { c: cur } = await kbsCreds(hotelId);
      await db.query("UPDATE kbs_hotel_credentials SET enc=$2, updated_at=now(), updated_by=$3 WHERE hotel_id=$1", [hotelId, sec.encryptJson({ ...cur, egmsec: secret }), `${by} (EGMSEC kaydı)`]);
      kbsAuto.delete(key);
      audit.log({ scope: "user", hotelId, user: req.user, action: "EGMSEC anahtarı KBS'den oluşturuldu", detail: update ? "Kayıt Güncelle ile" : "Yeni kayıt", ip });
    });
    res.json(st);
  } catch (e) { next(e); }
});
router.get("/api/kbs/egmsec-register", async (req, res, next) => {
  try {
    if (!(await kbsHotelOn(req))) return res.status(403).json({ error: "Bu otelde KBS kapalı." });
    if (!kbsCanManage(req)) return res.status(403).json({ error: "Yetkiniz yok." });
    res.set("Cache-Control", "no-store").json(kbsClient.registerStatus(kbsKey(req)));
  } catch (e) { next(e); }
});

router.post("/api/kbs/connect", async (req, res, next) => {
  try {
    if (!(await kbsHotelOn(req))) return res.status(403).json({ error: "Bu otelde KBS kapalı." });
    if (!kbsCsrf(req)) return res.status(400).json({ error: "Geçersiz istek. Sayfayı yenileyin." });
    if (await kbsStopped(req)) return res.status(403).json({ error: kbsStoppedMsg });
    const last = kbsLastTry.get(kbsKey(req)) || 0;
    if (Date.now() - last < 15000) return res.status(429).json({ error: "Lütfen birkaç saniye bekleyip tekrar deneyin." });
    kbsLastTry.set(kbsKey(req), Date.now());
    kbsAuto.delete(kbsKey(req)); // elle bağlanma otomatik denemelerin sayacını sıfırlar
    if (await isJandarma(req)) {
      const creds = await jCreds(req);
      if (!creds) return res.status(400).json({ error: kbsCanManage(req) ? "Önce Jandarma KBS bilgilerini kaydedin." : "Bu otelin KBS bilgileri tanımlı değil. Yetkili kullanıcıya başvurun." });
      const key = kbsKey(req), by = req.user.username || req.user.email || "";
      jState.set(key, { state: "connecting", at: Date.now(), by });
      jandarma.test(key, creds).then(() => jState.set(key, { state: "ready", at: Date.now(), by, since: Date.now() }))
        .catch(e => jState.set(key, { state: "error", error: String(e.message || "Bağlanılamadı").slice(0, 200), at: Date.now(), by }));
      return res.json({ state: "connecting", text: "", error: "", by, at: Date.now() });
    }
    const { c } = await kbsCreds(scanHotelId(req));
    if (!c.username || !c.tcNo || !c.password) return res.status(400).json({ error: kbsCanManage(req) ? "Önce KBS bilgilerini kaydedin." : "Bu otelin KBS bilgileri tanımlı değil. Yetkili kullanıcıya başvurun." });
    const out = kbsClient.login(kbsKey(req), c, { by: req.user.username || req.user.email || "" });
    if (out.state === "error") kbsReport(req, out);
    res.json(out); // arka planda çalışır; durum /api/kbs/status ile izlenir
  } catch (e) { next(e); }
});

router.post("/api/kbs/otp", async (req, res, next) => {
  try {
    if (!(await kbsHotelOn(req))) return res.status(403).json({ error: "Bu otelde KBS kapalı." });
    if (!kbsCsrf(req)) return res.status(400).json({ error: "Geçersiz istek. Sayfayı yenileyin." });
    if (await kbsStopped(req)) return res.status(403).json({ error: kbsStoppedMsg });
    const code = String(req.body?.code ?? "").replace(/\s/g, "");
    if (!/^\d{4,10}$/.test(code)) return res.status(400).json({ error: "Kod yalnız rakamlardan oluşmalı." });
    try { res.json(kbsClient.submitCode(kbsKey(req), code)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  } catch (e) { next(e); }
});

router.post("/api/kbs/disconnect", async (req, res, next) => {
  try {
    if (!kbsCsrf(req)) return res.status(400).json({ error: "Geçersiz istek. Sayfayı yenileyin." });
    kbsClient.disconnect(kbsKey(req));
    jState.delete(kbsKey(req));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// KBS'de kayıtlı olduğu bilinen misafirler oda ve saatiyle işaretlenir (KBS'ye bir şey göndermez).
// Body: { action: "checkin" | "room" | "checkout", items: [{ profileId, fullName, idNo, passportNo, room, kbsId? }] } · kbsId: elle "aynı kişi" diye bağlanan KBS kaydı
router.post("/api/kbs/mark", async (req, res, next) => {
  try {
    if (!(await kbsHotelOn(req))) return res.status(403).json({ error: "Bu otelde KBS kapalı." });
    if (!kbsCsrf(req)) return res.status(400).json({ error: "Geçersiz istek. Sayfayı yenileyin." });
    const action = req.body?.action;
    if (!["checkin", "room", "checkout"].includes(action)) return res.status(400).json({ error: "Geçersiz işlem." });
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 2000) : [];
    if (!items.length) return res.status(400).json({ error: "Kayıt yok." });
    const hotel = await scanHotel(req);
    const str = (v, n = 100) => String(v ?? "").trim().slice(0, n);
    for (const it of items) {
      if (!str(it.profileId)) continue;
      await db.query(
        "INSERT INTO kbs_submissions(hotel_id,user_id,profile_id,full_name,first_name,last_name,id_no,passport_no,room,action,status,kbs_type,kbs_id,message) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'sent',$11,$12,$13)",
        [hotel.id, req.user.id, str(it.profileId), str(it.fullName), str(it.firstName), str(it.lastName), str(it.idNo, 11), str(it.passportNo, 50), str(it.room, 20), action, hotel.kbs_type === "jandarma" ? "jandarma" : "polis", /^[0-9a-f-]{36}$/i.test(str(it.kbsId, 40)) ? str(it.kbsId, 40) : "",
        // KBS'ye bir şey gönderilmedi: kayıtta bu açıkça yazar (rapor ve kanıt için)
        /^[0-9a-f-]{36}$/i.test(str(it.kbsId, 40)) ? "Elle KBS kaydıyla eşleştirildi (KBS'ye gönderilmedi)" : "Elle 'KBS'de kayıtlı' işaretlendi (KBS'ye gönderilmedi)"]);
    }
    console.log(`[KBS] işaretlendi: ${items.length} kayıt (${action})`);
    res.json({ ok: true, count: items.length });
  } catch (e) { next(e); }
});

// Gönderim kayıtları (başarılı / hatalı); son 30 gün, en yeni önce
// KBS geçmişi raporu: otelin tüm gönderim kayıtları (saklama süresi boyunca), kişi / tarih / oda ile aranabilir. Yalnız okuma; her görüntüleme Değişiklikler'e yazılır.
router.get("/api/kbs/report", async (req, res, next) => {
  try {
    if (!(await kbsHotelOn(req))) return res.status(403).json({ error: "Bu otelde KBS kapalı." });
    if (!kbsCanReport(req)) return res.status(403).json({ error: "KBS geçmişini görme yetkiniz yok." });
    const hotel = await scanHotel(req);
    const day = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null;
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let to = day(req.query.to) || iso(new Date()), from = day(req.query.from) || iso(new Date(Date.now() - 90 * 86400000));
    if (from > to) [from, to] = [to, from];
    const fold = (v) => String(v || "").toLocaleLowerCase("tr-TR").replace(/[ıİ]/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c").trim();
    const q = fold(String(req.query.q || "").slice(0, 80));
    const args = [hotel.id, from, to];
    let where = "s.hotel_id=$1 AND s.created_at >= $2::date AND s.created_at < ($3::date + 1)";
    if (q) { args.push("%" + q + "%"); const i = args.length;
      where += ` AND (translate(lower(s.full_name),'ıİşŞğĞüÜöÖçÇ','iissgguuoocc') LIKE $${i} OR s.id_no LIKE $${i} OR lower(s.passport_no) LIKE $${i} OR s.profile_id = $${i + 1} OR s.room = $${i + 1})`;
      args.push(String(req.query.q || "").trim().slice(0, 80)); }
    const rows = await db.all(
      `SELECT s.id, s.created_at, s.profile_id, s.full_name, s.id_no, s.passport_no, s.room, s.action, s.status, s.message, s.kbs_id, u.username
         FROM kbs_submissions s LEFT JOIN users u ON u.id=s.user_id WHERE ${where} ORDER BY s.created_at DESC LIMIT 3000`, args);
    audit.log({ scope: "user", hotelId: hotel.id, user: req.user, action: "KBS geçmişi raporu görüntülendi", detail: `${from} – ${to}${q ? " · aramalı" : ""} · ${rows.length} kayıt`, ip: req.ip });
    res.json({ from, to, hotelName: hotel.name, hotelCode: hotel.hotel_code || "", truncated: rows.length >= 3000,
      items: rows.map(x => ({ id: String(x.id), at: x.created_at, profileId: x.profile_id, fullName: x.full_name, idNo: x.id_no, passportNo: x.passport_no, room: x.room, action: x.action, status: x.status, message: x.message, kbsId: x.kbs_id || "", user: x.username || "" })) });
  } catch (e) { next(e); }
});

router.get("/api/kbs/submissions", async (req, res, next) => {
  try {
    if (!(await kbsHotelOn(req))) return res.status(403).json({ error: "Bu otelde KBS kapalı." });
    const hotel = await scanHotel(req);
    const r = await db.query(
      "SELECT id, profile_id, full_name, first_name, last_name, id_no, passport_no, room, action, status, message, kbs_id, created_at FROM kbs_submissions WHERE hotel_id=$1 AND kbs_type=$2 AND (created_at > now() - interval '30 days' OR id IN (SELECT max(id) FROM kbs_submissions WHERE hotel_id=$1 AND kbs_type=$2 GROUP BY profile_id)) ORDER BY created_at DESC LIMIT 5000",
      [hotel.id, hotel.kbs_type === "jandarma" ? "jandarma" : "polis"]);
    res.json({ items: r.rows.map(x => ({ id: x.id, profileId: x.profile_id, fullName: x.full_name, firstName: x.first_name, lastName: x.last_name, idNo: x.id_no, passportNo: x.passport_no, room: x.room, action: x.action, status: x.status, message: x.message, kbsId: x.kbs_id || "", at: x.created_at })) });
  } catch (e) { next(e); }
});

// KBS'ye doğrudan gönderim (Polis): giriş / oda değişimi / çıkış. Kullanıcının açık KBS oturumu kullanılır; sonuç kayda yazılır.
const kbsSend = require("./kbs-send");
const kbsSending = new Set(); // aynı kullanıcıdan eşzamanlı gönderimi engeller (tek oturum)
// KBS'deki aktif konaklayanlar (yalnız okuma): OPERA ile karşılaştırılıp çıkış bekleyenler bulunur. Kimlik/ad KBS'den maskeli gelir.
router.get("/api/kbs/active", async (req, res, next) => {
  try {
    if (!(await kbsHotelOn(req))) return res.status(403).json({ error: "Bu otelde KBS kapalı." });
    const hotel = await scanHotel(req);
    if (hotel.kbs_stopped) return res.json({ connected: false, stopped: true, items: [] });
    if (hotel.kbs_type === "jandarma") {
      const creds = await jCreds(req);
      if (!creds) return res.json({ connected: false, items: [] });
      try {
        const r = await jandarma.active(kbsKey(req), creds, { fresh: req.query.fresh === "1" });
        // Jandarma'da oturum yok: liste okunabildiyse bilgiler geçerlidir, "bağlantı" durumu da buna göre işaretlenir (sunucu yeniden başlasa da)
        const jk = kbsKey(req), prev = jState.get(jk);
        if (!prev || prev.state !== "ready") jState.set(jk, { state: "ready", at: Date.now(), by: prev?.by || "otomatik", since: prev?.since || Date.now() });
        return res.json({ connected: true, items: r.list, at: r.at });
      }
      catch (e) { return res.json({ connected: true, items: [], error: String(e.message || "").slice(0, 200) }); }
    }
    if (kbsClient.status(kbsKey(req)).state !== "ready") { await kbsAutoReconnect(req); return res.json({ connected: false, items: [] }); }
    try {
      const r = await kbsSend.active(kbsKey(req), { fresh: req.query.fresh === "1" });
      res.json({ connected: true, items: r.list, at: r.at });
    } catch (e) { res.json({ connected: kbsClient.status(kbsKey(req)).state === "ready", items: [], error: String(e.message || "").slice(0, 200) }); }
  } catch (e) { next(e); }
});

const kbsAutoSent = new Map(); // otel id → son otomatik gönderim zamanı
router.post("/api/kbs/send", async (req, res, next) => {
  try {
    if (!(await kbsHotelOn(req))) return res.status(403).json({ error: "Bu otelde KBS kapalı." });
    if (!kbsCsrf(req)) return res.status(400).json({ error: "Geçersiz istek. Sayfayı yenileyin." });
    const hotel = await scanHotel(req);
    if (hotel.kbs_stopped) return res.status(403).json({ error: kbsStoppedMsg });
    const isJ = hotel.kbs_type === "jandarma";
    const jcreds = isJ ? await jCreds(req) : null;
    if (isJ && !jcreds) return res.status(400).json({ error: "Jandarma KBS bilgileri tanımlı değil." });
    const action = req.body?.action;
    if (!["checkin", "room", "checkout"].includes(action)) return res.status(400).json({ error: "Geçersiz işlem." });
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 50) : [];
    if (!items.length) return res.status(400).json({ error: "Kayıt yok." });
    // Otomatik gönderim (ekran kendiliğinden gönderir): yalnız otel ayarı AÇIKSA; tur başına en çok 10 kayıt, turlar arası en az 15 sn
    if (req.body?.auto === true) {
      if (!hotel.kbs_auto) return res.status(403).json({ error: "Bu otelde KBS otomatik gönderim kapalı." });
      if (items.length > 10) return res.status(400).json({ error: "Otomatik gönderimde tur başına en çok 10 kayıt." });
      const lastAuto = kbsAutoSent.get(hotel.id) || 0;
      if (Date.now() - lastAuto < 15000) return res.status(429).json({ error: "Otomatik gönderim turları arasında en az 15 saniye beklenir." });
      kbsAutoSent.set(hotel.id, Date.now());
    }
    if (!isJ && kbsClient.status(kbsKey(req)).state !== "ready") return res.status(400).json({ error: "KBS oturumu açık değil. KBS Bilgileri'nden bağlanın." });
    if (kbsSending.has(kbsKey(req))) return res.status(429).json({ error: "Önceki gönderim sürüyor." });
    kbsSending.add(kbsKey(req));
    try {
      const str = (v, n = 100) => String(v ?? "").trim().slice(0, n);
      const clean = items.map(it => ({
        profileId: str(it.profileId), kind: it.kind === "tr" ? "tr" : "foreign", idNo: str(it.idNo, 11), docNo: str(it.docNo, 50),
        firstName: str(it.firstName), lastName: str(it.lastName), countryId: Number(it.countryId) || 0, gender: str(it.gender, 1), nationality: str(it.nationality, 2).toUpperCase(),
        birthDate: str(it.birthDate, 10), birthPlace: str(it.birthPlace), room: str(it.room, 20), oldRoom: str(it.oldRoom, 20), kbsId: str(it.kbsId, 40),
      })).filter(it => it.profileId);
      const results = isJ ? await jandarma.run(kbsKey(req), jcreds, action, clean) : await kbsSend.run(kbsKey(req), action, clean);
      for (const r of results) {
        const it = clean.find(x => x.profileId === r.profileId) || {};
        await db.query(
          "INSERT INTO kbs_submissions(hotel_id,user_id,profile_id,full_name,first_name,last_name,id_no,passport_no,room,action,status,message,kbs_type,kbs_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$14,$13)",
          // KBS'nin yanıt mesajı ve (varsa) kayıt kimliği başarılı gönderimde de saklanır: sonradan kanıt olarak gösterilebilir
          [hotel.id, req.user.id, it.profileId, `${it.firstName} ${it.lastName}`.trim(), it.firstName, it.lastName, it.kind === "tr" ? it.idNo : "", it.kind === "tr" ? "" : it.docNo, it.room, action, r.ok ? "sent" : "error", r.message || "", r.ok ? (r.kbsId || it.kbsId || "") : "", isJ ? "jandarma" : "polis"]);
      }
      console.log(`[KBS] gönderim: ${action} ${results.filter(r => r.ok).length}/${results.length} başarılı`);
      res.json({ results });
    } finally { kbsSending.delete(kbsKey(req)); }
  } catch (e) { next(e); }
});

// KBS tipi (polis / jandarma) yalnız yönetim panelinden değişir: POST /admin/hotels/:id/kbs-type

// Token zincir bazında bellekte tutulur (aynı OHIP tanımı); süresi dolmadan tekrar OHIP'e gidilmez
const tokenCache = new Map();

router.post("/api/opera/token", async (req, res) => {
  try {
    const hotel = await scanHotel(req);
    if (!hotel || !hotel.active) return res.status(400).json({ error: "Otel seçili değil ya da pasif." });
    if (!hotel.chain_id || !hotel.hotel_code) return res.status(400).json({ error: "Otel bir Enterprise'a bağlı değil ya da HotelId tanımlı değil." });
    const missing = ohip.missingFields(sec.decryptJson(hotel.chain_ohip_enc, {}));
    if (missing.length) return res.status(400).json({ error: `Enterprise'ın OHIP tanımları eksik: ${missing.join(", ")}` });
    const token = await chainToken({ id: hotel.chain_id, ohip_enc: hotel.chain_ohip_enc }, { force: !!req.body?.force });
    res.json({ access_token: token });
  } catch (e) {
    console.error("[OHIP]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// OPERA iş günü (business date): gün sonu (End of Day) çalışana kadar takvim gününden geride olabilir.
// "Bugün giriş / çıkış" gibi gün karşılaştırmaları bununla yapılır. Otel başına 5 dk önbellek.
const businessDateCache = new Map(); // hotelId -> { at, date }
router.get("/api/opera/business-date", async (req, res) => {
  try {
    const hotel = await scanHotel(req);
    if (!hotel || !hotel.active || !hotel.chain_id || !hotel.hotel_code) return res.json({ date: null });
    const c = businessDateCache.get(String(hotel.id));
    if (c && Date.now() - c.at < 5 * 60000) return res.json({ date: c.date });
    const cfg = sec.decryptJson(hotel.chain_ohip_enc, {});
    if (ohip.missingFields(cfg).length) return res.json({ date: null });
    const token = await chainToken({ id: hotel.chain_id, ohip_enc: hotel.chain_ohip_enc });
    const r = await fetch(`${cfg.host.replace(/\/+$/, "")}/bof/v1/hotels/${encodeURIComponent(hotel.hotel_code)}/businessDate`, {
      headers: { "Content-Type": "application/json", "x-hotelid": hotel.hotel_code, "x-app-key": cfg.app_key, Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => null);
    const date = (j?.hotels || []).find(h => String(h.hotelId).toUpperCase() === hotel.hotel_code.toUpperCase())?.businessDate || j?.hotels?.[0]?.businessDate || null;
    if (!r.ok || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) { console.warn("[OHIP] iş günü okunamadı:", r.status); return res.json({ date: null }); }
    businessDateCache.set(String(hotel.id), { at: Date.now(), date });
    res.json({ date });
  } catch (e) { console.warn("[OHIP] iş günü:", e.message); res.json({ date: null }); }
});

/* ─── Profil işlemleri (OPERA): birleştirme, rezervasyonun ana profilini ve beraberindeki profilini değiştirme ───────────
   Üçü de ayrı kullanıcı yetkisi ister (can_merge / can_change_main / can_change_accompany); Protel yöneticisi (Kullanıcı arayüzü) hepsini yapabilir.
   OHIP adresi, anahtarı ve jetonu sunucuda otelin tanımından alınır (istemciden gelmez). Rezervasyonda YALNIZ misafir listesi (reservationGuests) değişir:
   oda, tarih, ücret ve yetişkin/çocuk sayısı gönderilmez. Her işlem işlem kaydına yalnız profil / rezervasyon numaralarıyla yazılır. */
async function operaCtx(req) {
  const hotel = await scanHotel(req);
  if (!hotel || !hotel.active || !hotel.chain_id || !hotel.hotel_code) throw Object.assign(new Error("Otel seçili değil ya da OPERA tanımı yok."), { status: 400 });
  const cfg = sec.decryptJson(hotel.chain_ohip_enc, {});
  if (ohip.missingFields(cfg).length) throw Object.assign(new Error("Enterprise'ın OHIP tanımları eksik."), { status: 400 });
  const token = await chainToken({ id: hotel.chain_id, ohip_enc: hotel.chain_ohip_enc });
  return { hotel, base: cfg.host.replace(/\/+$/, ""), headers: { "Content-Type": "application/json", "x-hotelid": hotel.hotel_code, "x-app-key": cfg.app_key, Authorization: `Bearer ${token}` } };
}
const idOk = (v) => /^\d{1,20}$/.test(String(v || ""));
const operaError = (status, text) => {
  let d = {}; try { d = JSON.parse(text); } catch (_) {}
  return String(d.detail || d.title || d["o:errorDetails"]?.[0]?.detail || text || `HTTP ${status}`).slice(0, 300);
};
function profileGate(req, res, flag, what) {
  if (!kbsCsrf(req)) { res.status(400).json({ error: "Geçersiz istek. Sayfayı yenileyin." }); return false; }
  if (!profCan(req, flag)) { res.status(403).json({ error: `${what} yetkiniz yok. Protel yöneticisinden isteyin.` }); return false; }
  return true;
}

// Profil numarası değişince SnapPass'ın KBS gönderim kayıtları yeni numaraya bağlanır; yoksa misafir "gönderilmemiş" görünür (çift giriş riski) ya da eski numara "çıkacak" sanılır.
// recentOnly: profil başka konaklamalarda da duruyorsa yalnız son 30 günün kayıtları taşınır (rezervasyon değişikliği); birleşmede eski profil yok olduğu için hepsi taşınır.
async function relinkKbs(hotelId, oldId, newId, recentOnly) {
  try {
    const r = await db.query(`UPDATE kbs_submissions SET profile_id=$3 WHERE hotel_id=$1 AND profile_id=$2${recentOnly ? " AND created_at > now() - interval '30 days'" : ""}`, [hotelId, String(oldId), String(newId)]);
    return r.rowCount || 0;
  } catch (e) { console.warn("[KBS] profil bağlama:", e.message); return 0; }
}
const nm = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 60);

// Birleştirme: kalan (survivor) profil yolda, birleşip kaybolan (victim) gövdede. OPERA'da geri alınamaz.
router.post("/api/profile-merge", async (req, res) => {
  try {
    if (!profileGate(req, res, "can_merge", "Profilleri birleştirme")) return;
    const { survivorId, victimId } = req.body || {};
    if (!idOk(survivorId) || !idOk(victimId) || String(survivorId) === String(victimId)) return res.status(400).json({ error: "Geçerli iki farklı profil numarası gerekli." });
    const { base, headers, hotel } = await operaCtx(req);
    const r = await fetch(`${base}/crm/v1/profiles/${survivorId}/merges`, { method: "POST", headers, body: JSON.stringify({ victimProfileId: { id: String(victimId) } }), signal: AbortSignal.timeout(60000) });
    const text = await r.text();
    console.log(`[MERGE] kalan=${survivorId} giden=${victimId} → HTTP ${r.status}`);
    if (!r.ok) return res.status(502).json({ error: `OPERA birleştirmeyi reddetti: ${operaError(r.status, text)}` });
    const relinked = await relinkKbs(hotel.id, victimId, survivorId, false);
    const sN = nm(req.body.survivorName), vN = nm(req.body.victimName);
    res.json({ ok: true, survivorId: String(survivorId), victimId: String(victimId), relinked,
      detail: `Kalan #${survivorId}${sN ? " " + sN : ""} ← birleşen #${victimId}${vN ? " " + vN : ""} · KBS kaydı ${relinked} adet yeni numaraya bağlandı${idOk(req.body.reservationId) ? " · rezervasyon #" + req.body.reservationId : ""}` });
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

// Rezervasyonun misafir listesini değiştirir. mode "main": ana (birincil) profil newProfileId olur, beraberindekiler korunur.
// mode "accompany": oldProfileId beraberindekilerden çıkarılır, newProfileId eklenir; ana profil ve diğer beraberindekiler korunur.
router.post("/api/reservation-profile", async (req, res) => {
  try {
    const b = req.body || {};
    const mode = b.mode === "main" ? "main" : b.mode === "accompany" ? "accompany" : "";
    if (!mode) return res.status(400).json({ error: "Geçersiz işlem." });
    if (!profileGate(req, res, mode === "main" ? "can_change_main" : "can_change_accompany", mode === "main" ? "Rezervasyonun ana profilini değiştirme" : "Beraberindeki profilini değiştirme")) return;
    if (!idOk(b.reservationId) || !idOk(b.newProfileId)) return res.status(400).json({ error: "Rezervasyon ve profil numaraları geçerli olmalı." });
    if (mode === "accompany" && !idOk(b.oldProfileId)) return res.status(400).json({ error: "Değiştirilecek beraberindeki profil numarası gerekli." });
    const newId = String(b.newProfileId), oldId = String(b.oldProfileId || "");
    const { base, headers, hotel } = await operaCtx(req);
    // Rezervasyonun GÜNCEL misafir listesi OPERA'dan okunur (istemciden gelen eski liste kullanılmaz)
    const cur = await fetch(`${base}/rsv/v1/hotels/${encodeURIComponent(hotel.hotel_code)}/reservations/${encodeURIComponent(b.reservationId)}`, { headers, signal: AbortSignal.timeout(60000) });
    if (!cur.ok) return res.status(502).json({ error: `Rezervasyon okunamadı: ${operaError(cur.status, await cur.text())}` });
    const rg = (await cur.json())?.reservations?.reservation?.[0]?.reservationGuests;
    const rgList = [].concat(rg ?? []).map(x => ({ id: [].concat(x?.profileInfo?.profileIdList ?? []).find(p => p.type === "Profile")?.id, primary: x?.primary === true || x?.primary === "true" })).filter(x => x.id);
    if (!rgList.length) return res.status(502).json({ error: "Rezervasyonun misafir listesi okunamadı." });
    const mainEntry = rgList.find(x => x.primary) || rgList[0];
    const mainId = String(mainEntry.id), accIds = rgList.filter(x => x !== mainEntry).map(x => String(x.id));
    if (mode === "main" && newId === mainId) return res.status(400).json({ error: "Bu profil zaten rezervasyonun ana profili." });
    if (mode === "accompany" && !accIds.includes(oldId)) return res.status(400).json({ error: "Değiştirilecek profil rezervasyonda beraberindeki olarak görünmüyor; sayfayı yenileyin." });
    if (mode === "accompany" && (newId === mainId || accIds.includes(newId))) return res.status(400).json({ error: "Bu profil zaten rezervasyonda kayıtlı." });
    const g = (id, primary) => ({ profileInfo: { profileIdList: [{ type: "Profile", id }], profile: {} }, ...(primary === false ? { primary: false } : {}) });
    const guests = mode === "main"
      ? [g(newId), ...accIds.filter(x => x !== newId).map(x => g(x, false))]
      : [g(mainId), ...accIds.filter(x => x !== oldId).map(x => g(x, false)), g(newId, false)];
    const body = { reservations: [{ reservationIdList: [{ type: "Reservation", id: String(b.reservationId) }], reservationGuests: guests }] }; // yalnız misafir listesi
    const r = await fetch(`${base}/rsv/v1/hotels/${encodeURIComponent(hotel.hotel_code)}/reservations/${encodeURIComponent(b.reservationId)}`, { method: "PUT", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const text = await r.text();
    console.log(`[RSV-PROFIL] ${mode} rezervasyon=${b.reservationId} → HTTP ${r.status}`);
    if (!r.ok) return res.status(502).json({ error: `OPERA rezervasyonu güncellemedi: ${operaError(r.status, text)}` });
    const leaving = mode === "main" ? mainId : oldId;
    const relinked = await relinkKbs(hotel.id, leaving, newId, true);
    const fmt = (a) => a.length ? a.map(x => "#" + x).join(",") : "yok";
    const after = mode === "main" ? [newId, ...accIds.filter(x => x !== newId)] : [mainId, ...accIds.filter(x => x !== oldId), newId];
    const nN = nm(b.newName), oN = nm(b.oldName);
    res.json({ ok: true, mode, reservationId: String(b.reservationId), relinked,
      detail: `${mode === "main" ? "Ana profil" : "Beraberindeki"} · rezervasyon #${b.reservationId} · #${leaving}${oN ? " " + oN : ""} → #${newId}${nN ? " " + nN : ""} · önce: ana #${mainId}, beraberindeki ${fmt(accIds)} · sonra: ana #${after[0]}, beraberindeki ${fmt(after.slice(1))} · KBS kaydı ${relinked} adet bağlandı` });
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

// Bulut MRZ okuma (lib/ocr.js: yerleşik Tesseract motoru ya da SnapPass.Service). Motor yoksa 503 döner.
router.post("/api/mrz/scan", async (req, res) => {
  if (!ocr.enabled()) return res.status(503).json({ error: "MRZ motoru yapılandırılmamış" });
  const image = String(req.body?.image || "");
  if (!image || image.length > 12 * 1024 * 1024) return res.status(400).json({ error: "Görüntü gerekli (en fazla 12 MB)" });
  try {
    const t0 = Date.now();
    const result = await ocr.scan({ imageBase64: image, engine: process.env.SNAPPASS_OCR_ENGINE || "tesseract" });
    console.log(`[MRZ] SnapPass motoru ${Date.now() - t0} ms, geçerli kontrol ${result.checksum?.validCount ?? 0}/${result.checksum?.totalCount ?? 0}`);
    res.json(result);
  } catch (e) {
    console.error("[MRZ]", e.message);
    res.status(502).json({ error: e.message });
  }
});

module.exports = { router, init: async () => { await db.init(); await alerts.init(); purgeKbsRecords(); setInterval(purgeKbsRecords, 24 * 3600 * 1000).unref(); }, kbsHotelOn };
