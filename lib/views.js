/* ─── Sunucu sayfaları (TGA görünümü) ─────────────────────────────────────
   Basit şablon fonksiyonları; tüm değişkenler esc() ile kaçırılır.
   Stil: public/admin/style.css (TGA static/style.css kopyası)
── */
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (d) => d ? new Date(d).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "—";
const csrfField = (csrf) => `<input type="hidden" name="csrf" value="${esc(csrf)}">`;

const DEFAULT_SCOPE = require("./ohip").DEFAULT_SCOPE;
const GOOGLE_G = `<svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

function layout({ title, body, user, csrf, flash = [], lang = "tr", showLang = false, next = "/login" }) {
  const nav = user ? `<nav class="topnav">
    ${user.role === "admin" ? "" : `<a class="nav-btn" href="/">Kullanıcı Arayüzü</a>`}
    ${user.role === "admin" ? `<a class="nav-btn" href="/admin/kurulum-rehberi" target="_blank" rel="noopener">Kurulum rehberi</a><a class="nav-btn" href="/yardim" target="_blank" rel="noopener">Kullanıcı rehberi</a>` : `<a class="nav-btn" href="/account/password">Parola</a><a class="nav-btn" href="/yardim" target="_blank" rel="noopener">Yardım</a>`}
    <form method="post" action="/logout" class="inline">${csrfField(csrf)}<button class="nav-btn nav-out" title="${esc(user.username)}">Çıkış <span class="nav-user">${esc(user.username)}</span></button></form>
  </nav>` : "";
  // Dil değiştirici: yalnız otel kullanıcısına dönük sayfalarda (Protel yönetim ekranları Türkçe)
  const langSwitch = showLang ? `<div class="lang-switch-srv" role="group" aria-label="Language"><a href="/lang/tr?next=${encodeURIComponent(next)}" class="${lang !== "en" ? "on" : ""}">TR</a><a href="/lang/en?next=${encodeURIComponent(next)}" class="${lang === "en" ? "on" : ""}">EN</a></div>` : "";
  return `<!doctype html>
<html lang="${lang === "en" ? "en" : "tr"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} - SnapPass</title>
  <link rel="stylesheet" href="/admin/style.css?v=23">
  <link rel="icon" href="/admin/protel-logo.svg" type="image/svg+xml">
</head>
<body>
<header class="topbar">
  <a class="brand" href="${user && user.role === "admin" ? "/admin" : "/"}" title="${user && user.role === "admin" ? "Yönetim paneli" : "SnapPass"}"><img src="/admin/protel-logo.svg" alt="PROTEL" class="brand-logo"><span>SnapPass</span></a>
  <span style="display: inline-flex; align-items: center; gap: 12px; margin-left: auto">${nav}${langSwitch}</span>
</header>
<main>
  ${flash.map(([kind, msg]) => `<div class="flash ${esc(kind)}">${esc(msg)}</div>`).join("")}
  ${body}
</main>
<footer class="footer">© Bütün hakları saklıdır. PROTEL Bilgisayar A.Ş.</footer>
<dialog id="confirm-dialog" class="confirm-dialog">
  <p id="confirm-text"></p>
  <div class="actions" style="justify-content: flex-end">
    <button type="button" class="secondary" id="confirm-no">Vazgeç</button>
    <button type="button" id="confirm-yes">Evet</button>
  </div>
</dialog>
<script>
/* data-confirm taşıyan form/buton için sayfa içi onay penceresi */
(function () {
  const dlg = document.getElementById('confirm-dialog');
  let pending = null;
  document.addEventListener('submit', function (e) {
    const form = e.target, btn = e.submitter;
    const text = (btn && btn.dataset.confirm) || form.dataset.confirm;
    if (!text || form.dataset.confirmed) return;
    e.preventDefault();
    pending = {form, btn};
    document.getElementById('confirm-text').textContent = text;
    dlg.showModal();
  }, true);
  document.getElementById('confirm-no').onclick = () => { pending = null; dlg.close(); };
  document.getElementById('confirm-yes').onclick = () => {
    dlg.close();
    if (!pending) return;
    const {form, btn} = pending;
    pending = null;
    form.dataset.confirmed = '1';
    form.requestSubmit(btn || undefined);
  };
})();
</script>
</body>
</html>`;
}

const narrow = (inner) => `<div class="card narrow"><img src="/admin/protel-logo.svg" alt="PROTEL" class="login-logo">${inner}</div>`;

function loginPage({ csrf, sso, domains }) {
  return narrow(`
  <h1>Giriş</h1>
  <p class="muted">Size gönderilen davetiyeyle belirlediğiniz kullanıcı adı ve parolayla girin.</p>
  <form method="post" action="/login">
    ${csrfField(csrf)}
    <div class="field"><label for="username">Kullanıcı adı</label><input type="text" id="username" name="username" required autofocus autocomplete="username"></div>
    <div class="field"><label for="password">Parola</label><input type="password" id="password" name="password" required autocomplete="current-password">
      <a href="/forgot" class="muted" style="font-size: 13px">Parolamı unuttum</a></div>
    <button type="submit">Giriş yap</button>
  </form>
  ${sso ? `<p class="sso-link"><a href="/auth/google/start" title="Protel yöneticileri: ${esc(domains.map(d => "@" + d).join(", "))} Google hesabıyla">${GOOGLE_G} Protel yönetici girişi</a></p>` : ""}`);
}

function pinPage({ csrf, email, minutes, deviceDays }) {
  return narrow(`
  <h1>Giriş kodu</h1>
  <p class="muted"><b>${esc(email)}</b> adresine 6 haneli bir kod gönderildi. Kod ${minutes} dakika geçerlidir.</p>
  <form method="post" action="/login/pin">
    ${csrfField(csrf)}
    <div class="field"><label for="code">Kod</label>
      <input type="text" id="code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required autofocus
             style="font-size: 1.4em; letter-spacing: 6px; max-width: 200px"></div>
    <p><label><input type="checkbox" name="remember" value="1"> Bu cihazı ${deviceDays} gün hatırla</label><br>
      <span class="muted">Bu tarayıcıda ${deviceDays} gün kod sorulmaz. Ortak kullanılan bilgisayarlarda işaretlemeyin.</span></p>
    <button type="submit">Doğrula</button>
  </form>
  <form method="post" action="/login/pin/resend" class="inline" style="margin-top: 12px">
    ${csrfField(csrf)}<button class="link">Kod gelmedi, yeniden gönder</button>
  </form>
  <p class="muted"><a href="/login">Girişe dön</a></p>`);
}

// Protel yöneticisi: Google girişinden sonra Authenticator kodu; ilk girişte QR ile kurulum
function totpPage({ csrf, email, setup, remember, deviceDays, admin }) {
  const rememberField = remember ? `
    <p><label><input type="checkbox" name="remember" value="1"> Bu cihazı ${deviceDays} gün hatırla</label><br>
      <span class="muted">Bu tarayıcıda ${deviceDays} gün kod sorulmaz. Ortak kullanılan bilgisayarlarda işaretlemeyin.</span></p>` : "";
  const codeField = `
    <div class="field"><label for="code">Uygulamadaki 6 haneli kod</label>
      <input type="text" id="code" name="code" inputmode="numeric" pattern="[0-9 ]{6,7}" maxlength="7" autocomplete="one-time-code" required autofocus
             style="font-size: 1.4em; letter-spacing: 6px; max-width: 200px"></div>`;
  return narrow(setup ? `
  <h1>Authenticator kurulumu</h1>
  <p class="muted"><b>${esc(email)}</b> için girişte ikinci adım olarak Authenticator kodu kullanılır.</p>
  <ol class="muted" style="padding-left: 18px">
    <li>Telefonunuza <b>Google Authenticator</b> (ya da Microsoft Authenticator) yükleyin.</li>
    <li>Uygulamada <b>+</b> &gt; <b>QR kodu tara</b> ile aşağıdaki kodu okutun.</li>
    <li>Uygulamada görünen 6 haneli kodu girin.</li>
  </ol>
  <div class="totp-qr" style="max-width: 220px; margin: 12px auto; background: #fff; padding: 4px; border-radius: 8px">${setup.qr}</div>
  <details><summary class="muted">QR okutamıyorum</summary>
    <p class="muted">Uygulamada <b>Kurulum anahtarı gir</b> seçin; hesap: <b>${esc(email)}</b>, anahtar (zamana dayalı):</p>
    <p><code style="font-size: 15px; letter-spacing: 1px; user-select: all">${esc(setup.secret)}</code></p>
  </details>
  <form method="post" action="/auth/totp">
    ${csrfField(csrf)}${codeField}${rememberField}
    <button type="submit">Kurulumu tamamla</button>
  </form>
  <p class="muted"><a href="/login">Girişe dön</a></p>` : `
  <h1>Doğrulama kodu</h1>
  <p class="muted"><b>${esc(email)}</b> · Authenticator uygulamasındaki <b>SnapPass</b> kodunu girin.</p>
  <form method="post" action="/auth/totp">
    ${csrfField(csrf)}${codeField}${rememberField}
    <button type="submit">Doğrula</button>
  </form>
  <p class="muted">Telefonunuz yanınızda değilse ya da değiştiyse ${admin ? "başka bir Protel yöneticisinden" : "Protel destek ekibinden"} Authenticator'ı sıfırlamasını isteyin.</p>
  <p class="muted"><a href="/login">Girişe dön</a></p>`);
}

function invitePage({ csrf, token, invited, invalid }) {
  if (invalid) return narrow(`
  <h1>Bağlantı geçersiz</h1>
  <p class="muted">Davetiye bağlantısının süresi dolmuş, daha önce kullanılmış ya da yeni bir davetiye gönderilmiş.
    Protel destek ekibinden yeni davetiye isteyin.</p>
  <p><a href="/login">Giriş sayfası</a></p>`);
  return narrow(`
  <h1>Hoş geldiniz</h1>
  <p class="muted">Kullanıcı adınız: <b>${esc(invited.username)}</b>${invited.full_name ? " · " + esc(invited.full_name) : ""}${invited.hotel_name ? " · " + esc(invited.hotel_name) : ""}.<br>Parolanızı belirleyin; ardından giriş yapılır ve SnapPass tarama ekranı açılır.</p>
  <form method="post" action="/invite/${esc(token)}">
    ${csrfField(csrf)}
    <div class="field"><label for="new">Parola</label><input type="password" id="new" name="new" required minlength="8" autocomplete="new-password" autofocus></div>
    <div class="field"><label for="new2">Parola (tekrar)</label><input type="password" id="new2" name="new2" required minlength="8" autocomplete="new-password"></div>
    <p class="muted">En az 8 karakter; harf ve rakam içermeli, kullanıcı adınızı içermemeli.</p>
    <button type="submit">Parolamı belirle ve giriş yap</button>
  </form>`);
}

function forgotPage({ csrf, available }) {
  if (!available) return narrow(`
  <h1>Parolamı unuttum</h1>
  <p class="muted">Parola sıfırlama şu an kullanılamıyor. Protel destek ekibinden yeni davetiye isteyin.</p>
  <p><a href="/login">Giriş sayfası</a></p>`);
  return narrow(`
  <h1>Parolamı unuttum</h1>
  <p class="muted">Kullanıcı adınızı ya da e-posta adresinizi yazın. Hesabınıza kayıtlı e-posta adresine yeni parola belirleme bağlantısı gönderilir.</p>
  <form method="post" action="/forgot">
    ${csrfField(csrf)}
    <div class="field"><label for="who">Kullanıcı adı ya da e-posta</label><input type="text" id="who" name="who" required autofocus autocomplete="username"></div>
    <button type="submit">Bağlantı gönder</button>
  </form>
  <p class="muted"><a href="/login">Girişe dön</a></p>`);
}

function resetPage({ csrf, token, target, invalid }) {
  if (invalid) return narrow(`
  <h1>Bağlantı geçersiz</h1>
  <p class="muted">Parola sıfırlama bağlantısının süresi dolmuş, daha önce kullanılmış ya da yeni bir bağlantı istenmiş.</p>
  <p><a href="/forgot">Yeni bağlantı iste</a> · <a href="/login">Giriş sayfası</a></p>`);
  return narrow(`
  <h1>Yeni parola</h1>
  <p class="muted">Kullanıcı adınız: <b>${esc(target.username)}</b>. Yeni parolanızı belirleyin; ardından giriş yapılır.</p>
  <form method="post" action="/reset/${esc(token)}">
    ${csrfField(csrf)}
    <div class="field"><label for="new">Yeni parola</label><input type="password" id="new" name="new" required minlength="8" autocomplete="new-password" autofocus></div>
    <div class="field"><label for="new2">Yeni parola (tekrar)</label><input type="password" id="new2" name="new2" required minlength="8" autocomplete="new-password"></div>
    <p class="muted">En az 8 karakter; harf ve rakam içermeli, kullanıcı adınızı içermemeli.</p>
    <button type="submit">Parolamı kaydet ve giriş yap</button>
  </form>`);
}

function passwordPage({ csrf, forced }) {
  return narrow(`
  <h1>Parola değiştir</h1>
  ${forced ? `<p class="muted">Devam etmeden önce yeni bir parola belirleyin.</p>` : ""}
  <form method="post" action="/account/password">
    ${csrfField(csrf)}
    <div class="field"><label for="current">Mevcut parola</label><input type="password" id="current" name="current" required autocomplete="current-password"></div>
    <div class="field"><label for="new">Yeni parola</label><input type="password" id="new" name="new" required minlength="8" autocomplete="new-password"></div>
    <div class="field"><label for="new2">Yeni parola (tekrar)</label><input type="password" id="new2" name="new2" required minlength="8" autocomplete="new-password"></div>
    <p class="muted">En az 8 karakter; harf ve rakam içermeli, kullanıcı adınızı içermemeli.</p>
    <button type="submit">Kaydet</button>
  </form>`);
}

function inviteLinkNotice(link) {
  return link ? `<div class="flash ok">E-posta gönderilemediği için davetiye bağlantısı yalnız bu ekranda bir kez gösteriliyor; kullanıcıya iletin:
    <br><code style="word-break: break-all">${esc(link[1])}</code> <span class="muted">(${esc(link[0])})</span></div>` : "";
}

function adminPage({ csrf, user, chains, orphans, admins, smtp, smtpOk, appUrl, inviteLink, google, defaultLang, retentionMonths, ohipUsage, usageRange, logRange, adminLog, hotels, enterprises, alertRows }) {
  const QUOTA = 30000; // Partner ortam paketi
  const fmt = (n) => Number(n || 0).toLocaleString("tr-TR");
  const R = usageRange || {}, LR = logRange || {};
  const trDay = (v) => v ? v.slice(8, 10) + "." + v.slice(5, 7) + "." + v.slice(0, 4) : "";
  const oneMonth = R.from && R.to && R.from.slice(0, 7) === R.to.slice(0, 7); // kota yüzdesi yalnız tek ay içindeki aralıkta anlamlı
  const usageRows = (ohipUsage || []).map(u => {
    const pct = u.env === "partner" && oneMonth ? Math.round((u.month / QUOTA) * 100) : null;
    const quota = pct !== null ? `${fmt(u.month)} / ${fmt(QUOTA)} <span class="muted">(%${pct})</span>` : u.env === "customer" ? `${fmt(u.month)} <span class="muted">bedelsiz</span>` : `${fmt(u.month)} <span class="muted">ortam seçilmedi</span>`;
    const warn = pct !== null && pct >= 80 ? ' style="color:#B91C1C;font-weight:700"' : "";
    const KIND = { "profil-okuma": "Profil okuma", "profil-arama": "Profil arama", "profil-yazma": "Profil yazma", "rezervasyon-okuma": "Rezervasyon okuma", "rezervasyon-yazma": "Rezervasyon yazma" };
    const kinds = Object.entries(u.kinds || {}).sort((a, b) => b[1] - a[1]);
    const days = Object.entries(u.days || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1));
    const detail = `<tr class="usage-detail" hidden><td colspan="4">
      <div class="usage-kinds">${kinds.map(([k, n]) => `<span class="chip">${esc(KIND[k] || k)}: <b>${fmt(n)}</b></span>`).join("") || '<span class="muted">Bu aralıkta çağrı yok.</span>'}</div>
      ${days.length ? `<table class="usage-days"><thead><tr><th>Gün</th>${Object.keys(KIND).map(k => `<th class="num">${KIND[k]}</th>`).join("")}<th class="num">Toplam</th></tr></thead><tbody>${days.map(([d, m]) => `<tr><td>${esc(trDay(d))}</td>${Object.keys(KIND).map(k => `<td class="num">${m[k] ? fmt(m[k]) : "·"}</td>`).join("")}<td class="num"><b>${fmt(Object.values(m).reduce((a, b) => a + b, 0))}</b></td></tr>`).join("")}</tbody></table>` : ""}
    </td></tr>`;
    return `<tr class="usage-row" tabindex="0" title="Ayrıntı için tıklayın"><td><span class="caret">▸</span> ${esc(u.name)} <span class="muted">${esc(u.code)}</span></td><td>${u.env === "partner" ? "Partner" : u.env === "customer" ? "Customer" : "—"}</td><td class="num">${fmt(u.today)}</td><td class="num"${warn}>${quota}</td></tr>${detail}`;
  }).join("");
  const usageTotal = (ohipUsage || []).reduce((a, u) => a + u.month, 0);
  const usageCard = `
