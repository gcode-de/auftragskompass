# E-Mail-Versand: Versandkonto (MAIL-ACCOUNT-01)

Unter **Einstellungen → E-Mail-Versand** (`#settings-mail`) richtet der
Betreiber das Versandkonto für ausgehende E-Mails ein – heute der
Dokumentversand als Anhang und die optionale Benachrichtigung über neue
Website-Anfragen. Das Speichern dieser Einstellungen sendet selbst keine
E-Mail; echter Versand entsteht nur über die jeweils dokumentierte
Versandaktion und die idempotente Outbox (siehe Plan-Einträge MAIL-021-A/B,
MAIL-DOC-01, MAIL-NOTIFY-01).

## Felder

- **Kontoname** – eindeutiger Name je Mandant (wird intern für die Auswahl
  des ersten aktiven Kontos sortiert).
- **Absendername** – Anzeigename im „From“-Header. Zeichen `<`, `>`, `"` und
  `\` sind nicht erlaubt (Header-Injection-Schutz, wird nie „saniert“,
  sondern abgelehnt).
- **Absenderadresse** – die eigentliche Absenderadresse. Ohne eigene
  Nachrichtenadresse greift der Versand auf diese Adresse zurück, sonst auf
  den Benutzernamen.
- **SMTP-Server / SMTP-Port** – Host und Port (1–65535) des Providers oder
  Relays.
- **Transportverschlüsselung**
  – `STARTTLS` (Standard, erzwungenes Upgrade),
  – `SSL/TLS (SMTPS)` (TLS ab Verbindungsaufbau, üblich Port 465),
  – `Ohne` (nur für ein lokales Relay **ohne** Benutzername; mit Benutzername
    verweigern Datenbank-CHECK und Validierung diese Wahl – ein Passwort reist
    nie unverschlüsselt, MAIL-021-B2).
- **Benutzername** – optional (ein Relay ohne Anmeldung bleibt möglich).
- **Passwort** – wird verschlüsselt gespeichert und **nie wieder angezeigt**
  (die API antwortet nur mit `hasSecret`). Beim Bearbeiten gilt: leer lassen =
  gespeichertes Passwort bleibt unverändert; nur ein nichtleeres Passwort
  ersetzt es. Für ein **aktives** Konto ist ein gespeichertes Passwort Pflicht.
- **Konto aktiv** – nur aktive Konten kommen für den Versand in Frage. Ohne
  aktives Konto entsteht bewusst gar kein Versandauftrag (MAIL-NOTIFY-01).

## Secret- und Schlüsselbehandlung

- Das Passwort liegt ausschließlich im AES-256-GCM-Umschlag des Telegram-Musters
  (`mail_accounts.secret_ciphertext/-nonce/-tag`), nie als Klartext.
- Verwendet wird dieselbe Schlüsseldatei wie beim Telegram-Bot:
  **`AK_TELEGRAM_ENCRYPTION_KEY_FILE`** (64 Hex-Zeilenzeichen außerhalb des
  Repos, Zugriffsrechte 600). API und Worker lesen dieselbe Datei.
- **Ohne gültigen Schlüssel ist keine Kontenänderung möglich:** die Routen
  antworten `503 encryption_unavailable`, es wird nichts gespeichert
  (fail closed). Der Zustand ist in den Einstellungen als Fehlermeldung
  sichtbar und im Worker-Log als `mail_outbox_encryption_unavailable`
  (ohne Werte) nachvollziehbar.
- Kein Endpunkt, kein Log und kein Audit-Eintrag enthält das Passwort oder
  den Schlüssel; Kontenantworten sind eine Whitelist (`hasSecret` statt Secret).
  Der Audit-Eintrag `mail.account_saved` nennt nur Aktion, Akteur und Konto-ID.
- **Keine Schlüsselrotation ohne gesonderte Autorisierung:** nach einem
  Schlüsselwechsel sind vorhandene Passwörter nicht mehr entschlüsselbar und
  müssen neu gesetzt werden. Ein Rotationsverfahren ist bewusst nicht
  umgesetzt.

## TLS- und SSRF-Grenzen der Implementierung

- **TLS:** Zertifikatsprüfung wird nirgends abgeschwächt (`rejectUnauthorized`
  bleibt Standard). `starttls` setzt `requireTLS` hart (auch ohne Benutzername),
  `implicit` ist TLS ab dem ersten Byte. Ein Provider ohne TLS scheitert vor
  der Anmeldung, das Passwort verlässt den Client nicht (Leak-Beweis in
  MAIL-021-B2).
- **SSRF:** Der SMTP-Host ist eine Betreiberangabe; der Worker baut die
  Verbindung dorthin (mit festen Timeouts: Verbindung/Gruß je 10 s, Socket
  60 s). Es gibt **bewusst keine Host- oder IP-Allow-Liste**, weil ein
  lokales Relay (z. B. `127.0.0.1:25`) ein dokumentierter Anwendungsfall ist.
  Die bestehende Grenze: ein kompromittiertes Administrationskonto kann
  Verbindungen zu internen Hosts auf dem konfigurierten Port auslösen; alle
  Fehlerantworten werden redigiert (geschlossener Kodesatz, nie Servertexte
  oder Adressen). Eine weitergehende Härtung (Allow-Liste, getrenntes
  Netzwerk) ist eine eigene, bewusste Betriebsentscheidung und hier nicht
  umgesetzt.
- Der Versandpfad sendet nie ungefragt: Outbox-Aufträge entstehen nur durch
  die dokumentierten Aktionen (Dokument senden, Anfragebenachrichtigung),
  doppelte Gesten bleiben über Idempotenzschlüssel wirkungslos.

## Fehlercodes (geschlossen, neutral)

| Code | Bedeutung |
| --- |
| `invalid_account` | Kontoname/Host/Benutzername ungültig |
| `invalid_sender` | Absendername oder -adresse ungültig |
| `invalid_security` | Transportverschlüsselung passt nicht (z. B. „Ohne“ mit Benutzername) |
| `invalid_port` | Port nicht 1–65535 |
| `secret_required` | Aktives Konto ohne gespeichertes Passwort |
| `already_exists` | Kontoname im Mandanten bereits vergeben (409) |
| `encryption_unavailable` | Kein gültiger Schlüssel hinterlegt (503) |

## Was für echten Versand fehlt

Die Oberfläche und die Tests sind vollständig synthetisch; es sind **keine
echten Providerzugangsdaten** hinterlegt (bewusst, siehe GOAL-Auftrag). Für
einen echten Versand werden benötigt: SMTP-Host/-Port des Providers,
Benutzername/Passwort, eine erlaubte Absenderadresse und die passende
Transportverschlüsselung. Bis dahin enden Versandaufträge ehrlich als
`failed`/`provider_missing` oder `provider_auth_failed`, ohne dass eine
Nachricht das Haus verlässt.
