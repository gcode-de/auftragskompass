---
name: AuftragsKompass
description: Interne Verwaltungsoberfläche für den lokalen Fotobox-Betrieb
colors:
  surface: "light-dark(#ffffff, #1e1d1b)"
  canvas: "light-dark(#f5f4f1, #141312)"
  ink: "light-dark(#20211f, #e8e4df)"
  muted: "light-dark(#5d5c58, #b0aaa2)"
  accent: "light-dark(#3d6b58, #9dc1af)"
  border: "light-dark(#dbd8d2, #3b3833)"
  action-ink: "light-dark(#ffffff, #12201b)"
  action-hover: "light-dark(#2f5749, #b2d2c1)"
  hover-surface: "light-dark(#efede8, #2a2825)"
  field-surface: "light-dark(#fbfaf8, #191817)"
  field-border: "light-dark(#8f8a82, #7d776f)"
  focus: "light-dark(#20695a, #9fd3ba)"
  status-surface: "light-dark(#f1efec, #242220)"
  alert-surface: "light-dark(#fdf0ed, #3d2523)"
  alert-ink: "light-dark(#a3312a, #f6bcb2)"
  table-surface: "light-dark(#f3f1ed, #242220)"
  selection: "light-dark(#dcd9d3, #3a3733)"
  selection-ink: "light-dark(#1d1c1a, #f0ece7)"
  selected-surface: "light-dark(#eeece7, #302d29)"
  selected-ink: "light-dark(#33544a, #e8e4df)"
  disabled-surface: "light-dark(#e9e6e0, #262421)"
  disabled-ink: "light-dark(#6b665f, #a9a29a)"
  sidebar: "#1b1a18"
  sidebar-ink: "#eae6e0"
  sidebar-focus: "#cfd8d0"
  sidebar-active: "#2f3a34"
  sidebar-hover: "#2a2825"
  sidebar-link: "#c6c1ba"
  sidebar-muted: "#a8a29a"
  sidebar-selected-ink: "#ffffff"
  backdrop: "#0b0a09aa"
  scrim: "light-dark(#1b1a1866, #0b0a09cc)"
  menu-close-border: "#6f6a63"
  calendar-ink: "#111827"
  status-inquiry: "light-dark(#6b665f, #a9a29a)"
  status-option: "light-dark(#8a5a12, #e0b45c)"
  status-booked: "light-dark(#2f5749, #9dc1af)"
  status-hold: "light-dark(#6a4b8a, #c9aee6)"
  status-cancelled: "light-dark(#8f8a82, #7d776f)"
  status-blocked: "light-dark(#8f8a82, #7d776f)"
  status-unavailable: "light-dark(#8f8a82, #7d776f)"
  status-conflict: "light-dark(#a3312a, #f6bcb2)"
typography:
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    lineHeight: 1.5
  headline:
    fontSize: "1.5rem"
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  workspace-title:
    fontSize: "1.5rem"
    fontWeight: 650
    letterSpacing: "-0.025em"
  workspace-heading:
    fontSize: "1.25rem"
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  record-heading:
    fontSize: "1.35rem"
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  event-month-heading:
    fontSize: "1.1rem"
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  event-row-title:
    fontSize: "1.05rem"
    fontWeight: 650
  event-count:
    fontSize: "0.8rem"
    fontWeight: 400
  label:
    fontWeight: 550
  button:
    fontWeight: 600
rounded:
  control: "0.4rem"
  sidebar-link: "0.5rem"
  fieldset: "0.65rem"
  workspace: "0.75rem"
  login: "1rem"
