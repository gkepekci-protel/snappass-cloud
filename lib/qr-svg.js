/* SVG biçimindeki QR kodunu çözer (KBS kayıt sayfası QR'ı SVG olarak verir).
   Küçük bir SVG çizici + jsQR: yalnız QR'larda görülen şekiller desteklenir (rect, path M/L/H/V/Z, polygon, g/transform, düz dolgu).
   Çözülemezse null döner; çağıran taraf kullanıcıya hata gösterir. */
const jsQR = require("jsqr");

const attr = (tag, name) => {
  const m = new RegExp("(?:^|[\\s\"'])" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i").exec(tag);
  return m ? (m[1] !== undefined ? m[1] : m[2]) : "";
};
const num = (s, d = 0) => { const v = parseFloat(s); return Number.isFinite(v) ? v : d; };

// 2B dönüşüm matrisi [a b c d e f]
const IDENT = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
function parseTransform(t) {
  let m = IDENT;
  for (const x of String(t || "").matchAll(/(translate|scale|matrix)\s*\(([^)]*)\)/gi)) {
    const a = x[2].split(/[\s,]+/).filter(Boolean).map(Number);
    const k = x[1].toLowerCase();
    if (k === "translate") m = mul(m, [1, 0, 0, 1, a[0] || 0, a[1] || 0]);
    else if (k === "scale") m = mul(m, [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0]);
    else if (a.length === 6) m = mul(m, a);
  }
  return m;
}
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// path "d" → alt yollar (nokta dizileri)
function pathPolys(d) {
  const toks = String(d || "").match(/[MmLlHhVvZzCcSsQqTtAa]|-?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/g) || [];
  const polys = []; let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = "", i = 0;
  const nextNum = () => Number(toks[i++]);
  const isCmd = (t) => /^[A-Za-z]$/.test(t);
  while (i < toks.length) {
    if (isCmd(toks[i])) cmd = toks[i++];
    switch (cmd) {
      case "M": case "m": {
        const nx = nextNum(), ny = nextNum();
        x = cmd === "m" ? x + nx : nx; y = cmd === "m" ? y + ny : ny; sx = x; sy = y;
        cur = [[x, y]]; polys.push(cur); cmd = cmd === "m" ? "l" : "L"; break; }
      case "L": case "l": { const nx = nextNum(), ny = nextNum(); x = cmd === "l" ? x + nx : nx; y = cmd === "l" ? y + ny : ny; if (cur) cur.push([x, y]); break; }
      case "H": case "h": { const nx = nextNum(); x = cmd === "h" ? x + nx : nx; if (cur) cur.push([x, y]); break; }
      case "V": case "v": { const ny = nextNum(); y = cmd === "v" ? y + ny : ny; if (cur) cur.push([x, y]); break; }
      case "Z": case "z": x = sx; y = sy; cur = null; break;
      default: return polys; // eğri vb.: desteklenmiyor, eldekiyle devam
    }
  }
  return polys;
}

