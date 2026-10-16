# Lastenheft: Eigene Fotobox-Verwaltung – fokussierter MVP

**Dokumentstatus:** Arbeitsentwurf v0.6
**Stand:** 18.09.2026
**Grundlage:** öffentliche Dokumentation von bookitup und kreativ.management plus rein lesender Abgleich des angemeldeten bookitup-Kontos
**Leitlinie:** In den MVP kommen die heute genutzten Funktionen sowie die ausdrücklich gewünschten Erweiterungen für Ressourcen, Online-Verträge, Kundenfragebögen, öffentliche Verfügbarkeit, To-dos und Absagegründe.

**Vorrangige Lieferentscheidung vom 16.10.2026:** Der
[Bookitup-Ausstiegsplan](docs/bookitup-exit.md) definiert einen kleineren Erststart
mit vorgezogener Sicherung/Migration/Betriebsabnahme. M5/M6 und bei geprüften
Ersatzprozessen M2/M3/M4 folgen später. Der Vollumfang unten bleibt Ausbauziel.
Historische Daten dürfen für diesen Ausstieg nicht mehr ausschließlich im
Altsystem verbleiben; Sicherung und operativer Datenbankimport sind getrennt.

## 1. Ziel

Es soll eine schnelle, übersichtliche Webanwendung entstehen, mit der ein einzelner Fotobox-Anbieter Anfragen, Kunden, Aufträge, E-Mails, Angebote und Rechnungen ohne parallele Listen verwalten kann.

Der vollständige MVP nach M7 soll den heute tatsächlich gelebten Ablauf ersetzen. M1 ist zuvor nur eine interne Dispositionsstufe und ersetzt bookitup noch nicht. Die verbindliche Lieferreihenfolge steht im [Implementierungsplan](IMPLEMENTATION_PLAN.md); fachliche Präzisierungen stehen in [docs/decisions.md](docs/decisions.md).

Der vollständige Zielablauf:

1. Eine Anfrage kommt über die Website oder wird manuell erfasst.
2. Das System legt Kontakt und Event an.
3. Verfügbarkeit, Eventdaten, Fotobox-Paket, konkrete Fotobox, Ort und Notizen werden gepflegt.
4. Die Kommunikation läuft aus einem gemeinsamen Postfach mit Vorlagen.
5. Aus Produkt- und Dokumentvorlagen entstehen Angebot und später Rechnung.
6. Der Kunde kann einen Vertrag und einen Fotobox-Fragebogen über sichere Links ausfüllen und den Vertrag unterschreiben.
7. Statusänderungen und wichtige Vorgänge bleiben im Logbuch nachvollziehbar.

Die Anwendung soll bewusst keine Kopie der bookitup-Oberfläche werden. Fachliche Abläufe und vorhandene Daten werden übernommen; Gestaltung, Navigation und technische Umsetzung werden eigenständig entwickelt.

## 2. Ergebnis der Bestandsaufnahme

Die Einstufung beruht auf sichtbaren Daten, Einstellungen und Vorlagen. Sie ist keine technische Nutzungsstatistik von bookitup.

### 2.1 Stark genutzt oder eindeutig produktiv konfiguriert

| Bereich | Beobachtung im Konto | Konsequenz |
|---|---|---|
| Events/Aufträge | Viele bestehende und zukünftige Events; Listenansicht mit Status-, Zeitraum- und Artfiltern | MUSS in den MVP |
| Kontakte | 226 Kontakte vorhanden | MUSS inklusive Migration |
| Zentrales Postfach | Produktiv verbundenes Postfach; 247 als unerledigt markierte Nachrichten | MUSS für den laufenden Betrieb; historische Kommunikation wird bewusst nicht migriert |
| Website-Anfragen | Vier aktive Website-/Formular-Verbindungen; Eventanlage aus Formular im Logbuch sichtbar | MUSS |
| E-Mail-Vorlagen | Elf individuell bearbeitete Vorlagen für Anfrage, Angebot, Buchung, Rechnung und Storno | MUSS |
| SMTP und Signatur | Eigener Ausgangsserver und Signatur sind eingerichtet | MUSS |
| Eventarten | Sieben eigene Auftrags-/Eventarten sind eingerichtet | MUSS |
| Eigenes Feld | Ein aktiv genutztes Auswahlfeld für Fotobox-Pakete | MUSS, zunächst als strukturierte Paketauswahl |
| Produkte | Umfangreicher Produktkatalog mit Fotobox-Paketen, Druck, Layout, Hintergrund, Lieferung und Zusatzleistungen | MUSS |
| Dokumentvorlagen | Mehrere Angebots-, Auftragsbestätigungs-, Rechnungs-, Anzahlungs- und Korrekturvorlagen | MUSS |
| Rechnungen/Nummernkreise | Produktiv fortgeführte Angebots-, Rechnungs- und Stornonummern | MUSS, migrationssicher |
| Dokumentgestaltung | Logo, Schrift, Farben, Absender-/Empfängerlogik und Seitendarstellung sind konfiguriert | MUSS für PDFs |
| Dateiablage | Acht wiederverwendbare Profil-Dateien, vor allem Layoutbeispiele, Hintergrundübersicht und Aufbaudokumente | MUSS als kleine Vorlagen-/Anhangsbibliothek |

### 2.2 Ausdrücklich gewünschte neue Kernfunktion

| Bereich | Ausgangslage | Konsequenz |
|---|---|---|
| Ressourcenplanung | Das Bookitup-Ressourcenmodul ist im Konto nicht aktiviert. Tatsächlich werden jedoch zwei Fotoboxen vermietet und müssen getrennt disponiert werden. | MUSS in den MVP: zwei einzeln identifizierbare Boxen, Reservierungen, Verfügbarkeitsprüfung und Doppelbuchungsschutz |
| Online-Verträge | Ausfüllbare, digital unterschreibbare Verträge aus kreativ.management werden als besonders nützlich bewertet | MUSS als optionaler Buchungsweg pro Event |
| Fotobox-Fragebögen | Strukturierte Kundendaten zu Layout, Aufbau und Durchführung sollen nicht mehr per Freitext gesammelt werden | MUSS als separates Online-Formular |
| WordPress-Verfügbarkeitskalender | Öffentliche, automatisch aktualisierte und markengerechte Verfügbarkeitsanzeige ist gewünscht | MUSS als sicher einbettbares Widget |
| To-do-Vorlagen | Wiederkehrende Arbeitsschritte sollen relativ zum Eventtermin geplant werden | MUSS als schlankes Aufgabenmodul |
| Absagegründe | Gründe für verlorene Anfragen sollen strukturiert erfasst werden | MUSS einschließlich einfacher Auswertung |

### 2.3 Nur leicht genutzt oder teilweise konfiguriert

| Bereich | Beobachtung | Entscheidung für den MVP |
|---|---|---|
| Aufgaben | In bookitup bislang kaum genutzt; für den Zielprozess werden ausdrücklich To-do-Vorlagen mit relativen Terminen gewünscht | Schlankes eventbezogenes Aufgabenmodul wird Bestandteil des MVP |
| Automationen | Zwei Standard-Erinnerungen sind aktiv: unbeantwortete neue Anfrage und ausbleibende Kundenreaktion | Als zwei feste Regeln umsetzen, noch kein Workflow-Builder |
| Kalender | Interne Eventübersicht vorhanden; das bestehende Kalender-Abo wird produktiv genutzt | Interner Kalender und abonnierbare ICS-Ausgabe sind MUSS |
| Event-Dateien | Datei-Reiter vorhanden, in der geprüften Eventakte aber leer | Einfacher Upload SOLL, ohne aufwendiges Freigabesystem |

### 2.4 Derzeit nicht genutzt oder nicht eingerichtet

Diese Bereiche gehören ausdrücklich **nicht** zum ersten MVP:

- umfassende Lagerverwaltung mit Cases, Wartungsaufträgen und Einkaufswesen; die schlanke Ressourcenplanung für zwei Fotoboxen ist dagegen Bestandteil des MVP
- Teamzugänge, Rollenverwaltung und Mitarbeiterkalender
- umfassendes Statistik-/Controlling-Modul; die einfache Auswertung der Absagegründe ist dagegen Bestandteil des MVP
- Kontaktgruppen
- eigene Statusmodelle; genutzt werden die vorhandenen Standardstatus
- Google Contacts, Google Tasks und eine direkte Google-Calendar-API; die genutzte ICS-Kalenderausgabe ist dagegen Bestandteil des MVP
- Einlesen externer Kalender zur Verfügbarkeitsprüfung
- Buchhaltungsintegration
- Dienstleister-Netzwerk und Agenturmodus
- frei konfigurierbare Workflows
- vollständiges Kundenportal mit Dokumentarchiv, Zahlungen und frei konfigurierbaren Freigaben; sichere Einzellinks für Vertrag und Fragebogen sind dagegen Bestandteil des MVP
- Mahn- und Gutschriftvorlagen
- PayPal-/SEPA-QR-Codes auf Rechnungen

