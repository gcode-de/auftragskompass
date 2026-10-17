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
    textColor: "{colors.accent}"
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

Durchgehend die Systemschrift aus der Frontmatter; keine externe Schrift. Die Grundschriftgröße ist nicht ausdrücklich festgelegt und folgt dem Browserstandard. Überschriften verwenden Zeilenhöhe 1.2 und Laufweite −0.025em. Die globale h1-Größe ist `clamp(1.8rem, 4vw, 2.6rem)`, im Anwendungskopf jedoch durch `1.15rem` überschrieben. h2 ist grundsätzlich `1.5rem`, innerhalb eines Arbeitsbereichs `1.25rem`. Die Bereichsbezeichnung verwendet `1.5rem` und Gewicht 650, bis einschließlich 900px `1.15rem`. Kontoleiste und Kopfuntertitel: `0.875rem`; Navigationsuntertitel: `0.8rem`; Tabellen: `0.9rem`. Tabellenzellen, Tabellenköpfe und Zeitangaben verwenden `font-variant-numeric: tabular-nums`.

## Layout

Desktop: `.app-shell` hat maximal `100rem` Breite und `padding: 0 2.5rem 3rem 18rem`. Die feste linke Navigation ist `15rem` breit. Arbeitsbereiche sind umrandete Flächen in `surface` mit `1.75rem` Innenabstand; breite Inhalte dürfen horizontal scrollen. Formulargruppen verwenden `repeat(auto-fit, minmax(min(100%, 18rem), 1fr))` mit `1rem` Abstand. Ältere Feldgruppen mit expliziten `label[for]` bleiben einspaltig.

Bis einschließlich **900px**: Seitennavigation ausblenden, Menüknopf einblenden, Werkzeugleiste oben fixierend (`position: sticky; top: 0`, Ebene 5), Seitenabstand `1rem`. Unterer Abstand: `max(2rem, env(safe-area-inset-bottom))`. Arbeitsflächen erhalten `1rem` Innenabstand; die Einstellungsnavigation zwei gleich breite Spalten. Bis einschließlich **600px** werden globale Suche einspaltig und Feldgruppen mit `0.85rem` gepolstert. Spätere 900px-Regeln haben bei Überschneidungen Vorrang.

Der Anwendungskopf verwendet ein zweispaltiges Grid (`minmax(0, 1fr) auto`): Name und Untertitel links, Darstellungsumschalter rechts über beide Zeilen.

Die Anmeldung ist eine eigene, maximal `30rem` breite Karte; der Anwendungsrahmen wird dafür maximal `65rem` breit und erhält `1.5rem` Innenabstand. Der sichtbare Arbeitsbereich folgt dem URL-Hash. Die globale Suche zeigt Events und Kontakte gemeinsam; Einstellungen haben eigene Unterbereiche.

## Elevation & Depth

Arbeitsflächen und Seitennavigation verwenden keine Schatten. Umrandungen und Flächenfarben schaffen Trennung. Die Anmeldung behält `0 0.25rem 1rem #20304408`; der generische Navigationsstil enthält `0 0.25rem 1rem #2030440d`, während Haupt- und Einstellungsnavigation diesen Schatten abschalten. Das native modale Menü liegt im Top Layer mit Hintergrundabdunklung `#0b1813aa`.

## Shapes

Kontrollen: `0.4rem`; Navigationslinks der Seitenleiste: `0.5rem`; Feldgruppen: `0.65rem`; Arbeitsflächen: `0.75rem`; Anmeldung: `1rem`, bis 600px `0.65rem`. Eingaben, Auswahlfelder, Textflächen, Knöpfe und Navigationslinks haben mindestens **44px** Höhe. Checkboxen und Radioknöpfe selbst sind `1.25rem` groß; ihre umgebenden Labels sind mindestens 44px hoch. Der Suchlink ist als `inline-flex` vertikal ausgerichtet und mindestens 44px hoch.

## Components

- **Aktionen:** grüne Knöpfe, Gewicht 600; deaktiviert mit Deckkraft 0.65 und `not-allowed`. Die Abmeldung ist transparent mit grüner Schrift und heller Umrandung; beim Überfahren verwendet sie `hover-surface` als Hintergrund und behält die Akzentschrift. Allgemeiner Fokus: `3px solid var(--focus)`, Abstand `3px`.
- **Darstellungsumschalter:** „Dunkelmodus“ ist vor und nach Anmeldung im Anwendungskopf verfügbar, mit dekorativem Mond-SVG und `aria-pressed` für den Dunkelzustand. Gespeichert wird ausschließlich `light` oder `dark` unter `localStorage["ak-theme"]`; ungültige oder nicht lesbare Werte fallen auf die Systempräferenz zurück. Ohne explizite Wahl werden Systemänderungen übernommen. Ein Klick setzt eine explizite Wahl; Änderungen anderer Tabs sowie gelöschte Präferenzen werden über das `storage`-Ereignis übernommen. Bei gesperrtem Speicher funktioniert die Wahl für die laufende Sitzung. Das aktuelle Schema wird per Layout-Effekt als `data-theme` am Dokumentwurzelelement gesetzt; Farben wechseln ohne Übergangsanimation. Der Umschalter bietet keine eigene Funktion zum Zurücksetzen auf die Systempräferenz.
- **Formulare:** sichtbare Labels, Felder mit `surface`-Hintergrund und `field-border`-Rand; Textflächen und Mehrfachauswahl mindestens `7rem` hoch. Checkboxen/Radios verwenden die Akzentfarbe.
- **Navigation:** aktive Links tragen `aria-current="page"`; dekorative SVGs sind `aria-hidden`. Einstellungen gruppieren Stammdaten, Kalender-Abos, Datenimport und Konto/Zugriff.
- **Mobiles Menü:** natives `<dialog>` über `showModal()`, beschriftet mit „Menü“. Breite `min(21rem, calc(100% - 2rem))`, Höhe `100dvh`. Der Schließen-Knopf behält helle Seitennavigationsschrift; sein Hoverhintergrund ist in beiden Darstellungen fest `#294c3e`. Schließen über Knopf, Navigation oder native Escape-Behandlung; explizites Schließen setzt Fokus auf den Auslöser zurück. Der Browser übernimmt modalen Fokus und Hintergrundinertheit. Klicks außerhalb des Dialogrechtecks schließen das Menü ebenfalls. Die Implementierung enthält keinen automatischen Schließ-Handler beim Wechsel auf Desktopbreite.
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
