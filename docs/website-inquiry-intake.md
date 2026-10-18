# Lokale Anfrageübernahme (E004.8)

`receiveWebsiteInquiry` verarbeitet genau einen zuvor authentifiziert
abzuholenden Eintrag. Der Dienst öffnet selbst keinen HTTP-Endpunkt und startet
keinen Job. Signierte Netzwerkabholung, lokale Fehleranzeige und öffentliche
Aktivierung folgen getrennt. Es werden ausschließlich fiktive Daten getestet.

## Atomare Wirkung

Der Aufrufer übergibt die lokale Mandanten-/Betreiberkennung, den vollständigen
Eintrag und die Prüfzeit. Die bestehende aktive Kontofreigabe wird innerhalb der
Mandantensperre geprüft, auch bei Wiederholungen. Ein eingegangener Eintrag enthält
UUID, unveränderte Empfangs-/Ablaufzeit, versionierte Formulardaten und den damals
angezeigten Datenschutzhinweis samt HTTPS-Link. Zusätzliche Felder, ungültige Daten,
Zeiten, Unicodezeichen und übergroße Inhalte werden neutral abgewiesen.

Kontakt, Event, vollständige Originalangaben, Herkunftsbeleg, Audit und Logbuch
werden gemeinsam committet. Ein Fehler rollt sämtliche Wirkungen einschließlich
verschachtelter Repository-Aufrufe zurück. Die neue vorwärts gerichtete Migration
`0023_website_inquiries.sql` ergänzt nur die lokale Belegtabelle und den
Website-Herkunftseintrag im bestehenden unveränderbaren Eventlogbuch.

Die öffentliche Anfrage-ID ist je Mandant einmalig. Gleicher Inhalt liefert auch
nach Neustart oder Ablauf der Gateway-Aufbewahrung dieselben Zuordnungen zurück;
geänderter Inhalt zu dieser ID scheitert. Objektschlüssel-Reihenfolge ist dabei
unerheblich. Unterschiedliche Anfrage-IDs bleiben unterschiedliche Vorgänge,
selbst bei gleichen Formularwerten. Parallele Eingänge werden mit der vorhandenen
Mandantensperre serialisiert. Fremde Kontakt-/Eventreferenzen verhindern zusätzlich
die SQL-Fremdschlüssel. Eine SQL-Prüfung bindet den Fingerabdruck zusätzlich an
den gespeicherten Originalinhalt; ein versehentlich veränderter Inhalt kann nicht
mit einem unveränderten Empfangsbeleg bestehen bleiben.

## Konservative Zuordnung

- Nur ein einzelner aktiver privater Kontakt mit gleicher normalisierter E-Mail
  und gleichem Namen wird automatisch wiederverwendet. Vorhandene Angaben werden
  nicht überschrieben; die neue Telefonnummer bleibt im Originaleingang erhalten.
- Mehrdeutige Treffer, reine Telefonübereinstimmungen, abweichende Namen,
  Firmenkontakte oder archivierte Treffer ergeben `contact_review`. Es wird weder
  still zusammengeführt noch ein neuer Kontakt daneben angelegt.
- Neue Kontakte benötigen ein ausdrücklich übergebenes `newContactCountry`.
  Ohne Betreiberentscheidung wird kein Land erfunden. Das öffentliche Formular
  kann diese interne Einstellung nicht setzen.
- Das Event startet ausschließlich als `inquiry`, mit dem angegebenen Datum und
  ohne Uhrzeiten, Reservierungen oder feste Buchung. Name aus Vor-/Nachname und
  Formular-ID/Version als Quelle sind nachvollziehbar abgeleitet.
- Veranstaltungsort und Paketwunsch werden als Originalangaben erhalten. Es gibt
  keine automatische Location-/Paket-Stammdatenzuordnung. Kurze Kommentare stehen
  zusätzlich als reiner Text in der Eventbeschreibung; überschreiten sie deren
  Grenze, verweist diese auf die vollständig gespeicherte Originalanfrage.

## Betriebsgrenzen