<div class="card">
  <h2>OHIP Çağrı Sayacı <span class="muted">· ${esc(trDay(R.from))} – ${esc(trDay(R.to))}</span></h2>
  <form method="get" action="/admin#ohip" class="range-bar">
    <div class="range-box">
      <label class="range-field"><span>Başlangıç</span><input type="date" name="from" value="${esc(R.from || "")}" max="${esc(R.today || "")}" required></label>
      <span class="range-sep">→</span>
      <label class="range-field"><span>Bitiş</span><input type="date" name="to" value="${esc(R.to || "")}" max="${esc(R.today || "")}" required></label>
      <button type="submit" class="range-go">Göster</button>
    </div>
    <div class="range-chips">
      <a class="chip${R.from === R.monthStart && R.to === R.today ? " on" : ""}" href="/admin?from=${esc(R.monthStart || "")}&amp;to=${esc(R.today || "")}#ohip">Bu ay</a>
      <a class="chip${R.from === R.prevStart && R.to === R.prevEnd ? " on" : ""}" href="/admin?from=${esc(R.prevStart || "")}&amp;to=${esc(R.prevEnd || "")}#ohip">Geçen ay</a>
    </div>
  </form>
  ${usageRows ? `<div class="table-wrap"><table>
    <thead><tr><th>Otel</th><th>Ortam</th><th class="num">Bugün</th><th class="num">Seçili aralık</th></tr></thead>
    <tbody>${usageRows}</tbody>
    <tfoot><tr><td><b>Toplam</b></td><td></td><td></td><td class="num"><b>${fmt(usageTotal)}</b></td></tr></tfoot>
  </table></div>` : `<p class="muted">Bu aralıkta çağrı kaydı yok.</p>`}
  <p class="muted">Sunucudan OHIP'e giden her istek sayılır (kişi verisi tutulmaz). Partner ortamda paket aylık 30.000 çağrı; aralık tek bir ay içindeyse kota yüzdesi gösterilir, %80'i aşınca kırmızıdır. Ayrıntı için otele tıklayın.</p>
