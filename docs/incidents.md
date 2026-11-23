# Störungen und Wiederanlauf des internen Testbetriebs

E005.21 ist eine begrenzte Vorziehung aus C083 für die vorhandenen Module.
Öffentliches Widget, integrierter Mailversand und weitere verschobene Module
haben hier noch keine Betriebsabnahme. Der Worker bereinigt derzeit abgelaufene
Vormerkungen; er ist kein bereits implementierter Mail-/Jobdienst.

## Zuerst Zustand feststellen

Auf dem Podman-Linux-Host mit dem Benutzer der systemweiten Quadlets:

```sh
systemctl is-active ak-test-database.service ak-test-worker.service ak-test-api.service ak-test-admin.service
podman inspect --format '{{.Name}} {{.State.Health.Status}} {{index .Config.Labels "org.opencontainers.image.revision"}}' ak-test-api ak-test-worker ak-test-admin
```

Die Revision aller drei App-Container muss zum freigegebenen CI-Stand passen.
Ein gestarteter Prozess allein beweist keine Betriebsbereitschaft:
`/health/live` prüft den Prozess, `/health/ready` zusätzlich Datenbank und Worker.
Bei einem Abhängigkeitsfehler liefert Readiness 503 statt einer Freigabe.
Beim Datenbankausfall bleiben Liveness und neutrale Fehlerantworten erreichbar;
Verbindungspools und Vormerkungsbereinigung versuchen die Verbindung erneut.

Diagnosen ausschließlich privat aufbewahren. Kein vollständiges `podman inspect`,
keine Umgebungsvariablen, Secret-Dateien, Datenbankinhalte oder Journal-Auszüge
in GitHub-Issues oder öffentliche Logs kopieren. Die gezielte Format-Ausgabe oben
liest nur Namen, Gesundheit und Revision.

## Worker oder Datenbank nicht bereit

Zuerst Ursache und lokale Dienstzustände prüfen: Speicherplatz, Erreichbarkeit,
Dienstfehler und letzte Änderung. Eine gesunde Datenbank nicht vorsorglich neu
initialisieren. Nach behobener Ursache die bestehenden Dienste starten:

```sh
systemctl start ak-test-database.service ak-test-worker.service ak-test-api.service ak-test-admin.service
```

Bei einer Startbegrenzung nur die betroffene Einheit nach behobener Ursache mit
`systemctl reset-failed EINHEIT` entsperren und erneut starten. Keine globale
Rücksetzung oder Wiederholungsschleife über fremde Dienste.

Die Quadlets verwenden `Requires`/`After`. Ein ausdrücklich gestoppter Worker
oder eine gestoppte Datenbank kann deshalb abhängige App-Einheiten stoppen.
Nach einem solchen Eingriff auch API und Admin wieder starten und alle drei
App-Container auf Gesundheit sowie unveränderte Revision prüfen. Ein Neustart
von Podman-Containern im isolierten Probelauf ist kein Nachweis für sämtliche
systemd-Abhängigkeiten oder einen kompletten Hostneustart.

Ohne neue Container, Schemaänderung oder beschädigte Daten erholen sich die
laufenden API-/Worker-Prozesse nach einem vorübergehenden Datenbankausfall.
Der native Probelauf prüft dies mit unveränderten Prozess-IDs und einem weiterhin
vorhandenen fiktiven Datensatz. Er wartet zusätzlich auf einen tatsächlich
fehlgeschlagenen Bereinigungslauf und dessen anschließende Wiederbereitschaft.
Während einer Störung keine ungeprüfte Kapazitätszusage aus einer alten Ansicht
ableiten.

## Oberfläche oder externer Zugang nicht erreichbar

Ist die API bereit, die Oberfläche aber nicht, zunächst den Admin-Container und
dessen tatsächliche Portbindung mit `podman port ak-test-admin` prüfen. Die
Vorlage und die installierte LAN-Freigabe können sich unterscheiden; nicht von
einer zusätzlichen Loopback-Bindung ausgehen. Die freigegebene Installation
bleibt auf den bestehenden Reverse Proxy beschränkt.

Funktioniert der interne Dienst, separat Caddy, Tunnel und DNS im bestehenden
Betreiberzugang prüfen. Ein Proxy-/Tunnelproblem rechtfertigt keine Änderung von
App-Passwort, Datenbank, Ressourcenzuordnungen oder Datenvolume. Keine zusätzlichen
öffentlichen Ports und kein Abschalten von TLS, Anmeldung oder Firewall als
Notlösung. Anmeldeschwierigkeiten sind im [Authentifizierungsablauf](authentication.md)
und der dort beschriebenen Betreiber-Wiederherstellung getrennt behandelt.

## Update fehlgeschlagen

