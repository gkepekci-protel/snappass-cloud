/* İşlem logu: kim, ne zaman, ne yaptı.
   - user: kullanıcı arayüzündeki işlemler (otel bazında; tarama uygulamasında görünür)
   - admin: Protel yönetim panelindeki işlemler (yönetim panelinde görünür)
   Misafir verisi: yalnız profil kaydındaki değişen alanların eski → yeni değeri yazılır; diğer işlemlerde yalnız profil / rezervasyon numaraları ve sayılar. */
const db = require("./db");

const str = (v, n = 300) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

async function log({ scope, hotelId = null, user = null, action, detail = "", ip = "" }) {
  try {
    await db.query(
      "INSERT INTO audit_log(scope, hotel_id, user_id, username, action, detail, ip) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [scope, hotelId || null, user?.id || null, str(user?.username || user?.email || "", 120), str(action, 120), str(detail, 600), str(ip, 60)]);
  } catch (e) { console.warn("[LOG] yazılamadı:", e.message); }
}

// Liste: tarih aralığı (YYYY-MM-DD, bitiş dahil); en yeni önce
async function list({ scope, hotelId, from, to, limit = 500 }) {
  const args = [scope, from, to];
  let where = "scope=$1 AND at >= $2::date AND at < ($3::date + 1)";
  if (hotelId) { args.push(hotelId); where += ` AND hotel_id=$${args.length}`; }
  args.push(Math.min(Number(limit) || 500, 2000));
  return db.all(
    `SELECT a.id, a.at, a.username, a.action, a.detail, a.hotel_id, h.name AS hotel_name, h.hotel_code
       FROM audit_log a LEFT JOIN hotels h ON h.id=a.hotel_id WHERE ${where} ORDER BY a.at DESC LIMIT $${args.length}`, args);
}

/* Otomatik kayıt: aşağıdaki uçlar başarıyla bitince log yazılır.
   Yönetim formları hata durumunda da yönlendirir; o istekte "error" uyarısı eklendiyse kayıt yazılmaz.
   Yönetim kaydının açıklaması formun "ok" mesajıdır (ör. "AKRA V: KBS tipi Polis olarak ayarlandı."). */
const A = (method, re, scope, action, detail) => ({ method, re, scope, action, detail });
const num = (v) => str(v, 40);
const stateTr = (o) => ({ ready: "bağlandı", otp: "EGMSEC kodu bekleniyor", connecting: "bağlanıyor", verifying: "kod doğrulanıyor", failed: "başarısız", error: "hata", none: "bağlı değil", stopped: "durduruldu" }[o?.state] || (o?.state ? String(o.state) : ""));
const RULES = [
  // Yönetim paneli
  A("POST", /^\/admin\/hotels\/new$/, "admin", "Otel eklendi"),
  A("POST", /^\/admin\/chains$/, "admin", "Enterprise eklendi"),
  A("POST", /^\/admin\/chains\/\d+\/ohip$/, "admin", "OHIP tanımları kaydedildi"),
  A("POST", /^\/admin\/chains\/\d+\/hotels$/, "admin", "Enterprise'a otel eklendi"),
  A("POST", /^\/admin\/chains\/\d+\/delete$/, "admin", "Enterprise silindi"),
  A("POST", /^\/admin\/hotels\/\d+\/chain$/, "admin", "Otel Enterprise'a bağlandı"),
  A("POST", /^\/admin\/hotels\/\d+\/active$/, "admin", "Otel aktif / pasif"),
  A("POST", /^\/admin\/hotels\/\d+\/kbs$/, "admin", "KBS açıldı / kapatıldı"),
  A("POST", /^\/admin\/hotels\/\d+\/chain-mode$/, "admin", "Zincir ayarı değişti"),
  A("POST", /^\/admin\/hotels\/\d+\/kbs-type$/, "admin", "KBS tipi değişti"),
  A("POST", /^\/admin\/hotels\/\d+\/kbs-auto$/, "admin", "KBS otomatik gönderim"),
  A("POST", /^\/admin\/hotels\/\d+\/kbs-stop$/, "admin", "KBS bağlantısı durdur / başlat"),
  A("POST", /^\/admin\/hotels\/\d+\/two-factor$/, "admin", "İki adımlı doğrulama"),
  A("POST", /^\/admin\/hotels\/\d+\/delete$/, "admin", "Otel silindi"),
  A("POST", /^\/admin\/hotels\/\d+\/scanner$/, "admin", "Kullanıcı arayüzü açıldı", () => "Protel yöneticisi otelin kullanıcı arayüzünü açtı"),
  A("POST", /^\/admin\/hotels\/\d+\/users$/, "admin", "Kullanıcı oluşturuldu"),
  A("POST", /^\/admin\/users\/\d+\/invite$/, "admin", "Davetiye gönderildi"),
  A("POST", /^\/admin\/users\/\d+\/update$/, "admin", "Kullanıcı güncellendi"),
  A("POST", /^\/admin\/users\/\d+\/email$/, "admin", "Kullanıcı e-postası değişti"),
  A("POST", /^\/admin\/users\/\d+\/toggle$/, "admin", "Kullanıcı aktif / pasif"),
  A("POST", /^\/admin\/users\/\d+\/2fa$/, "admin", "Doğrulama yöntemi değişti"),
  A("POST", /^\/admin\/users\/\d+\/totp-reset$/, "admin", "Authenticator sıfırlandı"),
  A("POST", /^\/admin\/users\/\d+\/kbs-manage$/, "admin", "KBS bilgileri yetkisi"),
  A("POST", /^\/admin\/users\/\d+\/delete$/, "admin", "Kullanıcı silindi"),
  A("POST", /^\/admin\/admins$/, "admin", "Yönetici eklendi"),
  A("POST", /^\/admin\/mail$/, "admin", "E-posta ayarları kaydedildi"),
  A("POST", /^\/admin\/mail\/test$/, "admin", "Test e-postası gönderildi"),
  A("POST", /^\/admin\/language$/, "admin", "Varsayılan dil değişti"),
  A("POST", /^\/admin\/retention$/, "admin", "Saklama süresi değişti"),
  // Kullanıcı arayüzü (tarama uygulaması)
  A("PUT", /^\/api\/profile$/, "user", "Profil OPERA'ya kaydedildi", (b) => {
    // Değişen alanlar eski → yeni değerle yazılır (yalnız izinli alanlar; uzunluk sınırlı)
    const L = { firstName: "Ad", middleName: "İkinci ad", lastName: "Soyadı", dateOfBirth: "Doğum tarihi", birthPlace: "Doğum yeri", gender: "Cinsiyet", nationality: "Uyruk", documentType: "Belge tipi", documentNumber: "Belge no", issuedDate: "Veriliş tarihi", expiryDate: "Geçerlilik tarihi", issuedPlace: "Veriliş yeri" };
    const v = (x) => str(x, 80) || "(boş)";
    const ch = Array.isArray(b.changed) ? b.changed.filter(c => c && L[c.k]).map(c => `${L[c.k]}: ${v(c.from)} → ${v(c.to)}`) : null;
    return `Profil #${num(b.profileId)}${ch ? (ch.length ? " · " + ch.join(" · ") : " · alan değişikliği yok") : ""}`;
  }),
  A("PUT", /^\/api\/identification$/, "user", "Kimlik belgesi OPERA'ya kaydedildi", (b) => `Profil #${num(b.profileId)}`),
  A("POST", /^\/api\/profile-merge$/, "user", "Profiller birleştirildi", (b, out) => out?.detail || `Kalan #${num(b.survivorId)} ← birleşen #${num(b.victimId)}`),
  A("POST", /^\/api\/reservation-profile$/, "user", "Rezervasyon profili değiştirildi", (b, out) => out?.detail || `${b.mode === "main" ? "Ana profil" : "Beraberindeki"} · rezervasyon #${num(b.reservationId)} · ${b.mode === "accompany" ? `#${num(b.oldProfileId)} → ` : ""}#${num(b.newProfileId)}`),
  A("POST", /^\/api\/add-accompanying$/, "user", "Beraberindeki eklendi",
    (b, out) => `Rezervasyon #${num(b.confirmationNo || b.reservationId)} · ${b.existingProfileId ? `mevcut profil #${num(b.existingProfileId)}` : `yeni profil${out?.profileId ? " #" + num(out.profileId) : ""}`}`),
  A("PUT", /^\/api\/kbs\/settings$/, "user", "KBS bilgileri kaydedildi", (b) => `Güncellenen: ${[b.username && "kullanıcı adı", b.tssKod && "tesis kodu", b.tcNo && "TC kimlik no", b.password && "parola", b.egmsec && "EGMSEC anahtarı", b.clearEgmsec && "EGMSEC silindi"].filter(Boolean).join(", ") || "—"} · uyruğu doğum yeri say: ${b.birthFromNat === true ? "açık" : "kapalı"}`),
  A("POST", /^\/api\/kbs\/egmsec-register$/, "user", "EGMSEC kaydı başlatıldı", (b) => (b.update === true ? "Kayıt Güncelle" : "Yeni kayıt")),
  A("POST", /^\/api\/kbs\/connect$/, "user", "KBS'ye bağlanma başlatıldı", (b, out) => stateTr(out) ? "Durum: " + stateTr(out) : "KBS bağlantısı istendi"),
  A("POST", /^\/api\/kbs\/otp$/, "user", "KBS EGMSEC kodu girildi", (b, out) => stateTr(out) ? "Sonuç: " + stateTr(out) : "Kod gönderildi"),
  A("POST", /^\/api\/kbs\/disconnect$/, "user", "KBS bağlantısı kesildi", () => "Açık KBS oturumu kapatıldı"),
  A("POST", /^\/api\/kbs\/mark$/, "user", "KBS'de kayıtlı sayıldı",
    (b) => { const it = Array.isArray(b.items) ? b.items : []; return `${it.length} kayıt · ${it.slice(0, 20).map(x => "#" + num(x.profileId)).join(" ")}${it.some(x => x.kbsId) ? " · KBS kaydıyla bağlandı" : ""}`; }),
  A("POST", /^\/api\/kbs\/send$/, "user", "KBS gönderimi", (b, out) => {
    const res = Array.isArray(out?.results) ? out.results : [];
    const ok = res.filter(r => r.ok).length;
    const name = { checkin: "Giriş", room: "Oda değişimi", checkout: "Çıkış" }[b.action] || b.action;
    return `${b.auto === true ? "OTOMATİK · " : ""}${name}: ${ok}/${res.length} başarılı ·${res.slice(0, 20).map(r => `#${num(r.profileId)}${r.ok ? "" : " (hata)"}`).join(" ")}`;
  }),
  A("POST", /^\/account\/password$/, "user", "Parola değiştirildi"),
  A("POST", /^\/otel\/dogrula$/, "user", "Otel yönetimine girildi (ikinci doğrulama)", () => "İkinci doğrulama geçildi (30 dk geçerli)"),
];

function middleware(hotelOf) {
  return (req, res, next) => {
    const rule = RULES.find(r => r.method === req.method && r.re.test(req.path));
    if (!rule) return next();
    const errBefore = (req.session?.flash || []).filter(f => f[0] === "error").length;
    const json = res.json.bind(res);
    res.json = (body) => { res.locals.auditOut = body; return json(body); };
    res.on("finish", () => {
      if (!req.user || res.statusCode >= 400) return;
      const flash = req.session?.flash || [];
      if (flash.filter(f => f[0] === "error").length > errBefore) return;
      let detail = "";
      try { detail = rule.detail ? rule.detail(req.body || {}, res.locals.auditOut) : (flash.filter(f => f[0] === "ok").pop() || [])[1] || ""; } catch (_) {}
      const m = /^\/admin\/hotels\/(\d+)\//.exec(req.path);
      // Otel yöneticisinin yönetim işlemleri (kullanıcı oluşturma, yetki değiştirme…) kendi otelinin kaydına bağlanır
      const hotelId = rule.scope === "admin" ? (m ? Number(m[1]) : (req.user.role === "hotel" ? req.user.hotel_id : null)) : hotelOf(req);
      log({ scope: rule.scope, hotelId, user: req.user, action: rule.action, detail, ip: req.ip });
    });
    next();
  };
}

// Otelde kullanıcı hareketi var mı (giriş, kullanıcı logu, KBS kaydı, OHIP çağrısı): varsa otel silinemez
async function hotelHasActivity(hotel) {
  const r = await db.one(
    `SELECT EXISTS (SELECT 1 FROM users WHERE hotel_id=$1 AND last_login IS NOT NULL)
         OR EXISTS (SELECT 1 FROM audit_log WHERE hotel_id=$1 AND scope='user')
         OR EXISTS (SELECT 1 FROM kbs_submissions WHERE hotel_id=$1)
         OR EXISTS (SELECT 1 FROM ohip_calls WHERE hotel_code<>'' AND upper(hotel_code)=upper($2)) AS any`,
    [hotel.id, hotel.hotel_code || ""]);
  return !!r?.any;
}

// Kullanıcıda hareket var mı (giriş yapmış, kullanıcı logu ya da KBS kaydı var): varsa silinemez, pasifleştirilir
async function userHasActivity(u) {
  if (u.last_login) return true;
  const r = await db.one(
    `SELECT EXISTS (SELECT 1 FROM audit_log WHERE user_id=$1)
         OR EXISTS (SELECT 1 FROM kbs_submissions WHERE user_id=$1) AS any`, [u.id]);
  return !!r?.any;
}

module.exports = { log, list, middleware, hotelHasActivity, userHasActivity };
