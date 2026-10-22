# Beobachtungen, Funktionsparität und offene Beweise

Basis und Datenschutz: [Einstieg](README.md). **B** = Bookitup im echten Browser gesehen, **A** = AuftragsKompass im echten Browser gesehen, **S** = Quellbefund bei cf68f1e, **Z** = vorgeschlagenes Ziel, **U** = nicht abschließend geprüft. „S vorhanden“ heißt nicht automatisch im echten Betrieb abgenommen. Keine externen Server-Interna aus sichtbaren Knöpfen ableiten.

## Aufnahmeprotokoll und Grenzen

| Beleg | Gesehene Oberfläche / Erkenntnis |
| --- | --- |
| B01 | Desktop-Eventliste mit linker Filterspalte, Monatsgruppen und Datumskarten |
| B02 | Desktop-Monatskalender, Mo–So, Monat/Woche/Tag, Navigation unter dem Raster |
| B03 | Weiterhin Desktop-Kalender; Dateiname enthält irreführend „mobile“, kein Mobilbeweis |
| B04 | Event-Details: Allgemein, Zeitplan, Eigene Felder, Notizen, Workflows, Logbuch; rechte Kontextspalte |
| B05 | Event-Dateien mit getrennten Karten Dokumente, Verträge, Fragebögen, Uploads, E-Mail-Anhänge |
| B06, B32 | Dokument-Plus öffnet Typ-/Vorlagen-/Kundenpicker; vorhandene Vorlagen angeboten; Übernehmen nicht betätigt |
| B07 | Event-Ressourcen durch Testphase-Dialog begrenzt; danach lediglich leere Planungsgruppen sichtbar |
| B08 | Event-Posteingang als Liste plus Nachrichtenbereich; leerer Zustand |
| B09 | Neue Nachricht öffnet Editor ohne Auswahl einer Inhaltsvorlage, mit Absender und Eventkontakt |
| B10 | Separate Mailvorlagen-Auswahl, Suchauswahl und zunächst deaktiviertes Fertig |
| B11 | Kontaktliste, Suche, Alle Kontakte/Dienstleister/Gruppen, Tabelle, Seitennavigation |
| B12 | Kontakt-Details, Dateien, Mailordner, Notizen, Aufgaben, zugeordnete Events mit Chronologisch/Ohne Datum/Vermittlungen |
| B13 | Kontakt-Bearbeitungsdialog mit Privat/Firma, Anrede, getrennten Namen, Geburtstag, Partner, Adresse, Land, Telefonen, Mail, Website, Gruppen |
| B14 | Einstellungsnavigation, darunter E-Mail, Dokumente, Ressourcen, Dateien, Aufgaben-/Workflow-Konfiguration |
| B15 | Produkte mit Brutto/Netto, Positionen, Menge, Einheit, Preis, Steuer, Prozent-/Euro-Rabatt, Beschreibung, Ressourcenbezug |
| B16 | Dokumentvorlagen nach Dokumentart, Bearbeitungszeitpunkte, Fristen |
| B17 | Angebotsvorlagen-Editor: Inhalt, Einwilligungen, Einstellungen; Vorschau; Positionen und Texte; #-Platzhalterhinweis |
| B18 | Vorlageneinstellungen: Sprache, Frei-Kilometer und Fahrtkostenschwelle; nur beobachtet, keine Berechnung bestätigt |
| B19 | Mailvorlagen-Liste mit Gruppen-Tab und Kontextaktionen |
| B20 | Mailvorlagen-Editor: Betreff, Nachricht, Platzhalter und Dokumentanhang-Voreinstellung |
| B21, B22 | Dateinamen „mobile“, aber Bookitup blieb bei Desktopbreite. Nicht als responsive Verifikation verwenden |
| B23 | Globale Dokumentliste: Kunde/Suche, Dokumentarten, Datums-Presets, Entwurf/Fertig; Status, Nummer, Name, Datum, Betrag, Frist, Event, Portal |
| B24 | Bestehendes Dokument führt zur Vorschau. Nach Laden: Bearbeiten, Online freigeben, E-Mail an Kunden, Download, Drucken |
| B25 | Bearbeiten eines fertigen Dokuments öffnet Warnung „Dokument bereits fertig“; nicht bestätigt, Editor dahinter nicht untersucht |
| B26, B28 | Globale Ressourcen und deren Plus öffnen Trial-Dialog; nicht aktiviert |
| B27 | Nach Schließen: Ressourcen-Suche, Typ Set/Case/Item, Kategorie, Archivfilter und leere Liste |
| B29 | Aufgaben mit Datumsbereich/Shortcuts, Gruppen und fertige Aufgaben; Liste in diesem Zustand leer |
| B30 | Event-Anlage: Datum als Monatsauswahl, Kundensuche/neuen Kunden anbieten, Eventart, Speichern; nicht ausgefüllt |
| B31 | Globales Postfach: Eingang, Unerledigt, ohne Eventbezug, Gesendet, Entwürfe, Geplant, Fehlgeschlagen, Papierkorb; zusätzliche Postfach-Einrichtung |
| A01–A02 | AuftragsKompass bei gemessenen 390×844 CSS-Pixeln: Events und Monatskalender, dunkles Theme |
| A03–A04 | Desktop-Eventfilter und kompakter Event-Anlegedialog |
| A05–A06 | Kontaktliste und leerer Kontakt-Anlegedialog |
| A07–A10 | Einstellungen, Ressourcen, Produkte, Dokumentvorlagen |
| A11–A12 | Globale Dateienliste und geöffnete Event-Details |