Die lokale Tabelle gehört zum privaten Core und enthält personenbezogene Daten,
wie die bestehenden Kontakte und Events. Nur berechtigte lokale Dienste dürfen
sie lesen; Sicherungen bleiben verschlüsselt und außerhalb Git. Die
Gateway-Ablaufzeit ist ein Zustelllimit, **keine lokale Löschfrist**. Lokale
Aufbewahrung und spätere datenschutzgerechte Bereinigung bleiben gesondert
festzulegen. Es wird hier kein automatischer Löschprozess eingerichtet.

Ein neuer bereits abgelaufener Eingang wird nicht übernommen. Eine erfolgreich
verarbeitete Wiederholung bleibt dagegen nachweisbar, damit ein späterer
Zustellversuch sicher quittiert werden kann. Quittierung darf erst nach lokalem
Commit erfolgen; dieser Dienst quittiert oder löscht im Gateway selbst nichts.
Fehlertexte enthalten feste Gründe ohne Eingaben, Adressen oder interne Ursachen.
Vor echter Aktivierung müssen ausstehende Prüfentscheidungen sichtbar und
wiederaufnehmbar sein. Seit E004.13 sind vollständig lokal gesicherte Originale
im Prüfbereich sichtbar; deren Transportquittierung ist von der noch offenen
Kontaktzuordnung getrennt. Ein `contact_review` allein ist niemals ein
Zustellnachweis und darf keine Quittierung auslösen.

Der isolierte Compose-Dump-/Restore-Probelauf prüft zusätzlich die vollständige
Originalanfrage, ihren Herkunftseintrag und eine idempotente Wiederholung gegen
die tatsächlich wiederhergestellte Datenbank.

## Originalanfrage in der Eventakte (E004.9)

`GET /api/v1/events/:id/website-inquiry` liefert ausschließlich für den
angemeldeten, weiterhin freigegebenen Betreiber des lokalen Mandanten die acht
beschrifteten Originalwerte, Formularversion, Eingangszeit und den damaligen
Datenschutzhinweis. Fehlende optionale Werte bleiben leer; Paketwerte werden mit
ihrer ursprünglichen Versionsbezeichnung dargestellt. Nicht vorhandene Eingänge
liefern 404, beschädigte gespeicherte Inhalte eine neutrale 503-Antwort.
Antworten sind mit `no-store` gekennzeichnet und enthalten keine internen
Kontaktkennungen oder Fingerabdrücke.

Die Eventdetailantwort enthält `websiteInquiryAvailable`. Nur bei vorhandenem
Eingang erscheint in der Übersicht die zunächst geschlossene „Originalanfrage
der Website“. Erst ihr Öffnen lädt die Daten. Ladefehler bieten einen erneuten
Abruf; erfolgreich geladene Angaben bleiben innerhalb dieser Eventansicht
verfügbar. Spätere Kontakt- oder Eventänderungen verändern diese Anzeige nicht.
Kommentare erscheinen vollständig als Text, einschließlich Zeilenumbrüchen und
HTML-Zeichen. Die Darstellung ist in mobilem und breitem Hell/Dunkel geprüft.
Es gibt hier keine Bearbeitung oder öffentliche Aktivierung.

## Dauerhafter lokaler Eingang vor Zuordnung (E004.10)

`stageWebsiteInquiry` sichert einen zuvor authentifiziert abgeholten Originaleintrag
in `website_inquiry_deliveries`, ohne Kontakt, Event oder Reservierung anzulegen.
Der ausschließlich intern aufrufbare Dienst prüft vollständigen Inhalt,
Mandant und aktive Betreiberberechtigung. Neue Einträge müssen noch innerhalb
ihrer Gateway-Laufzeit liegen; ein zu weit in der Zukunft liegender Eingang wird
abgelehnt. Die Prüfzeit wird beim Aufruf eingefroren und zusammen mit der
Betreiberkennung gespeichert. Migration `0024_website_inquiry_deliveries.sql`
sichert Zuordnung, Inhaltshash und Zeitgrenzen zusätzlich in PostgreSQL ab.

