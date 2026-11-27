---
name: AuftragsKompass
description: Interne Verwaltungsoberfläche für den lokalen Fotobox-Betrieb
colors:
  surface: 'light-dark(#ffffff, #1e1d1b)'
  canvas: 'light-dark(#f5f4f1, #141312)'
  ink: 'light-dark(#20211f, #e8e4df)'
  muted: 'light-dark(#5d5c58, #b0aaa2)'
  accent: 'light-dark(#3d6b58, #9dc1af)'
  border: 'light-dark(#dbd8d2, #3b3833)'
  action-ink: 'light-dark(#ffffff, #12201b)'
  action-hover: 'light-dark(#2f5749, #b2d2c1)'
  hover-surface: 'light-dark(#efede8, #2a2825)'
  field-surface: 'light-dark(#fbfaf8, #191817)'
  field-border: 'light-dark(#8f8a82, #7d776f)'
  focus: 'light-dark(#20695a, #9fd3ba)'
  status-surface: 'light-dark(#f1efec, #242220)'
  alert-surface: 'light-dark(#fdf0ed, #3d2523)'
  alert-ink: 'light-dark(#a3312a, #f6bcb2)'
  table-surface: 'light-dark(#f3f1ed, #242220)'
  selection: 'light-dark(#dcd9d3, #3a3733)'
  selection-ink: 'light-dark(#1d1c1a, #f0ece7)'
  selected-surface: 'light-dark(#eeece7, #302d29)'
  selected-ink: 'light-dark(#33544a, #e8e4df)'
  disabled-surface: 'light-dark(#e9e6e0, #262421)'
  disabled-ink: 'light-dark(#6b665f, #a9a29a)'
  sidebar: '#1b1a18'
  sidebar-ink: '#eae6e0'
  sidebar-focus: '#cfd8d0'
  sidebar-active: '#2f3a34'
  sidebar-hover: '#2a2825'
  sidebar-link: '#c6c1ba'
  sidebar-muted: '#a8a29a'
  sidebar-selected-ink: '#ffffff'
  backdrop: '#0b0a09aa'
  scrim: 'light-dark(#1b1a1866, #0b0a09cc)'
  menu-close-border: '#6f6a63'
  calendar-ink: '#111827'
  status-inquiry: 'light-dark(#6b665f, #a9a29a)'
  status-option: 'light-dark(#8a5a12, #e0b45c)'
  status-booked: 'light-dark(#2f5749, #9dc1af)'
  status-hold: 'light-dark(#6a4b8a, #c9aee6)'
  status-cancelled: 'light-dark(#8f8a82, #7d776f)'
  status-blocked: 'light-dark(#8f8a82, #7d776f)'
  status-unavailable: 'light-dark(#8f8a82, #7d776f)'
  status-conflict: 'light-dark(#a3312a, #f6bcb2)'
typography:
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    lineHeight: 1.5
  headline:
    fontSize: '1.5rem'
    lineHeight: 1.2
    letterSpacing: '-0.025em'
  workspace-title:
    fontSize: '1.5rem'
    fontWeight: 650
    letterSpacing: '-0.025em'
  workspace-heading:
    fontSize: '1.25rem'
    lineHeight: 1.2
    letterSpacing: '-0.025em'
  record-heading:
    fontSize: '1.35rem'
    lineHeight: 1.2
    letterSpacing: '-0.025em'
  event-month-heading:
    fontSize: '1.1rem'
    lineHeight: 1.2
    letterSpacing: '-0.025em'
  event-row-title:
    fontSize: '1.05rem'
    fontWeight: 650
  event-count:
    fontSize: '0.8rem'
    fontWeight: 400
  label:
    fontWeight: 550
  button:
    fontWeight: 600
rounded:
  control: '0.4rem'
  sidebar-link: '0.5rem'
  fieldset: '0.65rem'
  workspace: '0.75rem'
  login: '1rem'
spacing:
  form-gap: '1rem'
  fieldset-padding: '1.25rem'
  workspace-padding: '1.75rem'
  mobile-workspace-padding: '1rem'
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.action-ink}'
    rounded: '{rounded.control}'
    padding: '0.6rem 1rem'
    typography: '{typography.button}'
  button-secondary:
    backgroundColor: 'transparent'
    textColor: '#33544a / #cdc7bf'
    border: '1px solid #8f8a82 / #757067'
    rounded: '{rounded.control}'
    padding: '0.6rem 1rem'
  button-tertiary:
    backgroundColor: 'transparent'
    textColor: '#33544a / #cdc7bf'
    border: 'none'
    rounded: '{rounded.control}'
    padding: '0.6rem 1rem'
  button-disabled:
    backgroundColor: '{colors.disabled-surface}'
    textColor: '{colors.disabled-ink}'
    border: '1px dashed #8f8a82 / #757067'
    rounded: '{rounded.control}'
    padding: '0.6rem 1rem'
  button-primary-hover:
    backgroundColor: '{colors.action-hover}'
  button-account:
    backgroundColor: 'transparent'
    textColor: '{colors.sidebar-ink}'
    rounded: '{rounded.control}'
    padding: '0.6rem 1rem'
  theme-toggle:
    backgroundColor: 'transparent'
    textColor: '#33544a / #cdc7bf'
    border: '1px solid #8f8a82 / #757067'
    rounded: '{rounded.control}'
    padding: '0.6rem 1rem'
  theme-toggle-pressed:
    backgroundColor: '{colors.selected-surface}'
    textColor: '{colors.selected-ink}'
  record-navigation:
    backgroundColor: 'transparent'
    textColor: '#33544a / #cdc7bf'
    padding: '0 0 1rem'
  record-navigation-current:
    backgroundColor: '{colors.selected-surface}'
    textColor: '{colors.selected-ink}'
  event-disclosure:
    textColor: '{colors.accent}'
    padding: '0.75rem 0.25rem'
  event-row:
    padding: '1.25rem 0'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '0.6rem 0.7rem'
  workspace:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.workspace}'
    padding: '1.75rem'
  navigation-active:
    backgroundColor: '{colors.sidebar-active}'
    textColor: '{colors.sidebar-selected-ink}'
    rounded: '{rounded.sidebar-link}'
    padding: '0.8rem 0.9rem'
---

# Design System: AuftragsKompass

## Overview

Die interne Verwaltungsoberfläche unterstützt den Inhaber eines lokal betriebenen Fotobox-Unternehmens. Die Oberfläche verwendet neutrale Flächen in einem hellen Offwhite beziehungsweise einem dunklen Anthrazit, eine anthrazitfarbene Seitennavigation und ein entsättigtes Grün ausschließlich als kleinen Marken- und Aktionsakzent. Diese Dokumentation beschreibt den implementierten Zustand; sie legt keine neue Markenrichtung fest.

**Key Characteristics:**

- Getrennte Arbeitsbereiche mit gemeinsamer Navigation.
- Systemschrift, sichtbarer Tastaturfokus und überwiegend mindestens 44px hohe Bedienelemente.
- Native modale Navigation auf schmalen Bildschirmen.
- Eigenes Kompass-Favicon (`favicon.svg`, 32px-PNG-Fallback) in den Farben der Seitenleiste; keine fremden Markenassets.

Dokumentlayout: Die gespeicherte Konfiguration beginnt als Zusammenfassung.
„Logo hinzufügen“ beziehungsweise „Logo ersetzen“ öffnet nur bei Bedarf die
native PNG-/JPEG-Dateiauswahl mit Größenhinweis und ausdrücklicher Uploadaktion.
Auswahl allein speichert nichts. Während dieses Ablaufs bleiben die anderen
Layoutaktionen verborgen; „Auswahl verwerfen“ kehrt zurück. Upload/Abgleich
verwenden die vorhandenen Lade-, Fehler- und Aktionsstufen, keine neue Fläche
oder Akzentfarbe. Der Fokus wechselt zur Dateiauswahl und nach Abschluss/Abbruch
zum Auslöser, sofern der Bereich aktiv ist. Eine unklare Antwort verlangt zuerst
Bestandsabgleich; eine PDF-Vorschau wird nach einem Upload neu erzeugt.

## Colors

Maßgeblich ist der eine `:root`-Block in `src/styles.css`. Die Frontmatter bewahrt die exakten Farbpaare als `light-dark(Hellwert, Dunkelwert)`; die erste Farbe gehört zum Hellmodus, die zweite zum Dunkelmodus. `color-scheme: light dark` übernimmt zunächst die Systempräferenz; `data-theme="light"` beziehungsweise `"dark"` setzt das explizite Farbschema. Native Formelemente folgen diesem Schema.

Die Palette wurde in BKP005 neutralisiert. Die folgenden Werte sind die tatsächlich ausgelieferten; Kontraste prüfen `tests/component/action-hierarchy.test.tsx` und `tests/e2e/shell.spec.ts` für beide Themes.

- `surface`, `canvas`, `ink`, `muted` und `border` steuern Arbeitsflächen, Hintergrund, Text und Trennung. Der Hellmodus ist ein neutrales Offwhite mit klaren Flächenstufen (`surface` `#ffffff`, `canvas` `#f5f4f1`, `field-surface` `#fbfaf8`, `table-surface` `#f3f1ed`), der Dunkelmodus ein neutrales Anthrazit (`canvas` `#141312`, `surface` `#1e1d1b`, `field-surface` `#191817`, `hover-surface` `#2a2825`, `table-surface` `#242220`). Keiner dieser Werte trägt einen Grünstich.
- `accent`, `action`, `action-border`, `action-ink` und `action-hover` bilden Aktionen ab. Das Grün ist entsättigt (`#3d6b58` im Hellmodus, `#9dc1af` im Dunkelmodus mit dunkler Schrift `#12201b`) und bleibt auf Links, die eine primäre Aktion, den Fokus und die aktive Navigationszeile beschränkt. `hover-surface`, `status-surface`, `selected-surface`/`selected-ink` und `selection`/`selection-ink` sind neutrale Tönungen.
- `field-surface`, `field-border`, `alert-surface` und `alert-ink` erhalten Form- und Rückmeldungskontraste. `alert-ink` bleibt die rote Fehlerfarbe und dient auch als Fehlerrand. `status-surface` ist neutral, damit eine Rückmeldung nicht allein über die Flächenfarbe wirkt. `disabled-surface`/`disabled-ink` tragen den deaktivierten Zustand mit lesbarer Schrift.
- `focus`, `sidebar-focus`, `quiet-ink`, `quiet-action-border`, `field-border` und `menu-close-border` halten Fokusringe und Bediengrenzen bei mindestens 3:1 zur angrenzenden Fläche; `quiet-ink` erreicht auf allen Flächen mindestens 4,5:1.
- Die Seitennavigation ist in beiden Darstellungen ein Anthrazit (`#1b1a18`) mit neutralen Links (`#c6c1ba`) und neutralem Hover (`#2a2825`). Nur die aktive Zeile bleibt leicht grün getönt (`#2f3a34`) und wird zusätzlich durch Gewicht und `aria-current` getragen. `backdrop` (mobiles Menü, `#0b0a09aa`) und `scrim` (Dialoge, `light-dark(#1b1a1866, #0b0a09cc)`) sind neutrale Abdunklungen.
- `--calendar-ink` (`#111827`) bleibt die feste dunkle Schrift auf den pastellfarbenen Kalender- und Belegungszuständen beider Darstellungen; die Zustände selbst bleiben semantisch getrennt und werden stets zusätzlich benannt.

