# Home-Lab-Testbetrieb

Seit H020 sind [koordinierte automatische Testupdates](automatic-updates.md)
gemäß Nutzerwunsch vorgesehen; deren Aktivierungs-/Abnahmestand steht in der
Projektübergabe. Der allgemeine Podman-Autoupdater ersetzt diesen Ablauf nicht.

Diese Umgebung dient ersten Bedienungs- und Designtests mit synthetischen Daten.
Sie ist keine Produktivfreigabe und übernimmt keine echten Bookitup-Daten.

## Images über Docker Hub

Der Image-Name ist fest `<Docker-Hub-User>/auftragskompass`. Der Workflow verwendet
hierfür die beiden bereits hinterlegten Repository-Secrets unter GitHub
**Settings → Secrets and variables → Actions**:

| Art | Name | Inhalt |
|---|---|---|
| Repository-Secret | `DOCKERHUB_TOKEN` | Zugriffstoken mit Schreib- und Repository-Anlegerecht |
| Repository-Secret | `DOCKERHUB_USER` | Docker-Hub-Benutzername |

`DOCKERHUB_IMAGE` und `DOCKERHUB_USERNAME` werden nicht mehr benötigt.
Vor dem Build prüft der Workflow das Repository über die Docker-Hub-API. Nur bei
404 wird es wie gewünscht öffentlich angelegt; bei fehlenden Berechtigungen, ausgeschöpftem Kontingent oder
abweichender Sichtbarkeit eines bestehenden Repositories bricht der Ablauf ab.
Es gibt keinen automatischen Wechsel zu öffentlicher Sichtbarkeit.

Keine Zugangsdaten in versionierte Dateien oder Chatnachrichten schreiben. Auf dem
Home-Lab-Host genügt für private Images ein separater Token mit Leserecht außerhalb
von Git. Die Veröffentlichung läuft nur nach erfolgreichen Qualitätsprüfungen bei
einem Push auf einen ausdrücklich freigegebenen Branch-Ref: `refs/heads/main`,
`refs/heads/codex/local-runtime-ci` oder `refs/heads/codex/ux-event-simplification`.
Die Allowlist steht als `fromJSON`-Liste an genau einer Stelle im `images`-Job von
`quality.yml`. Jeder andere Branch und jeder Pull Request veröffentlichen nichts;
der Vergleich erfolgt auf den vollständigen Ref und nicht auf einen Teilstring.
Fehler der Registry-Einrichtung verhindern jeden Image-Push.

Die UX-Branch `codex/ux-event-simplification` ist damit der zweite freigegebene
Veröffentlichungszweig für den Testbetrieb. Ab H028 folgt der automatische
Testbetrieb dieser Branch auf ausdrückliche Betreiberkonfiguration. Damit gilt:
jeder künftig gepushte Head dieser Branch wird erst nach vollständig grünem
`quality`-Lauf und beiden veröffentlichten Images automatisch übernommen. Eine
neue Branch in der Allowlist ist eine bewusste, zu testende Codeänderung.

Der veröffentlichte Stand der UX-Branch ist der geprüfte Termin-Editor mit
„Weiteren Angaben“, ohne manuelle UTC-Versatzfelder im Terminblock und mit
zugänglichem Bereich „Erweitert“ für eigene Dispositionszeiträume. Die Oberfläche
bleibt bis zum Abschluss der separaten Bookitup-Referenzprüfung unverändert.

Es entstehen zwei Tags im selben Repository:

```text
namespace/auftragskompass:runtime-<vollständiger Commit-Hash>
namespace/auftragskompass:admin-<vollständiger Commit-Hash>
```

API und Worker verwenden dasselbe Runtime-Image. Beide Tags müssen erfolgreich
veröffentlicht sein, bevor die Installation aktualisiert wird. Kein `latest`-Tag.
Seit H020 wählt der unten beschriebene automatische Dienst ausschließlich den
grünen aktuellen Branch-Head; manuelle Updates bleiben unter demselben Schloss möglich.
Docker-Hub-Tags sind veränderbar; für eine spätere Produktivfreigabe
sind zusätzlich die tatsächlich veröffentlichten Image-Digests festzuhalten.

### Veröffentlichten und laufenden Stand abgleichen (E005.9)