Die Browser-Viewportfunktion änderte die AuftragsKompass-Ansicht zuverlässig (DOM-Messung 390×844), Bookitup blieb während dieser Versuche bei 1663 px Breite. Temporäre Overrides wurden zurückgesetzt. Die sechs vom Benutzer gelieferten Smartphonebilder belegen Bookitup-Listen, Drawer, Detail-/Dateibereiche und untere Navigation; **sie enthalten keinen Kalender**. Exakte Bookitup-Mobilkalender-Geometrie, Touchgesten, iOS/Safari und Browser-Tastatur sind deshalb U und in BKP030 nachzuholen. Nicht den Desktop-Screenshot verkleinern und als mobile Referenz ausgeben.

## 1. Navigation und Hierarchie

**B:** Desktop: schmale globale Iconleiste, daneben kontextbezogene Navigation/Filter, dann Arbeitsfläche; in Events zusätzlich rechte Kontextspalte. Globale Bereiche Events, Ressourcen, Aufgaben, Postfach, Kontakte, Dokumente, Statistiken. Einstellungen/Account getrennt unten. Innerhalb eines Events wechselt die Kontextnavigation auf Details, Ressourcen, Dateien, E-Mails mit Unterordnern, Freigaben, Verdienst. Die gelieferten Mobilbilder zeigen Drawer, Eventkopf mit Zurück und untere Kontextnavigation; weitere Bereiche hinter Mehr.

**A/S:** `Navigation.tsx`, `AuthPanel.tsx`: Events, Kalender, Dateien, Kontakte, Einstellungen. Ressourcen/Produkte unter Einstellungen, alte Hashes weiter gültig. Desktop einklappbar mit `ak-sidebar`, mobiler modaler Drawer und benannte Icons. „Navigation einklappen“ steht auffällig vor der Marke. Event-Details besitzen vier Bereiche Übersicht/Ressourcen/Notizen/Logbuch, Dokumente liegen noch in Übersicht. Kein Postfach, keine Aufgaben, keine Event-Dateien/-Mails.

**Z:** Arbeitskontext wie Bookitup; keine wahllose flache Linkliste. Neue Bereiche erst mit funktionsfähigem Unterbau. Ressourcenverwaltung und Ressourcenbelegung unterscheiden. Der Wunsch nach Bookitup-Nähe erlaubt eine spätere Hauptnavigation für operative Ressourcen, revidiert aber nicht beiläufig die bereits beauftragte H033-Verschiebung: BKP009 startet im vorhandenen Einstellungsbereich; eine globale Verknüpfung kommt nur mit fertigem operativem Bereich. BKP006/BKP013/BKP022.

