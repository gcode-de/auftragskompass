---
name: AuftragsKompass
description: Interne Verwaltungsoberfläche für den lokalen Fotobox-Betrieb
colors:
  accent: "#176b52"
  surface: "#ffffff"
  canvas: "#f4f6f5"
  ink: "#202d29"
  muted: "#596b64"
  border: "#d6dfda"
  sidebar: "#172e27"
  sidebar-ink: "#eaf2ee"
  button-hover: "#0b5144"
  focus: "#137a69"
  sidebar-focus: "#c0e7ce"
  sidebar-active: "#315a48"
  sidebar-hover: "#294c3e"
  sidebar-link: "#c5d6ce"
  sidebar-muted: "#b0c8bd"
  selection: "#c6e7d8"
  settings-active: "#e3f0e8"
  settings-active-ink: "#155d46"
  field-border: "#9facbb"
  field-surface: "#fafcfd"
  status: "#eaf2f7"
  alert: "#fff0ed"
  alert-border: "#a62c22"
  table-header: "#edf3f6"
  nav-hover: "#e8f4ef"
  login-border: "#e0e6ec"
  backdrop: "#0b1813aa"
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
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "0.6rem 1rem"
    typography: "{typography.button}"
  button-primary-hover:
    backgroundColor: "{colors.button-hover}"
  button-account:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "0.6rem 1rem"
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
    textColor: "{colors.surface}"
    rounded: "{rounded.sidebar-link}"
    padding: "0.8rem 0.9rem"
---

# Design System: AuftragsKompass

## Overview

Die interne Verwaltungsoberfläche unterstützt den Inhaber eines lokal betriebenen Fotobox-Unternehmens. Das bestehende System verwendet grüne Aktionen, eine dunkle Seitennavigation und helle, voneinander getrennte Arbeitsbereiche. Diese Dokumentation beschreibt den implementierten Zustand; sie legt keine neue Markenrichtung fest.

**Key Characteristics:**

- Getrennte Arbeitsbereiche mit gemeinsamer Navigation.
- Systemschrift, sichtbarer Tastaturfokus und überwiegend mindestens 44px hohe Bedienelemente.
- Native modale Navigation auf schmalen Bildschirmen.

## Colors

Maßgeblich sind die wirksamen Werte des zweiten `:root`-Blocks in `src/styles.css`: `accent`, `border`, `ink` und `canvas` ersetzen die früheren Grundwerte. Die Frontmatter enthält diese wirksamen Werte sowie weiter verwendete Komponentenfarben.

- Grün (`accent`): Aktionen, Links und Eingabecursor; dunklerer `button-hover` beim Überfahren.
- Dunkelgrün (`sidebar`) mit hellen Texten: Hauptnavigation; `sidebar-active` und `sidebar-hover` unterscheiden Zustände.
- Helle Flächen (`surface`, `canvas`, `field-surface`): Arbeitsbereich, Hintergrund und Feldgruppen; `border` trennt Flächen.
- `status` und `alert` unterscheiden Rückmeldung und Fehler; Fehler erhalten zusätzlich `alert-border`.
- `focus` markiert den allgemeinen Tastaturfokus; die dunkle Navigation verwendet `sidebar-focus`.

## Typography

Durchgehend die Systemschrift aus der Frontmatter; keine externe Schrift. Die Grundschriftgröße ist nicht ausdrücklich festgelegt und folgt dem Browserstandard. Überschriften verwenden Zeilenhöhe 1.2 und Laufweite −0.025em. Die globale h1-Größe ist `clamp(1.8rem, 4vw, 2.6rem)`, im Anwendungskopf jedoch durch `1.15rem` überschrieben. h2 ist grundsätzlich `1.5rem`, innerhalb eines Arbeitsbereichs `1.25rem`. Die Bereichsbezeichnung verwendet `1.5rem` und Gewicht 650, bis einschließlich 900px `1.15rem`. Kontoleiste und Kopfuntertitel: `0.875rem`; Navigationsuntertitel: `0.8rem`; Tabellen: `0.9rem`.

## Layout

Desktop: `.app-shell` hat maximal `100rem` Breite und `padding: 0 2.5rem 3rem 18rem`. Die feste linke Navigation ist `15rem` breit. Arbeitsbereiche sind weiße, umrandete Flächen mit `1.75rem` Innenabstand; breite Inhalte dürfen horizontal scrollen. Formulargruppen verwenden `repeat(auto-fit, minmax(min(100%, 18rem), 1fr))` mit `1rem` Abstand. Ältere Feldgruppen mit expliziten `label[for]` bleiben einspaltig.

