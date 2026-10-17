# Anmeldung

C009 führt Google OpenID Connect für die lokale Administration ein. Ohne explizite
Aktivierung bleiben `/auth/*` und `/api/*` gesperrt (503). Es gibt keine offene
Registrierung und keinen Notfall-Login. H005 ergänzt gemäß Nutzerentscheidung einen eigenen Passwortlogin für die Testinstallation. C010 erlaubt ausschließlich
explizit freigegebene Google-Konten. Das erste Konto
wird über lokale Konfiguration festgelegt; weitere Freigaben erfolgen nach Anmeldung
in der Oberfläche.

## Google-Konfiguration

1. Einen Google OAuth-Client vom Typ Webanwendung konfigurieren. Als Redirect exakt
   `https://<administrativer-host>/auth/callback` eintragen; keine Wildcards.
2. TLS vor dem lokalen Admin-Port terminieren. API und Datenbank nicht öffentlich
   freigeben. Der Browser greift auf Oberfläche und API über denselben HTTPS-Origin zu.
3. Externe `.env` anhand `.env.example` konfigurieren: `AK_AUTH_ORIGIN` (nur HTTPS-Origin),
   `AK_TENANT_ID` (Mandanten-UUID), `AK_GOOGLE_CLIENT_ID`, `AK_GOOGLE_SECRET_FILE`.
   Client-Secret in separater Datei außerhalb des Repos mit Modus 600 speichern;
   AK_UID/GID müssen lesenden Zugriff haben. Keine Secrets ins Frontend geben.
4. Beim ersten Start `AK_BOOTSTRAP_EMAIL` auf die genaue Google-E-Mail des Inhabers
   und `AK_TENANT_NAME` auf den Betriebsnamen setzen. Den Platzhalter unbedingt
   ersetzen und die E-Mail vor dem ersten Start prüfen. `AK_TENANT_ID` einmalig als
   eigene UUID erzeugen und anschließend unverändert lassen.
5. Compose mit Zusatzdatei starten:

   ```sh
   docker compose --env-file /external/config/.env -f compose.yaml -f infrastructure/compose.auth.yaml up -d --build --wait
   ```

Bei direktem Node-Start zusätzlich `AK_AUTH_ENABLED=true` setzen. Fehlerhafte
Konfiguration beendet den Start. Google-Discovery und Token-Endpunkt benötigen
Internet; bei Ausfall ist keine neue Anmeldung möglich. Nach erfolgreicher erster
Anmeldung `AK_BOOTSTRAP_EMAIL` aus der externen Konfiguration entfernen.

## Vertrag und Schutzmaßnahmen

- `GET /auth/login`: beginnt einen fünf Minuten gültigen Versuch mit State, Nonce
  und PKCE-S256; Rückrufadresse ist fest konfiguriert. Beliebige Rücksprungziele
  werden ignoriert. Google-Scopes: nur `openid email`.
- `GET /auth/callback`: verbraucht den Versuch atomar und bindet ihn an den
  anfordernden Browser. Signatur, Issuer, Audience, Ablauf, Nonce, State und
  verifizierte E-Mail werden geprüft. Google-Tokens werden nicht gespeichert.
- `GET /auth/me`: 200 mit E-Mail und CSRF-Token oder 401. Keine CORS-Freigabe.
- `POST /auth/logout`: verlangt exakten Origin und `X-CSRF-Token` aus `/auth/me`,
  löscht die serverseitige Sitzung und das Cookie; Erfolg 204.
- Alle `/api/*`-Routen sind automatisch sitzungsgeschützt. Schreibende Methoden
  benötigen ebenfalls Origin und CSRF-Token. Sitzungen laufen nach acht Stunden
  absolut ab; jeder Zugriff prüft die aktive Membership erneut.
- Cookies: `__Host-`-Präfix, Secure, HttpOnly, SameSite=Lax, Path=/, keine Domain.
  State, Browserbindung und Sitzungstokens liegen nur als SHA-256-Hash in PostgreSQL.
  PKCE-Verifier und Nonce werden kurzzeitig im Anmeldeversuch gespeichert.
  Abgelaufene Versuche und Sitzungen werden bei neuer Anmeldung bereinigt.
- Login und Callback sind auf jeweils 20 Anfragen/Minute je Verbindungs-IP begrenzt.
  Hinter dem lokalen Proxy teilen Clients dessen Limit; Forwarded-Header werden
  absichtlich nicht zur IP-Vertrauensentscheidung verwendet. Der MVP betreibt eine API-Instanz.
