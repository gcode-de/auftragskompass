# Lokaler Betrieb

Der Stand ist eine Entwicklungsgrundlage, noch kein System für echte Geschäftsdaten. Compose startet PostgreSQL, die gebaute Admin-Oberfläche, API und Worker. Der öffentliche Gateway wird hier bewusst nicht veröffentlicht.

## Start

Docker mit Compose v2 sowie eine externe Konfigurationsdatei nach [.env.example](../.env.example) werden benötigt. Eine zufällige Datenbank-Passphrase in einer separaten Datei außerhalb des Repositories speichern (Dateirechte 600) und deren absoluten Pfad als `AK_DB_PASSWORD_FILE` konfigurieren. Keine Passwörter als Kommandozeilenargumente verwenden.

```sh
docker compose --env-file /absolute/external/path/ak.env -p auftragskompass up -d --build --wait
```

Admin: `http://127.0.0.1:8080`, API: `http://127.0.0.1:3100`. Nur diese beiden Ports werden an Loopback gebunden; die Datenbank hat keinen Hostport. Das benannte Datenbankvolume bleibt bei `docker compose down` erhalten. `down -v` löscht Daten und ist ausschließlich für wegwerfbare Testprojekte vorgesehen.

Der Docker-Build verwendet die eigene Allowlist `infrastructure/Dockerfile.dockerignore`. Private Dateien am Git-Root, Exporte, Secrets und Laufzeitdaten gelangen nicht in den Buildkontext. API und Worker laufen als unprivilegierter Node-Benutzer; Admin liefert den Produktionsbuild über unprivilegiertes nginx aus. Die Runtime enthält in dieser frühen Stufe auch Buildwerkzeuge; eine optimierte Release-Verpackung folgt vor Produktion.

## Sicherung und Wiederherstellung

```sh
python3 scripts/backup_restore.py backup --env-file /absolute/external/path/ak.env --project auftragskompass --file /absolute/external/path/backups/unique-date.dump
python3 scripts/backup_restore.py restore --env-file /absolute/external/path/restore.env --project auftragskompass-restore --file /absolute/external/path/backups/unique-date.dump
```

Das Zielverzeichnis muss existieren und außerhalb des Repositories liegen. Backup verwendet einen konsistenten PostgreSQL-Custom-Dump, Dateirechte 600 und atomare Veröffentlichung; vorhandene Dateien werden nicht überschrieben. Für tägliche Sicherungen den Backup-Befehl im Betriebssystem-Scheduler mit eindeutigem datumsbezogenem Dateinamen ausführen und dessen Exitcode überwachen. Es wird durch die Installation kein systemweiter Scheduler verändert. Tägliche Ausführung und Offsite-Kopie sind vor realer Nutzung einzurichten und zu prüfen.

Restore benötigt ein separates Compose-Projekt mit ausschließlich gestarteter, leerer Datenbank. API/Worker müssen gestoppt sein. Das Werkzeug löscht keine vorhandenen Tabellen und spielt den Dump in einer Transaktion ein. Nur vertrauenswürdige eigene Backups verwenden. Der Smoke-Test prüft Neustart mit persistentem Volume, Backup, Restore in eine frische Instanz sowie Ablehnung eines zweiten Restores und des Überschreibens einer Sicherung. C078 ergänzt Verschlüsselung, Rotation und Dateisicherung; derzeit gibt es noch keine Anwendungsuploads.

## TLS und Zugriff

Loopback-HTTP dient ausschließlich lokaler Entwicklung. Für Zugriff über weitere Geräte ist ein lokaler TLS-Reverse-Proxy mit vertrauenswürdigem Zertifikat vor die Loopback-Ports zu schalten; er terminiert HTTPS und leitet nur Admin/API weiter. Datenbank und Worker bleiben intern. Keine Router-Portfreigabe zur Administration einrichten. Vor echter Nutzung müssen Google-Redirect-URI, Proxy-URL, Zugriffsschutz und Backup-Abnahme zusammen geprüft werden. Diese Compose-Datei stellt weder öffentliche TLS-Zertifikate noch DNS automatisch bereit.

## Prüfungen

`pnpm test:ops` erstellt isolierte Projekte mit Zufallsnamen, zufälligem Testpasswort und dynamischen Loopback-Ports. Testvolumes werden danach entfernt. `pnpm check` enthält diesen Test zusätzlich zu allen bisherigen Gates.

Referenz: [Compose-Startreihenfolge und Healthchecks](https://docs.docker.com/compose/how-tos/startup-order/).

## Laufzeit und Health (C007)

`/health/live` bestätigt nur den laufenden Prozess und nennt die Build-Revision. `/health/ready` liefert 200 bei erreichbarer Datenbank und Worker, sonst 503 mit getrennten Zuständen; der Worker prüft seine Datenbank selbst. Prüfungen sind zeitlich begrenzt. Ein späteres Job-System ist damit noch nicht implementiert.

Direkter Node-Start benötigt die AK-Konfigurationswerte aus `.env.example`; Compose setzt interne Hosts/Ports selbst. Fehlende Konfiguration, ungültige Ports, Zeitzonen oder nicht lesbare/zu kurze Passphrassen beenden den Start mit einer neutralen JSON-Fehlermeldung. Request-Logs enthalten weder URL/Query, Header, Body noch Fehlermeldungen von Abhängigkeiten.

Unter Linux müssen AK_UID/AK_GID zur Eigentümerschaft der externen Secret-Datei passen (`id -u`, `id -g`); Compose-Dateisecrets behalten Host-Dateirechte. Die Prozesse bleiben unprivilegiert. Der Smoke-Test konfiguriert hierfür seine eigene UID/GID und prüft zusätzlich den Worker-Ausfall.

### Identitätsschema (C008)

Die API führt beim Start die SQL-Dateien aus `packages/core/migrations` in einer
Transaktion aus. Eine PostgreSQL-Advisory-Sperre serialisiert parallele Starts;
SHA-256-Prüfsummen verhindern unbemerkte Änderungen bereits angewandter Migrationen.
Fehler rollen die gesamte Migration zurück. Vor einem Update eine Sicherung erstellen;
gepushte Migrationen werden ausschließlich durch neue Dateien ergänzt.

Mandanten, Benutzer und Administrator-Memberships sind persistent. Benutzer und
Memberships besitzen zusammengesetzte Mandantenschlüssel; Fremdschlüssel verhindern
mandantenfremde Zuordnungen. Repositories benötigen immer einen expliziten Mandanten.
Es werden keine echten Konten oder Standardmandanten automatisch angelegt.
