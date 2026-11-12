# Suche und prüfbare Zuteilungen

## Produktfluss

- Themen-/Gästefilter akzeptieren kanonische IDs, bestehende Namen und bekannte Aliase. Zählungen und Filter verwenden dieselbe Normalisierung. Mehrere Themen werden weiterhin mit UND verknüpft.
- `q` sucht mit MiniSearch über Titel, Werk, Beschreibung, Gäste, Themen und Kapitel. Deutsche Stopwörter, Akzente, Wortpräfixe und begrenzte Tippfehler werden berücksichtigt. Suchanfragen werden standardmässig nach Relevanz sortiert; Browse bleibt chronologisch. `sort=pub_date|duration|relevance` bleibt explizit wählbar.
- Ein vorhandener, kompatibler Vektorindex und ein erreichbarer Encoder ergänzen semantische Treffer. Exakte Namen/Titel werden bevorzugt. Bei fehlendem Index, Timeout, hoher gleichzeitiger Last oder falschem Modell erfolgt Wortsuche statt eines Fehlers.
- Episoden zeigen bis zu vier ähnliche Folgen. Dafür genügt der vorberechnete Index; ohne Encoder/Index werden geteilte Themen/Werke genutzt.
- `/admin/clusters.html` bietet nach Eingabe des Admin-Tokens Cluster-Vorschläge mit Beispielen. Token nur im Seitenspeicher, nicht in URL oder Local Storage. Optionen: Zusammenführen (mit Begründung), nur verwandt, getrennt lassen, Rückgängig. Kein automatisches Zusammenführen.
- Werke, unterschiedliche nummerierte Teile/Meilensteine werden nicht zusammengeführt. Gleiche Vornamen allein beweisen keine Identität. Ähnlichkeit ist keine Wahrscheinlichkeit für die Richtigkeit einer Zusammenführung.

## Lokal starten

1. `npm ci` und eine lokale `.env` nach `.env.example` anlegen. Eigenen zufälligen Admin-Token setzen; keine Produktionssecrets kopieren.
2. Einen aktuellen Ollama-Dienst starten und `ollama pull embeddinggemma-2` ausführen. Getestete separate Runtime: Ollama 0.40.16. Das ältere Ollama 0.15.4 unterstützt Modell 2 nicht. Kein globales Update oder Neustart anderer Dienste erforderlich: getrennte Runtime/Modellablage und separater Port sind möglich.
3. `npm run search:index` berechnet Dokument- und Entitätsvektoren. Für Modell 1 `EMBEDDING_MODEL=embeddinggemma` und einen anderen `SEARCH_INDEX_PATH` setzen.
4. `npm run dev`; danach `http://localhost:3108`. Prüfoberfläche: `http://localhost:3108/admin/clusters.html`.

`data/` und die Datenbank sind gitignored. Der lokale Stand vom 12.11.2026 nutzt eine aktuelle Arbeitskopie mit 416 Folgen; das alte lokale DB-File wurde ausserhalb des Repos gesichert. Ohne Produktions-OpenAI-/Telegram-Schlüssel entstehen keine KI-Extraktionsaufrufe oder Benachrichtigungen.

## Index und Aktualisierung

`SEARCH_INDEX_PATH` enthält Modellname **und Digest**, Dimensionen, Pipeline-/Schema-Version, Content-Hashes, Dokument-/Entitätsvektoren und Vorschläge. Retrieval nutzt getrennte Query-/Document-Prompts; Entitätsvorschläge nutzen den Clustering-Prompt. Modellräume werden nicht gemischt. Ein Modellwechsel erfordert einen neuen Index. Query-Caches sind an den Digest gebunden.

Werbung/Linkblöcke werden für den Suchtext entfernt. Ein Dokument nutzt maximal 7000 Zeichen; Ollama darf zusätzlich an der Modell-Kontextgrenze kürzen. Keine Volltext-Transkripte: gesucht wird nur in den vorhandenen Metadaten. Die Interpretation eines Podcasts wird dadurch nicht vollständiger als seine Datenquelle.

Indexdateien werden atomar ersetzt. Unveränderte Vektoren werden wiederverwendet; geänderte Dokumente verwenden keine veralteten Vektoren. Die Laufzeit erkennt Indexänderungen ohne Neustart. Der Index ist bei diesem Umfang klein genug für lineare JS-Cosine-Suche; keine separate Vektordatenbank.

Nach RSS-/Metadatenänderungen und Zusammenführungen den Index neu erstellen: CLI oder Admin-Button **Index aktualisieren** (`POST /api/search/reindex`). Vorschläge aus einem abweichenden Datenstand werden nicht freigegeben. Nach Prüfung einer Zusammenführung deshalb aktualisieren, bevor weitere Vorschläge geprüft werden.

`SEARCH_AUTO_INDEX=1` aktualisiert nach dem bereits vorhandenen nächtlichen RSS-Job. Dies ist standardmässig aus, bis ein zuverlässiger Encoder konfiguriert ist; es wurde keine zusätzliche Betriebssystem-/OpenClaw-Automation eingerichtet. Gleichzeitige Reindex-Aufträge im gleichen Prozess werden zusammengelegt.

