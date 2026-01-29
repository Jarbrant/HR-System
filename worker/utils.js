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
