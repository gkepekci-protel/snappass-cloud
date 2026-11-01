/* ─── Sunucu sayfaları ve e-postalar için çeviri (Türkçe → English) ─────────
   Görünümler Türkçe yazılır; İngilizce seçiliyse üretilen HTML'deki metin düğümleri ve placeholder/title nitelikleri
   sözlükle çevrilir (sözlükte olmayan metin Türkçe kalır). Paylaşılan metinler public/i18n.js'tedir.
   {ad} biçimli yer tutucular şablon olarak eşleşir: "Kod hatalı. Kalan deneme: {n}".
   Yalnız otel kullanıcısına dönük sayfalar (giriş, kod, davetiye, parola) çevrilir; Protel yönetim ekranları Türkçedir.
── */
const shared = require("../public/i18n");

const srv = {
  // sayfa iskeleti
  "Tarama": "Scan",
  "Parola": "Password",
  "Çıkış ({k})": "Log out ({k})",
  "© Bütün hakları saklıdır. PROTEL Bilgisayar A.Ş.": "© All rights reserved. PROTEL Bilgisayar A.Ş.",
  "Evet": "Yes",
  // giriş
  "Giriş": "Sign in",
  "Size gönderilen davetiyeyle belirlediğiniz kullanıcı adı ve parolayla girin.": "Sign in with the username and password you set through your invitation.",
  "Kullanıcı adı": "Username",
  "Parolamı unuttum": "Forgot my password",
  "Giriş yap": "Sign in",
  "Protel yöneticileri: {d} Google hesabıyla": "Protel administrators: with your {d} Google account",
  "Protel yönetici girişi": "Protel administrator sign-in",
  // e-posta kodu
  "Giriş kodu": "Sign-in code",
  "adresine 6 haneli bir kod gönderildi. Kod {n} dakika geçerlidir.": "— we sent a 6-digit code to this address. The code is valid for {n} minutes.",
  "Kod": "Code",
  "Bu cihazı {n} gün hatırla": "Remember this device for {n} days",
  "Bu tarayıcıda {n} gün kod sorulmaz. Ortak kullanılan bilgisayarlarda işaretlemeyin.": "The code will not be asked in this browser for {n} days. Do not tick this on shared computers.",
  "Doğrula": "Verify",
  "Kod gelmedi, yeniden gönder": "Did not get a code? Send again",
  "Girişe dön": "Back to sign-in",
  // Authenticator
  "Authenticator kurulumu": "Authenticator setup",
  "için yönetici girişinde ikinci adım olarak Authenticator kodu kullanılır.": "— an Authenticator code is used as the second step of administrator sign-in.",
  "Telefonunuza": "Install",
  "(ya da Microsoft Authenticator) yükleyin.": "(or Microsoft Authenticator) on your phone.",
  "Uygulamada": "In the app, tap",
  "QR kodu tara": "Scan QR code",
  "ile aşağıdaki kodu okutun.": "and scan the code below.",
  "Uygulamada görünen 6 haneli kodu girin.": "Enter the 6-digit code shown in the app.",
  "QR okutamıyorum": "I cannot scan the QR code",
  "Kurulum anahtarı gir": "Enter setup key",
  "seçin; hesap:": "and choose it; account:",
  ", anahtar (zamana dayalı):": ", key (time-based):",
  "Kurulumu tamamla": "Complete setup",
  "Doğrulama kodu": "Verification code",
  "· Authenticator uygulamasındaki": "· Enter the",
  "kodunu girin.": "code from your Authenticator app.",
  "Telefonunuz yanınızda değilse ya da değiştiyse başka bir Protel yöneticisinden Authenticator'ı sıfırlamasını isteyin.": "If you do not have your phone or you changed it, ask another Protel administrator to reset your Authenticator.",
  "Uygulamadaki 6 haneli kod": "6-digit code in the app",
  // davetiye
  "Bağlantı geçersiz": "Link is not valid",
  "Davetiye bağlantısının süresi dolmuş, daha önce kullanılmış ya da yeni bir davetiye gönderilmiş. Protel destek ekibinden yeni davetiye isteyin.": "The invitation link has expired, was already used, or a new invitation was sent. Ask the Protel support team for a new invitation.",
  "Giriş sayfası": "Sign-in page",
  "Parolanızı belirleyin": "Set your password",
  "Hoş geldiniz": "Welcome",
  "Kullanıcı adınız:": "Your username:",
  "Parolanızı belirleyin; ardından giriş yapılır ve SnapPass tarama ekranı açılır.": "Set your password; you will then be signed in and the SnapPass scanning screen will open.",
  "Parola (tekrar)": "Password (repeat)",
  "En az 8 karakter; harf ve rakam içermeli, kullanıcı adınızı içermemeli.": "At least 8 characters; it must contain letters and digits and must not contain your username.",
  "Parolamı belirle ve giriş yap": "Set my password and sign in",
  // parolamı unuttum / sıfırlama
  "Parola sıfırlama şu an kullanılamıyor. Protel destek ekibinden yeni davetiye isteyin.": "Password reset is currently unavailable. Ask the Protel support team for a new invitation.",
  "Kullanıcı adınızı ya da e-posta adresinizi yazın. Hesabınıza kayıtlı e-posta adresine yeni parola belirleme bağlantısı gönderilir.": "Enter your username or email address. A link to set a new password will be sent to the email address registered on your account.",
  "Kullanıcı adı ya da e-posta": "Username or email",
  "Bağlantı gönder": "Send link",
  "Parola sıfırlama bağlantısının süresi dolmuş, daha önce kullanılmış ya da yeni bir bağlantı istenmiş.": "The password reset link has expired, was already used, or a new link was requested.",
  "Yeni bağlantı iste": "Request a new link",
  "Yeni parola": "New password",
  ". Yeni parolanızı belirleyin; ardından giriş yapılır.": ". Set your new password; you will then be signed in.",
  "Yeni parola (tekrar)": "New password (repeat)",
  "Parolamı kaydet ve giriş yap": "Save my password and sign in",
  // parola değiştir
  "Parola değiştir": "Change password",
  "Devam etmeden önce yeni bir parola belirleyin.": "Set a new password before continuing.",
  "Mevcut parola": "Current password",
  // bildirimler
  "Kullanıcı adı veya parola hatalı.": "Incorrect username or password.",
  "Çok fazla hatalı deneme. {n} dakika sonra tekrar deneyin.": "Too many failed attempts. Try again in {n} minutes.",
  "Çok fazla hatalı deneme. Hesap {n} dakika kilitlendi.": "Too many failed attempts. The account is locked for {n} minutes.",
  "Hesabınız ya da oteliniz pasif. Protel destek ekibiyle görüşün.": "Your account or hotel is inactive. Contact the Protel support team.",
  "İki adımlı doğrulama için hesabınızda e-posta adresi yok. Protel destek ekibiyle görüşün.": "There is no email address on your account for two-step verification. Contact the Protel support team.",
  "Kodun süresi doldu ya da deneme hakkı bitti. Yeniden giriş yapın.": "The code has expired or you have run out of attempts. Sign in again.",
  "Kod hatalı. Kalan deneme: {n}": "Incorrect code. Attempts left: {n}",
  "Yeni kod için bir dakika bekleyin.": "Wait a minute for a new code.",
  "Yeni kod gönderildi.": "A new code has been sent.",
  "Google girişi yapılandırılmamış (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).": "Google sign-in is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
  "Google girişi iptal edildi ({e}).": "Google sign-in was cancelled ({e}).",
  "Google girişinin süresi doldu, tekrar deneyin.": "Google sign-in expired, try again.",
  "{e} bir Protel hesabı değil.": "{e} is not a Protel account.",
  "{e} SnapPass yöneticisi olarak tanımlı değil.": "{e} is not set up as a SnapPass administrator.",
  "Google girişi başarısız: {e}": "Google sign-in failed: {e}",
  "Doğrulama süresi doldu, yeniden giriş yapın.": "Verification expired, sign in again.",
  "Çok fazla hatalı kod. {n} dakika sonra tekrar deneyin.": "Too many incorrect codes. Try again in {n} minutes.",
  "Çok fazla hatalı kod. Hesap {n} dakika kilitlendi.": "Too many incorrect codes. The account is locked for {n} minutes.",
  "Kod hatalı. Telefonunuzun saatinin doğru olduğundan emin olun. Kalan deneme: {n}": "Incorrect code. Make sure your phone's clock is correct. Attempts left: {n}",
  "Authenticator kuruldu. Sonraki girişlerde uygulamadaki kod sorulacak.": "Authenticator is set up. The code from the app will be asked at your next sign-ins.",
  "Parolalar aynı değil.": "The passwords do not match.",
  "Parola en az 8 karakter olmalı.": "The password must be at least 8 characters.",
  "Parola harf ve rakam içermeli.": "The password must contain letters and digits.",
  "Parola kullanıcı adını içermemeli.": "The password must not contain your username.",
  "Parolanız belirlendi.": "Your password has been set.",
  "Bu bilgiyle kayıtlı bir hesap varsa, parola sıfırlama bağlantısı hesabın e-posta adresine gönderildi. Bağlantı 60 dakika geçerlidir.": "If an account is registered with this information, a password reset link has been sent to the account's email address. The link is valid for 60 minutes.",
  "Yeni parolanız kaydedildi.": "Your new password has been saved.",
  "Mevcut parola hatalı.": "The current password is incorrect.",
  "Parolanız değiştirildi.": "Your password has been changed.",
  // e-postalar
  "SnapPass giriş kodu: {code}": "SnapPass sign-in code: {code}",
  "SnapPass giriş kodunuz: {code}": "Your SnapPass sign-in code: {code}",
  "SnapPass giriş kodunuz:": "Your SnapPass sign-in code:",
  "Kod {n} dakika geçerlidir. Bu girişi siz yapmadıysanız parolanızı değiştirin.": "The code is valid for {n} minutes. If this was not you, change your password.",
  "SnapPass – kullanıcı davetiyesi": "SnapPass – user invitation",
  "Merhaba {ad},": "Hello {ad},",
  "Merhaba,": "Hello,",
  "{otel} için SnapPass belge tarama uygulamasına kullanıcı olarak eklendiniz.": "You have been added as a user of the SnapPass document scanning app for {otel}.",
  "için SnapPass belge tarama uygulamasına kullanıcı olarak eklendiniz.": "— you have been added as a user of the SnapPass document scanning app.",
  "Kullanıcı adınız: {u}": "Your username: {u}",
  "Aşağıdaki bağlantıdan parolanızı belirleyip giriş yapabilirsiniz (7 gün geçerlidir):": "You can set your password and sign in with the link below (valid for 7 days):",
  "Bağlantı 7 gün geçerlidir ve bir kez kullanılabilir.": "The link is valid for 7 days and can be used once.",
  "SnapPass – parola sıfırlama": "SnapPass – password reset",
  "SnapPass hesabınız ({u}) için parola sıfırlama istendi.": "A password reset was requested for your SnapPass account ({u}).",
  "SnapPass hesabınız (": "A password reset was requested for your SnapPass account (",
  ") için parola sıfırlama istendi.": ").",
  "Aşağıdaki bağlantıdan yeni parolanızı belirleyebilirsiniz ({n} dakika geçerlidir, bir kez kullanılabilir):": "You can set your new password with the link below (valid for {n} minutes, single use):",
  "Yeni parolamı belirle": "Set my new password",
  "Bağlantı {n} dakika geçerlidir ve bir kez kullanılabilir. Bu isteği siz yapmadıysanız bu e-postayı dikkate almayın; parolanız değişmez.": "The link is valid for {n} minutes and can be used once. If you did not make this request, ignore this email; your password will not change.",
  "Bu isteği siz yapmadıysanız bu e-postayı dikkate almayın; parolanız değişmez.": "If you did not make this request, ignore this email; your password will not change.",
};

