# Tech Stack — HR-System (Portalen)

## Runtime
- **Cloudflare Workers** — Serverless JavaScript runtime för API:et
- **Cloudflare AI** — AI-binding för content-generering (Workers AI)

## Build & Deploy
- **Wrangler** — Cloudflare Workers CLI (dev, deploy, secrets)
- **GitHub Actions** — CI/CD (syntax-validering, JSON-validering)

## Frontend
- **GitHub Pages** — Statisk hosting för UI (HTML/CSS/JS)
- **Vanilla JavaScript** — Ingen framework (ännu)

## Konfiguration
- `wrangler.toml` — Worker-konfiguration + env-variabler
- `ai-rules/v1/` — JSON-regelsamlingar för AI-generering

## Planerad (ej implementerad ännu)
- Next.js + TypeScript (planerad migration)
- Keycloak / NextAuth (auth)
- KV / D1 (databas)
- Playwright (E2E-tester)
