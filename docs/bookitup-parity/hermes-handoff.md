# Übergabeprompt für Hermes: AuftragsKompass

Der folgende Prompt darf als vollständige erste Nachricht in eine Hermes-Session übernommen werden. Er enthält keine Zugangsdaten oder Kundendaten. Er startet Implementierungsarbeit; die Analyse ist bereits im Repo. Statusberichte müssen tatsächliche Prüfungen von Annahmen trennen.

---

Übernimm die autorisierte Weiterentwicklung von **AuftragsKompass**. Arbeite jetzt konkret an den unten priorisierten Verbesserungen, nicht nur an einer weiteren Zusammenfassung oder einem Plan.

## Projekt und aktueller Einstieg

- Repository: https://github.com/gcode-de/auftragskompass
- Der vollständige Paritätsbericht ist auf Branch `codex/bookitup-parity-audit`, mindestens Commit `e94b2232b3d4b82b4dcb6801e5d9a59337205048` und dessen nachfolgendem Übergabe-Commit. Diesen Stand zunächst prüfen/fetchen. Die App-Analyse basiert auf `cf68f1e` von `codex/ux-event-simplification`; dieselbe Buildkennung wurde im Browser gesehen. Das ist ein datierter Befund, kein Beweis des heutigen Live-/CI-Standes.
- Vorhandener sauberer Dokumentations-Worktree auf dem bisherigen Mac: `/Users/gp/.codex/worktrees/bookitup-parity-audit/Fotobox`. Der ältere Checkout `/Users/gp/Documents/Fotobox` lag bei `414fa33` auf `codex/local-runtime-ci`; nicht blind dort auf einer alten Basis implementieren. Auf einem anderen Host eigenen passenden Checkout verwenden.
- Prüfe `pwd`, Git-Status, Branch, Remote und letzte Commits. Keine fremden Änderungen verwerfen, keinen aktiven Checkout ungefragt umschalten, keine bereits gepushten Commits umschreiben. Nutze für die Implementierung einen eigenen `codex/...`-Branch auf dem aktuellen Paritätsstand und bei gemeinsam benutztem Checkout eine getrennte Arbeitskopie/Worktree. Vorhandene geeignete Isolation wiederverwenden.

Lies vor Änderungen vollständig: `AGENTS.md`, `docs/handoff.md`, `docs/bookitup-parity/README.md`, `observations.md`, `design-contract.md`, `agent-playbook.md` im selben Verzeichnis, den relevanten Lastenheftabschnitt und den aktuellen `IMPLEMENTATION_PLAN.md`. Danach die vollständigen betroffenen Tickets in `tasks-ui.md` beziehungsweise `tasks-core.md`. Die übrigen Dokument-/Mail-/Abschlusstickets sind der spätere Backlog, nicht zusätzliches Arbeitsvolumen dieser ersten Welle.

## Ziel

Ein möglichst vollständiger funktionaler und in der Bedienlogik naher Bookitup-Klon, der nur an relevanten Stellen vorsichtig vereinfacht wird. Keine neue deutlich abweichende Informationsarchitektur. Progressive Offenlegung wie bei Airbnb: zunächst nur das Wesentliche, zusätzliche Angaben und seltene Aktionen bewusst öffnen. Elemente ausrichten, sinnvolle gleiche Höhen, optisch kompakte Buttons bei weiter ausreichend großen interaktiven Flächen. Mobil besonders sorgfältig prüfen. Hell/Dunkel mit Umschalter erhalten; das bisher dominante Grün deutlich dezenter machen, insbesondere im Darkmode. Den störenden Collapse-Schalter versetzen. Eventfilter wie Bookitup strukturieren und positionieren.

Jeder gültige authentische Website-Eingang soll als normales **Option-Event** entstehen, auch ohne auflösbaren Kontakt oder Land. Keine erfundenen Kontakte, keine automatische feste Ressourcenbuchung. Der Ausnahmen-Posteingang unter Events entfällt erst nach funktionierender korrigierter Pipeline. DE-Vorbelegung für fehlendes Land neuer Website-Kontakte ist erlaubt; bekannte andere Länder nicht überschreiben. Das strikte öffentliche v1-Schema hat aktuell kein Landfeld und darf in diesem Fix nicht beiläufig erweitert werden.

