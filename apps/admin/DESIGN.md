---
name: AuftragsKompass
description: Interne Verwaltungsoberfläche für den lokalen Fotobox-Betrieb
colors:
  surface: "light-dark(#ffffff, #202824)"
  canvas: "light-dark(#f4f6f5, #151d19)"
  ink: "light-dark(#202d29, #e4ede7)"
  muted: "light-dark(#596b64, #afc2b6)"
  accent: "light-dark(#176b52, #91d3b4)"
  border: "light-dark(#d6dfda, #43564a)"
  action-ink: "light-dark(#ffffff, #11291e)"
  action-hover: "light-dark(#0b5144, #b2e5cb)"
  hover-surface: "light-dark(#e8f4ef, #2e493b)"
  field-surface: "light-dark(#fafcfd, #1b241f)"
  field-border: "light-dark(#9facbb, #738a7b)"
  focus: "light-dark(#137a69, #a4e4c1)"
  status-surface: "light-dark(#eaf2f7, #293e36)"
  alert-surface: "light-dark(#fff0ed, #482a28)"
  alert-ink: "light-dark(#a62c22, #f3b2a8)"
  table-surface: "light-dark(#edf3f6, #293a30)"
  selection: "light-dark(#c6e7d8, #315d46)"
  selection-ink: "light-dark(#172e27, #e4ede7)"
  selected-surface: "light-dark(#e3f0e8, #2e493b)"
  selected-ink: "light-dark(#155d46, #b2e5cb)"
  sidebar: "#172e27"
  sidebar-ink: "#eaf2ee"
  sidebar-focus: "#c0e7ce"
  sidebar-active: "#315a48"
  sidebar-hover: "#294c3e"
  sidebar-link: "#c5d6ce"
  sidebar-muted: "#b0c8bd"
  sidebar-selected-ink: "#ffffff"
  backdrop: "#0b1813aa"
  menu-close-border: "#779386"
  calendar-ink: "#111827"
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
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-account:
    backgroundColor: "transparent"
    textColor: "{colors.sidebar-ink}"
    rounded: "{rounded.control}"
    padding: "0.6rem 1rem"
  theme-toggle:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "0.6rem 1rem"
  theme-toggle-pressed:
    backgroundColor: "{colors.selected-surface}"
    textColor: "{colors.selected-ink}"
  record-navigation:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
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

Die interne Verwaltungsoberfläche unterstützt den Inhaber eines lokal betriebenen Fotobox-Unternehmens. Das bestehende System verwendet grüne Aktionen, eine dunkle Seitennavigation und voneinander getrennte Arbeitsbereiche in heller oder dunkler Darstellung. Diese Dokumentation beschreibt den implementierten Zustand; sie legt keine neue Markenrichtung fest.

**Key Characteristics:**

- Getrennte Arbeitsbereiche mit gemeinsamer Navigation.
- Systemschrift, sichtbarer Tastaturfokus und überwiegend mindestens 44px hohe Bedienelemente.
- Native modale Navigation auf schmalen Bildschirmen.

## Colors

Maßgeblich ist der eine `:root`-Block in `src/styles.css`. Die Frontmatter bewahrt die exakten Farbpaare als `light-dark(Hellwert, Dunkelwert)`; die erste Farbe gehört zum Hellmodus, die zweite zum Dunkelmodus. `color-scheme: light dark` übernimmt zunächst die Systempräferenz; `data-theme="light"` beziehungsweise `"dark"` setzt das explizite Farbschema. Native Formelemente folgen diesem Schema.

- `surface`, `canvas`, `ink`, `muted` und `border` steuern Arbeitsflächen, Hintergrund, Text und Trennung in beiden Darstellungen.
- `accent`, `action-ink` und `action-hover` bilden Aktionen ab; im Dunkelmodus sind Aktionen hellgrün mit dunkler Schrift. `hover-surface` dient zurückhaltenden Hoverflächen.
- `field-surface`, `field-border`, `status-surface`, `alert-surface`, `alert-ink` und `table-surface` erhalten Form-, Rückmeldungs- und Tabellenkontraste. `alert-ink` wird als Fehlerrand verwendet; der Fehlertext erbt `ink`.
- `focus`, `selection`, `selection-ink`, `selected-surface` und `selected-ink` steuern Fokus, Textauswahl und aktive Einstellungen beziehungsweise den gedrückten Umschalter.
- Die Seitennavigation bleibt in beiden Darstellungen dunkelgrün; ihre festen Farben und die Hintergrundabdunklung stehen ebenfalls unverändert in der Frontmatter.

