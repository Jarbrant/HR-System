// ============================================================
// PRC-MASTER-BYGGORDER — MASTER-AO-WORKER-STACK-01 (PROD v1.0)
// FIL: README.md  (Worker-repo)
// Syfte: Dokumentera /v1-kontrakt + /v2-reserv + env + exempel
// POLICY (LÅST): Ingen token i klartext
// ============================================================

# HR-System Worker API (versionerad)

Den här Workern kapslar API-regler (versionering, CORS, auth, JSON-only, payload-limit) så att UI-sidorna inte behöver “veta hur man pratar med Worker”.
UI ska använda **HRWorkerSDK** (Client SDK), inte manuell fetch.

---

## Base URL

Exempel (ersätt med din egen Worker URL):

- `https://<din-worker>.workers.dev`

**Viktigt:** Alla anrop måste gå via `/v1/...`

---

## API-versionering (LÅST)

### ✅ Aktiv version: /v1 (krävs)

Allt under `/v1/*` följer kontraktet.

### ⛔ Reserverad version: /v2

Allt under `/v2/*` svarar alltid:

- **410 Gone**
- `code: "VERSION_NOT_AVAILABLE"`

### ❌ Ingen version i path

Anrop utan version, t.ex. `/health` eller `/ai/generate`, svarar:

- **404**
- `code: "NOT_FOUND"`
- `message: "API-version saknas. Använd /v1/..."`

---

## Endpoints (/v1)

### GET /v1/health

- Tillåts utan `Origin` (praktiskt för `curl`/monitoring)
- Om `Origin` finns måste den matcha `ALLOWED_ORIGIN`

Svar (exempel):
```json
{ "ok": true, "requestId": "req_...", "data": { "service": "hr-worker", "version": "v1" } }

