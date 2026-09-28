# Google-Anmeldung

C009 führt Google OpenID Connect für die lokale Administration ein. Ohne explizite
Aktivierung bleiben `/auth/*` und `/api/*` gesperrt (503). Es gibt keine offene
Registrierung und keinen Passwort- oder Notfall-Login. C010 erlaubt ausschließlich
explizit freigegebene Google-Konten. Das erste Konto
wird über lokale Konfiguration festgelegt; weitere Freigaben erfolgen nach Anmeldung
in der Oberfläche.

## Konfiguration

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
