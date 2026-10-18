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

Vorhandene externe Dumps und Archive lassen sich mit dem separaten
[geprüften Verschlüsselungswerkzeug](backup-encryption.md) schützen (E005.1).
Dies aktiviert keinen Zeitplan und ist noch keine unabhängige Sicherung.
Ein [serialisierter Lauf mit systemd-Vorlagen](scheduled-backup.md) ist in E005.2
vorbereitet; Aktivierung und unabhängige Kopie bleiben separat erforderlich.

### Podman (H004)

Dasselbe Werkzeug unterstützt die benannten Container aus den
[Home-Lab-Vorlagen](homelab.md). Auf dem Linux-Host mit demselben Podman-Benutzer
wie die Container ausführen (bei den systemweiten Quadlets: root):

```sh
python3 scripts/backup_restore.py backup --runtime podman --project ak-test --file /absolute/external/path/backups/unique-date.dump
python3 scripts/backup_restore.py restore --runtime podman --project ak-restore --file /absolute/external/path/backups/unique-date.dump
```

`--project` ist hier der Container-Namenspräfix: Die Datenbank heißt beispielsweise
`ak-test-database`, API und Worker `ak-test-api` und `ak-test-worker`.
`--env-file` wird bei Podman abgewiesen; es werden die bereits konfigurierten
Container und deren lokaler Datenbankzugang verwendet. Es gibt keine Verbindung
zu einer externen Datenbank und kein automatisches Anlegen von Containern.

Für Restore muss eine eigene leere Zieldatenbank unter dem gewählten Präfix laufen.
API und Worker dieses Zielpräfixes dürfen nicht laufen. Beide Schutzprüfungen
müssen erfolgreich sein; Fehler beim Ermitteln der laufenden Container oder beim
Prüfen der Datenbank verhindern die Wiederherstellung. Andere Namenspräfixe werden
nicht gestoppt oder verändert. Sicherungsdateien werden auch bei einem Fehler oder
gleichzeitigem Backup nicht überschrieben. Ein fehlgeschlagener Dump wird nicht
als fertige Sicherung veröffentlicht.

Ein Datenbank-Dump ersetzt keine separate Sicherung von OIDC-/Podman-Secrets und
Betriebskonfiguration. Verschlüsselung, tägliche Ausführung mit Fehlerüberwachung
und unabhängige Zweitkopie bleiben vor echten Daten erforderlich.

### Nativer Podman-Probelauf

Auf einem Linux-Host mit Podman und einer Kopie der Anwendung kann der Probelauf
mit veröffentlichten, per Digest festgelegten Runtime-/Admin-Images laufen:

```sh
python3 -B tests/ops/check_podman.py \
  --runtime-image docker.io/synthetic/auftragskompass@sha256:REPLACE_RUNTIME_DIGEST \
  --admin-image docker.io/synthetic/auftragskompass@sha256:REPLACE_ADMIN_DIGEST \
  --revision REPLACE_FULL_COMMIT_HASH
```

Namespace, beide Digests und den vollständigen Commit-Hash ersetzen. Der Probelauf
legt ausschließlich eigene zufällig benannte Testcontainer, Volumes, ein Netzwerk
und ein Secret an. Er prüft Start und Migrationen, unprivilegierte Prozesse,
Loopback-Oberfläche, gesperrte Fachendpunkte ohne Login, Dateirechte, Überschreib-
und Restore-Sperren, Wiederherstellung und Datenhaltung nach Neustart. Seine
Testressourcen werden auch bei Fehlern entfernt; heruntergeladene Images bleiben
im lokalen Cache. Vorhandene Container und Volumes werden nicht übernommen.

Diese Prüfung ist eine manuelle Linux-Abnahme; `pnpm test:ops` führt in der CI die
Adapter-/Sicherheitstests und den vorhandenen realen Compose-Probelauf aus.
Der Podman-Probelauf ist keine App-Login- oder Produktivabnahme. E005.21 ergänzt
Worker-/Datenbankausfall und Wiederanlauf mit unveränderten App-Prozess-IDs.
Das [begrenzte Störungshandbuch](incidents.md) beschreibt Diagnose,
Abhängigkeitsreihenfolge und die Grenze eines sicheren Update-Rückfalls.

### Fachliche Restore-Probe (E005.22)