Die Architektur soll eine spätere Ergänzung erlauben, diese Module werden aber weder fachlich ausgebaut noch für den MVP implementiert.

## 3. Nutzer und Systemgrenzen

### 3.1 Primärer Nutzer

Der MVP ist ein **Solo-System für den Inhaber**. Der Zugriff erfolgt über Google-SSO; nur ausdrücklich freigegebene Google-Konten dürfen sich anmelden. Ein späteres Team- und Rechtemodell wird nicht vorweggenommen.

### 3.2 Systemgrenzen

Zum MVP gehören:

- browserbasierte interne Verwaltungsoberfläche,
- öffentliches Anfrageformular beziehungsweise Formular-Endpunkt,
- öffentliches, in WordPress einbettbares Verfügbarkeits- und Anfrage-Widget,
- öffentliche, token-geschützte Vertrags- und Fragebogenseiten,
- Versand und Empfang von E-Mails,
- PDF-Erstellung,
- Dateiablage,
- abonnierbare ICS-Kalenderausgabe,
- Import der benötigten Bestandsdaten aus bookitup,
- lokaler Eigenbetrieb auf eigener Infrastruktur.

Nicht zum MVP gehören Fotobox-Aufnahmesoftware, Druckersteuerung, Bildbearbeitung, Online-Galerien und Hosting von Kundenfotos.

## 4. Zentrale Datenobjekte

- **Kontakt:** Privatperson oder Firma mit Ansprechpartner und Kommunikationsdaten
- **Event/Auftrag:** Anfrage oder Buchung mit Status, Art, Zeit, Ort, Paket und Notizen
- **Location:** wiederverwendbarer Veranstaltungsort
- **Eventart:** eine der sieben konfigurierbaren Kategorien
- **Fotobox-Paket:** strukturierte Auswahl, die das heutige eigene Feld ersetzt
- **Ressource:** eine konkrete, einzeln buchbare Fotobox oder ein knappes Zubehör; anfängliche Boxbezeichnungen sind voraussichtlich „FB1“ und „FB2“
- **Ressourcenreservierung:** zeitlich begrenzte Zuordnung einer Ressource zu einem Event
- **Zubehörbestand:** optional mengenmäßig geführtes, gemeinsam genutztes Zubehör
- **Produkt:** verkaufbare Position mit Beschreibung, Preis, Einheit und Steuersatz
- **E-Mail:** eingehend, ausgehend, Entwurf oder geplant; Kontakt/Event zuordenbar
- **E-Mail-Vorlage:** Betreff, Inhalt, Platzhalter und Standardanhänge
- **Dokumentvorlage:** wiederverwendbare Positionen und Texte für eine Dokumentart
- **Geschäftsdokument:** Angebot, Auftragsbestätigung, Anzahlungsrechnung, Rechnung oder Rechnungskorrektur
- **Vertragsvorlage:** konfigurierbarer Vertragstext mit Datenfeldern, Bestätigungen und Unterschrift
- **Online-Vertrag:** eventbezogene, versionierte und vom Kunden ausfüllbare Vertragsinstanz
- **Formularvorlage:** wiederverwendbarer Aufbau eines Fotobox-Fragebogens
- **Formularantwort:** gespeicherte, eventbezogene Kundenangaben einschließlich Uploads
- **Öffentliches Verfügbarkeitsprofil:** Regeln, Gestaltung und Freigaben für das WordPress-Widget
- **Zahlung:** Zahlungseingang zu einer Rechnung
- **Datei:** wiederverwendbarer Standardanhang oder eventbezogene Datei
- **Erinnerung:** automatisch erzeugter Nachfasshinweis
- **Aufgabenvorlage:** wiederverwendbare To-dos mit relativem Fälligkeitszeitpunkt
- **Aufgabe:** konkrete, eventbezogene Arbeit mit Status und Fälligkeit
- **Absagegrund:** konfigurierbare Kategorie für verlorene oder annullierte Anfragen
- **Logbucheintrag:** unveränderbarer fachlicher Verlauf eines Events

## 5. Statusmodell

Für den MVP werden die heute verwendeten Standardstatus übernommen:

1. Anfrage
2. Option
3. Gebucht
4. Nicht verfügbar
5. Annulliert

„Gebucht“ ist die verbindliche Bezeichnung für einen bestätigten Auftrag. Eigene frei definierbare Status sind nicht Bestandteil des MVP.

## 6. Funktionale Anforderungen

Prioritäten:

- **MUSS:** notwendig, um bookitup im heutigen Arbeitsablauf zu ersetzen
- **SOLL:** sinnvoll im ersten Produktivbetrieb, kann notfalls kurz danach folgen
- **KANN:** Komfortfunktion ohne Blockadewirkung

### 6.1 Anmeldung und Grundsystem

**SYS-01 MUSS:** Das System muss die Anmeldung über Google-SSO auf Basis von OAuth 2.0/OpenID Connect unterstützen.
**SYS-02 MUSS:** Es muss eine zentrale, schnelle Navigation zu Events, Ressourcen, Postfach, Kontakten, Dokumenten, Produkten, Dateien und Einstellungen geben.
**SYS-03 MUSS:** Globale Suche und Listen dürfen bei mehreren hundert Kontakten und Events nicht spürbar stocken.
**SYS-04 MUSS:** Datum, Uhrzeit, Währung und Zahlenformat müssen für Deutschland konfiguriert sein.
**SYS-05 SOLL:** Die Anwendung soll auf Desktop, Tablet und Smartphone benutzbar sein.
**SYS-06 MUSS:** Eine Administrationsoberfläche muss festlegen, welche Google-Konten zugriffsberechtigt sind.
**SYS-07 MUSS:** Geschäftsdaten, Eventarten, Produkte, Ressourcen, Bezeichnungen und Pufferzeiten dürfen nicht im Programmcode festgeschrieben sein.
**SYS-08 MUSS:** Der lokale Betrieb muss mit dokumentierter Installation, Aktualisierung, Sicherung und Wiederherstellung möglich sein.

### 6.2 Eventübersicht

**EV-01 MUSS:** Alle Anfragen und Aufträge müssen in einer chronologischen Liste erscheinen.
**EV-02 MUSS:** Die Liste muss nach Suchtext, Zeitraum, Status und Eventart filterbar sein.
**EV-03 MUSS:** Eine Kalenderansicht muss Events nach Tag, Woche und Monat anzeigen.
**EV-04 MUSS:** Ein Eventeintrag muss mindestens Datum, Eventname, Status, Eventart, Hauptkontakt, Ort und zugewiesene Fotobox erkennen lassen.
**EV-05 MUSS:** Ereignisse ohne Datum und neue Anfragen müssen gezielt auffindbar sein.
**EV-06 SOLL:** Filterzustände sollen als persönliche Standardansicht gespeichert werden können.
**EV-07 MUSS:** Eine Ressourcenansicht muss für einen gewählten Zeitraum zeigen, ob FB1 und FB2 frei, vorgemerkt oder fest gebucht sind.
**EV-08 SOLL:** Eine kompakte Zeitleiste soll beide Fotoboxen und ihre Reservierungszeiträume nebeneinander darstellen.

### 6.3 Eventakte

**EA-01 MUSS:** Die Eventakte muss Stammdaten, Kontakte, Ressourcen, Kommunikation, Dokumente, Dateien, Erinnerung und Logbuch gebündelt anzeigen.
**EA-02 MUSS:** Folgende Felder sind vorzusehen: Eventname, Status, Eventart, Anfragequelle, Datum, Start, Ende, Ort, Beschreibung, Fotobox-Paket und interne Notizen.
**EA-03 MUSS:** Ein Hauptkontakt und optional weitere Kontakte müssen zugeordnet werden können.
**EA-04 MUSS:** Der Status muss direkt in der Eventakte änderbar sein.
**EA-05 MUSS:** Ein Event muss manuell angelegt und aus einer Website-Anfrage automatisch erzeugt werden können.
**EA-06 SOLL:** Ein Event soll dupliziert werden können.
**EA-07 MUSS:** Annullieren muss den Datensatz erhalten; endgültiges Löschen darf nur bewusst und mit Bestätigung erfolgen.
**EA-08 SOLL:** Mehrere Zeit-/Ortseinträge sollen später möglich sein; für den MVP genügt ein primärer Termin mit einem Ort.
**EA-09 MUSS:** Das Fotobox-Paket muss als strukturierte Auswahl mit zentral gepflegten und über eine Oberfläche konfigurierbaren Werten gespeichert werden.
**EA-10 MUSS:** Freitextnotizen müssen Links und einfache Formatierung unterstützen.
**EA-11 MUSS:** In der Eventakte muss mindestens eine konkrete Fotobox reserviert oder fest zugewiesen werden können.
**EA-12 MUSS:** Vor der Zuweisung muss das System die Verfügbarkeit im benötigten Zeitraum anzeigen.