## Zusammenarbeit: MiMo und DeepSeek

**MiMo koordiniert Untersuchung, Priorisierung, Integration und abschließendes Review. DeepSeek-Coding-Subagents erhalten klar abgegrenzte Aufgaben mit zuständigen Dateien und überprüfbaren Abnahmekriterien.** Prüfe die tatsächlich in Hermes verfügbaren Modelle und Delegationswerkzeuge; verwende diese Aufteilung, wenn eingerichtet. Behaupte keine Delegation oder Modellnutzung, die nicht stattgefunden hat. Wenn ein Modell fehlt, melde die konkrete Einschränkung und verwende verfügbare autorisierte Fähigkeiten, ohne Zugangsdaten, Providerverträge oder Sicherheitskonfigurationen zu ändern.

Pro Coding-Auftrag an einen Subagenten ausdrücklich nennen: Ticket/Unter-Slice, Basis-SHA, erlaubte Dateien, benötigte Lesepfade, präzises Soll, Nicht-Scope, zuerst fehlschlagender Test, negative Fälle, Gate-Befehle und Rückgabeformat. Immer ausreichend Projektkontext mitgeben; kein bloßes „mach den Kalender“.

**Genau ein nummerierter Implementierungsslice gleichzeitig.** Parallel dürfen unabhängige lesende Untersuchung oder getrennte Reviews laufen. Vermeide parallele Änderungen an denselben Dateien; besonders `EventPanel.tsx`, `CalendarPanel.tsx`, `styles.css`, gemeinsame Tests und Plan/Handoff haben jeweils genau einen Besitzer. MiMo integriert, prüft jeden vollständigen Diff und verwaltet Plan-/Handoffänderungen. Ein unabhängiger Reviewer darf lesen, aber währenddessen nicht dieselben Dateien verändern. Keine gleichzeitig laufenden Commits, Migrationen oder Deployments.

## Erste priorisierte Arbeitswelle und Abschlussgrenze

Bearbeite **BKP001 bis BKP008**, einzeln und mit den dokumentierten Abhängigkeiten. Das sind acht Tickets, keine acht ungeprüften Großcommits. Falls ein Ticket zu groß ist, vor Start in klar begrenzte nummerierte Unter-Slices im Implementierungsplan zerlegen; jeder liefert einen vollständigen testbaren Fortschritt. Beginne unmittelbar mit BKP001.

1. **BKP001:** Monatskalender korrekt Mo–So ausrichten. `CalendarPanel.tsx` platziert derzeit führende Pads vor dem vollbreiten Wochentagskopf; dadurch erscheint Oktober 2026 Tag1 unter Montag statt Donnerstag. Kopf vor Pads anordnen, Offsetberechnung beibehalten. Backend-Datumsfenster nicht verändern. Zuerst Komponententest plus echten Chromium-Geometrietest bei 390/1440 für Monatsstart Montag/Donnerstag/Sonntag. Nur Kinderzahl oder „kein Overflow“ reicht nicht.
2. **BKP002:** vorhandene Option-Pipeline um kontaktlose Anlage erweitern. Neue vorwärtsgerichtete Migration für nullable `website_inquiries.contact_id`, ursprüngliches Receipt/Original/Audit erhalten, alle Response-Schemas/Aufrufer prüfen, Replay darf später bearbeiteten Kontakt/Status nicht zurücksetzen. Kontakte behalten ihre eigene Landvalidierung. Keine zweite Importstrecke.
3. **BKP003:** vorhandenen Option-Drain fair und wiederholbar machen. Älteste-zehn-Abfrage plus prozesslanges `attempted`-Set kann neuere Eingänge verdrängen und temporäre Fehler bis Neustart festhalten. Test: zehn alte Fehler, elfter gültiger Eingang wird trotzdem erreicht; vorübergehender Fehler wird ohne Neustart wiederholt; keine Doppel-Events/Parallelität.
4. **BKP004:** Ausnahme-UI unter Events entfernen, Optionen in normaler Liste/Details bearbeiten, Originaleingang dort lesend erreichbar, fehlender Kontakt als normaler offener Zustand. Nicht einfach den Sonderbereich verstecken, solange die Datenlogik noch blockiert.
5. **BKP005:** neutrale Theme-Flächen/dezente Akzente, bestehende Tokens/Aktionsstufen nutzen, Kontraste/Fokus/semantische Statusdarstellung erhalten; DESIGN.md nur passend zur tatsächlich implementierten Änderung aktualisieren.
6. **BKP006:** Desktop-Collapse-Schalter in kompakte Marken-/Leistenzeile integrieren; gespeicherte Präferenz, Labels, Fokus und mobile Menünavigation erhalten.
7. **BKP007:** Eventfilter als Desktop-Kontextspalte und mobilen Drawer mit Bookitup-Gruppenfolge. Vorhandene URL-/Tenant-Zeitzonen-/Presetlogik weiterverwenden. Anfragen ist ein Schnellfilter, kein Sortierradio. Zusätzlich korrekte Zählbasis prüfen: Zähler auf bereits serverseitig gefilterten Zeilen können datumsunabhängig gemeinte Einträge unterschlagen. Status-/Mehrfachwahlsemantik vor Änderung gezielt abgleichen; nicht aus unbekannter Referenz raten.
8. **BKP008:** mobilen Monat lesbar machen: kurze Tageszahlen, klare Auswahl, vollständige erreichbare Tagesagenda und sichtbare Anzahl bei mehreren Events. Eventtitel/Zeiten nicht nur abschneiden. Vorhandene Kalender-/Ressourcenlogik erhalten, keine neue Kalenderbibliothek oder Drag&Drop-Pflicht.

