# Bookitup live – bereinigte UX-Referenz

Read-only-Aufnahme vom 20.10.2026 im eingeloggten Browser (app.bookitup.de).
Erfasst wurden DOM-Struktur, sichtbare Feldmetadaten, Computed Styles und
Interaktionszustände ohne Schreibzugriffe und ohne Netzwerkmanipulation. Diese
Datei ist eine bereinigte Planungsgrundlage, kein Rohdump: keine Kundennamen,
E-Mail-Adressen, Telefonnummern, Eventinhalte, Rechnungs- oder Kontodaten und
kein lokales Archiv.

Die vollständige Funktions- und Marktübersicht bleibt
[Bookitup_Funktionsinventar_vollstaendig.md](../Bookitup_Funktionsinventar_vollstaendig.md).
Diese Referenz beschreibt nur die beobachtete Interaktionsoberfläche.

## 1. Grundriss

- Links eine 40 px breite Icon-Leiste (Icons 20 px, Trefferfläche 40 × 40 px,
  50-px-Raster), daneben eine 274 px breite Kontext-/Filterspalte; zusammen
  340 px. Der Inhaltsbereich beginnt bei x = 497 als 800 px zentrierte Spalte.
- Der Seitenkopf einer Liste ist zugleich Filterkopf: H3 (18 px) plus rechts
  zwei Icon-Schaltflächen (Synchronisieren, Anlegen). Kein großer „Neu“-Button
  im Inhaltsbereich.
- Die Filterspalte wechselt je Route ihre Rolle: Events und Kontakte filtern,
  Einstellungen zeigen Abschnittsnavigation, Statistiken bleiben leer.
- Die Eventakte ist die Ausnahme: dreispaltig mit etwa 233 / 498 / 300 px und
  ohne Filterspalte.

## 2. Navigation

- Hauptnavigation nur als Icon, teils mit Badge, ohne Text und ohne
  `aria-label`: Kalender/Events, Ressourcen, Aufgaben, Postfach, Kontakte,
  Dokumente, Statistik.
- Darunter ein separater Block für Einstellungen, Academy und Logout.
- Der aktive Zustand ist nur über Icon-Farbe und Fläche erkennbar, nicht über
  Text.
- Einstellungen enthalten 15 Abschnitte in 40-px-Zeilen, darunter Ressourcen,
  E-Mail, Dokumente, Dateien, Datenschutz und Passwort.

## 3. Eventliste

- Monatsgruppen mit Überschrift („Oktober 2026“) und grauer Anzahl; darunter
  Tageszeilen.
- Tageszeile 800 px: Datumsblock 95 px (Wochentag, Tag, Monat), 1-px-Trenner,
  Inhalt. Die ganze Zeile ist klickbar; Hover zeigt Text-Unterstreichung.
- Filtergruppen in fester Reihenfolge: Ansicht, Sortieren (chronologisch /
  ohne Datum mit Zähler), neue Anfragen, Datumsbereich, Buchungsstatus,
  Auftragsarten (Mehrfachauswahl mit Suche) und Optionen.
- Jede Option ist eine 32-px-Zeile mit 5-px-Punkt links; aktiv bedeutet
  Schriftstärke 700, inaktiv 400. Keine Checkbox-Optik, keine Flächenfarbe.
- Statusfilter wirken sofort, ohne URL-Parameter. Der Umschalter Liste/Kalender/
  Zeitleiste nutzt dieselbe Zeilenliste und ist nur per Maus bedienbar
  (`role=button` und `tabindex` fehlen) – bewusst nicht nachgeahmt.

## 4. Kalender

- Standard ist der Monat. Toolbar: Titel links, Ansichtswechsel rechts als
  gefüllte Button-Gruppe (aktiv Primärfarbe/weiß, inaktiv helle Fläche).
- Die Datumsnavigation liegt zentriert unter dem Raster (Jahr zurück, Monat
  zurück, Heute, Monat vor, Jahr vor).
- Monatsraster Montag–Sonntag, Spalten 154 px, Zellen 176 px, Chips 149 × 22 px,
  kleine graue Schrift, Status nur über farbige Punkte. Heute-Zelle gelblich.
- Datum-only-Termine erscheinen als „00 Uhr“-Chip, obwohl keine Uhrzeit
  existiert – bewusst nicht nachahmen.
