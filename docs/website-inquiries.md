# Website-Anfragen für den verkürzten Erststart

## Reihenfolge und Umfang

Der Betreiber zieht das Anfrageformular vor. Angebote und Rechnungen bleiben
zunächst im gewählten LibreOffice-Prozess; dessen Gesamtprobe steht noch aus.
Der erste eigene Formularstand übernimmt alle Felder des aktuellen Formulars
auf [fotobox-bw.de](https://fotobox-bw.de/#kontakt). Später sollen Inhalte
bearbeitbar und mehrere Formularquellen möglich sein. Formular-ID und Version
sind deshalb bereits Teil des Eingangsvertrags; eine Verwaltungsoberfläche
dafür wird nicht als fertig behauptet.

E004.2 ist ausschließlich die geprüfte Felddefinition mit Eingangsvalidierung.
Sie aktiviert weder einen öffentlichen Endpunkt noch Versand, Datenübernahme,
Reservierung oder eine Änderung an WordPress. Bestehende Website und
Bookitup-Empfang bleiben während der Entwicklung unverändert.

## Beobachteter Ausgangsstand vom 18.10.2026

Das öffentliche Formular wurde im echten Browser gelesen, ohne Daten auszufüllen
oder eine Anfrage abzusenden. Maßgeblich sind die sichtbaren Pflichtangaben;
die bisherigen HTML-Inputs tragen selbst kein natives `required`.

| Feld | Pflicht | Neuer stabiler Feldname |
|---|---|---|
| Vorname | ja | `firstName` |
| Nachname | ja | `lastName` |
| E-Mail | ja | `email` |
| Veranstaltungsdatum | ja | `eventDate` |
| Telefonnummer | nein | `phone` |
| Veranstaltungsort | nein | `location` |
| Gewünschtes Fotobox-Paket | nein | `package` |
| Kommentar | nein | `comment` |

Die sichtbaren Paketoptionen und ihre alten Übertragungswerte unterscheiden sich:

| Sichtbare Option | Alter Website-/Bookitup-Wert | Neuer Formwert |
|---|---|---|
| easy digital (Bilder zum Download) | fun-Paket (ohne Ausdruck) | `easy-digital` |
| easy print (zusätzlich 200 Ausdrucke) | comfort-Paket (mit Fotodruck) | `easy-print` |
| easy print+ (400 Ausdrucke, Drucklayout) | full-service (für größere/öffentliche Veranstaltungen und Firmenevents) | `easy-print-plus` |

Diese neuen Werte sind **keine internen Paket-UUIDs**. Ein späterer Adapter
benötigt die bestätigte Zuordnung zu tatsächlich aktiven Paketstammdaten.
Keine Paket-/Preis-/Ressourcenzuordnung wird daraus automatisch angelegt.
Ein nicht gewähltes Paket bleibt leer oder fehlt; es wird kein Paket ergänzt.

Das vorhandene Formular zeigt einen Datenschutzhinweis ohne zusätzliches
Einwilligungs-Kontrollkästchen. Hinweis und Datenschutzlink sind erfasst;
die konkrete Datenschutz-/Einwilligungsgestaltung bleibt vor öffentlichem Betrieb
fachlich zu prüfen. Das ist keine rechtliche Freigabe.

Der vorgelagerte Konfigurator mit Zubehör, Hintergrund und Drucklayout ist ein
eigener Websitebereich. Seine Übertragung in die Anfrage muss zusätzlich vor
Umschaltung geprüft werden; allein die acht Formularfelder belegen das noch nicht.
Weitere auf der Website verlinkte Einstiegsseiten bleiben ebenfalls abzugleichen.

## Versionierter Eingangsvertrag

Die Definition liegt in [inquiry-form.ts](../packages/core/src/inquiry-form.ts).
Der erste Vertrag erwartet `formId: "fotobox-bw-main"`, `formVersion: 1` und
ein Objekt `fields` mit den obigen Namen. Unbekannte Formulare/Versionen,
Zusatzfelder, Status, Mandanten- oder Ressourcenangaben sind nicht zulässig.
Pflichtnamen dürfen nicht leer sein. E-Mail wird als E-Mail geprüft; das Datum
ist ein existierendes ISO-Kalenderdatum `YYYY-MM-DD` mit Jahr 0001–9999.
Die spätere Oberfläche muss die bisherige deutsche Datumseingabe darauf abbilden.

Grenzen: je 100 Zeichen für Vor-/Nachname, 254 für E-Mail, 60 für Telefonnummer,
200 für den freien Veranstaltungsort und 5.000 für Kommentar. Für Telefonnummern
gilt die vorhandene Kontaktprüfung. Optionale Felder dürfen fehlen oder leer sein,
aber keine anderen Typen besitzen. Die Prüfung entfernt, ergänzt oder konvertiert
keine Werte. Texte bleiben untrusted; die spätere Darstellung muss sie als Text
behandeln und vor Übernahme in Rich Text gesondert sicher abbilden.

Ein gültiger Vertrag ist keine Versand-, Buchungs- oder Importfreigabe. Es gibt
hier noch keine Zukunfts-/Verfügbarkeitsprüfung, Spamkontrolle, Empfangsquittierung
oder Wiederholsperre. Dafür folgen getrennte getestete Schritte.

## Nächste technische Schritte

1. Authentifiziertes versioniertes Übergabeprotokoll und persistenter Wiederholschutz
   als fokussierter Teil von C028; lokale Admin-API bleibt getrennt.
2. Geschützter öffentlicher Eingang mit Feldprüfung, Spam-/Größenlimits,
   verschlüsselter begrenzter Zwischenablage und klarer Eingangsbestätigung.
3. Ausgehend aufgebaute Abholung und atomare lokale Kontakt-/Eventanlage mit
   Quellenbezug, Dublettenschutz, sichtbaren Fehlern und Quittierung; keine
   automatische feste Buchung.
4. Responsives Formular mit allen bestehenden Feldern und geprüfter
   WordPress-/Konfigurator-Einbindung. Erst nach synthetischem Gesamtprobelauf,
   Quellenabgleich und Betreiberabnahme umschalten.

Der öffentliche Verfügbarkeitskalender und die spätere Formularverwaltung werden
nicht durch diesen ersten Vertrag als implementiert gewertet.
