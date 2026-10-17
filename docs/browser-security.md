# Browserschutz der Admin-App

E005.15 ergänzt die serverweiten Nginx-Header der vorhandenen Admin-Auslieferung.
Die Richtlinie gilt auch für weitergeleitete API-/Auth-Antworten und Fehlerstatus.
Nginx unterdrückt die gleichlautenden Referrer-/Nosniff-Header des Upstreams und
liefert jede dieser Regeln genau einmal. Direkte API-Antworten behalten ihren
eigenen Schutz. Es sind weder externe Dienste noch neue UI-Abhängigkeiten nötig.

- `Content-Security-Policy`: standardmäßig keine Ressourcen; Skripte, Styles,
  Schriften und API-Verbindungen nur vom eigenen Ursprung. Bilder dürfen vom
  eigenen Ursprung oder als lokale Data-URL stammen. Inline-Skripte und `eval`
  erhalten keine Ausnahme. Objekte, Basis-URL-Änderungen und Einbettung sind
  verboten; Formulare dürfen nur an den eigenen Ursprung senden.
- `frame-ancestors 'none'` und `X-Frame-Options: DENY`: Die Admin-App wird nicht
  in fremde oder eigene Frames eingebettet. Ein späteres WordPress-Widget bleibt
  ein getrenntes öffentliches Produkt und benötigt einen eigenen Vertrag.
- `Referrer-Policy: no-referrer`: Navigation überträgt keine Seitenadresse als
  Referrer. `X-Content-Type-Options: nosniff` bleibt erhalten.

Die Richtlinie ergänzt Escaping, Notiz-Sanitizing, Authentifizierung und CSRF;
sie ersetzt diese Prüfungen nicht. Grundlage sind die
[OWASP-Hinweise zu Content Security Policy](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html).
Dies ist eine lokale Ressourcen-Allowlist, keine Nonce-/Hash-basierte strikte CSP.
Vor neuen externen Diensten, Uploadvorschauen oder eingebetteten Modulen die
benötigten Quellen einzeln prüfen; keine pauschale Inline-/Eval-Freigabe ergänzen.
TLS bleibt Aufgabe der bestehenden Infrastruktur.

## Abnahme

Der Workspace-Test prüft den Nginx-Vertrag. Der echte Compose-Probelauf prüft die
Header auf HTML-, SPA-Fallback- und API-Fehlerantworten. Die HTTPS-Browsertests
übernehmen dieselben Header aus der Nginx-Konfiguration auf die gebaute Admin-App.
Beide Anmeldeverfahren und der gesamte synthetische Geschäftsablauf müssen ohne
CSP-Fehler funktionieren. Abschließend wird ein harmloses fiktives Inline-Skript
gezielt eingefügt: Chromium muss es blockieren und `script-src-elem` melden.
Eine getrennte Testseite versucht zusätzlich, die App als Frame zu laden;
Chromium muss die Einbettung anhand der Antwortheader ablehnen.
Diese Probe verändert weder Produktionsdaten noch den ausgelieferten App-Code.