### 6.4 Logbuch

**LB-01 MUSS:** Das Logbuch muss Eventanlage, Formularquelle, Statusänderungen, wichtige E-Mail-Aktionen und Dokumenterzeugung protokollieren.
**LB-02 MUSS:** Jeder Eintrag benötigt Typ, Zeitpunkt und verständlichen Beschreibungstext.
**LB-03 MUSS:** Automatisch erzeugte Einträge dürfen nicht nachträglich bearbeitet werden.
**LB-04 SOLL:** Einträge sollen direkt zum betreffenden Dokument oder zur Nachricht führen.

### 6.5 Kontakte

**KO-01 MUSS:** Privat- und Firmenkontakte müssen angelegt, bearbeitet, gesucht und archiviert werden können.
**KO-02 MUSS:** Unterstützte Daten sind mindestens Name/Firma, Ansprechpartner, Anschrift, E-Mail sowie Festnetz-/Mobilnummer.
**KO-03 MUSS:** Ein Kontakt muss seine zugeordneten Events und E-Mails zeigen.
**KO-04 MUSS:** Bei einer Website-Anfrage soll ein vorhandener Kontakt möglichst erkannt statt doppelt angelegt werden.
**KO-05 SOLL:** Eine Dublettenprüfung soll mindestens normalisierte E-Mail-Adresse und Telefonnummer berücksichtigen.
**KO-06 SOLL:** Aus einem Kontakt sollen E-Mail und Anruf direkt gestartet werden können.
**KO-07 MUSS:** Kontaktgruppen und Schlagwörter sind im MVP nicht erforderlich.

### 6.6 Eventarten und Stammdatenpflege

**SA-01 MUSS:** Eventarten müssen über eine Administrationsoberfläche angelegt, umbenannt, sortiert, aktiviert und archiviert werden können.
**SA-02 MUSS:** Alle sieben heute verwendeten Eventarten werden übernommen und bleiben aktiv.
**SA-03 MUSS:** Bereits verwendete Eventarten dürfen nicht hart gelöscht werden; beim Archivieren bleiben historische Zuordnungen erhalten.
**SA-04 MUSS:** Paketwerte müssen über eine Administrationsoberfläche angelegt, umbenannt, sortiert, aktiviert und archiviert werden können.
**SA-05 SOLL:** Vor dem Archivieren eines Stammdatensatzes muss das System dessen Verwendung anzeigen.

### 6.7 Website-Anfragen

**AN-01 MUSS:** Es müssen mehrere aktive Formulare beziehungsweise Formularquellen unterstützt werden.
**AN-02 MUSS:** Eine gültige Einsendung muss Kontakt und Event in einer Transaktion anlegen oder einem bestehenden Kontakt zuordnen.
**AN-03 MUSS:** Herkunft/Formularquelle muss am Event und im Logbuch gespeichert werden.
**AN-04 MUSS:** Pflichtfelder, Datenschutztext, Einwilligung und Spam-Schutz müssen konfigurierbar sein.
**AN-05 MUSS:** Formularfelder müssen auf Kontakt-, Event- und Paketfelder abgebildet werden können.
**AN-06 MUSS:** Nach erfolgreichem Eingang muss intern eine neue Anfrage sichtbar werden.
**AN-07 SOLL:** Der Kunde soll sofort eine passende Empfangsbestätigung erhalten.
**AN-08 SOLL:** Formulare sollen wahlweise eingebettet oder über einen eigenen Link geöffnet werden können.
**AN-09 MUSS:** Fehlerhafte Übertragungen müssen protokolliert und erneut zustellbar sein.

### 6.8 E-Mail und Postfach

**EM-01 MUSS:** Das vorhandene geschäftliche Postfach muss per IMAP/SMTP oder gleichwertiger Schnittstelle angebunden werden können.
**EM-02 MUSS:** Die Anwendung muss Posteingang, unerledigte Nachrichten, gesendete Nachrichten, Entwürfe, geplante Nachrichten, Fehler und Papierkorb abbilden.
**EM-03 MUSS:** Ein- und ausgehende Nachrichten müssen einem Kontakt und Event automatisch oder manuell zugeordnet werden können.
**EM-04 MUSS:** Unerledigt/erledigt muss als eigener Bearbeitungsstatus geführt werden.
**EM-05 MUSS:** Innerhalb eines Events müssen alle zugeordneten Nachrichten erreichbar sein.
**EM-06 MUSS:** Nachrichten müssen erstellt, beantwortet, weitergeleitet, als Entwurf gespeichert und geplant versendet werden können.
**EM-07 MUSS:** Versandfehler müssen sichtbar sein und einen erneuten Versand erlauben.
**EM-08 MUSS:** Eine Text- und optional HTML-Signatur muss zentral gepflegt werden können.
**EM-09 MUSS:** Anhänge müssen aus dem Rechner, der Dateibibliothek und aus erzeugten Dokumenten gewählt werden können.
**EM-10 SOLL:** Die Zuordnung soll anhand Absender, Empfänger, Antwortbezug und Eventreferenz vorgeschlagen werden.
**EM-11 MUSS:** Historische E-Mails aus bookitup werden nicht migriert; das neue Postfach beginnt ab dem Umschaltzeitpunkt mit neu eingehenden und ausgehenden Nachrichten.
**EM-12 SOLL:** Für den Übergang genügt ein zeitlich begrenzter Nur-Lese-Zugriff auf das alte Postfach, sofern einzelne Verläufe noch nachgeschlagen werden müssen.

### 6.9 E-Mail-Vorlagen

**ET-01 MUSS:** Beliebig viele Vorlagen mit Name, Betreff und Nachrichtentext müssen gepflegt werden können.
**ET-02 MUSS:** Platzhalter müssen mindestens Kontaktname, Eventname, Datum, Ort, Eventart, Fotobox-Paket, Angebotssumme und Dokumentlink unterstützen.
**ET-03 MUSS:** Standardanhänge aus der Dateibibliothek müssen einer Vorlage zugeordnet werden können.
**ET-04 MUSS:** Eine geladene Vorlage muss vor Versand vollständig änderbar bleiben.
**ET-05 MUSS:** Die elf bestehenden Vorlagen sollen migriert und anschließend fachlich bereinigt werden.
**ET-06 SOLL:** Vorlagen müssen duplizierbar und archivierbar sein.

### 6.10 Produkte und Pakete

**PR-01 MUSS:** Produkte benötigen Bezeichnung, optionale Beschreibung, Netto- oder Bruttopreis, Einheit, Steuersatz und Aktivstatus.
**PR-02 MUSS:** Produkte müssen für Fotobox-Pakete, Druckoptionen, Layout, Hintergründe, Lieferung/Aufbau, Zusatzzeit, Zusatzdrucke und sonstige Leistungen geeignet sein.
**PR-03 MUSS:** In Dokumentvorlagen und einzelnen Dokumenten müssen Produkte mit Menge, Einzelpreis, Rabatt und freiem Beschreibungstext eingefügt werden können.
**PR-04 MUSS:** Ein dokumentbezogener Preis darf vom Stammpreis abweichen, ohne den Produktstamm zu verändern.
**PR-05 MUSS:** Produkte müssen über eine Administrationsoberfläche angelegt, bearbeitet, sortiert, dupliziert, aktiviert und archiviert werden können.
**PR-06 SOLL:** Ein Fotobox-Paket soll mehrere Standardpositionen bündeln können.
**PR-07 MUSS:** Der vollständige bestehende Produktkatalog wird migriert und bleibt zunächst aktiv.

### 6.11 Ressourcen und Doppelbuchungsschutz