## Typography

Durchgehend die Systemschrift aus der Frontmatter; keine externe Schrift. Die Grundschriftgröße ist nicht ausdrücklich festgelegt und folgt dem Browserstandard. Überschriften verwenden Zeilenhöhe 1.2 und Laufweite −0.025em. Die globale h1-Größe ist `clamp(1.8rem, 4vw, 2.6rem)`, im Anwendungskopf jedoch durch `1.15rem` überschrieben. h2 ist grundsätzlich `1.5rem`, innerhalb eines Arbeitsbereichs `1.25rem`. Die Bereichsbezeichnung verwendet `1.5rem` und Gewicht 650, bis einschließlich 900px `1.15rem`. Kopfuntertitel: `0.875rem`; Kontobereich und Navigationsuntertitel: `0.8rem`; Tabellen: `0.9rem`. Tabellenzellen, Tabellenköpfe und Zeitangaben verwenden `font-variant-numeric: tabular-nums`.

## Layout

Desktop: `.app-shell` hat maximal `100rem` Breite und `padding: 0 2.5rem 3rem 18rem`. Die feste linke Navigation ist `15rem` breit und bei geringer Bildschirmhöhe vertikal scrollbar. Ihr Kontobereich sitzt unten mit `margin-top: auto` und `1.5rem 0.75rem 0` Innenabstand. Der Hauptbereich hat keine zusätzliche Kontozeile; der frühere Fußzeilenspruch entfällt. Arbeitsbereiche sind umrandete Flächen in `surface` mit `1.75rem` Innenabstand; breite Inhalte dürfen horizontal scrollen. Formulargruppen verwenden `repeat(auto-fit, minmax(min(100%, 18rem), 1fr))` mit `1rem` Abstand. Ältere Feldgruppen mit expliziten `label[for]` bleiben einspaltig.

Bis einschließlich **900px**: Seitennavigation ausblenden, 44 × 44px großen SVG-Menüknopf einblenden, Werkzeugleiste oben fixierend (`position: sticky; top: 0`, Ebene 5), Seitenabstand `1rem`. Unterer Abstand: `max(2rem, env(safe-area-inset-bottom))`. Arbeitsflächen erhalten `1rem` Innenabstand; die Einstellungsnavigation zwei gleich breite Spalten. Bis einschließlich **600px** werden globale Suche einspaltig und Feldgruppen mit `0.85rem` gepolstert. Spätere 900px-Regeln haben bei Überschneidungen Vorrang.

Der Anwendungskopf verwendet ein zweispaltiges Grid (`minmax(0, 1fr) auto`): Name und Untertitel links, Darstellungsumschalter rechts über beide Zeilen.

Die Anmeldung ist eine eigene, maximal `30rem` breite Karte; der Anwendungsrahmen wird dafür maximal `65rem` breit und erhält `1.5rem` Innenabstand. Der sichtbare Arbeitsbereich folgt dem URL-Hash. Die globale Suche zeigt Events und Kontakte gemeinsam; Einstellungen haben eigene Unterbereiche.

Eventlisten gruppieren Einträge anhand des Eventdatums nach Monat und Jahr; ohne Datum entsteht die Gruppe „Ohne Datum“. Monatsgruppen haben `2rem` Abstand nach oben. Ihre h3-Überschrift zeigt die Anzahl daneben (`gap: 0.75rem`, umbrechend, an der Grundlinie ausgerichtet). Listen sind ohne Aufzählungszeichen; flache Zeilen haben `1.25rem` vertikalen Innenabstand und einen unteren `border`-Trenner.

Die geöffnete Eventakte bildet einen eigenen Arbeitskontext: Listensteuerung, Monatsüberschriften und andere Eventzeilen werden ausgeblendet. Die Übersicht verwendet eine Definitionsliste mit `minmax(7rem, 0.35fr) minmax(0, 1fr)`, Abstand `0.75rem 1rem` und `1.5rem` Blockrand. Bis einschließlich **600px** steht die Definitionsliste einspaltig mit `0.25rem` Abstand; Werte erhalten `0.75rem` unteren Außenabstand.

