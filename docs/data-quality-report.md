# Datenqualitätsreport – kack.li API

Stand: 2026-04-13

## Zielwerte

- `missing_audio_url = 0`
- `missing_duration = 0`

## Aktueller Stand (Audit)

- `total_episodes = 392`
- `missing_audio_url = 0`
- `missing_duration = 13`

## Problemfälle (fehlende duration)

Die folgenden Episoden hatten beim Audit keine verlässliche Laufzeit im Feed:

1. #349: Trek Talk Takeover - Leben mit Star Trek
2. #348: Burn After Reading - Gesetz der Dummheit
3. HOSE RUNTER 11 - Jubiläumsparty und 1 Jahr Trennung
4. #346: Die Millennial Abrechnung | feat. Down to the Detail
5. #345: Ghostbusters - Die Wissenschaft | feat. Dag von SDP
6. BONUS: Fab hat ein Buch geschrieben - Konvergenz
7. #344: Ghostbusters - Die Filme | feat. Dag von SDP
8. #343: Harry Potter - Magische Artefakte
9. #342: Die Werner Beinhart Linguistik
10. #341: SciFiTech - SETI & Astrobiologie
11. #340: Die Schneewittchen Toxikologie
12. #335: Buddy - Der Weihnachtself (X-Mas 2025)
13. #334: Black Panther | feat. Bruder Stève

## Umgesetzte Nachpflege-Strategie

1. **Feed-Fallbacks beim Sync**
   - `audio_url`: `enclosure.url` → `media:content.url`
   - `duration`: `itunes:duration` → `duration` → `media:content.duration`

2. **Reparaturlauf für Bestandsdaten**
   - Neuer Admin-Endpunkt: `POST /api/data-quality/repair`
   - Läuft über alle Datensätze mit fehlender `audio_url` oder `duration`
   - Versucht zuerst Feed-Werte nachzuziehen
   - Wenn `duration` im Feed fehlt: fallback auf letzte Kapitelzeit aus `chapters_json`

3. **Messbarkeit/Monitoring**
   - `GET /api/status` enthält `quality.missing_audio_url` und `quality.missing_duration`
   - Detaillierter Report: `GET /api/data-quality`

## Erwartetes Ergebnis nach Reparaturlauf

- `missing_audio_url` bleibt bei `0`
- `missing_duration` sinkt deutlich (sofern Kapitelzeiten vorhanden sind)
- Restfälle ohne Feed-Laufzeit und ohne Kapitel bleiben als manuelle Sonderfälle bestehen
