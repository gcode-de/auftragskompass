# Home-Lab-Testbetrieb

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
einem Push auf `main` oder `codex/local-runtime-ci`. Pull Requests veröffentlichen
nichts. Fehler der Registry-Einrichtung verhindern jeden Image-Push.

Es entstehen zwei Tags im selben Repository:

```text
namespace/auftragskompass:runtime-<vollständiger Commit-Hash>
namespace/auftragskompass:admin-<vollständiger Commit-Hash>
```

API und Worker verwenden dasselbe Runtime-Image. Beide Tags müssen erfolgreich
veröffentlicht sein, bevor die Installation aktualisiert wird. Kein `latest`-Tag
und kein automatisches Update auf dem Testhost: Die getestete Revision wird bewusst
ausgewählt. Docker-Hub-Tags sind veränderbar; für eine spätere Produktivfreigabe
sind zusätzlich die tatsächlich veröffentlichten Image-Digests festzuhalten.

Das Zielsystem wurde per SSH als `x86_64` geprüft. Deshalb veröffentlicht dieser
erste Build ausschließlich `linux/amd64`; ARM-Unterstützung ist nicht abgenommen.
Der Build verwendet weiterhin die private Dateien ausschließende Docker-Allowlist.

## Podman-Vorbereitung (H002)

Die sechs [Quadlet-Vorlagen](../infrastructure/podman) passen zum auf dem Zielhost
vorhandenen Podman 5.4.2. Ihr Generator wurde dort isoliert im Dry-run geprüft;
es wurden keine Einheiten installiert oder gestartet. Die Vorlagen verwenden
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
4. Die Login-Entscheidung treffen. Die API-Vorlage bildet ausschließlich den
   **bereits implementierten Google-Login** ab; das ist keine Vorentscheidung für
   die spätere Anmeldung. Bei einer anderen Wahl muss die Vorlage gemeinsam mit
   der getesteten App-Anmeldung angepasst werden. Ein Deaktivieren von Authentifizierung
   macht die Fachoberfläche nicht nutzbar.

   Nur falls Google gewählt wird: Secret `ak-test-google` aus der externen
   Client-Secret-Datei anlegen und `/etc/auftragskompass-test/auth.env` mit Modus 600
   und diesen nicht geheimen Konfigurationsschlüsseln erstellen:

   ```text
   AK_AUTH_ORIGIN=https://admin.example.invalid
   AK_TENANT_ID=11111111-1111-4111-8111-111111111111
   AK_GOOGLE_CLIENT_ID=replace-with-client-id
   AK_BOOTSTRAP_EMAIL=synthetic-owner@example.invalid
   AK_TENANT_NAME=Synthetic test business
   ```

   Alle Platzhalter durch die eigenen Testwerte ersetzen; für die Testumgebung
   eine eigene Mandanten-UUID erzeugen. Nach erfolgreichem Bootstrap die E-Mail
   aus der externen Datei entfernen. Das eigentliche Client-Secret gehört nur in
   das Podman-Secret, nicht in diese Datei.
5. Erst nach Einrichtung des Logins die sechs Quadlet-Dateien nach
   `/etc/containers/systemd/` kopieren und `systemctl daemon-reload` ausführen.
   `systemctl start ak-test-admin.service` startet die Abhängigkeiten in der
   Reihenfolge Datenbank → Worker → API → Admin. `Notify=healthy` wartet jeweils
   auf erfolgreiche Healthchecks. Fehlender Login oder fehlende Secrets verhindern
   den Start. Der Teststand wird bewusst nicht automatisch beim Booten gestartet.

Nur die Oberfläche wird auf `127.0.0.1:4177` veröffentlicht. API, Worker und Datenbank
haben keine Hostports. Der separate Caddy-Host kann diesen Loopback-Port noch nicht
erreichen: Die spätere LAN-Bindung und Firewallfreigabe ausschließlich für den Proxy
gehören zur ausstehenden Zugriffsabnahme. Die bereits eingerichtete Adresse
`https://auftragskompass.samuelgesang.de` zeigt am Caddy-Proxy ausschließlich eine
Einrichtungsnachricht mit HTTP 503. Sie leitet noch nicht auf die App weiter.
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

Die Entscheidung über den App-Login ist offen. Aktuell ist nur Google-OIDC
implementiert. Ohne dessen Konfiguration bleiben Verwaltungs-APIs gesperrt;
Passwort- oder Magic-Link-Login sind nicht vorhanden. Vor einer Veröffentlichung
unter einer neuen Subdomain muss der gewählte Login eingerichtet und mit erlaubtem
sowie unerlaubtem Benutzer geprüft werden. Eine vorgeschaltete SSO-Seite ersetzt
keine Anmeldung innerhalb der Anwendung.

Installation, Sicherung und Wiederherstellung: [Betriebsanleitung](operations.md).
Derzeitiger Login: [Google-OIDC](authentication.md).
Die vollständige Betriebsabnahme E005 bleibt offen.

Referenzen: [Docker-Builds in GitHub Actions](https://docs.docker.com/build/ci/github-actions/)
und [GitHub-Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).