**Wichtige Aktivierungsgrenze vor einem Rollout von BKP002–BKP004:** Auto-Updater und Worker können neue Semantik automatisch starten und echte Rückstände übernehmen. Prüfe vor Veröffentlichung die Image-/Updater-Trigger und sichere eine ausdrückliche Aktivierungsgrenze. Ohne diese Absicherung keine ausrollbare Version veröffentlichen, die reale Rückstände ungeprüft konvertiert. Keine unbestätigte Übernahme echter Eingänge, kein automatischer Produktions-Cutover, kein paralleles manuelles Update. Eine echte betriebliche Änderung nicht allein aus diesem Übergabeprompt ableiten. Falls ein Betreiberentscheid fehlt, konkret dokumentieren und die unabhängigen UI-Slices weiterbearbeiten. Dauerhaften Gateway-Empfang nicht unnötig stoppen.

Beende diese Arbeitswelle, wenn die priorisierten Verbesserungen implementiert, geprüft, reviewed und gepusht sind oder wenn nach Fortschritt an unabhängigen Aufgaben ein echter verbleibender Blocker besteht. **BKP009–BKP030 nicht automatisch anschließen.** Ein verbleibender Rollout-/Referenzblocker darf nicht als erledigte Funktion markiert werden.

## Design und Skills

Nutze **Impeccable** für Bedienbarkeit, Hierarchie, Vereinfachung, responsive Zustände und den nach aktuellem Skill vorgeschriebenen Finishreview/Dokumentationsabschluss. Nutze **Taste** nur dort, wo die aktuelle Fassung zur Oberfläche passt; Taste v2 schließt Admin-Dashboards aus. Orientiere dich an beobachteten Bookitup-Prinzipien bei Layout, Abständen, Typografie, Farben und Komponenten. Bei Konflikten haben Verständlichkeit, Barrierefreiheit und konsistente Bedienung Vorrang. Keine zusätzliche Dekoration oder unnötigen Einstellungen. Bei Politur **emil-design-eng**, bei tatsächlicher Animation **animate** passend einsetzen; Tastatur und reduzierte Bewegung berücksichtigen.

Nutze **Ponytail full** für die kleinste vollständige Lösung. Vorhandene Komponenten, Helfer und Projektkonventionen verwenden. Keine vorsorglichen Abstraktionen, unnötigen Dependencies oder fachfremden Änderungen. Sicherheit, Validierung, Fehlerbehandlung, Zugänglichkeit und erforderliche Tests niemals als Vereinfachung streichen.

Skillpfade auf bisherigem Mac unter `~/.codex/skills/`: `ponytail/SKILL.md`, `impeccable/SKILL.md`, `taste-skill/SKILL.md`, `emil-design-eng/SKILL.md`, `animate/SKILL.md`, `reverse-engineer-anything/SKILL.md`. Vor Anwendung aktuelle Dateien lesen; falls Pfad nicht existiert, Skill suchen/Verfügbarkeit ehrlich klären. Dokumentation installiert keine Skills.