## Typography

Durchgehend die Systemschrift aus der Frontmatter; keine externe Schrift. Die Grundschriftgröße ist nicht ausdrücklich festgelegt und folgt dem Browserstandard. Überschriften verwenden Zeilenhöhe 1.2 und Laufweite −0.025em. Die globale h1-Größe ist `clamp(1.8rem, 4vw, 2.6rem)`; die Anmeldung und der Bereichstitel in der Werkzeugleiste setzen `1.5rem`, mobil `1.15rem`. h2 ist grundsätzlich `1.5rem`, innerhalb eines Arbeitsbereichs `1.25rem`. Die Bereichsbezeichnung verwendet `1.5rem` und Gewicht 650, bis einschließlich 900px `1.15rem`. Kopfuntertitel: `0.875rem`; Kontobereich und Navigationsuntertitel: `0.8rem`; Tabellen: `0.9rem`. Tabellenzellen, Tabellenköpfe und Zeitangaben verwenden `font-variant-numeric: tabular-nums`.

## Layout

Desktop: `.app-shell` hat maximal `100rem` Breite und `padding: 0 2.5rem 3rem 18rem`. Die feste linke Navigation ist `15rem` breit und bei geringer Bildschirmhöhe vertikal scrollbar. Ihr Kontobereich sitzt unten mit `margin-top: auto` und `1.5rem 0.75rem 0` Innenabstand. Der Hauptbereich hat keine zusätzliche Kontozeile; der frühere Fußzeilenspruch entfällt. Arbeitsbereiche sind umrandete Flächen in `surface` mit `1.75rem` Innenabstand; breite Inhalte dürfen horizontal scrollen. Formulargruppen verwenden `repeat(auto-fit, minmax(min(100%, 18rem), 1fr))` mit `1rem` Abstand. Ältere Feldgruppen mit expliziten `label[for]` bleiben einspaltig.

Bis einschließlich **900px**: Seitennavigation ausblenden, 44 × 44px großen SVG-Menüknopf einblenden, Werkzeugleiste oben fixierend (`position: sticky; top: 0`, Ebene 5), Seitenabstand `1rem`. Unterer Abstand: `max(2rem, env(safe-area-inset-bottom))`. Arbeitsflächen erhalten `1rem` Innenabstand; die Einstellungsnavigation einen beschrifteten nativen Bereichswähler statt der zwölf Links. Dieser verwendet dieselben Hash-Ziele, die bestehenden Feldfarben und mindestens 44px Höhe; Direktlinks, Browser-Zurück und montierte Entwürfe bleiben erhalten. Oberhalb 900px bleiben die Links sichtbar. Der Wechsel blendet Bereiche nur um und verwirft keine Eingaben. Bis einschließlich **600px** werden globale Suche einspaltig und Feldgruppen mit `0.85rem` gepolstert. Spätere 900px-Regeln haben bei Überschneidungen Vorrang.

Ein eigener Anwendungskopf mit Marken-Hero existiert nicht mehr; die Seitenleiste trägt die Marke. Die Werkzeugleiste enthält den einzigen sichtbaren Seiten-H1 als echten `#events`-Link und die globale Suche. Bereichsflächen wiederholen diesen Titel nicht; nur eigenständige Unterabschnitte wie der Suchbereich führen eigene H2.

Die Anmeldung ist eine eigene, maximal `30rem` breite Karte mit dem einzigen H1 „Anmelden bei AuftragsKompass“; der Anwendungsrahmen wird dafür maximal `65rem` breit und erhält `1.5rem` Innenabstand. Der sichtbare Arbeitsbereich folgt dem URL-Hash. Die globale Suche zeigt Events und Kontakte gemeinsam; Einstellungen haben eigene Unterbereiche.

Eventlisten gruppieren Einträge anhand des Eventdatums nach Monat und Jahr; ohne Datum entsteht die Gruppe „Ohne Datum“. Monatsgruppen haben `2rem` Abstand nach oben. Ihre Überschrift steht auf der Events-Route auf Ebene 2 und in den Suchabschnitten auf Ebene 3; sie zeigt die Anzahl daneben (`gap: 0.75rem`, umbrechend, an der Grundlinie ausgerichtet). Jede Zeile ist eine ruhige Karte (BKP014.1): links eine Datumsspalte mit dominanter Tageszahl (`1.65rem`, Gewicht 700) und kleinem Wochentag/Monat (`0.75rem`, z. B. „Sa / Okt“), daneben der Kartenkörper mit Statusmarke samt geschriebenem Statusnamen, Eventart, vollständigem Titel und wirksamem Ort. Ein 3px-Statusstrich am linken Kartenrand und ein `0.5rem`-Punkt tragen dieselbe Statusfarbe; der Name steht immer daneben, Farbe ist nie der einzige Träger. Monatsüberschriften liegen auf `table-surface`; die Anzahl ist zurückhaltend gesetzt. Sichtbare Listenzeilen haben `1rem` vertikalen und `0.85rem` horizontalen Innenabstand, `field-surface` als ruhige Kartenfläche und `0.6rem` Abstand. Die geöffnete Eventakte erhält keine zusätzliche Kartenfläche.

Die geöffneten Event-Details bilden einen eigenen Arbeitskontext: Listensteuerung, Monatsüberschriften und andere Eventzeilen werden ausgeblendet. Der Ereigniskopf (`.event-record-head`) steht als erster Block der Akte: eine Zeile mit Datum (`0.95rem`, Gewicht 650) und Zeitfenster (`0.9rem`) in `muted` und `tabular-nums`, darunter der h2-Titel (`1.35rem`, `overflow-wrap: anywhere`), darunter Statusmarke mit geschriebenem Statusnamen, Eventart (Großbuchstaben, `0.75rem`) und wirksamer Ort; ein unterer `border` trennt ihn von den Bereichen. Der Detailbereich verwendet eine Definitionsliste mit `minmax(7rem, 0.35fr) minmax(0, 1fr)`, Abstand `0.75rem 1rem` und `1.5rem` Blockrand; seine Abschnitte tragen h4-Überschriften (`0.9rem`, Gewicht 650). Ab **64rem** steht der Kontakt-/Ort-Kontext als rechte Spalte (`minmax(0, 1.6fr) minmax(17rem, 0.9fr)`, linker `border`, `1.5rem` Innenabstand) neben der Hauptspalte, darunter hinter einem Disclosure. Bis einschließlich **600px** steht die Definitionsliste einspaltig mit `0.25rem` Abstand; Werte erhalten `0.75rem` unteren Außenabstand.

Seltene Eventaktionen liegen im zunächst geschlossenen nativen Bereich „Weitere Eventaktionen“ im Eventkopf. Das Entfernen bleibt in jedem Aktenbereich erreichbar, nutzt die bestehende Bestätigung und ist bei offenen oder unklaren Änderungen gesperrt. Der Bereich verwendet die ruhige Aktionsfarbe und die gemeinsame Tastaturfokussierung; er fügt keine Animation hinzu. Davor steht „Event duplizieren“ (QW1, gleiche Kopierlogik wie die Listenzeile, bei offenen Änderungen gesperrt); beide Knöpfe stehen als umbrechende Zeile unter der Zusammenfassung. Kontakte in „Kontakt und Ort“ führen mit „Details anzeigen“ in ihre Kontaktakte.

Bis einschließlich 600px liegt die Aktennavigation unten fest: fünf gleich breite Spalten (Details, Ressourcen, Dateien, Notizen, Logbuch), Ebene 5, `surface`-Hintergrund und oberer `border`-Trenner. Padding: `0.5rem 0.5rem max(0.5rem, env(safe-area-inset-bottom))`; Knöpfe: `0.72rem` Schrift, `1.15` Zeilenhöhe, `0.5rem 0.1rem` Padding und `overflow-wrap: anywhere` — kein Bereich rutscht in eine seitliche Scrollfläche. Der Anwendungsrahmen reserviert bei vorhandener Akte `calc(6rem + env(safe-area-inset-bottom))` nach unten. Auf größeren Bildschirmen bleibt die Aktennavigation im Inhaltsfluss mit unterem Trenner.

## Elevation & Depth

Arbeitsflächen und Seitennavigation verwenden keine Schatten. Umrandungen und Flächenfarben schaffen Trennung. Die Anmeldung behält `0 0.25rem 1rem #20304408`; der generische Navigationsstil enthält `0 0.25rem 1rem #2030440d`, während Haupt- und Einstellungsnavigation diesen Schatten abschalten. Das native modale Menü liegt im Top Layer mit der neutralen Hintergrundabdunklung `backdrop` (`#0b0a09aa`); die Formulardialoge verwenden `scrim` (`light-dark(#1b1a1866, #0b0a09cc)`).

## Shapes

Kontrollen: `0.4rem`; Navigationslinks der Seitenleiste: `0.5rem`; Feldgruppen: `0.65rem`; Arbeitsflächen: `0.75rem`; Anmeldung: `1rem`, bis 600px `0.65rem`. Eingaben, Auswahlfelder, Textflächen, Knöpfe und Navigationslinks haben mindestens **44px** Höhe. Checkboxen und Radioknöpfe selbst sind `1.25rem` groß; ihre umgebenden Labels sind mindestens 44px hoch. Der Suchlink ist als `inline-flex` vertikal ausgerichtet und mindestens 44px hoch.

## Components

- **Stammdatenkataloge (BKP-MASTER-01):** Eventarten, Paketwerte und
  Absagegründe zeigen zunächst ihre vorhandenen Einträge. Ein nativer
  Aufklappbereich öffnet den Editor; Bearbeiten öffnet und fokussiert ihn.
  Einklappen erhält den Entwurf und kennzeichnet ungespeicherte Eingaben.
  Ein Wechsel zu einem anderen Eintrag fragt vor dem Verwerfen nach. Listen
  und Bedienelemente behalten die 44px-Ziele und umbrechen bei wenig Platz.
  Ist Speichern bestätigt, aber der Listenabruf fehlgeschlagen, bleibt die
  Bearbeitung bis zur erfolgreichen Aktualisierung gesperrt und die Meldung
  unterscheidet den bestätigten Schreibvorgang vom fehlenden Abgleich.

- **Produktliste (BKP010.4):** Produktname und Preis-/Steuer-/Zustandsangaben
  stehen in einer ruhigen Zeile untereinander; Bearbeiten und weitere Aktionen
  bleiben daneben und können mobil umbrechen. Aufgeklappte Aktionen stehen
  darunter. Die bestehenden Fokus-, Archiv- und Speicherregeln bleiben erhalten.

