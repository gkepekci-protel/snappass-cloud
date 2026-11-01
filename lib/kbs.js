/* KBS (kbs.egm.gov.tr) oturumu: F5 BIG-IP APM girişi (kullanıcı adı + TC + parola, ardından EGMSEC tek kullanımlık parola).
   Kullanıcı başına bellekte tutulur; parola ve kod günlüğe yazılmaz, tarayıcıya geri gönderilmez.
   Sayfa yapısı (ikinci adım ve sonrası) belgelenmediği için sonuç sayfa içeriğinden sezgisel olarak sınıflanır;
   belirsizse "unknown" ile görünür metnin kısa bir özeti döner. */
const totp = require("./totp");
const BASE = process.env.SNAPPASS_KBS_BASE || "https://kbs.egm.gov.tr";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 360 * 1000; // KBS çok yavaş yanıt verebiliyor: adım başına 6 dk
const MAX_IDLE_MS = 30 * 60 * 1000; // bellekteki oturumu en çok bu kadar boşta tut

const blocked = new Map(); // userId -> { until, reason }: hatalı girişten sonra yeni deneme için bekleme
const FAIL_WAIT_MS = 2 * 60 * 1000, LOCK_WAIT_MS = 16 * 60 * 1000;
const sessions = new Map(); // oturum anahtarı (otel: "h<id>") -> { jar, state, form, url, at, by }

function jarHeader(jar) { return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "); }
function keepCookies(jar, res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const c of list) {
    const [kv] = c.split(";");
    const i = kv.indexOf("=");
    if (i > 0) {
      const name = kv.slice(0, i).trim(), val = kv.slice(i + 1).trim();
      if (!val || /^deleted$/i.test(val)) delete jar[name]; else jar[name] = val;
    }
  }
}

// Çerezleri taşıyarak yönlendirmeleri elle izler
async function request(sess, url, opts = {}) {
  let method = opts.method || "GET", body = opts.body, cur = url;
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const res = await fetch(cur, {
      method, body, redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "user-agent": UA, "accept": "text/html,application/xhtml+xml,*/*", "accept-language": "tr-TR,tr;q=0.9",
        cookie: jarHeader(sess.jar), ...(body ? { "content-type": "application/x-www-form-urlencoded", origin: BASE, referer: opts.referer || cur } : {}),
      },
    }).catch((e) => { console.warn(`[KBS] ${method} ${new URL(cur).pathname} başarısız (${Date.now() - t0} ms): ${e.cause?.code || e.name}`); throw e; });
    keepCookies(sess.jar, res);
    console.log(`[KBS] ${method} ${new URL(cur).pathname} → ${res.status} (${Date.now() - t0} ms)`);
    const loc = res.headers.get("location");
    if (loc && res.status >= 300 && res.status < 400) {
      cur = new URL(loc, cur).href;
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) { method = "GET"; body = undefined; }
      continue;
    }
    const html = await res.text();
    return { status: res.status, url: cur, html };
  }
  throw new Error("Çok fazla yönlendirme");
}

const decode = (s) => String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const attr = (tag, name) => { const m = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag); return m ? decode(m[1] ?? m[2] ?? m[3] ?? "") : ""; };

// Sayfadaki ilk <form>: action, method, girdi alanları
function parseForm(html) {
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  const fm = /<form\b[^>]*>([\s\S]*?)<\/form>/i.exec(clean);
  if (!fm) return null;
  const tag = /<form\b[^>]*>/i.exec(clean)[0];
  const fields = (fm[1].match(/<input\b[^>]*>/gi) || []).map(t => ({ name: attr(t, "name"), type: (attr(t, "type") || "text").toLowerCase(), value: attr(t, "value") })).filter(f => f.name);
  return { action: attr(tag, "action"), method: (attr(tag, "method") || "post").toLowerCase(), fields };
}

