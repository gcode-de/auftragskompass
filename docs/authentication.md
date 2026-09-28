# Google-Anmeldung

C009 führt Google OpenID Connect für die lokale Administration ein. Ohne explizite
Aktivierung bleiben `/auth/*` und `/api/*` gesperrt (503). Es gibt keine offene
Registrierung und keinen Passwort- oder Notfall-Login. C009 akzeptiert ausschließlich
bereits provisionierte aktive Administrator-Memberships; C010 ergänzt den sicheren
Erstkonto-Bootstrap und die Freigabeoberfläche.

## Konfiguration

1. Einen Google OAuth-Client vom Typ Webanwendung konfigurieren. Als Redirect exakt
   `https://<administrativer-host>/auth/callback` eintragen; keine Wildcards.
2. TLS vor dem lokalen Admin-Port terminieren. API und Datenbank nicht öffentlich
   freigeben. Der Browser greift auf Oberfläche und API über denselben HTTPS-Origin zu.
3. Externe `.env` anhand `.env.example` konfigurieren: `AK_AUTH_ORIGIN` (nur HTTPS-Origin),
   `AK_TENANT_ID` (Mandanten-UUID), `AK_GOOGLE_CLIENT_ID`, `AK_GOOGLE_SECRET_FILE`.
   Client-Secret in separater Datei außerhalb des Repos mit Modus 600 speichern;
   AK_UID/GID müssen lesenden Zugriff haben. Keine Secrets ins Frontend geben.
4. Compose mit Zusatzdatei starten:

   ```sh
   docker compose --env-file /external/config/.env -f compose.yaml -f infrastructure/compose.auth.yaml up -d --build --wait
   ```

Bei direktem Node-Start zusätzlich `AK_AUTH_ENABLED=true` setzen. Fehlerhafte
Konfiguration beendet den Start. Google-Discovery und Token-Endpunkt benötigen
Internet; bei Ausfall ist keine neue Anmeldung möglich. Der Bootstrap folgt in C010.

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
