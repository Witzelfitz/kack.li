# Work-Entität (Film/Werk)

Stand: 2026-04-13

## Ziel

`film_title` soll nicht nur als String im Episodenobjekt existieren, sondern als eigenständige Ressource nutzbar sein.

## Modell

Eine Work-Entität besteht aus:

- `id` (stabil, z. B. `work-top-gun`)
- `title`
- `episode_count`
- `last_pub_date`
- `last_pub_ts`

Zusätzlich liefert die Detailroute die zugeordneten Episoden.

## Zuordnung

Jede Episode enthält jetzt `work_id` (oder `null`, falls kein Werk vorhanden).

`work_id` wird deterministisch aus `film_title` erzeugt (`getWorkIdFromFilmTitle`).

## API-Routen

- `GET /api/works` (Liste, optional `q`, `limit`, `offset`)
- `GET /api/works/:id` (Detail inkl. Episoden)

## Beispiele

```bash
curl 'https://kack.li/api/works?limit=20'
curl 'https://kack.li/api/works/work-top-gun'
```