</div>`;
  // KBS sütunu: Pasif (KBS kapalı) · Bağlı · Bağlı değil · Bağlanıyor · Doğrulanmadı (Jandarma: oturum yok, son liste okumasına göre)
  const kbsCell = (h) => {
    const type = h.kbs_type === "jandarma" ? "Jandarma" : "Polis";
    const M = { off: ["Pasif", "", "KBS bildirimi kapalı"], stopped: ["Durduruldu", "pending", "KBS bağlantısı Protel yöneticisi tarafından durduruldu; KBS'ye istek gitmez"], on: ["Bağlı", "done", `${type} KBS bağlı`], down: ["Bağlı değil", "error", `${type} KBS bağlı değil; KBS Bilgileri'nden bağlanın`], busy: ["Bağlanıyor…", "pending", `${type} KBS bağlanıyor`], unknown: ["Doğrulanmadı", "", `${type} KBS: bilgiler henüz doğrulanmadı (KBS Gönderim ekranı açılınca okunur)`] };
    const [label, cls, title] = M[h.kbs_link] || M.off;
    return `<span class="badge ${cls}" title="${esc(title)}">${label}</span>${h.kbs_enabled ? ` <span class="muted" style="font-size: 12px">${type}</span>` : ""}`;
  };
  const envLabel = (e) => e === "partner" ? "Partner" : e === "customer" ? "Customer" : "—";
  const hotelTableRows = (hotels || []).map(h => `
      <tr data-name="${esc(((h.name || "") + " " + (h.hotel_code || "") + " " + (h.enterprise || "")).toLowerCase())}">
        <td><b><a href="/admin/hotels/${h.id}">${esc(h.name)}</a></b> <span class="muted">${esc(h.hotel_code || "")}</span>${h.two_factor ? ` <span class="badge done" title="İki adımlı doğrulama açık">2FA</span>` : ""}</td>
        <td>${!h.chain_id ? `<span class="badge pending">Enterprise yok</span>` : h.is_chain ? `<a href="/admin/chains/${h.chain_id}" title="Zincir: OHIP tanımları ve oteller">${esc(h.enterprise)}</a> <span class="badge">Zincir</span>` : `<span class="muted" title="Tek otel: OHIP tanımı otel ekranında">${esc(h.enterprise)}</span>`}</td>
        <td>${envLabel(h.env)}</td>
        <td>${kbsCell(h)}</td>
        <td class="num">${h.user_count}</td>
        <td class="num">${fmt(h.month)}</td>
        <td>${h.active ? `<span class="badge done">Aktif</span>` : `<span class="badge">Pasif</span>`}</td>
      </tr>`).join("");

  const adminRows = admins.map(a => `
      <tr>
        <td>${esc(a.email || a.username)}${String(a.id) === String(user.id) ? ` <span class="muted">(siz)</span>` : ""}</td>
        <td>${esc(a.full_name || "")}</td>
        <td>${fmtDate(a.last_login)}</td>
        <td>${a.active ? `<span class="badge done">Aktif</span>` : `<span class="badge">Pasif</span>`}${a.google_sub ? "" : ` <span class="badge">ilk giriş bekliyor</span>`}
          ${a.totp_enc ? `<span class="badge done" title="Authenticator kurulu">2FA</span>` : `<span class="badge pending" title="Sonraki girişte QR ile kurulacak">2FA kurulmadı</span>`}</td>
        <td class="actions">${String(a.id) === String(user.id) ? "" : `
          ${a.totp_enc ? `<form method="post" action="/admin/users/${a.id}/totp-reset" class="inline" data-confirm="${esc(a.email || a.username)} için Authenticator sıfırlansın mı? Sonraki girişte QR ile yeniden kuracak.">${csrfField(csrf)}<button class="link">Authenticator sıfırla</button></form>` : ""}
          <form method="post" action="/admin/users/${a.id}/toggle" class="inline">${csrfField(csrf)}<button class="link">${a.active ? "Pasifleştir" : "Aktifleştir"}</button></form>
          ${a.has_activity ? `<button type="button" class="link danger" disabled title="Hareketi var (giriş / işlem kaydı); silinemez. Gerekirse pasifleştirin.">Sil</button>` : `<form method="post" action="/admin/users/${a.id}/delete" class="inline" data-confirm="${esc(a.email || a.username)} yöneticilikten çıkarılsın mı?">${csrfField(csrf)}<button class="link danger">Sil</button></form>`}`}</td>
      </tr>`).join("");

  return `
<h1>Oteller <span class="muted">· Protel yönetim</span></h1>
${inviteLinkNotice(inviteLink)}

<div class="admin-tabs" role="tablist">
  <button type="button" class="admin-tab" data-tab="oteller" role="tab">🏨 Kayıtlı Oteller <span class="muted">(${(hotels || []).length})</span></button>
  <button type="button" class="admin-tab" data-tab="kurulum" role="tab">⚙️ Ayarlar${smtpOk ? "" : ` <span class="badge pending">gerekli</span>`}</button>
  <button type="button" class="admin-tab" data-tab="ohip" role="tab">📊 OHIP Çağrı Sayacı</button>
  <button type="button" class="admin-tab" data-tab="uyarilar" role="tab">🔔 Uyarılar${(alertRows || []).some(a => !a.resolved_at) ? ` <span class="badge pending">${alertRows.filter(a => !a.resolved_at).length}</span>` : ""}</button>
  <button type="button" class="admin-tab" data-tab="log" role="tab">📜 Değişiklikler</button>
</div>

<div data-panel="ekle" hidden>
  <div class="card">
    <h2>Otel Ekle</h2>
    <form method="post" action="/admin/hotels/new">
      ${csrfField(csrf)}
      <label class="check-line"><input type="checkbox" id="n_chain" name="is_chain" value="1"> <b>Zincir otel (Chain)</b> <span class="muted">— birden fazla otel aynı OHIP Enterprise'ı paylaşır</span></label>
      <div class="field" id="n_ent_box" style="max-width: 460px" hidden><label for="n_ent">Enterprise</label>
        <select id="n_ent" name="enterprise_choice">
          <option value="new">+ Yeni Enterprise (OHIP bilgilerini gireceğim)</option>
          ${(enterprises || []).map(e => `<option value="${e.id}">${esc(e.label)} · ${e.hotel_count} otel</option>`).join("")}
        </select>
        <p class="muted" style="margin: 4px 0 0">Aynı Enterprise'daki oteller OHIP tanımını paylaşır. Mevcut bir Enterprise'ı seçerseniz yalnızca HotelId yeterlidir.</p></div>

      <div id="ohip-fields" hidden>
        ${ohipCheck()}
        <div id="ohip-result" class="ohip-result" role="status" hidden></div>
        <p class="muted" style="margin: 0 0 8px">Oracle Developer Portal'da <b>Copy</b>'ye basıp buraya dönün, alanın yanındaki <b>📋 Yapıştır</b>'a basın.</p>
        <div class="field"><label for="n_host">HostName <span class="muted">(Gateway URL yapıştırılabilir)</span></label><div class="pasterow"><input type="url" id="n_host" name="host" data-req placeholder="https://...hospitality-api.oraclecloud.com"><button type="button" class="secondary small paste-btn" data-paste="n_host" data-kind="url">📋 Yapıştır</button></div></div>
        <div class="row">
          <div class="field"><label for="n_app">AppKey</label><div class="pasterow"><input type="text" id="n_app" name="app_key" data-req autocomplete="off"><button type="button" class="secondary small paste-btn" data-paste="n_app">📋 Yapıştır</button></div></div>
          <div class="field"><label for="n_ent_id">EnterpriseId</label><input type="text" id="n_ent_id" name="enterprise_id" data-req></div>
        </div>
        <div class="row">
          <div class="field"><label for="n_cid">CLIENT_ID</label><div class="pasterow"><input type="text" id="n_cid" name="client_id" data-req autocomplete="off"><button type="button" class="secondary small paste-btn" data-paste="n_cid">📋 Yapıştır</button></div></div>
          <div class="field"><label for="n_sec">CLIENT_SECRET</label><div class="pasterow"><input type="password" id="n_sec" name="client_secret" data-req autocomplete="new-password"><button type="button" class="secondary small paste-btn" data-paste="n_sec">📋 Yapıştır</button></div></div>
        </div>
        <div class="field"><label for="n_scope">Scope <span class="muted">(varsayılan değer dolu gelir, genelde değiştirilmez)</span></label>
          <div class="pasterow"><input type="text" id="n_scope" name="scope" value="${esc(DEFAULT_SCOPE)}">
            <button type="button" class="secondary small" onclick="document.getElementById('n_scope').value=${esc(JSON.stringify(DEFAULT_SCOPE))}">Varsayılana dön</button></div></div>
        <div class="field" style="max-width: 420px"><label for="n_env">Ortam</label>
          <select id="n_env" name="env" data-req>
            <option value="" selected disabled>— seçin —</option>
            <option value="customer">Customer (bedelsiz)</option>
            <option value="partner">Partner (paralı: 30.000 çağrı ≈ 10 USD/ay)</option>
          </select></div>
      </div>

      <div class="row">
        <div class="field" style="max-width: 420px"><label for="n_code">HotelId <span class="muted">(birden fazla ise virgülle ayırın; otel adı OPERA'dan alınır)</span></label><input type="text" id="n_code" name="hotel_code" required placeholder="MAGIST  ya da  AKV1, AKV2, AKV3" autocomplete="off"></div>
      </div>
      <p class="actions"><button type="submit">Otel ekle</button>
        <button type="button" class="secondary" id="n-test-btn" hidden>OHIP TEST</button></p>
      <p class="muted">Yeni Enterprise'da OHIP bağlantısı denenir ve Chain adı/kodu OPERA'dan alınıp kayıtta saklanır (Enterprise ekranında görünür).
        Kullanıcılar otel ekranından davet edilir.</p>
    </form>
  </div>
</div>

<script>
(function () {
  var panel = document.querySelector('[data-panel="ekle"]'); if (!panel) return;
  // Hata sonrası forma dönünce bilgiler korunur (Client Secret hariç: saklanmaz, yeniden girilir)
  var KEY = 'sp_newhotel', nform = panel.querySelector('form');
  var NFIELDS = ['is_chain', 'enterprise_choice', 'host', 'app_key', 'enterprise_id', 'client_id', 'scope', 'env', 'hotel_code'];
  if (nform) nform.addEventListener('submit', function () {
    try { var o = {}; NFIELDS.forEach(function (n) { var el = nform.elements[n]; if (!el) return; o[n] = el.type === 'checkbox' ? !!el.checked : el.value; }); sessionStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {}
  });
  try {
    var saved = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY);
    if (saved && nform && document.querySelector('.flash.error') && location.hash === '#ekle') {
      var v = JSON.parse(saved);
      NFIELDS.forEach(function (n) { var el = nform.elements[n]; if (!el || v[n] === undefined) return; if (el.type === 'checkbox') el.checked = !!v[n]; else el.value = v[n]; });
    }
  } catch (e) {}
  panel.addEventListener('click', function (ev) {
    var pb = ev.target.closest('.paste-btn');
    if (pb) {
      var inp = document.getElementById(pb.dataset.paste), old = pb.textContent;
      var done = function (m) { pb.textContent = m; setTimeout(function () { pb.textContent = old; }, 1800); };
      if (!navigator.clipboard || !navigator.clipboard.readText) return done('Pano kapalı');
      navigator.clipboard.readText().then(function (t) {
        t = String(t || '').trim();
        if (!t) return done('Pano boş');
        if (pb.dataset.kind === 'url') { try { t = new URL(t).origin; } catch (e) { return done('URL değil'); } }
        inp.value = t; inp.dispatchEvent(new Event('input', { bubbles: true })); done('✓ Yapıştırıldı');
      }, function () { done('İzin verilmedi'); });
      return;
    }
    var tb = ev.target.closest('#n-test-btn'); if (!tb) return;
    var form = tb.closest('form'), box = document.getElementById('ohip-result'), old2 = tb.textContent;
    var show = function (ok, msg) { box.hidden = false; box.className = 'ohip-result ' + (ok ? 'ok' : 'err'); box.textContent = msg; box.scrollIntoView({ block: 'center' }); };
    var p = new URLSearchParams(new FormData(form)); p.set('test_hotel', document.getElementById('n_code').value.replace(/;/g, ',').split(',')[0].trim().split(' ')[0]); // test ilk HotelId ile yapılır
    tb.disabled = true; tb.textContent = 'Test ediliyor…'; box.hidden = true;
    fetch('/admin/ohip-test', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p.toString() })
      .then(function (r) { return r.json(); })
      .then(function (j) { show(!!j.ok, j.message || (j.ok ? 'Başarılı' : 'Hata')); })
      .catch(function (e) { show(false, 'Test yapılamadı: ' + e.message); })
      .then(function () { tb.disabled = false; tb.textContent = old2; });
  });
})();
</script>

<div data-panel="oteller" hidden>
  <div class="card">
    <div class="actions" style="justify-content: space-between; align-items: center"><h2 style="margin: 0">Kayıtlı Oteller <span class="muted">(${(hotels || []).length})</span></h2>
      <button type="button" id="add-hotel-btn">➕ Otel ekle</button></div>
    ${(hotels || []).length ? `
    <div class="field" style="max-width: 320px"><input type="search" id="hotel-filter" placeholder="Otel, HotelId ya da Enterprise ara" aria-label="Otel ara"></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Otel</th><th>Enterprise</th><th>Ortam</th><th>KBS</th><th class="num">Kullanıcı</th><th class="num">OHIP (bu ay)</th><th>Durum</th></tr></thead>
      <tbody id="hotel-rows">${hotelTableRows}</tbody>
    </table></div>
    <p class="muted">Enterprise'a tıklayınca OHIP tanımları ve o Enterprise'daki oteller açılır. Otelde kullanıcı yönetimi, KBS ve otel ayarları vardır.</p>` : `<p class="muted">Henüz otel yok. <b>Otel ekle</b> sekmesinden ekleyin.</p>`}
  </div>
</div>

<div data-panel="ohip" hidden>
${usageCard}
</div>

<div data-panel="log" hidden>
<div class="card">
  <h2>Değişiklikler <span class="muted">· ${esc(trDay(LR.from))} – ${esc(trDay(LR.to))}</span></h2>
  <form method="get" action="/admin#log" class="range-bar">
    <div class="range-box">
      <label class="range-field"><span>Başlangıç</span><input type="date" name="lfrom" value="${esc(LR.from || "")}" max="${esc(LR.today || "")}" required></label>
      <span class="range-sep">→</span>
      <label class="range-field"><span>Bitiş</span><input type="date" name="lto" value="${esc(LR.to || "")}" max="${esc(LR.today || "")}" required></label>
      <button type="submit" class="range-go">Göster</button>
    </div>
    <input type="search" id="log-filter" placeholder="Ara: kişi, işlem, otel" aria-label="Logda ara" style="max-width: 280px">
  </form>
  ${(adminLog || []).length ? `<div class="table-wrap"><table>
    <thead><tr><th>Zaman</th><th>Kişi</th><th>İşlem</th><th>Otel</th><th>Açıklama</th></tr></thead>
    <tbody id="log-rows">${adminLog.map(a => `<tr data-q="${esc(((a.username || "") + " " + a.action + " " + (a.hotel_name || "") + " " + (a.hotel_code || "") + " " + a.detail).toLowerCase())}"><td style="white-space: nowrap">${esc(new Date(a.at).toLocaleString("tr-TR"))}</td><td>${esc(a.username || "—")}</td><td>${esc(a.action)}</td><td>${a.hotel_id ? `${esc(a.hotel_name || "")} <span class="muted">${esc(a.hotel_code || "")}</span>` : "—"}</td><td class="muted">${esc(a.detail)}</td></tr>`).join("")}</tbody>
  </table></div>` : `<p class="muted">Bu aralıkta kayıt yok.</p>`}
  <p class="muted">Yönetim panelindeki işlemler (otel, Enterprise, kullanıcı, ayar değişiklikleri ve yönetici girişleri). Kullanıcı arayüzündeki işlemler otelin kendi ekranında, <b>Değişiklikler</b> sekmesindedir.</p>
</div>
</div>

<div data-panel="uyarilar" hidden>
<div class="card">
  <h2>OHIP / KBS Uyarıları</h2>
  <p class="muted">Hata alındığında otel kullanıcılarına zil simgesi ve bir kez popup ile gösterilir; bağlantı düzelince otomatik kapanır. Son 7 gün listelenir.</p>
  ${(alertRows || []).length ? `<div class="table-wrap"><table><thead><tr><th>Durum</th><th>Otel</th><th>Kaynak</th><th>Mesaj</th><th>Tekrar</th><th>Son</th></tr></thead><tbody>
  ${alertRows.map(a => `<tr><td><span class="badge ${a.resolved_at ? "done" : "pending"}">${a.resolved_at ? "Çözüldü" : "Aktif"}</span></td><td>${esc(a.hotel_code)}</td><td>${esc(String(a.source).toUpperCase())}</td><td>${esc(a.message)}</td><td>${a.n}</td><td>${esc(new Date(a.last_at).toLocaleString("tr-TR"))}</td></tr>`).join("")}
  </tbody></table></div>` : `<p class="muted">Kayıtlı uyarı yok.</p>`}
</div>
</div>


<div data-panel="kurulum" hidden>

  <details class="card fold" id="yoneticiler">
    <summary><h2>Protel Yöneticileri</h2></summary>
  <div class="table-wrap"><table>
    <thead><tr><th>Google hesabı</th><th>Ad</th><th>Son giriş</th><th>Durum</th><th></th></tr></thead>
    <tbody>${adminRows}</tbody>
  </table></div>
  <form method="post" action="/admin/admins" class="row" style="margin-top: 12px">
    ${csrfField(csrf)}
    <div class="field"><label for="a_mail">Şirket Google hesabı (e-posta)</label><input type="email" id="a_mail" name="email" required placeholder="ad.soyad@${esc(google.domains[0] || "protel.com.tr")}"></div>
    <button type="submit" style="align-self: end">Yönetici ekle</button>
  </form>
  <p class="muted">Yöneticiler parola kullanmaz; giriş ekranındaki <b>Protel yönetici girişi</b> bağlantısıyla Google hesabından girer
    (izinli alan adları: ${esc(google.domains.map(d => "@" + d).join(", "))}), ardından Authenticator uygulamasındaki kodu girer.
    İlk girişte QR kodu okutularak kurulur.</p>
  </details>

  <details class="card fold" id="mail">
    <summary><h2>E-posta (SMTP) ve Uygulama Adresi</h2></summary>
    <form method="post" action="/admin/mail">
      ${csrfField(csrf)}
      <div class="row">
        <div class="field"><label for="m_host">Sunucu</label><input type="text" id="m_host" name="host" value="${esc(smtp.host)}" placeholder="smtp.office365.com"></div>
        <div class="field" style="max-width: 120px; min-width: 90px"><label for="m_port">Port</label><input type="number" id="m_port" name="port" value="${esc(smtp.port || 587)}"></div>
        <div class="field" style="max-width: 160px; min-width: 130px"><label for="m_sec">Güvenlik</label>
          <select id="m_sec" name="security">
            ${["starttls", "ssl", "none"].map(s => `<option value="${s}" ${(smtp.security || "starttls") === s ? "selected" : ""}>${s.toUpperCase()}</option>`).join("")}
          </select></div>
      </div>
      <div class="row">
        <div class="field"><label for="m_user">Kullanıcı adı</label><input type="text" id="m_user" name="username" value="${esc(smtp.username)}" autocomplete="off"></div>
        <div class="field"><label for="m_pass">Parola</label><input type="password" id="m_pass" name="password" autocomplete="new-password" placeholder="${smtp.password ? "Kayıtlı; değiştirmek için yazın" : ""}"></div>
      </div>
      <div class="row">
        <div class="field"><label for="m_from">Gönderen adresi</label><input type="email" id="m_from" name="sender" value="${esc(smtp.sender)}"></div>
        <div class="field"><label for="m_name">Gönderen adı</label><input type="text" id="m_name" name="sender_name" value="${esc(smtp.sender_name || "SnapPass")}"></div>
      </div>
      <div class="field"><label for="app_url">Uygulama adresi (davetiye bağlantısı)</label>
        <input type="url" id="app_url" name="app_url" value="${esc(appUrl)}" required placeholder="https://snappass.protel.com.tr"></div>
      <p class="actions"><button type="submit">Kaydet</button>
        <button type="submit" class="secondary" formaction="/admin/mail/test">Kendime test e-postası gönder</button></p>
      <p class="muted">Parola şifreli saklanır; boş bırakılırsa kayıtlı parola korunur. Davetiye e-postalarındaki parola belirleme
        bağlantısı uygulama adresiyle oluşturulur.</p>
    </form>
  </details>

  <details class="card fold" id="language">
    <summary><h2>Varsayılan Dil</h2></summary>
    <p class="muted">Kullanıcı kendi dilini seçmediyse uygulama bu dille açılır. Kullanıcılar uygulamadaki <b>TR | EN</b> düğmesiyle dili istedikleri zaman değiştirebilir
      (seçimleri o tarayıcıda hatırlanır).</p>
    <form method="post" action="/admin/language" class="row">
      ${csrfField(csrf)}
      <div class="field" style="max-width: 220px"><label for="def_lang">Dil</label>
        <select id="def_lang" name="lang">
          <option value="tr" ${defaultLang !== "en" ? "selected" : ""}>Türkçe</option>
          <option value="en" ${defaultLang === "en" ? "selected" : ""}>English</option>
        </select></div>
      <button type="submit" style="align-self: end">Kaydet</button>
    </form>
  </details>

  <details class="card fold" id="retention">
    <summary><h2>Kayıt Saklama Süresi</h2></summary>
    <p class="muted">Uygulamadan KBS'ye yapılan giriş, çıkış ve oda değişimi kayıtları (misafir adı, kimlik / pasaport no, işlemi yapan, KBS yanıtı) otelde <b>KBS Geçmişi</b> raporunda görülür.
      Bu süre dolunca kayıtlar kalıcı olarak silinir (günde bir kontrol edilir). Süreyi otelin hukuk / KVKK sorumlusu ile belirleyin; varsayılan 36 aydır.</p>
    <form method="post" action="/admin/retention" class="row">
      ${csrfField(csrf)}
      <div class="field" style="max-width: 220px"><label for="ret_m">Saklama süresi (ay)</label><input type="number" id="ret_m" name="months" min="12" max="240" value="${esc(retentionMonths || 36)}" required></div>
      <button type="submit" style="align-self: end">Kaydet</button>
    </form>
  </details>
</div>

<script>
(function () {
  var names = ['oteller', 'kurulum', 'ohip', 'uyarilar', 'log'];
  document.querySelectorAll('.usage-row').forEach(function (r) { var t = function () { var d = r.nextElementSibling; if (d && d.classList.contains('usage-detail')) { d.hidden = !d.hidden; r.classList.toggle('open', !d.hidden); } }; r.onclick = t; r.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t(); } }; });
  var lf = document.getElementById('log-filter');
  if (lf) lf.oninput = function () { var q = lf.value.trim().toLowerCase(); document.querySelectorAll('#log-rows tr').forEach(function (r) { r.hidden = q && r.dataset.q.indexOf(q) < 0; }); };
  var alias = { retention: 'kurulum', mail: 'kurulum', 'two-factor': 'kurulum', language: 'kurulum', yoneticiler: 'kurulum' }; // eski bağlantılar (#mail, #two-factor, #language)
  var tabs = document.querySelectorAll('.admin-tab'), panels = document.querySelectorAll('[data-panel]');
  var addOpen = false, addBtn = document.getElementById('add-hotel-btn');
  function show(n) {
    if (n === 'ekle') { n = 'oteller'; addOpen = true; }
    tabs.forEach(function (t) { t.classList.toggle('on', t.dataset.tab === n); });
    panels.forEach(function (p) { p.hidden = p.dataset.panel === 'ekle' ? !(n === 'oteller' && addOpen) : p.dataset.panel !== n; });
    if (addBtn) addBtn.textContent = addOpen ? '✕ Vazgeç' : '➕ Otel ekle';
    if (location.hash !== '#' + n) history.replaceState(null, '', '#' + n);
  }
  if (addBtn) addBtn.onclick = function () { addOpen = !addOpen; show('oteller'); if (addOpen) document.querySelector('[data-panel="ekle"]').scrollIntoView(); };
  tabs.forEach(function (t) { t.onclick = function () { show(t.dataset.tab); }; });
  var h = location.hash.slice(1), target = null;
  if (alias[h]) { target = document.getElementById(h); h = alias[h]; }
  if (h === 'ekle') addOpen = true;
  if (!${(hotels || []).length}) addOpen = true;
  show(h === 'ekle' ? 'oteller' : names.indexOf(h) >= 0 ? h : 'oteller');
  if (target) { target.open = true; target.scrollIntoView(); }
  var sel = document.getElementById('n_ent'), box = document.getElementById('ohip-fields'), chainCb = document.getElementById('n_chain'), entBox = document.getElementById('n_ent_box');
  function sync() {
    // Zincir değilse Enterprise seçimi gizlenir: otelin kendi OHIP tanımı girilir
    entBox.hidden = !chainCb.checked;
    var isNew = !chainCb.checked || sel.value === 'new';
    box.hidden = !isNew;
    var tb = document.getElementById('n-test-btn'); if (tb) tb.hidden = !isNew;
    box.querySelectorAll('[data-req]').forEach(function (i) { i.required = isNew; });
  }
  sel.onchange = sync; chainCb.onchange = sync; sync();
  var f = document.getElementById('hotel-filter');
  if (f) f.oninput = function () {
    var q = f.value.toLowerCase().trim();
    document.querySelectorAll('#hotel-rows tr').forEach(function (r) { r.hidden = q && r.dataset.name.indexOf(q) < 0; });
  };
})();
</script>`;
}

