# SnapPass — OPERA Cloud Proxy

Belge (MRZ) tarama uygulaması ve OPERA Cloud (OHIP) proxy sunucusu. Kullanıcılar, oteller ve OHIP
tanımları sunucuda (PostgreSQL) tutulur; giriş ve yönetim akışları TGA Veri Bildirim ile aynıdır.

## Kurulum ve Çalıştırma

### 1. Gereksinimler
- Node.js 18+ (önerilen 24) → https://nodejs.org
- PostgreSQL: `snappass` veritabanı ve `snappass_app` rolü

```sql
CREATE ROLE snappass_app LOGIN;
CREATE DATABASE snappass OWNER snappass_app ENCODING 'UTF8';
```
Tablolar sunucu ilk açıldığında otomatik oluşturulur.

### 2. Kurulum
```bash
cd snappass-proxy
npm install
```

### 3. Ortam değişkenleri
| Değişken | Açıklama |
|---|---|
| `SNAPPASS_DATABASE_URL` | Varsayılan `postgresql://snappass_app@127.0.0.1:5432/snappass` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Protel yönetici girişi (Google). `SNAPPASS_GOOGLE_*` verilirse onlar kullanılır |
| `SNAPPASS_GOOGLE_REDIRECT_URI` | Varsayılan `<adres>/auth/google/callback`; Google Console'da yetkili yönlendirme adresi olarak eklenmeli |
| `SSO_ALLOWED_DOMAINS` | Varsayılan `protel.com.tr` |
| `SNAPPASS_ADMIN_EMAIL` | Hiç yönetici yoksa ilk açılışta bu Google hesabı yönetici olarak eklenir |
| `SNAPPASS_APP_URL` | Davetiye bağlantılarındaki adres; varsayılan `https://snappass.protel.com.tr` (yönetim ekranında E-posta ayarlarından değiştirilir) |
| `SNAPPASS_HTTPS=1` | HTTPS arkasında çalışırken güvenli çerez |
| `SNAPPASS_2FA_OFF=1` | Acil durumda iki adımlı doğrulamayı kapatır |
| `SNAPPASS_MRZ_DEBUG=1` | Tarama hata ayıklama kayıtlarını (`temp/`: kimlik karesi, MRZ satırları) açar. Varsayılan kapalı; canlıda açmayın |
| `SNAPPASS_DATA_DIR` | Varsayılan `data/`; `secret.key` burada (yedekleyin — şifreli OHIP/SMTP bilgileri bununla açılır) |

### 4. Çalıştır
```bash
node server.js
```
ya da `start-snappass.bat`.

### 5. Tarayıcıda aç
- `http://localhost:3000/login` — otel kullanıcıları (kullanıcı adı + parola, açıksa e-posta kodu)
- Aynı sayfadaki **Protel yönetici girişi** — Google hesabıyla `/admin`

---

## Dil (Türkçe / English)

- Uygulamada ve giriş sayfalarında **TR | EN** düğmesi vardır; seçim çerezde (`sp_lang`) tutulur, tarama uygulaması ve sunucu sayfaları aynı çerezi kullanır.
- **Varsayılan dil:** kullanıcı kendi dilini seçmediyse kurulumdaki dil kullanılır — Protel yönetim ekranı → *Kurulum* → *Varsayılan dil*
  (`default_lang` ayarı). Türkçede İngilizce terim kullanılmaz (Gelenler, Konaklayanlar, Canlı oturum…).
- **Metinler:** kodda Türkçe kaynak metin olarak yazılır: `t("Belge Tara")`. İngilizce karşılıkları `public/i18n.js` sözlüğündedir;
  sözlükte olmayan metin Türkçe görünür. Sunucu sayfaları ve e-postalar için ek sözlük `lib/i18n-server.js` içindedir.
  Yeni bir metin eklerken sözlüğe İngilizce karşılığını da ekleyin. Protel yönetim ekranları yalnız Türkçedir.

## Tarama uygulamasını derleme

`public/app.bundle.js`, `public/app.jsx` dosyasından üretilir (elle düzenlenmez):

```bash
npm install          # ilk kez (esbuild geliştirme bağımlılığı)
npm run build:client
```

`app.jsx`'te değişiklik yaptıktan sonra bu komutu çalıştırın; sunucuyu yeniden başlatmak gerekmez, sayfayı yenilemek yeterlidir.

## Akışlar

- **Protel yöneticisi:** Google (@protel.com.tr) ile girer, ardından Authenticator (Google/Microsoft Authenticator,
  TOTP) kodunu girer. İlk girişte QR okutularak kurulur; anahtar şifreli saklanır, 5 hatalı kodda 15 dk kilit.
  Telefonu değişen yöneticinin Authenticator'ı başka bir yönetici tarafından sıfırlanır. Zincirler, oteller, kullanıcılar, SMTP,
  iki adımlı doğrulama ve uygulama adresini yönetir. "Bu otel için taramayı aç" ile o otelde tarama yapabilir.