- **Ressourcenliste (BKP009.3):** Jede vorhandene Ressource erscheint als
  ruhige Zeile mit hervorgehobenem Namen, darunter Bestand, Kategorie und
  Status; die Bearbeiten-Aktion ist am Zeilenende ausgerichtet und bleibt
  mindestens 44px hoch. Auf schmalen Flächen dürfen Name und Aktion umbrechen.
  Suche, Filter und die getrennte Sperrverwaltung bleiben unverändert.

- **Kontaktliste (BKP011.2):** Die Listenansicht verwendet ruhige Flächen
  `field-surface` ohne Aufzählungspunkte. Der vollständige Kontaktname steht
  hervorgehoben in einer eigenen Zeile; Ansprechpartner, Archivstatus und
  Kontaktwege folgen darunter und dürfen umbrechen. Kontaktname und
  Kontaktlinks bleiben mindestens 44px hoch. Die geöffnete Kontaktakte bleibt
  davon getrennt und behält ihre bisherigen Fokus- und Speicherregeln.

- **Event-Details (BKP013.1, zusammenhängende Eventakte):** stabiler Ereigniskopf „Event: Name“ (`1.35rem`, `scroll-margin-top: 5rem`, `tabIndex=-1`, Fokus beim Öffnen) mit Datum, Zeitfenster beziehungsweise „Tagesbuchung, ohne Uhrzeit“, Statusmarke samt geschriebenem Statusnamen, Eventart und wirksamem Ort; ein fehlender Kontakt oder Ort ist ein normaler Zustand („Kontakt noch offen.“, „Ort offen“), keine Fehlerfläche. Fünf Bereiche in einer beschrifteten Navigation aus gewöhnlichen Knöpfen: Details, Ressourcen, Dateien, Notizen, Logbuch — `aria-current="location"` kennzeichnet den Bereich; es gibt kein ARIA-Tabmuster und keinen Mail-Bereich, solange kein Mailmodul existiert. Details gruppiert Termin, Allgemein (Eventart, Paket, Anfragequelle, Beschreibung), die Statusänderung und die Stammdaten-Aktion; Kontakt und Ort stehen ab **64rem** als eigene Spalte daneben, darunter hinter einem nativen `<details>` mit `44px` hoher Summary „Kontakt und Ort“ (ohne `matchMedia` bleibt der Kontext sichtbar). Ressourcen bleibt die bestehende Zuweisungsfläche mit einer atomaren Speicherung. Dateien enthält die Dokumentliste, nach tatsächlicher Art in getrennten Karten („Angebote“ mit der vorhandenen Anlage, weitere Arten wie „Rechnungen“ nur mit echten Zeilen, unbekannte Arten unter „Weitere Dateien“). Unterbereiche verwenden h3, ihre Unterblöcke h4 (`0.9rem`, Gewicht 650). Inaktive Bereiche bleiben mit `hidden` eingehängt, damit Status- und Ressourcenentwürfe beim Bereichswechsel und bei Hintergrundaktualisierungen erhalten bleiben; beim Wechsel erhält der gewählte Bereich selbst den Tastaturfokus (`tabIndex=-1`, sichtbarer Fokusring). Der ausgewählte Bereich und die geladenen Daten bleiben bei Versionsaktualisierungen erhalten (`revision`, stabile Eventidentität). Schließen führt zur auslösenden Eventzeile zurück; Bearbeiten öffnet das zentrale Eventformular und fokussiert das Namensfeld. Inaktive Knöpfe sind transparent mit `muted`-Schrift; aktive und überfahrene Knöpfe nutzen `selected-surface` und `selected-ink`.
- **Eventfilter und Editor:** native `<details>`/`<summary>` mit oberen und unteren `border`-Trennern und `1rem` Außenabstand. Summary ist mindestens `48px` hoch, mit Akzentschrift, Gewicht 600 und `0.75rem 0.25rem` Innenabstand. Filter sind bei vorhandenen Eventfiltern in der URL anfänglich geöffnet und tragen „Filter · aktiv“. Der Editor beginnt geschlossen. Bearbeiten oder Duplizieren öffnet ihn, scrollt zum Formular und fokussiert den Namen. Erfolgreiches Speichern oder ausdrückliches Abbrechen schließt ihn und fokussiert die Summary. Bloßes Einklappen erhält den Formularentwurf; Fehler lassen die Eingaben bestehen. Der Abbrechen-Knopf erscheint bei einem geladenen Bearbeitungs- oder Duplikatentwurf.
- **Eventzeilen (BKP014.1):** Monatsüberschrift `1.1rem`, Anzahl `0.8rem` mit Gewicht 400 und `muted`. Jede Zeile ist eine Karte mit zweispaltigem Raster `3.5rem minmax(0, 1fr)`: links die Datumsspalte (Tageszahl `1.65rem`/700 als dominante Figur, Wochentag und Monatskürzel `0.75rem`/600 in `muted`, z. B. „Sa / Okt“), rechts der Kartenkörper. Der Körper stapelt Status (Punkt `0.5rem` plus geschriebener Name, `0.75rem`, Großbuchstaben, `muted`), Eventart (`0.75rem`, Großbuchstaben), den vollständigen Titel (`1.05rem`, Gewicht 650, `white-space: normal` und `overflow-wrap: anywhere` — nie Ellipse oder Zeilenbegrenzung) und den wirksamen Ort (`0.875rem`, `muted`, `white-space: pre-line`). Zeitfenster beziehungsweise „Tagesbuchung, ohne Uhrzeit“ und der Kontakt stehen in der Meta-Zeile darunter; die technische Ressourcenanweisung entfällt. Der Statusstrich ist `3px` am linken Kartenrand; sichtbare Listenzeilen haben `1rem`/`0.85rem` Innenabstand, `field-surface` als Kartenfläche und `0.6rem` Abstand ohne Schatten; die geöffnete Eventakte bleibt ohne diese Kartenfläche. Genau ein Link je Karte umschließt die sichtbaren Felder und beginnt für Hilfstechnik mit „Öffnen: “; Bearbeiten/Duplizieren bleiben ruhige `tier-quiet-icon`-Aktionen außerhalb des Links. Undatierte Karten zeigen „–“ und „ohne Datum“, fehlende Art und fehlender Ort heißen „Art offen“ und „Ort offen“ statt einer Erfindung.
- **Aktionen (H036):** jede Fläche hat genau eine gefüllte `.primary-action`; `.secondary-action` bleibt transparent mit Rand und Gewicht 600, `.tertiary-action` ist randlos mit Gewicht 500 und Unterstreichung erst bei Hover; die Bereichsnavigation der Detailansicht ist `.nav-action`, ihr aktiver Eintrag zusätzlich fett mit Rand. Icon-Aktionen bleiben 44-px-Ziele und markieren mit `.tier-primary-icon` das einzige anlegende Icon eines Bereichs, mit `.tier-quiet-icon` Filter, Suche, Navigation und Zeilenaktionen. Keine Stufe unterscheidet sich nur in der Farbe: Füllung, Rand und Schriftgewicht tragen den Unterschied; deaktivierte Aktionen erhalten eine neutrale Füllung (`disabled-surface`), die lesbare Schrift `disabled-ink` (mindestens 4,5:1), Deckkraft 1 **und** einen gestrichelten Rand mit `not-allowed`. Die frühere Deckkraft 0.65/0.6 gilt nur noch für generische Eingaben und für Knöpfe ohne Stufe. Die Abmeldung im Navigationsfuß ist transparent mit `sidebar-ink`-Schrift und `menu-close-border`-Rand; beim Überfahren verwendet sie `sidebar-hover`. Allgemeiner Fokus: `3px solid var(--focus)`, Abstand `3px`.
- **Darstellungsumschalter:** „Dunkelmodus“ ist vor der Anmeldung in der Anmeldekarte und nach der Anmeldung in der Werkzeugleiste verfügbar, mit dekorativem Mond-SVG und `aria-pressed` für den Dunkelzustand. Gespeichert wird ausschließlich `light` oder `dark` unter `localStorage["ak-theme"]`; ungültige oder nicht lesbare Werte fallen auf die Systempräferenz zurück. Ohne explizite Wahl werden Systemänderungen übernommen. Ein Klick setzt eine explizite Wahl; Änderungen anderer Tabs sowie gelöschte Präferenzen werden über das `storage`-Ereignis übernommen. Bei gesperrtem Speicher funktioniert die Wahl für die laufende Sitzung. Das aktuelle Schema wird per Layout-Effekt als `data-theme` am Dokumentwurzelelement gesetzt; Farben wechseln ohne Übergangsanimation. Der Umschalter bietet keine eigene Funktion zum Zurücksetzen auf die Systempräferenz.
- **Angebotsentwurf (BKP016.1):** „Bearbeiten“ öffnet genau einen Inline-Editor innerhalb der Dokumentzeile in Event → Dateien. Beim ersten erfolgreichen Laden erhält Betreff den Fokus und wird mit `scroll-margin-top: 6rem` unter die Werkzeugleiste gescrollt; Speichern stiehlt keinen Fokus, Schließen führt zur auslösenden Zeilenaktion zurück. Betreff, Einleitung, Schlusstext und Gültigkeit nutzen die vorhandenen Feldstile und ein responsives Raster mit mindestens `18rem` Feldbreite, bei schmalem Platz eine Spalte. Überschrift `1rem`, Positionsüberschrift `0.95rem`; nur neutrale `border`-Trenner, keine neue Kartenfarbe. Positionen und exakter Bruttobetrag bleiben lesend sichtbar. Bearbeiten und Finalisieren sind sekundär, „Änderungen speichern“ ist die einzige primäre Editoraktion; die gespeicherte Vorschau öffnet als beschrifteter Downloadlink in einem neuen Tab. Ungespeicherte oder alte noch nicht ausdrücklich übernommene Inhalte sperren Vorschau/Finalisierung. Konflikt- und unklare Speicherantworten bewahren Eingaben und bieten Neuabruf; die ausdrückliche Verwerfrückfrage schützt Änderungen. Lade-, Fehler- und Altentwurfszustände sind Text im selben Arbeitsbereich, keine neuen Overlays.
- **Angebotspositionen (BKP016.3, geändert EDITOR-LAYOUT-01):** Bestehende Positionen und neue freie Positionen stehen im Inline-Editor als beschriftete Feldgruppen, ohne zusätzliche Kartenebene. Jede Gruppe hat eine nummerierte Legend und Beschreibung, Menge, Einheit, Einzelpreis in Euro, Steuer und EIN Rabattfeld („Rabattart“ Prozent/Euro, siehe „Positionsfelder“). Die Preisbasis steht seit EDITOR-VISUAL-01 als kompakter Brutto/Netto-Schalter in der Positionskopfzeile und nicht mehr als Select neben dem Preis (siehe „Positionsaktionen“). Das Preisfeld nennt die gespeicherte Grundlage („Einzelpreis (Brutto) in Euro“ beziehungsweise „(Netto)“); ein Grundlagenwechsel benennt nur das Feld, der Betrag bleibt unverändert und die Rechnung übernimmt der Kern. Das Raster folgt der Breite der Positionsliste gemäß DOC-PRODUCT-01.1/EDITOR-LAYOUT-01. Der Editor gliedert sich in benannte Fieldsets (Kopfdaten und Einleitung, Positionen, Gesamtrabatt, Summen und Hinweise) mit neutralen Trennlinien; Labels bleiben vollständig sichtbar und Felder brichten bei Platzmangel um statt zu quetschen. Die Feldgruppen nutzen `0.65rem` Rasterabstand und `0.45rem 0.5rem 0.65rem` Innenabstand. Native deaktivierte Fieldsets sperren alle Felder während Laden/Speichern. Neue freie Positionen erhalten den Fokus in Beschreibung, Entfernen fokussiert die benachbarte Gruppe; stabile lokale Schlüssel erhalten den Fokus beim Speichern. Euro-/Prozentwerte verwenden dieselben exakten Dezimalhelfer wie Vorlagen. Die Summe heißt „Gespeicherter Gesamtbetrag“ und wird nur aus bestätigten Serverantworten übernommen; nebenstehender Text erklärt die Neuberechnung beim Speichern. Unsichere Speicherzustände sperren Vorschau und Finalisierung auch nach Zurücksetzen lokaler Eingaben bis zum ausdrücklichen Neuabruf. Keine Produktwahl an bestehenden Positionen oder dekorative Bewegung.
- **Blankoangebot (BKP017.1):** Die vorhandene Vorlagenauswahl erhält „Ohne Vorlage“, ohne zusätzlichen Anlageassistenten. Nach bestätigter Blankoanlage öffnet derselbe Inline-Editor; ein neutraler Leerhinweis führt zu freier Position oder Katalogwahl. Ein leerer Bestand allein löst keine Verwerfrückfrage aus, Vorschau/Finalisierung bleiben bis zu gültigen Positionen gesperrt. Eine unklare Anlageantwort zeigt eine Bestandsprüfung statt einer blinden Wiederholungsaufforderung. Bestehende Vorlagenanlage, Feldraster, Farben, Fokus- und Touchregeln bleiben erhalten.
- **Produktwahl im Angebotseditor (BKP016.4, geändert EDITOR-PICKER-01):** „Produkt hinzufügen“ öffnet ein Modal „Produkt auswählen“ (role=dialog, aria-modal) mit Suchleiste (filtert Name/Beschreibung clientseitig), Mehrfachauswahl über zugängliche Checkboxen (Zeilen min. 44 px, Name, Preis mit Basis und Steuer, Beschreibung klein) und zwei Aktionen: „Hinzufügen“ unten mittig (primär; fübt alle gewählten Produkte in EINEM Schub als Positionen in Katalogreihenfolge an, deaktiviert bei leerer Auswahl, danach Fokus auf die erste neue Beschreibung) und „Schließen“ (X oben rechts). Escape und Klick auf den Backdrop schließen OHNE Anlage und verwerfen die Auswahl; der Fokus kehrt zum Auslöser zurück. Der frühere Einzelweg (Select + „Als Position hinzufügen“) ist im Dokumenteditor ersetzt; im Vorlageneditor bleibt das Positions-Select „Produkt“ als bestehender Einzelweg je Position erhalten, das Sammel-Modal ist zusätzlich über „Produkt hinzufügen“ erreichbar. Lade-/Leerzustand und wiederholbarer Fehler erscheinen im Modal; sie verdrängen keine Speicher-/Konfliktmeldung. Hintergrund ist bei offenem Modal nur visuell blockiert (wie die vorhandenen Formulardialoge).
- **Produktübernahme in Dokumentvorlagen (BKP015.1, geändert DOC-PRODUCT-01.3):** Das vorhandene Produktfeld übernimmt den Katalogpreis mit seiner Preisbasis unverändert; es wird nicht mehr umgerechnet. Das sichtbare Preislabel nennt die übernommene Grundlage (Brutto beziehungsweise Netto), die Position trägt ein „Preisbasis“-Select. Die Übernahme kann rechnerisch nicht mehr scheitern; eine neue, kopierte oder andere Vorlage beginnt ohne alte Übernahmefehlermeldung. Vorhandene Feldraster, Farben und Touchziele bleiben erhalten; keine neue Einstellung oder Animation.
- **Vorlagenarchivierung (BKP015.2):** Fortschritt und bestätigter Erfolg verwenden Statusmeldungen, Ablehnungen und unklare Ausgänge eine Alertmeldung. Der ausdrückliche Bestandsabgleich ist eine tertiäre GET-Aktion. Bis zum Abgleich sind weitere Änderungen gesperrt, getippte Eingaben bleiben erhalten. Nach deaktiviertem Auslöser führt der Tastaturfokus zum Bestandsabgleich und danach zur wieder verfügbaren Zeilenaktion (nach bestätigter Archivierung „Bearbeiten“). Fehlt die Zeile, dient die Überschrift als Rückkehrziel. Bewusst anderweitig bewegter Fokus und inaktive Arbeitsbereiche werden nicht übersteuert. Keine neue Farbe, zusätzliche Karte oder Animation.
- **Vorlageneditor auf Aufruf (BKP015.4):** Zunächst Liste und eine primäre Anlegen-Aktion. Erst Anlegen/Bearbeiten/Duplizieren zeigt den vorhandenen Inline-Editor samt Platzhalterhilfe; dort ist Speichern die primäre Aktion, Abbrechen tertiär. Liste und ruhige Zeilenaktionen bleiben erreichbar. Fokus beginnt in Bezeichnung, Rückkehr zum Auslöser nur bei verfügbarem Ziel und ohne inzwischen anderweitig gesetzten Fokus. Rückfrage vor Verwerfen geänderter Texte oder Positionen; bestätigtes erneutes Öffnen derselben Vorlage setzt auch unkontrollierte Textfelder zurück. Bestehende Farben, Feldraster, Touchziele und native Rückfragemuster bleiben erhalten; keine neue Karte oder Bewegung.
- **Vorlagen speichern und abgleichen (BKP015.5b):** Eine bestätigte Speicherantwort schließt den Editor und hält die gespeicherte Zeile sichtbar, auch bei fehlgeschlagenem oder älterem Listenabruf. Die tertiäre Aktion „Vorlagen neu laden“ liest nur den Bestand. Ein unklarer Anlageauftrag erhält einen eigenen, ausdrücklich beschrifteten Wiederholungsknopf; nur derselbe eingefrorene Auftrag mit derselben Vorgangs-ID wird gesendet. Andere Änderungen bleiben bis zur Klärung gesperrt. Bei unklarer Änderung bleibt der Entwurf erhalten; ein Bestandsabgleich ändert seine Version nicht still. Fokus führt nur bei weiterhin lokalem Fokus zur Wiederherstellungsaktion und übersteuert keinen bewussten Wechsel. Status und Fehler erklären Erfolg, Unklarheit und nächsten Schritt getrennt. Bestehende Farben, Feldraster und Touchziele bleiben erhalten; keine zusätzlichen Karten, Dialoge oder Bewegung.
- **Gruppierte Vorlagenliste (BKP015.6):** Nur befüllte Dokumentarten erhalten einen benannten Bereich mit Überschrift und semantischer Liste; unbekannte Arten bleiben unter „Weitere Dokumentarten“ sichtbar. Ein leerer Gesamtbestand bekommt einen ruhigen Hinweis. Zeilen haben links die bestehende Zusammenfassung und rechts eine bündige, umbrechende Aktionsgruppe; bis38rem stehen die Aktionen darunter links. Listenpunkte entfallen, Trennlinien nutzen `border`, Abstände und Schrift folgen dem vorhandenen System. Keine neuen Filter, Menüs, Farben oder Bewegungen. Beim Wechsel der Dokumentart führt die Fokus-Rückkehr weiterhin zur Bearbeiten-Aktion der umgruppierten Zeile.
- **Seltene Vorlagenaktionen (BKP015.7):** Bearbeiten bleibt sichtbar; der ruhige benannte Schalter „Aktionen“ öffnet Duplizieren und Archivieren nur für eine Zeile. Native Buttons in einer benannten Gruppe, keine ARIA-Menürolle mit unvollständigem Tastaturmodell. Die Gruppe bleibt im normalen Layoutfluss und bricht mobil um; kein abgeschnittenes Overlay. Escape schließt und fokussiert den Schalter, ein Wechsel nach außen schließt ohne Fokusübernahme. Duplizieren/Archivieren verwenden den sichtbaren Schalter als Rückkehrziel. Archivierte Vorlagen behalten die deaktivierte Archivaktion. Bestehende Touchziele, Fokusrahmen und Aktionsstufen bleiben erhalten; keine neue Farbe, Animation oder Einstellung.
- **Fiktive Vorlagenvorschau (BKP015.8):** Im offenen Editor eine sekundäre Inhaltsvorschauaktion, Speichern bleibt primär. Der Hinweis grenzt Beispieldaten und neutrales Briefpapier von echten Geschäftsdaten ab. Fortschritt/Erfolg in genau einer Statusmeldung, Fehler als verständlicher Hinweis mit erhaltenen Eingaben. Erst eine geprüfte PDF-Antwort bietet den bewussten Download über den vorhandenen mindestens44px hohen `document-download`-Link. Nach Entwurfsänderungen verschwindet die veraltete Vorschau mit Hinweis zum erneuten Erstellen. Kein Popup, kein zusätzlicher Dialog, keine neue Farbe oder Bewegung; vorhandene responsive Formulargruppen und Fokusrahmen bleiben maßgeblich.
- **Freier Rechnungsentwurf (DOC-BLANK-INVOICE-02):** „Dokument anlegen“ öffnet die bekannte Dokumentauswahl. „Rechnung ohne Auftragsbestätigung“ zeigt den Eventkontakt und eine primäre Anlageaktion. Ein unklarer Auftrag lässt sich aus demselben Dialog mit seiner gespeicherten Vorgangs-ID samt Event und Kontakt wiederholen. Der Dialog zeigt die Sperre bei verändertem Hauptkontakt an. Eine beschädigte Vorgangs-ID kann erst nach Listenabgleich und ausdrücklichem Verwerfen mit Dublettenhinweis freigegeben werden. Der bestätigte Entwurf öffnet im bestehenden Rechnungseditor; Schließen gibt den Fokus an den Auslöser zurück. Feldraster, Dialoggröße, Farben und Tastaturverhalten folgen der vorhandenen Gestaltung.
- **Formulare:** sichtbare Labels, Felder mit `surface`-Hintergrund und `field-border`-Rand; Textflächen und Mehrfachauswahl mindestens `7rem` hoch. Checkboxen/Radios verwenden die Akzentfarbe.
- **Weitere Eventkontakte (EDIT-02.3):** Die direkte Eventbearbeitung zeigt bestehende weitere Kontakte als Liste mit ruhiger Entfernen-Aktion und eine beschriftete Suche im selben Feldbereich. Auswahl und Entfernen setzen den Fokus zurück auf die Suche; gespeichert wird beim Verlassen der Gruppe. Escape verwirft nur den aktuellen Entwurf. Bereits zugeordnete und als Hauptkontakt gewählte Treffer entfallen aus der Auswahl; leere Suche, Suchfehler und die Grenze von 50 weiteren Kontakten werden verständlich benannt. Bestehende Feld-, Fokus- und Touchstile bleiben erhalten; keine neuen Farben oder Animationen.
- **Kontobereich:** Kontoidentität, Abmeldung und Anmeldestatus liegen im Navigationsfuß: auf dem Desktop in der Seitenleiste, mobil nur im geöffneten Dialog. Das einspaltige Kontogrid hat `0.6rem` Abstand. Sichtbare Rückmeldungen verwenden `sidebar-hover` und `sidebar-ink`, einschließlich fehlgeschlagener Abmeldung; ihre Statusrolle bleibt innerhalb des modalen Kontexts erreichbar. Im abgemeldeten Zustand steht die Statusmeldung ausschließlich direkt in der Anmeldung.
- **Datenexport:** Unter Einstellungen → Datenexport (`#settings-export`) stehen drei native Downloadlinks für Kontakte, alle Events und den Produktkatalog in einer semantischen Liste (`ul`/`li`). Links sind als `inline-flex` ausgerichtet, mindestens 44px hoch und mit Gewicht 600 gesetzt; bestehende Link- und Fokusfarben gelten. Erläuterungen verwenden `muted` und `margin: 0 0 0.75rem`; sämtliche Absätze im Exportbereich bleiben auf `70ch` begrenzt. Der Text erklärt den vollständigen Bestand unabhängig von Filtern, die enthaltenen archivierten beziehungsweise annullierten Einträge und die Abgrenzung zur vollständigen Datensicherung.
- **Kalenderzustände:** Die Kalenderlegende ist eine mit „Kalenderlegende“ benannte Gruppe (`role="group"`) aus einer kompakten Zeile kleiner Farbfelder mit Text, nicht aus großen farbigen Blöcken. Pastellfarbene Eventartikel und Ressourcenzellen (`calendar-state`) behalten in beiden Darstellungen die feste dunkle Schrift `--calendar-ink` (`#111827`) und benennen ihren Zustand zusätzlich als Text. Links erben diese Farbe statt des allgemeinen Akzents; ihr Fokusrahmen verwendet ebenfalls `--calendar-ink`.
- **Mobiler Monatskalender (BKP008):** Das Raster bleibt ein echtes Mo–So-Raster; jede Zelle ist ein nativer Tagesknopf mit einzeiliger Tageszahl (`1`…`31`, nicht „Do., 01.10.“), mindestens `44px` hoch und über die volle Spaltenbreite klickbar (bei 320px rund `33 × 44px`, weil sieben Spalten nicht mehr zulassen). Der zugängliche Name des Knopfes nennt den vollen Tag, „heute“ und die Anzahl samt Statusnamen (`aria-label`), `aria-pressed` markiert die Auswahl, `aria-current="date"` den heutigen Tag. Heute trägt eine gestrichelte Kontur und das Wort „Heute“, die Auswahl eine durchgezogene Kontur mit `selected-surface` und Innenring — keine große grüne Fläche, keine Unterscheidung allein über Farbe. Bei mehreren Events zeigt eine kleine Zahl die Anzahl, gezeichnete Statusmarken (`0.42rem`) ordnen die Zustände (gefüllt = gebucht, Ring = Option/Anfrage, Quadrat = Vormerkung, Strich = Sperre, Kreuz = Konflikt). Unterhalb von `60rem` entfallen die Eventtitel in der Zelle; darunter steht die Tagesagenda mit vollständigem, umbrechendem Titel, Zeit beziehungsweise „Tagesbuchung, ohne Uhrzeit“, Status, Ort, Kontakt, Ressourcen und einem mindestens `44px` hohen Eventlink. Ein Tag ohne Events sagt „Keine Events an diesem Tag.“ ausdrücklich. Der Tageswechsel holt keine Daten neu; die Tabelle hat genau einen Tabulatorschritt, und die Pfeiltasten bewegen die Auswahl (rechts/links ±1 Tag, oben/unten ±7 Tage), ohne den Fokus zu verlieren.
- **Navigation:** aktive Links tragen `aria-current="page"`; dekorative SVGs sind `aria-hidden`. Die Ressourcenverwaltung ist neben dem Einstellungsunterpunkt auch direkt über die Hauptnavigation erreichbar; bei beiden Ressourcen-URLs ist dort ausschließlich „Ressourcen“ aktiv. Einstellungen gruppieren Stammdaten, Ressourcen, Produkte, Kalender-Abos, Telegram, E-Mail-Versand, Datenimport, Datenexport und Konto/Zugriff. Marke und Einklapp-Schalter stehen in einer gemeinsamen kompakten Markenzeile (`sidebar-brand-row`, randlos über beide Innenabstände der Leiste, also etwa `224px` breit und `44px` hoch: Marke mit rund `176px`, Lücke `0.25rem`, Schalter mit `44 × 44px` am rechten Rand). Die Wortmarke trägt in der Leiste die dokumentierte Größe `1rem` (der Markenname `AuftragsKompass` bleibt dadurch auch mit breiten Systemschriften ungekürzt; der mobile Drawer behält `1.15rem`). Eingeklappt stapelt dieselbe Zeile das AK-Kürzel über dem Ausklapp-Schalter, beide `44 × 44px` und zentriert; der Schalter behält seine logische Position und bleibt dasselbe DOM-Ziel für den Tastaturfokus. Zugänglicher Name, `title` und `aria-expanded` wechseln mit dem Zustand, die neue Präferenz liegt in `localStorage["ak-sidebar-icon-rail"]` samt `storage`-Übernahme. Ohne neue Präferenz beginnt die Leiste schmal; eine frühere Breitansicht wird nicht übernommen. Die Version steht klein in der Desktop-Kopfzeile. Das mobile Menü bietet weiterhin ausschließlich Öffnen und Schließen, keinen Desktop-Einklapp-Schalter.
- **Telegram-Einstellungen:** Unter Einstellungen → Telegram (`#settings-telegram`) stehen Status, Bot-Token und Chat-ID. Das Passwortfeld wird nie vorausgefüllt; erfolgreiche Speicherung leert es, und das Token wird nicht aus der API gelesen oder angezeigt. Ein eingerichteter Bot kann aktualisiert oder deaktiviert werden. Lade-, Fehler- und Erfolgsrückmeldungen verwenden die vorhandenen Statusrollen.
- **E-Mail-Versand (MAIL-ACCOUNT-01):** Unter Einstellungen → E-Mail-Versand (`#settings-mail`) steht die Kontoliste der Versandkonten (ruhige `master-data-list`-Zeilen mit Name, Absenderadresse, Aktiv/Inaktiv und „Passwort gesetzt“) und darunter ein gemeinsames Formular für Anlage und Bearbeitung in einem beschrifteten Fieldset: Kontoname, Absendername, Absenderadresse, SMTP-Server, SMTP-Port, Transportverschlüsselung (Select „STARTTLS“/„SSL/TLS (SMTPS)“/„Ohne (nur lokales Relay)“), Benutzername, Passwort und die Checkbox „Konto aktiv“. Ohne vorhandenes Konto erscheint das Formular sofort; „Versandkonto anlegen“ öffnet es, „Bearbeiten“ je Zeile lädt die Werte und fokussiert den Formularbeginn. Das Passwortfeld wird nie vorausgefüllt und nach dem Speichern geleert; ein Hinweis nennt bei gesetztem Passwort „Leer lassen, um es unverändert beizubehalten.“, sonst die Verschlüsselung. Genau eine primäre Aktion („Speichern“/„Änderungen speichern“), „Abbrechen“ sekundär; Felder, `18rem`-Formularraster, 44px-Ziele, Status-/Alertrollen und neutrale Fehlerkopien folgen dem Telegram-Muster. Der Hinweistext sagt ausdrücklich, dass Speichern keine E-Mail versendet. Lade-, Fehler- und Erfolgszustände bleiben im selben Arbeitsbereich, „Einstellungen neu laden“ ist die tertiäre Abgleichaktion.
- **Mobiles Menü:** natives `<dialog>` über `showModal()`, beschriftet mit „Menü“. Der Auslöser zeigt ein dekoratives 22 × 22px Hamburger-SVG auf transparenter Fläche; sein zugänglicher Name bleibt „Menü öffnen“. Breite `min(21rem, calc(100% - 2rem))`, Höhe `100dvh`. Der Schließen-Knopf behält helle Seitennavigationsschrift; sein Hoverhintergrund ist in beiden Darstellungen `sidebar-hover` (`#2a2825`). Schließen über Knopf, Navigation oder native Escape-Behandlung; explizites Schließen setzt Fokus auf den Auslöser zurück. Der Browser übernimmt modalen Fokus und Hintergrundinertheit. Klicks außerhalb des Dialogrechtecks schließen das Menü ebenfalls. Beim Wechsel auf Desktopbreite (`min-width: 901px`) schließt ein `matchMedia`-Listener den geöffneten nativen Dialog und setzt `aria-expanded` zurück. Der Fokus wechselt auf den aktuellen Link der Desktop-Seitenleiste; fehlt dieser, etwa in der Suche, auf den Suchlink der Werkzeugleiste. Beim Unmount wird der Listener entfernt.
- **Formulardialoge (UI-NATIVE-01):** Event anlegen, Kontakt, Produkt, Ressource, Produktwahl und Position entfernen sind native `<dialog>`-Elemente über `showModal()` (gemeinsame Hülle `ModalDialog`). Der Browser übernimmt Top Layer, Fokusfalle und Hintergrundinertheit; `aria-modal` entfällt an nativen Dialogen. Escape und – wo vorgesehen – ein Klick außerhalb des Dialogrechtecks schließen, solange nichts gespeichert wird. Die Abdunklung kommt aus `::backdrop` mit `scrim`. Ein auf einer verborgenen Arbeitsseite offener Dialog verlässt den Top Layer und kehrt beim Zurückwechseln zurück. Fokus, den der Aufrufer beim Schließen setzt, wird nach dem Entfernen des Dialogs nachgeholt.
- **⋯-Menüs (UI-NATIVE-02):** Zeilenmenüs (Eventkarte, Produkt, Dokumentvorlage, Dokumentposition, Dateien) sind native Popover (`popover="auto"`) im Top Layer, per `anchor-name`/`position-anchor` unter dem Auslöser, `position-area: bottom span-left`, an der Unterkante gespiegelt. Fläche `surface`, Rahmen `border`, Schatten `shadow-dialog`, Einträge 44px hoch, linksbündig, Hover `hover-surface`, gesperrt `disabled-ink`. Klick daneben und Escape schließen über den Browser; Fokus kehrt zum Auslöser zurück.
- **Kontaktliste (UI-BKP-12):** Kontextspalte `.contacts-context` wie die Eventspalte (ab 1024 px `position: fixed`, 17,125rem, `surface`, Linie rechts; Titel 22/600 rein visuell, Plus, gefülltes Suchfeld `filled-field` ohne sichtbares Label, CSV-Export als Link). Nur auf der Kontaktseite (`data-column`); in der globalen Suche und unter 1024 px eine Werkzeugleiste. Tabelle `.contacts-results` in einer Karte: Kopfzeile Name/E-Mail/Telefonnummer (600, 14px), Zeilen 44px mit `table-surface` auf jeder zweiten, Name 600, Adresse und Nummer als ruhige Links in `ink`, ⋯-Popover mit „Bearbeiten“. Schmal: Name und Menü oben, Mail und Nummer darunter.
- **Kontaktakte (UI-BKP-13):** Brotkrume `.contact-record-crumbs` (14px; „Kontakte“ als ruhiger Rückweg, aktueller Name in `accent`, 600). Karten `surface` mit Rahmen, `radius-card`, `shadow-card`: Kontaktkarte (Art/Zustand, h2, Angaben, Anschrift; Stift 44px oben rechts), „Kontaktdaten bearbeiten“ und „Events“. Reiter „Chronologisch“/„Ohne Datum“ als Knöpfe mit `aria-pressed`, aktiver mit 2px `accent`-Unterstrich; Eventzeilen auf `table-surface`. Bei offener Akte entfallen Tabellenkopf und übrige Zeilen (bleiben gemountet).
- **Ressourcenseite (UI-BKP-14):** eigene `.workspace-page` außerhalb des Einstellungsrahmens. Ab 1024 px `.resource-filter-column` fest neben der Leiste (17,125rem, `surface`, Linie rechts; h2 22/600, Plus, Filter mit gefülltem Suchfeld). Tabelle ab 48rem: Kopf Name/Bestand/Kategorie/Zustand (600, 14px), Zeilen 44px, jede zweite `table-surface`, „Gesperrt“ in `danger-ink`; schmal Name und eine gedämpfte Zeile „1 Stück · Kategorie · Zustand“.

