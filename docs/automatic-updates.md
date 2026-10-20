# Automatische Podman-Testupdates (H020)

Auf ausdrücklichen Nutzerwunsch wird der bisher manuelle, koordinierte Updateweg
automatisiert. Das betrifft nur API, Worker und Admin von AuftragsKompass im
Testbetrieb. Datenbankimage, Gateway und andere Anwendungen werden nicht umgestellt.

## Ablauf

Ein systemd-Timer auf dem **Proxmox-Host**, nicht im App-Container, startet
`scripts/auto_update.py` zwei Minuten nach Boot und dann fünf Minuten nach Ende
des jeweils letzten Laufs. Der Rechner des Betreibers muss dafür nicht laufen.

1. Öffentliche GitHub-API lesen: Nur der aktuelle Head des konfigurierten
   Zielbranches mit vollständig erfolgreichem Push-Lauf von `quality.yml` kommt
   infrage. Ohne `branch`-Schlüssel gilt unverändert `codex/local-runtime-ci`;
   ausdrücklich freigegeben sind ausschließlich `codex/local-runtime-ci` und
   `codex/ux-event-simplification`. Laufende/fehlgeschlagene Builds, Läufe einer
   anderen Branch und alte erfolgreiche Revisionen werden übersprungen; der Lauf
   muss zusätzlich exakt die abgefragte Branch und den abgefragten Head melden.
   Bei Netzwerk-/Rate-Limit-Fehlern werden keine Images umgestellt.
2. Gesunde, konsistente laufende Revision prüfen; nur vorwärts gerichtete Git-Historie
   erlauben. Gleicher Stand ist ein No-op, kein erneuter Neustart.
3. Runtime- und Admin-Tags für exakt diesen SHA ziehen, OCI-Revision prüfen und
   beide Images auf die tatsächlich gezogenen Digests pinnen.
4. Alte Quadlets privat sichern; dauerhaften Marker `needs-attention` schreiben.
   Vorhandenen `update_checkpoint.py` im App-CT ausführen: App-Dienste pausieren,
   konsistenten Datenbank-Dump erstellen und prüfen.
5. Dump aus dem CT auf den Proxmox-Host kopieren, Größe und SHA-256 vergleichen.
   Erst danach die drei Quadlets atomar ersetzen, systemd neu laden und die
   Administration mit ihren API-/Worker-Abhängigkeiten starten.
6. Alle drei Container müssen gesund sein und exakt die Zielrevision melden.
   Dann `last-success.json` schreiben und die Fehlersperre entfernen.

Ein Fehler nach Setzen des Markers blockiert alle weiteren automatischen Updates.
Es gibt **keinen automatischen Image-Rollback gegen ein möglicherweise bereits
migriertes Schema**. Der vorhandene Checkpoint darf bei einem Fehler vor Änderungen
die alten Dienste wieder starten; trotzdem bleibt der automatische Weg bis zur
Betreiberprüfung gesperrt. Bei spätem Fehler kann die App bis zur Reparatur ausfallen.

Die zusätzliche Hostkopie schützt vor einem isolierten CT-Verlust, ist aber kein
unabhängiges externes Backup. Aufbewahrung/Rotation sind nicht Bestandteil dieses
Slices; die privaten Vorab-Dumps bleiben erhalten und benötigen Platz.

## Installation und Verwaltung

Vorlagen: [Service](../infrastructure/podman/ak-test-update.service),
[Timer](../infrastructure/podman/ak-test-update.timer),
[Updater](../scripts/auto_update.py).

Auf dem Proxmox-Host als root nach `/usr/local/lib/auftragskompass/auto_update.py`
und `/etc/systemd/system/ak-test-update.{service,timer}` installieren.
Externe `/etc/auftragskompass-update.json` mit Modus 600 enthält nur diese Werte
(Platzhalter, keine echte Konfiguration):

```json
{
  "container": 999,
  "image": "docker.io/fictional/auftragskompass",
  "state_dir": "/var/lib/auftragskompass-updates",
  "branch": "codex/local-runtime-ci"
}
```

`branch` ist optional und muss, wenn vorhanden, exakt einem freigegebenen
Branch-Ref entsprechen (`codex/local-runtime-ci` oder
`codex/ux-event-simplification`). Fehlt der Schlüssel, gilt die bisherige Branch
`codex/local-runtime-ci`; ältere Konfigurationsdateien bleiben damit gültig.
Andere Schlüssel, fremde Branches, URLs, Pfadanteile, Leerraum und abweichende
Schreibweise werden vor jedem GitHub-Aufruf abgewiesen. Die Freigabe gilt nur für
den exakten Token; ein Präfixvergleich oder eine freie Branch-Wahl existiert nicht.

