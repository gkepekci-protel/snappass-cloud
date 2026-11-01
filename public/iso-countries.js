/* ─── ISO 3166-1 ülke listesi (Türkçe adlarla) ───────────────────────────
   Uyruk alanı bu listeden seçilir; OPERA'ya iki harfli (alpha-2) kod gider.
   MRZ'den gelen üç harfli (alpha-3) kodlar ve Almanya için "D" iki harfliye çevrilir.
   Tarayıcıda window.IsoCountries, Node'da require("./public/iso-countries") ile kullanılır.
─────────────────────────────────────────────────────────────────────────── */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IsoCountries = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // alpha-2 | alpha-3 | Türkçe ad
  const RAW = `
AF|AFG|Afganistan
AX|ALA|Åland Adaları
AL|ALB|Arnavutluk
DZ|DZA|Cezayir
AS|ASM|Amerikan Samoası
AD|AND|Andorra
AO|AGO|Angola
AI|AIA|Anguilla
AQ|ATA|Antarktika
AG|ATG|Antigua ve Barbuda
AR|ARG|Arjantin
AM|ARM|Ermenistan
AW|ABW|Aruba
AU|AUS|Avustralya
AT|AUT|Avusturya
AZ|AZE|Azerbaycan
BS|BHS|Bahamalar
BH|BHR|Bahreyn
BD|BGD|Bangladeş
BB|BRB|Barbados
BY|BLR|Belarus
BE|BEL|Belçika
BZ|BLZ|Belize
BJ|BEN|Benin
BM|BMU|Bermuda
BT|BTN|Butan
BO|BOL|Bolivya
BQ|BES|Karayip Hollandası
BA|BIH|Bosna-Hersek
BW|BWA|Botsvana
BV|BVT|Bouvet Adası
BR|BRA|Brezilya
IO|IOT|Britanya Hint Okyanusu Toprakları
BN|BRN|Brunei
BG|BGR|Bulgaristan
BF|BFA|Burkina Faso
BI|BDI|Burundi
CV|CPV|Yeşil Burun Adaları
KH|KHM|Kamboçya
CM|CMR|Kamerun
CA|CAN|Kanada
KY|CYM|Cayman Adaları
CF|CAF|Orta Afrika Cumhuriyeti
TD|TCD|Çad
CL|CHL|Şili
CN|CHN|Çin
CX|CXR|Christmas Adası
CC|CCK|Cocos (Keeling) Adaları
CO|COL|Kolombiya
KM|COM|Komorlar
CG|COG|Kongo
CD|COD|Kongo Demokratik Cumhuriyeti
CK|COK|Cook Adaları
CR|CRI|Kosta Rika
CI|CIV|Fildişi Sahili
HR|HRV|Hırvatistan
CU|CUB|Küba
CW|CUW|Curaçao
CY|CYP|Kıbrıs (Güney)
CZ|CZE|Çekya
DK|DNK|Danimarka
DJ|DJI|Cibuti
DM|DMA|Dominika
DO|DOM|Dominik Cumhuriyeti
EC|ECU|Ekvador
EG|EGY|Mısır
SV|SLV|El Salvador
GQ|GNQ|Ekvator Ginesi
ER|ERI|Eritre
EE|EST|Estonya
SZ|SWZ|Esvatini
ET|ETH|Etiyopya
FK|FLK|Falkland Adaları
FO|FRO|Faroe Adaları
FJ|FJI|Fiji
FI|FIN|Finlandiya
FR|FRA|Fransa
GF|GUF|Fransız Guyanası
PF|PYF|Fransız Polinezyası
TF|ATF|Fransız Güney Toprakları
GA|GAB|Gabon
GM|GMB|Gambiya
GE|GEO|Gürcistan
DE|DEU|Almanya
GH|GHA|Gana
GI|GIB|Cebelitarık
GR|GRC|Yunanistan
GL|GRL|Grönland
GD|GRD|Grenada
GP|GLP|Guadeloupe
GU|GUM|Guam
GT|GTM|Guatemala
GG|GGY|Guernsey
GN|GIN|Gine
GW|GNB|Gine-Bissau
GY|GUY|Guyana
HT|HTI|Haiti
HM|HMD|Heard Adası ve McDonald Adaları
VA|VAT|Vatikan
HN|HND|Honduras
HK|HKG|Hong Kong
HU|HUN|Macaristan
IS|ISL|İzlanda
IN|IND|Hindistan
ID|IDN|Endonezya
IR|IRN|İran
IQ|IRQ|Irak
IE|IRL|İrlanda
IM|IMN|Man Adası
IL|ISR|İsrail
IT|ITA|İtalya
JM|JAM|Jamaika
JP|JPN|Japonya
JE|JEY|Jersey
JO|JOR|Ürdün
KZ|KAZ|Kazakistan
KE|KEN|Kenya
KI|KIR|Kiribati
KP|PRK|Kuzey Kore
KR|KOR|Güney Kore
KW|KWT|Kuveyt
KG|KGZ|Kırgızistan
LA|LAO|Laos
LV|LVA|Letonya
LB|LBN|Lübnan
LS|LSO|Lesotho
LR|LBR|Liberya
LY|LBY|Libya
LI|LIE|Lihtenştayn
LT|LTU|Litvanya
LU|LUX|Lüksemburg
MO|MAC|Makao
MG|MDG|Madagaskar
MW|MWI|Malavi
MY|MYS|Malezya
MV|MDV|Maldivler
ML|MLI|Mali
MT|MLT|Malta
MH|MHL|Marshall Adaları
MQ|MTQ|Martinik
MR|MRT|Moritanya
MU|MUS|Mauritius
YT|MYT|Mayotte
MX|MEX|Meksika
FM|FSM|Mikronezya
MD|MDA|Moldova
MC|MCO|Monako
MN|MNG|Moğolistan
ME|MNE|Karadağ
MS|MSR|Montserrat
MA|MAR|Fas
MZ|MOZ|Mozambik
MM|MMR|Myanmar
NA|NAM|Namibya
NR|NRU|Nauru
NP|NPL|Nepal
NL|NLD|Hollanda
NC|NCL|Yeni Kaledonya
NZ|NZL|Yeni Zelanda
NI|NIC|Nikaragua
NE|NER|Nijer
NG|NGA|Nijerya
NU|NIU|Niue
NF|NFK|Norfolk Adası
MK|MKD|Kuzey Makedonya
MP|MNP|Kuzey Mariana Adaları
NO|NOR|Norveç
OM|OMN|Umman
PK|PAK|Pakistan
PW|PLW|Palau
PS|PSE|Filistin
PA|PAN|Panama
PG|PNG|Papua Yeni Gine
PY|PRY|Paraguay
PE|PER|Peru
PH|PHL|Filipinler
PN|PCN|Pitcairn Adaları
PL|POL|Polonya
PT|PRT|Portekiz
PR|PRI|Porto Riko
QA|QAT|Katar
RE|REU|Réunion
RO|ROU|Romanya
RU|RUS|Rusya
RW|RWA|Ruanda
BL|BLM|Saint Barthélemy
SH|SHN|Saint Helena
KN|KNA|Saint Kitts ve Nevis
LC|LCA|Saint Lucia
MF|MAF|Saint Martin
PM|SPM|Saint Pierre ve Miquelon
VC|VCT|Saint Vincent ve Grenadinler
WS|WSM|Samoa
SM|SMR|San Marino
ST|STP|São Tomé ve Príncipe
SA|SAU|Suudi Arabistan
SN|SEN|Senegal
RS|SRB|Sırbistan
SC|SYC|Seyşeller
SL|SLE|Sierra Leone
SG|SGP|Singapur
SX|SXM|Sint Maarten
SK|SVK|Slovakya
SI|SVN|Slovenya
SB|SLB|Solomon Adaları
SO|SOM|Somali
ZA|ZAF|Güney Afrika
GS|SGS|Güney Georgia ve Güney Sandwich Adaları
SS|SSD|Güney Sudan
ES|ESP|İspanya
LK|LKA|Sri Lanka
SD|SDN|Sudan
SR|SUR|Surinam
SJ|SJM|Svalbard ve Jan Mayen
SE|SWE|İsveç
CH|CHE|İsviçre
SY|SYR|Suriye
TW|TWN|Tayvan
TJ|TJK|Tacikistan
TZ|TZA|Tanzanya
TH|THA|Tayland
TL|TLS|Doğu Timor
TG|TGO|Togo
TK|TKL|Tokelau
TO|TON|Tonga
TT|TTO|Trinidad ve Tobago
TN|TUN|Tunus
TR|TUR|Türkiye
TM|TKM|Türkmenistan
TC|TCA|Turks ve Caicos Adaları
TV|TUV|Tuvalu
UG|UGA|Uganda
UA|UKR|Ukrayna
AE|ARE|Birleşik Arap Emirlikleri
GB|GBR|Birleşik Krallık
US|USA|Amerika Birleşik Devletleri
UM|UMI|ABD Küçük Dış Adaları
UY|URY|Uruguay
UZ|UZB|Özbekistan
VU|VUT|Vanuatu
VE|VEN|Venezuela
VN|VNM|Vietnam
VG|VGB|Britanya Virjin Adaları
VI|VIR|ABD Virjin Adaları
WF|WLF|Wallis ve Futuna
EH|ESH|Batı Sahra
YE|YEM|Yemen
ZM|ZMB|Zambiya
ZW|ZWE|Zimbabve
XK|RKS|Kosova
`;

  const ALL = RAW.trim().split("\n").map((line) => {
    const [a2, a3, name] = line.split("|");
    return { code: a2, alpha3: a3, name };
  });
  const byA2 = new Map(ALL.map((c) => [c.code, c]));
  const byA3 = new Map(ALL.map((c) => [c.alpha3, c.code]));
  // MRZ'de ICAO'ya özgü kodlar
  byA3.set("D", "DE");
  byA3.set("GBR", "GB");

  // Türkiye başta, diğerleri Türkçe sıralamayla
  const list = [byA2.get("TR")].concat(
    ALL.filter((c) => c.code !== "TR").sort((x, y) => x.name.localeCompare(y.name, "tr"))
  );

  // alpha-2, alpha-3 ("TUR", "FRA", "D") ya da boş değeri iki harfli koda çevirir; tanınmazsa büyük harfe çevrilmiş değeri döndürür
  function toIso2(value) {
    const v = String(value || "").replace(/</g, "").trim().toUpperCase();
    if (!v) return "";
    if (byA2.has(v)) return v;
    if (byA3.has(v)) return byA3.get(v);
    return v;
  }

  const isKnown = (value) => byA2.has(String(value || "").toUpperCase());

  // Ülke adı seçili dilde: İngilizce için tarayıcının Intl.DisplayNames bilgisi (yoksa Türkçe ad)
  const displayNames = {};
  function nameOf(c, lang) {
    if (lang === "en" && typeof Intl !== "undefined" && Intl.DisplayNames) {
      try {
        displayNames.en = displayNames.en || new Intl.DisplayNames(["en"], { type: "region" });
        const n = displayNames.en.of(c.code);
        if (n && n !== c.code) return n;
      } catch (_) { /* Türkçe adla devam */ }
    }
    return c.name;
  }

  // <select> seçenekleri (lang: "tr" | "en"); listede olmayan mevcut değer kaybolmasın diye başa eklenir
  function options(current, lang) {
    const en = lang === "en";
    const rest = list.slice(1).map((c) => ({ c, n: nameOf(c, lang) })).sort((a, b) => a.n.localeCompare(b.n, en ? "en" : "tr"));
    const head = { c: list[0], n: nameOf(list[0], lang) }; // Türkiye her zaman başta
    const opts = [{ v: "", l: en ? "Select…" : "Seçiniz…" }].concat([head].concat(rest).map(({ c, n }) => ({ v: c.code, l: `${c.code} — ${n}` })));
    const cur = String(current || "").toUpperCase();
    if (cur && !byA2.has(cur)) opts.splice(1, 0, { v: cur, l: `${cur} ${en ? "(not in list)" : "(listede yok)"}` });
    return opts;
  }

  return { list, toIso2, isKnown, options };
});
