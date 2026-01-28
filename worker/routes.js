// ============================================================
// PRC-MASTER-BYGGORDER — MASTER-AO-WORKER-STACK-01 (PROD v1.0)
// FIL: worker/routes.js
// Syfte: Endast routing (method + pathname -> route-id/handler)
// POLICY (LÅST):
// - Inga guards här
// - Ingen parsing här (ingen body/query/headers)
// - Ingen env-access här
// - Returnerar endast routeId + handlerKey (string)
// ============================================================

/**
 * matchRoute(method, pathname)
 * Return:
 *  - { ok:true, routeId, handlerKey }
 *  - { ok:false, code:"NOT_FOUND" }
 *  - { ok:false, code:"METHOD_NOT_ALLOWED" }
 *
 * NOTE:
 * - Den här filen får endast göra deterministisk vägning baserat på method + pathname.
 * - “pathname” kan ibland råka komma in som full URL; vi normaliserar defensivt till path.
 */
export function matchRoute(methodRaw, pathnameRaw) {
  const method = String(methodRaw || "").toUpperCase();
  const pathname = normalizePathname(pathnameRaw);

  // ---------- v2 reserved (index ska stoppa tidigare, men vi är defensiva) ----------
  if (pathname === "/v2" || pathname.startsWith("/v2/")) {
    return { ok: true, routeId: "v2_block", handlerKey: "v2_block" };
  }

  // ---------- require /v1 ----------
  if (!(pathname === "/v1" || pathname.startsWith("/v1/"))) {
    return { ok: false, code: "NOT_FOUND" };
  }

  // ---------- OPTIONS /v1/* ----------
  if (method === "OPTIONS") {
    // index hanterar preflight själv (204). Detta finns för tydlighet.
    return { ok: true, routeId: "v1_options", handlerKey: "v1_options" };
  }

  // ---------- GET /v1/health ----------
  if (pathname === "/v1/health") {
    if (method !== "GET") return { ok: false, code: "METHOD_NOT_ALLOWED" };
    return { ok: true, routeId: "v1_health", handlerKey: "v1_health" };
  }

  // ---------- GET /v1/version ----------
  if (pathname === "/v1/version") {
    if (method !== "GET") return { ok: false, code: "METHOD_NOT_ALLOWED" };
    return { ok: true, routeId: "v1_version", handlerKey: "v1_version" };
  }

  // ---------- AI endpoints (POST only) ----------
  // OBS: tre path men samma handlerKey (index/handler avgör ev. mode)
  const isAiPath =
    pathname === "/v1/ai/generate" ||
    pathname === "/v1/ai/training" ||
    pathname === "/v1/ai/document";

  if (isAiPath) {
    if (method !== "POST") return { ok: false, code: "METHOD_NOT_ALLOWED" };
    return { ok: true, routeId: "v1_ai_generate", handlerKey: "v1_ai_generate" };
  }

  // ---------- unknown under /v1 ----------
  return { ok: false, code: "NOT_FOUND" };
}

/**
 * normalizePathname(input)
 * - Tar emot path ("/v1/health") eller full URL ("https://x/y/v1/health?z=1")
 * - Returnerar alltid en ren path som börjar med "/"
 * - Tar bort hash/query om de råkar följa med (defensivt)
 * - Stabiliserar dubbla slashes och trailing slash (utom "/")
 *
 * POLICY: Detta är OK här eftersom vi inte tolkar query/body; vi normaliserar endast sträng för routing.
 */
function normalizePathname(input) {
  let s = String(input || "").trim();
  if (!s) return "/";

  // Om full URL råkar skickas in: plocka endast path+query+hash och kapa sedan query/hash.
  // (URL-konstruktor kan kasta på “relativa” strängar utan bas, så vi gör defensivt.)
  if (s.includes("://")) {
    try {
      s = new URL(s).pathname || "/";
    } catch {
      // fallback: plocka efter domän-del (försiktigt)
      const m = s.match(/^[a-z]+:\/\/[^/]+(\/.*)$/i);
      s = m ? m[1] : s;
    }
  }

  // Kapa query/hash om de följt med i en “pathnameRaw”
  const q = s.indexOf("?");
  if (q >= 0) s = s.slice(0, q);
  const h = s.indexOf("#");
  if (h >= 0) s = s.slice(0, h);

  // Säkerställ leading slash
  if (!s.startsWith("/")) s = "/" + s;

  // Normalisera dubbla slashes
  s = s.replace(/\/{2,}/g, "/");

  // Ta bort trailing slash (utom root)
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);

  return s;
}