- Woche und Tag nutzen ein 15-Minuten-Raster mit Ganztägig-Zeile.
- Ansicht und Filter werden clientseitig gemerkt, aber nicht in der URL geführt.
- „Zeitleiste“ ist für das beobachtete Konto gesperrt; der Klick öffnet ein
  Modal zur Modulfreischaltung statt einer Ansicht. Das Layout dieser Ansicht
  ist daher unverifiziert.

## 5. Eventakte

- Links „Allgemein“: Event-Status (Combobox), Event-Name, Art des Events
  (Autocomplete), Aufmerksam geworden durch; darüber ein Verfügbarkeitshinweis.
- „Zeitplan“ mit Mikro-Label „primär“: Datum als schreibgeschütztes Feld
  (141 × 36 px), zwei Zeitfelder 90 × 36 px mit Platzhalter `-- : --` und
  Suffix „Uhr“, danach Location (schreibgeschützte Combobox) und Beschreibung.
- Mitte: „Eigene Felder“ (Akkordeon), Notizen, Workflows und Logbuch; leere
  Karten zeigen „Noch nichts hinzugefügt.“.
- Rechte Spalte: Kontakte (Name, E-Mail, Telefon als `tel:`-Link, Details) und
  Vermittlungen.
- Keine Tabs, keine Speichern-Schaltfläche und kein „gespeichert“-Hinweis.
  Felder sind direkt editierbar. Autosave wird vermutet, ist aber nicht
  verifiziert.
- `/events/<id>/resources` und `/events/<id>/files` existieren, sind aber in
  der Akte nicht verlinkt; die Dateien-Seite war leer.

## 6. Anlege-Dialog

- Öffnen über das Plus im Sidebar-Kopf. Modal 440 × 637 px, Radius 10,
  `aria-modal`, Titel über `aria-labelledby`.
- Inhalt: Inline-Monatskalender (Tageszellen 53 × 38 px, Roving-Tabindex,
  initialer Fokus auf der Tageszelle „1“), danach zwei Pflicht-Autocomplete-
  Felder (400 × 36 px): Kunde (neu oder vorhanden) und Art des Events.
- Keine Uhrzeit-, Ort- oder Notizfelder. Kein Datum vorausgewählt; nach einer
  Datumswahl erscheinen weiterhin keine Zeitfelder.
- Fußaktion „Speichern“ (250 × 36 px), deaktiviert, solange die Pflichtfelder
  fehlen. Abbrechen nur über ein 28 × 28 px großes X ohne `aria-label`.
- Übernommen wird die Reihenfolge Datum → Kunde → Art und die reduzierte
  Feldmenge. Nicht übernommen werden der fehlende X-Name, der nicht
  nachvollziehbare Disabled-Zustand und die fehlende Fokusführung.

## 7. Weitere beobachtete Bereiche

- Globale Dokumente: Filter nach Dokumentart, Datumsbereich und Status;
  Tabelle mit Status, Event, Portal und einer aktionslosen Spalte; Pagination.
- Einstellungen → Dateien: flache Tabelle Dateiname/Aktionen mit einem
  `<input type=file>`; keine Ordner, Tags oder Suche.
- Einstellungen → Ressourcen: Schalter, der das Ressourcenmodul aus der
  Navigation ausblendet, mit Hinweis, dass Modul und Einstellungen erhalten
  bleiben.
- Kontakte: Liste mit Name und Aktion; Anlege-Dialog mit Privat/Firma,
  Anschrift, Telefon, E-Mail, Webseite und Gruppen.
- Aufgaben: Datumsbereich und Aufgabengruppen; leerer Zustand.
- Statistiken: breite Umsatz-/Zahlungskarten und drei kleine Verteilungskarten;
  ohne Daten erklärende Hinweise statt Diagrammen.
- Ressourcen: Typ, Kategorie, „Archivierte anzeigen“ und ein Leerzustand.

## 8. Visuelle Referenzwerte

