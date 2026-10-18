# Getrennte Anfrage-API (E004.6)

[createInquiryGateway](../packages/core/src/inquiry-gateway.ts) erstellt eine eigene
Fastify-Anwendung. Sie wird hier nur mit fiktiven Daten im Integrationstest
betrieben. Die normale Admin-Anwendung registriert diese Routen nicht; es gibt
keine öffentliche Installation, WordPress-Änderung oder Übernahme realer Anfragen.
Die lokale Kontakt-/Eventanlage und die Formularoberfläche folgen getrennt.

## Öffentliche Schnittstelle

| Methode und Pfad                                     | Ergebnis                                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GET /public/v1/forms/fotobox-bw-main`               | Definition mit allen acht bestehenden Feldern, Pflichtangaben, sichtbaren Paketoptionen und Datenschutzhinweis |
| `OPTIONS /public/v1/forms/fotobox-bw-main/inquiries` | Eng begrenzter Preflight für JSON-POST vom erlaubten Origin                                                    |
| `POST /public/v1/forms/fotobox-bw-main/inquiries`    | Nach dauerhafter verschlüsselter Speicherung ausschließlich `202 {"status":"received"}`                        |

Der POST-Body enthält `submissionId` (zufällige öffentliche UUID), `submission`
gemäß [Feldvertrag](website-inquiries.md) und optional `website` als Honeypot.
Die Kennung bleibt bei unverändertem Transport-Retry gleich. Bei geänderten
Formularwerten darf sie nicht unbemerkt wiederverwendet werden. Ein erfolgreicher
Eingang ist **keine Buchungs-, Verfügbarkeits- oder E-Mail-Bestätigung**.
Ein gefüllter Honeypot ergibt dieselbe neutrale Antwort ohne Speicherung.

Es werden nur JSON-POSTs von exakt konfigurierten Browser-Origins angenommen.
Andere oder fehlende Origins werden abgewiesen; Origin-Listen sind kein Ersatz
für Spam-Schutz und keine Serverauthentifizierung. Es gibt keine Cookies oder
Credential-CORS-Freigabe. Öffentliche Antworten enthalten keine Mandanten-IDs,
Schlüssel, internen Paket-UUIDs oder alten Bookitup-Übertragungswerte.

Öffentliche POSTs haben maximal 32.768 Bytes einschließlich äußerem JSON-Body und
10 Versuche pro Minute je Socket-Adresse. Typen werden nicht konvertiert,
unbekannte Felder nicht entfernt und fehlende Werte nicht ergänzt. Ungültige
Kalenderdaten, Unicodezeichen und Formularversionen scheitern vor Speicherung.
Inhaltskonflikte ergeben 409, abgelaufene Wiederholungen 410; volle, beschädigte
oder nicht erreichbare Speicher bestätigen keinen vermeintlichen Eingang.

## Private Übergabe

| Methode und Pfad               | Schutz und Ergebnis                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /sync/v1/inquiries/pull` | Signiertes Paket mit Zweck `inquiries.pull` und Payload `{limit}` (1–100); Antwort ist eine signierte `inquiries.batch`                                                               |
| `POST /sync/v1/inquiries/ack`  | Signiertes Paket mit Zweck `inquiries.ack` und Payload `{inquiryIds}` (höchstens 100 eindeutige UUIDs); atomare Quittierung; signierte Antwort `inquiries.receipt` mit Wirkungszähler |

Beide Wege prüfen den [signierten Vertrag](gateway-protocol.md), konkreten
Mandanten/Zweck, Nachrichten- und Operationsschutz. Browser-Origins werden dort
auch dann abgewiesen, wenn sie öffentlich erlaubt wären. Der Ursprung wird anhand
der vom Router aufgelösten Route getrennt, nicht anhand roher kodierbarer Präfixe.
Die Signatur bleibt in jedem Handler zusätzlich verpflichtend. Ein Transport-Retry
braucht eine frische Nachrichten-ID bei derselben fachlichen Operations-ID.

Abholantworten enthalten im signierten Payload `requestId` als Nachrichten-ID des
konkreten Pull-Versuchs sowie `inquiries`. Quittierungsantworten tragen ebenfalls
`requestId` des konkreten ACK-Versuchs und `acknowledgedCount`. Der lokale Empfänger
muss für beide Antworten Signatur,
Mandant, Rückrichtung, Zweck und diese Korrelation prüfen. Jeder Antwortversuch
erhält eigene Nachrichten-/Operations-IDs; die öffentlichen Anfragekennungen
bleiben für den späteren Schutz vor doppelter Eventanlage stabil.

Der Batch wird vor Signierung auf maximal 50.000 UTF-8-Bytes für die Eintragsliste
begrenzt. Weitere Einträge bleiben unverändert im Speicher. Ein Abholen quittiert
oder löscht nichts. Quittierung und technische Operationsbelege committen gemeinsam;
personenbezogene Antworten werden nicht als Klartext im Wiederholbeleg gespeichert.
Die äußeren signierten POST-Pakete sind auf 132.096 Bytes begrenzt, damit zusätzliche
JSON-String-Escapes den begrenzten inneren Body nicht unkontrolliert vergrößern.
Private Routen haben 60 Versuche je Minute/Socket-Adresse.

## Konfiguration und Betriebsschranken

Der Aufrufer richtet zuerst die separaten Gateway-Migrationen ein und übergibt
Pool, explizite [Speicherkonfiguration](inquiry-inbox.md), Richtungsschlüssel,
aktive Antwort-Schlüssel-ID und Origin-Liste. HTTPS-Origins sind verpflichtend;
HTTP ist ausschließlich für echte Loopback-Entwicklung erlaubt. Schlüssel werden
in ihren vorgesehenen Typen/Laufzeiten geprüft und für die Instanz kopiert.
Pool, Speicher-Mandant und Grenzen bleiben nach Aufbau fest; eine spätere Mutation
der Konfigurationsobjekte darf keine Quittierung in einen anderen Mandanten lenken.
Eine neue Konfiguration benötigt eine neue Instanz.

`GET /health/live` bestätigt nur den Prozess. `GET /health/ready` prüft Datenbank/
Tabellen und gegenwärtig nutzbare Übergabeschlüssel. Es ist **kein Nachweis einer
funktionierenden lokalen Übernahme**. Abgelaufene Schlüssel sperren neue Eingänge,
statt unzustellbare Zusagen zu sammeln. Fehler liefern feste neutrale Codes,
Antworten `no-store`; Request-/Fehlerobjekte und Payloads werden nicht protokolliert.

Diese Instanz vertraut absichtlich keinem weitergereichten Client-IP-Header.
Hinter einem Proxy teilen Anfragen deshalb dessen Socket-Adresse. Vor echtem
Betrieb sind die konkrete Proxy-Vertrauenskette und die Missbrauchsgrenzen zu
prüfen; `trustProxy: true` darf nicht blind eingeschaltet werden. Die In-Memory-
Rate-Grenze ersetzt keinen dauerhaften Wiederholschutz und kein umfassendes
Missbrauchskonzept.

Vor öffentlicher Aktivierung bleiben TLS/Ingress, getrennte Credentials und
Datenbankzugänge, rechtzeitige Ablauf-/Fehlerüberwachung, Backup einschließlich
Schlüsseln, konfigurierte Bereinigung und lokale atomare Übernahme zu prüfen.
Danach folgen Browser-Gesamtprobe, Konfigurator-/WordPress-Abgleich und ausdrückliche
Betreiberabnahme. Es wird kein bestehendes Formular abgeschaltet oder ersetzt.