## 2. Eventliste und Filter

**B:** Linke Filterspalte mit Suche, Ansicht (Liste/Kalender/Zeitleiste), Sortieren (Chronologisch/Ohne Datum/Neue Anfragen mit Zähler), Datumsbereich (Monat und Jahr), Dieser Monat/Nächste Events/Nächster Monat, Buchungsstatus, Auftragsarten, Optionen (Termine anzeigen; Solo/Agentur). Hauptliste nach Monaten, Monatsanzahl, Datum deutlich, Status als schmale farbige Markierung, Typ/Name/Ort, Öffnungsaktion. Die sichtbare Filtergruppe beweist noch keine Mehrfachauswahlsemantik für Status/Arten; vor deren Änderung gezielt prüfen.

**A/S:** `EventPanel.tsx`, `event-filters.ts`: Suche, Sortierung, tenant-lokale Presets, Zähler, Art/Status, eigener Zeitraum und URL/Back existieren bereits. **Zählergrenze im Source:** Der Listenabruf wendet Datum/Status bereits serverseitig an; `eventFilterCounts` kann die dadurch weggelassenen Datensätze nicht zurückholen. Außerhalb des aktiven Datums liegende undatierte Events/Anfragen können deshalb entgegen der beschriebenen datumsunabhängigen Zählbasis fälschlich null ergeben. Ob ein zusätzlich aktiver Status den Anfragenzähler einschränken soll, ist eine gesondert festzulegende Referenzsemantik, nicht automatisch ein Defekt. Ein reiner Test des Helpers mit vollständigen Fixturezeilen beweist keine korrekte Gesamtzählung. Filter stecken jedoch als langer aufklappbarer Formularblock unter „Website-Eingänge (Ausnahmen)“. Reihenfolge und Position unterscheiden sich. Eventzeilen sind echte Links mit separatem Bearbeiten/Duplizieren. Statt zugewiesener Boxen steht pauschal „Ressourcen in den Event-Details prüfen.“

**Z:** Linke kontextuelle Filterspalte auf breiten Screens, Filter-Drawer auf Mobil. Bookitup-Gruppenfolge; „Neue Anfragen“ fachlich Schnellfilter, kein falsch ausgezeichnetes Sortierradio. Aktuelle URL-Namensräume/Zeitzone erhalten. Kein bedeutungsloser Solo/Agentur-Schalter ohne Agenturmodell. BKP007/BKP014.

## 3. Kalender und Disposition

**B:** Monatsraster korrekt Mo–So mit führenden Tagen aus Vormonat, Eventlinks mit Statuspunkten/Zeit/Titel, heutiger Tag getönt, Monat/Woche/Tag oben, Zurück/Vor/Heute samt Jahressprüngen unten. Kalenderfilter bleiben links; private Kalender und Aufgabenoption sichtbar. Speichern oder Drag&Drop nicht geprüft.

**A/S:** Default Monat, Tag/Woche auswählbar, tenant-lokaler Zeitraum, Eventlinks, Legende, eingeklappte Ressourcenbelegung, physische Einheiten, Puffer/Sperren/Konflikte, ICS. Monat verwendet schon sieben flexible Spalten. Woche und Ressourcenraster haben lokalen horizontalen Scroll. **Bestätigter Fehler:** führende leere `<li>` stehen in `CalendarPanel.tsx:369–378` vor der über alle Spalten reichenden Wochentagszeile (`379–387`, CSS `.calendar-weekday-head`), also in einer eigenen Reihe; Tag 1 startet danach wieder in Spalte Montag. Screenshot Oktober 2026 zeigt Donnerstag 1. unter Montag. Backend-Datumsfenster sind dafür nicht verantwortlich. Bei 390 px zerbrechen zudem lange Tagesüberschriften in winzige mehrzeilige Zellen, darunter abgeschnittene Namen/Zeittexte; oberhalb des Grids unnötig viel Erklärung/Legende.

