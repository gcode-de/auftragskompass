# Home-Lab-Testbetrieb

Diese Umgebung dient ersten Bedienungs- und Designtests mit synthetischen Daten.
Sie ist keine Produktivfreigabe und übernimmt keine echten Bookitup-Daten.

## Images über Docker Hub

Ein bestehendes Docker-Hub-Repository mit der gewünschten Sichtbarkeit verwenden.
Der Workflow legt keine Sichtbarkeit fest; Docker Hub kann bei einem Push auf einen
noch nicht existierenden Namen ein Repository anlegen. Deshalb zuerst den Namen
und die Sichtbarkeit auf Docker Hub prüfen.

Unter GitHub **Settings → Secrets and variables → Actions** hinterlegen:

| Art | Name | Inhalt |
|---|---|---|
| Repository-Secret | `DOCKERHUB_TOKEN` | Zugriffstoken mit Schreibrecht für das gewählte Repository |
| Repository-Variable | `DOCKERHUB_USERNAME` | Docker-Hub-Benutzername |
| Repository-Variable | `DOCKERHUB_IMAGE` | Bereits angelegtes `namespace/auftragskompass` ohne Registry, Tag oder Digest |

Keine dieser Einstellungen in eine versionierte Datei schreiben. Den Token nicht
in Chatnachrichten oder Kommandozeilenargumenten übergeben. Auf dem Home-Lab-Host
genügt für private Images ein separater Token mit Leserecht, außerhalb von Git.

Die Veröffentlichung läuft nur nach erfolgreichen Qualitätsprüfungen bei einem
Push auf `main` oder `codex/local-runtime-ci`. Pull Requests veröffentlichen nichts.
Ohne `DOCKERHUB_IMAGE` wird der Veröffentlichungsjob übersprungen; mit gesetztem
Image müssen auch Benutzername und Token vorhanden sein. Nach dem Eintragen der
Einstellungen den vollständigen Quality-Lauf des gewünschten Commits erneut
ausführen oder den nächsten geprüften Commit pushen.

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