| Element | Beobachteter Wert |
|---|---|
| Primärfarbe | #1D5191 (gefüllte Buttons, aktive Ansicht, gewählter Tag) |
| Neutralflächen | #F1F1F1, dunkle Jahresbuttons #2C3E50 |
| Text | #212529 primär, #6E6E6E sekundär, #9A9A9A Zähler |
| Deaktiviert | Fläche #D4D4D4, Text #A8A8A8 |
| Radien | Modal 10, Ansichtswechsel 10, Buttons/Felder 4, Kalender-Chip 3 |
| Feldhöhe | 36 px Standard, Buttons 29–40 px, Listenzeilen 32/40/42 px |

Schwäche, die wir nicht übernehmen: Alle Navigations- und Kalenderbuttons sind
gleichrangig mit der Primärfarbe gefüllt; es gibt keine sekundäre oder tertiäre
Stufe.

## 9. Übernehmbares Interaktionsmodell

1. Listenkopf trägt Titel und Kontextaktionen; Anlegen öffnet einen kompakten
   Dialog statt eines großen Formulars im Inhalt.
2. Monatsgruppen mit Anzahl und Tageszeile mit Datumsblock bleiben schnell
   scanbar.
3. Filter als beschriftete Zeilengruppen mit Punkt und Fettschrift statt einer
   Checkbox-Wüste; Zähler rechts.
4. Ansichtsumschalter an derselben Stelle wie Sortierung.
5. Anlegen: Datum zuerst, dann Kunde, dann Art – ohne Zeiten, Ort oder Notizen.
6. Zeitfelder bleiben optional und leer mit Hinweis `-- : --` und Suffix „Uhr“;
   das Datum bleibt die führende Angabe.
7. Detail als Akte mit Themenkarten und Kontaktspalte.
8. Stille Leerzustände pro Karte statt leerer Flächen.
9. Verlauf mit Icon und Klartextsatz pro Datensatz.
10. Fokusführung im Dialog: `aria-modal`, `aria-labelledby`, Fokus im ersten
    Feld, echtes X-Label und Rückgabe des Fokus.

## 10. Bewusste Abweichungen

1. **Ressourcen und Produkte unter Einstellungen** statt Hauptnavigation (H033).
   Bookitup belegt mit `/settings/resources` und dem Ausblendschalter, dass dies
   ein legitimer Modus ist. AuftragsKompass führt beide selten bearbeiteten
   Stammdaten als Einstellungsabschnitte `#settings-resources` und
   `#settings-products`; die alten Links `#resources` und `#products` bleiben
   als Aliase gültig.
2. **Keine Orts-Stammdaten in der Oberfläche**: Bookitup führt „Location“ als
   eigene Combobox/Stammdaten; AuftragsKompass behält vorhandene Ortsdaten und
   API, nimmt die Stammdatenpflege aber aus dem normalen UX-Pfad.
3. **Website-Anfrage → Status Option** statt eines reinen Filterzählers: Die
   Anfrage wird lokal zur Option ohne Zeiten und ohne Reservierung.
4. **Eigener Dateien-Navigationspunkt** statt eines Event-Tabs: Bookitup hat
   live keinen Dateien-Tab am Event, nur eine globale Bibliothek.

## 11. Beobachtet vs. unverifiziert

Beobachtet mit DOM-Beleg: Grundriss und Geometrie, Icon-Navigation,
Filtergruppen und Zustandsdarstellung, Ansichtsumschalter, Monats-/Wochen-/
Tageskalender samt unterer Navigation, gesperrte Zeitleiste, Anlege-Dialog mit
Feldliste, Defaults, deaktivierter Speicherung und Fokus, Sektionen und
Feldmetadaten der Eventakte, globale Dokumentenfilter, Einstellungsnavigation,
Dateien-Bibliothek, Ressourcen-Einstellungen, Kontaktliste und -formular,
Aufgabenfilter, Statistiken-Karten sowie die A11y-Attribute des Dialogs.

Unverifiziert und deshalb nicht als Vorbild beansprucht: Speicher- und
Autosave-Verhalten der Felder, Pflichtfeld- und Fehlerzustände, Statuswechsel,
Upload/Download/Löschen, Wirkung jedes einzelnen Filters, Sortierung und
Pagination, Aufgaben und Diagramme mit Daten, Timeline-Layout, mobile
Breakpoints und echte Tab-Reihenfolge. Insbesondere wird **kein Autosave**
übernommen, solange das Verhalten nicht belegt ist.
