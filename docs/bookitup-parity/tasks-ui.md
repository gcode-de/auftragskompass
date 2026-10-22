# Tickets: Kalender, Navigation, Theme und Filter

Alle Tickets **offen**. Gemeinsame Ausführung/Done: [Agentenregeln](agent-playbook.md), [Zielvertrag](design-contract.md). Pfade sind repository-relativ; Zeilen beziehen sich auf cf68f1e und sind vor Änderung zu verifizieren. Jede Aufgabe bekommt einen eigenen aktiven Slice im Implementierungsplan. Keine echten Daten für Screenshots verwenden.

## BKP001 — Monatskalender nach Wochentagen korrekt ausrichten

**P1, sofort, unabhängig.** Beleg A02/S. Reproduktion: Monatsansicht Oktober 2026 öffnen; 1. Oktober (Donnerstag) steht unter Mo. Das ist ein fachlich irreführender Kalender, kein kosmetischer Randfehler.

**Lesen:** `apps/admin/src/CalendarPanel.tsx:369–395`, `styles.css` `.calendar-grid`/`.calendar-weekday-head`; `packages/core/src/calendar.ts` nur zur Abgrenzung. Tests `tests/component/calendar-overview.test.tsx`, `tests/e2e/auth.spec.ts`; vorhandene Unit-Datums-/DST-Tests erhalten.

**Kleinste Änderung:** Wochentagskopf im DOM vor die bereits errechneten führenden Platzhalter setzen. Montag-basierte Offsetberechnung und eigentliche Tagesdaten behalten. CSS nicht durch einen zusätzlichen negativen Offset kaschieren. Kein Backendfenster, Eventdatum, Zeitzone oder ganzer Kalender-Renderer neu schreiben.

**Tests zuerst:** Komponentenregression: Kopf steht vor Pads, danach Tage. Realer Chromium-Test bei 390 und 1440: Monate mit Start Montag, Donnerstag (2026-10), Sonntag; für Tag 1 liegt x in der passenden Wochentagsspalte, Tag 7/8 über Reihenwechsel korrekt; Zahl der tatsächlichen Monatstage bleibt richtig. Fiktives Event am Monatsanfang öffnet denselben korrekten Eventlink. JSDOM-Kinderzählung allein genügt nicht. Browsermessung der Header-Unterelemente und Tagzellen, keine Pixelfarbe als alleiniger Test.

**Abnahme:** Header/Datum korrekt in beiden Themes und nach Vor/Zurück/Ansichtswechsel; keine doppelte Tageszelle, kein Body-Overflow. Commitvorschlag `fix: align month calendar days with weekday headings`.

## BKP005 — Grün reduzieren und neutrale Theme-Tokens liefern

**P2, unabhängig von Fachmodulen.** Beleg A01–A12, expliziter Benutzerwunsch. Lesen `styles.css`, `ThemeToggle.tsx`, `App.tsx`, `apps/admin/DESIGN.md`; Tests `theme.test.tsx`, `action-hierarchy.test.tsx`, betroffene Kalender-/Navigationskomponenten, E2E.

**Scope:** Canvas/Sidebar/Karten neutralisieren, bestehende `--action`, `--quiet-ink`, `--quiet-action-border`, Status- und Fokus-Tokens bewusst abstimmen. Kein zweites CSS-Theme pro Komponente. Wenig entsättigtes Grün nur für kleine Akzente/semantischen Erfolg. H036-Aktionsstufen behalten. Vorab eine kleine synthetische Referenzfläche aus Liste, Dialog, Formular, Legende in beiden Themes verwenden; konkrete Tokenwerte im Slice festlegen und zusammen mit Implementierung in DESIGN.md dokumentieren.