**RE-01 MUSS:** Die beiden physischen Fotoboxen müssen als getrennte Ressourcen geführt werden; anfängliche Bezeichnungen sind vorbehaltlich Tippfehler „FB1“ und „FB2“.
**RE-02 MUSS:** Eine Ressource benötigt mindestens Bezeichnung, internen Code, Aktivstatus und optional eine Beschreibung.
**RE-03 MUSS:** Eine Reservierung benötigt Event, Ressource, Beginn, Ende und Reservierungsstatus.
**RE-04 MUSS:** Der Reservierungszeitraum muss unabhängig vom eigentlichen Eventzeitraum festgelegt werden können, damit Transport, Aufbau, Abbau und Rückgabe abgebildet werden.
**RE-05 MUSS:** Für jede Fotobox müssen standardmäßige Pufferzeiten vor und nach dem Event konfigurierbar sein; Ausgangswert sind jeweils zwei Tage vor und zwei Tage nach dem Event.
**RE-06 MUSS:** Die Verfügbarkeitsprüfung muss Überschneidungen einschließlich Pufferzeiten erkennen.
**RE-07 MUSS:** Eine feste Buchung darf nicht gespeichert werden, wenn dieselbe Fotobox im Zeitraum bereits fest gebucht ist.
**RE-08 MUSS:** Anfragen und Optionen dürfen als Vormerkung erfasst werden; konkurrierende Vormerkungen müssen deutlich sichtbar sein.
**RE-09 MUSS:** Beim Wechsel eines Events auf „Gebucht“ muss mindestens eine verfügbare Fotobox fest zugewiesen sein.
**RE-10 MUSS:** Beim Wechsel auf „Nicht verfügbar“ oder „Annulliert“ müssen zukünftige Reservierungen dieses Events aufgehoben werden.
**RE-11 MUSS:** Ein Wechsel der Fotobox muss konfliktgeprüft und im Logbuch protokolliert werden.
**RE-12 MUSS:** Kalender und Eventliste müssen Ressourcenbelegung und Konflikte auf einen Blick zeigen.
**RE-13 MUSS:** Einmal vorhandenes Zubehör muss als eigene Ressource mit Stückzahl geführt und gegen Doppelbelegung geprüft werden; anfänglich sind dies „Glamour-Paket“ und „Schwarzwald-Paket“ mit Bestand eins.
**RE-14 SOLL:** Produkte oder Pakete sollen automatisch einen Ressourcenbedarf vorschlagen können; die konkrete Box wird anschließend manuell oder automatisch zugewiesen.
**RE-15 SOLL:** Für Wartung, Reparatur oder Eigenbedarf muss eine Fotobox ohne Kunden-Event zeitweise blockiert werden können.
**RE-16 SOLL:** Die Ressourcenansicht soll nach frei, vorgemerkt, gebucht, blockiert und Konflikt unterscheiden.
**RE-17 KANN:** Zubehör kann später zu Sets oder Cases gebündelt werden; dies ist keine Voraussetzung für den ersten Produktivstart.
**RE-18 MUSS:** Ressourcen müssen über eine Administrationsoberfläche angelegt, umbenannt, kategorisiert, aktiviert, zeitweise gesperrt und archiviert werden können.
**RE-19 MUSS:** Bestand, Standardpuffer und interne Kennzeichnung müssen je Ressource über die Oberfläche konfigurierbar sein.
**RE-20 MUSS:** Eine bereits verwendete Ressource darf nicht hart gelöscht werden; historische Zuordnungen bleiben beim Archivieren erhalten.

### 6.12 Dokumentvorlagen und PDF-Layout

**DV-01 MUSS:** Mehrere Vorlagen je Dokumentart müssen unterstützt werden.
**DV-02 MUSS:** Im MVP benötigte Arten sind Angebot, Auftragsbestätigung, Anzahlungsrechnung, Rechnung und Rechnungskorrektur.
**DV-03 MUSS:** Vorlagen müssen Produkte, freie Positionen, Texte, Rabatte, Steuern, Summen und Platzhalter enthalten können.
**DV-04 MUSS:** Das PDF-Layout muss Logo, Schrift, Farben, Absender/Empfänger, Seitenzahlen und Positionsnummern unterstützen.
**DV-05 MUSS:** Angebotsgültigkeit muss konfigurierbar sein; der vorhandene Ausgangswert beträgt 14 Tage.
**DV-06 MUSS:** Vorlagen und Gestaltung müssen ohne Programmänderung bearbeitbar sein.
**DV-07 SOLL:** Eine Live-Vorschau soll Änderungen vor dem Speichern zeigen.
**DV-08 MUSS:** Bestehende Vorlagen sind fachlich zu migrieren; eine pixelgenaue Kopie des bisherigen Layouts ist nicht erforderlich.

### 6.13 Angebote und Auftragsbestätigungen

**AG-01 MUSS:** Ein Angebot muss aus Event, Kontakt und einer Vorlage erzeugt werden können.
**AG-02 MUSS:** Positionen, Texte, Preise, Mengen, Rabatte, Steuer und Gültigkeitsdatum müssen vor Finalisierung änderbar sein.
**AG-03 MUSS:** Das System muss ein unveränderbares PDF und eine eindeutige Angebotsnummer erzeugen.
**AG-04 MUSS:** Angebotsstatus sind mindestens Entwurf, final, versendet, abgelaufen, angenommen und zurückgezogen.
**AG-05 MUSS:** Ein angenommenes Angebot muss ohne erneute Positionserfassung in eine Auftragsbestätigung oder Rechnung übernommen werden können.
**AG-06 MUSS:** Angebotsannahmen müssen intern unabhängig vom Eingangskanal erfasst werden können. Unterstützte Kanäle sind mindestens E-Mail, Telefon, unterschriebenes PDF und Sonstiges.
**AG-07 MUSS:** Versendete Fassungen müssen unveränderbar archiviert werden.
**AG-08 MUSS:** Zur Annahme müssen Zeitpunkt, Kanal und optionale Notiz gespeichert werden; ein unterschriebenes PDF muss bei Bedarf angehängt werden können.
**AG-09 MUSS:** Ein Kundenportal ist für den MVP nicht erforderlich.

### 6.14 Rechnungen und Zahlungen

**RG-01 MUSS:** Rechnungen müssen aus Event, Angebot oder Dokumentvorlage erzeugt werden können.
**RG-02 MUSS:** Unterstützt werden normale Rechnung, Anzahlungsrechnung, Schlussrechnung und Rechnungskorrektur/Storno.
**RG-03 MUSS:** Eine Schlussrechnung muss geleistete Anzahlungen korrekt ausweisen und verrechnen.
**RG-04 MUSS:** Rechnungen müssen die in Deutschland erforderlichen Pflichtangaben abbilden können.
**RG-05 MUSS:** Der allgemeine Steuersatz muss konfigurierbar sein; Ausgangswert sind 19 Prozent.
**RG-06 MUSS:** Abweichende Steuersätze müssen pro Position möglich sein.
**RG-07 MUSS:** Rechnungsdatum, Leistungsdatum, Zahlungsziel und Bankverbindung müssen unterstützt werden.
**RG-08 MUSS:** Dokumentstatus sind mindestens Entwurf, final, versendet, teilweise bezahlt, bezahlt, überfällig und storniert.
**RG-09 MUSS:** Zahlungseingänge müssen mit Datum, Betrag, Zahlweg und Notiz erfasst werden können.
**RG-10 SOLL:** Offener Betrag und Zahlungsstatus sollen automatisch berechnet werden.
**RG-11 MUSS:** Finale Rechnungen und Korrekturen dürfen nicht überschrieben, sondern nur durch Folgedokumente berichtigt werden.
**RG-12 MUSS:** Ein Export der Rechnungs- und Zahlungsdaten als CSV muss möglich sein; eine direkte Buchhaltungsanbindung ist nicht Teil des MVP.

### 6.15 Nummernkreise

**NK-01 MUSS:** Angebot, Auftragsbestätigung, Rechnung, Rechnungskorrektur/Storno und optional Vertrag müssen getrennte Nummernkreise besitzen.
**NK-02 MUSS:** Muster müssen Platzhalter für Jahr, Monat, Tag und fortlaufende Nummer unterstützen.
**NK-03 MUSS:** Eine Mindestlänge mit führenden Nullen muss konfigurierbar sein.
**NK-04 MUSS:** Die Übernahme der aktuell nächsten Nummer muss vor Produktivstart geprüft und atomar durchgeführt werden.
**NK-05 MUSS:** Eine Nummer darf nie doppelt vergeben oder nach Finalisierung wiederverwendet werden.
**NK-06 MUSS:** Eine Vorschau muss die nächste Nummer vor dem Speichern anzeigen.

