# Format-Regelwerk (`format_name`)

Stand: 2026-04-13

## Ziel

- `format_name` Coverage auf **mindestens 95 %** der Feed-Episoden
- stabile, nachvollziehbare Mapping-Regeln

## Bekannte Formate und Mapping-Regeln

Spezifische Formate werden vor generischen Regeln gematcht.

1. `SciFiTech` → `(?:^|#\d+:\s*)SciFiTech`
2. `Shitmenge` → `(?:^|#\d+:\s*)Shitmenge`
3. `HOSE RUNTER` → `^HOSE RUNTER`
4. `Halloween` → `(?:^|#\d+:\s*)Halloween`
5. `Jahresrückblick` → `(?:^|#\d+:\s*)Jahresrückblick`
6. `Premium Classics` → `^Premium Classics`
7. `Geburtstags-Show` → `(?:^|#\d+:\s*)Geburtstags-Show`
8. `Filmschissenschaft` → `(?:^|#\d+:\s*)Filmschissenschaft`
9. `Skepshiz` → `^Skeps(?:h|ch)iz`
10. `Schrott und die Welt` → `^Schrott und die Welt`
11. `Trek Talk Takeover` → `(?:^|#\d+:\s*)Trek Talk Takeover`
12. `Q&A` → `^Q&A`
13. `Bonus` → `^BONUS`
14. `Meta` → `^(Meta:|Metafolge:)`
15. `Trailer` → `^Trailer:`
16. `Sonderfolge` →
   - `Die Stuhlprobe:`
   - `Wir sind am Ende`
   - `Corona:` / `Corona Talk:`
   - `Hoop & Poopgeschichten`
   - `Live Tour`
   - `Crossover mit`
   - `Kackzilla`
17. `Hauptfolge` → `^#\d+:`

## Verifikation

- Regeltests: `npm run test:format-rules`
- Coverage-Check gegen RSS-Feed: `npm run test:format-coverage`

Die Coverage-Schwelle (`TARGET_COVERAGE`) ist in `scripts/check-format-coverage.mjs` definiert.