**Tests zuerst:** Token-/Theme-Regression für vorhandene Umschaltung/Persistenz, dann berechnete Kontraste repräsentativer Text-, Fokus-, Disabled-, Error-/Statuspaare; visuelle Abnahme beider Themes bei 390/1280. Nicht alle bisherigen Werte pauschal aus Kontrasttests streichen. Fokus/Status dürfen nicht allein die neue Farbe vermitteln. Impeccable-Hinweise auf 22 Größen/8 Radien sind keine Erlaubnis für globalen Typoumbau.

**Nicht dabei:** Navigation verschieben, Formularlogik ändern, Font-/Motion-Paket installieren. **Done:** wesentlich weniger grüne Flächen, verständliche Stati, keine Kontrast-/Fokusregression, DESIGN entspricht dem tatsächlichen Code. Commit `style: use restrained neutral surfaces in both themes`.

## BKP006 — Desktop-Collapse-Schalter unauffällig integrieren

**P2.** Lesen `Navigation.tsx`, `.sidebar-toggle`/Sidebar-CSS, `unsaved-changes.ts`, `tests/component/navigation.test.tsx`, E2E. Ausgangspunkt: Schalter existiert mit `ak-sidebar` und Storage-Sync; nicht neu implementieren.

**Scope:** Schalter aus eigener Zeile vor der Marke in kompakte Marken-/Leistenzeile versetzen. Expanded/Collapsed bleiben von derselben logischen Position aus erreichbar. Home-/Brandlink unabhängig bedienbar. Bei schmaler Leiste kein überlappender Schriftzug. Mobile weiterhin ausschließlich Menü öffnen/schließen, kein zusätzlicher Collapse. Labels, title, aria-expanded, aria-current und gespeicherte Präferenz erhalten.

**Tests zuerst:** Aktivierung per Tastatur, Fokus nach Wechsel/Resize, Wiederherstellung nach Reload/Storage-Ereignis, nur ein mobiler Menüzugang, keine überdeckten Links; Chromium-Kanten-/Bounding-Box-Prüfung bei 320/390/768/1280 plus Zoom. Modifier-/Mittelklick auf Brand/Nav bleibt nativ. Fokusziel nicht durch Remount verlieren.

**Nicht dabei:** globale Navigation neu sortieren, Theme oder Auth ändern. **Done:** Schalter stört weder Marke noch Arbeitsfläche; eingeklappte Leiste bleibt verständlich. Commit `style: integrate sidebar collapse into the brand row`.

## BKP007 — Eventfilter als Bookitup-Kontextspalte und mobilen Drawer anordnen

**P2, vorhandenen H041-Slice erweitern; BKP004 für finale Eventseiten-Abnahme, nicht für isolierte Filterentwicklung nötig.** Beleg B01/A03; Gruppenfolge im Zielvertrag. Lesen `EventPanel.tsx`, `event-filters.ts`, `url-state.ts`, `Navigation.tsx`, `AuthPanel.tsx`, `styles.css`; Tests `events.test.tsx`, `navigation.test.tsx`, `event-filters.test.ts`, E2E.

**Scope in ersten Unter-Slice begrenzen:** vorhandene Felder und H041-Presets/Zähler unverändert in Desktop-Kontextspalte und mobilen Filterdialog versetzen. Eine gemeinsame Zustandsquelle, nicht zwei unabhängige Formulare/URL-Schreiber. Auf 390 nur kompakter Filterzugang plus aktive Kriterien, Liste sofort sichtbar. Dialogabschluss/Abbruch ausdrücklich, Fokus zurück auf Filterzugang. Datums-/Status-/Typ-Semantik und Suche erhalten.

**Folge-Unter-Slices:** Monat/Jahr-Bedienung und echte Ansichtwechsel sowie Bookitup-Status-/Art-Darstellung erst nach gezielter Prüfung der Referenz. Mehrfachauswahl nicht in bestehende Einzelwert-API hineinquetschen. Anfragen bleibt Schnellfilter außerhalb der Sortier-Radiogruppe. `df_*` und fremde Queryparameter bleiben. Eingaben nicht bei jedem Render aus URL neu initialisieren.