Identische Wiederholungen, auch parallel oder nach Pool-Neustart, verändern den
Originalbeleg und seine erste lokale Eingangszeit nicht. Bereits gesicherte
Einträge bleiben nach Gateway-Ablauf erhalten und als identische Wiederholung
erkennbar; abweichender Inhalt derselben Anfrage-ID scheitert. Ein äußerer
Transaktionsfehler rollt auch diesen Eingang vollständig zurück. Der echte
Dump-/Restore-Probelauf erhält einen noch nicht fachlich zugeordneten Eingang
und prüft seine Wiederholung nach Ablauf.

Diese private Zwischensicherung erlaubt später eine Kontaktprüfung ohne Verlust
des Originals. Sie führt selbst keine Quittierung, automatische Eventanlage,
Netzwerkabholung oder Löschung aus. Signierte Zustellung, sichtbare Prüfliste und
wiederanlaufbare Quittierung folgen getrennt vor öffentlicher Aktivierung.
Die lokale Aufbewahrungsentscheidung bleibt offen; die Gateway-Ablaufzeit löscht
diesen privaten Eingang nicht.

## Signierte Batch-Zustellung (E004.11)

`receiveWebsiteInquiryBatch` verbindet den bestehenden Signatur-/Replay-Vertrag
mit der lokalen Zwischensicherung. Der lokale Aufrufer muss die Nachrichten-ID
seines eigenen Pull-Aufrufs als `requestId` übergeben. Nur dazu passende,
zeitlich gültige `gateway-to-core`-Antworten mit Zweck `inquiries.batch` werden
angenommen. Batch und einzelne Originaleinträge sind strikt geprüft: höchstens
100 unterschiedliche Anfrage-IDs und höchstens 50.000 UTF-8-Bytes im Array.
Signatur und Payload werden vor Datenbankwirkungen geprüft; Schlüssel, Paket und
Prüfzeit können während Datenbankwartezeiten nicht nachträglich geändert werden.

Aktive Betreiberfreigabe, vollständiger Batch, Nonce und Operationsbeleg committen
zusammen. Auch Wiederholungen mit bereits vorhandenem Operationsbeleg prüfen
die Berechtigung erneut. Identische Nachrichten sind Replay; derselbe Vorgang
mit frischer Nachricht ist eine Wiederholung mit gespeichertem Zähler.
Abweichende Inhalte derselben Operations-ID scheitern. Ein einzelner neuer
abgelaufener oder widersprüchlicher Eingang rollt den gesamten Batch zurück,
einschließlich aller Transportbelege. Technische Zähler bestätigen nur lokal
vorhandene Originaleingänge, keine Kontaktzuordnung oder Buchung.

Der private Synchronisationsstart muss zusätzlich zu `migrate` einmalig
`migrateGateway` gegen die **lokale** Datenbank ausführen, bevor er den Dienst
verwendet. Dies installiert die vorhandenen technischen Replay-/Operations-
Tabellen über denselben Prüfsummenlauf; die dabei angelegte verschlüsselte
Gateway-Inboxtabelle wird lokal nicht verwendet. Die getrennte öffentliche
Gateway-Datenbank erhält weiterhin ausschließlich `migrateGateway`, niemals
Core-Migrationen oder Zugang zur lokalen Datenbank. Keine Initialisierung wird
hier automatisch beim App-Start aktiviert.

Ein Integrationstest führt das echte Gateway mit eigener Datenbank durch:
öffentlicher synthetischer Eingang → signierter Pull → lokale Batch-Prüfung →
dauerhafte Originalablage. Der Gateway-Eingang bleibt danach absichtlich
unquittiert. Netzwerktransport, persistente Quittierungs-Outbox und sichtbare
Bearbeitung ausstehender Eingänge bleiben nächste Schritte vor Freischaltung.

## Weiterbearbeitung des lokalen Eingangs (E004.12)

`importStagedWebsiteInquiry` liest einen bereits gesicherten Eingang im eigenen
Mandanten und prüft die aktive Betreiberfreigabe erneut. Original-ID und
Empfangs-/Ablaufzeiten müssen mit den gespeicherten Metadaten übereinstimmen;
beschädigte Inhalte werden nicht als Event weiterverarbeitet. Die bestehende
atomare Übernahme verwendet den dokumentierten ersten lokalen Prüfzeitpunkt.
Damit verhindert ein inzwischen abgelaufener Gateway-Termin keine spätere
Kontaktprüfung. Die ursprüngliche Frist wird weder verschoben noch neu erfunden.