Beide Images tragen die standardisierten OCI-Angaben
`org.opencontainers.image.source` und `org.opencontainers.image.revision`.
Die Quelle ist das GitHub-Repository, die Revision der vollständige SHA des
geprüften Pushes. Die Angaben folgen der
[OCI-Annotationspezifikation](https://github.com/opencontainers/image-spec/blob/main/annotations.md).
Tags und gepinnte Digests bleiben zusätzlich maßgeblich; ein Label ersetzt weder
einen erfolgreichen CI-Lauf noch eine Signatur oder den Digest-Abgleich.

Nach einem Update auf dem Podman-Host nur die Revisionsangabe auslesen, keine
vollständigen Container-Umgebungen mit Secrets ausgeben:

```sh
podman inspect --type container --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' ak-test-api ak-test-worker ak-test-admin
```

Alle drei Ausgaben müssen dem erwarteten vollständigen Commit-Hash entsprechen.
Ältere Images ohne diese Angabe gelten damit nicht als verifiziert. Dienstgesundheit,
Sicherung vor dem Update und Anmeldung/Abmeldung werden weiterhin separat geprüft.
Die OCI-Angaben allein schalten kein automatisches Update ein; dafür gilt H020 oben.

Das Zielsystem wurde per SSH als `x86_64` geprüft. Deshalb veröffentlicht dieser
erste Build ausschließlich `linux/amd64`; ARM-Unterstützung ist nicht abgenommen.
Der Build verwendet weiterhin die private Dateien ausschließende Docker-Allowlist.

## Podman-Vorbereitung (H002)

Die sechs [Quadlet-Vorlagen](../infrastructure/podman) passen zum auf dem Zielhost
vorhandenen Podman 5.4.2. H002 prüfte den Generator zunächst isoliert im Dry-run;
H006 hat die Einheiten anschließend mit dem eigenen Login installiert und gestartet. Die Vorlagen verwenden
eigene `ak-test-*`-Namen, ein eigenes Netzwerk und ein persistentes Datenvolume.

Vor einer späteren Installation:

1. Die Vorlagen außerhalb von Git kopieren. In allen `.container`-Dateien
   `REPLACE_IMAGE` durch das vorhandene `namespace/auftragskompass` und
   `REPLACE_REVISION` durch denselben vollständigen Commit-Hash ersetzen.
   Beide zugehörigen Images müssen bereits veröffentlicht sein.
2. Für private Images Podman auf diesem Host mit einem separaten Lese-Token
   anmelden (`podman login docker.io`, interaktive Eingabe). Keine Registry-Credentials
   in Quadlets oder Git speichern. Beide Images vorab mit `podman pull` laden.
3. Einen eigenen Test-Datenbank-Schlüssel mit mindestens 16 Zeichen in einer
   externen Datei mit Modus 600 erzeugen und als Podman-Secret registrieren:

   ```sh
   podman secret create ak-test-db /absolute/external/path/test-db-password
   ```

   API und Worker lesen das Secret als UID/GID 1000; die Datenbank erhält dasselbe
   Secret für ihren eigenen Start. Es wird kein Passwort als Umgebungswert übergeben.
4. Der Nutzer hat den eigenen Passwortlogin gewählt. Ein zufälliges Startpasswort
   mit mindestens 24 Zeichen in einer externen Datei (Modus 600) erzeugen, niemals
   als Shell-Argument. Als Secret einbinden:

   ```sh
   podman secret create ak-test-bootstrap /absolute/external/path/initial-password
   ```

   `/etc/auftragskompass-test/auth.env` mit Modus 600 anlegen. Alle folgenden Werte
   sind Platzhalter, keine realen Kontodaten:

   ```text
   AK_AUTH_ORIGIN=https://admin.example.invalid
   AK_TENANT_ID=11111111-1111-4111-8111-111111111111
   AK_BOOTSTRAP_EMAIL=synthetic-owner@example.invalid
   AK_BOOTSTRAP_USERNAME=fictional.owner
   AK_TENANT_NAME=Synthetic test business
   ```

   Eine eigene Mandanten-UUID verwenden. Nach erfolgreichem ersten Login die
   Bootstrap-E-Mail und den Benutzernamen aus `auth.env` sowie die beiden
   Bootstrap-Zeilen (`Secret=ak-test-bootstrap,…` und
   `Environment=AK_BOOTSTRAP_PASSWORD_FILE=…`) aus der installierten API-Quadlet
   entfernen. Neu laden, API und Admin neu starten und Anmeldung erneut prüfen;
   anschließend `podman secret rm ak-test-bootstrap`. Das Startpasswort privat
   an den Inhaber übergeben; eine davon getrennte Passwortmanager-Kopie wird
   durch das Entfernen des Bootstrap-Secrets nicht ersetzt.
5. Erst nach Einrichtung des Logins die sechs Quadlet-Dateien nach
   `/etc/containers/systemd/` kopieren und `systemctl daemon-reload` ausführen.
   `systemctl start ak-test-admin.service` startet die Abhängigkeiten in der
   Reihenfolge Datenbank → Worker → API → Admin. `Notify=healthy` wartet jeweils
   auf erfolgreiche Healthchecks. Fehlender Login oder fehlende Secrets verhindern
   den Start. Der Teststand wird bewusst nicht automatisch beim Booten gestartet.

Nur die Oberfläche wird auf `127.0.0.1:4177` veröffentlicht. API, Worker und Datenbank
haben keine Hostports. Ein separater Caddy-Host benötigt die unten beschriebene
LAN-Bindung und Firewallfreigabe ausschließlich für den Proxy. Im abgenommenen
Teststand wurde dies eingerichtet;
`https://auftragskompass.samuelgesang.de` führt über Caddy auf die App.
Die Route und beide Homer-Einträge sind im
[Infrastruktur-Repository dokumentiert](https://github.com/gcode-de/proxmox-automation/blob/main/docs/auftragskompass-routing.md).

Quadlet-Dienste mit systemd verwalten; Portainer kann die Container anzeigen, ist
aber nicht die Quelle ihrer Konfiguration. Kein paralleles Anlegen derselben
Container als Portainer-Stack. Für ein Update zuerst eine konsistente Sicherung
erstellen, dann Admin/API/Worker stoppen und die beiden Image-Tags gemeinsam ändern.
Anschließend die Einheiten neu laden und Admin starten. Das Datenvolume nicht
löschen; ein früheres Image allein ist nach Migrationen kein sicherer Rollback.
Das vorhandene Python-Werkzeug unterstützt mit `--runtime podman` jetzt auch diese
benannten Container. [Befehle und isolierter Probelauf](operations.md#podman-h004)
sind dokumentiert. Die vollständige Betriebsabnahme vor echter Datennutzung,
Verschlüsselung, tägliche Ausführung und unabhängige Kopie bleiben offen.

Referenz: [Quadlet für Podman 5.4.2](https://docs.podman.io/en/v5.4.2/markdown/podman-systemd.unit.5.html).

## Noch vor Zugriff auf die Anwendung

Die vorhandene Infrastruktur verwendet Podman mit systemd/Quadlet, Portainer,
Caddy und einen Cloudflare Tunnel. Neue App-Dienste erhalten eigene Namen,
Netzwerke und Datenvolumes. Bestehende Apps werden nicht verändert.

Der eigene Login mit E-Mail oder Benutzername und Passwort ist implementiert und
in der Podman-Vorlage aktiviert. Vor der Veröffentlichung muss der Zugang mit
erlaubten und unerlaubten Anmeldungen geprüft werden. Eine vorgeschaltete SSO-Seite
ersetzt keine Anmeldung innerhalb der Anwendung.

Installation, Sicherung und Wiederherstellung: [Betriebsanleitung](operations.md).
Anmeldeverfahren: [Passwortlogin und optionales Google-OIDC](authentication.md).
Die vollständige Betriebsabnahme E005 bleibt offen.

Referenzen: [Docker-Builds in GitHub Actions](https://docs.docker.com/build/ci/github-actions/)
und [GitHub-Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

## Optionaler LAN-Zugang ausschließlich für den Proxy (H006)

Loopback bleibt die sichere Voreinstellung. Für Caddy auf einem anderen Host zuerst
`proxy-access.nft.example` außerhalb von Git nach
`/etc/auftragskompass-test/proxy-access.nft` kopieren und die beiden Dokumentations-IPs
ersetzen. Vor Installation sicherstellen, dass die Tabelle `inet ak_test_access`
noch nicht anderweitig genutzt wird. Mit `nft --check --file …` prüfen; anschließend
`ak-test-proxy-access.service` unter `/etc/systemd/system/` installieren und aktivieren.
Die Regeln wirken vor Podmans DNAT und betreffen ausschließlich die App-Zieladresse
und TCP-Port 4177. IPv6 wird für diesen Port nicht veröffentlicht. Andere
Firewalltabellen werden nicht verändert.

Erst danach in der installierten Admin-Quadlet `127.0.0.1` durch die eigene IPv4-Adresse
ersetzen und unter `[Unit]` ergänzen:

```ini
Requires=ak-test-proxy-access.service
After=ak-test-proxy-access.service
```

Neu laden und Admin starten. Vom Proxy muss die Oberfläche erreichbar sein, von
einem anderen LAN-Host muss derselbe Port gesperrt sein. Datenbank und API erhalten
weiterhin keinen Hostport. Die Caddy-Route erst nach erfolgreicher Anmeldung,
Abmeldung und einem Neustart ohne Bootstrap-Secret umschalten. Keine vorhandenen
Proxy-Routen oder Cloudflare-Einträge ersetzen.

## Geprüfter Teststand vom 16.10.2026 (H006)

Die erste isolierte Installation verwendete App-Revision
`9d26a5da5645711de58ce2ead7ed812ad4fbecf4`, nach vollständig grüner GitHub-CI.
Die installierten Images sind über Digests festgelegt:

- runtime: `docker.io/sgesang/auftragskompass@sha256:a3346bb116bc73679c13991d16aad9b884a9cb116a3962cfa76d4f8815508926`
- admin: `docker.io/sgesang/auftragskompass@sha256:bee87ca30df00a65d7df7c751809fe2ab76f4d7831363e4ed49b807cabb1d0fa`

Alle vier Dienste wurden über die tatsächlichen Quadlets gestartet und sind gesund.
Bei dieser Abnahme wurde ein Shell-Quote-Fehler der früheren Node-Healthchecks
gefunden und behoben: API und Worker verwenden jetzt JSON-Exec-Arrays. Nur eine
Generator-Prüfung hätte diesen Laufzeitfehler nicht erkannt.

Geprüft sind Anmeldung mit beiden Kennungen, Ablehnung unbefugter API-Zugriffe,
CSRF, Logout und ein Neustart nach Entfernen aller Bootstrap-Werte, der Datei und
des Podman-Secrets. Der tatsächliche TLS-Proxy und die öffentliche Browser-Anmeldung
funktionieren; die Oberfläche lädt ohne Browserfehler. Die LAN-Firewall wurde mit
einem temporären Server vor und nach Aktivierung getestet: Proxy erlaubt, anderer
LAN-Client gesperrt, wiederholtes Laden ergibt genau eine Regel. Temporäre
Testressourcen wurden entfernt; andere Anwendungen bleiben aktiv.

Caddy leitet die öffentliche Adresse auf die App weiter. Beide Homer-Quellen
tragen den Zusatz „Testbetrieb“. Eine erste Datenbanksicherung liegt mit Modus 600
auf dem Host und mit verifiziertem Hash auf dem Betreiberrechner, außerhalb von Git.
Kontodaten und Passwörter liegen ausschließlich privat; echte Kunden- und
Auftragsdaten wurden nicht importiert. Verschlüsselte automatische Sicherungen und die vollständige Betriebsabnahme E005
bleiben vor Produktivbetrieb offen. Der Teststand startet noch nicht automatisch
nach einem Host-Neustart; dafür `systemctl start ak-test-admin.service` ausführen.

## Grundgestaltung für Nutzer-Tests (H007)

Die Admin-App erhält eine lokale responsive Gestaltung ohne zusätzliche UI-Pakete
oder externe Schrift-/Bilddienste. Formulare werden in lesbare Bereiche gegliedert,
Eingaben und Schaltflächen bleiben mindestens 44 px hoch und Tastaturfokus sichtbar.
Bei 390 px Breite bleibt die Seite innerhalb des Viewports; breite Kalender und
Tabellen können innerhalb ihrer Bereiche gescrollt werden. Die Abmeldung steht direkt beim Konto am Seitenanfang. Die vorhandenen
Formularbeschriftungen und Geschäftsabläufe bleiben erhalten.

Die Chromium-Abnahme durchläuft beide Anmeldeverfahren und den vollständigen
synthetischen Geschäftsablauf. Zusätzlich prüft sie Eingabegröße, mobilen
Seitenüberlauf und Tastaturfokus und erstellt Desktop-/Mobilbilder. Dies ist eine
Grundgestaltung für die Testphase; ein fachliches Nutzerfeedback steht noch aus.

## Passwortwechsel im Testkonto (H008)

Die eigene Passwortänderung ist unter Einstellungen verfügbar und beendet alle
Sitzungen des Kontos. Die vorhandene Startpasswort-Datei wird dabei nicht automatisch
aktualisiert; das selbst gewählte neue Passwort im eigenen Passwortmanager sichern.
Die [Anmelde-Dokumentation](authentication.md#eigenes-passwort-ändern-h008) beschreibt
Prüfungen, Fehlversuchssperre und Audit. Die getrennte Betreiber-Wiederherstellung
ist in H009 beschrieben; zusätzliche lokale Konten folgen bei Bedarf.

## Betreiber-Wiederherstellung installieren (H009)

Nach einem grünen Image-Update ab H009 `scripts/reset_password.py` als private
Datei mit Modus 600 nach `/etc/auftragskompass-test/reset_password.py` auf den
Podman-Host kopieren. Der Ordner hat bereits Modus 700. Das Werkzeug wird bei Bedarf
über den bestehenden SSH-Zugang aufgerufen; es ist kein Dienst und kein weiterer
veröffentlichter Port. [Dateivertrag, Ablauf und Sicherheitsgrenze](authentication.md#betreiber-wiederherstellung-h009)
sind dokumentiert. Der normale Betrieb benötigt keine zusätzliche Passwortdatei.

Der isolierte native Probelauf hat das echte Inhaberkonto und seine Startdatei
unverändert gelassen. Verschlüsselte tägliche Sicherungen und die übrige
Betriebsabnahme E005 bleiben vor einer Produktivfreigabe erforderlich.


## Schreibfreier Update-Stand (E005.13)

Vor einem manuellen Imagewechsel müssen Admin, API und Worker pausieren, bevor
`pg_dump` beginnt. Andernfalls fehlen spätere Änderungen im Vorabstand. Die
Datenbank bleibt für den Dump aktiv. Genau einen Updatevorgang zur Zeit ausführen;
während der Pause sind Oberfläche und Hintergrundverarbeitung nicht verfügbar.

`scripts/update_checkpoint.py` zusammen mit `scripts/backup_restore.py` im privaten
Betreiberverzeichnis auf dem Podman-Host installieren (Ordner 700, Dateien 600).
Nach erfolgreicher CI und Imageprüfung die bisherigen Quadlets privat sichern,
dann vor jeder Image-/Konfigurationsänderung aufrufen:

```sh
python3 /etc/auftragskompass-test/update_checkpoint.py \
  --project ak-test \
  --file /var/backups/auftragskompass-test/preupdate-EINDEUTIGER-ZEITPUNKT.dump
```

Der Zielordner muss dem aufrufenden Betreiber gehören, Modus 700 haben und außerhalb
von Git liegen; vorhandene Dateien werden nicht überschrieben. Das Werkzeug prüft,
dass alle drei App-Dienste aktiv sind, stoppt sie und ruft den bestehenden atomaren
Dump auf. Bei Erfolg bleiben sie für das anschließende Update gestoppt. Erst jetzt
Images/Quadlets ändern, gegebenenfalls die Datenbank neu starten und die Anwendung
starten. Danach Gesundheit und OCI-Revision aller drei App-Container prüfen und die
Sicherung auf den Betreiberrechner kopieren und per SHA-256 abgleichen.

Scheitert das Stoppen oder der Dump, startet das Werkzeug die alten App-Dienste
wieder und meldet den Fehler. Scheitert auch dieser Wiederanlauf, bleibt eine klare
Betreibermeldung; lokale Dienste gezielt prüfen. In beiden Fällen kein Imagewechsel.
Diese Wiederaufnahme gilt ausschließlich vor Änderungen an Images, Konfiguration
oder Schema. Nach einer Migration niemals automatisch alte Images gegen die neue
Datenbank starten oder die Sicherung über vorhandene Daten zurückspielen: erst in
einem isolierten leeren Ziel wiederherstellen und den weiteren Ablauf prüfen.

Die Kommandotests prüfen Reihenfolge und Fehlerwiederaufnahme ohne echte Dienste;
der vorhandene native Podman-Probelauf prüft den realen Dump/Restore separat.
Das Werkzeug aktiviert weder Updates noch einen Sicherungstimer.
