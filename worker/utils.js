// ============================================================
// AO-WORKER-TRAINING-BLOCKS-01 | FILE: worker/utils.js
// Syfte: Små, rena utilities som kan delas mellan filer.
// Policy: Ingen domänlogik, ingen env/request/Response, inga sid-effekter.
//
// PATCH v1.1.0 (UTILS-EXPAND FOR AI PIPELINE):
// - Lägg till robust JSON-extraktion/parsing (pure).
// - Lägg till uniqStrings + text-normalisering + token-overlap (anti-eko-stöd).
// - Lägg till normalizeOrigin + clampInt (små helpers).
// - Förbättra makeRequestId (crypto om finns, annars fallback).
// ============================================================

export function safeStr(v) {
  return (v === null || v === undefined) ? "" : String(v);
}

export function isPlainObject(v) {
  // Behåll kompatibilitet: "vanligt objekt" (ej array). Ingen klass-detektion här.
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function safeArr(a) {
  return Array.isArray(a) ? a : [];
}

// ------------------------------------------------------------
// Normalizers (pure)
// ------------------------------------------------------------

export function normalizeLanguage(languageRaw) {
  const s = safeStr(languageRaw).toLowerCase().trim();
  if (s === "sv" || s === "svenska" || s === "swedish" || s === "sv-se") return "sv";
  if (s === "en" || s === "english" || s === "eng" || s === "en-us" || s === "en-gb") return "en";
  return "sv"; // fail-safe default
}

export function normalizeStepValue(stepRaw) {
  // accepterar: 1..7, "Steg 1", "kurs 1" etc -> returnerar "1".."7" eller ""
  const s = safeStr(stepRaw).trim();
  if (!s) return "";
  const m = s.match(/([1-7])/);
  return m ? String(m[1]) : "";
}

export function normalizeContextText(contextRaw) {
  // UI kan råka skicka objekt; vi vill alltid ha text
  if (typeof contextRaw === "string") return contextRaw.trim();
  if (contextRaw === null || contextRaw === undefined) return "";
  // om objekt/array -> försök vara defensiv men stabil
  try {
    if (typeof contextRaw === "object") {
      // vanligt: { text:"..." } eller { context:"..." }
      const t =
        safeStr(contextRaw.text).trim() ||
        safeStr(contextRaw.context).trim() ||
        safeStr(contextRaw.prompt).trim();
      if (t) return t;

      // annars: JSON-stringify (begränsat) men undvik [object Object]
      const j = JSON.stringify(contextRaw);
      return (j && j !== "{}") ? j.slice(0, 4000) : "";
    }
  } catch (_) {}
  return safeStr(contextRaw).trim();
}

export function normalizeCount(countRaw) {
  const n = Number(countRaw);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < 1 || i > 12) return null;
  return i;
}

export function normalizeMode(modeRaw) {
  const s = safeStr(modeRaw).toLowerCase().trim();
  if (s === "training" || s === "trainings") return "training";
  if (s === "document" || s === "doc" || s === "docs") return "document";
  return "training";
}

export function normalizeOrigin(originRaw) {
  // Trim + ta bort trailing slashes: "https://x/" -> "https://x"
  return safeStr(originRaw).trim().replace(/\/+$/g, "");
}

// ------------------------------------------------------------
// IDs + hashing (pure)
// ------------------------------------------------------------

export function makeRequestId() {
  // Fail-soft: använd crypto om det finns, annars fallback.
  try {
    if (typeof crypto !== "undefined" && crypto) {
      if (typeof crypto.randomUUID === "function") {
        return safeStr(crypto.randomUUID()).replace(/-/g, "").slice(0, 32);
      }
      if (typeof crypto.getRandomValues === "function") {
        const b = new Uint8Array(16);
        crypto.getRandomValues(b);
        return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
      }
    }
  } catch (_) {}

  const t = Date.now().toString(16);
  const r = Math.floor(Math.random() * 1e16).toString(16);
  return (t + r).slice(0, 32);
}

export function hash32(str) {
  // FNV-1a 32-bit
  const s = safeStr(str);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

export function clampInt(nRaw, min, max) {
  const n = Number(nRaw);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < min || i > max) return null;
  return i;
}

// ------------------------------------------------------------
// Arrays / strings (pure)
// ------------------------------------------------------------

export function uniqStrings(arr) {
  const out = [];
  const seen = new Set();
  for (const v of safeArr(arr)) {
    const s = safeStr(v).trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export function normalizeForCompare(textRaw) {
  // För dedupe/anti-eko: lowercase + trim + collapse whitespace + standardisera citat
  const s = safeStr(textRaw)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

export function tokenizeSimple(textRaw) {
  // Enkel tokenisering för overlap-score (ingen NLP, bara stabilt)
  const s = normalizeForCompare(textRaw);
  if (!s) return [];
  return s
    .replace(/[^a-z0-9åäö'" -]/gi, " ")
    .split(/\s+/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function tokenOverlapScore(aRaw, bRaw) {
  // 0..1 ungefärlig likhet (Jaccard på tokens)
  const a = tokenizeSimple(aRaw);
  const b = tokenizeSimple(bRaw);
  if (!a.length || !b.length) return 0;

  const A = new Set(a);
  const B = new Set(b);

  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;

  const union = A.size + B.size - inter;
  if (!union) return 0;
  return inter / union;
}

export function stemKey(textRaw) {
  // Stabil nyckel för dedupe: normaliserad text (max 240 för att inte bli gigantisk)
  const s = normalizeForCompare(textRaw);
  return s.length > 240 ? s.slice(0, 240) : s;
}

// ------------------------------------------------------------
// Robust JSON extraction/parsing (pure)
// ------------------------------------------------------------

export function extractFirstJsonObjectString(textRaw) {
  const s = safeStr(textRaw);
  const start = s.indexOf("{");
  if (start < 0) return "";

  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];

    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }

    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") depth--;

    if (depth === 0) return s.slice(start, i + 1);
  }
  return "";
}

export function safeJsonParseLoose(textRaw) {
  const t = safeStr(textRaw).trim();
  if (!t) return null;

  // direct
  try {
    return JSON.parse(t);
  } catch (_) {}

  // trim code fences
  const cleaned = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  // first {..}
  const objStr = extractFirstJsonObjectString(cleaned);
  if (!objStr) return null;
  try {
    return JSON.parse(objStr);
  } catch (_) {
    return null;
  }
}

export function safeJsonFromUnknown(x) {
  if (isPlainObject(x)) return x;
  const t = safeStr(x).trim();
  if (!t) return null;
  return safeJsonParseLoose(t);
}

// ------------------------------------------------------------
// CHANGELOG (max 8 rader)
// ------------------------------------------------------------
// 1) Added: normalizeOrigin, clampInt
// 2) Added: uniqStrings, normalizeForCompare, tokenizeSimple, tokenOverlapScore, stemKey
// 3) Added: extractFirstJsonObjectString, safeJsonParseLoose, safeJsonFromUnknown
// 4) Improved: makeRequestId (crypto if available, fallback otherwise)
//
// TEST NOTES
// - Importera i worker/index.js och kör: safeJsonParseLoose("```json\n{\"a\":1}\n```") -> {a:1}
// - tokenOverlapScore("A B C","B C D") ~ 0.5
//
// RISK / EDGE CASES
// - isPlainObject är fortsatt “liberal” (behåller kompatibilitet).
// - tokenOverlapScore är heuristisk (för anti-eko), ej semantisk.
// ============================================================