## Beweis- und Datenschutzgrenzen

REA wurde aus https://github.com/morluto/rea/tree/main installiert (Skill v45, damalige npm-CLI 6.7.0), aber es gab **keinen erfolgreichen REA-Runtimecapture**. MCP war nicht verfügbar/Registrierung abweichend, Chrome ohne bekannten CDP-Endpunkt. Browserbelege kamen aus AX/DOM/Screenshots, AK-Verträge aus Source. Keine angebliche Decompilation oder vollständige Netzwerkabdeckung behaupten. Für neue Referenzbeweise aktuellen REA-Skill und echte Werkzeugverfügbarkeit prüfen; keine Chrome-Neustarts/Debugfreigaben/Configreparatur ohne die dafür nötige konkrete Autorisierung.

Bookitups Ressourcenanlage war Trial-gesperrt. Der genaue Bookitup-Mobilkalender blieb ungeprüft; einige privat gespeicherte Bilder heißen „mobile“, sind aber Desktop. Das steht detailliert in observations.md. Viewportmaße messen, nicht aus Dateinamen ableiten. Vollständige Funktionsgleichheit nicht behaupten, solange Bereiche unbekannt bleiben. Vorhandenes Ressourcenmodell/DB-Konfliktschutz niemals anhand unbekannter Referenz schwächen.

Bookitup/echte AK-Installation nur lesend untersuchen: nichts speichern, löschen, senden, freigeben oder Trial aktivieren. Keine echten Mails zum Test öffnen, falls dadurch Status verändert wird. Keine echten Buchungen, Inhaberpasswörter, Kundenkontakte oder Produktionsdaten verändern. Tests ausschließlich in isolierter Umgebung mit ausdrücklich fiktiven Daten. Private Rohbilder/Exporte/Backups/Secrets weder nach Git noch in Modellprompts, Uploads, Logs oder CI-Artefakte kopieren. Das Repository ist öffentlich.

## Tests, Git und Abschluss

Tests zuerst gemäß AGENTS. Layout in echtem Browser bei Desktop/Mobil prüfen, mindestens 320/390/768/1280 oder 1440, beide Themes, Tastatur/Fokus, 200-%-Zoom, relevante Lade-/Leer-/Fehlerzustände. Renderbreite beweist keine Touchgeste. Daten-/APIänderungen mit Tenant-/Auth-/CSRF-/Versions-/Retry-/Negativfällen in disposable PostgreSQL prüfen; Migration und Tests im selben Commit. Exakte Geldrechnung, UTC plus Tenant-Zone und Reservierungsconstraints erhalten.

Führe die verfügbaren/applicablen Gates aus `package.json`/AGENTS tatsächlich aus: Format, Lint, Typen, Unit, betroffene Integration/Komponenten/E2E, Build, Coverage gemäß Projektregeln, Dokumentationsprüfung; bei Meilenstein volle Suite. Keine grünen Ergebnisse erfinden oder Tests zur Anpassung an falsches Verhalten abschwächen.

Nur explizite Anwendungspfade stagen, niemals `git add .`, `git add -A`, `git add -f` oder Gitignore verbreitern. Vor jedem Commit `git diff --cached --name-status` und vollständigen `git diff --cached` prüfen. Pro abgeschlossenem Slice fokussierter Conventional Commit und sofortiger Push, sofern die beschriebene Aktivierungsgrenze gewahrt ist. Keine Force-Pushes/Amends gepushter Commits. Pushblocker exakt melden. CI und Remote-SHA prüfen, keinen Merge/Deploy behaupten, der nicht erfolgt ist.

Aktualisiere IMPLEMENTATION_PLAN, betroffene Fach-/Design-/API-Doku und datierte Übergabe mit tatsächlichem Stand. Berichte am Ende knapp: umgesetzt, geprüfte Tests/Browserzustände, Commit-SHAs/Branch/CI, relevante offene Punkte/Entscheidungen. Keine vollständige Parität behaupten. Starte jetzt mit Standprüfung, notwendiger Skill-Lektüre und dem fehlschlagenden BKP001-Test.