Neue Kontakte benötigen weiterhin das ausdrücklich übergebene Land; bei exaktem
bestehendem Kontakt ist kein Land erforderlich. Unklare Zuordnungen scheitern
mit `contact_review`, ohne Teilanlage oder Veränderung des gesicherten Originals.
Eine spätere Wiederholung kann nach Klärung erneut ausgeführt werden. Parallele
Verarbeitung und Wiederanlauf ergeben dasselbe Event mit demselben Kontakt.
Die ursprüngliche Ablage bleibt erhalten; dieser Dienst quittiert nicht im
Gateway und wird noch nicht automatisch oder per HTTP ausgelöst.

## Sichtbare Prüfung und manuelle Übernahme (E004.13)

Im bestehenden Eventbereich steht der zunächst geschlossene Bereich
„Website-Eingänge prüfen“. Erst beim Öffnen lädt er offene lokale Eingänge.
Jeder Eintrag lässt sich einzeln mit seinen acht Originalangaben und dem damaligen
Datenschutzhinweis öffnen. Das Länderfeld bleibt leer: nur für einen neu
anzulegenden Kontakt muss der Betreiber ausdrücklich einen zweistelligen Code
angeben. Eine bewusste Übernahme erzeugt ausschließlich eine unverbindliche
Anfrage. Vorhandene Kontakte werden nicht überschrieben und Ressourcen nicht
reserviert. Nicht auflösbare Zuordnungen bleiben unverändert gespeichert und
können nach Prüfung erneut versucht werden. Erfolg wird erst nach bestätigter
Antwort angezeigt; ein anschließender Listenfehler behauptet keinen Rollback.

- `GET /api/v1/website-inquiries?offset=0` liefert ausschließlich im eigenen
  Mandanten noch nicht fachlich übernommene Originale, insgesamt gezählt und mit
  je 25 Einträgen nach lokalem Eingang/ID sortiert. Ein durch parallele Bearbeitung
  zu großer Offset wird auf die letzte vorhandene Seite begrenzt. `no-store`,
  aktuelle Betreiberberechtigung und strikte Queryprüfung sind verpflichtend.
- `POST /api/v1/website-inquiries/:id/import` erwartet ein JSON-Objekt mit optionalem
  `newContactCountry` (zwei Großbuchstaben). Die echte API verlangt Sitzung,
  korrekten Origin und CSRF. Zusätzliche Felder werden abgewiesen. Gleiche
  Wiederholung liefert dieselbe Event-/Kontaktzuordnung; ein Zuordnungskonflikt
  bleibt als `contact_review` sichtbar. Unbekannte IDs liefern 404 und
  Speicherfehler eine neutrale 503-Antwort.

Die Darstellung übernimmt die vorhandenen nativen Disclosure-, Formular- und
Definitionlistenmuster. Ein älterer Listenabruf darf einen bereits übernommenen
Eintrag nach neuerem Abruf nicht wieder einblenden. Browserprüfungen umfassen
leeres Land, korrigierbaren Fehler, echte API-Übernahme, aktualisierte Eventliste
und Originalangaben in der Eventakte. Hell/Dunkel werden bei 1280 und 390 Pixeln
mit synthetischen Daten und axe geprüft. Die Website selbst ist weiterhin nicht
an diesen lokalen Prüfbereich angeschlossen.

## Ausgehende HTTPS-Abholung (E004.14)

`pullWebsiteInquiries` ruft ausschließlich den festen Pfad
`/sync/v1/inquiries/pull` eines ausdrücklich konfigurierten HTTPS-Origins auf.
URL-Zugangsdaten, fremde Pfade, Querys und Fragmente sind unzulässig. Vor dem
Netzwerkaufruf wird die lokale Betreiberberechtigung geprüft. Jede reine Abholung
bekommt frische Nachrichten-/Operations-IDs und fordert höchstens 100 Eingänge an.
Cookies werden nicht gesendet; Redirects sind verboten. Ziel, Signaturpaket und
Prüfschlüssel werden vor der ersten Wartezeit eingefroren.