const DICT = { ...shared.en, ...srv };

// --- eşleştirme ---
const unesc = (s) => String(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const squash = (s) => String(s).replace(/\s+/g, " ").trim();
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const exact = new Map();
const templates = [];
for (const [key, value] of Object.entries(DICT)) {
  if (!/\{\w+\}/.test(key)) { exact.set(squash(key), value); continue; }
  const names = [];
  const pattern = squash(key).split(/(\{\w+\})/).map((part) => {
    const m = /^\{(\w+)\}$/.exec(part);
    if (m) { names.push(m[1]); return "(.+?)"; }
    return reEscape(part);
  }).join("");
  templates.push({ re: new RegExp(`^${pattern}$`, "s"), names, value });
}

// Tek bir metni çevirir; sözlükte yoksa null
function lookup(text) {
  const core = squash(text);
  if (!core) return null;
  if (exact.has(core)) return exact.get(core);
  for (const t of templates) {
    const m = t.re.exec(core);
    if (!m) continue;
    return t.value.replace(/\{(\w+)\}/g, (all, name) => { const i = t.names.indexOf(name); return i >= 0 ? m[i + 1] : all; });
  }
  return null;
}

// HTML: metin düğümleri ve placeholder/title/aria-label/alt nitelikleri
function translateHtml(html) {
  let out = html.replace(/>([^<>]+)</g, (m, text) => {
    const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0];
    const tr = lookup(unesc(text));
    return tr == null ? m : `>${lead}${esc(tr)}${trail}<`;
  });
  out = out.replace(/\b(placeholder|title|aria-label|alt)="([^"]*)"/g, (m, attr, val) => {
    const tr = lookup(unesc(val));
    return tr == null ? m : `${attr}="${esc(tr)}"`;
  });
  return out;
}

// Düz metin (e-posta gövdesi/konusu): bütün olarak, olmazsa satır satır
function translateText(text) {
  // Çok satırlı gövdelerde şablonlar bütün metni yutmasın diye yalnız satır satır çevrilir
  return String(text).split("\n").map((line) => { const tr = lookup(line); return tr == null ? line : tr; }).join("\n");
}

// E-posta nesnesi { subject, text, html } → seçili dilde
function translateMail(mail, lang) {
  if (lang !== "en") return mail;
  return { ...mail, subject: translateText(mail.subject), text: translateText(mail.text), html: translateHtml(mail.html) };
}

module.exports = { lookup, translateHtml, translateText, translateMail };
