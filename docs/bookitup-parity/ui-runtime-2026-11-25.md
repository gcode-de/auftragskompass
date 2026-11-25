# Bookitup-Laufzeitabgleich der Oberfläche (25.11.2026)

Auftrag des Betreibers vom 25.11.2026: Layout, Hierarchie und das Styling der
Komponenten möglichst 1:1 an Bookitup angleichen, hell und dunkel. Wo ein
Umbau sehr groß wäre, wird vorher gefragt.

## Beweisgrenzen

- **Browserbeobachtung, keine REA-Evidence.** REA (`rea-agents` 6.10.1) läuft
  auf dem Rechner noch nicht: Es verlangt Node 22.23.4+, 24.22.1+ oder
  26.12.1+, installiert ist 26.9.0. Die MCP-Registrierung fehlt deshalb.
- Gemessen im eingebauten Browser der Desktop-App in der angemeldeten
  Bookitup-Sitzung des Betreibers, 1440 × 960 px, hell und dunkel, nur lesend
  (`getComputedStyle`, Screenshots). Kundendaten aus der Sitzung werden hier
  nicht wiedergegeben.
- Ergänzend die privaten Screenshots des Betreibers (Eventliste und Eventakte,
  hell; Eventakte, dunkel).

## Gestaltungswerte (gemessen)

| Element | Hell | Dunkel |
| --- | --- | --- |
| Seitenhintergrund | `#fbfbfb` | `#141517`-Bereich, Karten `rgb(20,21,23)` |
| Schrift Überschriften/Navigation | Nunito Sans | Nunito Sans |
| Fließtext-Grundgröße | 14 px / 21 px | 14 px / 21 px |
| Primärfarbe (Knöpfe, aktive Navigation) | `#1d5191`, Text aktiv `#1a4983` | Text aktiv `#4a90e2` |
| Karte Eventliste | weiß, Radius 10, Innenabstand 16, Schatten `0 1px 3px rgba(0,0,0,.05), 0 1px 2px rgba(0,0,0,.1)`, kein Rahmen | `rgb(20,21,23)`, gleicher Schatten |
| Monatskopf Eventliste | `#f1f1f1`, Radius 10, Höhe 50, Innenabstand 16; Monat 18/700 Nunito; Anzahl 12 px `#9a9a9a` | `rgb(1,1,10)`, Monat weiß |
| Statusbalken Eventkarte | 5 px breit, Radius 10, 70 px hoch, links in der Karte | gleich |
| Karten in der Akte (Mitte) | weiß, Rahmen `1px #e2e2e2`, Radius 10, Innenabstand 16, kein Schatten | dunkle Fläche |
| Karten in der Akte (rechts) | weiß, kein Rahmen, Schatten `0 0 8px rgba(0,0,0,.15)`, Radius 10 | dunkle Fläche |
| Kartenüberschrift | 18/18 700 Nunito `#282828`, daneben Hilfe-Icon und rechts Plus-Knöpfe | weiß |
| Eingabefeld | 36 px hoch, Radius 4, Rahmen `1px #b7b7b7`, weiß, Innenabstand 12 | dunkel |
| Suchfeld/Filterfeld (Seitenleiste) | `#e2e2e2` gefüllt, ohne Rahmen, Radius 4, 36 px, Lupe links | dunkel gefüllt |
| Feldbeschriftung | 12/18 500 `#6e6e6e` über dem Feld | hell grau |
| Primärknopf | `#1d5191`, weiß, 36 px, Radius 4, 14/600 | gleich |
| Dialog | 380 px, Radius 10, Innenabstand 20, Verlaufsstreifen oben (10 px, `#ff6b69 → #ffba5e`), Titel 20/700, Primärknopf volle Breite, „Abbrechen“ als Textlink darunter | dunkel |
| Tabelle (Dokumente) | Kopf 14/400, Unterkante `2px`, aktive Sortierspalte 700; Zeilen 50 px, Zellen `7px 10px`, ohne Linien, Zebra hell | gleich |

### Statusfarben

| Status | Balken/Marker | Filterzeile ausgewählt |
| --- | --- | --- |
| Anfrage | `#1d5191` | Hintergrund `#e8eef4`, Text 700 in Statusfarbe |
| Option | `#fda632` | `#fff6eb` |
| Bestätigt (gebucht) | Marker `#4ebf46`, Kartenbalken `#66e06f` | `#edf9ed` |
| Nicht verfügbar, Annulliert | ohne Farbe, standardmäßig nicht ausgewählt | – |
| Private Termine | Balken `#b7b7b7` | über „Termine anzeigen“ |

