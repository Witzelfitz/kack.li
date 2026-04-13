# kack.li – API & Datensammelprozess

Inoffizielle Datenplattform für **Kack & Sachgeschichten**.

Schwerpunkt dieses Projekts:
1. RSS-Daten robust einsammeln
2. Daten mit KI + Community anreichern
3. als stabile API ausliefern
4. Moderation nachvollziehbar und sicher machen

---

## Inhaltsverzeichnis

- [Überblick](#überblick)
- [Architektur](#architektur)
- [Datensammelprozess (End-to-End)](#datensammelprozess-end-to-end)
- [API-Design](#api-design)
- [Öffentliche Endpunkte](#öffentliche-endpunkte)
- [Admin-Endpunkte](#admin-endpunkte)
- [Interne Jarvis-Endpunkte](#interne-jarvis-endpunkte)
- [Rate-Limits](#rate-limits)
- [Community-Moderation](#community-moderation)
- [Datenmodell & Normalisierung](#datenmodell--normalisierung)
- [Sicherheit / Privacy](#sicherheit--privacy)
- [ENV-Konfiguration](#env-konfiguration)
- [Lokale Entwicklung](#lokale-entwicklung)
- [Tests](#tests)
- [Deployment-Hinweise](#deployment-hinweise)
- [Share-Links / Slugs](#share-links--slugs)

---

## Überblick

**Stack:** Node.js (ESM), Express, SQL.js, OpenAI, XML/RSS Parsing.

**Zentrale Dateien:**
- `server.js` → Bootstrap, Wiring, Cron
- `app.js` → Express-App Zusammensetzung
- `services/episodes-service.js` → RSS Sync + Data Quality + Parse Jobs
- `services/parse-service.js` → KI-Extraktion (Film, Kapitel, Gäste, Themen)
- `services/suggestions-service.js` → Suggestion-Review + Cluster-Logik
- `services/jarvis-notifier.js` → Telegram Push + signierte Review-Links
- `controllers/*` + `routes/*` → API-Schicht
- `lib/episode-utils.js` → Normalisierung, Serialisierung, Source-Merging

---

## Architektur

```
RSS Feed -> episodes-service.syncFeed() -> SQLite (SQL.js)
                                  |
                                  +-> parse-service (OpenAI) -> updateParsed()
                                  |
                                  +-> quality repair/report

Client -> /api/* -> public-controller -> repositories -> serializeEpisode()
                    
Community Suggestion -> /api/episodes/:id/suggestions
                     -> DB pending
                     -> optional Telegram Push (Jarvis)
                     -> Review (admin/jarvis)
                     -> Merge in kanonische Cluster
```

---

## Datensammelprozess (End-to-End)

### 1) Feed holen
`episodes-service.syncFeed()` zieht den RSS Feed (`RSS_URL`) und parsed XML via `xml2js`.

Pro Item werden gespeichert:
- `guid`, `title`, `pub_date`, `pub_ts`
- `description`, `summary`
- `duration`, `image_url`, `link`
- `audio_url` (intern gespeichert)
- `format_name` (Regel-basiert)

Upsert läuft über `guid` (idempotent).

### 2) KI-Anreicherung
Falls `OPENAI_API_KEY` gesetzt ist:
- Film/Werk-Extraktion (`film_title`)
- Kapitel (`chapters_json`)
- Gäste (`guests_json`)
- Themen (`topics_json`)
- `parse_version` + `parsed_at`

### 3) Datenqualität
Zusätzliche Jobs/Funktionen:
- Report (`missing_audio_url`, `missing_duration`)
- Reparaturlauf (Feed-Fallbacks + Dauer aus Kapitelzeiten)

### 4) Community-Layer
Vorschläge landen zuerst in `episode_suggestions` (`pending`).
Nach Review werden Werte in manuelle Felder übernommen:
- `manual_guests_json`
- `manual_topics_json`
- `manual_film_title`

### 5) Auslieferung
`serializeEpisode()` liefert öffentliche API-Objekte aus.
Wichtig: `audio_url` wird **nicht** öffentlich ausgegeben.

---

## API-Design

- Public API ist read-heavy + discovery-orientiert
- klare 400-Validierungen bei ungültigen Query-Parametern
- strukturierte Entitäten (Gäste, Themen, Works)
- Suggestions mit sichtbarem Statusfluss + Historie
- interne Moderationsroutes klar getrennt (`/internal/jarvis/*`)

---

## Öffentliche Endpunkte

Basis: `https://kack.li/api`

- `GET /status`
- `GET /episodes`
- `GET /episodes/:id`
- `GET /episodes/:id/suggestions`
- `GET /episodes/:id/suggestions/history`
- `POST /episodes/:id/suggestions`
- `GET /guests`
- `GET /topics`
- `GET /formats`
- `GET /works`
- `GET /works/:id`

### /episodes Query (wichtig)
- Pagination: `limit`, `offset`
- Suche: `q`
- Filter: `guest`, `topic`, `topic[]`, `format`
- Facetten: `has_guest`, `has_chapters`, `has_film_title`
- Sort: `sort=pub_date|relevance|duration`

---

## Admin-Endpunkte

Schutz: `Authorization: Bearer <ADMIN_TOKEN>`

- `GET /api/logs`
- `GET /api/suggestions`
- `POST /api/suggestions/:id/review`
- `POST /api/sync`
- `GET /api/data-quality`
- `POST /api/data-quality/repair`
- `POST /api/episodes/:id/parse`
- `POST /api/parse-films`
- `POST /api/parse-all`

---

## Interne Jarvis-Endpunkte

Basis: `/internal/jarvis`

- `GET /review-link` (signierter Telegram-Link)
- `GET /suggestions/pending` (Bearer Token)
- `POST /suggestions/:id/review` (Bearer Token)

Token-Auflösung erfolgt über `resolveJarvisTokens()`.

---

## Rate-Limits

### Public API
Konfigurierbar via ENV:
- `API_RATE_LIMIT_WINDOW_MS` (Default: `60000`)
- `API_RATE_LIMIT_MAX` (Default: `300`)

Bypass für kontrollierte Lasttests:
- `API_RATE_LIMIT_BYPASS_KEY`
- Header: `x-load-test-key` oder `x-rate-limit-bypass`

### Suggestions
- `SUGGESTION_RATE_LIMIT_WINDOW_MS` (Default: 1h)
- `SUGGESTION_RATE_LIMIT_MAX` (Default: 10)

---

## Community-Moderation

Statusfluss je Vorschlag:
- `pending`
- `approved`
- `rejected`

Audit-Felder:
- `reviewed_at`
- `review_note`
- `reviewed_by`
- `review_source`

### Cluster-Logik bei Approve
Approve schreibt nicht blind Rohwerte zurück, sondern normalisiert in bestehende Cluster:
- Gast-Aliase -> kanonischer Gast
- Themen-Synonyme -> kanonisches Thema
- Film/Werk -> kanonischer Work-Cluster

Dubletten werden so vermieden.

---

## Datenmodell & Normalisierung

### Gäste
- Modell: `config/guest-model.js`
- API-Ausgabe: `id`, `name`, `aliases`, `count`

### Themen
- Modell: `config/topic-model.js`
- API-Ausgabe: `id`, `name`, `aliases`, `count`

### Works (Film/Werk)
- abgeleitet aus `film_title`
- stabile `work_id`
- Endpunkte: `/api/works`, `/api/works/:id`

### Source-Separation (UI)
KI- und Community-Beiträge werden im Frontend subtil getrennt dargestellt.

---

## Sicherheit / Privacy

- `audio_url` bleibt intern, wird nicht öffentlich ausgeliefert.
- Admin/Jarvis Routen sind Token-geschützt.
- Signierte Review-Links für Telegram (`HMAC SHA256`, Ablaufzeit).
- `trust proxy` konfigurierbar via `TRUST_PROXY`.

---

## ENV-Konfiguration

Minimal sinnvoll:

```env
PORT=3000
ADMIN_TOKEN=...
TRUST_PROXY=1

OPENAI_API_KEY=...

API_RATE_LIMIT_WINDOW_MS=60000
API_RATE_LIMIT_MAX=300
SUGGESTION_RATE_LIMIT_WINDOW_MS=3600000
SUGGESTION_RATE_LIMIT_MAX=10
API_RATE_LIMIT_BYPASS_KEY=...

# Jarvis / Telegram (optional)
TELEGRAM_BOT_TOKEN=...
ALLOWED_CHAT_ID=24569491
JARVIS_REVIEW_TOKEN=...
APP_BASE_URL=https://kack.li
```

---

## Lokale Entwicklung

```bash
npm ci
npm run dev
# oder
npm start
```

Server startet auf `PORT` und legt/benutzt `episodes.db`.

---

## Tests

```bash
npm run test:format-rules
npm run test:format-coverage
npm run test:guest-normalization
npm run test:topic-normalization
npm run test:works-entity
npm run test:suggestion-clusters
```

---

## Deployment-Hinweise

1. Pull + Install
2. ENV prüfen
3. Service restarten
4. Smoke-Test:
   - `/api/status`
   - `/api/episodes?limit=1`
   - `/api/guests`
   - `/api/topics`
   - `/api/works?limit=1`

---

## Share-Links / Slugs

### Filter teilen (nur Query-System)
- `https://kack.li/?topic=<slug>`
- `https://kack.li/?guest=<slug>`
- `https://kack.li/?format=<slug>`

mit optionaler Suche/Page:
- `&q=...`
- `&page=...`

Beispiel:
- `https://kack.li/?topic=star-wars&q=rebel&page=2`

### Episode direkt als Popup öffnen
- `https://kack.li/?title=burn-after-reading-gesetz-der-dummheit`

Das Frontend öffnet direkt das Modal über den Titel-Slug.

---

## Zusätzliche Doku

Vertiefung in `docs/`:
- `community-moderation.md`
- `data-quality-report.md`
- `format-rules.md`
- `guest-normalization.md`
- `topic-normalization.md`
- `works-entity.md`
