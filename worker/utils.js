// ============================================================
// AO-WORKER-TRAINING-BLOCKS-01 | FILE: worker/utils.js
// Syfte: Små, rena utilities som kan delas mellan filer.
// Policy: Ingen domänlogik, ingen env/request/Response, inga sid-effekter.
// ============================================================

export function safeStr(v) {
  return (v === null || v === undefined) ? "" : String(v);
}

export function isPlainObject(v) {
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
  if (s === "sv" || s === "svenska" || s === "swedish") return "sv";
  if (s === "en" || s === "english" || s === "eng") return "en";
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

// ------------------------------------------------------------
// IDs + hashing (pure)
// ------------------------------------------------------------

export function makeRequestId() {
  // deterministisk nog för loggning, ingen crypto-beroende
  // (Workers har crypto.randomUUID men vi håller detta enkelt och kompatibelt)
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