## Bereiche im Vergleich

### Gesamtrahmen

- **Bookitup:** schmale Symbolleiste (60 px) mit Bereichs-Icons, Benachrichtigung,
  Hell/Dunkel, Einstellungen, Akademie, Abmelden; daneben eine helle
  Kontextspalte (274 px) mit Titel (22/600) und Plus-Knopf, darunter Suche und
  Filtergruppen. Inhalt auf `#fbfbfb`, Inhaltsbreite der Liste 800 px mittig.
- **AuftragsKompass:** dunkle Seitenleiste mit Textlinks, Filter in einer
  eigenen Spalte bzw. einem Blatt; grüne Akzentfarbe, warme Grautöne, viele
  verschachtelte Rahmen.

### Eventliste

- Bookitup: Monatsköpfe als graue Balken mit Anzahl; Eventkarten ohne Rahmen
  mit Schatten, farbiger 5-px-Statusbalken, Datumsblock (Wochentag klein,
  Tageszahl groß, Monat klein), senkrechter Trenner, Eventart klein grau über
  dem Titel 16/700, Ort mit Pin-Symbol, rechts nur ein „Öffnen“-Symbol.
  **Keine Aktionssymbole in der Liste.**
- Filterspalte: Ansicht (Liste/Kalender/Zeitleiste), Sortieren (Chronologisch,
  Ohne Datum, Neue Anfragen mit Anzahl), Datumsbereich (Monat/Jahr, Dieser
  Monat, Nächste Events, Nächster Monat), **Buchungsstatus als
  Mehrfachauswahl** mit farbigem Marker und getönter Zeile; Annulliert und
  Nicht verfügbar sind standardmäßig abgewählt. Auftragsarten (Suche),
  Optionen (Termine anzeigen). Aktive Einträge: 5-px-Markerbalken (Radius 25)
  und Text 700. Zeilen 32 px.
- AuftragsKompass: Karten mit Rahmen, schmaler Statusmarke, Aktionssymbole
  (Duplizieren, Bearbeiten) in jeder Zeile, Status als Einzelauswahl,
  annullierte Events sichtbar.

### Eventakte

- Bookitup: linke Aktennavigation senkrecht (Kopf „Eventname / Datum 20/700“,
  Details, Ressourcen, Dateien, E-Mails mit Unterordnern und Zählern,
  Freigaben, Verdienst); **„Event duplizieren“ (blau) und „Event löschen“
  (rot) als Textlinks unten in der Navigation.**
- Mitte in zwei Spalten: „Allgemein“ (Verfügbarkeitshinweis, Event-Status als
  Auswahl mit farbigem Punkt, Event-Name, Art, Aufmerksam geworden durch),
  „Zeitplan“ (Datum, Uhrzeiten, Location, Beschreibung, „+ Weiteren Zeitraum“),
  daneben Eigene Felder, Notizen, Workflows, Logbuch.
- Rechts einklappbar (»): Kontakte (graue Innenkarte mit ⋯, „Details
  anzeigen“), Vermittlungen, Location (PRIMÄR), Aufgaben; in anderen
  Bereichen zusätzlich Notizen und Eigene Felder.
- Notizen: je Notiz Zeitpunkt und Bearbeiten-Symbol, Text in grauer Box,
  „Event-Notiz löschen“ rot darunter; **auch ältere Notizen sind bearbeitbar
  und löschbar.**
- Logbuch: farbige runde Symbole (grün für Statuswechsel zu Gebucht, blau für
  Erstellung), Datum darunter, ⋯ je Eintrag.
- AuftragsKompass: waagerechte Bereichsleiste, „Weitere Eventaktionen“ als
  aufklappbarer Bereich im Kopf, Status als eigenes Formular mit
  Speichern-Knopf, viele Rahmen in Rahmen.

### Dokumente

