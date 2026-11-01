/* ─── SnapPass MRZ Parser (JS port) ──────────────────────────────────────
   SnapPass.Service içindeki MrzParser + MrzScannerService yardımcılarının
   birebir JS karşılığı. Kaynak: decompiled/SnapPass.Service/SnapPass/Service
   Tarayıcıda window.SnapPassMrz, Node'da require("./public/mrz-parser") ile kullanılır.
─────────────────────────────────────────────────────────────────────────── */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SnapPassMrz = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const field = (value, checkDigitValid = null) => ({ value, checkDigitValid });

  const empty = (error) => ({
    success: false, format: null, lines: [],
    documentType: null, issuingCountry: null, documentNumber: null,
    surname: null, givenNames: null, nationality: null, birthDate: null,
    sex: null, expiryDate: null, personalNumber: null, optional1: null,
    compositeCheck: null, error,
  });

  const cleanLine = (line) => line.toUpperCase().replace(/[^A-Z0-9<]/g, "");

  function checkDigit(input) {
    const weights = [7, 3, 1];
    let sum = 0;
    for (let i = 0; i < input.length; i++) {
      const c = input[i];
      let v;
      if (c === "<") v = 0;
      else if (c >= "0" && c <= "9") v = c.charCodeAt(0) - 48;
      else if (c >= "A" && c <= "Z") v = c.charCodeAt(0) - 65 + 10;
      else return "?";
      sum += v * weights[i % 3];
    }
    return String(sum % 10);
  }

  // YYMMDD → yyyy-MM-dd. Doğum tarihi (past) için gelecekteki yıl 19xx sayılır.
  function formatDate(yymmdd, past) {
    if (!/^\d{6}$/.test(yymmdd)) return null;
    const yy = +yymmdd.slice(0, 2), mm = +yymmdd.slice(2, 4), dd = +yymmdd.slice(4, 6);
    const nowYY = new Date().getUTCFullYear() % 100;
    const year = past ? (yy > nowYY ? 1900 + yy : 2000 + yy) : 2000 + yy;
    const d = new Date(Date.UTC(year, mm - 1, dd));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
    return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

  function splitName(nameField) {
    const idx = nameField.indexOf("<<");
    const surname = (idx < 0 ? nameField : nameField.slice(0, idx)).replace(/</g, " ").trim();
    const given = idx < 0 ? "" : nameField.slice(idx + 2).replace(/</g, " ").trim();
    return { surname, given };
  }

  const trimFiller = (s) => s.replace(/^<+|<+$/g, "");

  function parseTd1(l) {
    const docNo = l[0].substr(5, 9), docNoCheck = l[0][14];
    const birth = l[1].substr(0, 6), birthCheck = l[1][6];
    const expiry = l[1].substr(8, 6), expiryCheck = l[1][14];
    const composite = l[1][29];
    const name = splitName(l[2]);
    const compositeField = l[0].substr(5, 25) + l[1].substr(0, 7) + l[1].substr(8, 7) + l[1].substr(18, 11);
    return {
      success: true, format: "TD1", lines: l,
      documentType: field(trimFiller(l[0].substr(0, 2))),
      issuingCountry: field(l[0].substr(2, 3)),
      documentNumber: field(trimFiller(docNo), checkDigit(docNo) === docNoCheck),
      surname: field(name.surname),
      givenNames: field(name.given),
      nationality: field(l[1].substr(15, 3)),
      birthDate: field(formatDate(birth, true), checkDigit(birth) === birthCheck),
      sex: field(l[1][7]),
      expiryDate: field(formatDate(expiry, false), checkDigit(expiry) === expiryCheck),
      personalNumber: field(trimFiller(l[0].substr(15, 15))),
      optional1: field(trimFiller(l[1].substr(18, 11))),
      compositeCheck: field(composite, checkDigit(compositeField) === composite),
      error: null,
    };
  }

  function parseTd3(l) {
    const name = splitName(l[0].substr(5, 39));
    const docNo = l[1].substr(0, 9), docNoCheck = l[1][9];
    const birth = l[1].substr(13, 6), birthCheck = l[1][19];
    const expiry = l[1].substr(21, 6), expiryCheck = l[1][27];
    const personal = l[1].substr(28, 14), personalCheck = l[1][42];
    const composite = l[1][43];
    const compositeField = l[1].substr(0, 10) + l[1].substr(13, 7) + l[1].substr(21, 7) + l[1].substr(28, 15);
    return {
      success: true, format: "TD3", lines: l,
      documentType: field(trimFiller(l[0].substr(0, 2))),
      issuingCountry: field(l[0].substr(2, 3)),
      documentNumber: field(trimFiller(docNo), checkDigit(docNo) === docNoCheck),
      surname: field(name.surname),
      givenNames: field(name.given),
      nationality: field(l[1].substr(10, 3)),
      birthDate: field(formatDate(birth, true), checkDigit(birth) === birthCheck),
      sex: field(l[1][20]),
      expiryDate: field(formatDate(expiry, false), checkDigit(expiry) === expiryCheck),
      personalNumber: field(trimFiller(personal), checkDigit(personal) === personalCheck),
      optional1: null,
      compositeCheck: field(composite, checkDigit(compositeField) === composite),
      error: null,
    };
  }

  function parseTd2(l) {
    const name = splitName(l[0].substr(5, 31));
    const docNo = l[1].substr(0, 9), docNoCheck = l[1][9];
    const birth = l[1].substr(13, 6), birthCheck = l[1][19];
    const expiry = l[1].substr(21, 6), expiryCheck = l[1][27];
    const composite = l[1][35];
    const compositeField = l[1].substr(0, 10) + l[1].substr(13, 7) + l[1].substr(21, 7) + l[1].substr(28, 7);
    return {
      success: true, format: "TD2", lines: l,
      documentType: field(trimFiller(l[0].substr(0, 2))),
      issuingCountry: field(l[0].substr(2, 3)),
      documentNumber: field(trimFiller(docNo), checkDigit(docNo) === docNoCheck),
      surname: field(name.surname),
      givenNames: field(name.given),
      nationality: field(l[1].substr(10, 3)),
      birthDate: field(formatDate(birth, true), checkDigit(birth) === birthCheck),
      sex: field(l[1][20]),
      expiryDate: field(formatDate(expiry, false), checkDigit(expiry) === expiryCheck),
      personalNumber: null,
      optional1: field(trimFiller(l[1].substr(28, 7))),
      compositeCheck: field(composite, checkDigit(compositeField) === composite),
      error: null,
    };
  }

  // OCR satırı hedef uzunluktan uzunsa "<<" içeren pencereleri + baş/son pencereyi dener.
  function windows(line, targetLen) {
    if (line.length < targetLen) return [];
    if (line.length === targetLen) return [line];
    const seen = new Set();
    const out = [];
    const add = (w) => { if (!seen.has(w)) { seen.add(w); out.push(w); } };
    for (let s = 0; s <= line.length - targetLen; s++) {
      const w = line.substr(s, targetLen);
      if (w.includes("<<")) add(w);
    }
    add(line.slice(0, targetLen));
    add(line.slice(line.length - targetLen));
    return out;
  }

  function countValidChecks(r) {
    return [r.documentNumber, r.birthDate, r.expiryDate, r.personalNumber, r.compositeCheck]
      .filter((f) => f && f.checkDigitValid === true).length;
  }

  function scoreResult(r) {
    const validScore = countValidChecks(r) * 1000;
    const docType = ((r.documentType && r.documentType.value) || "").toUpperCase();
    let typeBonus = 0;
    if (r.format === "TD1" || r.format === "TD2") {
      if ("IAC".includes(docType[0] || "-")) typeBonus = 500;
    } else if (r.format === "TD3" && docType[0] === "P") {
      typeBonus = 500;
    }
    const digitCount = (s) => (s ? (s.match(/\d/g) || []).length : 0);
    const namePenalty = (digitCount(r.surname && r.surname.value) + digitCount(r.givenNames && r.givenNames.value)) * 50;
    const fillerCount = r.lines.reduce((n, l) => n + (l.match(/</g) || []).length, 0);
    return validScore + typeBonus - namePenalty + fillerCount;
  }

  function extractMrzLines(raw) {
    return String(raw || "").replace(/\r/g, "").split("\n").map(cleanLine).filter((l) => l.length >= 25);
  }

  function parse(rawOcr) {
    const lines = extractMrzLines(rawOcr);
    if (!lines.length) return empty("MRZ satiri bulunamadi.");

    let best = null, bestScore = -1;
    const consider = (candidate) => {
      if (!candidate.success) return;
      const score = scoreResult(candidate);
      if (countValidChecks(candidate) !== 0 && score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    };

    for (let i = 0; i + 1 < lines.length; i++) {
      for (const a of windows(lines[i], 44)) for (const b of windows(lines[i + 1], 44)) consider(parseTd3([a, b]));
      for (const a of windows(lines[i], 36)) for (const b of windows(lines[i + 1], 36)) consider(parseTd2([a, b]));
    }
    for (let j = 0; j + 2 < lines.length; j++) {
      for (const a of windows(lines[j], 30))
        for (const b of windows(lines[j + 1], 30))
          for (const c of windows(lines[j + 2], 30)) consider(parseTd1([a, b, c]));
    }

    return best || empty(`Tanimli MRZ formati eslesmedi (satir uzunluklari: ${lines.map((l) => l.length).join(",")}).`);
  }

  // Ham OCR metninin MRZ'ye benzerlik puanı (tam kare / kırpılmış kare seçimi için).
  function scoreMrzLikeness(text) {
    if (!text || !text.trim()) return 0;
    let score = 0;
    for (const line of text.split("\n")) {
      const l = cleanLine(line);
      if (l.length < 20 || !l.includes("<<")) continue;
      if (l.length === 30 || l.length === 36 || l.length === 44) score += 100;
      else if ([30, 36, 44].some((n) => Math.abs(l.length - n) <= 2)) score += 30;
      else score += 5;
    }
    return score;
  }

  function classifyDocType(docType, format) {
    const t = (docType || "").toUpperCase().replace(/<+$/, "");
    if (format === "TD1" || format === "TD2") return "NATIONAL_ID";
    if (format === "TD3") {
      if (t.startsWith("P") || !t) return "PASSPORT";
      if (t.startsWith("V")) return "VISA";
      if (/^[IAC]/.test(t)) return "NATIONAL_ID";
      return "PASSPORT";
    }
    if (t.startsWith("P")) return "PASSPORT";
    if (/^[IAC]/.test(t)) return "NATIONAL_ID";
    return "PASSPORT";
  }

  function normalizeSex(s) {
    const t = (s || "").trim().toUpperCase();
    return t === "M" || t === "F" ? t : "";
  }

  // SnapPass API'sinin döndürdüğü MrzResult şekli.
  function toMrzResult(parsed) {
    const result = {
      firstName: "", middleName: "", lastName: "", documentNumber: "", documentType: "PASSPORT",
      nationality: "", dateOfBirth: "", gender: "", expiryDate: "", issuingCountry: "", idNumber: "",
      confidence: 0, rawMrz: "", scanSessionId: "", checksumValid: false, checksum: null,
    };
    if (!parsed.success) return result;

    const val = (f) => (f && f.value) || "";
    const given = val(parsed.givenNames);
    const sp = given.indexOf(" ");
    result.firstName = sp < 0 ? given : given.slice(0, sp);
    result.middleName = sp < 0 ? "" : given.slice(sp + 1).trim();
    result.lastName = val(parsed.surname);
    result.documentNumber = val(parsed.documentNumber);
    result.documentType = classifyDocType(parsed.documentType && parsed.documentType.value, parsed.format);
    result.nationality = val(parsed.nationality);
    result.dateOfBirth = val(parsed.birthDate);
    result.gender = normalizeSex(parsed.sex && parsed.sex.value);
    result.expiryDate = val(parsed.expiryDate);
    result.issuingCountry = val(parsed.issuingCountry);
    result.idNumber = val(parsed.personalNumber);
    result.rawMrz = parsed.lines.join("\n");

    const flag = (f) => (f ? f.checkDigitValid : null);
    const checks = [parsed.documentNumber, parsed.birthDate, parsed.expiryDate, parsed.personalNumber, parsed.compositeCheck].map(flag);
    const known = checks.filter((c) => c !== null && c !== undefined);
    const validCount = known.filter((c) => c === true).length;
    result.checksum = {
      documentNumber: checks[0] ?? true,
      dateOfBirth: checks[1] ?? true,
      expiryDate: checks[2] ?? true,
      personalNumber: checks[3] ?? true,
      composite: checks[4] ?? true,
      validCount,
      totalCount: known.length,
    };
    result.checksumValid = !known.includes(false);
    result.confidence = validCount / 5;
    return result;
  }

  return { parse, toMrzResult, scoreMrzLikeness, countValidChecks, checkDigit, classifyDocType };
});
