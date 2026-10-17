# Kalender abonnieren (C026)

Unter Einstellungen → Kalender abonnieren einen Gesamtfeed oder einen Feed für eine
Ressource erstellen. Der neue HTTPS-Link wird nur einmal angezeigt. Im Kalenderclient
als Kalender-Abo hinzufügen, nicht einmalig als Datei importieren. Das Abrufintervall
bestimmt Apple Kalender, Google Kalender beziehungsweise Outlook; es gibt keinen
Rückkanal und keine sofortige Push-Zusage. Die Prüfung auf dem tatsächlich verwendeten
Smartphone bleibt Bestandteil der Betreiberabnahme vor Bookitup-Abschaltung.

## Inhalt und Aktualisierung

Der Feed enthält datierte Events mit Name, Termin, Status, Ort einschließlich Adresse
und zugewiesenen Ressourceneinheiten. Ohne Uhrzeit wird ein ganzer Kalendertag ausgegeben;
Events ohne Datum können noch nicht im Kalender erscheinen. Zeiten werden in UTC
übertragen. Puffer und Wartungssperren bleiben im internen Dispositionskalender;
der Feed ist keine Verfügbarkeitszusage. Ressourcenfeeds enthalten passende aktive
Zuordnungen und bewahren annullierte beziehungsweise nicht verfügbare Events mit ihrer
früheren Zuordnung, damit der Client die Annullierung erhält.

Beschreibung, Eventart und interner Link sind pro Abo einzeln einschaltbar und anfangs
aus. Kontaktdatensätze, interne HTML-Notizen, Produkte, Preise und Dateien werden nie
exportiert. Ein optionaler interner Eventlink erfordert weiterhin eine App-Anmeldung.

Stabile, mandantenabhängig gehashte UIDs und eine monoton steigende `SEQUENCE` lassen
Änderungen demselben Termin zuordnen. `STATUS:CANCELLED` markiert Annullierungen und
nicht verfügbare Events. Eine Datenbankrevision umfasst auch Änderungen an Orten,
Ressourcen, Einheiten, Reservierungen, Eventarten und Abo-Auswahl; Rollback nimmt sie zurück.
Der Feed wird aus einem konsistenten schreibgeschützten Datenbank-Snapshot gelesen.

Die Ausgabe folgt den hier verwendeten Regeln aus
[RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html): CRLF, Faltung nach höchstens
75 UTF-8-Bytes, maskierte Textwerte, UTC-Zeitpunkte, ganztägige `DATE`-Werte mit
`DURATION:P1D`, UID, Zeitstempel und Revision. Synthetische Parser-/Eigenschaftstests
sowie ein echter HTTPS-/Chromium-Ablauf prüfen Erstellung, Abruf ohne Sitzung,
Erneuerung und Widerruf. Die drei externen Kalenderprodukte wurden nicht angemeldet
oder mit echten Geschäftsdaten befüllt.

## Link ist ein Zugangsschlüssel

Jeder Besitzer des Links kann dessen ausgewählte Termindaten lesen, auch ohne
App-Konto. Nur mit dem gewünschten Kalenderdienst teilen; dieser speichert Daten
außerhalb der App. Nicht in Git, Screenshots, Supportnachrichten oder öffentliche
Protokolle kopieren. Keine Linkvorschau- oder Analysedienste verwenden.

- 256 zufällige Token-Bits, nur SHA-256-Hash in PostgreSQL; kein Klartext in Listen.
- Ein Jahr Gültigkeit. „Link erneuern“ behält Auswahl und Abo-ID und ersetzt den
  Schlüssel atomar; der bisherige Link wird sofort ungültig. Alle bisherigen
  Kalenderclients müssen den neuen Link erhalten.
- „Abo widerrufen“ entfernt die Berechtigung atomar. Bereits beim Client vorhandene
  Kopien können verbleiben und müssen dort separat entfernt werden.
- Der Ersteller muss beim Abruf weiterhin ein aktives freigegebenes Konto mit aktiver
  Membership sein. Unbekannte, fremde, abgelaufene oder widerrufene Tokens liefern
  dieselbe neutrale 404-Antwort; laufende Abrufe können vor dem Widerruf fertig werden.
- Verwaltung verlangt Sitzung und für Änderungen CSRF sowie eine frische
  Berechtigungsprüfung. Erstellung, Erneuerung und Widerruf werden ohne Token auditiert;
  ein Auditfehler rollt die Änderung zurück.
- Der Feed-Endpunkt erlaubt nur GET/HEAD, maximal 60 Abrufe je IP und Minute;
  keine Cookies nötig. `no-store`, `no-referrer`, `nosniff` und `noindex` sind gesetzt.

## Routen und Betrieb

Migration `0022_calendar_feeds.sql` ergänzt mandantengebundene Feeds mit Fremdschlüsseln,
Ablauf und Hashprüfung sowie transaktionale Kalenderrevisionen und Audit-Aktionen.

| Route | Zugriff | Verhalten |
|---|---|---|
| `GET /api/v1/calendar-feeds` | App-Sitzung | aktive Metadaten ohne Schlüssel |
| `POST /api/v1/calendar-feeds` | Sitzung + CSRF | `resourceId` (UUID oder null), `description`, `eventType`, `internalLink` (Bool); einmaliger Link, 201 |
| `PUT /api/v1/calendar-feeds/:id` | Sitzung + CSRF | dieselbe vollständige Auswahl, Schlüssel und Ablauf erneuern, 200 |
| `DELETE /api/v1/calendar-feeds/:id` | Sitzung + CSRF | widerrufen, 204 |
| `GET /feeds/v1/:token.ics` | eigener Bearer-Link + HTTPS | nur ausgewählte ICS-Daten; keine Verwaltungsberechtigung |

Der bestehende TLS-Proxy muss `X-Forwarded-Proto: https` selbst setzen und vom Client
vorgegebene Werte ersetzen. nginx reicht diesen Wert nur für `/feeds/v1/` weiter.
Die API und der HTTP-Upstream dürfen ausschließlich intern erreichbar sein, im Home Lab
nur vom bestehenden Caddy-Host. Ein direkter Feed-Aufruf ohne HTTPS-Proxykennzeichnung
wird mit 403 abgewiesen. Kein Aktivieren von `trustProxy` oder pauschales Öffnen der
Admin-API. Die Konfiguration und Firewall aus [Home Lab](homelab.md) bleiben erforderlich.

Anwendungs- und nginx-Logs enthalten keine URL, Query oder Header. Vor öffentlicher
Nutzung auch bestehende TLS-Proxy-/Cloudflare-Protokollierung auf vertrauliche
Tokenpfade prüfen. Statusfilter und ein separater ausgehender Feed-Abgleich sind
optionaler späterer Ausbau; der lokale Kern liefert die aktuellen Daten direkt.