- Übersicht: Filterspalte mit Kundensuche, Nummernsuche, Dokument-Art
  (Einzelauswahl: Angebote … Fragebogen), Datumsbereich, Status als
  Segmentschalter (Alle/Entwurf/Fertig); Tabelle Status-Symbol, Nummer, Name,
  Datum (sortierbar), Betrag, **Frist als farbiges Etikett** („Gültig bis …“,
  grau/grün/rot), **Event als Pille mit Statuspunkt**, Portal, ⋯-Menü.
- In der Akte („Dateien“): Karten Dokumente (Tabelle, nach Art gruppiert),
  Verträge, Fragebögen, Uploads, E-Mail-Anhänge; ⋯-Menü je Dokument:
  Fertigstellen; Auftragsbestätigung/Lieferschein/Packliste/Abschlagsrechnung/
  Rechnung erstellen; Event zuordnen, Herunterladen, Duplizieren, Umbenennen,
  Löschen (rot).
- Anlegen: kleiner Dialog „Vorlage wählen“ (Dokumentenart, Vorlage, Kunde,
  Übernehmen).
- Editor als eigene Seite in der Akte: Brotkrumen „Dateien / Angebot Nr. …“,
  rechts Flagge, „Vorschau“ (blau), ⋯; Reiter Inhalt/Einwilligungen;
  Empfängerblock mit „Kunde ändern“; Titel mit „(Entwurf)“ und
  Brutto/Netto-Segmentschalter; Zeile Nummer · Datum · Gültig bis; Kopftext;
  dunkler Balken „Positionen“; je Position eine graue Karte (Titel fett,
  Beschreibung, Menge/Einheit · Steuer · Stückpreis, Gesamt rechts, ⋯);
  darunter Textlinks „+ Leere Position einfügen“, „+ Produkt auswählen“;
  rechtsbündiger Summenblock (Zwischensumme, Rabatt mit %/€-Schalter,
  Anmerkung, Währung, Gesamtbetrag mit USt-Hinweis); Fußtext.

### E-Mails

- In der Akte als Ordner der linken Navigation (Posteingang mit Zähler,
  Entwürfe, Geplant, Fehlgeschlagen, Gesendet, Papierkorb).
- Zweispaltig: Liste (Absender fett, Datum, Betreff, Ordner klein) und
  Lesebereich; Werkzeugleiste mit Symbolen (Aktualisieren, …, Neue Nachricht).
- **Neue Nachricht öffnet im Lesebereich, nicht als Dialog:** Absender,
  An (Chips, CC/BCC), Betreff, Nachricht (Platzhalter als Chips), unten
  Werkzeugleiste mit Senden-Knopf links (blau), Planen, Formatierung, Anhang,
  Vorlagen, Papierkorb rechts. Schon das Öffnen legt einen Entwurf an.

## Umsetzungsreihenfolge (Vorschlag)

| Ticket | Inhalt | Aufwand |
| --- | --- | --- |
| UI-BKP-01 | Gestaltungswerte hell/dunkel (Palette, Nunito Sans lokal, Karten, Felder, Knöpfe, Dialoge) | mittel, nur CSS |
| UI-BKP-02 | Eventliste: Monatsköpfe, Karten mit Statusbalken, Aktionen aus der Liste ins ⋯-Menü; Filterspalte mit Status-Mehrfachauswahl, Annulliert/Nicht verfügbar standardmäßig aus | mittel |
| UI-BKP-03 | Eventakte: senkrechte Aktennavigation mit Duplizieren/Löschen unten, Kartenraster Allgemein/Zeitplan/Notizen/Logbuch, rechte Spalte mit Schattenkarten | groß, nur Oberfläche |
| UI-BKP-04 | Notizen bearbeiten (neue API-Route) und Löschen je Notiz wie Bookitup | klein, mit Backend |
| UI-BKP-05 | Dokumentübersicht und „Dateien“ der Akte: Tabelle, Fristetikett, Event-Pille, ⋯-Menü, Dialog „Vorlage wählen“ | mittel |
| UI-BKP-06 | Dokumenteditor im Bookitup-Aufbau | groß, nur Oberfläche |
| UI-BKP-07 | E-Mails zweispaltig mit eingebettetem Editor statt Dialog | groß |
| UI-BKP-08 | Gesamtrahmen: Symbolleiste + helle Kontextspalte | groß |

Aus dem alten Branch H042 kommen beim Umbau mit: mitlaufende Speicherleiste
im Anlegedialog und 44-px-Tippflächen für Mail- und Telefonlinks.
