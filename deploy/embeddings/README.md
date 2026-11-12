# Geschützter Encoder auf vorhandener Infrastruktur

Der Compose-Stack ergänzt den bestehenden Coolify-Proxy; vorhandene Apps und dessen Konfiguration werden nicht verändert. Ollama veröffentlicht **keinen Host-Port**. Nur Nginx hängt am vorhandenen `coolify`-Netz und wird von Traefik via HTTPS geroutet.

1. `compose.yaml` und `nginx.conf` in ein privates Deployment-Verzeichnis kopieren.
2. `.env` dort mit `EMBEDDING_HOST=<eigener DNS-Name>` anlegen. DNS muss auf den VPS zeigen. `sh prepare-cpu.sh` erzeugt das kleine CPU-Image aus den offiziellen Binärdateien; einmalig genügend Platz für das grosse Quellimage vorhalten. Der erste getestete Build benötigt 327 MB statt 8.52 GB.
3. Eigenes zufälliges Passwort erzeugen und `auth.htpasswd` mit dem Benutzer `kack` anlegen. Deployment-Verzeichnis Modus 700, ENV Modus 600; die reine Hash-Datei Modus 644, damit der Nginx-Worker sie im Container lesen kann. Keine Credentials ins Repo übernehmen.
4. `docker compose up -d`, danach `docker compose exec -T ollama ollama pull embeddinggemma-2` und `python3 create-text-model.py`. Dies importiert den offiziellen 271M-Textkern als `kack-embeddinggemma-2-text`, ohne die unnötigen Bild-/Audio-Projektoren. Das komplette Modell überschritt im Test das Speicherlimit; der Textkern lieferte 768-dimensionale Vektoren innerhalb des Limits.
5. Die Web-App erhält `EMBEDDING_BASE_URL=https://<DNS-Name>`, `EMBEDDING_MODEL=kack-embeddinggemma-2-text` und `EMBEDDING_AUTHORIZATION=Basic <base64(kack:password)>`. Discovery und Embeddings verwenden beide diese Autorisierung. Keine Credentials in URL, Frontend oder Logs.
6. Vor Umschaltung aus der Webhost-Umgebung testen: ohne Auth 401, mit Auth Modell-Digest und einen echten Vektor prüfen. Index für genau diesen Digest erstellen; CPU-/GPU-Plattformen können unterschiedliche Modellartefakte verwenden.

Ollama ist auf 896 MiB ohne Swap und einen CPU-Kern begrenzt, Nginx auf 32 MiB. Der Stack darf keine anderen Apps verdrängen. Wenn das Modell innerhalb dieses Limits nicht zuverlässig läuft, nicht unbemerkt auf Kosten der anderen Apps erhöhen. HTTPS, Auth und Ressourcen-/Latenzprüfung sind Rollout-Gates.

Nach Austausch des Ollama-Containers auch den Gateway neu starten (`docker compose restart gateway`), damit Nginx dessen neue interne IP auflöst. Kein bestehender Coolify-Dienst wird neu gestartet. Einmalig vorberechnete Mac-/MLX-Vektoren werden nicht auf den CPU-Dienst übertragen: wegen unterschiedlichem Modell-Digest neu indizieren.

Nginx gibt nur GET `/api/tags` und POST `/api/embed` frei; weder Modellverwaltung noch Chat-Endpunkte sind extern zugänglich. Ausschliesslich der Betreiber kann Modelle innerhalb des privaten Containers laden.