### 6.16 Dateien und Anhänge

**DA-01 MUSS:** Eine zentrale Bibliothek muss wiederverwendbare Dateien speichern können.
**DA-02 MUSS:** Unterstützt werden mindestens PDF, JPG, PNG und ZIP.
**DA-03 MUSS:** Dateien müssen einen verständlichen Namen, Typ, Größe, Uploadzeitpunkt und Aktivstatus besitzen.
**DA-04 MUSS:** Bibliotheksdateien müssen E-Mail-Vorlagen oder einzelnen Nachrichten angehängt werden können.
**DA-05 SOLL:** Dateien sollen zusätzlich einem Event zugeordnet werden können.
**DA-06 SOLL:** Ersetzen einer Datei muss bestehende versendete E-Mails und finale Dokumente unverändert lassen.
**DA-07 MUSS:** Die vorhandenen acht Standarddateien sollen migriert werden.

### 6.17 Erinnerungen statt Workflow-Engine

**ER-01 MUSS:** Wenn eine neue Anfrage nach einem konfigurierbaren Zeitraum unbeantwortet ist, muss eine Erinnerung erzeugt werden.
**ER-02 MUSS:** Wenn nach einer gesendeten E-Mail oder einem Angebot keine Reaktion erfasst wurde, muss nach einem konfigurierbaren Zeitraum eine Erinnerung erzeugt werden.
**ER-03 MUSS:** Erinnerungen müssen offen, erledigt oder verworfen sein und zum Event führen.
**ER-04 SOLL:** Fällige Erinnerungen sollen zusätzlich per E-Mail gemeldet werden können.
**ER-05 MUSS:** Der MVP enthält keinen frei programmierbaren Workflow-Builder.

### 6.18 Kalender-Abo und ICS-Ausgabe

**KA-01 MUSS:** Das System muss einen abonnierbaren ICS-Kalender für relevante Events bereitstellen.
**KA-02 MUSS:** Der Feed muss mit Apple Kalender, Google Kalender und Outlook kompatibel sein.
**KA-03 MUSS:** Jeder Kalendereintrag muss mindestens Eventname, Beginn, Ende, Ort, Status und zugewiesene Fotobox enthalten.
**KA-04 SOLL:** Beschreibung, interner Eventlink und Eventart sollen optional ausgegeben werden können.
**KA-05 MUSS:** Änderungen und Annullierungen müssen sich im abonnierten Kalender aktualisieren.
**KA-06 MUSS:** Der Kalenderlink muss ein langes, nicht erratbares Zugriffstoken verwenden und in den Einstellungen erneuert beziehungsweise widerrufen werden können.
**KA-07 SOLL:** Neben einem Gesamtkalender sollen getrennte Feeds für FB1, FB2 und auf Wunsch bestimmte Status erzeugt werden können.
**KA-08 MUSS:** Der ICS-Feed ist nur lesend; eine bidirektionale Google-Calendar-Synchronisation gehört nicht zum MVP.

### 6.19 Online-Verträge und digitale Unterschrift

**VT-01 MUSS:** Vertragsvorlagen müssen über eine Administrationsoberfläche erstellt, bearbeitet, dupliziert, aktiviert und archiviert werden können.
**VT-02 MUSS:** Eine Vorlage muss Vertragstext, Überschriften, Platzhalter, Eingabefelder, Auswahlfelder, Pflicht-Checkboxen, Datei-Uploads und ein Unterschriftsfeld kombinieren können.
**VT-03 MUSS:** Aus Event, Kontakt, Angebot, Paket und Ressourcen muss eine persönliche Vertragsinstanz erzeugt werden können.
**VT-04 MUSS:** Bekannte Daten werden vorausgefüllt; pro Feld muss konfigurierbar sein, ob der Kunde es sehen, bearbeiten oder nur bestätigen darf.
**VT-05 MUSS:** Paket, Preis, reservierte Ressourcen und bereits finalisierte Angebotspositionen müssen gegen unbemerkte Kundenänderungen geschützt sein.
**VT-06 MUSS:** Der Kunde erhält einen langen, nicht erratbaren Link, der ohne eigenes Kundenkonto auf Smartphone, Tablet und Desktop funktioniert.
**VT-07 MUSS:** Vertragslinks müssen ablaufen, widerrufen und bei Bedarf neu erzeugt werden können.
**VT-08 MUSS:** Eingaben müssen zwischengespeichert werden, ohne einen Vertrag vorzeitig als abgeschlossen zu markieren.
**VT-09 MUSS:** Vor Abschluss müssen alle Pflichtfelder, Pflichtbestätigungen und die Unterschrift vorhanden sein.
**VT-10 MUSS:** Nach Abschluss muss ein unveränderbares PDF mit Vertragsversion, ausgefüllten Daten, Unterschrift und nachvollziehbarem Abschlusszeitpunkt erzeugt werden.
**VT-11 MUSS:** Das Nachweisprotokoll muss mindestens Vertrags-ID, Vorlagenversion, Zeitpunkte, Statuswechsel und technische Versand-/Abschlussdaten enthalten; unnötige personenbezogene Technikdaten sind zu vermeiden.
**VT-12 MUSS:** Betreiber und Kunde erhalten das abgeschlossene Dokument per E-Mail beziehungsweise können es unmittelbar herunterladen.
**VT-13 MUSS:** Ein abgeschlossener Vertrag muss Event und Kontakt zugeordnet und im Logbuch vermerkt werden.
**VT-14 MUSS:** Optional kann ein unterschriebener Vertrag den Status auf „Gebucht“ setzen und vorgemerkte Ressourcen fest buchen; unmittelbar davor ist die Verfügbarkeit erneut atomar zu prüfen.
**VT-15 MUSS:** Scheitert die Ressourcenprüfung, darf kein widersprüchlich gebuchter Vertrag entstehen; der Vorgang wird angehalten und dem Betreiber gemeldet.
**VT-16 MUSS:** Die Nutzung des Online-Vertrags bleibt pro Event optional; Buchungen per E-Mail, Telefon oder extern unterschriebenem PDF sind weiterhin möglich.
**VT-17 SOLL:** Nicht abgeschlossene Verträge sollen nach konfigurierbarer Zeit erinnert werden können.
**VT-18 MUSS:** Vertragstexte und Einwilligungen müssen vor Produktivbetrieb rechtlich geprüft und versioniert werden.

### 6.20 Online-Fragebögen für Fotobox-Aufträge

**FB-01 MUSS:** Fragebogenvorlagen müssen über eine Administrationsoberfläche erstellt, sortiert, dupliziert, aktiviert und archiviert werden können.
**FB-02 MUSS:** Unterstützte Felder sind mindestens Kurz-/Langtext, Datum, Uhrzeit, Einfach-/Mehrfachauswahl, Dropdown, Pflichtbestätigung und Datei-Upload.
**FB-03 MUSS:** Ein Fragebogen wird als sicherer, widerrufbarer und optional befristeter Link zu einem Event versendet.
**FB-04 MUSS:** Bekannte Event- und Kontaktdaten können vorausgefüllt werden; Antworten müssen zwischengespeichert werden.
**FB-05 MUSS:** Eine Fotobox-Vorlage soll mindestens Anlass/Namen, Layoutausrichtung, Hintergrund, Paket/Zubehör, Aufbau-/Abbauzeit, Ansprechpartner vor Ort, Telefon, Liefer-/Parksituation, Platz/Strom und Besonderheiten abfragen können.
**FB-06 MUSS:** Kunden müssen Logos, Einladungen oder Designvorlagen hochladen können; erlaubte Typen und Größen sind konfigurierbar.
**FB-07 MUSS:** Antworten müssen nach Absenden strukturiert in der Eventakte erscheinen und auf definierte Eventfelder übertragen werden können.
**FB-08 MUSS:** Der Betreiber wird über die Abgabe informiert; die Abgabe wird im Logbuch protokolliert.
**FB-09 SOLL:** Der Fragebogen kann nach Freigabe durch den Betreiber zur Korrektur erneut geöffnet werden.
**FB-10 SOLL:** Nicht abgegebene Fragebögen sollen relativ zum Eventtermin automatisch erinnert werden können.
**FB-11 MUSS:** Fragebogendaten und Uploads dürfen nur dem zugehörigen Event und dem angemeldeten Betreiber zugänglich sein.

### 6.21 Öffentlicher Verfügbarkeitskalender für WordPress