Der Abruf verwendet ein festes Zehn-Sekunden-Abbruchsignal für Fetch und Body.
Nur HTTP 200 mit JSON-Inhalt wird verarbeitet. Sowohl angekündigte als auch
wirklich gelesene Antwortbytes sind auf 132.096 begrenzt; Streams werden nach
Abschluss oder Fehler geschlossen. Ungültiges UTF-8 oder JSON und interne
Transportfehler führen zu neutralen Fehlern ohne Eingangsdaten, URLs oder
Schlüssel in Fehlermeldungen. Anschließend prüft der bestehende Batch-Dienst
Signatur, Bezug zum eigenen Pull-Aufruf und aktuelle Zeit nochmals, bevor er
Originale atomar lokal sichert. Eine während des Abrufs abgelaufene Signatur wird
nicht mit der alten Startzeit akzeptiert.

Tests decken signierte Requests/Antworten, echte Gateway-Routen über einen
synthetischen Fetch-Adapter, Rechteprüfung, kaputte/übergroße Streams,
Abbruchsignal, falsch zugeordnete Antworten, Zeitablauf und Wiederholung ab.
Eine öffentliche HTTPS-Installation ist hier noch nicht getestet oder verbunden.
Der Dienst startet keinen Worker und quittiert keine Eingänge. Wiederholtes
Abholen ist lesend und kann bereits gesicherte Originale nicht duplizieren;
Quittierungen benötigen weiterhin eine persistente Outbox und einen eigenen
signierten Empfangsbeleg.

## Dauerhafte Quittierungs-Outbox (E004.15)

Migration `0025_website_inquiry_acknowledgements.sql` ergänzt getrennte Operationen,
Original-Zuordnungen und Versandversuche. `prepareWebsiteInquiryAcknowledgement`
prüft erneut den aktiven Betreiber und erstellt je Mandant höchstens eine offene
Operation mit maximal 100 **bereits vollständig lokal gesicherten** Eingängen.
Fremdschlüssel verhindern die Zuordnung unbekannter oder fremder Originale;
Eindeutigkeit verhindert eine zweite Operation für denselben Eingang. Sortierte
IDs und Operations-ID bleiben bei Wiederholung, Parallelität und Neustart gleich.
Jeder Versuch erhält vor einem späteren Versand eine neue persistente Nachrichten-ID.
Neue Originale warten auf die nächste Operation, statt einen laufenden Batch zu ändern.

`receiveWebsiteInquiryAcknowledgement` akzeptiert ausschließlich zeitgültige,
signierte `inquiries.receipt`-Pakete. Der Bezug muss zu einem dauerhaft gespeicherten
eigenen Versuch gehören; der Zähler muss zwischen null und dessen Batchgröße liegen.
Null ist nach zwischenzeitlichem Gateway-Ablauf zulässig: Die Originale sind bereits
lokal vollständig vorhanden. Fehlende, unpassende, fremde oder ungültige Belege
schließen keine Operation ab. Technischer Replay-Beleg und Abschluss werden atomar
geschrieben. Ein verspäteter Beleg kann niemals eine neuere Operation abschließen.
Lokale Originale bleiben einschließlich ungeklärter Kontaktzuordnung erhalten.

Der Dienst führt keinen HTTP-Aufruf aus und ist noch nicht automatisch aktiviert.
Der Sender muss einen vorbereiteten Versuch **erst nach Commit** versenden; nach
verlorener Antwort wird dieselbe Operation mit frischer Versuch-ID erneut gesendet.
Migration ist rein additiv. Bestehender Backup-/Restore-Probelauf prüft nun auch den
offenen Quittierungsauftrag samt unveränderter Originalzuordnung und erneutem Versuch.
Aufbewahrung/Bereinigung technischer Belege bleibt vor öffentlichem Dauerbetrieb
festzulegen; hier werden keine Daten automatisch entfernt.
