# Vollständiges Bookitup-Funktionsinventar für eine eigene Fotobox-Verwaltung

**Dokumentstatus:** Recherchegrundlage v1.0
**Stand:** 14.09.2026
**Basis:** Öffentlich dokumentierter Funktionsumfang von bookitup, mit Fokus auf den Anwendungsfall Fotobox-Verleih
**Hinweis:** Dieses Dokument enthält bewusst auch derzeit ungenutzte Funktionen. Der anhand des angemeldeten Kontos reduzierte Entwicklungsumfang steht in `Lastenheft_Fotobox-Verwaltung_MVP.md`.

## 1. Ziel und Abgrenzung

Ziel ist eine eigene Webanwendung, die den vollständigen Lebenszyklus eines Fotobox-Auftrags abbildet: von der Anfrage über Verfügbarkeitsprüfung, Angebot, Vertrag und Vorbereitung bis zu Durchführung, Rechnungsstellung und Nachbereitung.

Die Anwendung soll insbesondere:

- alle Kunden-, Event-, Kommunikations-, Dokument- und Ressourcendaten an einem Ort bündeln,
- Doppelbuchungen von Fotoboxen und Zubehör verhindern,
- wiederkehrende Verwaltungsarbeit automatisieren,
- Kunden einen digitalen Self-Service-Bereich bereitstellen,
- mobil auf Smartphone und Tablet nutzbar sein,
- einen nachvollziehbaren, datenschutzkonformen Prozess ermöglichen.

Nicht Bestandteil dieser ersten Fassung sind die eigentliche Fotobox-Aufnahmesoftware, Bildbearbeitung, Druckersteuerung und eine öffentliche Fotogalerie. Diese Punkte können später als eigene Module ergänzt werden.

## 2. Quellenlage und Kennzeichnung