// OHIP tanımı girilirken gösterilen kontrol uyarısı: Oracle tarafındaki iki ayar (Module Level Access Control, Sensitive Data); Sensitive Data kapalıysa kimlik no okunamaz
function ohipCheck() {
  return `<div class="ohip-links">
    <a class="button secondary small" href="/admin/ohip-sihirbazi">🧭 Kurulum sihirbazı</a>
    <a class="button secondary small" href="/admin/ohip-rehberi">📘 OHIP kurulum bilgisi</a>
  </div>`;
}

// OHIP tanım formu: Enterprise ekranında (zincir) ve tek otelde otel ekranında aynı form kullanılır
function ohipForm({ csrf, chainId, ohip, ohipHasSecret, ohipMissing, defaultScope, backHotel = 0, testHotel = "" }) {
  return `
  ${ohipCheck()}
  <form method="post" action="/admin/chains/${chainId}/ohip" id="ohip-form" data-test-url="/admin/chains/${chainId}/ohip-test">
    ${csrfField(csrf)}${backHotel ? `<input type="hidden" name="back_hotel" value="${backHotel}">` : ""}
    <div id="ohip-result" class="ohip-result" role="status" hidden></div>
    <p class="muted" style="margin: 0 0 8px">Oracle Developer Portal'da <b>Copy</b>'ye basıp buraya dönün, alanın yanındaki <b>📋 Yapıştır</b>'a basın. <a href="/admin/ohip-sihirbazi">Adım adım kurulum sihirbazı</a></p>
    <div class="field"><label for="oh_host">HostName <span class="muted">(Gateway URL yapıştırılabilir)</span></label><div class="pasterow"><input type="url" id="oh_host" name="host" value="${esc(ohip.host)}" placeholder="https://...hospitality-api....oraclecloud.com"><button type="button" class="secondary small paste-btn" data-paste="oh_host" data-kind="url">📋 Yapıştır</button></div></div>
    <div class="row">
      <div class="field"><label for="oh_app">AppKey</label><div class="pasterow"><input type="text" id="oh_app" name="app_key" value="${esc(ohip.app_key)}" autocomplete="off"><button type="button" class="secondary small paste-btn" data-paste="oh_app">📋 Yapıştır</button></div></div>
      <div class="field"><label for="oh_ent">EnterpriseId</label><input type="text" id="oh_ent" name="enterprise_id" value="${esc(ohip.enterprise_id)}"></div>
    </div>
    <div class="row">
      <div class="field"><label for="oh_cid">CLIENT_ID</label><div class="pasterow"><input type="text" id="oh_cid" name="client_id" value="${esc(ohip.client_id)}" autocomplete="off"><button type="button" class="secondary small paste-btn" data-paste="oh_cid">📋 Yapıştır</button></div></div>
      <div class="field"><label for="oh_sec">CLIENT_SECRET</label><div class="pasterow"><input type="password" id="oh_sec" name="client_secret" autocomplete="new-password"
        placeholder="${ohipHasSecret ? "Kayıtlı; değiştirmek için yazın" : ""}"><button type="button" class="secondary small paste-btn" data-paste="oh_sec">📋 Yapıştır</button></div></div>
    </div>
    <script>
    (function () {
      var box = document.getElementById('ohip-result'), form = document.getElementById('ohip-form');
      function show(ok, msg) { box.hidden = false; box.className = 'ohip-result ' + (ok ? 'ok' : 'err'); box.textContent = msg; box.scrollIntoView({ block: 'nearest' }); }
      form.addEventListener('click', function (ev) {
        var tb = ev.target.closest('#ohip-test-btn'); if (!tb) return;
        tb.disabled = true; var old = tb.textContent; tb.textContent = 'Test ediliyor…';
        box.hidden = true;
        fetch(form.dataset.testUrl, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(new FormData(form)).toString() })
          .then(function (r) { return r.json(); })
          .then(function (j) { show(!!j.ok, j.message || (j.ok ? 'Başarılı' : 'Hata')); })
          .catch(function (e) { show(false, 'Test yapılamadı: ' + e.message); })
          .then(function () { tb.disabled = false; tb.textContent = old; });
      });
      document.querySelectorAll('.paste-btn').forEach(function (b) {
        b.onclick = function () {
          var inp = document.getElementById(b.dataset.paste), old = b.textContent;
          var done = function (m) { b.textContent = m; setTimeout(function () { b.textContent = old; }, 1800); };
          if (!navigator.clipboard || !navigator.clipboard.readText) return done("Pano kapalı");
          navigator.clipboard.readText().then(function (t) {
            t = String(t || "").trim();
            if (!t) return done("Pano boş");
            if (b.dataset.kind === "url") { try { t = new URL(t).origin; } catch (e) { return done("URL değil"); } }
            inp.value = t;
            inp.dispatchEvent(new Event("input", { bubbles: true }));
            done("✓ Yapıştırıldı");
          }, function () { done("İzin verilmedi"); });
        };
      });
    })();
    </script>
    <div class="field" style="max-width: 420px"><label for="oh_hotel">HotelId <span class="muted">(OHIP testi için zorunlu; otel adı OHIP'ten gelir)</span></label><input type="text" id="oh_hotel" name="test_hotel" value="${esc(testHotel)}" placeholder="MAGIST" autocomplete="off"></div>
    <div class="field"><label for="oh_scope">Scope <span class="muted">(varsayılan değer dolu gelir, genelde değiştirilmez)</span></label>
      <div class="pasterow"><input type="text" id="oh_scope" name="scope" value="${esc(ohip.scope || defaultScope)}">
        <button type="button" class="secondary small" onclick="document.getElementById('oh_scope').value=${esc(JSON.stringify(defaultScope))}">Varsayılana dön</button></div></div>
    <div class="field" style="max-width: 420px"><label for="oh_env">Ortam</label>
      <select id="oh_env" name="env" required>
        ${ohip.env ? "" : '<option value="" selected disabled>— seçin —</option>'}
        <option value="customer"${ohip.env === "customer" ? " selected" : ""}>Customer (bedelsiz)</option>
        <option value="partner"${ohip.env === "partner" ? " selected" : ""}>Partner (paralı: 30.000 çağrı ≈ 10 USD/ay)</option>
      </select>
      <p class="muted" style="margin: 4px 0 0">Ortama göre tarama uygulamasının KBS listesi otomatik yenileme sıklığı ayarlanır: Customer 60 sn, Partner 120 sn.</p></div>
    <p class="actions"><button type="submit" name="action" value="save">Kaydet</button>
      <button type="button" class="secondary" id="ohip-test-btn">OHIP TEST</button></p>
    <p class="muted">Client secret şifreli saklanır; boş bırakılırsa kayıtlı değer korunur. OHIP TEST kaydetmeden dener (HotelId girilmesi gerekir); Kaydet, tanımlar tamamsa OHIP'ten
      oturum anahtarı alır ve Chain adı/kodu OPERA'dan güncellenir.
      ${ohipMissing.length ? `Eksik: <b>${esc(ohipMissing.join(", "))}</b>.` : ""}</p>
  </form>
`;
}

