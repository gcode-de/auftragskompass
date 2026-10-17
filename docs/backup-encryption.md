# Sicherungsdateien verschlüsseln (E005.1)

Diese Ergänzung verschlüsselt vorhandene PostgreSQL-Dumps oder Archivdateien außerhalb
von Git. Sie ersetzt weder den Dump aus [backup_restore.py](../scripts/backup_restore.py)
noch einen unabhängigen Sicherungsort, einen täglichen Zeitplan oder einen geprüften
Datenbank-Restore. E005 und C078 bleiben insgesamt offen. Originale werden nicht gelöscht.

## Format und Sicherheitsgrenze

[seal_backup.py](../scripts/seal_backup.py) verwendet das vorhandene OpenSSL 3 und
sein standardisiertes CMS-Format. Es implementiert kein eigenes Kryptoverfahren:
AES-256-GCM verschlüsselt den Inhalt, RSA-OAEP mit SHA-256 schützt dessen zufälligen
Inhaltsschlüssel. Der Backup-Host benötigt ausschließlich das öffentliche
Empfängerzertifikat. Der verschlüsselte private RSA-Schlüssel und seine Passphrase
bleiben beim Betreiber. Ein neuer Schlüssel ersetzt nicht die zum Entschlüsseln
älterer Sicherungen benötigten alten Schlüssel.

Die Entschlüsselung akzeptiert nur von OpenSSL als `AuthEnvelopedData` erkannte
Container. Unauthentifiziertes CMS (etwa CBC) wird abgewiesen. Erst nach vollständiger
Entschlüsselung und erfolgreicher Integritätsprüfung wird das Ziel atomar veröffentlicht.
Auch bei falschem Passwort, falschem Schlüssel, verändertem Inhalt, Timeout oder einem
zwischenzeitlich angelegten Ziel bleiben bestehende Dateien erhalten. Teildateien werden
entfernt; keine Kindprozessdiagnosen, Inhalte oder Passphrasen erscheinen in der Ausgabe.

Das ist Integritätsprüfung der verschlüsselten Nachricht, kein Nachweis ihres Absenders.
Nur eigene vertrauenswürdige Sicherungen verwenden und mit dem separat gesicherten
Manifest/Hash abgleichen, bevor Daten wiederhergestellt werden. Jeder Besitzer des
öffentlichen Zertifikats kann eine neue verschlüsselte Datei erstellen. Der Befehl
extrahiert keine Archive und führt keine SQL-Wiederherstellung aus.

## Einmalig: Wiederherstellungsschlüssel vorbereiten

Auf dem Betreiberrechner einen **neuen leeren** privaten Ordner außerhalb von Git
anlegen (Modus 700). Mit dem vorhandenen Passwortmanager eine lange zufällige
Passphrase erzeugen und in einer Datei mit Modus 600 hinterlegen. Die folgenden
Pfade sind Platzhalter, keine vorhandenen Produktionsdateien. Niemals bestehende
Schlüssel überschreiben und die Passphrase niemals als Argument oder Umgebungswert
übergeben.

```sh
umask 077
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -aes-256-cbc -pass file:/private/new-backup-key/passphrase -out /private/new-backup-key/private.pem
openssl req -new -x509 -key /private/new-backup-key/private.pem -passin file:/private/new-backup-key/passphrase -subj /CN=AuftragsKompass-Backup -days 3650 -out /private/new-backup-key/recipient.pem
```

Das Empfängerzertifikat ist ausschließlich ein öffentliches Verschlüsselungsziel,
kein Browser-/TLS-Zertifikat. Nur `recipient.pem` auf den Backup-Host kopieren;
Fingerabdruck mit der Betreiberkopie vergleichen. Privaten Schlüssel und Passphrase
zusätzlich unabhängig und geschützt verwahren. Verlust beider geeigneten Kopien
verhindert die Wiederherstellung verschlüsselter Sicherungen.

## Vorhandene Dateien verschlüsseln und prüfen

Python 3, OpenSSL 3 und POSIX-Dateideskriptoren werden benötigt (geprüft auf macOS
und dem nativen Podman-Linux-Host). Alle Dateien liegen außerhalb jedes Git-Repositories
und gehören dem ausführenden Betreiber. Eingaben und private Schlüsseldateien benötigen
Modus 600; das öffentliche Zertifikat darf lesbar, aber nicht für andere schreibbar sein.
Der bereits vorhandene Zielordner benötigt Modus 700. Ziele dürfen noch nicht existieren.

```sh
python3 -B scripts/seal_backup.py encrypt --input /private/backups/unique.dump --output /private/backups/unique.dump.cms --certificate /private/keys/recipient.pem
python3 -B scripts/seal_backup.py decrypt --input /private/backups/unique.dump.cms --output /private/restore/verified.dump --private-key /private/keys/private.pem --key-password-file /private/keys/passphrase
```

Die Passphrase gelangt ausschließlich über stdin zu OpenSSL. Dateirechte werden an den
geöffneten Deskriptoren geprüft. Ausgaben haben Modus 600; auch ein konkurrierend
angelegtes Ziel wird nicht überschrieben. Für große Archive muss im privaten Zielordner
Platz für das vollständige Ergebnis vorhanden sein. Bei Entschlüsselung kann eine private
temporäre Klartextdatei entstehen; sie wird bei Fehler entfernt, nicht sicher überschrieben.
Die ursprüngliche Klartextdatei bleibt unverändert vorhanden.

Nach Verschlüsselung den Ciphertext-Hash im privaten Sicherungsmanifest festhalten;
für die unabhängige Kopie Hash und erfolgreiche testweise Entschlüsselung vergleichen.
Nur den vollständig geprüften Dump mit dem bestehenden Restore-Befehl in eine separate,
leere Datenbank übernehmen. API/Worker dieser Zielumgebung bleiben dabei gestoppt.
Vor echter Nutzung bleiben automatischer täglicher Lauf, Fehlerüberwachung, Rotation,
Betriebskonfiguration/Secrets, unabhängige Kopie und vollständiger Restore verpflichtend.

## Abnahme

Die Tests verwenden ausschließlich fiktive binäre Daten und kurzlebige verschlüsselte
Schlüssel. Sie prüfen Rundlauf, manipulierten Ciphertext, falschen Schlüssel, falsche
Passphrase, Ablehnung von CBC, Dateirechte, Spezialdateien, Git-Grenze, Timeout und
konkurrierende Veröffentlichung. Der gleiche Vertrag wurde ohne Änderungen an den
bestehenden Anwendungen auf dem nativen Linux-Host ausgeführt.

Technische Referenz: [OpenSSL CMS](https://docs.openssl.org/3.0/man1/openssl-cms/).
