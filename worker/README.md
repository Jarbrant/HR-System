// ============================================================
// PRC-MASTER-BYGGORDER — MASTER-AO-WORKER-STACK-01 (PROD v1.0)
// FIL: README.md  (Worker-repo)
// Syfte: Dokumentera /v1-kontrakt + /v2-reserv + env + exempel
// POLICY (LÅST): Ingen token i klartext
// ============================================================

# HR-System Worker API (versionerad)

Den här Workern kapslar API-regler (versionering, CORS, auth, JSON-only, payload-limit) så att UI-sidorna inte behöver "veta hur man pratar med Worker".
UI ska använda **HRWorkerSDK** (Client SDK), inte manuell fetch.

---

## Lokal utveckling

### Snabbstart

1. **Installera dependencies** (från root):
   ```bash
   npm install
   ```

2. **Starta Worker lokalt**:
   ```bash
   npm run worker:dev
   # eller direkt:
   npx wrangler dev
   ```
   
   Worker körs på `http://localhost:8787`

3. **Testa endpoints**:
   ```bash
   # Health check
   curl http://localhost:8787/v1/health
   
   # Generate training
   curl -X POST http://localhost:8787/v1/ai/training \
     -H "Content-Type: application/json" \
     -d '{"mode":"training","count":4,"language":"sv","context":"Hygien"}'
   
   # Generate document
   curl -X POST http://localhost:8787/v1/ai/document \
     -H "Content-Type: application/json" \
     -d '{"mode":"document","count":1,"language":"sv","context":"Brandskydd"}'
   ```

### Deploy till produktion

```bash
npm run worker:deploy
# eller direkt:
npx wrangler deploy
```

### Miljövariabler

Konfigureras i `wrangler.toml` (root):

- **ALLOWED_ORIGIN**: Tillåten origin för CORS (ex: `https://jarbrant.github.io`)
- **REQUIRE_AUTH**: Om `true`, kräver Bearer token i Authorization header
- **AI_ENABLED**: Om `true`, använder AI för generering (fallback: deterministiskt)
- **RULES_BASE_URL**: Base URL för att hämta AI-regler
- **ENVIRONMENT**: `development` eller `production`

---

## Base URL

Exempel (ersätt med din egen Worker URL):

- **Produktion**: `https://<din-worker>.workers.dev`
- **Lokal dev**: `http://localhost:8787`

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
```

### GET /v1/version

Version information.

### POST /v1/ai/training

Genererar training blocks (frågor + info + task).

**Request body**:
```json
{
  "mode": "training",
  "count": 4,
  "language": "sv",
  "context": "Hygien på restaurang"
}
```

**Response**:
```json
{
  "ok": true,
  "title": "Utbildning: Hygien",
  "language": "sv",
  "blocks": [...]
}
```

### POST /v1/ai/document

Genererar dokumentation/infoblad.

**Request body**:
```json
{
  "mode": "document",
  "count": 1,
  "language": "sv",
  "context": "Brandskydd"
}
```

### POST /v1/ai/generate

Umbrella endpoint (mode bestämmer training/document).

---

För mer information, se root README.md.
