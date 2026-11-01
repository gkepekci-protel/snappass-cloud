/* ─── E-posta (SMTP) ───────────────────────────────────────────────────────
   Ayarlar settings.smtp_enc içinde şifreli JSON:
   { host, port, security: starttls|ssl|none, username, password, sender, sender_name }
── */
const nodemailer = require("nodemailer");
const db = require("./db");
const { decryptJson } = require("./security");

async function smtpConfig() {
  return decryptJson(await db.getSetting("smtp_enc"), {});
}

const smtpReady = (cfg) => !!(cfg && cfg.host && cfg.sender);

async function sendMail({ to, subject, text, html }) {
  const cfg = await smtpConfig();
  if (!smtpReady(cfg)) throw new Error("E-posta (SMTP) ayarları girilmemiş");
  const security = cfg.security || "starttls";
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: Number(cfg.port) || (security === "ssl" ? 465 : 587),
    secure: security === "ssl",
    requireTLS: security === "starttls",
    ignoreTLS: security === "none",
    auth: cfg.username ? { user: cfg.username, pass: cfg.password || "" } : undefined,
    connectionTimeout: 30000,
  });
  await transport.sendMail({
    from: { name: cfg.sender_name || "SnapPass", address: cfg.sender },
    to, subject, text, html,
  });
}

module.exports = { smtpConfig, smtpReady, sendMail };