- **Location in der Eventakte (LOC-BKP-01):** In der Karte „Ort / Adresse“
  steht ein ruhiges Plus im gemeinsamen Kartenkopf. Es öffnet einen nativen
  Formulardialog mit Fokus auf „Name“, einer einspaltigen Anschrift und
  „Anlegen und zuordnen“ als Primäraktion. Auf schmalen Fenstern ist der
  Einstieg unter „Kontakt und Ort“ erreichbar. Escape und „Abbrechen“ geben
  den Fokus ans Plus zurück. Bei Fehlern bleiben die Eingaben im Dialog.
- **Location-Zuordnung (LOC-BKP-01):** Die Karte zeigt die bestätigte
  Zuordnung. Bei Versionskonflikten bleibt der angelegte Ort in der Auswahl
  „Gespeicherter Ort“ verfügbar, und der Eventeditor zeigt die Konfliktlösung.
- **Ressourcen in der Akte (UI-BKP-15):** Fieldsets von `.resource-assign` als Karten (`surface`, Rahmen, `radius-card`, `shadow-card`, Abstand 0,75rem), Legende 16/700; Checkboxzeile 44px; Pufferzeile 14px `muted`; Verfügbarkeit `.resource-assign-state` als Pille (`data-state`: free `status-booked-surface`, hold `status-option-surface`, blocked `alert-surface`/`alert-ink`, stale `status-surface`).
- **Ressourcen-Einstellungen (RES-BKP-01):** Einstellungsseite mit h2, gedämpfter Einleitung, Schalterzeile (Titel 600, Hinweis 14px `muted`, natives `input[role=switch]` 44 × 24px, an `accent`, Bewegung 150ms, bei reduzierter Bewegung ohne) und Innenkarte „Kategorien“ (`.settings-subcard`, Rahmen, `radius-card`; Kopf h3 mit Plus). Kategorien als gefüllte Zeilen `table-surface`, 44px, Unterkategorien eingerückt (1,25rem je Ebene), Nutzung „· n Ressourcen“ gedämpft, ⋯-Popover Bearbeiten/Löschen (rot). Dialog mit Name und „Innerhalb Kategorie“.
- **Ressourcenliste (RES-BKP-02):** Kontextspalte mit Listen „Typ“ (Set, Case, Item) und „Kategorie“ (Kopf 14px/600, Stift-Link zu den Einstellungen): Einträge 40px, eingerückt, gewählter 600 mit 3px-Balken links (`aria-pressed`); Checkbox „Archivierte anzeigen“. Tabelle ab 48rem: Typ · Name · Bestand · Kategorie · Zustand; schmal steht der Typ als kleines Versal-Label über dem Namen. Dialog: Typ-Auswahl mit Erklärung (`.field-hint`, 13px `muted`), Kategorie mit Vorschlagsliste und Hinweis.
- **Ressourcenakte (RES-BKP-03):** Kontextspalte „Ressource“ (14px `muted`) über dem Namen (22/600), darunter Details/Bestand/Planung als 44px-Einträge (aktiv `selected-surface`). Inhalt: Brotkrume wie die Kontaktakte, Karten `.record-card` (Rahmen, `radius-card`, `shadow-card`, h3 18/700, Stift im Kopf). Stammdaten als Begriffsliste, Einheiten als gefüllte Zeilen, Planung als Tabelle mit Statusring (Vormerkung `status-option`, bestätigt `accent` mit Haken) und Event-Chip mit Statuspunkt.
- **Akten-Verknüpfungen (RES-BKP-04):** ab 1200px rechte Spalte `.record-side` (16–22rem) neben `.record-main`, schmal darunter; je Karte h3 und ruhiges Plus, leere Karten „Noch nichts hinzugefügt.“ kursiv `muted`, Einträge als Links mit „· Typ · Kategorie“. Auswahl-Dialog bis 48rem: gefüllte Suche/Typ/Kategorie in einer Zeile, Liste mit Häkchen (44px-Zeilen, Typ · Name · Kategorie), Speichern erst nach Änderung.
- **Bewegung:** Knöpfe skalieren bei Aktivierung auf `0.98` mit `150ms cubic-bezier(0.23, 1, 0.32, 1)`. Nur die Transformation wird animiert; Farben wechseln sofort, damit beim Darstellungswechsel keine gemischten Farbzustände entstehen. Bei `prefers-reduced-motion: reduce` entfallen Transition und Skalierung. Das Menü erhält nur bei Zeigeraufruf und `no-preference` eine Eintrittsbewegung über `220ms`, Ausgangsposition `translateX(-1rem)` und Deckkraft 0 via `@starting-style`. Tastaturaufruf und reduzierte Bewegung haben keine Menübewegung; keine eigene Austrittsanimation.
- **Rückmeldungen:** `role="status"` für Status, `role="alert"` für Fehler. Leere Statusfelder verschwinden; „Angemeldet“ bleibt visuell verborgen für assistive Technik erhalten.