**Tests zuerst:** korrekte bestehende Preset-/URL-/Zurück-Regeln erhalten; Zählertests mit bisher vollständiger Fixtureliste zusätzlich gegen den real gefilterten API-Abruf prüfen; ein angewandter Filterzustand über beide Darstellungen; Abbruch verwirft nur Filterentwurf; Abschluss ein History-Eintrag; Escape/Fokusfalle; schmutziger Event-Editor wird nicht überschrieben. Tenant-Zone abweichend von Browser, Monats-/Schaltjahresgrenzen und fehlerhafte von/bis-Felder weiterhin prüfen. **Eigener Zähler-Unter-Slice:** Aktuell liefert die API nur bereits datums-/statusgefilterte Zeilen. Ein Clienthelper kann außerhalb liegende Datensätze nicht mitzählen. Mit fiktiven undatierten Events sowie Anfragen außerhalb des gewählten Datums/Status zuerst eine fehlschlagende API-/Komponentenregression schreiben. Zählbasis fachlich explizit festlegen (Suche/Art erhalten, Datumsunabhängigkeit gemäß H041, Statusabhängigkeit gegen Referenz abgleichen statt pauschal als Fehler behandeln), tenantgesicherte Aggregation bevorzugt am bestehenden Listenvertrag ergänzen und Abwärtskompatibilität testen. Keine unbeschränkte Gesamtliste oder N+1-Abrufe laden. Bestehende falsche Ergebnisse nicht nur zugunsten alter Tests erhalten.

**Done:** Filterposition/-gruppen wie Referenz, keine Filterwand vor mobilen Ergebnissen, 320/390/768/1280 ohne Body-Overflow, alle bisherigen Filterfälle bedienbar. Keine Solo/Agentur-Attrappe. Commit erster Slice `feat: place event filters in a contextual sidebar and mobile drawer`.

## BKP008 — Mobilen Kalender lesbar und vollständig bedienbar machen

**P1, nach BKP001.** Lesen CalendarPanel/CSS/`calendar-range.ts`, Komponenten-/E2E-Kalendertests. B02 ist Desktopreferenz; genaue Bookitup-Mobilansicht noch offen und vor der endgültigen visuellen Abnahme nach BKP030 prüfen.

**Scope:** im schmalen Monatsraster kurze Tageszahl, Auswahlzustand/Heute, kompakte Anzahl/Statusindikatoren; darunter vollständige Agenda für gewählten Tag. Auswahl über native Buttons mit Datum als zugänglichem Namen. Ein Tag ohne Events sagt dies ausdrücklich. Monat-/Tag-/Wochenwechsel erhalten; Ressourcenbelegung weiterhin gezielt aufklappbar. Oberen Erklär-/Legendenblock komprimieren, nicht fachliche Warnung entfernen. Vorhandene Eventlinks und Zeittexte wiederverwenden. Date-only Events als Tagesbuchung, Mehrtagesevents pro betroffenen Tag; keine willkürlichen Startzeiten.

**Tests zuerst:** bei 320/390 mindestens Tag mit 0/1/5 Events und sehr langem fiktivem Namen, Monats-/DST-Grenze, Date-only, ausgewählte Agenda vollständig erreichbar, kein Event nur über Hover. Tageswechsel per Tastatur und Touch-Klick, Fokus sichtbar nach Reload/Zeitraumwechsel; korrekt ausgerichtete Wochentage bleiben. 200-%-Zoom, beide Themes. Ein Viewporttest allein ist kein physischer iPhone-Gestentest; offen vermerken.

**Nicht dabei:** Drag&Drop, Reservierungsänderung durch Tagwahl, neue Bibliothek oder private Kalenderintegration. **Done:** echte lesbare Arbeitsansicht statt nur „kein horizontaler Overflow“. Commit `feat: make the mobile month calendar readable with a day agenda`.
