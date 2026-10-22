# Ausführungsanleitung für Folgeagenten

Diese Anleitung richtet sich ausdrücklich auch an kleinere Modelle. Sie gibt keine Erlaubnis, mehrere Tickets gleichzeitig oder auf echten Kundendaten auszuprobieren. Einstieg: [README](README.md), [Beobachtungen](observations.md), [Zielvertrag](design-contract.md).

## Vor jedem Ticket

1. `pwd`, `git status --short`, `git branch --show-current`, `git log -5 --oneline`, Remote prüfen. Diese Analyse basiert auf cf68f1e. Wenn der aktuelle Stand neuer ist, die genannten Stellen neu lesen; nie alten Source über neuere Änderungen kopieren.
2. Vollständig `AGENTS.md` und `docs/handoff.md` lesen; relevante Lastenheft-Anforderungen und Ticketabhängigkeiten prüfen. Nummer des aktiven Slices im Implementierungsplan festhalten. Ein BKP-Paket ohne begrenzte Akzeptanzfälle wird zuerst konkretisiert, nicht blind gebaut.
3. Skills lokalisieren und lesen: **Ponytail full** für Code/Review, **Impeccable** für jede UI-Arbeit mit aktuellem Workflow/Finishreview, **emil-design-eng** für Politur; **animate** bei echter Bewegungsimplementierung. **Taste v2** gilt für öffentliche unterstützte Seiten, nicht für Admin-Dashboards. **REA** für weitere Referenz-/Runtime-Untersuchung, nicht für gewöhnliche vollständige Source-Repos. Die Nennung im Repo installiert keine Skills.
4. Lokale Skillpfade auf dem bisherigen Rechner: `~/.codex/skills/ponytail/SKILL.md`, `impeccable/SKILL.md`, `emil-design-eng/SKILL.md`, `animate/SKILL.md`, `taste-skill/SKILL.md`, `reverse-engineer-anything/SKILL.md`. Quellen: [Ponytail](https://github.com/DietrichGebert/ponytail), [Impeccable](https://github.com/pbakaus/impeccable), [REA](https://github.com/morluto/rea/tree/main). Fehlenden Pflichtskill melden/auflösen, nicht Nutzung behaupten. Skills können sich ändern; aktuelle Version lesen.
5. Referenz-UIs nur lesend untersuchen, solange keine andere ausdrückliche Freigabe besteht. Nie Speichern/Senden/Löschen/Trial/Freigabe bestätigen. Formulare können Autosave haben: keine echten Werte zum „Testen“ eingeben. Keine echte Mail öffnen, wenn dadurch Bearbeitungs-/Lesestatus geändert wird. Alle Rohbelege privat.

## Genau ein vollständiger Slice

1. Mit `rg` alle Aufrufer, gemeinsamen Helfer, Typen, API-Schemas, Tests und Konfigurationen der Änderung suchen. Die Pfade im Ticket sind Startpunkte, keine vollständige Stagingliste.
2. Zuerst einen sinnvollen fehlschlagenden Test schreiben. Für Layoutfehler ein echter Chromium-Geometrietest; JSDOM oder CSS-Stringvergleich beweist keine Ausrichtung. Für Domainänderung Persistenz-/Tenant-/Retrytest in PostgreSQL. Rot tatsächlich beobachten und den konkreten Grund festhalten.
3. Kleinste vollständige Korrektur implementieren. Vorhandene Komponenten/Helfer verwenden, keine zweite Import-/Reservierungs-/Zeit-/Geldrechnung und keine neue Bibliothek ohne konkreten Bedarf.
4. Alle Zustände aus dem Zielvertrag prüfen. Source-Verlagerung darf Dirty-Schutz, Fehlerrückmeldung, Doppelgesten-Schutz, Versionsprüfung, URLs und Autorisierung nicht verlieren.
5. Neue Tabellen mit `tenant_id`; Auth/CSRF/Schema auf Server; gepushte Migrationen niemals editieren. Geld exakt. Endgültige Dokumente/versandte Nachrichten unveränderbar. Neue externe Wirkung nur über dauerhaft idempotente Jobs/Outbox.
6. Fast Gates und betroffene DB-/API-/Komponenten-/E2E-Tests ausführen. Bei Meilenstein volle Suite. Maßgebliche Befehle stehen in AGENTS und `package.json`; keinen grünen Komplettlauf behaupten, wenn nur ein Test lief. Coverage-Gates und kritische Negativbranches einhalten. Kein Produktionsserver als Testdatenbank.
7. Frontend im gebauten Bundle mit fiktiven Daten bei 320/390/768/1280 oder 1440, beiden Themes, Tastatur, Fokus und Zoom prüfen. Impeccable-Workflow vollständig abschließen; fehlenden Reviewtyp/Overlay/Detektor ehrlich vermerken. `design-taste-frontend` nicht als Vorwand für eine neue Marketingästhetik verwenden.
8. Planstatus und betroffene Fach-/Design-/API-/Betriebsdoku aktualisieren. Aufgaben in diesem Paket nur dann auf fertig setzen, wenn ihre vollständige Abnahme erfüllt ist. Teilfortschritte mit Unter-Slice dokumentieren.
9. Nur explizite Anwendungspfade stagen. `git diff --cached --name-status` **und** `git diff --cached` vollständig lesen. Niemals `git add .`, `-A`, `-f` oder Gitignore verbreitern. Keine Namen/Adressen/Mails/Angebotsdaten/Rohbilder/Secrets aus Bookitup oder Testbetrieb in Git.
10. Ein fokussierter Conventional Commit; sofort `git push` zum passenden `codex/...`-Branch, Remote-Readback/CI prüfen. Pushfehler exakt melden. Nicht automatisch mergen, echte Daten importieren oder deployen. Deployment nur nach gültiger Autorisierung, grünen Images und verifiziertem Checkpoint gemäß Betriebsdoku.

## Kopierbarer Arbeitsauftrag

> Bearbeite ausschließlich BKP___ beziehungsweise den dazu aktivierten Unter-Slice in IMPLEMENTATION_PLAN.md. Lies AGENTS, handoff, den Paritäts-Einstieg, Beobachtungen, Zielvertrag und das vollständige Ticket. Prüfe aktuellen Git-/Quell-/Laufzeitstand und Abhängigkeiten. Nutze Ponytail full und bei UI Impeccable samt Finishreview, bei Bedarf Emil/animate; REA nur für passende Referenzbeweise. Nenne vor Änderungen den konkreten Test, der heute fehlschlägt. Implementiere das kleinste vollständige Verhalten, einschließlich Fehler-, Tenant-, Versions-, Retry- und Fokusfällen. Keine anderen Module anfangen. Teste, aktualisiere die betroffene Doku, prüfe den gesamten explizit gestagten Diff, committe und pushe sofort. Berichte Hash, Branch, tatsächlich gelaufene Tests und offene Grenzen. Keine echten Kundendaten oder Zugangsdaten ins Repo, keine echten Mails/Buchungen verändern.

## Wann nicht raten

- Sichtbarer Knopf beweist keine Backendfunktion. Ein noch nicht einsehbarer Ressourceneditor wird als unbekannt notiert; keinen komplexen Set-/Case-Algorithmus erfinden.
- Der Benutzer will Funktionsparität, nicht automatische Übernahme aller Bookitup-Bugs. Finale Belege, Reservierungen und personenbezogene Daten bleiben geschützt.
- Kontakte ohne Land nicht als angeblich vollständige Stammdaten erzeugen. Ein Event darf ohne Kontakt existieren. Vorbelegung DE ist erlaubt, jedoch keine Berechtigung, bekannte fremde Länder zu überschreiben.
- `mail sent`, „zugestellt“, Rechnung „bezahlt“, „angenommen“ oder Ressource „gebucht“ benötigen unterschiedliche fachliche Nachweise. Nicht aus PDF-Erzeugung oder SMTP-Antwort ableiten.
- Große Pakete BKP019–BKP029 vor Implementierung in kleine vertikale Slices konkretisieren. Nicht zwischen Backend und notwendiger UI/Tests eine kaputte Zwischenversion veröffentlichen.
- Bei fachlich unbekannter Verknüpfung oder externer Wirkung Entscheidung festhalten und gezielt fragen; unabhängige bereits autorisierte Arbeit fortführen. Keine leere Beschäftigung zum Kontingentverbrauch.

## Übergabe nach einem Slice

Statusfeld: Ticket/Unter-Slice; Basis-SHA → neuer SHA; gepushter Branch; betroffene Pfade; vorher/nachher; Tests mit Ergebnis; aktueller CI-Status; Deployment nur wenn wirklich geprüft; bekannte Restlücken; nächstes abhängiges Ticket. Keine Passwörter oder privaten Dateiinhalte. Datiert schreiben – eine alte grüne CI ist kein Beweis für einen neuen Commit.
