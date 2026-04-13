# k6 Setup für API-Tests

Dieses Setup ist für wiederholbare Smoke-, Load-, Stress- und Soak-Tests auf der kack.li API.

## 1) Voraussetzung

- k6 installiert (macOS):

```bash
brew install k6
```

## 2) Schnellstart

Aus dem Repo:

```bash
# Smoke (kurz)
npm run perf:k6:smoke

# Load
npm run perf:k6:load

# Stress
npm run perf:k6:stress

# Soak
npm run perf:k6:soak
```

Standard-Base-URL ist `https://kack.li`.

## 3) Konfiguration über ENV

```bash
BASE_URL=https://kack.li \
THINK_TIME_MS=200 \
npm run perf:k6:load
```

### Geschützte Endpunkte mittesten (optional)

```bash
ENABLE_PROTECTED=1 \
ADMIN_TOKEN=... \
JARVIS_REVIEW_TOKEN=... \
npm run perf:k6:smoke
```

Dann werden zusätzlich Admin-/Jarvis-Read-Endpunkte geprüft.

## 4) Reports & Auswertung

Nach jedem Lauf werden Reports erstellt unter:

- `k6/reports/<profile>-<timestamp>.txt`
- `k6/reports/<profile>-<timestamp>.json`

Wichtige Kennzahlen:

- `http_req_failed`
- `http_req_duration` (`p95`, `p99`)
- `checks`
- `endpoint_status_errors`
- `payload_errors`

## 5) Testprofile

- `smoke`: sehr kurz, schneller Health-Check
- `load`: normales Lastprofil
- `stress`: harte Lastspitzen
- `soak`: längere Stabilitätsprüfung

## 6) Was getestet wird

`k6/api-test.js` testet nur **read-orientierte Endpunkte** + Validierungs-/Auth-Fälle, keine destruktiven API-Schreibläufe.

Wenn du später Write-Tests willst (z. B. Suggestions create/review), sollten wir dafür ein separates Profil mit Testdaten-Strategie bauen.
