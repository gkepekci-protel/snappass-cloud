/* Yedek: veritabanı (pg_dump) + data/ klasörü (secret.key ve sertifikalar) → backups/<tarih-saat>/
   Kullanım: node scripts/backup.js [hedef-klasör]
   ÖNEMLİ: KBS/OHIP gizli bilgileri veritabanında data/secret.key ile şifreli saklanır. İkisini AYRI yerlerde saklayın
   (örn. anahtar parola yöneticisinde, dump başka diskte); secret.key kaybolursa kayıtlı OHIP/KBS bilgileri okunamaz. */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
const out = path.join(path.resolve(process.argv[2] || path.join(root, "backups")), stamp);
fs.mkdirSync(out, { recursive: true });

// data/ klasörü
const dataOut = path.join(out, "data");
fs.mkdirSync(dataOut, { recursive: true });
for (const f of fs.readdirSync(path.join(root, "data"))) fs.copyFileSync(path.join(root, "data", f), path.join(dataOut, f));

// veritabanı
const url = process.env.SNAPPASS_DATABASE_URL || "postgresql://snappass_app@127.0.0.1:5432/snappass";
const candidates = ["pg_dump", ...["18", "17", "16", "15", "14"].map(v => `C:\\Program Files\\PostgreSQL\\${v}\\bin\\pg_dump.exe`)];
let ok = false;
for (const bin of candidates) {
  if (bin.includes("\\") && !fs.existsSync(bin)) continue;
  const r = spawnSync(bin, ["--format=custom", "--no-owner", `--file=${path.join(out, "snappass.dump")}`, `--dbname=${url}`], { encoding: "utf8" });
  if (!r.error && r.status === 0) { ok = true; break; }
  if (!r.error) { console.error("pg_dump hatası:", (r.stderr || "").trim().slice(0, 300)); break; }
}
if (!ok) { console.error("Veritabanı yedeği alınamadı (pg_dump bulunamadı ya da hata verdi)."); process.exitCode = 1; }

const size = (p) => fs.existsSync(p) ? fs.statSync(p).size : 0;
console.log(`Yedek: ${out}`);
console.log(`  data/ dosyaları : ${fs.readdirSync(dataOut).length}`);
console.log(`  snappass.dump   : ${size(path.join(out, "snappass.dump"))} bayt`);
