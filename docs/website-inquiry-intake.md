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