// OHIP Kurulum Sihirbazı: Oracle Developer Portal adımları + sabit değerler için Kopyala düğmeleri (Oracle'a giriş ve tıklamalar kullanıcıda kalır)
const WIZ_CONTACT = { first: "Protel", last: "E-Destek", email: "operacloudmonitor@protel.com.tr", phone: "0085033377 85", company: "Protel Bilgisayar A.Ş." };
const WIZ_DESC = "1774 Sayılı Kimlik Bildirme Kanunu kapsamında konaklayan misafirlerin ve çalışanların kimlik bilgilerini Emniyet Genel Müdürlüğü veya Jandarma Genel Komutanlığı'na elektronik ortamda anlık olarak bildirmesini sağlayan yasal bir sistemdir.";
const WIZ_JUST = "Kimlik Bildirim Sistemi (KBS), 1774 Sayılı Kimlik Bildirme Kanunu";

function ohipWizardPage({ backUrl }) {
  const row = (label, val) => `<tr><td>${esc(label)}</td><td class="wiz-val">${esc(val)}</td><td><button type="button" class="secondary small copy-btn" data-copy="${esc(val)}">Kopyala</button></td></tr>`;
  return `
<p><a href="${esc(backUrl)}">&larr; Geri dön</a></p>
<h1>OHIP Kurulum Sihirbazı</h1>
<p class="muted">Oracle'a giriş ve tıklamalar sizde kalır; sihirbaz sabit değerleri kopyalatır, Oracle'dan aldığınız değerleri forma yapıştırtır. Ayrıntılı anlatım: <a href="/admin/ohip-rehberi">OHIP kurulum bilgisi</a>.</p>

<div class="card"><h2>1. Application kaydı <span class="muted">(AppKey)</span></h2>
  <p>Developer Portal → <b>Applications</b> → <b>Register Application</b>. Alanlara şunları yapıştırın:</p>
  <div class="table-wrap"><table><tbody>
    ${row("Application Name", "Kimlik Bildirim Sistemi")}
    ${row("Description", WIZ_DESC)}
    ${row("Business Justification", WIZ_JUST)}
    ${row("First Name", WIZ_CONTACT.first)}
    ${row("Last Name", WIZ_CONTACT.last)}
    ${row("Email", WIZ_CONTACT.email)}
    ${row("Phone", WIZ_CONTACT.phone)}
    ${row("Company Name", WIZ_CONTACT.company)}
  </tbody></table></div>
  <p>Kayıttan sonra uygulama kartında <b>View details</b> → <b>Application Key</b> → <b>Copy</b>. Sonra <b>OHIP formunda AppKey yanındaki 📋 Yapıştır</b>'a basın.</p>
</div>

<div class="card"><h2>2. Client ID <span class="muted">(Environments)</span></h2>
  <ol>
    <li>Developer Portal → <b>Environments</b> → otelin ortamı → <b>View Details</b> → <b>Add Client</b>.</li>
    <li><b>Client Name</b> girin, <b>Modules</b>: <b>All Modules</b>, <b>Assigned Hotels</b>: ilgili oteller, <b>Grant Sensitive Data Access</b> kapalıysa AÇIK yapın.</li>
    <li>Summary ekranında <b>Client ID</b> ve <b>Client Secret</b> görünür; her birini <b>Copy</b> ile kopyalayıp forma yapıştırın. Secret bir kez gösterilir; ekranı kapatmadan alın.</li>
    <li>Aynı ortamın ayrıntı sayfasındaki <b>Gateway URL</b>'yi kopyalayıp <b>HostName</b> yanındaki 📋 Yapıştır ile girin (yalnız adres kısmı alınır).</li>
  </ol>
</div>

<div class="card"><h2>3. Oracle ayarlarını kontrol edin</h2>
  <ul>
    <li><b>Module Level Access Control</b> (Customer Portal → Global Administration → Controls): kapalıysa AÇIK yapın.</li>
    <li><b>Grant Sensitive Data Access</b>: kapalıysa AÇIK yapın (kimlik no bunsuz okunamaz). Partner ortamında: Environments → Partner Connections → turkey → Module Permissions → Edit.</li>
  </ul>
</div>

<div class="card"><h2>4. SnapPass'a girin ve test edin</h2>
  <p>Formda <b>EnterpriseId</b> ve <b>Ortam</b> (Customer/Partner) seçili olmalı, ardından <b>Kaydet ve OHIP TEST</b>.</p>
  <p><a class="button" href="${esc(backUrl)}">OHIP formuna dön</a></p>
</div>

<style>
.wiz-val { word-break: break-word; max-width: 560px; }
.pasterow { display: flex; gap: 6px; align-items: center; }
.pasterow input { flex: 1; min-width: 0; }
.paste-btn, .copy-btn { white-space: nowrap; }
</style>
<script>
(function () {
  document.querySelectorAll('.copy-btn').forEach(function (b) {
    b.onclick = function () {
      var old = b.textContent, v = b.dataset.copy;
      var ok = function () { b.textContent = "✓ Kopyalandı"; setTimeout(function () { b.textContent = old; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(ok, function () { b.textContent = "İzin yok"; });
      else { var t = document.createElement("textarea"); t.value = v; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); ok(); } catch (e) {} t.remove(); }
    };
  });
})();
</script>`;
}

