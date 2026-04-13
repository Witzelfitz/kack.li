# Community-Moderation & Jarvis-Schnittstelle

Stand: 2026-04-13

## Ziel

Community-Vorschläge sollen transparent und nachvollziehbar moderiert werden – inkl. Review über den Jarvis-Bot.

## Statusfluss

Jeder Vorschlag durchläuft einen klaren Zustand:

1. `pending` (offen)
2. `approved` (freigegeben)
3. `rejected` (abgelehnt)

Zusätzlich werden gespeichert:

- `reviewed_at`
- `review_note`
- `reviewed_by`
- `review_source`

## Öffentliche Transparenz-Endpunkte

- `GET /api/episodes/:id/suggestions`
  - liefert `flow` (pending/approved/rejected) + Vorschläge der Episode
- `GET /api/episodes/:id/suggestions/history`
  - liefert Änderungsverlauf (created/approved/rejected) chronologisch

## Jarvis-Moderationsschnittstelle

Diese Endpunkte sind über Bearer-Token geschützt.

- `GET /api/jarvis/suggestions/pending?limit=25`
- `POST /api/jarvis/suggestions/:id/review`

Body-Beispiel:

```json
{
  "action": "approve",
  "review_note": "Bestätigt durch Community-Review",
  "reviewed_by": "jarvis",
  "review_source": "jarvis-bot"
}
```

## Token-Konfiguration (Reihenfolge)

Der Jarvis-Token wird aus dem ersten gesetzten Wert genommen:

1. `JARVIS_REVIEW_TOKEN`
2. `JARVIS_BOT_REVIEW_TOKEN`
3. `JARVIS_BOT_TOKEN`
4. `JARVIS_TOKEN`
5. `TELEGRAM_BOT_TOKEN`
6. `BOT_TOKEN`
7. `TG_BOT_TOKEN`

Mehrere Tokens können kommasepariert gesetzt werden.

## Moderationsregeln

1. **Approve** nur bei klarer, sachlich plausibler Ergänzung.
2. **Reject** bei Spam, Off-Topic, Duplikat oder unklaren Inhalten.
3. Bei Reject möglichst `review_note` setzen.
4. `reviewed_by` und `review_source` immer mitgeben (Audit-Trail).