### Ressourcenfilter (BKP030.4)

Die Ressourcenverwaltung gruppiert Suche, Kategorie und Zustand als beschriftete
Filter. Ab 960px stehen sie links neben der Ergebnisliste; darunter öffnet ein
Filterknopf die Felder über der Liste und nennt die Zahl aktiver Kriterien.
Auswahl und Fokus bleiben beim Schließen und beim Breitenwechsel erhalten.
Die Anlegeaktion steht im Bereichskopf. Fehlermeldungen,
leere Treffer und Aktualisieren bleiben bei den Ergebnissen; bestehende Farben,
Fokuszustände und Ressourcensperren bleiben erhalten.
Die Bearbeitung erscheint als beschrifteter Stiftknopf mit 44px Bedienfläche;
auch lange Namen brechen neben dem Knopf um.
Produktzeilen verwenden denselben Stift sowie eine ruhige, beschriftete
Dreipunktaktion für seltene Vorgänge; lange Namen brechen neben ihnen um.

„Dokumente“ in der Hauptnavigation öffnet die vorhandene Geschäftsdokumentliste
mit denselben Filtern; die Dateibibliothek wird dort ausgeblendet. Der bisherige
Dateienbereich bleibt über sein bestehendes Ziel und seine Deep Links erreichbar.
Ein kurzer Hinweis mit Rückweg zu Events erklärt die aktuell vorhandene Angebotserstellung.