Bis einschließlich 600px liegt die Aktennavigation unten fest: vier gleich breite Spalten, Ebene 5, `surface`-Hintergrund und oberer `border`-Trenner. Padding: `0.5rem 0.5rem max(0.5rem, env(safe-area-inset-bottom))`; Knöpfe: `0.8rem` Schrift und `0.65rem 0.15rem` Padding. Der Anwendungsrahmen reserviert bei vorhandener Akte `calc(6rem + env(safe-area-inset-bottom))` nach unten. Auf größeren Bildschirmen bleibt die Aktennavigation im Inhaltsfluss mit unterem Trenner.

## Elevation & Depth

Arbeitsflächen und Seitennavigation verwenden keine Schatten. Umrandungen und Flächenfarben schaffen Trennung. Die Anmeldung behält `0 0.25rem 1rem #20304408`; der generische Navigationsstil enthält `0 0.25rem 1rem #2030440d`, während Haupt- und Einstellungsnavigation diesen Schatten abschalten. Das native modale Menü liegt im Top Layer mit Hintergrundabdunklung `#0b1813aa`.

## Shapes

Kontrollen: `0.4rem`; Navigationslinks der Seitenleiste: `0.5rem`; Feldgruppen: `0.65rem`; Arbeitsflächen: `0.75rem`; Anmeldung: `1rem`, bis 600px `0.65rem`. Eingaben, Auswahlfelder, Textflächen, Knöpfe und Navigationslinks haben mindestens **44px** Höhe. Checkboxen und Radioknöpfe selbst sind `1.25rem` groß; ihre umgebenden Labels sind mindestens 44px hoch. Der Suchlink ist als `inline-flex` vertikal ausgerichtet und mindestens 44px hoch.

## Components