spacing:
  form-gap: "1rem"
  fieldset-padding: "1.25rem"
  workspace-padding: "1.75rem"
  mobile-workspace-padding: "1rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.action-ink}"
    rounded: "{rounded.control}"
    padding: "0.6rem 1rem"
    typography: "{typography.button}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "#33544a / #cdc7bf"
    border: "1px solid #8f8a82 / #757067"
    rounded: "{rounded.control}"
    padding: "0.6rem 1rem"
  button-tertiary:
    backgroundColor: "transparent"
    textColor: "#33544a / #cdc7bf"
    border: "none"
    rounded: "{rounded.control}"
    padding: "0.6rem 1rem"
  button-disabled:
    backgroundColor: "{colors.disabled-surface}"
    textColor: "{colors.disabled-ink}"
    border: "1px dashed #8f8a82 / #757067"
    rounded: "{rounded.control}"
    padding: "0.6rem 1rem"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-account:
    backgroundColor: "transparent"
    textColor: "{colors.sidebar-ink}"
    rounded: "{rounded.control}"
    padding: "0.6rem 1rem"
  theme-toggle:
    backgroundColor: "transparent"
    textColor: "#33544a / #cdc7bf"
    border: "1px solid #8f8a82 / #757067"
    rounded: "{rounded.control}"
    padding: "0.6rem 1rem"
  theme-toggle-pressed:
    backgroundColor: "{colors.selected-surface}"
    textColor: "{colors.selected-ink}"
  record-navigation:
    backgroundColor: "transparent"
    textColor: "#33544a / #cdc7bf"
    padding: "0 0 1rem"
  record-navigation-current:
    backgroundColor: "{colors.selected-surface}"
    textColor: "{colors.selected-ink}"
  event-disclosure:
    textColor: "{colors.accent}"
    padding: "0.75rem 0.25rem"
  event-row:
    padding: "1.25rem 0"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.6rem 0.7rem"
  workspace:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.workspace}"
    padding: "1.75rem"
  navigation-active:
    backgroundColor: "{colors.sidebar-active}"
    textColor: "{colors.sidebar-selected-ink}"
    rounded: "{rounded.sidebar-link}"
    padding: "0.8rem 0.9rem"
---

# Design System: AuftragsKompass

## Overview

Die interne Verwaltungsoberfläche unterstützt den Inhaber eines lokal betriebenen Fotobox-Unternehmens. Die Oberfläche verwendet neutrale Flächen in einem hellen Offwhite beziehungsweise einem dunklen Anthrazit, eine anthrazitfarbene Seitennavigation und ein entsättigtes Grün ausschließlich als kleinen Marken- und Aktionsakzent. Diese Dokumentation beschreibt den implementierten Zustand; sie legt keine neue Markenrichtung fest.

**Key Characteristics:**

- Getrennte Arbeitsbereiche mit gemeinsamer Navigation.
- Systemschrift, sichtbarer Tastaturfokus und überwiegend mindestens 44px hohe Bedienelemente.
- Native modale Navigation auf schmalen Bildschirmen.
- Eigenes Kompass-Favicon (`favicon.svg`, 32px-PNG-Fallback) in den Farben der Seitenleiste; keine fremden Markenassets.

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

Bis einschließlich **900px**: Seitennavigation ausblenden, 44 × 44px großen SVG-Menüknopf einblenden, Werkzeugleiste oben fixierend (`position: sticky; top: 0`, Ebene 5), Seitenabstand `1rem`. Unterer Abstand: `max(2rem, env(safe-area-inset-bottom))`. Arbeitsflächen erhalten `1rem` Innenabstand; die Einstellungsnavigation zwei gleich breite Spalten. Bis einschließlich **600px** werden globale Suche einspaltig und Feldgruppen mit `0.85rem` gepolstert. Spätere 900px-Regeln haben bei Überschneidungen Vorrang.

Ein eigener Anwendungskopf mit Marken-Hero existiert nicht mehr; die Seitenleiste trägt die Marke. Die Werkzeugleiste enthält den einzigen sichtbaren Seiten-H1 als echten `#events`-Link und die globale Suche. Bereichsflächen wiederholen diesen Titel nicht; nur eigenständige Unterabschnitte wie der Suchbereich führen eigene H2.

Die Anmeldung ist eine eigene, maximal `30rem` breite Karte mit dem einzigen H1 „Anmelden bei AuftragsKompass“; der Anwendungsrahmen wird dafür maximal `65rem` breit und erhält `1.5rem` Innenabstand. Der sichtbare Arbeitsbereich folgt dem URL-Hash. Die globale Suche zeigt Events und Kontakte gemeinsam; Einstellungen haben eigene Unterbereiche.