- **Zincir ve OHIP:** OHIP tanımı (HostName, AppKey, EnterpriseId, CLIENT_ID, CLIENT_SECRET, Scope) zincir için
  ortaktır ve şifreli saklanır. Kaydedince token alınır, zincir adı/kodu OPERA'dan (`/ent/config/v1/chain`) gelir.
- **Otel:** zincire bağlıdır, yalnız HotelId taşır. HotelId elle girilerek ya da "OPERA'daki otelleri listele"
  (`/ent/config/v1/hotels`) ile seçilerek eklenir; adı `/ent/config/v1/hotels/{hotelId}` ile OPERA'dan alınır.
- **Davetiye:** otel kullanıcısı e-postayla davet edilir, parolasını kendisi belirler (7 gün, tek kullanım).
  SMTP yoksa bağlantı bir kez ekranda gösterilir.
- **İki adımlı doğrulama:** açıkken parola girişinden sonra e-postaya 6 haneli kod gider (10 dk, 5 deneme);
  cihaz 15 gün hatırlanabilir.
- **MRZ okuma (karma):** kamera karesi ekrandaki kart çerçevesine göre kırpılır; en fazla 14 sn boyunca en keskin
  kare seçilip okunur (ham + yerel eşiklenmiş hali). Okuma sırası:
  1. **Yerel OCR aracı** (`ocr-agent.js`, resepsiyon terminalinde `http://127.0.0.1:5102`) — görüntü bilgisayardan çıkmaz.
     `start-ocr-agent.bat` ile başlatılır; `SNAPPASS_AGENT_ORIGINS` izinli sayfa adresleri (CORS + Chrome yerel ağ erişimi).
  2. **Bulut OCR** (`/api/mrz/scan`, proxy içinde) — telefon/tablet ya da aracı olmayan bilgisayarlar için.
  3. Tarayıcı içi okuma — yalnız ikisine de ulaşılamazsa.

  Motor (`lib/mrz-engine.js`): Tesseract 5 (tesseract.js) + `ocr-models/mrz.traineddata`, SnapPass.Service'in
  Tesseract ayarlarıyla aynı (LSTM, MRZ karakter listesi, PSM 6, tüm görüntü + alt %40). İşçi havuzu
  `SNAPPASS_OCR_WORKERS` (varsayılan çekirdek - 1). Kayıtlı 20 gerçek karede SnapPass.Service ile birebir aynı sonuç.
  Eski SnapPass.Service motoru `SNAPPASS_OCR_BACKEND=snappass` ile hâlâ seçilebilir (`data/ocr-jwt.key`,
  `data/ocr-cert.*`, SnapPass veritabanında `ocr-proxy` kullanıcısı gerekir).
- **Yinelenen profil kontrolü:** yeni profil (beraberindeki) oluşturmadan önce aynı kimlik no ya da aynı ad+soyad
  (+doğum tarihi uyuşuyorsa) ile kayıtlı profil var mı OPERA'da aranır (`POST /api/profile-duplicates`; getProfiles
  `identificationNo`, `profileName`+`givenName`, ayrıca `email`/`phone` desteklenir). Varsa "Bu profili kullan / Yine de
  yeni oluştur / Vazgeç" sorulur. Mevcut profilde kimlik no değişirse başka profilde aynı numara var mı denetlenir.
- **Tarama uygulaması:** `/api/me` ile oturum ve otel bilgisini, `/api/opera/token` ile OHIP token'ını
  sunucudan alır; gizli bilgiler tarayıcıya gelmez. Tüm `/api/*` uçları oturum ister.

```
Tarayıcı  →  localhost:3000/api/opera/token  →  Oracle OPERA Cloud (client_credentials)
          →  localhost:3000/api/search       →  Oracle OPERA Cloud
```

---

## Dosya Yapısı
```
snappass-proxy/
├── server.js          ← Proxy sunucu (OPERA API uçları)
├── lib/
│   ├── web.js         ← Giriş, davetiye, 2FA, yönetim ekranları, /api/me, /api/opera/token
│   ├── views.js       ← Sunucu sayfaları (TGA görünümü)
│   ├── db.js          ← PostgreSQL şeması
│   ├── security.js    ← Şifreleme, parola özeti, oturum çerezi
│   ├── google.js      ← Google OpenID Connect (PKCE)
│   ├── mailer.js      ← SMTP
│   └── ohip.js        ← OHIP token
├── public/
│   ├── index.html, app.jsx, app.bundle.js  ← Tarama uygulaması
│   └── admin/         ← Yönetim ekranı stili ve logo
└── data/secret.key    ← İlk açılışta üretilir
```