**Z:** BKP001 korrigiert zuerst ausschließlich die Reihenfolge. BKP008 macht den Monat lesbar: kurze Tageszahlen, kompakte Statusindikatoren, gewählter Tag mit vollständiger Agenda; keine Events wegkürzen ohne erreichbare Anzahl/Detailansicht. Kein neuer Kalenderdienst, kein Drag&Drop als Nebenprojekt. Physische Buchungssicherheit niemals gegen Frontendoptimismus eintauschen.

## 4. Eventanlage und Event-Details

**B:** Datum-zuerst-Dialog, suchbare Kontakte mit Angebot Neuanlage, Eventart. Details getrennte Karten für Allgemein/Termin/zusätzliche Felder/Notizen/Workflows/Log. Rechte Kontextspalte Kontakte, Vermittlungen, Location, Aufgaben; Plusaktionen je Karte. Eine Akte bündelt den Arbeitsablauf; kein globales Springen zum Kontakt nötig, um Kontext zu verstehen. Autosave/Transaktionsverhalten wurde nicht getestet und ist unbekannt.

**A/S:** `EventCreateDialog.tsx` erfüllt reduzierte Anlage bereits: Datum/Kunde/Art, Weitere Angaben, abgeleiteter Name, Datum ohne erfundene Zeit, undatierte Events möglich, Fokus/Dirty-Schutz. `EventDetails.tsx` zeigt Metadaten, separates Statusformular, Kontakte/Ort und Angebote in Übersicht, andere Bereiche für Ressourcen/Notizen/Log. Freier Veranstaltungsort, Zeitauflösung/DST und Versionsschutz vorhanden. Kontakte werden zugeordnet, aber es gibt keinen vollwertigen Kontext-Kontakteditor/-Detailablauf. Kein mehrteiliger Zeitplan, kein freies Feldsystem, keine operative Aufgaben-/Mailintegration.

**Z:** Vorhandene Anlage weiterverwenden, suchbaren Kontaktpicker und bewusste Inline-Neuanlage ergänzen (BKP012), Akte strukturieren (BKP013), zusätzliche Termine nicht durch duplizierte Event-Datensätze simulieren (BKP030-Folgeplanung). Status-/Ressourcenspeicherung muss weiterhin serverseitig atomar sein. Nicht Bookitup-ähnliches Autosave vermuten und sämtliche Formularfelder automatisch senden.

## 5. Kontakte

**B:** Liste mit Suche/Seitennavigation und Gruppen/Dienstleisterfiltern, Detailseite mit Kommunikationsdaten und zugeordneten Events/Mails/Dateien, Bearbeitungsdialog. Privat/Firma, Anrede, Vor-/Nachname, Geburtstag, optionaler Partner oder vorhandener Partnerkontakt, Adresszusatz/Straße/PLZ/Stadt/Land, zwei Telefone, Mail, Website und Gruppen sichtbar.

**A/S:** `ContactPanel.tsx`, `contacts.ts`: Suche, Privat/Firma, Name/Firma, Ansprechpartner, Adresse, ISO-Land, Mail/Festnetz/Mobil, aktive/archivierte Kontakte, Version, Dublettenvorschläge, CSV. Listenansicht zuerst, Dialog nur bei Anlage/Bearbeiten bereits umgesetzt; Fokusfalle/Verwerfen/Busy-Schutz vorhanden. Zeilen bieten Events anzeigen und Bearbeiten, aber keine vergleichbare Kontaktakte mit Dateien/Mails. Ein gemeinsames Namensfeld ist kein getrenntes Vor-/Nachnamenmodell; nicht per Leerzeichen aufspalten. Land in der manuellen Neuanlage bereits DE.

**Z:** BKP011 führt eine lesende Kontaktakte ein und vereinfacht den Editor, ohne Namen/Dubletten ungeprüft umzuschreiben. Partner/Firmenbeziehungen und Gruppen als gesonderter Modellschritt, nicht mehrere Personen in ein Textfeld quetschen. Noch fehlende Mail-/Dateibereiche erst nach ihren Modulen anbinden.

## 6. Ressourcen und Produkte