**WK-01 MUSS:** Das System muss ein responsives Widget bereitstellen, das in WordPress über einen HTML-/Script-Block oder einen Shortcode eingebunden werden kann.
**WK-02 MUSS:** Gestaltung, Farben, Schrift, Abstände, Rundungen, Legende und Texte müssen ohne Programmänderung konfigurierbar sein.
**WK-03 MUSS:** Die öffentliche Verfügbarkeit muss aus FB1, FB2, Ressourcenreservierungen, Zubehörbestand und den konfigurierten Vor-/Nachlaufzeiten berechnet werden.
**WK-04 MUSS:** Status wie Anfrage, Option, Gebucht, Blockierung und Annullierung müssen nach konfigurierbaren Regeln in die öffentliche Verfügbarkeit einfließen.
**WK-05 MUSS:** Die Anzeige muss mindestens „verfügbar“, „nur noch eine Fotobox verfügbar“, „auf Anfrage“ und „ausgebucht“ unterscheiden können; Texte und Farben sind konfigurierbar.
**WK-06 MUSS:** Das Widget darf keine Kundennamen, Orte, Auftragsarten, interne Notizen oder konkreten Buchungsdetails veröffentlichen.
**WK-07 MUSS:** Ein Besucher muss Datum beziehungsweise Zeitraum, gewünschtes Paket und optional Glamour-/Schwarzwald-Paket auswählen und anschließend eine Anfrage senden können.
**WK-08 MUSS:** Vor Absenden muss die Verfügbarkeit serverseitig erneut geprüft werden; die Anzeige im Browser allein darf keine Buchungszusage darstellen.
**WK-09 MUSS:** Eine Anfrage erzeugt Kontakt, Event und eine zeitlich begrenzte Vormerkung, aber keine automatische feste Buchung.
**WK-10 MUSS:** Bei inzwischen veränderter Verfügbarkeit erhält der Besucher eine verständliche Meldung und mögliche Alternativen.
**WK-11 MUSS:** Das Widget benötigt Spam-Schutz, konfigurierbare Einwilligung, Datenschutzhinweis und Schutz vor massenhaften Abfragen.
**WK-12 MUSS:** Erlaubte WordPress-Domains, Widget-Token und deren Widerruf müssen in der Administration konfigurierbar sein.
**WK-13 SOLL:** Monatsansicht und kompakte Datumsprüfung sollen als zwei Darstellungsvarianten verfügbar sein.
**WK-14 SOLL:** Das Widget soll sich ohne Seitenneuladen aktualisieren und auf kleinen Bildschirmen vollständig bedienbar sein.
**WK-15 MUSS:** Beim lokalen Eigenbetrieb werden nur anonymisierte Verfügbarkeitsdaten ausgehend an einen öffentlichen Gateway beziehungsweise WordPress übertragen; das lokale Verwaltungsnetz benötigt keinen ungeschützten eingehenden Zugriff.
**WK-16 MUSS:** Fällt die Verbindung zum lokalen System aus, muss der öffentliche Stand als möglicherweise veraltet gekennzeichnet werden und darf keine feste Zusage erzeugen.
**WK-17 MUSS:** Öffentliche Anfragen werden über eine authentifizierte, vom lokalen System ausgehende Synchronisation abgeholt; bis zur bestätigten Übernahme darf der öffentliche Dienst nur die dafür notwendigen Daten zeitlich begrenzt speichern.
**WK-18 MUSS:** Die endgültige Ressourcenprüfung und Vormerkung findet im lokalen Kernsystem statt; der öffentliche Dienst darf niemals selbst eine feste Ressourcenbuchung erzeugen.

### 6.22 To-dos und Vorlagen mit relativen Terminen

**TD-01 MUSS:** Aufgaben müssen eventbezogen oder allgemein angelegt werden können.
**TD-02 MUSS:** Eine Aufgabe benötigt Titel, optionale Beschreibung, Status, Fälligkeit und Eventbezug.
**TD-03 MUSS:** Status sind mindestens offen, erledigt und verworfen; überfällige Aufgaben werden hervorgehoben.
**TD-04 MUSS:** Aufgabenvorlagen müssen über eine Administrationsoberfläche angelegt, bearbeitet, dupliziert, aktiviert und archiviert werden können.
**TD-05 MUSS:** Eine Vorlage kann mehrere Aufgaben enthalten und nach Eventart, Paket oder Zubehör gefiltert werden.
**TD-06 MUSS:** Relative Fälligkeiten müssen mindestens auf Anfrageeingang, Buchung, Eventbeginn und Eventende bezogen werden können.
**TD-07 MUSS:** Der Versatz muss in Tagen vor oder nach dem Bezugsereignis konfigurierbar sein.
**TD-08 MUSS:** Ändert sich das Eventdatum, müssen noch offene relative Aufgaben nach einer verständlichen Vorschau neu terminiert werden.
**TD-09 MUSS:** Vorlagen müssen automatisch bei Anfrage oder Buchung oder manuell auf ein Event angewendet werden können.
**TD-10 SOLL:** Eine Standardvorlage soll Layout anfordern, Kundendaten prüfen, Fotobox testen, Zubehör packen, Aufbau vorbereiten, Rücknahme prüfen und Rechnung nachbereiten können.
**TD-11 MUSS:** Offene und überfällige Aufgaben müssen in einer Gesamtübersicht sowie in der Eventakte erscheinen.
**TD-12 SOLL:** Fällige Aufgaben können per E-Mail oder Browserbenachrichtigung gemeldet werden.
**TD-13 MUSS:** Für den Solo-MVP ist keine Mitarbeiterzuweisung erforderlich.

### 6.23 Absagegründe und einfache Auswertung

**AB-01 MUSS:** Absagegründe müssen über eine Administrationsoberfläche angelegt, umbenannt, sortiert, aktiviert und archiviert werden können.
**AB-02 MUSS:** Beim Wechsel auf „Nicht verfügbar“ oder „Annulliert“ muss ein strukturierter Absagegrund gewählt oder bewusst als unbekannt markiert werden.
**AB-03 MUSS:** Zusätzlich muss eine optionale interne Freitextnotiz möglich sein.
**AB-04 MUSS:** Ausgangsgründe sollen mindestens Termin belegt, Zubehör nicht verfügbar, Preis, keine Rückmeldung, anderer Anbieter, Kunde abgesagt, Termin verschoben und Sonstiges umfassen.
**AB-05 MUSS:** Archivierte Gründe bleiben bei bestehenden Events sichtbar.
**AB-06 MUSS:** Eine einfache Auswertung muss Anzahl und Anteil der Absagen nach Grund für einen wählbaren Zeitraum zeigen.
**AB-07 SOLL:** Die Auswertung soll zusätzlich nach Eventart, Anfragequelle und Paket filterbar sein.
**AB-08 SOLL:** „Nicht verfügbar“ und kundenseitige Absage müssen getrennt auswertbar sein.
**AB-09 SOLL:** Ergebnisse sollen als CSV exportiert werden können.

## 7. Datenmigration aus bookitup

### 7.1 Zu migrierende Daten

**MIG-01 MUSS:** Kontakte einschließlich Firmen-/Ansprechpartnerbezug und Kontaktdaten.
**MIG-02 MUSS:** Für den beschleunigten Erststart nach Betreiberentscheidung vom 16.10.2026 ausschließlich zukünftige Aufträge mit Status, Art, Termin, Ort, Paket, Notizen und Kontaktzuordnung übernehmen. Historische Aufträge bleiben zunächst als gesicherte Übersicht erhalten; kein zusätzlicher Import historischer Detailakten.
**MIG-03 MUSS:** Alle sieben Eventarten und alle Werte der Fotobox-Paketauswahl.
**MIG-04 MUSS:** Vollständiger Produktkatalog.
**MIG-05 MUSS:** E-Mail- und Dokumentvorlagen.
**MIG-06 MUSS:** Logo, Dokumentgestaltung, Signatur und Standarddateien.
**MIG-07 MUSS:** Aktuelle Nummernkreisstände.
**MIG-08 MUSS:** Zum Umschaltzeitpunkt offene Angebote, Rechnungen, Anzahlungen, Korrekturen und Zahlungsstände operativ übernehmen oder im geprüften externen Ersatzprozess führen. Zusätzlich alle noch benötigten historischen Originalbelege mit Metadaten und Nachweisen unabhängig von Bookitup sichern; kein vollständiger Altarchiv-Import in die Anwendung für den Erststart erforderlich.
**MIG-09 MUSS:** Benötigte historische E-Mails und Anhänge unabhängig von Bookitup sichern; bereits vollständig im eigenen gesicherten Postfach vorhandene Bestände abgleichen. Bookitup-exklusive Inhalte und Zuordnungen separat sichern. Kein integriertes Postfach oder historischer Mailimport in die Anwendung für den verkürzten Erststart erforderlich.
**MIG-10 SOLL:** Logbucheinträge aktiver und zukünftiger Events, sofern bookitup sie in brauchbarer Form exportieren kann.
**MIG-11 MUSS:** FB1 und FB2 sowie Glamour-Paket und Schwarzwald-Paket werden als neue Ressourcenstammdaten angelegt; bestehende aktive und zukünftige Events erhalten vor Produktivstart eine manuell geprüfte Ressourcenzuordnung.
**MIG-12 SOLL:** Falls die konkrete Box aus vorhandenen Notizen oder Paketangaben eindeutig hervorgeht, darf der Import eine Zuordnung vorschlagen, aber nicht ungeprüft festschreiben.
**MIG-13 MUSS:** Vertrags-, Fragebogen-, To-do- und Absagegrundvorlagen werden neu im Zielsystem konfiguriert; aus bookitup ist dafür keine Altdatenmigration erforderlich.
**MIG-14 MUSS:** Die Ressourcenzuordnung bestehender zukünftiger Events bildet den initialen Datenstand für den öffentlichen Verfügbarkeitskalender.