function visibleText(html) {
  return decode(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// Yanıtı sınıflandırır: otp (kod isteniyor) · ready (giriş tamam) · failed (kullanıcı adı/parola ya da kod hatalı) · unknown
function classify(page) {
  const form = parseForm(page.html);
  const text = visibleText(page.html);
  const inputs = form ? form.fields.filter(f => f.type === "text" || f.type === "password") : [];
  const names = inputs.map(f => f.name.toLowerCase());
  const path = (() => { try { return new URL(page.url).pathname; } catch (_) { return ""; } })();
  if (/çok fazla hatalı giriş|tekrar giriş yapmayı deneyiniz|15 dakika sonra/i.test(text)) return { state: "failed", locked: true, form, text }; // KBS hesabı/IP'yi geçici kilitledi
  if (names.includes("username") && names.includes("password")) return { state: "failed", form, text }; // giriş formu yeniden geldi
  // BIG-IP çıkış / ret sayfaları: giriş reddedildi ya da oturum sonlandırıldı (başarı sayılmaz)
  if (/hangup|logout|logoff|error.php|denied/i.test(path) || /oturum açılamadı|erişim sağlanamadı|oturum sonlandırıldı|oturum başlatılamadı|çıkış sayfası|logout page|access denied|session expired/i.test(text)) return { state: "failed", form, text };
  if (form && inputs.length >= 1 && inputs.length <= 2) return { state: "otp", form, text };           // tek kullanımlık parola ekranı
  if (!inputs.length && !/my.policy$/i.test(path)) return { state: "ready", form, text };            // giriş formu yok, başka sayfadayız
  return { state: "unknown", form, text };
}

const excerpt = (text) => String(text || "").slice(0, 300);
const pub = (sess, c) => ({ state: c.state, path: (() => { try { return new URL(sess.url).pathname; } catch (_) { return ""; } })(), text: excerpt(c.text) });

function get(userId) {
  const s = sessions.get(userId);
  if (s && Date.now() - s.at > MAX_IDLE_MS) { sessions.delete(userId); return null; }
  return s || null;
}

const safeError = (e) => (e && e.name === "TimeoutError" ? "KBS 6 dakika içinde yanıt vermedi (zaman aşımı)." : "KBS'ye ulaşılamadı: " + String((e && (e.cause?.code || e.message)) || e).slice(0, 120));

// Bağlanma ve kod doğrulama arka planda çalışır (KBS yavaş olabilir); ekran durumu status() ile sorgular.
function applyResult(sess, c) {
  sess.url = sess.url || BASE;
  sess.text = excerpt(c.text);
  sess.path = (() => { try { return new URL(sess.url).pathname; } catch (_) { return ""; } })();
  sess.at = Date.now();
}

function login(userId, { username, tcNo, password, egmsec }, { by = "" } = {}) {
  const sess = { jar: {}, state: "connecting", form: null, url: BASE, at: Date.now(), text: "", path: "", error: "", by };
  const b = blocked.get(userId);
  if (b && b.until > Date.now()) {
    // KBS'ye hiç istek gitmez: art arda hatalı giriş hesabı kilitler
    const mins = Math.ceil((b.until - Date.now()) / 60000);
    sess.state = "error"; sess.error = `${b.reason} ${mins} dakika sonra tekrar deneyin.`;
    sessions.set(userId, sess);
    return status(userId);
  }
  sessions.set(userId, sess);
  (async () => {
    try {
      const first = await request(sess, BASE + "/");
      const f = parseForm(first.html);
      if (!f) throw new Error("KBS giriş formu bulunamadı");
      const params = new URLSearchParams();
      for (const fld of f.fields) {
        if (fld.type === "submit" || fld.type === "checkbox" || fld.type === "radio") continue;
        params.set(fld.name, fld.value);
      }
      params.set("username", username); params.set("tc", tcNo); params.set("password", password);
      const target = new URL(f.action || "/my.policy", first.url).href;
      const page = await request(sess, target, { method: "POST", body: params.toString(), referer: first.url });
      sess.url = page.url;
      const c = classify(page);
      sess.state = c.state; sess.form = c.form;
      applyResult(sess, c);
      // EGMSEC anahtarı kayıtlıysa kodu uygulama kendisi üretip girer (kullanıcıdan bir şey istenmez)
      const cfg = egmsec ? totp.parseSecretInput(egmsec) : null;
      if (c.state === "otp" && cfg) {
        let t = totp.codeNow(cfg);
        let st = await sendCode(sess, sess.form, t.code);
        if (st === "otp" && sess.rejected) {
          // aynı adımın kodu yeniden kullanılmasın: bir sonraki adımı bekleyip bir kez daha dene
          await new Promise(r => setTimeout(r, (t.remaining + 1) * 1000));
          t = totp.codeNow(cfg);
          st = await sendCode(sess, sess.form, t.code);
        }
        if (st === "otp" && sess.rejected) {
          sess.error = "EGMSEC kodu kabul edilmedi. Anahtarı ve telefon/sunucu saatini kontrol edin.";
          blocked.set(userId, { until: Date.now() + FAIL_WAIT_MS, reason: "Otomatik kod reddedildi; hesabın kilitlenmemesi için beklenir." });
        } else if (st === "ready") blocked.delete(userId);
        return;
      }
      if (c.state === "failed") {
        const locked = !!c.locked;
        blocked.set(userId, { until: Date.now() + (locked ? LOCK_WAIT_MS : FAIL_WAIT_MS), reason: locked ? "KBS çok fazla hatalı giriş nedeniyle kilitledi." : "Giriş reddedildi; hesabın kilitlenmemesi için beklenir." });
      } else if (c.state === "otp" || c.state === "ready") blocked.delete(userId);
    } catch (e) {
      console.warn("[KBS] bağlanma hatası:", e.message);
      sess.state = "error"; sess.error = safeError(e); sess.at = Date.now();
    }
  })();
  return status(userId);
}

// Kod ekranındaki formu doldurup gönderir; durumu günceller (başarısız kodda kod ekranında kalır)
async function sendCode(sess, form, code) {
  const params = new URLSearchParams();
  const free = form.fields.filter(f => f.type === "text" || f.type === "password");
  for (const fld of form.fields) {
    if (fld.type === "submit" || fld.type === "checkbox" || fld.type === "radio") continue; // "Kayıt Güncelle" kutusu asla gönderilmez
    params.set(fld.name, fld.value);
  }
  const target = free.find(f => !f.value) || free[0];
  if (!target) throw new Error("KBS kod alanı bulunamadı");
  params.set(target.name, code);
  const page = await request(sess, new URL(form.action || sess.url, sess.url).href, { method: "POST", body: params.toString(), referer: sess.url });
  sess.url = page.url;
  const c = classify(page);
  if (c.state === "failed") { sess.state = "otp"; sess.form = form; sess.rejected = true; }
  else { sess.state = c.state; sess.form = c.form || form; sess.rejected = false; }
  applyResult(sess, c);
  return sess.state;
}

function submitCode(userId, code) {
  const sess = get(userId);
  if (!sess || sess.state !== "otp" || !sess.form) throw new Error("Önce KBS'ye bağlan düğmesine basın.");
  const form = sess.form;
  const params = new URLSearchParams();
  const free = form.fields.filter(f => f.type === "text" || f.type === "password");
  for (const fld of form.fields) {
    if (fld.type === "submit" || fld.type === "checkbox" || fld.type === "radio") continue;
    params.set(fld.name, fld.value);
  }
  // kod alanı: formdaki tek boş metin/parola alanı
  const target = free.find(f => !f.value) || free[0];
  if (!target) throw new Error("KBS kod alanı bulunamadı");
  params.set(target.name, code);
  sess.state = "verifying"; sess.error = ""; sess.at = Date.now();
  (async () => {
    try {
      const page = await request(sess, new URL(form.action || sess.url, sess.url).href, { method: "POST", body: params.toString(), referer: sess.url });
      sess.url = page.url;
      const c = classify(page);
      // kod hatalıysa aynı kod ekranı (ya da giriş formu) yeniden gelir: kod ekranında kal, KBS'nin mesajı görünsün
      if (c.state === "failed") { sess.state = "otp"; sess.form = form; sess.rejected = true; }
      else { sess.state = c.state; sess.form = c.form || form; sess.rejected = false; }
      applyResult(sess, c);
    } catch (e) {
      console.warn("[KBS] kod hatası:", e.message);
      sess.state = "otp"; sess.form = form; sess.error = safeError(e); sess.at = Date.now();
    }
  })();
  return status(userId);
}

// Oturum açıkken KBS'nin iç API'sine (KbsApiGateway) JSON çağrısı. Yönlendirme/HTML yanıtı = oturum düşmüş demektir.
async function api(userId, path, { method = "GET", body, retried = false } = {}) {
  const sess = get(userId);
  if (!sess || sess.state !== "ready") throw new Error("KBS oturumu açık değil. Önce KBS'ye bağlanın.");
  // API jetonu (token / refreshToken çerezleri) /login.html ziyaretinde kurulur; KBS arayüzü de oturum yoksa buraya gider
  if (!sess.warm) { sess.warm = true; await request(sess, BASE + "/login.html"); }
  const url = BASE + "/KbsApiGateway/" + path.replace(/^\/+/, "");
  const res = await fetch(url, {
    method, redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "user-agent": UA, accept: "application/json, text/plain, */*", "accept-language": "tr-TR,tr;q=0.9", cookie: jarHeader(sess.jar), referer: BASE + "/Konaklayan", origin: BASE, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  keepCookies(sess.jar, res);
  sess.at = Date.now();
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  // jetonun süresi dolduysa bir kez yenile (KBS arayüzünün yaptığı gibi /login.html) ve tekrar dene
  if (res.status === 401 && !retried) { sess.warm = false; return api(userId, path, { method, body, retried: true }); }
  const loc = res.headers.get("location") || "";
  console.log(`[KBS-API] ${method} ${path.split("?")[0]} → ${res.status} ${res.headers.get("content-type") || ""}${loc ? " → " + loc.slice(0, 60) : ""}${json === null ? " | " + text.replace(/\s+/g, " ").slice(0, 80) : ""}`);
  if (json === null) {
    // yalnız giriş sayfasına yönlendirme gerçek bir oturum kaybıdır; diğer HTML yanıtlar (404 vb.) oturumu düşürmez
    if (/my\.policy|vdesk|hangup/i.test(loc) || /my\.policy/i.test(text.slice(0, 400))) {
      sess.state = "error"; sess.error = "KBS oturumu sona erdi (başka bir yerden giriş yapılmış olabilir). Yeniden bağlanın.";
      throw new Error(sess.error);
    }
    throw new Error("KBS beklenmeyen yanıt verdi (" + res.status + ").");
  }
  return { status: res.status, json };
}

function status(userId) {
  const s = get(userId);
  if (s && s.state === "ready" && !s.readyAt) s.readyAt = Date.now(); // bağlantının kurulduğu an (durum sık sorulduğu için yaklaşık)
  return s ? { state: s.state, text: s.text || "", path: s.path || "", error: s.error || "", rejected: !!s.rejected, at: s.at, by: s.by || "", since: s.readyAt || null } : { state: "none" };
}
function disconnect(userId) { sessions.delete(userId); }

/* ── EGMSEC kaydı (yeni kayıt / kayıt güncelle) ─────────────────────────────
   KBS kılavuzundaki akış: kullanıcı adı+TC+parola ile giriş → (kayıtlı değilse) "Yeni Kayıt Sayfası" (TC, ad, soyad → Devam) → QR sayfası →
   QR'daki gizli anahtardan üretilen kod yazılır → "Kaydınız başarıyla tamamlanmıştır." Kayıtlı kullanıcıda kod ekranındaki "Kayıt Güncelle"
   kutusu işaretlenerek aynı akışa girilir (HESABIN ESKİ ANAHTARI GEÇERSİZ OLUR). Başarıda gizli anahtar çağırana döner; günlüğe yazılmaz.
   Beklenmeyen bir sayfada dururuz (yeniden deneme yok): hesap kilitlenmesin. */
const qrSvg = require("./qr-svg");
const regStates = new Map(); // oturum anahtarı -> { state: running|ok|error, step, message, at }
const registerStatus = (key) => regStates.get(key) || { state: "idle" };

// Formdaki gizli alanlar + verilen alanlar; submit düğmesinin değeri de gönderilir (F5 bunu bekleyebilir)
function formBody(form, set) {
  const p = new URLSearchParams();
  for (const f of form.fields) {
    if (f.type === "checkbox" || f.type === "radio") continue;
    p.set(f.name, f.type === "submit" ? f.value : (f.value || ""));
  }
  for (const [k, v] of Object.entries(set)) p.set(k, v);
  return p.toString();
}
const hasField = (form, re) => !!form && form.fields.some(f => re.test(f.name));
const fieldName = (form, re) => { const f = form && form.fields.find(f => re.test(f.name) && f.type !== "submit" && f.type !== "hidden"); return f ? f.name : ""; };

// Sayfa türü: register (Yeni Kayıt Sayfası) · otp · failed · ready · unknown
function pageKind(page) {
  const form = parseForm(page.html), text = visibleText(page.html);
  if (/yeni\s+kay[ıi]t\s+sayfas[ıi]/i.test(text) || (hasField(form, /^adi$|^soyadi$/i))) return { kind: "register", form, text };
  const c = classify(page);
  return { kind: c.state, form: c.form || form, text: c.text || text };
}

function failReg(key, message) { regStates.set(key, { state: "error", step: "", message: String(message).slice(0, 300), at: Date.now() }); }
const stepReg = (key, step) => regStates.set(key, { state: "running", step, message: "", at: Date.now() });

// Arka planda çalışır; ilerleme registerStatus(key) ile izlenir. onSecret(secret) başarıda çağrılır ve gizli anahtarı saklar (hata fırlatırsa kayıt başarısız sayılır).
function register(key, { username, tcNo, password }, { firstName, lastName, update = false } = {}, onSecret) {
  const cur = regStates.get(key);
  if (cur && cur.state === "running" && Date.now() - cur.at < 15 * 60 * 1000) return cur;
  const b = blocked.get(key);
  if (b && b.until > Date.now()) { failReg(key, `${b.reason} ${Math.ceil((b.until - Date.now()) / 60000)} dakika sonra tekrar deneyin.`); return registerStatus(key); }
  if (!String(firstName || "").trim() || !String(lastName || "").trim()) { failReg(key, "Ad ve soyad gerekli."); return registerStatus(key); }
  sessions.delete(key); // KBS tek oturuma izin verir: açık oturum bu girişle düşer
  stepReg(key, "KBS'ye giriliyor");
  (async () => {
    const sess = { jar: {}, url: BASE };
    try {
      const first = await request(sess, BASE + "/");
      const f = parseForm(first.html);
      if (!f) throw new Error("KBS giriş formu bulunamadı");
      const params = new URLSearchParams();
      for (const fld of f.fields) { if (fld.type === "submit" || fld.type === "checkbox" || fld.type === "radio") continue; params.set(fld.name, fld.value); }
      params.set("username", username); params.set("tc", tcNo); params.set("password", password);
      let page = await request(sess, new URL(f.action || "/my.policy", first.url).href, { method: "POST", body: params.toString(), referer: first.url });
      let pk = pageKind(page);

      if (pk.kind === "failed") {
        const locked = /çok fazla hatalı|15 dakika/i.test(pk.text);
        blocked.set(key, { until: Date.now() + (locked ? LOCK_WAIT_MS : FAIL_WAIT_MS), reason: locked ? "KBS çok fazla hatalı giriş nedeniyle kilitledi." : "Giriş reddedildi; hesabın kilitlenmemesi için beklenir." });
        throw new Error("KBS girişi reddedildi (kullanıcı adı, TC ya da parola hatalı olabilir). KBS bilgilerini kontrol edin.");
      }
      if (pk.kind === "otp") {
        // Hesap zaten kayıtlı: yalnız açıkça istendiyse "Kayıt Güncelle" ile yeniden kayıt (eski anahtar geçersiz olur)
        if (!update) throw new Error("Bu KBS kullanıcısı zaten kayıtlı. Yeni anahtar üretmek eski anahtarı (telefondaki EGMSEC dahil) geçersiz kılar; gerekiyorsa 'Kayıt Güncelle' seçeneğini işaretleyin.");
        const upd = pk.form && pk.form.fields.find(x => x.type === "checkbox" && /update|guncel|g[üu]ncel/i.test(x.name));
        if (!upd) throw new Error("KBS kod ekranında 'Kayıt Güncelle' seçeneği bulunamadı.");
        stepReg(key, "Kayıt Güncelle isteniyor");
        page = await request(sess, new URL(pk.form.action || page.url, page.url).href, { method: "POST", body: formBody(pk.form, { [upd.name]: upd.value || "1" }), referer: page.url });
        pk = pageKind(page);
      }
      if (pk.kind !== "register") throw new Error("KBS 'Yeni Kayıt Sayfası'nı göstermedi. Ekran yanıtı: " + String(pk.text || "").slice(0, 160));

      stepReg(key, "Kayıt bilgileri gönderiliyor");
      const rf = pk.form;
      const nTc = fieldName(rf, /^tc|kimlik/i), nAd = fieldName(rf, /^adi?$|^ad$/i), nSoy = fieldName(rf, /soyad/i);
      if (!nTc || !nAd || !nSoy) throw new Error("Kayıt formundaki alanlar tanınmadı: " + rf.fields.map(x => x.name).join(", ").slice(0, 160));
      page = await request(sess, new URL(rf.action || page.url, page.url).href, { method: "POST", body: formBody(rf, { [nTc]: tcNo, [nAd]: String(firstName).trim(), [nSoy]: String(lastName).trim() }), referer: page.url });

      // QR sayfası: sayfadaki SVG
      const svgM = /<svg\b[\s\S]*?<\/svg>/i.exec(page.html);
      if (!svgM) {
        const t = visibleText(page.html);
        if (/e[şs]le[şs]m|uyu[şs]m/i.test(t)) throw new Error("KBS girilen ad/soyad/TC bilgilerini kullanıcıyla eşleştirmedi. Bilgileri kontrol edin.");
        throw new Error("KBS QR kodunu göstermedi. Ekran yanıtı: " + t.slice(0, 160));
      }
      stepReg(key, "QR kod okunuyor");
      const secret = qrSvg.secretFromQr(qrSvg.decodeSvg(svgM[0]));
      const cfg = secret && totp.parseSecretInput(secret);
      if (!cfg) throw new Error("QR koddaki gizli anahtar okunamadı.");

      // Doğrulama kodu: adım bitmek üzereyse bir sonrakini bekle; reddedilirse bir sonraki adımda bir kez daha dene
      const vf = parseForm(page.html);
      const vName = fieldName(vf, /verif|dogrula|token|kod|code/i) || (vf && vf.fields.find(x => x.type === "text" || x.type === "password") || {}).name;
      if (!vf || !vName) throw new Error("Doğrulama kodu alanı bulunamadı.");
      let ok = false, last = "";
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        let t = totp.codeNow(cfg);
        if (t.remaining < 6) { await new Promise(r => setTimeout(r, (t.remaining + 1) * 1000)); t = totp.codeNow(cfg); }
        stepReg(key, "Doğrulama kodu gönderiliyor");
        const res = await request(sess, new URL(vf.action || page.url, page.url).href, { method: "POST", body: formBody(vf, { [vName]: t.code }), referer: page.url });
        last = visibleText(res.html);
        ok = /kayd[ıi]n[ıi]z\s+ba[şs]ar[ıi]yla\s+tamamlanm[ıi][şs]t[ıi]r/i.test(last);
        if (!ok && attempt === 0) await new Promise(r => setTimeout(r, (totp.codeNow(cfg).remaining + 1) * 1000));
      }
      if (!ok) throw new Error("KBS doğrulama kodunu kabul etmedi; kayıt tamamlanmadı. Ekran yanıtı: " + last.slice(0, 160));

      stepReg(key, "Anahtar kaydediliyor");
      await onSecret(secret);
      blocked.delete(key);
      regStates.set(key, { state: "ok", step: "", message: "Kayıt tamamlandı; EGMSEC anahtarı kaydedildi.", at: Date.now() });
    } catch (e) {
      console.warn("[KBS] kayıt hatası:", String(e.message || e).slice(0, 160));
      failReg(key, (e.name === "TimeoutError" || e instanceof TypeError) ? safeError(e) : (e.message || "Kayıt başarısız"));
    }
  })();
  return registerStatus(key);
}

module.exports = { login, submitCode, status, disconnect, api, get, register, registerStatus, _parseForm: parseForm, _classify: classify, _pageKind: pageKind };