function chainPage({ csrf, chain, ohip, ohipHasSecret, ohipMissing, hotels, operaHotels, defaultScope }) {
  const known = new Set(hotels.map(h => h.hotel_code));
  const hotelRows = hotels.map(h => `
      <tr>
        <td><a href="/admin/hotels/${h.id}">${esc(h.name)}</a></td>
        <td style="font-family: monospace">${esc(h.hotel_code || "—")}</td>
        <td class="num">${h.user_count}</td>
        <td>${h.active ? `<span class="badge done">Aktif</span>` : `<span class="badge">Pasif</span>`}</td>
        <td class="actions" style="white-space: nowrap">
          <form method="post" action="/admin/hotels/${h.id}/active" class="inline" data-confirm="${esc(h.name)} ${h.active ? "pasife alınsın mı? Otel kullanıcıları giriş yapamaz." : "aktife alınsın mı?"}">
            ${csrfField(csrf)}<input type="hidden" name="back" value="chain"><button class="link">${h.active ? "Pasife al" : "Aktife al"}</button></form></td>
      </tr>`).join("");
  const operaRows = (operaHotels || []).map(o => `
      <tr>
        <td>${esc(o.name)}${o.inactive ? ` <span class="badge">pasif</span>` : ""}</td>
        <td style="font-family: monospace">${esc(o.hotelId)}</td>
        <td class="actions">${known.has(o.hotelId) ? `<span class="muted">Ekli</span>` : `
          <form method="post" action="/admin/chains/${chain.id}/hotels" class="inline">
            ${csrfField(csrf)}<input type="hidden" name="hotel_code" value="${esc(o.hotelId)}"><input type="hidden" name="name" value="${esc(o.name)}">
            <button class="link">Ekle</button></form>`}</td>
      </tr>`).join("");

  return `
<p><a href="/admin#oteller">&larr; Oteller</a></p>
<div class="actions" style="justify-content: space-between">
  <h1><span class="muted">Enterprise</span> ${esc(ohip.enterprise_id || chain.name || "Tanımsız")}</h1>
  ${hotels.length ? "" : `<form method="post" action="/admin/chains/${chain.id}/delete" class="inline" data-confirm="Enterprise kaydı silinsin mi?">
    ${csrfField(csrf)}<button class="link danger">Enterprise'ı sil</button></form>`}
</div>
<p class="muted" style="margin-top: -8px">Chain (OPERA kayıt bilgisi): <b>${esc(chain.name || "—")}</b>${chain.chain_code ? ` · kod <b>${esc(chain.chain_code)}</b>` : ""}</p>

<div class="card" id="hotels">
  <h2>Bağlı Oteller <span class="muted">(${hotels.length})</span></h2>
  ${hotels.length ? `<div class="table-wrap"><table>
    <thead><tr><th>Otel</th><th>HotelId</th><th class="num">Kullanıcı</th><th>Durum</th><th></th></tr></thead>
    <tbody>${hotelRows}</tbody></table></div>` : `<p class="muted">Bu Enterprise'da henüz otel yok.</p>`}

  <form method="post" action="/admin/chains/${chain.id}/hotels" class="row" style="margin-top: 12px">
    ${csrfField(csrf)}
    <div class="field" style="max-width: 420px"><label for="h_code">HotelId <span class="muted">(birden fazla ise virgülle ayırın)</span></label><input type="text" id="h_code" name="hotel_code" required placeholder="MAGIST  ya da  AKV1, AKV2, AKV3"></div>
    <button type="submit" style="align-self: end" ${ohipMissing.length ? "disabled title=\"Önce OHIP tanımlarını girin\"" : ""}>Otel ekle</button>
  </form>
  <p class="muted">Otel adı HotelId ile OPERA'dan alınır. Birden çok otel için kodları virgülle ayırarak yazın.</p>
</div>

<details class="card fold" id="ohip"${ohipMissing.length ? " open" : ""}>
  <summary><h2>OHIP Tanımları <span class="muted">· Enterprise'daki tüm oteller için ortak</span>
    ${ohipMissing.length ? `<span class="badge pending">Eksik</span>` : `<span class="badge done">Tanımlı</span>`}</h2></summary>
  ${ohipForm({ csrf, chainId: chain.id, ohip, ohipHasSecret, ohipMissing, defaultScope, testHotel: (hotels[0] && hotels[0].hotel_code) || "" })}
</details>
`;
}

function hotelPage({ csrf, hotel, chains, users, smtpOk, inviteLink, ohipReady, ohipEnv, enterpriseId, hasActivity, ohipCfg = {}, defaultScope = "", ha = null, viewerId = null }) {
  const isChain = !!hotel.chain_is_chain;
  const ohipMissingH = ["host", "app_key", "client_id", "client_secret", "enterprise_id"].filter(k => !ohipCfg[k]);
  // Kullanıcı listesi: her kullanıcı tek satır (ad, kullanıcı adı, e-posta, durum etiketleri); işlemler "Düzenle" ile açılır
  const userRows = users.map(u => {
    const locked = u.locked_until && new Date(u.locked_until) > new Date();
    return `
    <details class="user-item">
      <summary>
        <div class="ui-who"><b>${esc(u.full_name || u.username)}</b>${u.full_name ? ` <span class="muted">${esc(u.username)}</span>` : ""} <span class="muted ui-mail">· ${esc(u.email || "e-posta yok")}</span></div>
        <div class="ui-tags">
          <span class="ui-kv"><span class="muted">2FA</span> <b>${!hotel.two_factor ? "kapalı" : u.two_factor_mode === "totp" ? "Authenticator" : "E-posta kodu"}</b></span>
          ${hotel.kbs_enabled ? `<span class="ui-kv" title="KBS giriş bilgilerini (kullanıcı adı, parola, TC kimlik no) görme / değiştirme yetkisi. KBS sekmesini kullanmak için gerekmez."><span class="muted">KBS giriş bilgileri</span> <b>${u.kbs_manage ? "düzenleyebilir" : "—"}</b></span><span class="ui-kv" title="KBS gönderim geçmişi raporunu (kim, ne zaman, ne gönderildi) görme yetkisi."><span class="muted">KBS geçmişi</span> <b>${u.kbs_report ? "görebilir" : "—"}</b></span>` : ""}
          <span class="ui-kv" title="Profil işlemleri yetkileri: eşleşen profille birleştirme · rezervasyonun ana profilini değiştirme · beraberindeki değiştirme"><span class="muted">Profil işlemleri</span> <b>${[u.can_merge && "birleştirme", u.can_change_main && "ana profil", u.can_change_accompany && "beraberindeki"].filter(Boolean).join(" · ") || "—"}</b></span>
          ${u.hotel_admin && !ha ? `<span class="badge done" title="Kendi otelinin yönetim ekranını (kullanıcılar, otel tanımları, OHIP sayacı, değişiklikler) ikinci doğrulamayla açabilir">Otel yöneticisi</span>` : ""}
          ${u.password_hash ? "" : `<span class="badge pending">Davetiye bekliyor</span>`}
          ${locked ? `<span class="badge failed">Kilitli</span>` : ""}
          ${u.active ? `<span class="badge done">Aktif</span>` : `<span class="badge">Pasif</span>`}
        </div>
      </summary>
      <div class="ui-body">
        <div class="muted ui-info">Son giriş: ${fmtDate(u.last_login) || "henüz yok"}</div>
        ${`
        <form method="post" action="/admin/users/${u.id}/update" class="ui-row" id="uf${u.id}">
          ${csrfField(csrf)}
          <label class="ui-f">E-posta<input type="email" name="email" value="${esc(u.email || "")}" required></label>
          <label class="ui-f">2FA${hotel.two_factor ? `<select name="mode">
              <option value=""${u.two_factor_mode !== "totp" ? " selected" : ""}>E-posta kodu</option>
              <option value="totp"${u.two_factor_mode === "totp" ? " selected" : ""}>Authenticator</option>
            </select>` : `<span class="muted ui-off">Otelde kapalı</span>`}</label>
          <div class="ui-perms" style="flex-basis: 100%; display: flex; flex-direction: column; align-items: flex-start; gap: 8px">
          ${hotel.kbs_enabled ? `<label class="ui-f ui-check" title="KBS sekmesini herkes kullanır; bu yetki yalnız KBS kullanıcı adı, parola ve TC kimlik no'yu görme / değiştirme içindir."><input type="hidden" name="kbs_present" value="1"><input type="checkbox" name="kbs_manage" value="1"${u.kbs_manage ? " checked" : ""}> KBS giriş bilgilerini düzenleyebilir</label><label class="ui-f ui-check" title="Uygulamada KBS Geçmişi raporunu (misafir bazında gönderim kayıtları, yazdırılabilir) görür. Telefonda gösterilmez."><input type="checkbox" name="kbs_report" value="1"${u.kbs_report ? " checked" : ""}> KBS geçmişini görebilir</label>` : ""}
          ${ha ? "" : `<input type="hidden" name="ha_present" value="1"><label class="ui-f ui-check" title="Yalnız Protel yöneticisi verir. Bu kullanıcı kendi otelinin yönetim ekranını (kullanıcılar, otel tanımları, OHIP sayacı, uyarılar, değişiklikler) açabilir; her oturumda e-posta kodu ya da Authenticator ister. Ayarlar ve diğer oteller Protel'e özeldir."><input type="checkbox" name="hotel_admin" value="1"${u.hotel_admin ? " checked" : ""}> Otel yöneticisi</label>`}
          <input type="hidden" name="prof_present" value="1">
          <label class="ui-f ui-check" title="Eşleşen profil listesinde başka bir profille birleştirme düğmesini görür. OPERA'da geri alınamaz."><input type="checkbox" name="can_merge" value="1"${u.can_merge ? " checked" : ""}> Profilleri birleştirebilir</label>
          <label class="ui-f ui-check" title="Eşleşen profili rezervasyonun ana (birincil) profili yapabilir."><input type="checkbox" name="can_change_main" value="1"${u.can_change_main ? " checked" : ""}> Rezervasyonun ana profilini değiştirebilir</label>
          <label class="ui-f ui-check" title="Rezervasyondaki beraberindeki misafirin profilini eşleşen profille değiştirebilir (eskisi çıkarılır, yenisi eklenir)."><input type="checkbox" name="can_change_accompany" value="1"${u.can_change_accompany ? " checked" : ""}> Beraberindeki profilini değiştirebilir</label>
          </div>
        </form>
        <div class="ui-actions">
          <form method="post" action="/admin/users/${u.id}/invite" class="inline" data-confirm="${esc(u.email || u.username)} için ${u.password_hash ? "parola sıfırlama" : "davetiye"} bağlantısı gönderilsin mi? Önceki bağlantı geçersiz olur.">${csrfField(csrf)}<button type="submit" class="secondary small" title="${u.password_hash ? "Parola sıfırlama bağlantısı gönderir" : "Davetiyeyi yeniden gönderir"}">${u.password_hash ? "Sıfırla" : "Davetiye"}</button></form>
          ${hotel.two_factor && u.two_factor_mode === "totp" && u.totp_enc ? `<form method="post" action="/admin/users/${u.id}/totp-reset" class="inline" data-confirm="${esc(u.email || u.username)} için Authenticator sıfırlansın mı? Sonraki girişte yeniden kurar.">${csrfField(csrf)}<button type="submit" class="secondary small" title="Authenticator kurulumunu sıfırlar">Auth sıfırla</button></form>` : ""}
          <form method="post" action="/admin/users/${u.id}/toggle" class="inline" data-confirm="${esc(u.username)} ${u.active ? "pasif yapılsın mı? Giriş yapamaz." : "aktif yapılsın mı?"}">${csrfField(csrf)}<button type="submit" class="secondary small">${u.active ? "Pasif" : "Aktif"}</button></form>
          ${u.has_activity ? `<button type="button" class="secondary small danger" disabled title="Kullanıcı hareketi var (giriş, işlem ya da KBS kaydı); silinemez. Gerekirse pasifleştirin.">Sil</button>` : `<form method="post" action="/admin/users/${u.id}/delete" class="inline" data-confirm="${esc(u.username)} kalıcı olarak silinsin mi?">${csrfField(csrf)}<button type="submit" class="secondary small danger">Sil</button></form>`}
          <button type="submit" form="uf${u.id}" class="small">Kaydet</button>
        </div>`}
      </div>
    </details>`;
  }).join("");

  return `
${ha ? `<p><a href="/">&larr; Kullanıcı Arayüzü</a> <span class="muted">· Otel yönetimi</span></p>` : `<p><a href="/admin#oteller">&larr; Oteller</a>`}${!ha && hotel.chain_id && isChain ? ` · <a href="/admin/chains/${hotel.chain_id}">Enterprise ${esc(enterpriseId || hotel.chain_title || "")}</a>` : ""}</p>
<div class="actions" style="justify-content: space-between">
  <h1>${esc(hotel.name)} ${hotel.hotel_code ? `<span class="muted">${esc(hotel.hotel_code)}</span>` : ""}</h1>
  ${ha ? "" : `<span class="actions head-actions">
    ${ohipReady ? `<form method="post" action="/admin/hotels/${hotel.id}/scanner" class="inline">${csrfField(csrf)}<button type="submit" title="Uygulamayı bu otelin kullanıcısı gibi açar">🖥 Kullanıcı arayüzü</button></form>` : ""}
    <form method="post" action="/admin/hotels/${hotel.id}/active" class="inline" data-confirm="${esc(hotel.name)} ${hotel.active ? "pasife alınsın mı? Otel kullanıcıları giriş yapamaz." : "aktife alınsın mı?"}">
      ${csrfField(csrf)}<button type="submit" class="secondary">${hotel.active ? "Pasife al" : "Aktife al"}</button></form>
    ${hasActivity ? `<button type="button" class="secondary danger" disabled title="Otelde kullanıcı hareketi var (giriş, OPERA / KBS işlemi); silinemez. Gerekirse pasife alın.">Oteli sil</button></span>` : `<form method="post" action="/admin/hotels/${hotel.id}/delete" class="inline" data-confirm="${esc(hotel.name)}${users.length ? ` ve ${users.length} kullanıcısı` : ""} kalıcı olarak silinsin mi?">
      ${csrfField(csrf)}<button type="submit" class="secondary danger">Oteli sil</button></form></span>`}`}
</div>
${inviteLinkNotice(inviteLink)}
${ha ? `<div class="admin-tabs" role="tablist">
  <button type="button" class="admin-tab" data-tab="otel" role="tab">🏨 Otel</button>
  <button type="button" class="admin-tab" data-tab="ohip" role="tab">📊 OHIP Çağrı Sayacı</button>
  <button type="button" class="admin-tab" data-tab="uyarilar" role="tab">🔔 Uyarılar${ha.alertRows.some(a => !a.resolved_at) ? ` <span class="badge pending">${ha.alertRows.filter(a => !a.resolved_at).length}</span>` : ""}</button>
  <button type="button" class="admin-tab" data-tab="log" role="tab">📜 Değişiklikler</button>
</div>
<div data-panel="otel">` : ""}

<div class="card">
  <div class="actions" style="justify-content: space-between; align-items: center"><h2 style="margin: 0">Otel kullanıcıları <span class="muted">(${users.length})</span></h2>
    <button type="button" id="new-user-btn">➕ Kullanıcı oluştur</button></div>
  <form method="post" action="/admin/hotels/${hotel.id}/users" id="new-user-form" class="new-user" hidden>
    ${csrfField(csrf)}
    <div class="row">
      <div class="field"><label for="c_user">Kullanıcı adı</label><input type="text" id="c_user" name="username" required pattern="[A-Za-z0-9._@\\-]{3,60}" placeholder="ör. resepsiyon1"></div>
      <div class="field"><label for="c_name">Ad soyad</label><input type="text" id="c_name" name="full_name" required></div>
      <div class="field"><label for="c_mail">E-posta</label><input type="email" id="c_mail" name="email" required></div>
    </div>
    <p class="actions"><button type="submit" id="new-user-save" disabled>Oluştur ve davetiye gönder</button> <button type="button" class="secondary" id="new-user-cancel">Vazgeç</button></p>
    <p class="muted">${smtpOk ? "Kullanıcıya parolasını kendisinin belirleyeceği bağlantı (7 gün geçerli) e-postayla gider."
      : `E-posta ayarları girilmediği için davetiye bağlantısı bir kez ekranda gösterilir.${ha ? "" : ` <a href="/admin#mail">E-posta ayarları</a>`}`}</p>
  </form>
  ${users.length ? `<div class="user-list">${userRows}</div>` : `<p class="muted">Bu otelin henüz kullanıcısı yok. <b>Kullanıcı oluştur</b> ile ekleyin.</p>`}
  <script>
  (function () {
    var btn = document.getElementById('new-user-btn'), form = document.getElementById('new-user-form'), save = document.getElementById('new-user-save');
    var sync = function () { save.disabled = !form.checkValidity(); };
    btn.onclick = function () { form.hidden = !form.hidden; btn.hidden = !form.hidden; if (!form.hidden) document.getElementById('c_user').focus(); };
    document.getElementById('new-user-cancel').onclick = function () { form.reset(); form.hidden = true; btn.hidden = false; sync(); };
    form.addEventListener('input', sync); sync();
  })();
  </script>
</div>

<div class="card">
  <h2>Otel ayarları</h2>
  ${ha ? `<div class="set-row" style="border-top: 0">
    <span class="set-label">OHIP tanımı</span>
    <span><b>EnterpriseId</b> ${esc(ohipCfg.enterprise_id || "—")} · <b>HotelId</b> ${esc(hotel.hotel_code || "—")} · ${ohipCfg.env === "partner" ? "Partner" : ohipCfg.env === "customer" ? "Customer" : "ortam seçilmedi"} · ${ha.missing ? `<span class="badge pending">Eksik</span>` : `<span class="badge done">Tanımlı</span>`}</span>
    <span class="muted set-help">Yalnız görüntülenir; OHIP tanımı ve gizli anahtarlar Protel yöneticisi tarafından yönetilir.</span>
  </div>` : hotel.chain_id ? `
  <div class="set-row" style="border-top: 0">
    <span class="set-label">Zincir otel (Chain)</span>
    <form method="post" action="/admin/hotels/${hotel.id}/chain-mode" class="inline" data-confirm="${isChain ? (hotel.chain_hotel_count > 1 ? `Bu otel zincirden ayrılsın mı? OHIP tanımının bir kopyası bu otele alınır ve otel ekranında düzenlenir. Zincirdeki diğer ${hotel.chain_hotel_count - 1} otel etkilenmez.` : "Zincir kapatılsın mı? OHIP tanımı bu otelin ekranında düzenlenir, Enterprise ekranı gizlenir.") : "Zincir otel olarak işaretlensin mi? OHIP tanımı Enterprise ekranında düzenlenir ve aynı Enterprise'a başka oteller eklenebilir."}">
      ${csrfField(csrf)}<input type="hidden" name="on" value="${isChain ? "0" : "1"}">
      <button type="submit" class="toggle ${isChain ? "on" : ""}">${isChain ? "AÇIK" : "KAPALI"}</button></form>
    <span class="muted set-help">${isChain ? `Enterprise: <a href="/admin/chains/${hotel.chain_id}"><b>${esc(enterpriseId || hotel.chain_title || "—")}</b></a> · HotelId: <b>${esc(hotel.hotel_code)}</b> · ${hotel.chain_hotel_count} otel. OHIP tanımı Enterprise ekranında.` : `Tek otel · HotelId: <b>${esc(hotel.hotel_code)}</b>. OHIP tanımı aşağıda.`}</span>
  </div>
  ${isChain ? "" : `<details class="ohip-inline" ${ohipMissingH.length ? "open" : ""}>
    <summary><b>OHIP Tanımları</b> ${ohipMissingH.length ? `<span class="badge pending">Eksik</span>` : `<span class="badge done">Tanımlı</span>`} <span class="muted">· EnterpriseId ${esc(ohipCfg.enterprise_id || "—")} · ${ohipCfg.env === "partner" ? "Partner" : ohipCfg.env === "customer" ? "Customer" : "ortam seçilmedi"}</span></summary>
    ${ohipForm({ csrf, chainId: hotel.chain_id, ohip: ohipCfg, ohipHasSecret: !!ohipCfg.client_secret, ohipMissing: ohipMissingH, defaultScope, backHotel: hotel.id, testHotel: hotel.hotel_code || "" })}
  </details>`}` : `
  <p class="muted">Bu otel bir Enterprise'a bağlı değil. OHIP tanımları Enterprise'da tutulur; Enterprise'ı seçip OPERA HotelId'yi girin.</p>
  ${chains.length ? `<form method="post" action="/admin/hotels/${hotel.id}/chain" class="row">
    ${csrfField(csrf)}
    <div class="field"><label for="chain_id">Enterprise</label><select id="chain_id" name="chain_id">${chains.map(c => `<option value="${c.id}">${esc(c.name || "Tanımsız #" + c.id)}</option>`).join("")}</select></div>
    <div class="field" style="max-width: 200px"><label for="hotel_code">HotelId</label><input type="text" id="hotel_code" name="hotel_code" required></div>
    <button type="submit" style="align-self: end">Enterprise'a bağla</button>
  </form>` : `<p class="muted">Önce <a href="/admin#ekle">Otel ekle</a> ekranından bir Enterprise tanımlayın.</p>`}`}
  <div class="set-row">
    <span class="set-label">İki adımlı doğrulama</span>
    <form method="post" action="/admin/hotels/${hotel.id}/two-factor" class="inline" data-confirm="${esc(hotel.name)} için iki adımlı doğrulama ${hotel.two_factor ? "kapatılsın" : "açılsın"} mı?">
      ${csrfField(csrf)}<input type="hidden" name="enabled" value="${hotel.two_factor ? "0" : "1"}">
      <button type="submit" class="toggle ${hotel.two_factor ? "on" : ""}" title="${hotel.two_factor ? "Kapatmak için basın" : "Açmak için basın"}" ${!hotel.two_factor && !smtpOk ? `disabled title="${ha ? "E-posta ayarları yapılmamış; Protel destek ekibiyle görüşün" : "Önce Ayarlar'da e-posta ayarlarını girin"}"` : ""}>${hotel.two_factor ? "AÇIK" : "KAPALI"}</button></form>
    <span class="muted set-help">Kapalıyken herkes yalnız parolayla girer. Açıkken paroladan sonra kullanıcının yöntemine göre e-posta kodu ya da Google Authenticator kodu istenir.</span>
  </div>
  <div class="set-row">
    <span class="set-label">KBS bildirimi</span>
    ${ha ? `<span class="badge ${hotel.kbs_enabled ? "done" : ""}">${hotel.kbs_enabled ? "AÇIK" : "KAPALI"}</span>` : `<form method="post" action="/admin/hotels/${hotel.id}/kbs" class="inline" data-confirm="${hotel.kbs_enabled ? `${esc(hotel.name)} için KBS bildirimini kapatmak istediğinizden emin misiniz? Hiçbir bilgi silinmez; KBS sekmesi gizlenir ve açık KBS bağlantısı kapanır. Yeniden açıldığında kaldığı yerden devam eder.` : `${esc(hotel.name)} için KBS bildirimi açılsın mı?`}">
      ${csrfField(csrf)}<input type="hidden" name="kbs_enabled" value="${hotel.kbs_enabled ? "0" : "1"}">
      <button type="submit" class="toggle ${hotel.kbs_enabled ? "on" : ""}" title="${hotel.kbs_enabled ? "Kapatmak için basın" : "Açmak için basın"}">${hotel.kbs_enabled ? "AÇIK" : "KAPALI"}</button></form>`}
    <span class="muted set-help">${ha ? "Yalnız Protel yöneticisi açar / kapatır. " : ""}Açıkken uygulamada KBS sekmesi görünür. Kapatınca bilgiler silinmez, yalnız gizlenir.</span>
  </div>
  ${hotel.kbs_enabled ? `<div class="set-row">
    <span class="set-label">KBS tipi</span>
    <span class="set-inline">${[["polis", "Polis (Emniyet)"], ["jandarma", "Jandarma (API)"]].filter(([k]) => !ha || (hotel.kbs_type === "jandarma" ? "jandarma" : "polis") === k).map(([k, l]) => (hotel.kbs_type === "jandarma" ? "jandarma" : "polis") === k
      ? `<button type="button" class="toggle on" disabled title="Seçili KBS tipi">${l} · AKTİF</button>`
      : `<form method="post" action="/admin/hotels/${hotel.id}/kbs-type" class="inline" data-confirm="KBS tipi ${l} olarak değiştirilsin mi? Bu otelin tüm kullanıcıları için geçerli olur. Kayıtlı Polis KBS bilgileri silinmez; Polis'e dönünce yeniden kullanılır.">${csrfField(csrf)}<input type="hidden" name="kbs_type" value="${k}"><button type="submit" class="toggle" title="${l} olarak değiştirmek için basın">${l} · PASİF</button></form>`).join("")}</span>
    <span class="muted set-help">Yalnız Protel yöneticisi değiştirir; kullanıcılar yalnız seçili tipin ekranını görür.</span>
  </div>
  <div class="set-row">
    <span class="set-label">KBS bağlantısı</span>
    ${ha ? `<span class="badge ${hotel.kbs_stopped ? "pending" : "done"}">${hotel.kbs_stopped ? "DURDURULDU" : "ÇALIŞIYOR"}</span>` : `<form method="post" action="/admin/hotels/${hotel.id}/kbs-stop" class="inline" data-confirm="${hotel.kbs_stopped ? `${esc(hotel.name)} için KBS bağlantısı yeniden başlatılsın mı? Kullanıcılar KBS'ye yeniden bağlanabilir / liste okunur / gönderim yapılır.` : `${esc(hotel.name)} için KBS bağlantısı DURDURULSUN mu? Açık KBS oturumu kapanır; bağlanma, liste okuma, gönderim ve otomatik yeniden bağlanma durur. Kullanıcılar yeniden başlatamaz, yalnız Protel yöneticisi başlatır.`}">
      ${csrfField(csrf)}<input type="hidden" name="stopped" value="${hotel.kbs_stopped ? "0" : "1"}">
      <button type="submit" class="toggle ${hotel.kbs_stopped ? "" : "on"}" title="${hotel.kbs_stopped ? "Yeniden başlatmak için basın" : "Durdurmak için basın"}">${hotel.kbs_stopped ? "DURDURULDU" : "ÇALIŞIYOR"}</button></form>`}
    <span class="muted set-help">Yalnız Protel yöneticisi. Durdurulunca bu otel için KBS'ye (Polis ya da Jandarma) hiçbir istek gitmez; bilgiler silinmez. Eski program hâlâ KBS'yi kullanırken SnapPass'ın araya girmemesi için kullanılır.</span>
  </div>
  <div class="set-row">
    <span class="set-label">KBS otomatik gönderim</span>
    <form method="post" action="/admin/hotels/${hotel.id}/kbs-auto" class="inline" data-confirm="${hotel.kbs_auto ? `${esc(hotel.name)} için KBS otomatik gönderim kapatılsın mı? Bildirimler yeniden elle gönderilir.` : `${esc(hotel.name)} için KBS otomatik gönderim AÇILSIN mı? KBS Gönderim ekranı açıkken bilgisi tam misafirlerin giriş / çıkış / oda değişimi bildirimi kendiliğinden KBS'ye gönderilir. Canlı yasal bildirimdir; bilgilerin doğruluğunu önce elle gönderimle denediğinizden emin olun.`}">
      ${csrfField(csrf)}<input type="hidden" name="kbs_auto" value="${hotel.kbs_auto ? "0" : "1"}">
      <button type="submit" class="toggle ${hotel.kbs_auto ? "on" : ""}" title="${hotel.kbs_auto ? "Kapatmak için basın" : "Açmak için basın"}">${hotel.kbs_auto ? "AÇIK" : "KAPALI"}</button></form>
    <span class="muted set-help">Varsayılan kapalı. Açıkken KBS Gönderim ekranı açık olan kullanıcının ekranında, bilgisi tam misafirler kendiliğinden gönderilir (en çok 10 kayıt/tur, hata olursa durur). Ekran kapalıyken gönderim yapılmaz.</span>
  </div>` : ""}
</div>${ha ? `</div>${haExtras(ha, hotel)}` : ""}`;
}

// Otel yöneticisi: yalnız kendi otelinin OHIP sayacı, uyarıları ve değişiklik kaydı
function haExtras(ha, hotel) {
  const fmt = (n) => Number(n || 0).toLocaleString("tr-TR");
  const trDay = (v) => v ? v.slice(8, 10) + "." + v.slice(5, 7) + "." + v.slice(0, 4) : "";
  const U = ha.usage, LR = ha.logRange, base = "/admin/hotels/" + hotel.id;
  const KIND = { "profil-okuma": "Profil okuma", "profil-arama": "Profil arama", "profil-yazma": "Profil yazma", "rezervasyon-okuma": "Rezervasyon okuma", "rezervasyon-yazma": "Rezervasyon yazma" };
  const oneMonth = U.from.slice(0, 7) === U.to.slice(0, 7);
  const quota = U.env === "partner" && oneMonth ? `${fmt(U.total)} / ${fmt(30000)} <span class="muted">(%${Math.round((U.total / 30000) * 100)})</span>` : U.env === "customer" ? `${fmt(U.total)} <span class="muted">bedelsiz</span>` : fmt(U.total);
  const days = Object.entries(U.days).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const kinds = Object.entries(U.kinds).sort((a, b) => b[1] - a[1]);
  return `
<div data-panel="ohip" hidden>
<div class="card">
  <h2>OHIP Çağrı Sayacı <span class="muted">· ${esc(trDay(U.from))} – ${esc(trDay(U.to))}</span></h2>
  <form method="get" action="${base}#ohip" class="range-bar">
    <div class="range-box">
      <label class="range-field"><span>Başlangıç</span><input type="date" name="from" value="${esc(U.from)}" max="${esc(U.todayDay)}" required></label>
      <span class="range-sep">→</span>
      <label class="range-field"><span>Bitiş</span><input type="date" name="to" value="${esc(U.to)}" max="${esc(U.todayDay)}" required></label>
      <button type="submit" class="range-go">Göster</button>
    </div>
    <div class="range-chips">
      <a class="chip${U.from === U.monthStart && U.to === U.todayDay ? " on" : ""}" href="${base}?from=${esc(U.monthStart)}&amp;to=${esc(U.todayDay)}#ohip">Bu ay</a>
      <a class="chip${U.from === U.prevStart && U.to === U.prevEnd ? " on" : ""}" href="${base}?from=${esc(U.prevStart)}&amp;to=${esc(U.prevEnd)}#ohip">Geçen ay</a>
    </div>
  </form>
  <p><b>Bugün:</b> ${fmt(U.today)} · <b>Seçili aralık:</b> ${quota}</p>
  ${kinds.length ? `<div class="usage-kinds">${kinds.map(([k, n]) => `<span class="chip">${esc(KIND[k] || k)}: <b>${fmt(n)}</b></span>`).join("")}</div>` : '<p class="muted">Bu aralıkta çağrı kaydı yok.</p>'}
  ${days.length ? `<div class="table-wrap"><table class="usage-days"><thead><tr><th>Gün</th>${Object.keys(KIND).map(k => `<th class="num">${KIND[k]}</th>`).join("")}<th class="num">Toplam</th></tr></thead><tbody>${days.map(([d, m]) => `<tr><td>${esc(trDay(d))}</td>${Object.keys(KIND).map(k => `<td class="num">${m[k] ? fmt(m[k]) : "·"}</td>`).join("")}<td class="num"><b>${fmt(Object.values(m).reduce((a, b) => a + b, 0))}</b></td></tr>`).join("")}</tbody></table></div>` : ""}
  <p class="muted">Yalnız bu otelin OPERA (OHIP) çağrıları sayılır; kişi verisi tutulmaz.</p>
</div>
</div>

<div data-panel="uyarilar" hidden>
<div class="card">
  <h2>OHIP / KBS Uyarıları</h2>
  ${ha.alertRows.length ? `<div class="table-wrap"><table><thead><tr><th>Durum</th><th>Kaynak</th><th>Mesaj</th><th>Tekrar</th><th>Son</th></tr></thead><tbody>
  ${ha.alertRows.map(a => `<tr><td><span class="badge ${a.resolved_at ? "done" : "pending"}">${a.resolved_at ? "Çözüldü" : "Aktif"}</span></td><td>${esc(String(a.source).toUpperCase())}</td><td>${esc(a.message)}</td><td>${a.n}</td><td>${esc(new Date(a.last_at).toLocaleString("tr-TR"))}</td></tr>`).join("")}
  </tbody></table></div>` : '<p class="muted">Kayıtlı uyarı yok.</p>'}
</div>
</div>

<div data-panel="log" hidden>
<div class="card">
  <h2>Değişiklikler <span class="muted">· ${esc(trDay(LR.from))} – ${esc(trDay(LR.to))}</span></h2>
  <form method="get" action="${base}#log" class="range-bar">
    <div class="range-box">
      <label class="range-field"><span>Başlangıç</span><input type="date" name="lfrom" value="${esc(LR.from)}" max="${esc(LR.today)}" required></label>
      <span class="range-sep">→</span>
      <label class="range-field"><span>Bitiş</span><input type="date" name="lto" value="${esc(LR.to)}" max="${esc(LR.today)}" required></label>
      <button type="submit" class="range-go">Göster</button>
    </div>
  </form>
  ${ha.log.length ? `<div class="table-wrap"><table>
    <thead><tr><th>Zaman</th><th>Kişi</th><th>İşlem</th><th>Açıklama</th></tr></thead>
    <tbody>${ha.log.map(a => `<tr><td style="white-space: nowrap">${esc(new Date(a.at).toLocaleString("tr-TR"))}</td><td>${esc(a.username || "—")}</td><td>${esc(a.action)}</td><td class="muted">${esc(a.detail)}</td></tr>`).join("")}</tbody>
  </table></div>` : '<p class="muted">Bu aralıkta kayıt yok.</p>'}
  <p class="muted">Bu otelin kullanıcı işlemleri ve yönetim değişiklikleri.</p>
</div>
</div>
<script>
(function () {
  var names = ['otel', 'ohip', 'uyarilar', 'log'], tabs = document.querySelectorAll('.admin-tab'), panels = document.querySelectorAll('[data-panel]');
  function show(n) {
    tabs.forEach(function (t) { t.classList.toggle('on', t.dataset.tab === n); });
    panels.forEach(function (p) { p.hidden = p.dataset.panel !== n; });
    if (location.hash !== '#' + n) history.replaceState(null, '', '#' + n);
  }
  tabs.forEach(function (t) { t.onclick = function () { show(t.dataset.tab); }; });
  var h = location.hash.slice(1);
  show(names.indexOf(h) >= 0 ? h : 'otel');
})();
</script>`;
}

// Otel yöneticisi: yönetim ekranına girmeden önce ikinci doğrulama (Authenticator kuruluysa kod, değilse e-posta kodu)
function haVerifyPage({ csrf, method, email, minutes }) {
  return narrow(`
  <h1>Otel yönetimi doğrulaması</h1>
  <p class="muted">${method === "totp" ? `Authenticator uygulamasındaki <b>SnapPass</b> kodunu girin.` : `<b>${esc(email)}</b> adresine 6 haneli bir kod gönderildi. Kod ${minutes} dakika geçerlidir.`} Yönetim ekranı güvenlik için her oturumda ikinci doğrulama ister.</p>
  <form method="post" action="/otel/dogrula">
    ${csrfField(csrf)}
    <div class="field"><label for="code">Kod</label>
      <input type="text" id="code" name="code" inputmode="numeric" pattern="[0-9 ]{6,7}" maxlength="7" autocomplete="one-time-code" required autofocus
             style="font-size: 1.4em; letter-spacing: 6px; max-width: 200px"></div>
    <button type="submit">Doğrula</button>
  </form>
  ${method === "email" ? `<form method="post" action="/otel/tekrar" class="inline" style="margin-top: 12px">${csrfField(csrf)}<button class="link">Kod gelmedi, yeniden gönder</button></form>` : ""}
  <p class="muted"><a href="/">Kullanıcı Arayüzüne dön</a></p>`);
}

function inviteMail({ link, username, fullName, hotelName }) {
  const hello = fullName ? `Merhaba ${fullName},` : "Merhaba,";
  const text = `${hello}

${hotelName} için SnapPass belge tarama uygulamasına kullanıcı olarak eklendiniz.
Kullanıcı adınız: ${username}

Aşağıdaki bağlantıdan parolanızı belirleyip giriş yapabilirsiniz (7 gün geçerlidir):
${link}

PROTEL Bilgisayar A.Ş.`;
  const html = `<p>${esc(hello)}</p>
<p><b>${esc(hotelName)}</b> için SnapPass belge tarama uygulamasına kullanıcı olarak eklendiniz.<br>Kullanıcı adınız: <b>${esc(username)}</b></p>
<p><a href="${esc(link)}" style="display:inline-block;background:#1f5fbf;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Parolamı belirle ve giriş yap</a></p>
<p style="color:#646b78">Bağlantı 7 gün geçerlidir ve bir kez kullanılabilir.</p>
<p>PROTEL Bilgisayar A.Ş.</p>`;
  return { subject: "SnapPass – kullanıcı davetiyesi", text, html };
}

function resetMail({ link, username, fullName, minutes }) {
  const hello = fullName ? `Merhaba ${fullName},` : "Merhaba,";
  const text = `${hello}

SnapPass hesabınız (${username}) için parola sıfırlama istendi.
Aşağıdaki bağlantıdan yeni parolanızı belirleyebilirsiniz (${minutes} dakika geçerlidir, bir kez kullanılabilir):
${link}

Bu isteği siz yapmadıysanız bu e-postayı dikkate almayın; parolanız değişmez.

PROTEL Bilgisayar A.Ş.`;
  const html = `<p>${esc(hello)}</p>
<p>SnapPass hesabınız (<b>${esc(username)}</b>) için parola sıfırlama istendi.</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#1f5fbf;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Yeni parolamı belirle</a></p>
<p style="color:#646b78">Bağlantı ${minutes} dakika geçerlidir ve bir kez kullanılabilir. Bu isteği siz yapmadıysanız bu e-postayı dikkate almayın; parolanız değişmez.</p>
<p>PROTEL Bilgisayar A.Ş.</p>`;
  return { subject: "SnapPass – parola sıfırlama", text, html };
}

module.exports = { esc, layout, loginPage, pinPage, totpPage, invitePage, forgotPage, resetPage, passwordPage, adminPage, chainPage, ohipWizardPage, hotelPage, haVerifyPage, inviteMail, resetMail };