Das Zustandsverzeichnis muss root gehören und Modus 700 haben. CT-ID und vorhandenen
Registry-Namespace bewusst einsetzen. Das GitHub-Repository wurde auf ausdrücklichen
Nutzerwunsch am 19.10.2026 öffentlich geschaltet. Deshalb sind keine neuen
GitHub-/Registry-Zugangsdaten erforderlich; GitHub-Redirects werden abgewiesen.
Der App-CT benötigt bereits seine geprüften
Checkpoint-/Backupwerkzeuge und die bisherige Quadlet-Struktur.

```sh
systemd-analyze verify /etc/systemd/system/ak-test-update.service /etc/systemd/system/ak-test-update.timer
python3 /usr/local/lib/auftragskompass/auto_update.py --config /etc/auftragskompass-update.json --check-only
systemctl daemon-reload
systemctl enable --now ak-test-update.timer
systemctl start ak-test-update.service
systemctl list-timers ak-test-update.timer
journalctl -u ak-test-update.service -n 20
```

### Zielbranch umstellen

Der Testbetrieb folgt genau einer Branch. Ein Wechsel ist eine bewusste
Betreiberaktion und wird nie neben einem laufenden Update durchgeführt:

```sh
systemctl disable --now ak-test-update.timer
systemctl is-active ak-test-update.service      # muss "inactive" sein
# /etc/auftragskompass-update.json (root, 0600) redaktionell um "branch" ergänzen
python3 /usr/local/lib/auftragskompass/auto_update.py --config /etc/auftragskompass-update.json --check-only
systemctl start ak-test-update.service
systemctl enable --now ak-test-update.timer
```

`--check-only` darf nur `update-available` oder `current` melden und schreibt nichts.
Erwartet wird `update-available`, wenn der Zielhead noch nicht läuft. Ein Rückschritt
auf eine ältere Branch ist nicht möglich, weil der Updater ausschließlich
vorwärts gerichtete Historie akzeptiert; ein solcher Wechsel scheitert dauerhaft mit
`Only forward updates allowed` und blockiert den Timer. Deshalb vor dem Umschalten
prüfen, dass der Zielhead Nachfahre des laufenden Standes ist. Zwei Branches
gleichzeitig sind kein gültiger Zustand.

Pausieren: `systemctl disable --now ak-test-update.timer`. Das beendet keinen bereits
laufenden Updateprozess; vor manuellen Arbeiten dessen Ende abwarten.
Automatische **und manuelle** Updates verwenden auf dem Proxmox-Host exklusiv
`/run/lock/auftragskompass-update.lock` (`flock`/`fcntl` auf derselben Datei).
Der private manuelle Updater ist entsprechend einzubinden; nicht parallel am Schloss
vorbei deployen. Bei vorhandenem `needs-attention` erst Zustand, Dump, Schema und
Images prüfen/reparieren. Marker niemals blind entfernen. Keine sensiblen Diagnosen
oder Dumpinhalte veröffentlichen.

Hintergrund: Podmans allgemeiner [Autoupdater](https://docs.podman.io/en/latest/markdown/podman-auto-update.1.html)
unterstützt einen automatischen Image-Rollback. Deshalb werden hier weder
`AutoUpdate=registry` noch veränderliche Einzelcontainer-Tags verwendet.
Die Buildfreigabe nutzt die dokumentierte [GitHub-Workflow-Run-API](https://docs.github.com/en/rest/actions/workflow-runs).

## Zielbranch des Testbetriebs

Der Testbetrieb folgt seit H028 der Branch `codex/ux-event-simplification`, damit
UX-Änderungen ohne Merge nach `main` sichtbar werden. Jeder künftig gepushte Head
dieser Branch wird erst nach vollständig grünem `quality`-Lauf und beiden
veröffentlichten Images automatisch übernommen; vorher bleibt der laufende Stand
unverändert. Die Bildfreigabe der Branch ist in [homelab.md](homelab.md) beschrieben.

## Einrichtungsstand 19.10.2026

Updater, Service und Timer sind auf dem Proxmox-Host installiert. Die native
Unitprüfung und das gemeinsame Schloss für manuelle/automatische Updates sind
geprüft. Der echte Update-Lauf auf `906a3e0a6eb8298e4193a4fc6c63b3d68d377160`
war erfolgreich: CT-/Host-Dump verifiziert, drei gesunde Container mit identischer
Zielrevision. Der Timer ist aktiviert; der anschließende No-op-Probelauf bestätigt
keinen erneuten Neustart bei unverändertem Stand.
Die zwischenzeitlich erforderliche Token-Einrichtung entfällt durch die ausdrücklich
beauftragte öffentliche Repository-Sichtbarkeit; es wurde kein Entwicklertoken kopiert.
