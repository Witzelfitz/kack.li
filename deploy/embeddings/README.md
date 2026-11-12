# Geschützter Encoder auf vorhandener Infrastruktur

Der Compose-Stack ergänzt den bestehenden Coolify-Proxy; vorhandene Apps und dessen Konfiguration werden nicht verändert. Ollama veröffentlicht **keinen Host-Port**. Nur Nginx hängt am vorhandenen `coolify`-Netz und wird von Traefik via HTTPS geroutet.

1. `compose.yaml` und `nginx.conf` in ein privates Deployment-Verzeichnis kopieren.
2. `.env` dort mit `EMBEDDING_HOST=<eigener DNS-Name>` anlegen. DNS muss auf den VPS zeigen.
3. Eigenes zufälliges Passwort erzeugen und `auth.htpasswd` mit dem Benutzer `kack` anlegen. Dateien nur für den Betreiber lesbar halten, nicht ins Repo übernehmen.
4. `docker compose up -d`, danach `docker compose exec -T ollama ollama pull embeddinggemma-2`.
5. Die Web-App erhält `EMBEDDING_BASE_URL=https://<DNS-Name>` und `EMBEDDING_AUTHORIZATION=Basic <base64(kack:password)>`. Discovery und Embeddings verwenden beide diese Autorisierung. Keine Credentials in URL, Frontend oder Logs.
6. Vor Umschaltung aus der Webhost-Umgebung testen: ohne Auth 401, mit Auth Modell-Digest und einen echten Vektor prüfen. Index für genau diesen Digest erstellen; CPU-/GPU-Plattformen können unterschiedliche Modellartefakte verwenden.

Ollama ist auf 896 MiB ohne Swap und einen CPU-Kern begrenzt, Nginx auf 32 MiB. Der Stack darf keine anderen Apps verdrängen. Wenn das Modell innerhalb dieses Limits nicht zuverlässig läuft, nicht unbemerkt auf Kosten der anderen Apps erhöhen. HTTPS, Auth und Ressourcen-/Latenzprüfung sind Rollout-Gates.

Nginx gibt nur GET `/api/tags` und POST `/api/embed` frei; weder Modellverwaltung noch Chat-Endpunkte sind extern zugänglich. Ausschliesslich der Betreiber kann Modelle innerhalb des privaten Containers laden.
