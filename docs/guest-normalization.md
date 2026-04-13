# Gäste-Normalisierung

Stand: 2026-04-13

## Ziel

Gäste sollen für Filter und Zählungen als stabile Entitäten erscheinen, auch wenn in den Rohdaten Varianten vorkommen.

## Datenmodell

Kanonische Gäste liegen in `config/guest-model.js`:

```js
{
  id: 'dag-alexis-kopplin',
  name: 'Dag-Alexis Kopplin',
  aliases: ['Dag von SDP', 'Dag-Alexis Kopplin (Sänger der Band SDP)', ...]
}
```

## Normalisierungslogik

- `normalizeGuestEntry(value)`
  - prüft direkte Alias-Matches
  - prüft bereinigte Kernnamen (ohne Klammern/Zusatztexte)
  - erzeugt für unbekannte Namen stabile Fallback-IDs (`guest-...`)
- `getMergedGuests(...)` liefert normalisierte kanonische Namen

## API-Auswirkung

- `GET /api/guests` liefert jetzt pro Gast:
  - `id`
  - `name`
  - `aliases[]`
  - `count`

Damit sind Aggregationen stabiler und weniger fragmentiert.

## Test

```bash
npm run test:guest-normalization
```