## Entscheidungen und Rohdaten

Entscheidungen liegen getrennt in `data/entity-decisions.json` (optional `ENTITY_REGISTRY_PATH`), mit Quelle/Ziel, Aktion, Begründung, Zeit und Undo-Vermerk. Sie verändern die Rohwerte aus RSS/KI/Community nicht. Die kanonische Sicht berücksichtigt freigegebene Zuordnungen; alte Quell-IDs verweisen auf die kanonische Zielgruppe. «Nur verwandt» beeinflusst Empfehlungen, ohne Begriffe gleichzusetzen. Falsch gleichgesetzte feste Themenaliase (Comics/Comicverfilmung, Darth Vader/Star Wars) wurden getrennt und als Beziehungen modelliert.

**Bei Deployments unbedingt erhalten und sichern:** `episodes.db`, Live-ENV und `data/entity-decisions.json`. Der Suchindex ist ableitbar, Entscheidungen nicht. Keine Mehrprozess-Schreiber für SQL.js oder die Entscheidungsdatei verwenden. Audit-Identität ist derzeit `admin` (gemeinsamer bestehender Token, kein neues Mehrbenutzersystem).

## Hosting

Die Web-App bleibt auf Hostpoint. Für semantische Live-Freitextsuche muss **auch die Anfrage** mit demselben Modell eingebettet werden. Ein nur nachts erzeugter Dokumentindex reicht dafür nicht. Entweder einen überprüften lokalen CPU-Encoder auf dem Webhost oder einen zuverlässig erreichbaren privaten Dienst auf vorhandener Infrastruktur verwenden. Ein dauerhaft offener Mac oder öffentliches ungeschütztes Ollama sind keine Produktionsarchitektur. Keine kostenpflichtige Plattform erforderlich.

Produktions-Setup: Textkern von EmbeddingGemma 2 auf vorhandener VPS-Infrastruktur, `kack-embeddinggemma-2-text`, geschützter HTTPS-Encoder, eigener CPU-Container (896 MiB ohne Swap, ein Kern). Bau und Konfiguration stehen in [deploy/embeddings](../deploy/embeddings/README.md). Die Web-App bleibt auf Hostpoint; `SEARCH_AUTO_INDEX=1` integriert Updates in den bestehenden Nachtlauf. Ein erfolgreicher Rollout muss separat gegen den Live-Commit und echte Hybrid-Suchantworten verifiziert werden.

`EMBEDDING_BASE_URL` ist eine serverseitige Konfiguration und niemals vom Besucher wählbar. Der entfernte Dienst verwendet HTTPS und `EMBEDDING_AUTHORIZATION`; keine Tokens oder Produktionszugänge ins Repo schreiben. Der einmalige Erstindex kann auf dem Mac mit **exakt demselben Modell-Digest und denselben GGUF-Gewichten** berechnet werden. Der ursprüngliche MLX-Index ist damit nicht kompatibel und wird nicht übernommen. Laufende Live-Anfragen und inkrementelle Updates bleiben unabhängig vom Mac.

## Verifikation (12.11.2026)

- `npm test`: bestehende Regeln sowie 15 Such-/Filter-/Moderations- und 2 DOM-Integrationstests. Einschliesslich Timeout, Encoder-Ausfall, Modell-Digest-Wechsel, veralteter Vektoren, Alias-Filterzählung, HTTP-Admin-Autorisierung, Merge/Undo und Rohdatenerhalt.
- `npm run test:format-coverage`: aktueller RSS-Feed 415/415 erkannt.
- `npm run search:evaluate`: handbeschriftete **Entwicklungsstichprobe**, 10 inhaltliche und 2 negative Fragen. Auch zur Kalibrierung benutzt, daher kein unabhängiger Benchmark.
- Stand: alte Suche 3/10 relevante Treffer in Top 5, MiniSearch 5/10, Modell 1 hybrid 9/10, Modell 2 hybrid 10/10 (9/10 auf Platz 1). Beide Negativanfragen bei allen Varianten leer. Lokale warme Medianlatenz Modell 1 ca. 71 ms, Modell 2 ca. 20 ms; keine Hostpoint-/Last-Latenzgarantie.
- Modell 2 gewählt für den lokalen Preview. Nummerierte Filmteile können selbst bei sehr hoher Vektorähnlichkeit verschieden sein; Vorschläge bleiben menschlich zu prüfen.
- Browsernavigation auf localhost wurde von der Toolrichtlinie blockiert. HTTP- und DOM-Flows geprüft; **kein visueller Browser-/Mobile-Layout-Test behauptet**.
- Dependencies innerhalb kompatibler Updates bereinigt; `qs` auf 6.17.1 überschrieben, da Express 4 die verwundbare ältere Version exakt pinnt. Override bei künftigem Express-Update prüfen.

Quellen: [Google Developer Guide](https://developers.googleblog.com/embeddinggemma-2-the-developer-guide/), [Google Modellkarte](https://huggingface.co/google/embeddinggemma-2), [MiniSearch](https://github.com/lucaong/minisearch).