**B:** Ressourcenliste zeigt Suche, Set/Case/Item, Kategorien und Archivfilter. Keine Ressourcen im sichtbaren Konto. Anlage/operative Ressourcenseite durch Trial gesperrt; interne Regeln zu Bestand/Sets/Puffern unbekannt. Produkte sind unter Dokumenteinstellungen als editierbare Positionsliste organisiert: Brutto/Netto, Menge/Einheit, Einzelpreis, Steuer, Rabatt in % oder €, Gesamt, Beschreibung und Ressourcen verknüpfen/erstellen. Nicht jede produktbezogene Position ist selbst eine physische Ressource.

**A/S:** `ResourcePanel.tsx`/`resources.ts`: Name/Code/Kategorie/Beschreibung, Bestand, vor-/nachgelagerte Tage, Sortierung, Zustand, allgemeine Sperre; dazu getrennte zeitweise Sperren und physische Einheiten. `ProductPanel.tsx`/`products.ts`: Name/Beschreibung/Einheit, exakter Preis, Preisbasis, Steuer, Zustand/Sortierung, Duplizieren/Archiv. Beide Editoren immer sichtbar vor der Liste. Kein vergleichbarer Such-/Kategoriefluss in der Verwaltung, keine Produkt→Ressourcenbedarfsverknüpfung. `category === 'Fotobox'` ist noch fachlich relevante Buchungsbedingung und darf nicht als bloßes Label umbenannt werden.

**Z:** BKP009/BKP010 zuerst Liste/Filter und explizite Editoröffnung. BKP030 untersucht Sets/Cases und verknüpften Bedarf vor eigenem Modell. Vorhandener Datenbank-Konfliktschutz ist stärker als das beobachtbare fremde UI und bleibt.

## 7. Vorlagen und Dokumente

**B:** Nach Art gegliederte Vorlagenlisten, eigenständiger Editor, Inhalt/Einwilligungen/Einstellungen, Vorschau, freie Texte und Positionen, Brutto/Netto, Rabatt, Platzhalter. Globaler Dokumentindex mit Kunden-, Art-, Zeitraum-/Statusfilter; relevante Spalten einschließlich Frist und Event. Dokument-Plus im Event öffnet Dokumentart/Vorlage/Kunde. Eine leere Vorlagenwahl war möglich und Übernehmen wirkte verfügbar; **Erzeugung ohne Vorlage wurde nicht ausgeführt und ist nicht als bestätigte Bookitup-Speicherfunktion belegt**. Der Benutzer verlangt diese Fähigkeit für AuftragsKompass unabhängig davon. Bestehendes fertiges Dokument führt zu Vorschau und Bereitstellungsaktionen; Änderung eines fertigen Dokuments wurde vor Warnungsbestätigung abgebrochen.

**A/S:** Vorlagen für fünf Arten mit Positionen/Platzhaltern, Zustand/optimistischer Version. Kein vollständiger historischer Vorlagenversionsspeicher. Vorlageneditor immer offen; keine Vorschau. Layout/Logo serverseitig vorhanden, keine UI. `EventDocuments.tsx` verlangt aktive Angebotsvorlage und Hauptkontakt, kann Entwurf anlegen und finalisieren/PDF öffnen, aber bietet keine vollständige Entwurfsdetailansicht/-vorschau, keine freie Anlage, vollständige Bearbeitung, Versand-, Annahme- oder Konvertierungsfunktion. API erlaubt eigene Positionen, nicht alle dokumenteigenen Texte/Fristen. Entwurf kopiert Positionen, Finalisierung rendert noch aktuelle Vorlagentexte – spätere Vorlagenänderung kann den Entwurf beeinflussen. Bestätigtes Speichern und anschließender Listenfehler werden bereits korrekt getrennt; Doppelgesten-Guard vorhanden.

`FilesPanel.tsx` existiert: Geschäftsdokumentindex, Art/Status/Datum, 25er-Paginierung, Eventlink, exakter Betrag/PDF, eigene `df_*`-URL-Parameter, alte gute Daten bei Fehler, sichtbarkeitsgebundener Refresh. Dies ist keine allgemeine Uploadbibliothek. `EventDocuments` überschreibt die Überschrift „Angebote“ nicht je tatsächlich gelisteter Art; bei anderen Dokumentarten wird das irreführend.