- **Eventakte:** Überschrift `1.35rem`, `scroll-margin-top: 5rem`, programmatisch fokussierbar über `tabIndex=-1`. Beim Öffnen erhält sie Fokus. Schließen führt zum passenden „Eventakte öffnen“-Knopf in der Liste zurück; Bearbeiten öffnet das zentrale Eventformular und fokussiert das Namensfeld. Die Auswahl „Übersicht“, „Ressourcen“, „Notizen“, „Logbuch“ besteht aus gewöhnlichen Knöpfen in einer beschrifteten Navigation; `aria-current="location"` kennzeichnet den Bereich. Inaktive Bereiche bleiben mit `hidden` eingehängt, damit ungespeicherte Ressourceneingaben beim Bereichswechsel erhalten bleiben. Der ausgewählte Bereich bleibt bei Versionsaktualisierungen erhalten: Die Akte behält ihre stabile Eventidentität und lädt Daten über `revision` nach. Die Navigation verwendet keine ARIA-Tabrollen. Inaktive Knöpfe sind transparent mit `muted`-Schrift; aktive und überfahrene Knöpfe nutzen `selected-surface` und `selected-ink`.
- **Eventfilter und Editor:** native `<details>`/`<summary>` mit oberen und unteren `border`-Trennern und `1rem` Außenabstand. Summary ist mindestens `48px` hoch, mit Akzentschrift, Gewicht 600 und `0.75rem 0.25rem` Innenabstand. Filter sind bei vorhandenen Eventfiltern in der URL anfänglich geöffnet und tragen „Filter · aktiv“. Der Editor beginnt geschlossen. Bearbeiten oder Duplizieren öffnet ihn, scrollt zum Formular und fokussiert den Namen. Erfolgreiches Speichern oder ausdrückliches Abbrechen schließt ihn und fokussiert die Summary. Bloßes Einklappen erhält den Formularentwurf; Fehler lassen die Eingaben bestehen. Der Abbrechen-Knopf erscheint bei einem geladenen Bearbeitungs- oder Duplikatentwurf.
- **Eventzeilen:** Monatsüberschrift `1.1rem`, Anzahl `0.8rem` mit Gewicht 400 und `muted`; erste Zeile mit Name, Datum und Status `1.05rem` mit Gewicht 650. Zweite Zeile, Zeitzone und Ressourcenhinweis verwenden `0.875rem` und `muted`. Aktionen stehen darunter mit `0.5rem` Abstand nach oben und rechts. Aktualisieren sowie Duplizieren/Bearbeiten verwenden transparente Sekundäraktionen mit Akzenttext und `hover-surface`. Die Zeilen erhalten keine eigenen Kartenflächen oder Schatten.
- **Aktionen:** grüne Knöpfe, Gewicht 600; deaktiviert mit Deckkraft 0.65 und `not-allowed`. Die Abmeldung im Navigationsfuß ist transparent mit `sidebar-ink`-Schrift und `#779386`-Rand; beim Überfahren verwendet sie fest `#294c3e`. Allgemeiner Fokus: `3px solid var(--focus)`, Abstand `3px`.
- **Darstellungsumschalter:** „Dunkelmodus“ ist vor und nach Anmeldung im Anwendungskopf verfügbar, mit dekorativem Mond-SVG und `aria-pressed` für den Dunkelzustand. Gespeichert wird ausschließlich `light` oder `dark` unter `localStorage["ak-theme"]`; ungültige oder nicht lesbare Werte fallen auf die Systempräferenz zurück. Ohne explizite Wahl werden Systemänderungen übernommen. Ein Klick setzt eine explizite Wahl; Änderungen anderer Tabs sowie gelöschte Präferenzen werden über das `storage`-Ereignis übernommen. Bei gesperrtem Speicher funktioniert die Wahl für die laufende Sitzung. Das aktuelle Schema wird per Layout-Effekt als `data-theme` am Dokumentwurzelelement gesetzt; Farben wechseln ohne Übergangsanimation. Der Umschalter bietet keine eigene Funktion zum Zurücksetzen auf die Systempräferenz.
- **Formulare:** sichtbare Labels, Felder mit `surface`-Hintergrund und `field-border`-Rand; Textflächen und Mehrfachauswahl mindestens `7rem` hoch. Checkboxen/Radios verwenden die Akzentfarbe.
- **Kontobereich:** Kontoidentität, Abmeldung und Anmeldestatus liegen im Navigationsfuß: auf dem Desktop in der Seitenleiste, mobil nur im geöffneten Dialog. Das einspaltige Kontogrid hat `0.6rem` Abstand. Sichtbare Rückmeldungen verwenden `#294c3e` und `sidebar-ink`, einschließlich fehlgeschlagener Abmeldung; ihre Statusrolle bleibt innerhalb des modalen Kontexts erreichbar. Im abgemeldeten Zustand steht die Statusmeldung ausschließlich direkt in der Anmeldung.
- **Datenexport:** Unter Einstellungen → Datenexport (`#settings-export`) stehen drei native Downloadlinks für Kontakte, alle Events und den Produktkatalog in einer semantischen Liste (`ul`/`li`). Links sind als `inline-flex` ausgerichtet, mindestens 44px hoch und mit Gewicht 600 gesetzt; bestehende Link- und Fokusfarben gelten. Erläuterungen verwenden `muted` und `margin: 0 0 0.75rem`; sämtliche Absätze im Exportbereich bleiben auf `70ch` begrenzt. Der Text erklärt den vollständigen Bestand unabhängig von Filtern, die enthaltenen archivierten beziehungsweise annullierten Einträge und die Abgrenzung zur vollständigen Datensicherung.
- **Kalenderzustände:** Pastellfarbene Eventartikel und Ressourcenzellen (`calendar-state`) behalten in beiden Darstellungen die feste dunkle Schrift `#111827`. Links erben diese Farbe statt des allgemeinen Akzents; ihr Fokusrahmen verwendet ebenfalls `#111827`.
- **Navigation:** aktive Links tragen `aria-current="page"`; dekorative SVGs sind `aria-hidden`. Einstellungen gruppieren Stammdaten, Kalender-Abos, Datenimport, Datenexport und Konto/Zugriff.
- **Mobiles Menü:** natives `<dialog>` über `showModal()`, beschriftet mit „Menü“. Der Auslöser zeigt ein dekoratives 22 × 22px Hamburger-SVG auf transparenter Fläche; sein zugänglicher Name bleibt „Menü öffnen“. Breite `min(21rem, calc(100% - 2rem))`, Höhe `100dvh`. Der Schließen-Knopf behält helle Seitennavigationsschrift; sein Hoverhintergrund ist in beiden Darstellungen fest `#294c3e`. Schließen über Knopf, Navigation oder native Escape-Behandlung; explizites Schließen setzt Fokus auf den Auslöser zurück. Der Browser übernimmt modalen Fokus und Hintergrundinertheit. Klicks außerhalb des Dialogrechtecks schließen das Menü ebenfalls. Beim Wechsel auf Desktopbreite (`min-width: 901px`) schließt ein `matchMedia`-Listener den geöffneten nativen Dialog und setzt `aria-expanded` zurück. Der Fokus wechselt auf den aktuellen Link der Desktop-Seitenleiste; fehlt dieser, etwa in der Suche, auf den Suchlink der Werkzeugleiste. Beim Unmount wird der Listener entfernt.
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
