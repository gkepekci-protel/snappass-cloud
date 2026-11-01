/* Yönetim (kurulum) tarafı duman testi: tüm sayfaları gezer, 200 ve hata izi arar. Yalnız GET; hiçbir şeyi değiştirmez.
   Kullanım: tarayıcıda yönetici olarak giriş yapın, çerezi (sp_sid=...) kopyalayın:
     SNAPPASS_COOKIE="<çerez>" node scripts/smoke-admin.js [http://localhost:3000] */
const base = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "");
const cookie = process.env.SNAPPASS_COOKIE || "";
if (!cookie) { console.error("SNAPPASS_COOKIE gerekli (yönetici oturum çerezi)."); process.exit(2); }
const get = async (p) => {
  const r = await fetch(base + p, { headers: { cookie }, redirect: "manual" });
  return { status: r.status, loc: r.headers.get("location"), text: await r.text() };
};
const BAD = /Internal Server Error|Cannot GET|TypeError|ReferenceError|undefined<|\[object Object\]|NaN/;
(async () => {
  let fails = 0;
  const check = async (p, label) => {
    const r = await get(p);
    const ok = r.status === 200 && !BAD.test(r.text) && !/name="password"/.test(r.text);
    if (!ok) fails++;
    console.log((ok ? "OK   " : "HATA ") + String(r.status).padEnd(4) + p + (label ? "  (" + label + ")" : "") + (r.loc ? " → " + r.loc : "") + (BAD.test(r.text) ? "  [hata izi: " + (r.text.match(BAD) || [])[0] + "]" : ""));
    return r.text;
  };
  const home = await check("/admin", "ana sayfa");
  for (const p of ["/admin/kurulum-rehberi", "/admin/ohip-rehberi", "/admin/ohip-sihirbazi", "/yardim"]) await check(p);
  const hotels = [...new Set([...home.matchAll(/href="\/admin\/hotels\/(\d+)"/g)].map(m => m[1]))];
  const chains = [...new Set([...home.matchAll(/href="\/admin\/chains\/(\d+)"/g)].map(m => m[1]))];
  for (const id of chains) await check("/admin/chains/" + id, "Enterprise");
  for (const id of hotels) await check("/admin/hotels/" + id, "Otel");
  // JSON uçları (yönetici oturumunda)
  for (const p of ["/api/me", "/api/logs?limit=5"]) { const r = await get(p); const ok = r.status === 200 || r.status === 403 || r.status === 400; if (!ok) fails++; console.log((ok ? "OK   " : "HATA ") + r.status + " " + p); }
  console.log(`\n${hotels.length} otel, ${chains.length} Enterprise sayfası gezildi. ${fails ? fails + " sorun var." : "Sorun yok."}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(2); });