Die Funktionsaufnahme basiert auf der [bookitup-Produktseite für Fotobox-Verleiher](https://bookitup.de/loesungen/fotoboxverleih/), der [Funktions- und Preisübersicht](https://bookitup.de/preise/), der [allgemeinen Produktdarstellung](https://bookitup.de/) und dem [bookitup-Hilfecenter](https://bookitup.de/hilfe/). Detailquellen sind am Ende aufgeführt.

Anforderungen sind wie folgt gekennzeichnet:

- **MUSS:** für einen durchgängigen produktiven Betrieb erforderlich
- **SOLL:** hoher Nutzen, aber nicht zwingend für die erste produktive Version
- **KANN:** Ausbau- oder Spezialfunktion
- **ZU PRÜFEN:** öffentlich erwähnt, aber noch nicht in der angemeldeten Oberfläche verifiziert

## 3. Rollen und Berechtigungen

| Rolle | Zweck | Typische Rechte |
|---|---|---|
| Inhaber/Administrator | System- und Geschäftsverwaltung | Vollzugriff, Einstellungen, Benutzer, Integrationen, Löschung, Export |
| Büro/Disposition | Anfrage- und Auftragsbearbeitung | Kontakte, Events, Dokumente, Kommunikation, Ressourcen, Aufgaben |
| Aufbau-/Abbauteam | Operative Durchführung | Zugewiesene Events, Zeiten, Orte, Checklisten, Ressourcen, Notizen |
| Buchhaltung | Finanzbearbeitung | Angebote, Rechnungen, Zahlungen, Exporte, Statistiken |
| Externer Dienstleister | Zusammenarbeit/Vermittlung | Freigegebene Auftragsdaten, Status und Verfügbarkeit |
| Kunde | Self-Service | Freigegebene Angebote, Verträge, Fragebögen, Rechnungen und Dateien |

**R-01 MUSS:** Das System muss Benutzerkonten und eine Anmeldung unterstützen.
**R-02 SOLL:** Rechte müssen rollen- und funktionsbezogen vergeben werden können.
**R-03 SOLL:** Ein Benutzer darf nur die für ihn freigegebenen Events, Daten und Aktionen sehen.
**R-04 SOLL:** Änderungen müssen mit Benutzer und Zeitpunkt protokolliert werden.
**R-05 KANN:** Mehrere Unternehmensprofile oder Marken können in einem Konto verwaltet werden.
**R-06 ZU PRÜFEN:** „Freigaben für Teams“ müssen in der aktiven Oberfläche fachlich genauer aufgenommen werden.

## 4. Zentrale Geschäftsobjekte

- Anfrage
- Event/Auftrag
- Kontakt, Firma und Ansprechpartner
- Location und Zeitplanpunkt
- Produkt, Paket und Zusatzoption
- Ressource, Set, Case und Bestand
- Aufgabe und Checkliste
- E-Mail, Anhang und Vorlage
- Dokument und Dokumentvorlage
- Angebot, Auftragsbestätigung, Vertrag
- Rechnung, Anzahlungsrechnung, Schlussrechnung und Rechnungskorrektur
- Zahlung
- Fragebogen und Antwort
- Kundenportal-Zugang und Freigabe
- Workflow, Auslöser, Bedingung und Aktion
- Dienstleister/Vermittlung
- Benutzer, Rolle und Berechtigung
- Benachrichtigung und Logbucheintrag

## 5. Zielprozess

1. Eine Anfrage wird manuell oder über ein eingebettetes Kontaktformular erfasst.
2. Das System legt Kontakt und Event an und prüft Kalender sowie Ressourcen.
3. Ein Paket wird ausgewählt; Angebot und optional Vertrag werden aus Vorlagen erzeugt.
4. Der Kunde erhält einen Portal-Link, prüft das Angebot, ergänzt Daten und bestätigt oder unterschreibt.
5. Ein Workflow aktualisiert den Status, reserviert Ressourcen, erzeugt die Anzahlung und legt Vorbereitungsaufgaben an.
6. Fragebögen sammeln Printdesign, Hintergrund, Aufbau-/Abbauzeiten, Ansprechpartner und Sonderwünsche.
7. Disposition und Team sehen alle parallelen Vermietungen, Ressourcenengpässe und offenen Aufgaben.
8. Nach Durchführung werden Schlussrechnung, Zahlungsabgleich und Nachbereitung ausgelöst.
9. Kennzahlen zu Anfragen, Buchungsquote, Umsatz, Zahlungen und Herkunft werden aktualisiert.

## 6. Funktionale Anforderungen

### 6.1 Cockpit, Navigation und Eventübersicht

**EV-01 MUSS:** Das Cockpit muss alle Anfragen und Aufträge zentral anzeigen.
**EV-02 MUSS:** Events müssen mindestens als Liste/Kacheln und Kalenderansicht darstellbar sein.
**EV-03 SOLL:** Eine Zeitleistenansicht muss Events, Planungsgruppen und Ressourcen gemeinsam zeigen.
**EV-04 MUSS:** Filter müssen mindestens Zeitraum, Status und Auftragsart unterstützen.
**EV-05 SOLL:** Weitere Filter sollen Anfragequelle, zuständige Person und Ressource unterstützen.
**EV-06 MUSS:** Kacheln müssen Datum, Status, Hauptkontakt, Location, relevante Zeit und Auftragsart erkennen lassen.
**EV-07 SOLL:** Status und Auftragsart sollen farblich konfigurierbar sein.
**EV-08 SOLL:** Eigene Status müssen mit Name, Textfarbe, Hintergrundfarbe und Standardfilter definierbar sein.
**EV-09 SOLL:** Events sollen in separaten Browser-Tabs geöffnet werden können.
**EV-10 MUSS:** Der Benutzer muss ein Event manuell anlegen, bearbeiten, abschließen und stornieren können.
**EV-11 MUSS:** Das System muss Konflikte durch Kalendertermine und bereits eingeplante Ressourcen sichtbar machen.
**EV-12 SOLL:** Änderungen des Eventstatus sollen automatisch aus Geschäftsereignissen abgeleitet werden können, etwa „Angebot versendet“, „gebucht“ oder „abgeschlossen“.

### 6.2 Eventakte und Auftragsdetails

**EA-01 MUSS:** Eine Eventakte muss alle fachlich zugehörigen Informationen zusammenführen.
**EA-02 MUSS:** Stammdaten umfassen mindestens Eventdatum, Beginn, Ende, Auf-/Abbauzeit, Eventart, Status, Anfragequelle und Hauptkontakt.
**EA-03 SOLL:** Ein strukturierter Zeitplan muss mehrere Programmpunkte, Zeiten und Locations abbilden.
**EA-04 MUSS:** Pro Event müssen Notizen, eigene Felder, Dateien, E-Mails, Freigaben, Aufgaben und Ressourcen abrufbar sein.
**EA-05 SOLL:** Eine Verdienst-/Finanzansicht soll Angebotssumme, Rechnungen, Zahlungen und offenen Betrag zeigen.
**EA-06 MUSS:** Ein Logbuch muss relevante Ereignisse chronologisch darstellen.
**EA-07 MUSS:** Mehrere Kontakte müssen einem Event zugeordnet und ein Hauptkontakt festgelegt werden können.
**EA-08 SOLL:** Bei Paaren oder mehreren Vertragspartnern müssen Partnerdaten und getrennte Unterschriften unterstützt werden.
**EA-09 SOLL:** Eigene Felder müssen in Kategorien sortierbar und optional automatisch aufgeklappt sein.
**EA-10 SOLL:** Eigene Felder sollen Auswahllisten mit vorgegebenen Werten unterstützen.
**EA-11 MUSS:** Eigene Felder müssen als Platzhalter in Dokumenten und E-Mails nutzbar sein.
**EA-12 SOLL:** Antworten aus Kontaktformularen und Fragebögen sollen auf eigene Felder gemappt werden können.

### 6.3 Kontakte und Kundenverwaltung

**KO-01 MUSS:** Kontakte müssen manuell sowie während der Eventanlage angelegt werden können.
**KO-02 MUSS:** Das System muss Privat- und Firmenkunden, Anschrift, Adresszusatz, E-Mail und Telefonnummer verwalten.
**KO-03 MUSS:** Kontakte müssen gesucht, gefiltert, bearbeitet und archiviert werden können.
**KO-04 SOLL:** Kontakte müssen Gruppen/Schlagwörtern zugeordnet werden können.
**KO-05 SOLL:** Dubletten sollen erkannt und zusammengeführt werden können.
**KO-06 SOLL:** Zugehörige Events, E-Mails, Dateien, Angebote, Verträge, Rechnungen und Zahlungen sollen im Kontakt sichtbar sein.
**KO-07 SOLL:** Kontakte sollen automatisch zu Google Contacts und damit auf das Smartphone synchronisiert werden.
**KO-08 KANN:** Direkte Aktionen für Anruf, E-Mail und WhatsApp können angeboten werden.

### 6.4 Location, Strecke und Zeitplanung

**LO-01 MUSS:** Locations müssen mit Name, Adresse, Ansprechpartner, Telefon, E-Mail, Website und Notizen gespeichert werden können.
**LO-02 SOLL:** Eine Adresssuche soll Locationdaten automatisch ergänzen.
**LO-03 SOLL:** Entfernung und voraussichtliche Fahrzeit zwischen Betrieb, Eventorten und Zeitplanpunkten sollen berechnet werden.
**LO-04 SOLL:** Bei mehreren Orten müssen Fahrzeiten in den Zeitplan einfließen.
**LO-05 SOLL:** Wiederkehrende Locations sollen wiederverwendbar sein.
**LO-06 KANN:** Fahrtkosten können aus Entfernung, Zonen oder Pauschalen berechnet werden.

### 6.5 Anfragen und Kontaktformulare

**AN-01 MUSS:** Ein konfigurierbares Kontaktformular muss auf der eigenen Website eingebettet werden können.
**AN-02 MUSS:** Eine Formulareinsendung muss automatisch Kontakt und Anfrage/Event anlegen.
**AN-03 SOLL:** Formularfelder müssen auf Systemfelder und eigene Felder gemappt werden können.
**AN-04 SOLL:** Ein Formular-Builder soll Spaltenlayouts und Feldbausteine unterstützen.
**AN-05 MUSS:** Datenschutztext, Link und verpflichtende Einwilligung müssen konfigurierbar sein.
**AN-06 SOLL:** Mehrere Formulare, zum Beispiel Hochzeit, Firma und Selbstabholer, sollen unterstützt werden.
**AN-07 SOLL:** Nach Eingang muss automatisch eine Verfügbarkeitsprüfung erfolgen.
**AN-08 SOLL:** Je nach Ergebnis, Eventart oder Paketwunsch sollen unterschiedliche automatische Antworten möglich sein.
**AN-09 SOLL:** Bestehende Formulare sollen alternativ über eine Schnittstelle angebunden werden können.
**AN-10 KANN:** Zapier/Webhooks können Formulareingänge an Drittsysteme weitergeben.

### 6.6 Produkte, Pakete und Preislogik

**PR-01 MUSS:** Produkte und Dienstleistungen müssen mit Bezeichnung, Beschreibung, Preis, Steuersatz und Einheit gepflegt werden.
**PR-02 MUSS:** Produkte müssen zu wiederverwendbaren Fotobox-Paketen kombiniert werden können.
**PR-03 SOLL:** Optionale Zusatzprodukte müssen im Angebot und Kundenportal auswählbar sein.
**PR-04 MUSS:** Die Angebotssumme muss sich bei Mengen, Optionen und Rabatten automatisch aktualisieren.
**PR-05 SOLL:** Unterschiedliche Paketvarianten, Laufzeiten, Abholung/Lieferung sowie Auf-/Abbauleistungen sollen abbildbar sein.
**PR-06 SOLL:** Angebotspositionen sollen automatisch Ressourcen oder Ressourcensets zuordnen können.
**PR-07 SOLL:** Produkte und Kontakte sollen aus Buchhaltungssystemen per CSV importiert werden können.

### 6.7 Ressourcen- und Bestandsplanung

**RE-01 MUSS:** Ressourcen müssen als einzelne Artikel, feste Cases oder logisch zusammengesetzte Sets geführt werden können.
**RE-02 MUSS:** Ressourcen müssen Typen und Kategorien besitzen und durchsuch-/filterbar sein.
**RE-03 MUSS:** Für Artikel und Cases muss ein zeitabhängiger Bestand gepflegt werden können.
**RE-04 MUSS:** Sets müssen ihre Verfügbarkeit aus den enthaltenen Ressourcen berechnen.
**RE-05 MUSS:** Pro Event müssen eine oder mehrere Planungsgruppen mit eigenem Von-/Bis-Zeitraum anlegbar sein.
**RE-06 MUSS:** Der Planungszeitraum darf vom eigentlichen Eventzeitraum abweichen.
**RE-07 MUSS:** Ressourcen müssen mit benötigter Menge einer Planungsgruppe zugeordnet werden.
**RE-08 MUSS:** Das System muss verfügbar, reserviert/bestätigt und Unterdeckung eindeutig unterscheiden.
**RE-09 MUSS:** Doppelbelegungen und Mengenengpässe müssen bereits vor Bestätigung angezeigt werden.
**RE-10 SOLL:** Reservierungen sollen bei Angebotsannahme oder Vertragsabschluss automatisch bestätigt werden.
**RE-11 SOLL:** Ressourcen sollen über Angebots-/Vertragspositionen automatisch eingeplant werden.
**RE-12 SOLL:** Die Zeitachse soll parallele Events, Planungsgruppen und den Ressourcenstatus anzeigen.
**RE-13 MUSS:** Ressourcen müssen archiviert werden können; eine endgültige Löschung ist nur ohne relevante Verknüpfungen zulässig.
**RE-14 SOLL:** Seriennummer, Lagerort, Zustand, Wartung, Ersatzwert und Foto sollen je Ressource hinterlegbar sein.
**RE-15 SOLL:** Für Fotoboxen sollen Pufferzeiten für Laden, Transport, Aufbau, Abbau und Rückprüfung berücksichtigt werden.

### 6.8 Aufgaben und operative Checklisten

**AU-01 MUSS:** Aufgaben müssen eventbezogen oder allgemein angelegt werden können.
**AU-02 MUSS:** Aufgaben benötigen Titel, Beschreibung, Fälligkeit, Status und Zuständigkeit.
**AU-03 SOLL:** Aufgaben müssen in einer Gesamtübersicht und in der jeweiligen Eventakte erscheinen.
**AU-04 SOLL:** Überfällige Aufgaben müssen hervorgehoben und gemeldet werden.
**AU-05 SOLL:** Aufgaben müssen durch Workflows relativ zum Eventdatum oder zu Statusänderungen erzeugt werden können.
**AU-06 SOLL:** Wiederverwendbare Checklisten sollen etwa Printlayout, Funktionsprüfung, Packen, Aufbau, Abholung und Datenlöschung abdecken.
**AU-07 KANN:** Eine einseitige Synchronisation zu Google Tasks kann angeboten werden.
**AU-08 SOLL:** Mobile Nutzer sollen Aufgaben direkt vor Ort erledigt markieren und Notizen/Fotos ergänzen können.

### 6.9 E-Mail-Postfach und Kommunikation

**EM-01 MUSS:** Ein vorhandenes E-Mail-Konto muss mit dem System verbunden werden können.
**EM-02 MUSS:** Eingehende und ausgehende Nachrichten müssen dem passenden Kontakt und Event zugeordnet werden.
**EM-03 MUSS:** Eine falsche oder fehlende Zuordnung muss manuell korrigiert werden können.
**EM-04 SOLL:** Anhänge eingehender Nachrichten sollen automatisch in der Eventakte gespeichert werden.
**EM-05 MUSS:** E-Mails müssen im zentralen Postfach und eventbezogen lesbar sein.
**EM-06 MUSS:** Vorlagen müssen Name, Betreff, formatierten Text, Platzhalter und Standardanhänge enthalten können.
**EM-07 MUSS:** Eine Vorlage muss vor Versand vollständig bearbeitbar bleiben.
**EM-08 SOLL:** Beim Laden einer Vorlage soll wählbar sein, ob vorhandene Empfänger und Betreff überschrieben werden.
**EM-09 MUSS:** E-Mails müssen als Entwurf gespeichert und geplant versendet werden können.
**EM-10 SOLL:** Automatisierte E-Mails sollen optional eine manuelle Freigabe vor Versand verlangen.
**EM-11 SOLL:** Öffnungen von Angebot/Vertrag beziehungsweise Portalaufrufe sollen als Status sichtbar sein.
**EM-12 MUSS:** Eine individuelle Signatur muss konfigurierbar sein.
**EM-13 SOLL:** Dokumente und Portal-Link müssen direkt beim Verfassen eingefügt werden können.
**EM-14 SOLL:** Versandfehler und erfolgreich geplante Sendungen müssen gemeldet und protokolliert werden.

### 6.10 Dokumente, Angebote und Verträge

**DO-01 MUSS:** Das System muss Dokumentvorlagen für Angebot, Auftragsbestätigung, Vertrag, Rechnung, Rechnungskorrektur, Fragebogen und Infosheet unterstützen.
**DO-02 MUSS:** Pro Dokumentart müssen mehrere Vorlagen möglich sein.
**DO-03 MUSS:** Vorlagen müssen Platzhalter für Kontakt-, Event-, Location-, Produkt- und eigene Felder unterstützen.
**DO-04 MUSS:** Dokumente müssen aus einer Eventakte heraus erzeugt und als PDF ausgegeben werden können.
**DO-05 MUSS:** Angebote müssen Positionen, Mengen, Einzel-/Gesamtpreise, Steuern, Rabatte und Gültigkeitsfrist abbilden.
**DO-06 SOLL:** Ein Angebot soll in Auftragsbestätigung, Vertrag und Rechnung überführt werden, ohne Positionen neu zu erfassen.
**DO-07 MUSS:** Verträge müssen online freigegeben und elektronisch unterschrieben werden können.
**DO-08 SOLL:** Bei zwei Vertragsparteien müssen beide Unterschriften verlangt werden können.
**DO-09 MUSS:** Dokumentstatus wie Entwurf, freigegeben, angesehen, angenommen, unterschrieben, abgelaufen und storniert muss nachvollziehbar sein.
**DO-10 SOLL:** AGB, Datenschutz, Widerruf und optionale Zustimmungen sollen als Pflicht- oder Wahl-Checkboxen eingebunden werden können.
**DO-11 SOLL:** Logo, Briefpapier, Farben und Schriftart müssen konfigurierbar sein.
**DO-12 SOLL:** Eigene oder externe Dateien müssen einer Eventakte hinzugefügt und im Portal freigegeben werden können.
**DO-13 SOLL:** Dokumente sollen versioniert oder zumindest nach Freigabe unveränderbar archiviert werden.

### 6.11 Fragebögen und Informationssammlung

**FB-01 MUSS:** Wiederverwendbare Fragebogenvorlagen müssen erstellt werden können.
**FB-02 MUSS:** Fragebögen müssen im Kundenportal mobil ausgefüllt werden können.
**FB-03 MUSS:** Eingaben müssen zwischengespeichert werden, sodass eine Bearbeitung über mehrere Sitzungen möglich ist.
**FB-04 SOLL:** Antworten dürfen durch vorhandene Eventdaten vorbefüllt werden.
**FB-05 MUSS:** Nach Absenden müssen Status, Benachrichtigung und Antworten in der Eventakte verfügbar sein.
**FB-06 SOLL:** Antworten müssen auf eigene Felder übertragen und in weiteren Dokumenten verwendet werden können.
**FB-07 SOLL:** Ein Fragebogen soll zur Korrektur erneut geöffnet werden können.
**FB-08 SOLL:** Nicht beantwortete Fragebögen müssen automatisch erinnert oder intern nachverfolgt werden können.
**FB-09 MUSS:** Für Fotoboxen sollen mindestens Printdaten, Namen/Anlass, Wunschlayout, Hintergrund, Wunschmotive, Aufbau-/Abbauzeit, Ansprechpartner und Besonderheiten abfragbar sein.

### 6.12 Kundenportal und Freigaben

**KP-01 MUSS:** Für einen Kunden muss ein eigener Portalzugang pro Event angelegt werden können.
**KP-02 MUSS:** Der Zugang muss durch einen individuellen, direkt nutzbaren Link geschützt sein; optional zusätzlich durch Passwort.
**KP-03 SOLL:** Zugänge müssen zeitlich befristet und deaktivierbar sein.
**KP-04 MUSS:** Je Zugang muss festgelegt werden, welche Dokumente und Dateien sichtbar sind.
**KP-05 SOLL:** Mehrere Zugänge mit unterschiedlichen Freigaben pro Event sollen möglich sein.
**KP-06 MUSS:** Der Sachbearbeiter muss eine Vorschau aus Kundensicht öffnen können.
**KP-07 MUSS:** Kunden müssen Angebote annehmen, Verträge unterschreiben und Fragebögen absenden können.
**KP-08 SOLL:** Optionale Produkte oder Rechte müssen per Checkbox gewählt werden können; der Gesamtpreis muss neu berechnet werden.
**KP-09 MUSS:** Vor Annahme/Unterschrift müssen erforderliche Rechnungs- und Kontaktdaten vervollständigt werden.
**KP-10 SOLL:** Der Kunde soll alle freigegebenen Unterlagen eines Events über denselben Zugang erreichen.
**KP-11 MUSS:** Annahme, Unterschrift, Fragebogenabgabe und Ansicht müssen mit Zeitpunkt protokolliert und intern gemeldet werden.
**KP-12 MUSS:** Das Portal muss auf Smartphone, Tablet und Desktop funktionieren.

### 6.13 Rechnungen und Zahlungen

**RG-01 MUSS:** Rechnungen müssen alle in Deutschland erforderlichen Pflichtangaben unterstützen.
**RG-02 MUSS:** Rechnungen sollen direkt aus angenommenen Angeboten/Auftragsbestätigungen erzeugt werden.
**RG-03 MUSS:** Anzahlungsrechnungen müssen als fester Betrag oder Prozentsatz erzeugt werden können.
**RG-04 MUSS:** Schlussrechnungen müssen Anzahlungen korrekt ausweisen und verrechnen.
**RG-05 MUSS:** Rechnungsnummernkreise, Rechnungs-/Leistungsdatum, Zahlungsziel und Steuersätze müssen konfigurierbar sein.
**RG-06 MUSS:** Kleinunternehmerregelung und entsprechender Rechnungshinweis müssen unterstützt werden.
**RG-07 SOLL:** Rechnungskorrekturen/Stornorechnungen müssen aus bestehenden Rechnungen abgeleitet werden.
**RG-08 MUSS:** Zahlungen müssen mit Betrag, Datum, Zahlungsart und Referenz erfasst werden können.
**RG-09 MUSS:** Offen, teilweise bezahlt, bezahlt und überfällig müssen unterscheidbar sein.
**RG-10 SOLL:** Überfällige Rechnungen sollen Benachrichtigungen und Mahn-/Erinnerungsprozesse auslösen.
**RG-11 SOLL:** Ein SEPA-Zahlungs-QR-Code kann auf Rechnungen ausgegeben werden.
**RG-12 SOLL:** Rechnungen sollen manuell oder per Workflow an ein Buchhaltungssystem übertragen werden.
**RG-13 SOLL:** Vor externer Übertragung muss festlegbar sein, welches System die Rechnungsnummer vergibt.

### 6.14 Automationen und Workflows

**WF-01 SOLL:** Administratoren müssen wiederverwendbare Workflows grafisch oder schrittweise konfigurieren können.
**WF-02 SOLL:** Auslöser müssen mindestens neue Anfrage, Statusänderung, Dokumentfreigabe/-annahme/-unterschrift, Fragebogenabgabe, Datum relativ zum Event und Zahlung unterstützen.
**WF-03 SOLL:** Bedingungen müssen mindestens Eventart, Auftragsart, Status, Verfügbarkeit, Paket, Formular und Datenvollständigkeit prüfen können.
**WF-04 SOLL:** Aktionen müssen E-Mail senden, Aufgabe anlegen, Dokument erzeugen, Fragebogen erzeugen, Vertrag erzeugen, Portalzugang anlegen, Dokument freigeben, Status ändern, Verfügbarkeit prüfen und Daten an Buchhaltung übertragen umfassen.
**WF-05 SOLL:** Schritte müssen feste oder relative Wartezeiten sowie „warte bis Ereignis“ unterstützen.
**WF-06 SOLL:** Für ausbleibende Reaktionen muss ein Alternativpfad möglich sein.
**WF-07 SOLL:** Nach einem Alternativschritt soll der Workflow optional weiter auf die ursprüngliche Reaktion warten.
**WF-08 SOLL:** Kritische Schritte müssen eine manuelle Freigabe verlangen können.
**WF-09 MUSS:** Jede Ausführung muss mit Schritt, Zeitpunkt, Ergebnis und Fehler im Logbuch nachvollziehbar sein.
**WF-10 SOLL:** In der Vorlagenübersicht muss sichtbar sein, in welchen Events ein Workflow aktiv ist.
**WF-11 SOLL:** Fehlerhafte Automationen müssen eine Benachrichtigung erzeugen und manuell wiederaufnehmbar sein.
**WF-12 KANN:** Workflows sollen versionierbar, duplizierbar, exportierbar und testbar sein.

### 6.15 Kalender und Verfügbarkeit

**KA-01 MUSS:** Events müssen in einen externen Kalender ausgegeben werden können.
**KA-02 SOLL:** Google Kalender soll bidirektional für Eventeinträge angebunden werden; private Termine müssen zumindest zur Verfügbarkeitsprüfung eingelesen werden.
**KA-03 SOLL:** Apple/iCloud und Outlook sollen über Kalender-Abo beziehungsweise ICS eingebunden werden.
**KA-04 MUSS:** Je Kalender muss festlegbar sein, ob er Zielkalender, Prüfkalender oder beides ist.
**KA-05 SOLL:** Eventstatus, Ort, Notizen und interner Event-Link sollen im Kalendereintrag erscheinen.
**KA-06 SOLL:** Stornierte Events müssen aus dem Zielkalender entfernt werden.
**KA-07 SOLL:** Vermittlungen müssen optional in separate Kalender geschrieben werden.
**KA-08 SOLL:** Ganztägige oder zeitgenaue Einträge müssen konfigurierbar sein.
**KA-09 MUSS:** Verfügbarkeit muss Kalenderkonflikte und Ressourcenengpässe getrennt ausweisen.

### 6.16 Dienstleister-Netzwerk und Agenturmodus

**DN-01 KANN:** Externe oder im System registrierte Dienstleister müssen als Partnerkontakte verwaltet werden können.
**DN-02 KANN:** Dienstleister müssen nach Sparte, Entfernung und Verfügbarkeit gesucht werden können.
**DN-03 KANN:** Verfügbarkeitsanfragen sollen Datum, Eventart und Ort übermitteln.
**DN-04 KANN:** Bei verbundenen Konten soll Verfügbarkeit automatisch sichtbar sein.
**DN-05 KANN:** Freizugebende Kunden-/Eventdaten müssen explizit auswählbar sein.
**DN-06 KANN:** Status der Vermittlung muss manuell oder durch Antwort/Verbindung aktualisiert werden.
**DN-07 KANN:** Der Agenturmodus soll Events mit Vermittlungen, Fortschritt und Status gebündelt anzeigen.
**DN-08 KANN:** Ein Filter „Events ohne Vermittlung“ soll unbearbeitete Fälle hervorheben.
**DN-09 KANN:** Partner müssen bookitup beziehungsweise das eigene System nicht zwingend selbst nutzen.

### 6.17 Benachrichtigungen und Logbuch

**BL-01 MUSS:** Es muss ein internes Benachrichtigungszentrum mit Ungelesen-Markierung geben.
**BL-02 SOLL:** Benachrichtigungen sollen zusätzlich per E-Mail und mobil als Push möglich sein.
**BL-03 MUSS:** Meldungen umfassen mindestens neue Anfrage, Verfügbarkeit, Angebot angenommen/abgelaufen, Vertrag unterschrieben, Fragebogen abgesendet, neue E-Mail, überfällige Aufgabe, überfällige Rechnung und Automationsfehler.
**BL-04 MUSS:** Das Eventlogbuch muss Anlage, Formularquelle, Statusänderungen und Kundenaktionen chronologisch protokollieren.
**BL-05 SOLL:** Logbucheinträge sollen direkt zu erzeugten Dokumenten, E-Mails oder Workflow-Schritten führen.
**BL-06 SOLL:** Benutzer müssen Benachrichtigungskanäle und Ereignisse konfigurieren können.

### 6.18 Statistiken und Controlling

**ST-01 SOLL:** Statistiken müssen nach Jahr, Auftragsart und Anfragequelle filterbar sein.
**ST-02 SOLL:** Jahre und Zeiträume sollen vergleichbar sein.
**ST-03 SOLL:** Erwarteter Umsatz soll aus bestätigten Angeboten/Auftragsbestätigungen berechnet werden.
**ST-04 SOLL:** Erhaltene und erwartete Zahlungen sowie offene/überfällige Rechnungen müssen auswertbar sein.
**ST-05 SOLL:** Verteilung nach Auftragsart, Buchungsstatus und Anfragequelle soll grafisch dargestellt werden.
**ST-06 SOLL:** Buchungsquote und Absagegründe sollen auswertbar sein.
**ST-07 SOLL:** Für den Fotoboxbetrieb sollen Auslastung, Umsatz je Box/Paket und Engpasstage ausgewertet werden.
**ST-08 KANN:** Kennzahlen sollen als CSV/XLSX exportiert werden können.

### 6.19 Integrationen und Datenaustausch

**IN-01 SOLL:** Google Kalender, Google Contacts und Google Tasks sollen getrennt aktivierbar sein.
**IN-02 SOLL:** Kontakte und Aufgaben sollen vollständig initial exportiert und anschließend automatisch synchronisiert werden können.
**IN-03 MUSS:** Die Richtung jeder Synchronisation muss dokumentiert und sichtbar sein; bei Google Tasks ist öffentlich nur bookitup → Google dokumentiert.
**IN-04 SOLL:** Buchhaltungsanbindungen sollen mindestens Lexware Office sowie optional sevDesk, DATEV und Accountable berücksichtigen.
**IN-05 SOLL:** Eine generische Webhook-/Zapier-Schnittstelle soll externe Prozesse anbinden.
**IN-06 SOLL:** Kontakte, Produkte, Events, Rechnungen und Zahlungen müssen per CSV importier-/exportierbar sein.
**IN-07 MUSS:** Ein vollständiger Datenexport für Migration und Datenauskunft muss möglich sein.
**IN-08 KANN:** Eine Terminbuchung über Calendly oder einen eigenen Terminplaner kann Events beziehungsweise Aufgaben ergänzen.

### 6.20 Mobile Nutzung

**MO-01 MUSS:** Die Anwendung muss responsiv auf Smartphone, Tablet und Desktop funktionieren.
**MO-02 SOLL:** Sie soll als Progressive Web App zum Homebildschirm hinzugefügt werden können.
**MO-03 SOLL:** Push-Benachrichtigungen sollen auf unterstützten Geräten möglich sein.
**MO-04 MUSS:** Vor Ort müssen Eventdetails, Ansprechpartner, Zeitplan, Location, Aufgaben, Ressourcen und Notizen schnell erreichbar sein.
**MO-05 KANN:** Kritische Informationen können für kurzfristige Netzunterbrechungen offline zwischengespeichert werden.

## 7. Fachliches Statusmodell

Das System muss ein konfigurierbares Statusmodell unterstützen. Als Ausgangspunkt:

1. Neue Anfrage
2. Verfügbarkeit geprüft
3. Angebot in Vorbereitung
4. Angebot versendet
5. Nachfassen
6. Option/Reserviert
7. Vertrag versendet
8. Gebucht/Bestätigt
9. Vorbereitung
10. Durchgeführt
11. Schlussrechnung offen
12. Abgeschlossen
13. Abgesagt/Annulliert

Statuswechsel sollen manuell und durch Workflows möglich sein. Pflichtprüfungen, etwa ein Ressourcenengpass vor „Gebucht“, müssen konfigurierbar sein.

## 8. Nichtfunktionale Anforderungen

**NF-01 Datenschutz:** DSGVO-konforme Verarbeitung, Auftragsverarbeitung, Lösch-/Sperrkonzept, Auskunft und Datenexport.
**NF-02 Hosting:** Bevorzugt Hosting und Backups in Deutschland oder der EU.
**NF-03 Sicherheit:** TLS, sichere Passwortspeicherung, optional Zwei-Faktor-Authentifizierung, Least-Privilege-Rechte und Schutz vor Brute Force.
**NF-04 Nachvollziehbarkeit:** Geschäftskritische Änderungen und Kundenaktionen müssen revisionsnah protokolliert werden.
**NF-05 Verfügbarkeit:** Zielwert für den Produktivbetrieb mindestens 99,5 % im Monatsmittel.
**NF-06 Backup:** Automatische tägliche Backups, definierte Aufbewahrung und regelmäßig getestete Wiederherstellung.
**NF-07 Performance:** Häufige Ansichten sollen bei normaler Last innerhalb von zwei Sekunden nutzbar sein.
**NF-08 Skalierung:** Parallele Vermietungen, mehrere Standorte, Benutzer und mindestens mehrere hundert Ressourcen müssen ohne Strukturwechsel möglich sein.
**NF-09 Bedienbarkeit:** Kernvorgänge müssen mobil und ohne horizontales Scrollen bedienbar sein.
**NF-10 Barrierearmut:** Semantische Bedienung, Tastaturnavigation, Kontraste und verständliche Fehlermeldungen.
**NF-11 Wartbarkeit:** Fachmodule, Schnittstellen, Vorlagen und Workflows müssen unabhängig weiterentwickelbar sein.
**NF-12 Datenintegrität:** Nummernkreise, Zahlungen, Rechnungen und Ressourcenreservierungen benötigen Transaktionsschutz und Eindeutigkeitsregeln.

## 9. Priorisierung für die Eigenentwicklung

### Phase 1 – produktiver Kern

- Anmeldung und Rollenbasis
- Kontakte und Firmenkunden
- Eventakte, Status, Kalender-/Listenübersicht
- Produkte/Pakete und Ressourcenverfügbarkeit
- Aufgaben und Fotobox-Checklisten
- Angebote, Verträge, Rechnungen und PDF-Vorlagen
- Kundenportal mit Angebot, Vertrag und Fragebogen
- E-Mail-Vorlagen und grundlegender Versand
- Kalenderausgabe und Buchhaltungs-Export
- Logbuch, Datenschutz, Backup und Datenexport

### Phase 2 – Zeitersparnis und Qualität

- Vollständiges Postfach mit automatischer Zuordnung
- Workflow-Engine mit Warte-/Alternativschritten und Freigaben
- Kontaktformular-Builder
- Erweiterte Ressourcen-Zeitleiste
- Zahlungsstatus, Erinnerungen und Statistiken
- Google-Synchronisation und Push
- Teamrechte und mobile Teamansicht

### Phase 3 – Ausbau

- Agenturmodus und Dienstleister-Netzwerk
- Zapier/Webhooks und weitere Buchhaltungssysteme
- Mehrere Unternehmensprofile/Marken
- Erweiterte Controlling-, Export- und Offline-Funktionen

## 10. Abnahmekriterien für einen ersten MVP

Der MVP ist fachlich abnahmefähig, wenn ein realer Fotoboxauftrag vollständig ohne Parallellisten abgewickelt werden kann:

1. Eine Website-Anfrage erzeugt Kontakt und Event.
2. Kalender- und Ressourcenprüfung zeigen frei oder Konflikt nachvollziehbar an.
3. Aus einem Paket entsteht ein korrektes Angebot als PDF und Portalansicht.
4. Der Kunde kann das Angebot annehmen, Daten ergänzen und den Vertrag unterschreiben.
5. Ressourcen werden reserviert und vorbereitende Aufgaben automatisch angelegt.
6. Ein Fragebogen sammelt Print-, Aufbau- und Ansprechpartnerdaten.
7. Alle Kommunikation und Dateien sind in der Eventakte auffindbar.
8. Anzahlung und Schlussrechnung werden korrekt erzeugt und Zahlungen verbucht.
9. Stornierung hebt zukünftige Kalender- und Ressourcenbelegungen nachvollziehbar auf.
10. Jeder geschäftskritische Schritt ist im Logbuch mit Zeitpunkt und Akteur sichtbar.

## 11. Noch zu verifizieren

Für den Abgleich mit dem angemeldeten Konto sind insbesondere zu prüfen:

- vollständige Hauptnavigation und alle Unterseiten,
- genaue Felder und Aktionen der Eventakte,
- aktuelle Dokumentarten, Statuswerte und Nummernkreislogik,
- verfügbare Workflow-Auslöser, Bedingungen und Aktionen,
- Produkt-/Paketverwaltung und Kopplung an Ressourcen,
- aktueller Umfang von Teamfreigaben und Rechtemanagement,
- tatsächlich angebotene Buchhaltungsintegrationen,
- Im-/Exportmöglichkeiten und Datenexport,
- Benachrichtigungseinstellungen,
- konto- oder tarifabhängige Funktionen,
- neue Funktionen, die nach Aktualisierung des öffentlichen Hilfecenters hinzugekommen sind.

## 12. Referenzquellen

- [bookitup für Fotobox-Verleiher](https://bookitup.de/loesungen/fotoboxverleih/)
- [bookitup – Produktüberblick](https://bookitup.de/)
- [Funktions- und Tarifvergleich](https://bookitup.de/preise/)
- [Hilfecenter – Themenübersicht](https://bookitup.de/hilfe/)
- [Event anlegen](https://bookitup.de/hilfe/event-anlegen/)
- [Eventübersicht](https://bookitup.de/hilfe/die-eventuebersicht/)
- [Eigene Felder](https://bookitup.de/hilfe/eigene-felder-nutzen/)
- [Eigener Event-Status](https://bookitup.de/hilfe/eigener-event-status/)
- [Aufgaben](https://bookitup.de/hilfe/wie-benutzt-man-aufgaben/)
- [Kontakte](https://bookitup.de/hilfe/kundenkontakte-verwalten/)
- [Partnerkontakte](https://bookitup.de/hilfe/partner-kontakte/)
- [Angebote und Verträge](https://bookitup.de/funktionen/angebote-und-vertraege/)
- [Dokumentvorlagen](https://bookitup.de/hilfe/dokument-vorlagen/)
- [Rechnungen und Zahlungen](https://bookitup.de/funktionen/rechnungsprogramm-fuer-eventdienstleister/)
- [Fristen](https://bookitup.de/hilfe/fristen-anlegen/)
- [Fragebögen](https://bookitup.de/funktionen/frageboegen/)
- [Kundenportal-Zugang](https://bookitup.de/hilfe/kundenportal-zugang-erstellen/)
- [Kundenportal-Freigaben](https://bookitup.de/hilfe/kundenportal-richtig-freigeben/)
- [Digitale Unterschriften](https://bookitup.de/hilfe/digitale-unterschriften/)
- [E-Mail-Vorlagen](https://bookitup.de/hilfe/e-mail-vorlagen-erstellen/)
- [Manuelle E-Mail-Zuordnung](https://bookitup.de/hilfe/e-mails-einem-kunden-manuell-zuweisen/)
- [Workflows und Automationen](https://bookitup.de/hilfe/workflows-automationen/)
- [Benachrichtigungen und Logbuch](https://bookitup.de/hilfe/benachrichtigungen-logbuch-in-bookitup/)
- [Kalender-Anbindung](https://bookitup.de/hilfe/kalender-verbinden/)
- [Google-Synchronisation](https://bookitup.de/hilfe/google-sync-mit-bookitup/)
- [Kontaktformular](https://bookitup.de/hilfe/webseiten-kontaktformular-mit-bookitup/)
- [Lexware-Office-Anbindung](https://bookitup.de/hilfe/lexoffice-anbindung/)
- [Ressourcenmodul](https://bookitup.de/hilfe/basis-wissen/)
- [Dienstleister-Netzwerk](https://bookitup.de/funktionen/dienstleister-netzwerk-fur-agenturen/)
- [Agenturmodus](https://bookitup.de/hilfe/der-agenturmodus/)
- [Statistiken](https://bookitup.de/hilfe/statistik-tab/)

## 13. Rechtlicher Hinweis

Dieses Dokument beschreibt beobachtete beziehungsweise öffentlich dokumentierte Produktfunktionen als fachliche Anforderungen. Es übernimmt weder Quellcode noch geschützte Gestaltungselemente, Texte oder interne Implementierungsdetails von bookitup. Die eigene Anwendung sollte eine eigenständige Benutzerführung, Gestaltung und technische Umsetzung erhalten.