### 7.2 Nicht ungeprüft zu migrieren

- archivierte oder offensichtlich doppelte Kontakte,
- alte Testevents,
- erledigte Einführungsaufgaben,
- ungenutzte Vorlagenarten,
- veraltete oder fachfremde Produkte,
- Papierkorb- und Spam-Nachrichten.

### 7.3 Migrationsabnahme

Vor Umschaltung müssen Stichproben und Summenkontrollen bestätigen:

- Kontakt- und Eventanzahl stimmen mit dem freigegebenen Export überein.
- Jeder aktive Auftrag hat Status, Termin, Kontakt und Paket.
- Jeder gebuchte zukünftige Auftrag hat eine konfliktfreie Zuordnung zu FB1 oder FB2.
- Stichproben mit parallelen Events bestätigen, dass beide Boxen unabhängig buchbar sind und eine dritte gleichzeitige Buchung blockiert wird.
- Offene Angebote und Rechnungen sind vollständig und mit korrekter Nummer vorhanden.
- Nächste Dokumentnummern überschneiden sich nicht mit bookitup.
- Ab dem vereinbarten Umschaltzeitpunkt werden neue Nachrichten zuverlässig im Zielpostfach empfangen; beim verkürzten Erststart darf dies ein geprüfter unabhängiger Mailclient sein. Benötigte historische E-Mails und Originalbelege sind ohne Bookitup zugänglich.
- PDFs und Standardanhänge lassen sich öffnen.

## 8. Nichtfunktionale Anforderungen

**NF-01 Performance:** Event-, Kontakt- und Postfachlisten müssen im Normalfall innerhalb von zwei Sekunden bedienbar sein.
**NF-02 Datenschutz:** Verarbeitung nach DSGVO mit dokumentiertem Lösch-, Auskunfts- und Exportprozess.
**NF-03 Betrieb:** Der MVP wird lokal auf eigener Infrastruktur betrieben. Installation, Updates, Backup und Wiederherstellung müssen dokumentiert und ohne Cloud-Plattformzwang möglich sein.
**NF-04 Sicherheit:** TLS, sichere OIDC-Sitzungen, CSRF-Schutz und Schutz vor Brute Force ab Einführung des jeweiligen Endpunkts; keine lokalen Passwörter im MVP. Zusätzliche Faktoren werden beim Google-Konto verwaltet. Ein später aktivierter Notfallzugang benötigt ein separat geprüftes Sicherheitskonzept.
**NF-05 Backup:** Tägliche automatische Sicherung; Wiederherstellung muss regelmäßig getestet werden.
**NF-06 Nachvollziehbarkeit:** Geschäftsdokumente, Nummernvergabe und automatische Änderungen müssen protokolliert werden.
**NF-07 Datenintegrität:** Finale Dokumente, Nummernkreise, Zahlungen, Formularanlage und Ressourcenreservierungen benötigen Transaktionen und Eindeutigkeitsregeln. Gleichzeitige Bearbeitung darf keine Doppelbuchung ermöglichen.
**NF-08 E-Mail-Zuverlässigkeit:** Eingehende Nachrichten dürfen bei Zuordnungsfehlern nicht verloren gehen; Versandfehler müssen wiederholbar sein.
**NF-09 Bedienbarkeit:** Häufige Aktionen sollen mit wenigen Klicks erreichbar sein; Tabellen benötigen brauchbare Tastatur- und Suchbedienung.
**NF-10 Exportierbarkeit:** Kontakte, Events, Produkte, Dokumentmetadaten und Finanzdaten müssen jederzeit in offenen Formaten exportierbar sein.
**NF-11 Wartbarkeit:** Postfach, Formulare, Dokumente und Kernverwaltung sollen technisch getrennte Module mit klaren Schnittstellen sein.
**NF-12 Zukunftsfähigkeit:** Datenmodell und Authentifizierung müssen einen späteren gehosteten Mehrmandantenbetrieb für weitere Dienstleister ermöglichen, ohne den MVP bereits als SaaS betreiben zu müssen.
**NF-13 Mandantentrennung:** Bereits im Datenmodell müssen geschäftliche Datensätze einem Mandanten zuordenbar sein, damit eine spätere Hosting-Version Daten verschiedener Dienstleister strikt trennen kann.
**NF-14 Konfigurierbarkeit:** Stammdaten und betriebliche Standardwerte müssen über Oberflächen änderbar sein; Änderungen dürfen keine Software-Neuveröffentlichung erfordern.
**NF-15 Öffentliche Sicherheit:** Vertrag, Fragebogen und WordPress-Widget müssen technisch von der internen Administration getrennt, TLS-geschützt und gegen Token-Raten, Manipulation, Missbrauch und unberechtigte Dateizugriffe abgesichert sein.
**NF-16 Signaturnachweis:** Abgeschlossene Verträge müssen unveränderbar, versioniert und mit einem nachvollziehbaren Integritätsnachweis archiviert werden.
**NF-17 Barrierearmut:** Öffentliche Formulare und Kalender müssen per Tastatur bedienbar sein, ausreichende Kontraste besitzen und verständliche Validierungsfehler ausgeben.
**NF-18 WordPress-Betrieb:** Aktualisierungen der Verwaltungsanwendung dürfen einen eingebetteten Kalender nicht ohne Vorwarnung inkompatibel machen; Widget-Schnittstellen sind zu versionieren.
**NF-19 Aktualität:** Änderungen an Buchungen und Ressourcensperren sollen innerhalb von höchstens einer Minute in der öffentlichen Verfügbarkeitsanzeige erscheinen.
**NF-20 Öffentlicher Gateway:** Der getrennt erreichbare öffentliche Teil für Widget, Anfragen, Verträge und Fragebögen darf ausschließlich die minimal notwendigen Daten halten und synchronisiert mit dem lokalen Kern über authentifizierte, bevorzugt ausgehend aufgebaute Verbindungen.

## 9. MVP-Abnahmeszenario

Der MVP ist fachlich abnahmefähig, wenn folgender reale Ablauf vollständig ohne bookitup und ohne Hilfstabelle funktioniert:

1. Ein Interessent prüft im gebrandeten WordPress-Kalender einen Termin und sendet eine Anfrage für Paket und Zubehör ab.
2. Kontakt und Anfrage erscheinen genau einmal im System; Quelle und Eingang werden protokolliert.
3. Der Inhaber ergänzt Termin, Ort, Eventart, Paket und Notiz.
4. Das System zeigt die Verfügbarkeit beider Fotoboxen einschließlich Pufferzeiten; eine freie Box wird vorgemerkt.
5. Eine passende E-Mail-Vorlage erzeugt eine bearbeitbare Antwort.
6. Aus Produkt- und Angebotsvorlage entsteht ein nummeriertes, gebrandetes PDF-Angebot.
7. Angebot und optionale Standarddateien werden versendet und der Nachricht zugeordnet.
8. Bei ausbleibender Reaktion wird automatisch eine Nachfass-Erinnerung erzeugt.
9. Aus Event und Angebot entsteht ein vorausgefüllter Online-Mietvertrag, den der Kunde ergänzt und unterschreibt.
10. Unmittelbar vor Vertragsabschluss wird die Ressourcenlage erneut geprüft; danach wird die vorgemerkte Box fest gebucht und der Status auf „Gebucht“ gesetzt.
11. Ein Fotobox-Fragebogen sammelt Layout, Dateien, Aufbauinformationen und Ansprechpartner strukturiert in der Eventakte.
12. Eine To-do-Vorlage erzeugt relativ zum Eventtermin die notwendigen Vorbereitungs- und Nachbereitungsaufgaben.
13. Eine parallele Buchung kann der zweiten Box zugewiesen werden; eine dritte gleichzeitige feste Belegung wird verhindert.
14. Eine Anzahlungs- oder normale Rechnung wird mit korrekter Nummer und Steuer erstellt und versendet.
15. Ein Zahlungseingang reduziert den offenen Betrag; Korrekturen erzeugen ein eigenes unveränderbares Folgedokument.
16. Alle wesentlichen Schritte, Kundenangaben, Aufgaben und Boxzuweisungen sind in Eventakte, Postfach und Logbuch wiederauffindbar.