**Z:** BKP015–BKP019 ergänzen vorhandene Dienste schrittweise. Finale Dokumente bleiben unveränderbar, auch wenn Bookitup eine Rücköffnung anbietet. Ein neuer Entwurf oder Korrekturdatensatz darf eine kontrollierte Verbesserung gegenüber der Referenz sein. Keine fünf fertigen Dokumentabläufe allein aus fünf Enumwerten ableiten.

## 8. Dateien, Mails und Vorlagenmails

**B:** Eventdateien getrennt nach Geschäftsdokumenten, Verträgen, Fragebögen, Uploads und Mailanhängen. Mail sowohl global als auch event-/kontaktbezogen mit Eingang, Entwürfen, Planung, Fehlern, Versand und Papierkorb. Global zusätzlich Unerledigt und ohne Eventbezug. Blanko-Composer mit Absender, vorbesetztem Kontakt, CC/BCC, Betreff, Nachricht/Formatierung, Anhang, Planung und Versand. Separate Vorlagenwahl; Mailvorlagen enthalten Betreff/Text/Platzhalter sowie vorgeschlagene Dokumentanhänge. Keine tatsächlichen Mails geöffnet, markiert oder verschickt; Verarbeitung/Retry/Autosave unbekannt.

**A/S:** Keine IMAP-/SMTP-Anbindung, kein Mailmodell/-editor/-vorlagenbereich. Storage dient derzeit PDF/Logo, nicht allgemeiner Dateibibliothek oder sicherem Mailanhang. Fehlende Module nicht mit `mailto:` oder einer nur hübschen Leeransicht als fertig verkaufen. BKP020–BKP025.

## 9. Website, weitere Module und Sicherheitsgrenzen

**S:** Signierte/idempotente Gateway-Übertragung, dauerhafter Eingang, Option-Worker vorhanden. `website-inquiries.ts:165–178` blockiert bei unklarem/nicht geeignetem Kontakt bzw. fehlendem Land mit `contact_review`; `website_inquiries.contact_id` ist NOT NULL. Event selbst kann ohne Hauptkontakt existieren. `WebsiteInbox` steht weiterhin unter Events. DE-Vorbelegung wurde früher erlaubt, ist aber im Ausnahmeeditor derzeit leer; Beispiel-Quadlet konfiguriert den Default nur kommentiert. Tatsächliche laufende Konfiguration hier nicht geprüft.

**S, weiterer Defekt:** `website-option-worker.ts` hält ein prozesslanges `attempted`-Set; Query lädt erst die ältesten zehn und filtert dann bereits versuchte IDs. Zehn blockierte alte Eingänge können jeden späteren gültigen Eingang dauerhaft verdrängen, auch vorübergehende Fehler werden ohne Neustart nicht erneut versucht. BKP003, keine Behauptung eines beobachteten realen Kundenausfalls.

**B/S:** Aufgaben/relative Vorlagen, Workflows, Vertrag/Fragebogen, Freigaben, Verdienst und Statistiken sind Referenzbereiche. AuftragsKompass hat Absagegründe-Stamm, aber keine vollständigen Aufgaben-/Finanz-/Portal-/Formularbaukästen. Bestehendes Lastenheft und Vollinventar konkretisieren diese Bereiche; exakte Referenzdetails in BKP026–BKP030 vor Implementierung nachbeobachten. Keine pauschale Behauptung vollständiger Referenzanalyse.

## Impeccable: technischer Teilbefund

