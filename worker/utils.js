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

// ---------- Normalizers ----------

export function normalizeLanguage(langRaw) {
  const s = safeStr(langRaw).toLowerCase().trim();
  if (s === "sv" || s === "se" || s === "svenska" || s.startsWith("sv-")) return "sv";
  if (s === "en" || s === "eng" || s === "english" || s.startsWith("en-")) return "en";
  return "sv"; // stabil default
}

export function normalizeStepValue(stepRaw) {
  const s = safeStr(stepRaw).trim();
  const n = Number(s);
  if (Number.isFinite(n)) {
    const clamped = Math.max(1, Math.min(7, Math.round(n)));
    return String(clamped);
  }
  // om någon skickar "step 3" etc
  const m = s.match(/(\d+)/);
  if (m) {
    const nn = Number(m[1]);
    const clamped = Math.max(1, Math.min(7, Math.round(nn)));
    return String(clamped);
  }
  return ""; // ok om saknas
}

export function normalizeContextText(raw) {
  // Grundsanering: trim + kollapsa whitespace. (Ingen domänlogik här.)
  const t = safeStr(raw).replace(/\s+/g, " ").trim();
  return t;
}

export function normalizeCount(countRaw) {
  // Returnerar number 1..12 eller null om ogiltigt
  if (countRaw === null || countRaw === undefined) return null;
  const n = Number(countRaw);
  if (!Number.isFinite(n)) return null;
  const k = Math.round(n);
  if (k < 1 || k > 12) return null;
  return k;
}

export function normalizeMode(modeRaw) {
  const s = safeStr(modeRaw).toLowerCase().trim();
  if (s === "training" || s === "trainings" || s === "training-blocks" || s === "blocks") return "training";
  if (s === "document" || s === "doc" || s === "docs") return "document";
  return "training"; // stabil default
}

// ---------- IDs / hashing ----------

export function makeRequestId() {
  // Kort stabilt id (Worker-miljö har crypto)
  try {
    const a = new Uint32Array(4);
    crypto.getRandomValues(a);
    return [...a].map(x => x.toString(16).padStart(8, "0")).join("");
  } catch {
    // fallback om crypto av någon anledning saknas i build
    return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  }
}

export function hash32(input) {
  // FNV-1a 32-bit (snabb, stabil, inga externa beroenden)
  const str = safeStr(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}