Bis einschließlich **900px**: Seitennavigation ausblenden, Menüknopf einblenden, Werkzeugleiste oben fixierend (`position: sticky; top: 0`, Ebene 5), Seitenabstand `1rem`. Unterer Abstand: `max(2rem, env(safe-area-inset-bottom))`. Arbeitsflächen erhalten `1rem` Innenabstand; die Einstellungsnavigation zwei gleich breite Spalten. Bis einschließlich **600px** werden globale Suche einspaltig und Feldgruppen mit `0.85rem` gepolstert. Spätere 900px-Regeln haben bei Überschneidungen Vorrang.

Die Anmeldung ist eine eigene, maximal `30rem` breite Karte; der Anwendungsrahmen wird dafür maximal `65rem` breit und erhält `1.5rem` Innenabstand. Der sichtbare Arbeitsbereich folgt dem URL-Hash. Die globale Suche zeigt Events und Kontakte gemeinsam; Einstellungen haben eigene Unterbereiche.

## Elevation & Depth

Arbeitsflächen und Seitennavigation verwenden keine Schatten. Umrandungen und Flächenfarben schaffen Trennung. Die Anmeldung behält `0 0.25rem 1rem #20304408`; der generische Navigationsstil enthält `0 0.25rem 1rem #2030440d`, während Haupt- und Einstellungsnavigation diesen Schatten abschalten. Das native modale Menü liegt im Top Layer mit Hintergrundabdunklung `#0b1813aa`.

## Shapes

Kontrollen: `0.4rem`; Navigationslinks der Seitenleiste: `0.5rem`; Feldgruppen: `0.65rem`; Arbeitsflächen: `0.75rem`; Anmeldung: `1rem`, bis 600px `0.65rem`. Eingaben, Auswahlfelder, Textflächen, Knöpfe und Navigationslinks haben mindestens **44px** Höhe. Checkboxen und Radioknöpfe selbst sind `1.25rem` groß; ihre umgebenden Labels sind mindestens 44px hoch. Der Suchlink ist als `inline-flex` vertikal ausgerichtet und mindestens 44px hoch.

## Components

- **Aktionen:** grüne Knöpfe, Gewicht 600; deaktiviert mit Deckkraft 0.65 und `not-allowed`. Die Abmeldung ist transparent mit grüner Schrift und heller Umrandung; beim Überfahren verwendet sie `#e8f4ef` als Hintergrund und behält die grüne Schrift. Allgemeiner Fokus: `3px solid #137a69`, Abstand `3px`.
- **Formulare:** sichtbare Labels, weiße Felder mit `#9facbb`-Rand; Textflächen und Mehrfachauswahl mindestens `7rem` hoch. Checkboxen/Radios verwenden die Akzentfarbe.
- **Navigation:** aktive Links tragen `aria-current="page"`; dekorative SVGs sind `aria-hidden`. Einstellungen gruppieren Stammdaten, Kalender-Abos, Datenimport und Konto/Zugriff.
- **Mobiles Menü:** natives `<dialog>` über `showModal()`, beschriftet mit „Menü“. Breite `min(21rem, calc(100% - 2rem))`, Höhe `100dvh`. Schließen über Knopf, Navigation oder native Escape-Behandlung; explizites Schließen setzt Fokus auf den Auslöser zurück. Der Browser übernimmt modalen Fokus und Hintergrundinertheit. Klicks außerhalb des Dialogrechtecks schließen das Menü ebenfalls. Die Implementierung enthält keinen automatischen Schließ-Handler beim Wechsel auf Desktopbreite.
- **Bewegung:** Knöpfe wechseln Hintergrund in `150ms ease` und skalieren bei Aktivierung auf `0.98` mit `150ms cubic-bezier(0.23, 1, 0.32, 1)`. Bei `prefers-reduced-motion: reduce` entfällt die Transformation; der Farbwechsel bleibt. Das Menü erhält nur bei Zeigeraufruf und `no-preference` eine Eintrittsbewegung über `220ms`, Ausgangsposition `translateX(-1rem)` und Deckkraft 0 via `@starting-style`. Tastaturaufruf und reduzierte Bewegung haben keine Menübewegung; keine eigene Austrittsanimation.
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