Workflow `audit`, Ziel `apps/admin`, keine formale duale `critique`, kein Shape-/Build-Workflow und keine neue Designwelt. Context-Lauf erfolgreich; fehlendes PRODUCT.md/Build-init ist kein UI-Build-Abschluss. Quellscan `impeccable detect --json apps/admin` tatsächlich ausgeführt: **32 advisory-Hinweise**, davon 22 Schriftgrößen, 8 Radien, 2 Farben außerhalb der dokumentierten Palette. Beispiele: `CalendarPanel.tsx:510` `#6b7280`, `styles.css:1540` `#1f2937`. Dies sind Hinweise auf Dokumentations-/Token-Abgleich, **keine 32 bewiesenen UX- oder Kontrastfehler**. Kleine Metadatenschrift kann legitim sein; erst Kontext und berechneten Kontrast prüfen. Rohscan enthält nur Source, bleibt als private Arbeitsdatei; diese Zusammenfassung ist das stabile Ergebnis.

| Dimension (0–4) | Bewertung dieser begrenzten Aufnahme | Beleg / Grenze |
| --- | --- | --- |
| Accessibility | Nicht umfassend bewertet | Benannte AK-Dialoge/Icons beobachtet; kein vollständiger Keyboard-/Screenreader-/Kontrastlauf, keine WCAG-Zertifizierung |
| Performance | Nicht gemessen | Kein Profiling, keine künstlich erfundene Ladezeit oder Score |
| Theming | 2/4 | Tokenbasis und Umschalter da; starke Grünflächen widersprechen neuer Vorgabe; Tokenabweichungen prüfen |
| Responsive | 2/4 | Menü funktioniert bei 390; Kalenderdatum/Anordnung verletzt Lesbarkeit und korrekte Zuordnung |
| Implementation integrity | 2/4 | Gute Versions-/Fehler-/URL-Basis, aber Kontaktzwang und Ausnahmequeue widersprechen dem gewünschten Eingang; Quellscan advisories |

**Kein Gesamtwert /20**, da zwei Dimensionen nicht vollständig geprüft sind. Kein „ship“-Urteil für die Anwendung. Positiv erhalten: echte Versions- und Reservierungssicherheit, exakt gerechnete Beträge, erreichbare Dialoge, keine vorgetäuschte Erfolgsmeldung bei fehlgeschlagenem Listenladen.

| Priorität | Befund | Auswirkung | Maßnahme |
| --- | --- | --- | --- |
| P1 | Kalendertage unter falschem Wochentag | Disposition am falschen Tag möglich | BKP001, Impeccable `layout`, Chromium-Geometrie |
| P1 | Gültiger Website-Eingang ohne Kontakt bleibt ohne Event | Anfrage wird im normalen Workflow nicht sichtbar | BKP002/BKP004, Daten-/Vertragstests |
| P1 | Drain kann hinter alten Fehlern dauerhaft stehenbleiben | Spätere Eingänge/Retry ohne Neustart blockiert | BKP003, faire Batch-/Restarttests |
| P1 | Mobile Kalendertexte stark gebrochen/abgeschnitten | Event nicht zuverlässig erkennbar | BKP008, `adapt` |
| P2 | Filterzähler aus bereits gefilterter Liste | Einträge außerhalb des aktiven Zeit-/Statusfilters werden unterschlagen | BKP007 als eigener Zähler-Unter-Slice |
| P2 | Überladene Editoren und Filter im Arbeitsstrom | Lange Scrollwege, schwerer Vergleich | BKP007/BKP009/BKP010/BKP015, `distill`/`layout` |
| P2 | Grüner Darkmode/auffälliger Collapse-Schalter | Unruhe und störende Hierarchie | BKP005/BKP006, `quieter` |
| P2 | Dokumente nur über Vorlage, ohne vollständige Entwurfsbearbeitung | Alltagsvorgänge erfordern Umwege | BKP016/BKP017 |

Mail, Vertragswesen und Finanzen sind **Funktionslücken**, nicht bloße P3-Politur. Nach den jeweiligen Korrekturen technischen Audit wiederholen und zuletzt `impeccable polish` auf die tatsächlich veränderte Fläche anwenden. Questions skipped: Der Benutzer hat Ziel, Lesezugriff und Prioritäten ausreichend konkretisiert; keine zusätzliche Stilfrage nötig. Echte noch unbekannte Referenzdetails werden vor ihrem Ticket beobachtet, nicht erfunden.