const isWhite = (f) => /^(none|white|#f{3}|#f{6}|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))$/i.test(String(f || "").trim());

// SVG metnini gri-beyaz piksel dizisine çizer (siyah = QR modülü)
function rasterize(svg, widthPx = 360, margin = 32) {
  const root = /<svg\b[^>]*>/i.exec(svg);
  if (!root) return null;
  const vb = attr(root[0], "viewBox").split(/[\s,]+/).filter(Boolean).map(Number);
  let vx = 0, vy = 0, vw = num(attr(root[0], "width")), vh = num(attr(root[0], "height"));
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) { [vx, vy, vw, vh] = vb; }
  if (!(vw > 0 && vh > 0)) return null;
  const scale = widthPx / vw, W = widthPx, H = Math.max(1, Math.round(vh * scale));
  const gray = new Uint8Array(W * H).fill(255);
  const base = [scale, 0, 0, scale, -vx * scale, -vy * scale];

  const stack = [base];
  const shapes = /<(\/?)(g|rect|path|polygon)\b([^>]*)>/gi;
  let m;
  while ((m = shapes.exec(svg))) {
    const closing = m[1] === "/", name = m[2].toLowerCase(), a = m[3];
    if (name === "g") {
      if (closing) { if (stack.length > 1) stack.pop(); } else if (!/\/\s*$/.test(a)) stack.push(mul(stack[stack.length - 1], parseTransform(attr(a, "transform"))));
      continue;
    }
    if (closing) continue;
    const mat = mul(stack[stack.length - 1], parseTransform(attr(a, "transform")));
    const style = attr(a, "style");
    const fillStyle = /fill\s*:\s*([^;]+)/i.exec(style);
    const fill = fillStyle ? fillStyle[1] : attr(a, "fill");
    const color = fill === "" ? 0 : isWhite(fill) ? 255 : 0; // dolgu belirtilmemişse siyah
    let polys = [];
    if (name === "rect") {
      const rx = num(attr(a, "x")), ry = num(attr(a, "y")), rw = num(attr(a, "width")), rh = num(attr(a, "height"));
      if (rw > 0 && rh > 0) polys = [[[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]]];
    } else if (name === "path") polys = pathPolys(attr(a, "d"));
    else {
      const pts = (attr(a, "points").match(/-?[0-9]*\.?[0-9]+/g) || []).map(Number), p = [];
      for (let k = 0; k + 1 < pts.length; k += 2) p.push([pts[k], pts[k + 1]]);
      if (p.length > 2) polys = [p];
    }
    if (!polys.length) continue;
    // çokgenleri piksel uzayına çevir, çift-tek (even-odd) kuralıyla satır satır doldur
    const edges = [];
    for (const poly of polys) {
      const pp = poly.map(([px, py]) => apply(mat, px, py));
      for (let k = 0; k < pp.length; k++) { const p0 = pp[k], p1 = pp[(k + 1) % pp.length]; if (p0[1] !== p1[1]) edges.push([p0, p1]); }
    }
    let minY = Infinity, maxY = -Infinity;
    for (const [p0, p1] of edges) { minY = Math.min(minY, p0[1], p1[1]); maxY = Math.max(maxY, p0[1], p1[1]); }
    for (let row = Math.max(0, Math.floor(minY)); row <= Math.min(H - 1, Math.ceil(maxY)); row++) {
      const yc = row + 0.5, xs = [];
      for (const [p0, p1] of edges) {
        const [ya, yb] = p0[1] < p1[1] ? [p0, p1] : [p1, p0];
        if (yc >= ya[1] && yc < yb[1]) xs.push(ya[0] + ((yc - ya[1]) / (yb[1] - ya[1])) * (yb[0] - ya[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.ceil(xs[k] - 0.5)), to = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
        for (let col = from; col <= to; col++) gray[row * W + col] = color;
      }
    }
  }
  // beyaz kenar boşluğu (QR çözücü sessiz bölge ister) ve RGBA
  const OW = W + margin * 2, OH = H + margin * 2, rgba = new Uint8ClampedArray(OW * OH * 4).fill(255);
  for (let row = 0; row < H; row++) for (let col = 0; col < W; col++) {
    const v = gray[row * W + col], o = ((row + margin) * OW + col + margin) * 4;
    rgba[o] = v; rgba[o + 1] = v; rgba[o + 2] = v;
  }
  return { data: rgba, width: OW, height: OH };
}

// SVG metninden QR içeriğini çıkarır; çözülemezse null
function decodeSvg(svg) {
  for (const w of [360, 520, 720]) {
    const img = rasterize(svg, w);
    if (!img) return null;
    const r = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
    if (r && r.data) return r.data;
  }
  return null;
}

// QR içeriğinden TOTP gizli anahtarı: otpauth:// adresi ya da "secret=XXXX" içeren metin
function secretFromQr(text) {
  const t = String(text || "");
  const m = /secret=([A-Za-z2-7=]+)/i.exec(t);
  return m ? m[1].toUpperCase().replace(/=+$/, "") : "";
}

module.exports = { decodeSvg, secretFromQr, _rasterize: rasterize };