Die Kopfzeile zentriert Suche und Farbschema vertikal auf derselben Höhe.
Ab 1100px steht die Einstellungsnavigation als vertikale Spalte neben dem Inhalt; darunter (nicht mehr erst ab 900px) ersetzt sie der beschriftete Bereichswähler.

**Gruppierte Einstellungen (UI-PARITY-01, 25.11.2026):** Reihenfolge und Gruppen folgen der beobachteten Bookitup-Einstellungsnavigation (Screenshots vom 24.11.2026, Browserbeobachtung, kein REA-Beleg): Stammdaten · Integrationen (Kalender-Abos, Telegram, Website-Formular, Website-Eingänge) · Ressourcen · E-Mail (Vorlagen, Ein- & Ausgangsserver, Signatur) · Dokumente (Dokument-Vorlagen, Produkte, Dokument-Layout, Nummernkreise) · Daten (Datenimport, Datenexport) · Passwort & Account. Behutsam vereinfacht: Bookitups Gruppen klappen ein, hier sind sie dauerhaft offen (`role="group"` mit `aria-label`), damit kein Bereich einen Extraklick kostet. Gruppenüberschrift `0.8rem`/600 in `ink`, links bündig mit den Einzelbereichen (`0.85rem` Innenabstand); Unterpunkte `1.6rem` eingerückt. Der Bereichswähler zeigt dieselben Gruppen als `<optgroup>`. Die Signatur hat eine eigene Seite (`#settings-mail-signatures`). Bookitup-Punkte ohne Gegenstück (Profil, Team, Paket & Abrechnung, Dienstleister-Netzwerk, Workflow, Aufgabenvorlagen, Fragebogen-/Vertragsvorlagen, Mehrwertsteuer, Datenschutz) werden nicht als tote Einträge nachgebildet.

## Do's and Don'ts

**Do:**

- Vorhandene CSS-Variablen und semantische HTML-Elemente weiterverwenden.
- Aktive Navigation mit aria-current kennzeichnen und ausgeblendete Arbeitsbereiche mit hidden verbergen.
- Tastaturbedienung und reduzierte Bewegung berücksichtigen.

**Don’t:**

- Keine zusätzliche Markenwelt oder unbelegte Produktfunktionen aus dieser Dokumentation ableiten.
- Keine Bewegungsanimation für den Tastaturaufruf des mobilen Menüs ergänzen.
- Keine Daten aus einem ausgeblendeten Arbeitsbereich als sichtbar behandeln.

### Dokumentlayout (BKP018.1, 24.10.2026)