Zusätzlich müssen zwei Gegenfälle abgenommen werden:

- Eine abgesagte Anfrage speichert einen konfigurierbaren Absagegrund und erscheint korrekt in der Auswertung.
- Ist das lokale System oder der öffentliche Verfügbarkeitsstand nicht aktuell erreichbar, zeigt WordPress keine verbindliche Zusage an.

## 10. Empfohlene Umsetzungsreihenfolge

Die folgenden Gruppen beschreiben fachliche Bereiche, keine abweichende Commitreihenfolge. Maßgeblich ist `IMPLEMENTATION_PLAN.md`.

### Ausbaustufe A – Datenkern

- Anmeldung und Einstellungen
- Kontakte, Locations, Eventarten, Pakete und Produkte
- Eventliste, Kalender, Eventakte und Logbuch
- Fotobox-Stammdaten, Reservierungen, Pufferzeiten, Ressourcenansicht und Doppelbuchungsschutz
- konfigurierbare Eventarten, Pakete, Produkte und Zubehörressourcen
- Importwerkzeuge und Probelauf mit exportierten bookitup-Daten

### Ausbaustufe B – Kommunikation

- Website-Formulare
- Postfachanbindung und Zuordnung
- E-Mail-Vorlagen, Signatur, Dateibibliothek und Versandplanung
- zwei feste Nachfassregeln
- ICS-Kalenderfeed und Verwaltung des Zugriffstokens
- eventbezogene To-dos, relative Termine und To-do-Vorlagen

### Ausbaustufe C – Geschäftsdokumente

- Dokument- und Produktvorlagen
- PDF-Layout
- Angebote und Auftragsbestätigungen
- Rechnungen, Anzahlungen, Korrekturen, Zahlungen und Nummernkreise
- Online-Vertragsvorlagen, Kundenlinks, digitale Unterschrift und Nachweis-PDF
- Fotobox-Fragebogen mit strukturierten Antworten und Datei-Uploads

### Ausbaustufe D – Öffentliche Verfügbarkeit

- öffentlicher, anonymisierter Verfügbarkeitsdienst
- konfigurierbares WordPress-Widget mit Monats- und Prüfungsansicht
- ressourcenbasierte Anfrage und Vormerkung
- Absagegründe und einfache Auswertung
- Sicherheits-, Last- und Ausfalltests der öffentlichen Endpunkte

### Ausbaustufe E – Produktivmigration

- bereinigter Vollimport
- Paralleltest mit ausgewählten realen Vorgängen
- Schreibstopp in bookitup
- finaler Delta-Import und Umschaltung
- zeitlich begrenzter Nur-Lese-Zugriff auf das Altsystem

## 11. Festgelegte Rahmenbedingungen und ein offener Detailpunkt

- Das bestehende ICS-Kalender-Abo wird genutzt und muss ersetzt werden.
- Historische E-Mails werden nicht migriert.
- Alle sieben Eventarten und alle Produkte bleiben erhalten und sind über Oberflächen konfigurierbar.
- Der verbindliche Buchungsstatus heißt „Gebucht“.
- Angebotsannahmen können über unterschiedliche Kanäle erfolgen und werden intern protokolliert.
- Historische Geschäftsdokumente wurden bereits extern archiviert und müssen nicht migriert werden.
- Der MVP wird lokal mit Google-SSO betrieben; eine spätere gehostete Mehrmandantenversion bleibt möglich.
- Die Standardpuffer betragen zwei Tage vor und zwei Tage nach dem Event und sind konfigurierbar.
- Glamour-Paket und Schwarzwald-Paket sind jeweils einmal vorhandene, konfliktgeprüfte Ressourcen.
- Online-Verträge sind ein optionaler Buchungsweg und können direkt vom Kunden ausgefüllt und unterschrieben werden.
- Der Fotobox-Fragebogen sammelt Layout-, Aufbau- und Kontaktdaten über einen sicheren Link.
- Der öffentliche Verfügbarkeitskalender wird automatisch aktualisiert und im eigenen WordPress-Design eingebettet.
- Wiederkehrende Arbeit wird über To-do-Vorlagen relativ zum Eventtermin geplant.
- Absagegründe werden konfigurierbar erfasst und einfach ausgewertet.

**Noch zu bestätigen:** In der Antwort wurden beide Boxen als „FB1“ bezeichnet. Das Lastenheft verwendet vorläufig „FB1“ und „FB2“; beide Namen bleiben ohnehin frei konfigurierbar.

## 12. Späterer Ausbau – nur als Merkliste

Nicht Teil des MVP, aber architektonisch nicht zu verbauen:

- erweiterte Lagerverwaltung mit Sets, Cases, Seriennummern, Wartungszyklen und Einkaufswesen
- Teamkonten und Berechtigungen
- vollständiges Kundenportal mit langfristigem Dokumentarchiv, Rechnungsübersicht und Zahlungsfunktion; einzelne Vertrags- und Fragebogenlinks sind bereits im MVP enthalten
- flexible Workflows
- Buchhaltungsintegration
- Einlesen externer Kalender und bidirektionale Kalender-Synchronisation
- Statistiken und Auslastung
- Dienstleister- und Agenturfunktionen

## 13. Quellen und Datenschutz der Analyse

Die vollständige öffentliche Funktionsrecherche mit Detailquellen befindet sich im separaten Dokument `Bookitup_Funktionsinventar_vollstaendig.md`. Für diese fokussierte Fassung wurde zusätzlich die vom Nutzer freigegebene aktive Sitzung ausschließlich lesend geprüft. Es wurden keine Einstellungen gespeichert, keine Nachrichten versendet, keine Dateien heruntergeladen und keine Daten verändert. Personenbezogene Kunden-, Bank-, Preis-, Login- und Kontodaten wurden nicht in dieses Lastenheft übernommen.

Wesentliche öffentliche Quellen:

- [bookitup für Fotobox-Verleiher](https://bookitup.de/loesungen/fotoboxverleih/)
- [bookitup Funktions- und Tarifübersicht](https://bookitup.de/preise/)
- [bookitup Hilfecenter](https://bookitup.de/hilfe/)
- [Eventübersicht](https://bookitup.de/hilfe/die-eventuebersicht/)
- [E-Mail-Vorlagen](https://bookitup.de/hilfe/e-mail-vorlagen-erstellen/)
- [Dokumentvorlagen](https://bookitup.de/hilfe/dokument-vorlagen/)
- [Rechnungen und Zahlungen](https://bookitup.de/funktionen/rechnungsprogramm-fuer-eventdienstleister/)
- [Kontaktformular](https://bookitup.de/hilfe/webseiten-kontaktformular-mit-bookitup/)
- [kreativ.management – Online-Verträge und Fragebögen](https://kreativ.management/vertrag/)
- [kreativ.management – Workflows](https://kreativ.management/workflows/)
- [kreativ.management – Auftrags- und Terminverwaltung](https://kreativ.management/auftrag/)
- [kreativ.management – Funktionsübersicht](https://kreativ.management/preis/)
- [kreativ.management – öffentliche Buchungsseite und Vertragsfunktion](https://kreativ.management/agb/)

## 14. Rechtlicher Hinweis

Dieses Lastenheft beschreibt beobachtete Arbeitsabläufe und öffentlich dokumentierte Produktfunktionen. Es übernimmt weder Quellcode noch geschützte Gestaltung, Texte oder interne Implementierungsdetails von bookitup oder kreativ.management. Für die Eigenentwicklung sind eine eigenständige Oberfläche und Umsetzung vorgesehen. Vertragstexte, Einwilligungen und das gewählte elektronische Signaturverfahren sind vor dem Produktivbetrieb rechtlich prüfen zu lassen.