Updates ausschließlich von einem vollständig erfolgreichen CI-/Image-Lauf und
mit einer [schreibfreien Vorab-Sicherung](homelab.md#schreibfreier-update-stand-e00513).
Genau einen Updatevorgang zur Zeit ausführen. Bisherige Digests und Quadlets privat
erhalten; Sicherungskopie und Prüfsumme auf dem Betreiberrechner bestätigen.

Scheitert bereits die Vorbereitung vor Image-, Konfigurations- oder Schemawechsel,
startet der Checkpoint die alten Dienste wieder. Bei gescheitertem Wiederanlauf
lokal prüfen und den Updateversuch stoppen. Ist keine Änderung erfolgt und der
alte Zustand nachweislich intakt, die vorhandenen Dienste gezielt wieder starten.

Nach einer Migration niemals automatisch alte App-Images gegen das neue Schema
starten. Bei unbekanntem Schema- oder Datenstand ebenfalls keinen Image-Rollback
behaupten. App-Schreiber pausieren, betroffenen Bestand und neue Vorgänge erhalten,
vertrauenswürdige Sicherung in eine eigene leere Umgebung wiederherstellen und
diese mit dem zugehörigen bekannten Image-/Schemastand prüfen. Das vorhandene
[Restore-Werkzeug](operations.md#sicherung-und-wiederherstellung) verweigert aktive
Schreiber, nicht leere Ziele und Überschreiben einer Sicherung. Erst nach
fachlichem Abgleich über die weitere Umschaltung entscheiden; keine Sicherung
über das laufende Datenvolume zurückspielen.

### Betriebsstörung 23.11.2026: Plattenplatz voll, Updatelauf brach ab

- **Symptome:** Drei Läufe des alleinigen Updaters scheiterten (20:33
  „Failed to start", 21:06, 21:35 und 22:08 „Update not confirmed; inspect
  operator state and service health"); `podman pull` lief lange und
  `podman inspect` hing in Locks. Die Anwendung selbst blieb erreichbar
  (`/auth/me` antwortete 401, Index 200).
- **Ursache:** Die ZFS-`refquota` des CT war zu 100 % ausgeschöpft. Der
  Bedarf teilt sich mit weiteren Anwendungen desselben CT (unter anderem
  Portainer und weitere Stacks) und wächst mit jedem Updatezyklus durch
  neue Image-Layers je Revision sowie durch die Pre-Update-Checkpoints
  (Ordner derzeit 878 MB). Der Pull des grünen Stands scheiterte am fehlenden
  Platz; die Abbrüche hinterließen genau den beobachteten Zustand aus
  laufendem Pull und belegten Locks.
- **Wiederanlauf (Betreiber, 23.11.2026):** `pct resize 114 rootfs +10G`
  (45 → 55 GiB). Danach beendete der bestehende Updater-Lauf (22:13–22:40)
  seinen Pull selbst erfolgreich und meldete „updated". Kontrolle danach:
  alle drei App-Container healthy auf der exakten Revision des gemergten
  Stands, der Pre-Update-Checkpoint (`preupdate-…​.dump`, 17,3 MB) liegt vor
  dem Wechsel, der Service ist inaktiv, der Timer aktiv. Es erfolgte kein
  manueller Eingriff, kein erneutes Update und kein Neustart von CT oder
  Containern.
- **Künftige Speicherüberwachung (Empfehlung, noch nicht umgesetzt):**
  1. Auslastung der CT-`refquota` auf dem Host beobachten (`zfs get
     used,refquota,referenced …`) und bei 80 %/90 % alarmieren.
  2. Plattenplatz-Vorabprüfung im Updater: vor `podman pull` den freien
     Platz gegen den doppelten Image-Bedarf prüfen und im Zweifel mit klarer
     Meldung abbrechen – fail fast statt eines Pull-Abbruchs.
  3. Nach erfolgreichem Update alte Image-Layers bewusst und separat
     aufräumen (`podman image prune`), nicht im selben Lauf.
  4. Aufbewahrung der Pre-Update-Checkpoints nach Anzahl oder Alter
     begrenzen; der Ordner wächst mit jedem Lauf.

## Nachweis und offene Grenzen

Der native [Podman-Probelauf](operations.md#nativer-podman-probelauf) verwendet
zufällige eigene Namen, unveränderlich gepinnte Images und ausschließlich fiktive
Daten. Er prüft Worker-Ausfall, Datenbankausfall, Liveness/Readiness, Wiederanlauf
und anschließenden Backup-/Restore-Rundlauf. Seine eigenen Ressourcen werden
entfernt; bestehende App-Container bleiben unverändert. Compose prüft zusätzlich
Worker-Ausfall, persistenten Neustart und Restore in der CI.

Das ist keine Produktivfreigabe oder vollständige C083-Abnahme: tägliche
unabhängige Sicherung, Aufbewahrung, tatsächliche Betreiber-Umschaltung,
Host-/Proxy-/Tunnel-Wiederanlauf und die späteren externen Module bleiben gesondert
zu prüfen. Echte Daten werden durch diese Probe weder importiert noch verändert.