Der native Probelauf und der Compose-Test in der CI lesen zusätzlich
`tests/ops/restore_probe.mjs` und führen den Testcode per stdin ausschließlich
im eigenen wegwerfbaren Runtime-Container aus. Compose verwendet dafür einen
eigenen kurzlebigen Container im jeweiligen isolierten Projekt; er startet
keinen zusätzlichen API-Dienst.
Die Runtime-Images enthalten diese Testdatei nicht. Seed verweigert einen bereits
belegten Mandantenbestand. Das Wiederherstellungsziel muss vor dem Restore an der
fachlichen Prüfung scheitern; ein leeres Ziel ist kein Erfolgsnachweis.

Nach dem Restore müssen fiktiver Kontakt und Eventzuordnung, gebuchte Ressource
mit Puffern, Produktpreis in Cent und Steuerbasis unverändert lesbar sein.
Die gesicherte Sitzung und ein neuer Passwortlogin funktionieren weiter, ein
falsches Passwort und dieselbe Sitzung in einem anderen Mandanten werden
abgewiesen. Direkte SQL-Proben bestätigen den GiST-Überlappungsschutz,
Mandanten-Fremdschlüssel und das unveränderbare Auditlog. Ein erneuter
Migrationslauf akzeptiert die wiederhergestellten Prüfsummen ohne Änderung.

Alle Konten und Datensätze sind ausdrücklich fiktiv. Negative SQL-/Loginproben
und neue Sitzungen betreffen nur die wiederhergestellte Kopie. Das ist weiterhin
kein echter Import, kein Restore des Betreiberkontos und kein Nachweis einer
unabhängigen PBS-/NAS-Wiederherstellung.

## TLS und Zugriff

Loopback-HTTP dient ausschließlich lokaler Entwicklung. Für Zugriff über weitere Geräte ist ein lokaler TLS-Reverse-Proxy mit vertrauenswürdigem Zertifikat vor die Loopback-Ports zu schalten; er terminiert HTTPS und leitet nur Admin/API weiter. Datenbank und Worker bleiben intern. Keine Router-Portfreigabe zur Administration einrichten. Vor echter Nutzung müssen Google-Redirect-URI, Proxy-URL, Zugriffsschutz und Backup-Abnahme zusammen geprüft werden. Diese Compose-Datei stellt weder öffentliche TLS-Zertifikate noch DNS automatisch bereit.

## PostgreSQL-Bereitschaft (H010)

Compose und Quadlet prüfen `pg_isready` ausdrücklich über TCP an `127.0.0.1`
im Datenbankcontainer. Der nur während der Erstinitialisierung verfügbare Unix-Socket
darf API, Worker oder Sicherungslauf nicht vorzeitig freigeben. Auch die nativen
Probeläufe warten auf den regulären TCP-Dienst. Bestehende Datenvolumes bleiben erhalten.

## Prüfungen

`pnpm test:ops` erstellt isolierte Projekte mit Zufallsnamen, zufälligem Testpasswort und dynamischen Loopback-Ports. Testvolumes werden danach entfernt. `pnpm check` enthält diesen Test zusätzlich zu allen bisherigen Gates.

Referenz: [Compose-Startreihenfolge und Healthchecks](https://docs.docker.com/compose/how-tos/startup-order/).

## Laufzeit und Health (C007)

`/health/live` bestätigt nur den laufenden Prozess und nennt die Build-Revision. `/health/ready` liefert 200 bei erreichbarer Datenbank und Worker, sonst 503 mit getrennten Zuständen; der Worker prüft seine Datenbank selbst. Prüfungen sind zeitlich begrenzt. Ein späteres Job-System ist damit noch nicht implementiert.

Direkter Node-Start benötigt die AK-Konfigurationswerte aus `.env.example`; Compose setzt interne Hosts/Ports selbst. Fehlende Konfiguration, ungültige Ports, Zeitzonen oder nicht lesbare/zu kurze Passphrassen beenden den Start mit einer neutralen JSON-Fehlermeldung. Request-Logs enthalten weder URL/Query, Header, Body noch Fehlermeldungen von Abhängigkeiten. Der Fastify-LogController unterdrückt die internen Request-Logs; der eigene Abschluss-Hook schreibt ausschließlich Statuscode und neutrale Laufzeit-Metadaten. Ein separater Node-Prozess prüft, dass der Start keine veraltete Logging-Option verwendet (E005.18).

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

Die optionale Google-Anmeldung, TLS-Voraussetzungen und Endpunkte sind in
[authentication.md](authentication.md) beschrieben. Die Standard-Compose-Umgebung
bleibt ohne Google-Secrets startbar; administrative Fachendpunkte sind dann gesperrt.