- Antworten verwenden `no-store` und `no-referrer`; API-Logs enthalten keine
  URLs, Cookies oder Token. Nginx-Zugriffs- und Fehlerlogs sind deaktiviert, weil
  Rückruf-URLs kurzlebige Codes enthalten können. Auch der vorgeschaltete TLS-Proxy
  darf `/auth/*` nicht mit Querystrings oder Cookies protokollieren.
- Die additive Migration `0002_auth.sql` ergänzt mandantengebundene Versuche und
  Sitzungen; bestehende Geschäftsdaten werden nicht verändert.

Tests verwenden einen synthetischen Google-Transport mit signierten Test-JWTs,
echte PostgreSQL-Container und Chromium über lokales Test-HTTPS. Ein Test mit einem
echten Google-Client und dem endgültigen TLS-Host ist vor realer Nutzung erforderlich.

Referenzen: [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect),
[openid-client](https://github.com/panva/openid-client/blob/main/docs/README.md).

## Kontofreigaben (C010)

Der Bootstrap erzeugt genau eine Freigabe und einen dauerhaften Initialisierungsmarker
in derselben Transaktion. Neustarts oder nachträglich geänderte Bootstrap-E-Mails
gewähren keine neuen Rechte und entsperren niemanden. Bei einem schon initialisierten
Mandanten darf die Bootstrap-E-Mail fehlen. Ein neuer Mandant ohne initiale E-Mail
startet mit aktivierter Anmeldung nicht. Bestehende C009-Memberships werden durch die
additive Migration `0003_access.sql` mitsamt Sperren in die Allowlist übernommen.

Bei der ersten Anmeldung muss Google exakt die freigegebene, verifizierte E-Mail
liefern. Danach ist die Freigabe zusätzlich an Googles unveränderliche Subject-ID
gebunden. E-Mail-Aliase werden nicht zusammengeführt. Eine andere Subject-ID kann
kein bereits zugeordnetes Konto übernehmen. Bei geändertem Google-Konto/E-Mail
ist eine bewusst geprüfte Migration erforderlich; es gibt keinen automatischen
Kontenabgleich über die Adresse.

Die Oberfläche zeigt aktive, gesperrte und noch nicht erstmals angemeldete Konten.
Eine Freigabe gewährt vollständigen Administratorzugriff. Sperren widerruft alle
Sitzungen sofort; erneutes Freigeben erfordert eine neue Anmeldung. Der letzte
aktive, bereits angemeldete Administrator kann nicht gesperrt werden. Noch nicht
beanspruchte Freigaben zählen hierbei nicht als Ersatzkonto. Auch parallele Anmeldungen
und Sperren werden durch eine gemeinsame Mandantensperre serialisiert. Datenbanktrigger
schützen zusätzlich vor Deaktivierung des letzten Kontos bzw. seiner Membership.

Die versionierten Verwaltungsrouten nutzen denselben Session-/CSRF-Schutz:

| Route | Ergebnis |
|---|---|
| `GET /api/v1/access` | Freigaben des konfigurierten Mandanten, ohne Google-Subject oder Sitzungstokens |
| `POST /api/v1/access` mit `{ "email": "synthetic@example.invalid" }` | 201 bei neuer Freigabe, 409 bei vorhandenem Konto |
| `PATCH /api/v1/access/:id` mit `{ "active": false }` | 204 bei Sperre/Freigabe, 409 bei letztem Administrator, 404 bei unbekanntem Konto |

Ungültige Eingaben ergeben 400, fehlende Sitzung 401, fehlender CSRF-/Origin-Nachweis
403. Die Änderungsberechtigung wird innerhalb der Transaktion erneut geprüft, falls
der handelnde Administrator zwischenzeitlich gesperrt wurde.

`access_audit` zeichnet Bootstrap, Übernahme bestehender Konten, erste Kontobindung
und Freigabeänderungen atomar auf. Es enthält Mandant, interne Akteur-/Ziel-IDs,
Aktion und UTC-Zeitpunkt, keine E-Mail oder Tokens. UPDATE, DELETE und TRUNCATE werden
abgewiesen. Scheitert das Audit-Schreiben, wird auch die Änderung zurückgerollt.
Das allgemeine Auditlog für Anmeldungen und spätere Fachaktionen folgt in C011.

Der Notfallzugang bleibt vollständig deaktiviert: kein Passwort, kein geheimes
Fallback-Konto und kein Aktivierungsschalter. Bei Verlust des letzten Google-Kontos
ist eine lokal geprüfte Wiederherstellung erforderlich; die Bootstrap-Konfiguration
ist ausdrücklich kein nachträglicher Zugang zum System.

## Allgemeines Auditlog (C011)

Migration `0004_audit.sql` ergänzt `audit_events`. Erfolgreiche Anmeldung und
Abmeldung werden in derselben Transaktion wie die Sitzungsänderung protokolliert.
Abgewiesene Google-Identitäten und ungültige Rückrufe erzeugen neutrale Ereignisse.
Es werden weder E-Mail, IP, User-Agent, Querystrings noch Tokens gespeichert;
Einträge enthalten ausschließlich Mandant, interne Akteur-ID (falls bekannt),
Aktion und UTC-Zeit. `access_audit` bleibt für Freigabeänderungen erhalten.

`GET /api/v1/audit` liefert für angemeldete Administratoren die letzten 100 Ereignisse
des konfigurierten Mandanten, neueste zuerst. IDs werden als dezimale Strings
übertragen, Zeitpunkte als ISO-8601 mit UTC-Kennung. Es gibt keinen öffentlichen
Schreib-, Änderungs- oder Löschendpunkt. PostgreSQL weist UPDATE, DELETE und
TRUNCATE ab; Fremdschlüssel verhindern mandantenfremde Akteurzuordnungen.
Eine fehlgeschlagene Audit-Schreiboperation verhindert eine neue Sitzung bzw.
rollt die Abmeldung zurück. Datenbankadministratoren mit Superuser-Rechten können
Trigger technisch abschalten; das Log ist kein Schutz vor kompromittierten DB-Administratoren.

## Eigener Passwortlogin (H005, Testbetrieb)

`AK_AUTH_ENABLED=true`, `AK_AUTH_MODE=password`, HTTPS-`AK_AUTH_ORIGIN` und
`AK_TENANT_ID` aktivieren den lokalen Login ohne Google-Zugangsdaten. Beide Modi
sind alternativ, nicht parallel aktiv. Der erste Start benötigt zusätzlich
`AK_BOOTSTRAP_EMAIL`, `AK_BOOTSTRAP_USERNAME` (3–64 ASCII-Zeichen, Buchstaben,
Ziffern, Punkt, Unterstrich, Bindestrich) und `AK_BOOTSTRAP_PASSWORD_FILE`.
Die E-Mail gehört zum Konto; angemeldet werden kann mit E-Mail **oder** Benutzername,
unabhängig von Groß-/Kleinschreibung. Kennwörter werden weder getrimmt noch verkürzt.
Mindestens 15 Unicode-Zeichen, maximal 128 UTF-16-Codeeinheiten; zufällig erzeugte
lange Passwörter verwenden. Keine Zugangsdaten in Git, Shell-Argumenten oder Logs.

Die Passwortdatei liegt außerhalb des Repositories mit restriktiven Rechten; unter
Podman als Secret für UID 1000 einbinden. Ein abschließender Dateizeilenumbruch wird
beim Bootstrap entfernt. Nach erfolgreichem Start Bootstrap-Konfiguration und
Passwortdatei entfernen: der dauerhafte `password_bootstrap`-Marker verhindert
Zurücksetzen oder Entsperren durch Neustarts. Ein bestehender Mandant mit bereits angelegten Identitäten wird nicht automatisch
umgestellt; der initiale Passwort-Bootstrap verlangt einen frischen Mandanten. Migration `0019` ergänzt
mandantengebundene Kennwörter/Marker und erlaubt lokale Identitäten ohne Google-ID;
bestehende Google-Zuordnungen bleiben erhalten.

`POST /auth/login` akzeptiert JSON `{ "identifier": "fictional.owner", "password": "…" }`
nur vom exakten konfigurierten Origin (sonst 403), maximal 2 KiB, und liefert 204
mit dem bestehenden sicheren Sitzungscookie. Fehlende, gesperrte, unbekannte oder
falsche Zugangsdaten ergeben einheitlich 401, niemals einen Existenzhinweis. Das
Frontend erkennt den Modus am `X-Auth-Mode`-Header von `/auth/me`; es speichert kein
Passwort. Sitzung, CSRF und Logout gelten wie bei Google.

Hashes: Node-scrypt, N=131072, r=8, p=1, 16 zufällige Salt-Bytes, 64 Hash-Bytes;
[OWASP-Referenz](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
Auch unbekannte Konten durchlaufen scrypt; Parameter sind fest begrenzt.
Je Prozess wird höchstens ein Passwort gleichzeitig geprüft (sonst 429). Zusätzlich
gelten 20 Versuche pro Verbindungs-IP/Minute und nach fünf Fehlversuchen eine
15-minütige Kontosperre in PostgreSQL, gemeinsam für E-Mail und Benutzername.
Sperrversuche verlängern die Sperre nicht. Änderungen, Sperrprüfungen, Sitzungen
und Audit erfolgen unter derselben Mandantensperre wie Kontowiderrufe.

Der Testbetrieb richtet genau ein Inhaberkonto ein. Die Google-Freigabeform wird im
Passwortmodus ausgeblendet und der entsprechende POST-Endpunkt liefert 409.
Weitere Passwortkonten werden bei konkretem Bedarf ergänzt; der Solo-Betrieb nutzt
das eingerichtete Inhaberkonto. Ein Datenbank-Backup enthält Passwort-Hashes und
muss deshalb wie die übrigen vertraulichen Daten geschützt werden.

## Eigenes Passwort ändern (H008)

Lokale Konten können unter Einstellungen ihr Passwort ändern. Das aktuelle Passwort
und zwei übereinstimmende Eingaben des neuen Passworts sind erforderlich. Die
Oberfläche speichert keine Passwörter dauerhaft und löscht ihre Eingaben nach der
Serverantwort oder einem Verbindungsfehler. Nach Erfolg erscheint wieder die
Anmeldung. Alle anderen Sitzungen desselben Kontos sind ebenfalls beendet.

`POST /auth/password` verlangt eine gültige Sitzung, exakten Origin und den
CSRF-Token sowie JSON `{ "currentPassword": "…", "newPassword": "…" }`, maximal 2 KiB.
Das neue Passwort benötigt dieselben 15–128 Zeichen wie beim Bootstrap. Nur der
Sitzungsinhaber wird geändert; es gibt keine wählbare Benutzer- oder Mandanten-ID.
Ohne Sitzung: 401, bei ungültigen Eingaben: 400, bei falschem aktuellem Passwort,
Fehlversuchssperre oder inzwischen entzogenem Zugriff: neutral 403. Erfolg: 204 mit
entferntem Sitzungscookie. Im Google-Modus ist dieser Endpunkt nicht verfügbar (404).

Die Prüfung verwendet dieselbe persistente Fehlversuchssperre wie die Anmeldung.
Auch hier gelten höchstens 20 Anfragen pro IP/Minute und nur eine gleichzeitige
scrypt-Prüfung pro API-Prozess. Kontoberechtigung und Passwort werden innerhalb
derselben Mandantentransaktion geprüft. Neuer Hash, Widerruf aller Kontositzungen
und Audit `password.changed` sind atomar; ein Auditfehler rollt alles zurück.
Ablehnungen werden ohne Passwörter als `password.change_denied` protokolliert.
Migration `0020_password_change.sql` erweitert dafür nur die Audit-Aktionen.

Dies ist ein eigener Passwortwechsel. Die davon getrennte Wiederherstellung ohne
aktuelles Passwort ist ausschließlich dem Betreiber zugänglich (H009). Ein gesperrtes
Konto wird durch den Passwortwechsel nicht reaktiviert.

## Betreiber-Wiederherstellung (H009)

Wenn das aktuelle Passwort verloren ist, kann der vertrauenswürdige Betreiber ein
bestehendes aktives lokales Konto über seinen vorhandenen SSH-/Podman-Zugriff
zurücksetzen. Dies ist kein weiterer Login und kein HTTP-Endpunkt. Die neue
Zugangsinformation wird ausschließlich aus einer privaten UTF-8-Datei gelesen;
niemals ein Passwort als Argument oder Umgebungsvariable übergeben.

### Ablauf auf dem Podman-Host

1. Einen neuen starken Wert im eigenen Passwortmanager erzeugen und in einer
   externen Datei mit Modus 600 ablegen. Sie muss dem ausführenden Betreiber
   gehören, außerhalb jedes Git-Repositories liegen und höchstens 512 Bytes
   enthalten. Ein einzelner abschließender Zeilenumbruch wird entfernt.
2. Mit dem geprüften Skript und einem laufenden API-Image ab H009 ausführen.
   Benutzername und Dateipfad unten sind Platzhalter:

   ```sh
   python3 /etc/auftragskompass-test/reset_password.py --project ak-test --username fictional.owner --password-file /root/private/new-password
   ```

3. Mit dem neuen Passwort anmelden und es im eigenen Passwortmanager sichern.
   Erst danach die vorübergehende Passwortdatei auf dem Server entfernen.
   Alle bisherigen Sitzungen desselben Kontos sind beendet.

Der Befehl benötigt Python und Podman auf dem Host. Er führt einen kurzlebigen
Node-Prozess als bestehender Containerbenutzer im API-Container aus; ein eigener
Node- oder Datenbankclient auf dem Host ist nicht nötig. Die Datenbankverbindung
verwendet die bereits vorhandene Containerkonfiguration und das gemountete
DB-Secret. Das neue Passwort geht über stdin, nicht über Prozessargumente oder
Logs. Der Befehl gibt nur einen festen Erfolgsstatus aus; fremde Prozessdiagnosen
werden nicht durchgereicht. Bei „Result not confirmed“ zuerst den Zustand prüfen,
bevor ein weiterer Reset versucht wird: Die Änderung könnte bereits erfolgt sein.

### Sicherheitsgrenze und Abnahme

- Der Betreiber besitzt bereits Zugriff auf den Podman-Host und damit auf die
  lokale Datenbank. Das Werkzeug setzt diesen Zugriff voraus und erweitert ihn
  nicht um eine öffentliche Wiederherstellungsfunktion.
- Zurückgesetzt wird nur ein bestehender nativer Credential-Datensatz im fest
  konfigurierten Mandanten. Unbekannte Konten, Google-Konten ohne lokales Passwort
  sowie deaktivierte Freigaben oder Memberships werden nicht angelegt oder aktiviert.
- Eine zeitliche Fehlversuchssperre wird beim Setzen des neuen Passworts aufgehoben.
  Passwortregeln und scrypt entsprechen Bootstrap und eigenem Passwortwechsel.
- Dateiinhalt und Dateirechte werden über denselben geöffneten Dateideskriptor
  geprüft; Spezialdateien und Symlink-Austausch werden abgewiesen. Die Eingabe ist
  größenbegrenzt; zu offene Rechte und Dateien in Git sind nicht erlaubt.
- Neuer Hash, Widerruf sämtlicher Kontositzungen und `password.reset` sind unter
  der bestehenden Mandantensperre atomar. Das Audit kennzeichnet den Betreiber
  durch einen leeren Akteur und die Ziel-Benutzer-ID als Datensatzbezug. Ein
  Auditfehler rollt die Änderung zurück; andere Mandanten bleiben unverändert.
- Migration `0021_password_recovery.sql` erweitert nur die Audit-Aktionen. Die
  Berechtigung eines Datenbank-Superusers kann das Audit weiterhin technisch
  umgehen; der Befehl ist kein Schutz gegen einen kompromittierten Betreiber.

Geprüft sind der Dateivertrag und neutrale Ausgaben im Adaptertest sowie aktive,
gesperrte und fremde Konten, Audit-Rollback und gleichnamige Benutzer-IDs in zwei
Mandanten mit PostgreSQL. Zusätzlich wurde das echte Skript auf Podman 5.4.2 gegen
einen frisch gebauten amd64-Teststand ausgeführt: neue Anmeldung, aufgehobene
Fehlversuchssperre, widerrufene alte Sitzung und Betreiber-Audit bestanden. Netzwerk,
Volume, Secret und Container dieses isolierten Probelaufs wurden danach entfernt.
Das echte Inhaberkonto wurde bei dieser Abnahme nicht zurückgesetzt.


## Kodierte Routen und Zugriffsschutz (E005.14)

Die gemeinsame Anmeldung prüft das vom Fastify-Router aufgelöste Routenmuster,
nicht allein den unverarbeiteten URL-Text. Deshalb gelten Sitzungs-, Mandanten-,
CSRF- und Cache-Regeln auch für kodierte statische Pfadsegmente wie `/%61pi/`.
Nicht aufgelöste Pfade behalten die bisherige geschlossene Präfixprüfung.
Die Regression verwendet ausschließlich fiktive Daten und prüft fehlende,
ungültige, fremde sowie gültige Sitzungen und Schreibzugriffe mit und ohne CSRF.
Die vorhandenen anonymen Healthchecks und tokengebundenen Kalenderfeeds behalten
ihre eigenen Zugriffsverträge.
