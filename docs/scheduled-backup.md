# Automatisierten Sicherungslauf vorbereiten (E005.2)

Der [Sicherungslauf](../scripts/run_backup.py) verbindet den bestehenden konsistenten
Podman-Dump mit [authentifizierter CMS-Verschlüsselung](backup-encryption.md). Die
mitgelieferten Service-/Timer-Dateien sind Vorlagen. Sie wurden geprüft, aber nicht
im Home Lab aktiviert. Unabhängiges Ziel und Schlüsselverwahrung sind noch offen;
E005 und C078 sind dadurch nicht vollständig abgenommen.

## Ablauf und Ergebnis

```sh
python3 -B scripts/run_backup.py --project ak-test --directory /private/dedicated-backups --certificate /private/keys/recipient.pem
```

Der Zielordner muss bereits außerhalb von Git liegen, dem Betreiber gehören und Modus
700 haben. Das öffentliche Empfängerzertifikat liegt ebenfalls außerhalb von Git,
gehört ihm und ist für andere nicht schreibbar. Die drei Skripte `run_backup.py`,
`backup_restore.py` und `seal_backup.py` müssen im selben Ordner liegen. Der Sicherungshost
erhält keinen privaten Entschlüsselungsschlüssel und keine Schlüssel-Passphrase.

Ein exklusiver Dateilock verhindert parallele Läufe im selben Zielordner. Die
Vorprüfung lässt mindestens 512 MiB freien Platz als Reserve; temporärer Dump und
Ciphertext erhalten zusätzlich pro Kindprozess eine Dateigrößengrenze aus dem
verbleibenden Platz. Der reguläre PostgreSQL-Betrieb bleibt aktiv; `pg_dump` verwendet
einen konsistenten Snapshot. Bei zu wenig Platz oder einem fehlgeschlagenen Dump/
Verschlüsselungsprozess wird kein neuer Erfolg gemeldet. Andere Schreibprozesse können
den freien Platz gleichzeitig verändern; Kapazitätsüberwachung bleibt erforderlich.

Der Klartext-Dump liegt während des Laufs nur in einem privaten Arbeitsordner und wird
nach Erfolg oder behandeltem Fehler entfernt. Ein harter Prozessabbruch/Stromausfall
kann einen geschützten `.incomplete-`-Ordner hinterlassen. Vor manueller Bereinigung
prüfen; abgeschlossene Sicherungen werden niemals automatisch gelöscht.

Für jeden erfolgreichen Lauf entstehen:

- eine neue eindeutig benannte `backup-….cms` mit Modus 600;
- eine private zugehörige `.cms.json` mit UTC-Abschlusszeit, Projekt, Dateigröße und
  SHA-256 von ursprünglichem Dump und Ciphertext;
- `last-success.json` und `last-attempt.json` als atomar ersetzte technische Statusdateien.

Die Belege enthalten keine Kontaktdaten, Passwörter oder Prozessdiagnosen. Bei Fehler
liefert der Befehl einen Exitcode ungleich null und versucht `last-attempt.json` mit der
Phase `preflight`, `dump`, `encryption` oder `receipt` zu schreiben. Eine frühere fertige
Sicherung bleibt erhalten. Falls erst die Belegerstellung fehlschlägt, kann eine vollständige
CMS-Datei ohne Erfolgsbeleg liegen bleiben; sie wird nicht stillschweigend gelöscht.
Ein fehlender oder nicht aktueller Erfolgsbeleg darf nicht als gesicherter Stand gelten.

## systemd erst nach Konfiguration aktivieren

Für die bestehenden systemweiten Quadlets sind
[Service](../infrastructure/podman/ak-test-backup.service) und
[Timer](../infrastructure/podman/ak-test-backup.timer) vorbereitet. Sie verwenden nur den
bestehenden Datenbankdienst. Geplant ist 00:30 Uhr Europe/Berlin mit bis zu fünf Minuten
Verteilung, vor dem vorhandenen 01:00-Uhr-Hostbackup. Verpasste Termine werden nachgeholt.
Es wird kein globaler Proxmox-Backupjob geändert.

Nach Festlegung von Schlüsselverwahrung, Speicherziel, unabhängiger Kopie und
Fehlerüberwachung:

1. Die drei geprüften Skripte mit Modus 600 unter `/etc/auftragskompass-test/` und nur
   das öffentliche `backup-recipient.pem` dort ablegen. Ordner und eigener Backupordner
   benötigen Modus 700. Pfade in `ExecStart` an die tatsächliche Konfiguration anpassen.
