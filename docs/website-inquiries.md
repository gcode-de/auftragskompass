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
200 für den freien Veranstaltungsort und 5.000 für Kommentar. Der zusammengesetzte
getrimmte Kontaktname bleibt auf 200 Unicode-Codepunkte begrenzt. NUL und ungültige
Unicode-Surrogates werden ohne stillen Zeichenersatz abgewiesen. Für Telefonnummern
gilt die vorhandene Kontaktprüfung. Optionale Felder dürfen fehlen oder leer sein,
aber keine anderen Typen besitzen. Die Prüfung entfernt, ergänzt oder konvertiert
keine Werte. Texte bleiben untrusted; die spätere Darstellung muss sie als Text
behandeln und vor Übernahme in Rich Text gesondert sicher abbilden.

Ein gültiger Vertrag ist keine Versand-, Buchungs- oder Importfreigabe. Es gibt
hier noch keine Zukunfts-/Verfügbarkeitsprüfung, Spamkontrolle, Empfangsquittierung
oder Wiederholsperre. Dafür folgen getrennte getestete Schritte.

## Aktivierungsgrenze des automatischen Drains (BKP004.1)

Der automatische Takt startet nur noch mit `AK_INQUIRY_OPTION_DRAIN=on`; ohne
die Variable oder mit `off` bleibt er pausiert (Warnung
`website_option_drain_inactive`, Worker weiterhin bereit), jeder andere Wert ist
ein Konfigurationsfehler. Gateway-Empfang, Staging, Quittung, Sync und die
manuelle Übernahme über `POST /api/v1/website-inquiries/:id/import` sind davon
nicht betroffen. Wertetabelle, Prüfreihenfolge, Rollout-Reihenfolge und die rein
lesenden Zählabfragen für den Rückstand stehen in
[Aktivierungsgrenze und Rollout](website-inquiry-intake.md#aktivierungsgrenze-und-rollout-bkp0041).
Es wurde keine Mengenübersicht echter Eingänge erstellt und kein Drain
aktiviert.

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

Signatur und persistenter technischer Wiederholschutz sind inzwischen im
[Übergabevertrag](gateway-protocol.md) umgesetzt. Der
[verschlüsselte Zwischenspeicher](inquiry-inbox.md) hält die Eingaben einschließlich
des Datenschutzhinweises; eine öffentliche Route oder echte Übernahme ist damit
weiterhin nicht aktiviert.

Die [getrennte API](inquiry-gateway.md) ist mit synthetischem Eingang, signierter
Abholung und Quittierung getestet. Sie läuft noch nicht auf der öffentlichen
Website; lokale Übernahme und öffentlich eingebettete Formularoberfläche bleiben offen.

## Lesende Vorschau (E004.7)

Unter Einstellungen → Website-Formular zeigt die angemeldete Testinstallation
die gemeinsame Definition mit allen acht Feldern. Der Abruf
`GET /api/v1/website-inquiries/form-definition` unterliegt dem vorhandenen
Sitzungsschutz und liefert keine Kundendaten. Es gibt dort keinen POST-Empfang.

„Eingaben prüfen“ verwendet ausschließlich die native Browserprüfung und sendet
oder speichert nichts. Die Vorschau ist keine vollständige serverseitige
Validierung und keine Buchungsprüfung. Verlassen dieses Einstellungsbereichs
verwirft die Eingaben. Änderungen der Formularinhalte und mehrere Formulare
bleiben ausdrücklich als späterer Ausbau vorgesehen (AN-01/AN-04/AN-05); es gibt
noch keinen Formular-Editor und keine automatische Paketzuordnung.

Die [lokale atomare Übernahme](website-inquiry-intake.md) ist als interner Dienst
synthetisch geprüft. Netzwerkabholung, sichtbarer Anfrageeingang und echte
Übernahme sind damit noch nicht aktiviert.

## Option ohne auflösbaren Kontakt (BKP002)

Der automatische Optionpfad (`status: 'option'`, also Drain und manuelle
Wiederholung über `importStagedWebsiteInquiry`) nimmt eine gültige,
authentische Nachricht dauerhaft an und legt genau ein Event im Status `option`
an, auch wenn kein Kontakt aufgelöst werden kann. Der direkte Legacy-Aufruf
(`status: 'inquiry'`, Standard) behält seine strenge Kontaktprüfung samt
`contact_review`.

- Genau ein aktiver privater Exakttreffer (E-Mail und Name) wird zugeordnet.
  Felder und Land des bestehenden Kontakts werden nie überschrieben.
- Ohne Kandidaten entsteht ein neuer privater Kontakt nur, wenn die
  Betreiber-/Deployment-Vorgabe ein Land liefert (`newContactCountry` der
  manuellen Route bzw. `AK_INQUIRY_DEFAULT_CONTACT_COUNTRY`). Das öffentliche
  v1-Eingabeschema bleibt unverändert und hat kein Landfeld; ein `country`-Feld
  in der Eingabe ist ungültig. Es gibt keinen neuen hart kodierten
  Domänen-Default.
- Mehrdeutige, nur archivierte, falsch klassifizierte (Firma/Privat) oder über
  Name, E-Mail oder Telefon kollidierende Kandidaten werden nie geraten oder
  zusammengeführt: Das Event bleibt ohne Kontakt, `website_inquiries.contact_id`
  und der Event-Hauptkontakt sind `null`.
- Original-Payload, Payload-Hash, Receipt, Herkunft (`source`) und der
  Logbucheintrag `website_received` bleiben unverändert. Eine Option reserviert
  keine Ressource, setzt keine Uhrzeit und versendet keine Mail.

Migration `0033_website_inquiry_optional_contact.sql` macht
`website_inquiries.contact_id` nullable. Bestandszeilen bleiben unverändert; der
mandantenbezogene Fremdschlüssel, `UNIQUE(tenant_id, event_id)`, die
Hash-Prüfungen und die Idempotenzregeln bleiben bestehen.

**Rückgabe- und Replayvertrag.** `receiveWebsiteInquiry` und
`importStagedWebsiteInquiry` liefern `contactId` ausdrücklich als
`string | null`; die Import-Route erlaubt `contactId: null` im Response. Eine
Wiederholung derselben ID liefert `duplicate` mit der ursprünglichen `eventId`
und dem ursprünglichen Receipt-Kontakt. Ein anfänglich `null` gespeicherter
Receipt-Kontakt bleibt dauerhaft `null`, auch wenn der Vorgang später am Event
manuell einem Kontakt zugeordnet wird – der aktuelle Kontakt ergibt sich aus der
Eventbeziehung, nicht aus dem Receipt. Ein Replay setzt weder einen inzwischen
manuell geänderten Event-Status noch dessen Kontakt auf `option`/`null` zurück
und schreibt das Receipt nicht neu. Abweichender Inhalt derselben ID bleibt
`conflict`. Die Oberfläche zeigt einen fehlenden Kontakt als ruhigen normalen
Zustand („Kontakt noch offen“), nicht als Fehler.