Eventlisten gruppieren Einträge anhand des Eventdatums nach Monat und Jahr; ohne Datum entsteht die Gruppe „Ohne Datum“. Monatsgruppen haben `2rem` Abstand nach oben. Ihre Überschrift steht auf der Events-Route auf Ebene 2 und in den Suchabschnitten auf Ebene 3; sie zeigt die Anzahl daneben (`gap: 0.75rem`, umbrechend, an der Grundlinie ausgerichtet). Jede Zeile ist eine ruhige Karte (BKP014.1): links eine Datumsspalte mit dominanter Tageszahl (`1.65rem`, Gewicht 700) und kleinem Wochentag/Monat (`0.75rem`, z. B. „Sa / Okt“), daneben der Kartenkörper mit Statusmarke samt geschriebenem Statusnamen, Eventart, vollständigem Titel und wirksamem Ort. Ein 3px-Statusstrich am linken Kartenrand und ein `0.5rem`-Punkt tragen dieselbe Statusfarbe; der Name steht immer daneben, Farbe ist nie der einzige Träger. Karten haben `1rem` vertikalen Innenabstand, `0.85rem` linken Innenabstand und einen unteren `border`-Trenner.

Die geöffneten Event-Details bilden einen eigenen Arbeitskontext: Listensteuerung, Monatsüberschriften und andere Eventzeilen werden ausgeblendet. Der Ereigniskopf (`.event-record-head`) steht als erster Block der Akte: eine Zeile mit Datum (`0.95rem`, Gewicht 650) und Zeitfenster (`0.9rem`) in `muted` und `tabular-nums`, darunter der h2-Titel (`1.35rem`, `overflow-wrap: anywhere`), darunter Statusmarke mit geschriebenem Statusnamen, Eventart (Großbuchstaben, `0.75rem`) und wirksamer Ort; ein unterer `border` trennt ihn von den Bereichen. Der Detailbereich verwendet eine Definitionsliste mit `minmax(7rem, 0.35fr) minmax(0, 1fr)`, Abstand `0.75rem 1rem` und `1.5rem` Blockrand; seine Abschnitte tragen h4-Überschriften (`0.9rem`, Gewicht 650). Ab **64rem** steht der Kontakt-/Ort-Kontext als rechte Spalte (`minmax(0, 1.6fr) minmax(17rem, 0.9fr)`, linker `border`, `1.5rem` Innenabstand) neben der Hauptspalte, darunter hinter einem Disclosure. Bis einschließlich **600px** steht die Definitionsliste einspaltig mit `0.25rem` Abstand; Werte erhalten `0.75rem` unteren Außenabstand.

Bis einschließlich 600px liegt die Aktennavigation unten fest: fünf gleich breite Spalten (Details, Ressourcen, Dateien, Notizen, Logbuch), Ebene 5, `surface`-Hintergrund und oberer `border`-Trenner. Padding: `0.5rem 0.5rem max(0.5rem, env(safe-area-inset-bottom))`; Knöpfe: `0.72rem` Schrift, `1.15` Zeilenhöhe, `0.5rem 0.1rem` Padding und `overflow-wrap: anywhere` — kein Bereich rutscht in eine seitliche Scrollfläche. Der Anwendungsrahmen reserviert bei vorhandener Akte `calc(6rem + env(safe-area-inset-bottom))` nach unten. Auf größeren Bildschirmen bleibt die Aktennavigation im Inhaltsfluss mit unterem Trenner.

## Elevation & Depth

Arbeitsflächen und Seitennavigation verwenden keine Schatten. Umrandungen und Flächenfarben schaffen Trennung. Die Anmeldung behält `0 0.25rem 1rem #20304408`; der generische Navigationsstil enthält `0 0.25rem 1rem #2030440d`, während Haupt- und Einstellungsnavigation diesen Schatten abschalten. Das native modale Menü liegt im Top Layer mit der neutralen Hintergrundabdunklung `backdrop` (`#0b0a09aa`); die Formulardialoge verwenden `scrim` (`light-dark(#1b1a1866, #0b0a09cc)`).

## Shapes