2. Beide Unit-Dateien mit Modus 644 nach `/etc/systemd/system/` kopieren. Bei Prüfung
   im separaten Verzeichnis die geladenen Quadlet-Generator-Verzeichnisse in
   `SYSTEMD_UNIT_PATH` einbeziehen; sonst fehlt dem Prüfer der Datenbankdienst.
3. `systemctl daemon-reload` und einmal `systemctl start ak-test-backup.service`
   ausführen. Status/Belege, Entschlüsselung, Prüfsummen und Restore in eine frische
   Zielumgebung prüfen; keine bestehende Datenbank überschreiben.
4. Erst nach diesem Probelauf `systemctl enable --now ak-test-backup.timer` verwenden.
   Mit `systemctl list-timers ak-test-backup.timer`, `systemctl status ak-test-backup.service`
   und `journalctl -u ak-test-backup.service` den tatsächlichen Lauf kontrollieren.
5. Ein vorhandenes Monitoring muss fehlgeschlagene und ausgebliebene Läufe melden und
   die unabhängige Kopie ebenfalls prüfen. Ein systemd-Fehlerstatus allein sendet noch
   keine Nachricht. Diese Ergänzung richtet keinen neuen Mail-/Benachrichtigungsdienst ein.

Es gibt bewusst noch keine automatische Rotation, solange unabhängige Kopie und
Aufbewahrungsentscheidung fehlen. Der Timer bleibt bis zur abgeschlossenen Einrichtung
aus. Dateisicherung/Uploads, Betriebskonfiguration/Secrets und die Wiederherstellung der
gesamten Umgebung bleiben weitere Teile der Betriebsabnahme.

## Wiederholung der nativen Abnahme

Auf dem Linux-Podman-Host mit dem bereits vorhandenen PostgreSQL-Testimage:

```sh
python3 -B tests/ops/check_scheduled_backup.py
```

Der Probelauf verwendet fiktive Daten, zufällige eigene Container-/Volume-Namen, ein
internes Netzwerk ohne Hostports und kurzlebige Testschlüssel. Er prüft Dump →
Verschlüsselung → Entschlüsselung → frische leere Zieldatenbank, beide Prüfsummen,
Dateigrößengrenze sowie einen fehlgeschlagenen Wiederholungslauf bei gestoppter Quelle.
Die letzte erfolgreiche Sicherung bleibt lesbar; Testressourcen werden danach entfernt.
Vorhandene Anwendungen werden nicht gestoppt oder übernommen.

## Sicherungszustand lesend prüfen (E005.8)

```sh
python3 -B scripts/check_backup.py --project ak-test --directory /private/dedicated-backups --max-age-hours 26
```

Das Werkzeug liest einen vorhandenen E005.2-Sicherungsordner. Es benötigt weder
einen privaten Schlüssel noch Datenbankzugriff. Der Ordner muss weiterhin dem
aufrufenden Betreiber gehören, Modus 700 haben und außerhalb von Git liegen;
Lock, Belege und Chiffretext sind reguläre private Dateien. Symlinks für diese
Dateien werden abgewiesen.

Nur ein konsistenter Erfolg der Version 1 für das angegebene Projekt, ein
identischer letzter Versuch und Dateibeleg, ein ausreichend frischer UTC-Zeitpunkt
sowie passende Dateigröße und Chiffretext-SHA-256 ergeben Exitcode 0 mit
`{"status":"ok"}`. Der Standard liegt bei 26 Stunden; eine positive Stundenzahl
kann bewusst abweichend angegeben werden. Bis zu fünf Minuten Uhrabweichung in
die Zukunft werden toleriert. Es wird der gesamte Chiffretext blockweise gelesen.

Bei Fehler wird Exitcode 1 mit `{"status":"failed","reason":"…"}` ausgegeben.
Feste Gründe sind `busy`, `last_attempt_failed`, `future_timestamp`, `stale`,
`integrity_failed` und `missing_or_invalid`. Ein geteiltes Leselock verhindert eine
Erfolgsmeldung während eines exklusiven Sicherungslaufs; bei `busy` später erneut
prüfen. Beleginhalte, Diagnosephasen, Dateinamen und Pfade erscheinen nicht in der
Ausgabe. Es werden keine Sicherungen, Statusdateien oder Schlüssel geschrieben.

Ein vorhandenes Monitoring kann den Exitcode prüfen und fehlgeschlagene oder
ausgebliebene Aufrufe melden. Dieses Werkzeug installiert weder Monitoring noch
einen Timer und sendet keine Nachricht. Seine Erfolgsmeldung belegt keine
unabhängige Kopie, Entschlüsselbarkeit, Aufbewahrung oder frische Wiederherstellung.
Diese Prüfungen und die bislang offene Betriebsfreigabe bleiben erforderlich.