Die Einstellungsnavigation führt „Dokumentlayout“ unter
`#settings-document-layout`. Standard ist eine kompakte Absender-/Darstellungs-
zusammenfassung; erst „Dokumentlayout bearbeiten“ öffnet das Formular. Ohne
Konfiguration beginnt der Ablauf ausdrücklich mit „Dokumentlayout einrichten“.
Absenderfelder bilden ein responsives Grid, ab 15rem Mindestfeldbreite; auf
kleinen Flächen werden sie einspaltig. Zusätzliche Druckoptionen bleiben in der
nativen Disclosure „Darstellung“. Neutraler bestehender Feldhintergrund,
Feldrand und Ink, 44px Mindesthöhe, Kontrollradius 0.4rem; kein neuer Farb- oder
Typografiestil. Die bearbeiteten PDF-Farben sind Dokumentinhalte und ändern
nicht das Administrationstheme.

Die Geschäftsfußzeile nutzt eine eigene Disclosure mit drei beschrifteten
Mehrzeilenfeldern im selben Grid. Die Spaltenreihenfolge bleibt bei schmaler
Ansicht von oben nach unten lesbar. Die Vorschau berücksichtigt die aktuelle
Eingabe bereits vor dem Speichern.

Ein Speichern-Primärknopf, eine sekundäre Vorschauaktion; die Vorschau benötigt
kein vorheriges Speichern und erhält deutlich bezeichnete Öffnen-/Downloadlinks.
Kein iframe oder zusätzliches Modal. Konflikt/unklarer Ausgang erhält Eingaben
und fordert ausdrücklich Bestandsabgleich an. Die neuen Zustände verwenden
bestehende Status-/Alertrollen; ein veraltetes PDF wird nach Änderungen nicht
weiter als aktuelle Vorschau angeboten. Bestehender globaler Dirty-Check bleibt
angebunden. Der finale Detector zeigt keine Befunde in geändertem Code; seine
61 Hinweise in älteren Teilen der gemeinsamen CSS-Datei wurden nicht pauschal
als Teil dieses Slices umgebaut. Mobil-/Desktop-/Theme-Abnahme gehört zum
konkreten Browserbeleg, nicht allein zu diesem Designeintrag.

### Direkte Terminbearbeitung (EDIT-02.4, 29.10.2026)

In der Eventakte bildet „Termin“ eine beschriftete Feldgruppe mit Datum,
Beginn und Ende. Ein kurzer Hinweis im bestehenden `event-panel-hint`-Stil
erläutert Tagesbuchung und Startdatum; zusätzliche Karten, Farben oder
Animationen entfallen. Auf schmalen Displays stehen die nativen Felder
untereinander. Ein ungültiger oder noch nicht bestätigter Entwurf bleibt
sichtbar; Konflikt und Abgleich verwenden die bestehenden Meldungen und
Aktionen. Escape stellt den Fokus auf das aktuelle Feld beziehungsweise auf das
Zeitfeld zurück, wenn eine Auswahl nicht mehr angezeigt wird.

### Notizen (QW3, 25.11.2026; ersetzt EDIT-02.5)

Die Notizen sind datierte Einträge wie in Bookitup. Oben steht der gemeinsame
Texteditor aus den Mail-Dialogen (`MailBodyEditor`, ohne Platzhalterwahl) mit
„Notiz hinzufügen“ als sekundärer Aktion. Darunter folgt die Liste, die neueste
zuerst: Zeitpunkt und Verfasser gedämpft (`0.85rem`, `muted`, tabellarische
Ziffern), „Löschen“ als tertiäre Aktion am Zeilenende, darunter der Text. Neutrale
`border`-Trenner, keine Kartenfarbe, keine Animation. Bei 320px bricht die
Metazeile um. Die Formatierknöpfe sind Umschalter einer Werkzeugleiste und
tragen keine Aktionsstufe.

Die Eventfilter zeigen keine technische Zeitzonenzeile; Zeiträume verwenden weiterhin die konfigurierte Geschäftszeitzone.

Bei der Ressourcenzuweisung stehen Belegungsprüfung und die unverbindliche Vormerkung im Vordergrund; technische Zeitzonendetails bleiben der Oberfläche fern.

Die Angebotsanlage in Event-Dateien ist ein natives, zunächst geschlossenes Disclosure; die Vorlagenwahl und das Anlegen erscheinen nach bewusstem Öffnen. Nach dem Schließen eines neu angelegten Blankoentwurfs kehrt der Fokus zum Disclosure zurück.

Geschäftsdokumente stehen im Dateienbereich des Events vor der Dateibibliothek; beide bleiben erreichbar.

### Globale Dokumentliste (UI-01.2)

Die Dokumentroute liegt direkt auf `canvas`. Ab 1280 px stehen die Filter
links neben der Tabelle und beginnen auf Höhe ihres Kopfes. Nur die
Eingabefelder erhalten ihre eigene Feldfläche. Der Tabellenkopf nutzt
`table-surface`, Zeilen laufen mit einem unteren `border` über die Breite.
Unterhalb des Breakpoints öffnet der Filterknopf den vorhandenen Dialog.
Breite Tabellen scrollen innerhalb ihres Listenbereichs. Die Dokumenttabelle
ist als Region benannt und mit sichtbarem Fokus per Tab erreichbar. Die
Pfeiltasten scrollen den Bereich horizontal. Auf Mobilbreite
erhält die Dokumentspalte mindestens 8rem für Titel und Belegnummer.

### Kopf im Dokumenteditor (DOC-UX-04.1)

Der Dokumentkopf hält den Titel links und „Schließen“ rechts in einer
Rasterzeile. Lange Titel können umbrechen. Eine dünne Trennlinie verwendet
den Rahmenfarbwert des aktiven Themes. Die Schaltfläche ist mindestens 44 px
hoch und trägt den zugänglichen Namen „Bearbeitung schließen“.

### Positionsfelder im Dokumenteditor (DOC-PRODUCT-01.1, geändert EDITOR-LAYOUT-01)

Die Feldgruppe nutzt die verfügbare Breite der Positionsliste und bricht um,
statt Felder zu quetschen: Beschreibung, Preis und Rabattblock spannen zwei
Spalten, die übrigen Felder füllen ein `auto-fit`-Raster mit mindestens
9rem Feldbreite; ab 44rem Positionslistenbreite stehen die Aktionen rechts.
Beschriftungen bleiben vollständig sichtbar (keine Ellipse an Labels), Werte
dürfen umbrechen. Jeder Rabatt ist EIN Zahlenfeld mit kompaktem
Prozent-/Euro-Select daneben („Rabattart“); der gespeicherte Wert der jeweils
anderen Einheit bleibt erhalten und wird vom Wechsel nicht verfälscht.
Darunter stapeln sich die Felder. Eingaben behalten mindestens 44px Höhe und
die Tab-Reihenfolge folgt dem Formular. Die Zeilenaktionen der Position stehen
seit EDITOR-VISUAL-02 als EIN Menü am rechten Ende der Kopfzeile (siehe
„Positionsaktionen“); unter den Eingaben bleibt nur der Infotext.

### Mobiles Akkordion der Preisfelder (EDITOR-MOBILE-01)

Unterhalb von 44rem Viewportbreite – derselbe Schwellwert, an dem das Feldraster
zuletzt umbricht – fasst je Position ein natives `<details>` die fünf
Werteingaben zusammen: Menge, Einheit, Einzelpreis, Steuer, Rabattart und
Rabatt. Die Positionsüberschrift mit ihrer Icon-Gruppe und die Beschreibung
bleiben sofort sichtbar; der Brutto/Netto-Schalter der Kopfzeile bleibt
außerhalb der Gruppe und damit immer sichtbar; Produkt und Beschreibung stehen
im Vorlageneditor ebenfalls außerhalb der Gruppe. Die Summary heißt „Preis und
Rabatt“ und zeigt die getippten Werte als knappe Vorschau
(„1 Tag · 100,00 € · 19 %“), damit die Position auch zugeklappt lesbar bleibt.
Sie ist mindestens 48px hoch, per Enter/Leertaste bedienbar und die Felder
folgen ihr in natürlicher Reihenfolge. Die Gruppe startet zugeklappt; ein Feld
mit `aria-invalid` hält sie offen, und nach dem Aufklappen bleibt sie bis zur
bewussten Bedienung der Summary offen – kein Zuklappen bei Blur, kein Remount
und kein Wertverlust. Ab 44rem ist die Summary `display: none`, die Gruppe ist
immer offen; das DOM bleibt in beiden Breiten identisch. Gleiches Muster im
Vorlageneditor.

### Positionsaktionen (EDITOR-ACTIONS-01, geändert EDITOR-VISUAL-02)

Die Aktionen jeder Dokumentposition liegen in EINEM Menü am rechten Ende der
Positions-Kopfzeile (Bookitup-Parität, B37-Abweichung 1). Sichtbar ist nur der
ruhige Menüknopf „Aktionen für Position N“ (`tier-quiet-icon`, Dreipunkt-Symbol,
mindestens 44px, mit `aria-expanded` und `aria-controls`). Er öffnet die Gruppe
„Aktionen für Position N“ (`role="group"`, anfangs `hidden`) mit vier
beschrifteten Einträgen in dieser Reihenfolge: „Nach oben schieben“, „Nach unten
schieben“, „Als Produkt speichern“, „Position entfernen“. Die zugänglichen Namen
nennen die Zeile und enthalten den sichtbaren Text (axe-Regel
label-content-name-mismatch): „Position N nach oben schieben“, „Position N nach
unten schieben“, „Position N als Produkt speichern“ und „Position N: Position
entfernen“. An den Listenenden bleibt der jeweilige Eintrag `aria-disabled`;
während Laden und Speichern ist die ganze Gruppe deaktiviert wie zuvor.

Nach jeder Aktion schließt die Gruppe und der Fokus kehrt zum Menüknopf zurück
(Haus-Muster der Vorlagenzeilen). Escape schließt nur das Menü, nicht den Editor.
Die Gruppe öffnet im Fluss der Kopfzeile unter dem Knopf und nie als Overlay
über einem Feld; der Menüknopf steht in der Tab-Reihenfolge vor den Feldern,
bleibt im mobilen Akkordion außerhalb sichtbar und behält seine mindestens
44px große Trefferfläche. Drag & Drop der Position ist unverändert.

Der Eintrag „Position entfernen“ fragt vorher bewusst nach („Position N
entfernen?“, Abbrechen/Entfernen); Abbruch behält die Position und stellt den
Fokus auf den Menüknopf der Zeile zurück. Diese Löschform ist eigene Auslegung
(GOAL 21.11.2026): Beobachtet ist nur, dass die Referenz je Position ein Menü
führt (B37-Abweichung 1, manuelle Beobachtung 20.11.2026, kein REA-Beleg); ein
Löschmenüeintrag wurde nicht gesehen. Die Statuszeile der Produktanlage bleibt
als eigenes Feld im Zeilenkopf sichtbar, außerhalb des zugeklappten Menüs. Die
Feldreihe darunter folgt unverändert EDITOR-LAYOUT-01.

