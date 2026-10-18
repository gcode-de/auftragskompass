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
wiederaufnehmbar sein; ein `contact_review` darf nicht automatisch quittiert werden.

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
