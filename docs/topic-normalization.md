# Themen-Normalisierung

Stand: 2026-04-13

## Ziel

Themen-Synonyme und nahe Varianten sollen in der API als stabile Entitäten zusammengeführt werden.

## Strategie

Kanonische Themen liegen in `config/topic-model.js` mit:

- `id`
- `name`
- `aliases[]`

Beispiel:

```js
{
  id: 'community-feedback',
  name: 'Community-Feedback',
  aliases: ['Hörerfeedback', 'Hörermails', 'Hörerfragen', 'Community']
}
```

## Umsetzung

- `normalizeTopicEntry(value)` mappt Roh-Themen auf kanonische Entitäten
- `normalizeTopicList(values)` dedupliziert Themen anhand der kanonischen IDs
- `getMergedTopics(...)` liefert normalisierte Themennamen

## API-Auswirkung

`GET /api/topics` liefert jetzt strukturierte Einträge:

- `id`
- `name`
- `aliases[]`
- `count`

Damit sinkt die Fragmentierung in den Aggregationen.

## Test

```bash
npm run test:topic-normalization
```
