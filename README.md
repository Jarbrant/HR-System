# Portalen — HORECA HR-Platform

En fullständig HR-plattform för HORECA-branschen med AI-driven utbildning och dokumentgenerering.

## Snabbstart (Lokal utveckling)

### 1. Installera dependencies
```bash
npm install
```

### 2. Starta Worker lokalt
```bash
npm run worker:dev
```
Worker körs på `http://localhost:8787`

### 3. Öppna test-sida
Öppna `UI/test-worker-connection.html` i webbläsare för att testa Worker-funktionalitet.

### 4. Testa endpoints manuellt
```bash
# Health check
curl http://localhost:8787/v1/health

# Version info
curl http://localhost:8787/v1/version

# Generate training questions (4 frågor)
curl -X POST http://localhost:8787/v1/ai/training \
  -H "Content-Type: application/json" \
  -d '{"mode":"training","count":4,"language":"sv","context":"Hygien på restaurang"}'

# Generate document
curl -X POST http://localhost:8787/v1/ai/document \
  -H "Content-Type: application/json" \
  -d '{"mode":"document","count":1,"language":"sv","context":"Brandskydd"}'
```

## Projekt-struktur
```
/worker          # Cloudflare Worker (AI-motor)
  /generate      # Content generation (training-blocks.js, questions.js)
  index.js       # Worker entry point
  routes.js      # API routing
  schema.js      # Input validation
  http.js        # HTTP/CORS utilities
  utils.js       # General utilities
  
/ai-rules        # AI-regler för content generation
  /v1            # Version 1 rulesets
    /subjects    # Subject-specific rules
    /formats     # Output formats
    /rulesets    # Generation rules
    
/UI              # Frontend (HTML/JS, later Next.js)
  UI-04-WORKER-SDK.js  # Worker client SDK
  test-worker-connection.html  # Test page
  
/employee        # Employee-vy
/admin           # Admin-vy
/manager         # Manager-vy
/system          # System-vy
```

## API Endpoints

### Worker API (v1)

Alla endpoints kräver `/v1/` prefix.

#### `GET /v1/health`
Health check för Worker.

**Response:**
```json
{
  "ok": true,
  "requestId": "req_...",
  "data": {
    "service": "hr-worker",
    "version": "v1"
  }
}
```

#### `GET /v1/version`
Version information.

#### `POST /v1/ai/training`
Genererar träningsfrågor.

**Request:**
```json
{
  "mode": "training",
  "count": 4,
  "language": "sv",
  "context": "Hygien på restaurang"
}
```

**Response:**
```json
{
  "ok": true,
  "title": "Utbildning: Hygien",
  "language": "sv",
  "blocks": [
    {
      "blockId": "b_info_1_...",
      "kind": "info",
      "title": "Info: Vad vi gör i köket",
      "items": [...]
    },
    {
      "blockId": "b_question_2_...",
      "kind": "question",
      "question": "...",
      "options": [...],
      "correctIndex": 0
    }
  ]
}
```

#### `POST /v1/ai/document`
Genererar infoblad/dokumentation.

**Request:**
```json
{
  "mode": "document",
  "count": 1,
  "language": "sv",
  "context": "Brandskydd"
}
```

**Response:**
```json
{
  "ok": true,
  "blocks": [
    {
      "blockId": "b_doc_1_...",
      "kind": "document",
      "title": "Dokument: ...",
      "items": [
        {
          "type": "markdown",
          "text": "## Händelsenotering...\n\n**Datum/Tid:** ..."
        }
      ]
    }
  ]
}
```

## Fas 1 Status

✅ Worker infrastructure  
✅ Document generation (deterministisk med riktig content)  
✅ Lokal test-miljö  
✅ API endpoints (health, version, training, document, generate)  
✅ Deployment config (wrangler.toml)  
⏳ Auth/RBAC (Fas 2)  
⏳ Moduler 1-9 (Fas 3+)  

## Deployment

### Deploy till produktion
```bash
npm run worker:deploy
```

Detta publicerar Worker till Cloudflare Workers med konfiguration från `wrangler.toml`.

### Miljövariabler

Konfigureras i `wrangler.toml`:

- `ALLOWED_ORIGIN`: Tillåten origin för CORS (default: https://jarbrant.github.io)
- `REQUIRE_AUTH`: Kräver auth token (default: false)
- `AI_ENABLED`: Aktiverar AI-generering (default: true)
- `RULES_BASE_URL`: Base URL för AI rules (default: https://jarbrant.github.io/HR-System)
- `ENVIRONMENT`: development | production

## Tekniska detaljer

### Content Generation

- **Deterministisk**: Samma input → samma output (seed-baserad)
- **Kontextmedveten**: Använder scenario + workplace för realistiskt innehåll
- **Flerspråkig**: Stöd för svenska (sv) och engelska (en)
- **XSS-safe**: Endast textdata, ingen HTML-injektion

### Error Handling

Alla endpoints returnerar JSON, även vid fel:

```json
{
  "ok": false,
  "requestId": "req_...",
  "errorCode": "VALIDATION_ERROR",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "count måste vara mellan 1 och 12"
  }
}
```

### CORS

Worker hanterar CORS automatiskt baserat på `ALLOWED_ORIGIN`. Stöder:
- Preflight requests (OPTIONS)
- Custom headers (X-HR-SDK, X-HR-Client)
- Credentials

## Nästa Fas (Fas 2)

Efter Fas 1 mergas:
- Auth (mock-based)
- RBAC guard
- Rollbaserade vyer
- Modul 2 (Utbildning) implementation

## Support

För frågor eller problem, se `worker/README.md` för detaljerad API-dokumentation.