Zwischen „Position N“ und diesem Menüknopf steht seit EDITOR-VISUAL-01 der
Preisbasis-Schalter (Bookitup-Parität, B37-Abweichung 2): eine als „Preisbasis“
benannte Gruppe (`role="radiogroup"`) aus zwei nativen Radios „Brutto“ und
„Netto“ in derselben Zeile, nur an Preispositionen. Er ersetzt das frühere
„Preisbasis“-Select neben dem Einzelpreis; gespeicherter Wert, Umschaltlogik und
Berechnung bleiben unverändert, und der Wechsel verfälscht keinen bewegten
Betrag. Der Fokusrahmen folgt der allgemeinen Regel, die Ziele bleiben mindestens
32 px hoch.

### Position als Produkt (DOC-PRODUCT-01.6)

Jede Preisposition trägt in ihrem Zeilenmenü den ruhigen tertiären Eintrag „Als
Produkt speichern“ (zugänglicher Name „Position N als Produkt speichern“,
EDITOR-VISUAL-02). Er legt über den vorhandenen Produkt-POST einen Stammsatz an
(Name aus der Beschreibung, Beschreibung aus dem Infotext, Einheit, Preis mit
Preisgrundlage, Steuer; Menge und Rabatt sind bewusst keine Produktstammdaten).
Genau ein Auftrag je Geste; während der Laufzeit ist der Eintrag gesperrt. Unter
der Kopfzeile und außerhalb des zugeklappten Menüs steht die Statuszeile:
bestätigter Erfolg, bekannte Ablehnung als `alert` oder unklarer Ausgang mit der
eigenen Aktion „Bestand prüfen“ (nur lesender Abgleich; erst nach „nichts
gefunden“ ist ein neuer bewusster Klick möglich). Wertänderungen setzen
Erfolg/Fehler zurück, ein ungeklärter Auftrag bleibt gesperrt. Der
zugängliche Status bleibt damit auch bei geschlossenem Menü sichtbar. Keine neue
Farbe, kein Dialog, kein Remount. Der Vorlageneditor behält die Icon-Form
desselben Bausteins; beide teilen einen Zustand und senden nie zwei Anfragen.

### Dokumentanlage-Dialog (DOC-UX-03, DOC-CREATE-02)

Alle Erstellungswege eines Dokuments laufen über genau einen Auswahldialog in
der Event-Dokumentansicht: Angebot (Vorlage/Blanko), Auftragsbestätigung,
Anzahlungsrechnung, Rechnung, Schlussrechnung und Rechnungskorrektur
(Richtung Gutschrift/Lastschrift) sowie die Blankorechnung. Jeder Weg zeigt
nur zulässige, finalisierte Quellen dieses Events; ausgeschlossene Zwecke
(„bereits vorhanden“, „zurückgezogen“) werden knapp benannt statt versteckt.
Die Zeilenaktion öffnet vorausgewählten Dialog; Abbruch/Escape löst keinen
Request aus und gibt den Fokus zurück. Genau ein Auftrag je Geste; eine
unklare Antwort sperrt jede weitere Anlage bis zum ausdrücklichen
Listenabgleich. Die früheren Inline-Wege (Inline-Bestätigung, Inline-
Korrekturformular) sind im Dialog aufgegangen. Keine erfundene
Dubletten-Heuristik – die Server-Guards werden erklärend übernommen.

### Infotext im Dokumenteditor (DOC-TEXT-02)

Jede Position hat unter den Preis- und Mengenfeldern das beschriftete
Mehrzeilenfeld „Infotext (optional)“. Bei Katalogprodukten übernimmt es
die Produktbeschreibung. Das Feld belegt die verfügbare Positionsbreite
und folgt in der Tab-Reihenfolge auf „Position entfernen“. Beim Löschen
der Position entfällt ihr Infotext mit ihr. Ältere eigenständige
Infotextzeilen behalten ihr Feld „Text“ und ihre vorhandene Position im
Beleg. Die Finalisierung erfordert mindestens eine Leistungsposition.

### Positionsreihenfolge im Dokumenteditor (DOC-ORDER-01)

Der Griff an der Feldgruppenüberschrift verschiebt die ganze Zeile per
Maus. Die zulässige Zielzeile erhält den vorhandenen Fokusfarbwert.
Zwei beschriftete Pfeilaktionen mit je 44px Trefferfläche erlauben die
gleiche Sortierung per Tastatur und auf Touchgeräten. Der Fokus bleibt
beim gewählten Pfeil der verschobenen Zeile, auch an einer Listenbegrenzung.
Der Editor meldet die neue Zeilenstelle für assistive Technik. Zugehöriger
Infotext wandert mit der Position. Eigenständige Textzeilen sind ebenfalls
verschiebbar. Speichern übernimmt die Reihenfolge.

Optionale Positionen (DOC-OPTION-01): Positionsgruppen zeigen unter den Preisfeldern die native Checkbox „Optionale Position“ mit mindestens 44 px Trefferfläche. Ihr Zustand wird zusammen mit der Position gespeichert und verschoben. Die Summe zeigt den gespeicherten Serverwert.

### Bereiche der Eventakte (UI-PARITY-02, 25.11.2026)

Die Eventakte folgt Bookitups Aktengliederung (Screenshots vom 31.10. und 24.11.2026, Bildbeobachtung, kein REA-Beleg): **Details · Ressourcen · Dateien · E-Mails**. Notizen und Logbuch stehen unter Details, wie bei Bookitup: seit UI-PARITY-04 als Karten (`.event-detail-section`, gleiches Kartenkleid wie Termin/Allgemein, eigene Region, h4) in der Hauptspalte, Kontakt und Ort bleiben daneben. Ab 90rem: Termin Spalte 1, Allgemein Spalte 2, die Abschnitte darunter über beide, Seitenleiste Spalte 3 über die volle Höhe. „E-Mails“ beginnt mit der sekundären Aktion „Neue Mail schreiben“, darunter die Karte „Ausgehende Mails“ mit einer Ordnergruppe (`role="group"`, `aria-label="Ordner"`, `nav-action`-Knöpfe mit `aria-pressed`, aktiver Ordner fett) samt Anzahl je Ordner. Mobil bleibt die feste Bereichsleiste, jetzt mit vier gleich breiten Spalten.

### Dokument bereitstellen (UI-PARITY-03, 25.11.2026)

Nach Bookitups Bereitstellen-Spalte (Screenshots vom 31.10./02.11.2026, Bildbeobachtung): die Zeilenaktion „Bereitstellen“ eines finalen Dokuments öffnet einen Formulardialog mit einer Aktionsspalte: Vorschau öffnen · An Buchhaltung senden · E-Mail an Kunden · Herunterladen, alle `secondary-action` mit 44px, Links im gleichen Knopfkleid. Hinweise (Vorschau im neuen Tab inklusive Drucken, fehlende Buchhaltungsadresse, Online-Freigabe nicht verfügbar) stehen in `muted` direkt an der Aktion. Seit UI-PARITY-06 steht das eingefrorene PDF als beschriftetes `iframe` („Vorschau <Art> <Nummer>“, Rahmen `--border`, Höhe `min(70dvh, 48rem)`, mobil `60dvh`) links, die Aktionsspalte ab `48rem` mit `15rem` rechts daneben, darunter einspaltig; der Dialog wächst dafür auf `min(100%, 64rem)`. „In neuem Tab öffnen“ bleibt als erste Aktion für Drucken und Browser ohne PDF-Anzeige. Nur diese PDF-Route darf vom eigenen Ursprung gerahmt werden.

### Logbuch als Zeitleiste (UI-PARITY-05, 25.11.2026)

Nach Bookitups Logbuch: neuester Eintrag zuerst, je Eintrag der Text und darunter das Datum in `muted` (`0.85rem`, `tabular-nums`). Links eine neutrale Kreismarke (`0.65rem`, 2px `quiet-ink`, Fläche `surface`) auf einer 2px-Linie in `border`, die beim letzten Eintrag endet. Keine Statusfarben in der Zeitleiste.

## Bookitup-Angleichung (UI-BKP, 25.11.2026)

Gemessene Werte und Abweichungen stehen im
[Laufzeitabgleich](../../docs/bookitup-parity/ui-runtime-2026-11-25.md). Seit
UI-BKP-01 gilt die Bookitup-Palette statt der früheren grünen Akzentfarbe
(Betreiberentscheidung 25.11.2026); BKP005 ist damit abgelöst. Bewusst
abweichend: Tippflächen 44 px statt 36 px, Grautöne für Text und
Bedienelementgrenzen auf WCAG AA abgedunkelt, Statustext auf getönten
Filterzeilen in dunklerer Statusfarbe. Eventliste (UI-BKP-02): Karten ohne
Aktionssymbole, Aktionen im ⋯-Zeilenmenü (`.row-menu`, ein Knopf mit per
CSS verborgenem Panel, damit 500 Karten schnell bleiben), Status als
Mehrfachauswahl mit Markierungsbalken und getönter Zeile. Dokumentübersicht
(UI-BKP-05): Dokumentart als Listenzeilen, Status als Segmentschalter
(`.files-segments`), Fristetikett `.files-due[data-tone]` (open/ok/late; „late“
vollflächig rot mit Flächenfarbe als Schrift für AA in beiden Modi),
Event-Pille `.files-event-pill[data-status]`, Zeilenmenü als natives Popover
(`popover="auto"`, Anker über `--menu-anchor`), damit die scrollende Tabelle
es nicht abschneidet; Licht-Ausblenden und Escape liefert der Browser. Eventakte
(UI-BKP-03): `.event-record-layout` mit Aktenspalte `.event-record-side`
(13,5rem, ab 64rem, klebt oben) und `.event-record-body`; seltene Aktionen
`.event-record-actions` als Textlinks am Fuß der Spalte, unter 64rem per
`order` unter dem Arbeitsbereich. Kartenraster ab 90rem: Felder links über
zwei Zeilen, Allgemein und `.event-detail-stack` (Notizen, Logbuch) in der
Mitte, `.event-detail-aside` rechts; Mitte weiß mit 1-px-Linie, rechts ohne
Linie mit `--shadow-aside`; Kartentitel 18/700. „Dateien“ der Akte: `.document-card` weiß
mit Linie, `.document-state[data-state]` als Etikett (final grün getönt),
Aktionen in `.document-list .document-actions` als ruhige Textknöpfe.
⋯-Knöpfe nutzen das gezeichnete Drei-Punkte-SVG, nie ein Textzeichen. Dokumenteditor (UI-BKP-06a): `.offer-draft-position` als graue Karte
(`--status-surface`), „Positionen“-Überschrift als dunkler Balken (`--ink`
auf `--surface`), `.offer-draft-totals` rechtsbündig mit Gesamtbetrag 18/700
über einer Linie. Gesamtrahmen (UI-BKP-08): `--rail-width` 3,75rem (eingeklappt) bzw. 15rem;
die Kontextspalten `.event-context` (ab 1024 px) und `.files-context` (ab
1280 px) stehen `position: fixed` mit 17,125rem Breite neben der Leiste, nur
wenn ihre `.workspace-page` sichtbar ist; Spaltentitel `.context-title` ist
rein visuell (`aria-hidden`), die h1 bleibt die einzige Seitenüberschrift.