Kontrollen: `0.4rem`; Navigationslinks der Seitenleiste: `0.5rem`; Feldgruppen: `0.65rem`; Arbeitsflächen: `0.75rem`; Anmeldung: `1rem`, bis 600px `0.65rem`. Eingaben, Auswahlfelder, Textflächen, Knöpfe und Navigationslinks haben mindestens **44px** Höhe. Checkboxen und Radioknöpfe selbst sind `1.25rem` groß; ihre umgebenden Labels sind mindestens 44px hoch. Der Suchlink ist als `inline-flex` vertikal ausgerichtet und mindestens 44px hoch.

## Components

- **Event-Details (BKP013.1, zusammenhängende Eventakte):** stabiler Ereigniskopf „Event: Name“ (`1.35rem`, `scroll-margin-top: 5rem`, `tabIndex=-1`, Fokus beim Öffnen) mit Datum, Zeitfenster beziehungsweise „Tagesbuchung, ohne Uhrzeit“, Statusmarke samt geschriebenem Statusnamen, Eventart und wirksamem Ort; ein fehlender Kontakt oder Ort ist ein normaler Zustand („Kontakt noch offen.“, „Ort offen“), keine Fehlerfläche. Fünf Bereiche in einer beschrifteten Navigation aus gewöhnlichen Knöpfen: Details, Ressourcen, Dateien, Notizen, Logbuch — `aria-current="location"` kennzeichnet den Bereich; es gibt kein ARIA-Tabmuster und keinen Mail-Bereich, solange kein Mailmodul existiert. Details gruppiert Termin, Allgemein (Eventart, Paket, Anfragequelle, Beschreibung), die Statusänderung und die Stammdaten-Aktion; Kontakt und Ort stehen ab **64rem** als eigene Spalte daneben, darunter hinter einem nativen `<details>` mit `44px` hoher Summary „Kontakt und Ort“ (ohne `matchMedia` bleibt der Kontext sichtbar). Ressourcen bleibt die bestehende Zuweisungsfläche mit einer atomaren Speicherung. Dateien enthält die Dokumentliste, nach tatsächlicher Art in getrennten Karten („Angebote“ mit der vorhandenen Anlage, weitere Arten wie „Rechnungen“ nur mit echten Zeilen, unbekannte Arten unter „Weitere Dateien“). Unterbereiche verwenden h3, ihre Unterblöcke h4 (`0.9rem`, Gewicht 650). Inaktive Bereiche bleiben mit `hidden` eingehängt, damit Status- und Ressourcenentwürfe beim Bereichswechsel und bei Hintergrundaktualisierungen erhalten bleiben; beim Wechsel erhält der gewählte Bereich selbst den Tastaturfokus (`tabIndex=-1`, sichtbarer Fokusring). Der ausgewählte Bereich und die geladenen Daten bleiben bei Versionsaktualisierungen erhalten (`revision`, stabile Eventidentität). Schließen führt zur auslösenden Eventzeile zurück; Bearbeiten öffnet das zentrale Eventformular und fokussiert das Namensfeld. Inaktive Knöpfe sind transparent mit `muted`-Schrift; aktive und überfahrene Knöpfe nutzen `selected-surface` und `selected-ink`.
- **Eventfilter und Editor:** native `<details>`/`<summary>` mit oberen und unteren `border`-Trennern und `1rem` Außenabstand. Summary ist mindestens `48px` hoch, mit Akzentschrift, Gewicht 600 und `0.75rem 0.25rem` Innenabstand. Filter sind bei vorhandenen Eventfiltern in der URL anfänglich geöffnet und tragen „Filter · aktiv“. Der Editor beginnt geschlossen. Bearbeiten oder Duplizieren öffnet ihn, scrollt zum Formular und fokussiert den Namen. Erfolgreiches Speichern oder ausdrückliches Abbrechen schließt ihn und fokussiert die Summary. Bloßes Einklappen erhält den Formularentwurf; Fehler lassen die Eingaben bestehen. Der Abbrechen-Knopf erscheint bei einem geladenen Bearbeitungs- oder Duplikatentwurf.
- **Eventzeilen (BKP014.1):** Monatsüberschrift `1.1rem`, Anzahl `0.8rem` mit Gewicht 400 und `muted`. Jede Zeile ist eine Karte mit zweispaltigem Raster `3.5rem minmax(0, 1fr)`: links die Datumsspalte (Tageszahl `1.65rem`/700 als dominante Figur, Wochentag und Monatskürzel `0.75rem`/600 in `muted`, z. B. „Sa / Okt“), rechts der Kartenkörper. Der Körper stapelt Status (Punkt `0.5rem` plus geschriebener Name, `0.75rem`, Großbuchstaben, `muted`), Eventart (`0.75rem`, Großbuchstaben), den vollständigen Titel (`1.05rem`, Gewicht 650, `white-space: normal` und `overflow-wrap: anywhere` — nie Ellipse oder Zeilenbegrenzung) und den wirksamen Ort (`0.875rem`, `muted`, `white-space: pre-line`). Zeitfenster beziehungsweise „Tagesbuchung, ohne Uhrzeit“ und der Kontakt stehen in der Meta-Zeile darunter; die technische Ressourcenanweisung entfällt. Der Statusstrich ist `3px` am linken Kartenrand; Karten haben `1rem`/`0.85rem` Innenabstand und einen unteren `border`-Trenner, aber keine eigenen Kartenflächen oder Schatten. Genau ein Link je Karte umschließt die sichtbaren Felder und beginnt für Hilfstechnik mit „Öffnen: “; Bearbeiten/Duplizieren bleiben ruhige `tier-quiet-icon`-Aktionen außerhalb des Links. Undatierte Karten zeigen „–“ und „ohne Datum“, fehlende Art und fehlender Ort heißen „Art offen“ und „Ort offen“ statt einer Erfindung.
- **Aktionen (H036):** jede Fläche hat genau eine gefüllte `.primary-action`; `.secondary-action` bleibt transparent mit Rand und Gewicht 600, `.tertiary-action` ist randlos mit Gewicht 500 und Unterstreichung erst bei Hover; die Bereichsnavigation der Detailansicht ist `.nav-action`, ihr aktiver Eintrag zusätzlich fett mit Rand. Icon-Aktionen bleiben 44-px-Ziele und markieren mit `.tier-primary-icon` das einzige anlegende Icon eines Bereichs, mit `.tier-quiet-icon` Filter, Suche, Navigation und Zeilenaktionen. Keine Stufe unterscheidet sich nur in der Farbe: Füllung, Rand und Schriftgewicht tragen den Unterschied; deaktivierte Aktionen erhalten eine neutrale Füllung (`disabled-surface`), die lesbare Schrift `disabled-ink` (mindestens 4,5:1), Deckkraft 1 **und** einen gestrichelten Rand mit `not-allowed`. Die frühere Deckkraft 0.65/0.6 gilt nur noch für generische Eingaben und für Knöpfe ohne Stufe. Die Abmeldung im Navigationsfuß ist transparent mit `sidebar-ink`-Schrift und `menu-close-border`-Rand; beim Überfahren verwendet sie `sidebar-hover`. Allgemeiner Fokus: `3px solid var(--focus)`, Abstand `3px`.
- **Darstellungsumschalter:** „Dunkelmodus“ ist vor der Anmeldung in der Anmeldekarte und nach der Anmeldung in der Werkzeugleiste verfügbar, mit dekorativem Mond-SVG und `aria-pressed` für den Dunkelzustand. Gespeichert wird ausschließlich `light` oder `dark` unter `localStorage["ak-theme"]`; ungültige oder nicht lesbare Werte fallen auf die Systempräferenz zurück. Ohne explizite Wahl werden Systemänderungen übernommen. Ein Klick setzt eine explizite Wahl; Änderungen anderer Tabs sowie gelöschte Präferenzen werden über das `storage`-Ereignis übernommen. Bei gesperrtem Speicher funktioniert die Wahl für die laufende Sitzung. Das aktuelle Schema wird per Layout-Effekt als `data-theme` am Dokumentwurzelelement gesetzt; Farben wechseln ohne Übergangsanimation. Der Umschalter bietet keine eigene Funktion zum Zurücksetzen auf die Systempräferenz.
- **Angebotsentwurf (BKP016.1):** „Bearbeiten“ öffnet genau einen Inline-Editor innerhalb der Dokumentzeile in Event → Dateien. Beim ersten erfolgreichen Laden erhält Betreff den Fokus und wird mit `scroll-margin-top: 6rem` unter die Werkzeugleiste gescrollt; Speichern stiehlt keinen Fokus, Schließen führt zur auslösenden Zeilenaktion zurück. Betreff, Einleitung, Schlusstext und Gültigkeit nutzen die vorhandenen Feldstile und ein responsives Raster mit mindestens `18rem` Feldbreite, bei schmalem Platz eine Spalte. Überschrift `1rem`, Positionsüberschrift `0.95rem`; nur neutrale `border`-Trenner, keine neue Kartenfarbe. Positionen und exakter Bruttobetrag bleiben lesend sichtbar. Bearbeiten und Finalisieren sind sekundär, „Änderungen speichern“ ist die einzige primäre Editoraktion; die gespeicherte Vorschau öffnet als beschrifteter Downloadlink in einem neuen Tab. Ungespeicherte oder alte noch nicht ausdrücklich übernommene Inhalte sperren Vorschau/Finalisierung. Konflikt- und unklare Speicherantworten bewahren Eingaben und bieten Neuabruf; die ausdrückliche Verwerfrückfrage schützt Änderungen. Lade-, Fehler- und Altentwurfszustände sind Text im selben Arbeitsbereich, keine neuen Overlays.
- **Angebotspositionen (BKP016.3):** Bestehende Positionen und neue freie Positionen stehen im Inline-Editor als beschriftete Feldgruppen, ohne zusätzliche Kartenebene. Jede Gruppe hat eine nummerierte Legend und Beschreibung, Menge, Einheit, ausdrücklich Brutto-Einzelpreis in Euro, Steuer und Rabatt in Prozent. Das Raster nutzt `repeat(auto-fit, minmax(min(100%, 12rem), 1fr))`, `0.65rem` Abstand und kleine `0.45rem 0.5rem 0.65rem` Innenabstände; `min-width: 0` verhindert Überlauf bei 320px. Native deaktivierte Fieldsets sperren alle Felder während Laden/Speichern. Neue freie Positionen erhalten den Fokus in Beschreibung, Entfernen fokussiert die benachbarte Gruppe; stabile lokale Schlüssel erhalten den Fokus beim Speichern. Euro-/Prozentwerte verwenden dieselben exakten Dezimalhelfer wie Vorlagen. Die Summe heißt „Gespeicherter Gesamtbetrag“ und wird nur aus bestätigten Serverantworten übernommen; nebenstehender Text erklärt die Neuberechnung beim Speichern. Unsichere Speicherzustände sperren Vorschau und Finalisierung auch nach Zurücksetzen lokaler Eingaben bis zum ausdrücklichen Neuabruf. Keine neue Netto-Umschaltung, Produktwahl oder dekorative Bewegung.
- **Produktwahl im Angebotseditor (BKP016.4):** Genau eine sekundäre Aktion neben der freien Neuanlage öffnet/schließt die Katalogauswahl (`aria-expanded`). Das beschriftete native Select zeigt die Quelle mit Preisbasis und Steuer; erst eine zweite ausdrückliche Aktion hängt eine neue Snapshot-Position an und fokussiert deren Beschreibung. Keine Produktsteuerung an jeder bestehenden Position. Vorhandene Raster, Feldstile, Touchziele und Fokusregeln gelten weiter. Lade-/Leerzustand und wiederholbarer Fehler erscheinen lokal in der Auswahl; sie verdrängen keine Speicher-/Konfliktmeldung. Kein zusätzliches Overlay, neue Farbe oder Bewegung.
- **Produktübernahme in Dokumentvorlagen (BKP015.1):** Das vorhandene Produktfeld übernimmt einen Preis ausdrücklich als Brutto-Einzelpreis; Netto-Katalogpreise werden mit dem Produktsteuersatz exakt umgerechnet. Das sichtbare Preislabel nennt Brutto. Scheitert die Übernahme, bleiben alle Positionsfelder erhalten und eine `alert`-Rückmeldung erklärt die manuelle Korrektur. Eine neue, kopierte oder andere Vorlage beginnt ohne alte Übernahmefehlermeldung. Vorhandene Feldraster, Farben und Touchziele bleiben erhalten; keine neue Einstellung oder Animation.
- **Formulare:** sichtbare Labels, Felder mit `surface`-Hintergrund und `field-border`-Rand; Textflächen und Mehrfachauswahl mindestens `7rem` hoch. Checkboxen/Radios verwenden die Akzentfarbe.
- **Kontobereich:** Kontoidentität, Abmeldung und Anmeldestatus liegen im Navigationsfuß: auf dem Desktop in der Seitenleiste, mobil nur im geöffneten Dialog. Das einspaltige Kontogrid hat `0.6rem` Abstand. Sichtbare Rückmeldungen verwenden `sidebar-hover` und `sidebar-ink`, einschließlich fehlgeschlagener Abmeldung; ihre Statusrolle bleibt innerhalb des modalen Kontexts erreichbar. Im abgemeldeten Zustand steht die Statusmeldung ausschließlich direkt in der Anmeldung.
- **Datenexport:** Unter Einstellungen → Datenexport (`#settings-export`) stehen drei native Downloadlinks für Kontakte, alle Events und den Produktkatalog in einer semantischen Liste (`ul`/`li`). Links sind als `inline-flex` ausgerichtet, mindestens 44px hoch und mit Gewicht 600 gesetzt; bestehende Link- und Fokusfarben gelten. Erläuterungen verwenden `muted` und `margin: 0 0 0.75rem`; sämtliche Absätze im Exportbereich bleiben auf `70ch` begrenzt. Der Text erklärt den vollständigen Bestand unabhängig von Filtern, die enthaltenen archivierten beziehungsweise annullierten Einträge und die Abgrenzung zur vollständigen Datensicherung.
- **Kalenderzustände:** Die Kalenderlegende ist eine mit „Kalenderlegende“ benannte Gruppe (`role="group"`) aus einer kompakten Zeile kleiner Farbfelder mit Text, nicht aus großen farbigen Blöcken. Pastellfarbene Eventartikel und Ressourcenzellen (`calendar-state`) behalten in beiden Darstellungen die feste dunkle Schrift `--calendar-ink` (`#111827`) und benennen ihren Zustand zusätzlich als Text. Links erben diese Farbe statt des allgemeinen Akzents; ihr Fokusrahmen verwendet ebenfalls `--calendar-ink`.
- **Mobiler Monatskalender (BKP008):** Das Raster bleibt ein echtes Mo–So-Raster; jede Zelle ist ein nativer Tagesknopf mit einzeiliger Tageszahl (`1`…`31`, nicht „Do., 01.10.“), mindestens `44px` hoch und über die volle Spaltenbreite klickbar (bei 320px rund `33 × 44px`, weil sieben Spalten nicht mehr zulassen). Der zugängliche Name des Knopfes nennt den vollen Tag, „heute“ und die Anzahl samt Statusnamen (`aria-label`), `aria-pressed` markiert die Auswahl, `aria-current="date"` den heutigen Tag. Heute trägt eine gestrichelte Kontur und das Wort „Heute“, die Auswahl eine durchgezogene Kontur mit `selected-surface` und Innenring — keine große grüne Fläche, keine Unterscheidung allein über Farbe. Bei mehreren Events zeigt eine kleine Zahl die Anzahl, gezeichnete Statusmarken (`0.42rem`) ordnen die Zustände (gefüllt = gebucht, Ring = Option/Anfrage, Quadrat = Vormerkung, Strich = Sperre, Kreuz = Konflikt). Unterhalb von `60rem` entfallen die Eventtitel in der Zelle; darunter steht die Tagesagenda mit vollständigem, umbrechendem Titel, Zeit beziehungsweise „Tagesbuchung, ohne Uhrzeit“, Status, Ort, Kontakt, Ressourcen und einem mindestens `44px` hohen Eventlink. Ein Tag ohne Events sagt „Keine Events an diesem Tag.“ ausdrücklich. Der Tageswechsel holt keine Daten neu; die Tabelle hat genau einen Tabulatorschritt, und die Pfeiltasten bewegen die Auswahl (rechts/links ±1 Tag, oben/unten ±7 Tage), ohne den Fokus zu verlieren.
- **Navigation:** aktive Links tragen `aria-current="page"`; dekorative SVGs sind `aria-hidden`. Einstellungen gruppieren Stammdaten, Kalender-Abos, Datenimport, Datenexport und Konto/Zugriff. Marke und Einklapp-Schalter stehen in einer gemeinsamen kompakten Markenzeile (`sidebar-brand-row`, randlos über beide Innenabstände der Leiste, also etwa `224px` breit und `44px` hoch: Marke mit rund `176px`, Lücke `0.25rem`, Schalter mit `44 × 44px` am rechten Rand). Die Wortmarke trägt in der Leiste die dokumentierte Größe `1rem` (der Markenname `AuftragsKompass` bleibt dadurch auch mit breiten Systemschriften ungekürzt; der mobile Drawer behält `1.15rem`). Eingeklappt stapelt dieselbe Zeile das AK-Kürzel über dem Ausklapp-Schalter, beide `44 × 44px` und zentriert; der Schalter behält seine logische Position und bleibt dasselbe DOM-Ziel für den Tastaturfokus. Zugänglicher Name, `title` und `aria-expanded` wechseln mit dem Zustand, die Präferenz bleibt `localStorage["ak-sidebar"]` samt `storage`-Übernahme. Das mobile Menü bietet weiterhin ausschließlich Öffnen und Schließen, keinen Desktop-Einklapp-Schalter.
- **Mobiles Menü:** natives `<dialog>` über `showModal()`, beschriftet mit „Menü“. Der Auslöser zeigt ein dekoratives 22 × 22px Hamburger-SVG auf transparenter Fläche; sein zugänglicher Name bleibt „Menü öffnen“. Breite `min(21rem, calc(100% - 2rem))`, Höhe `100dvh`. Der Schließen-Knopf behält helle Seitennavigationsschrift; sein Hoverhintergrund ist in beiden Darstellungen `sidebar-hover` (`#2a2825`). Schließen über Knopf, Navigation oder native Escape-Behandlung; explizites Schließen setzt Fokus auf den Auslöser zurück. Der Browser übernimmt modalen Fokus und Hintergrundinertheit. Klicks außerhalb des Dialogrechtecks schließen das Menü ebenfalls. Beim Wechsel auf Desktopbreite (`min-width: 901px`) schließt ein `matchMedia`-Listener den geöffneten nativen Dialog und setzt `aria-expanded` zurück. Der Fokus wechselt auf den aktuellen Link der Desktop-Seitenleiste; fehlt dieser, etwa in der Suche, auf den Suchlink der Werkzeugleiste. Beim Unmount wird der Listener entfernt.
- **Bewegung:** Knöpfe skalieren bei Aktivierung auf `0.98` mit `150ms cubic-bezier(0.23, 1, 0.32, 1)`. Nur die Transformation wird animiert; Farben wechseln sofort, damit beim Darstellungswechsel keine gemischten Farbzustände entstehen. Bei `prefers-reduced-motion: reduce` entfallen Transition und Skalierung. Das Menü erhält nur bei Zeigeraufruf und `no-preference` eine Eintrittsbewegung über `220ms`, Ausgangsposition `translateX(-1rem)` und Deckkraft 0 via `@starting-style`. Tastaturaufruf und reduzierte Bewegung haben keine Menübewegung; keine eigene Austrittsanimation.
- **Rückmeldungen:** `role="status"` für Status, `role="alert"` für Fehler. Leere Statusfelder verschwinden; „Angemeldet“ bleibt visuell verborgen für assistive Technik erhalten.

## Do's and Don'ts

**Do:**

- Vorhandene CSS-Variablen und semantische HTML-Elemente weiterverwenden.
- Aktive Navigation mit aria-current kennzeichnen und ausgeblendete Arbeitsbereiche mit hidden verbergen.
- Tastaturbedienung und reduzierte Bewegung berücksichtigen.

**Don’t:**

- Keine zusätzliche Markenwelt oder unbelegte Produktfunktionen aus dieser Dokumentation ableiten.
- Keine Bewegungsanimation für den Tastaturaufruf des mobilen Menüs ergänzen.
- Keine Daten aus einem ausgeblendeten Arbeitsbereich als sichtbar behandeln.
