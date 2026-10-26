# Hermes-Goal: Bookitup durch AuftragsKompass ersetzen

Stand: 26.10.2026. Dies ist der aktuelle, ausdrücklich autorisierte Folgeauftrag.
Frühere Hermes-Goals vom 22.–24.10. und ihre alten Einstiegstickets nicht wiederholen.
Die menschliche Anweisung lautet: mit REA, Impeccable, Taste und Ponytail Bookitup
in Optik, UX, Bedienlogik und Funktionen möglichst genau nachbauen, damit es
vollständig ersetzt werden kann. Vorsichtige Vereinfachungen sind erlaubt,
zusätzliche Komplexität und bloße Attrappen nicht.

## 1. Jetzt handeln, auf dem aktuellen Stand

Arbeitscheckout: /Users/gp/Developer/GitHub/auftragskompass-bkp
Repository: https://github.com/gcode-de/auftragskompass
Arbeitsbranch: codex/ux-event-simplification

Funktionsbasis:45add395a201a98e179a4d8fc54c0a2d279714d5 (BKP015.8), sofort gepusht.
Davor24ea155a8cb62224f2872cd32814205a70c76f78 (BKP015.7). H055 ergänzt
den aktuellen Übergabeprompt als eigenen Dokumentationscommit; dessen tatsächlichen
HEAD/CI zuerst prüfen. Neue CI/Images noch nicht grün bestätigt.

Vor einem weiteren Implementierungspush zuerst grüne quality+images des neuesten
übergebenen Stands abwarten, damit der laufende Build nicht ständig durch neue
Pushes abgebrochen wird. Inzwischen DeepSeek rein lesend mit Ressourcen-Source/
Tests/Referenzvergleich beauftragen und einen eng begrenzten Slice vorbereiten.
Danach alleinigen Auto-Updater und Checkpoint-/OCI-Nachweis prüfen; keine
parallele manuelle Aktualisierung. Fehlgeschlagene CI zuerst gezielt korrigieren.

Führe zuerst pwd, git status --short, git branch --show-current, git remote -v
und git log -8 --oneline aus. Arbeitsverzeichnis ausdrücklich setzen. Keine
fremden Änderungen löschen, alten Checkout umschalten oder unvollständige
Arbeit überschreiben. Codex übergibt nach eigenem Abschluss; kein zweiter
schreibender Koordinator soll gleichzeitig an diesem Checkout arbeiten.

Lies AGENTS.md vollständig. Lies in docs/handoff.md die neuesten Abschnitte,
Benutzerentscheidungen, Skill- und Betriebsregeln; historische Statusberichte
nur gezielt für das betroffene Thema, nicht als heutigen Stand. Danach den
aktuellen Einstieg und gewählten Slice in IMPLEMENTATION_PLAN.md vollständig,
den betroffenen Lastenheftabschnitt,
docs/bookitup-parity/README.md, observations.md, design-contract.md,
agent-playbook.md und die vollständigen gewählten Tickets. Alte Datumsabschnitte
und Ticketbeschreibungen können noch frühere Fehlstände schildern. Vor jeder
Implementierung tatsächlichen Source und Tests gegenprüfen.

Beginne nach dieser Standprüfung mit dem ersten noch fehlenden kleinen
Unter-Slice der unten beschriebenen Welle. Nicht erneut nur einen Audit oder
einen Plan liefern. Ein Goal darf nicht als erledigt gelten, weil ein Prompt
gelesen oder eine Unteraufgabe delegiert wurde.

## 2. Zusammenarbeit und Modellwahl

MiMo V2.6 Pro koordiniert Untersuchung, Priorisierung, Integration und
abschließendes Review. DeepSeek V4.1 Flash arbeitet als Coding-Subagent.
Die Modelle waren in der Hermes-Modellauswahl sichtbar; tatsächlich verfügbare
Delegationswerkzeuge und Modellkennungen prüfen, nicht erfinden.

Verwende bei jedem Coding-Delegat ausdrücklich das konfigurierte DeepSeek-Modell.
Gib beim ersten Delegat die tatsächlich verwendete Modellkennung und den
klar abgegrenzten Auftrag an; anschließend Ergebnisse/Toolnachweise prüfen.
Keine Behauptung einer Delegation, die nicht stattgefunden hat. Kein Wechsel
auf kostenpflichtige OpenAI-Zusatzcredits, keine Provider-/Credentialänderung
und kein Umgehen einer Kapazitätsgrenze. Bei fehlender MiMo-/DeepSeek-Kapazität
genauen Blocker und fertigen Übergabestand sichern.

Genau ein nummerierter Slice gleichzeitig. Kleine klar abgegrenzte Lese- oder
Test-/Reviewaufgaben können parallel laufen; jede schreibbare Datei hat genau
einen Besitzer. Insbesondere styles.css, Plan/Handoff, gemeinsame Tests und
große Panels niemals gleichzeitig von zwei Agenten ändern lassen.

Jeder Subagent-Auftrag enthält: Ticket/Unter-Slice, Basis-SHA, erlaubte
Schreibdateien, benötigte Lesepfade, präzises Soll, Nicht-Scope, zuerst
fehlschlagenden Test, relevante negative Fälle, Gate-Befehle und Rückgabeformat.
MiMo verwaltet Plan/Übergabe, prüft die vollständigen Diffs und integriert.
Unabhängiges Review vor finalen großen Testläufen; erst alle konkreten
Reviewkorrekturen bündeln, dann den eingefrorenen Stand abschließend testen.
Nicht nach jeder Miniänderung die gesamte Suite erneut laufen lassen.

## 3. Verifizierte Ausgangsfunktionen nicht erneut bauen

Bereits vorhanden (aktuellen Source dennoch bestätigen):
- Bookitup-nahe Eventliste mit Datumsspalte, kontextuellen Desktopfiltern und
  mobilem Filterdialog; Monatskalender mit korrekt ausgerichteten Wochentagen,
  kurzer Tagesdarstellung und Tagesagenda. Mobile Gesten/echter Gerätezoom
  sind dadurch nicht pauschal geprüft.
- Eventakte mit getrennten Arbeitsbereichen. Website-Optionen können fachlich
  ohne Kontakt/Land entstehen; produktive automatische Übernahme bleibt durch
  AK_INQUIRY_OPTION_DRAIN gesperrt. Diese Einstellung nicht aktivieren.
- Ruhige neutrale Themes, Hell/Dunkel, mobiles Menü und kompaktere Navigation.
- Angebotsentwürfe mit eigenen Text-/Positionssnapshots, exakter Geldrechnung,
  Produktübernahme, PDF-Vorschau und bewusster Finalisierung; Blankoangebot ist
  möglich. Nicht alle anderen Rechnungsarten oder Mailmodule daraus ableiten.
- Dokumentlayout bearbeiten/vorher ansehen, Logo sicher hochladen.
- Dokumentvorlagen als nach Art gruppierte Liste mit Editor nur auf Aufruf,
  Produktpreisbasis-Konvertierung, verlässlichem Speicher-/Archivabgleich.
  Anlage mit dauerhaftem UUID-Auftragsbeleg auf dem Server; gleicher
  eingefrorener Auftrag kann sicher wiederholt werden. UI-Wiederherstellung
  bleibt auf das gemountete Panel begrenzt: keine Reload-/Tab-Persistenz
  behaupten. PUT bleibt versionsgesichert, keine stille Versionsübernahme.
- BKP015.7: Bearbeiten direkt, Duplizieren/Archivieren hinter einer benannten
  nativen Offenlegung pro Zeile, höchstens eine offen. Escape/Tab/Outside und
  sichtbares Fokusrückkehrziel, Archivabgleich sperrt weitere Änderungen.

BKP015.8 ist implementiert und gepusht: fiktive Inhaltsvorschau des
ungespeicherten Vorlagenentwurfs, strikter POST /api/v1/document-templates/preview,
keine fachlichen Writes/Nummern/Dateien, gleiche echte HTML-/PDF-Renderpipeline.
Neutraler fiktiver Absender ohne Logo, feste Beispielwerte/Datum, alle8Tokens,
exakte Positionssummen. UI prüft MIME/%PDF-/10MiB, bewusster Download mit44px-Ziel,
Entwurfsänderung/Schließen/Unmount verwerfen alte Antworten/Blob-URLs.
Lokal:1126 Tests/Coverage,74 Panelkomponenten, zwölf Vorlagen-Chromiumabläufe
plus echter angemeldeter lokaler API-/PostgreSQL-/Chromium-PDF-Lauf. Schnelle
Gates/Build, unabhängige Luna-Reviews, Impeccable-Paneldetektor und visuelle
PDF-/320/1280-Themeprüfung grün. Changedcoverage117/122 Zeilen,102/117Branches.
API-Integration injiziert PDF-Bytes und beweist HTML/Auth/NoWrites; der zusätzliche
document-layout.spec.ts-Lauf beweist den tatsächlichen Chromium-PDF-Weg.
CI40251062521 war nach dem Funktionspush noch pending; H055 erzeugt eine neue
maßgebliche CI. Funktionsstand nicht schon als live behaupten.
Zuletzt verifiziert live:c21330c6967e2edb4da2607769f85f40a198c6cf, drei gesund,
Checkpoint CT/Host/Betreiber identisch (Details aktueller docs/handoff.md).

Zusatzanforderungen bei Vorlagen bleiben gesondert offen:
Suche/Art-/Archivfilter und verständlich auswählbare Platzhalter-Einfügewerkzeuge.
Auf B35s konkret untersuchter Bookitup-Desktopansicht waren keine Filter sichtbar;
sie nicht als belegte identische Referenzfunktion bezeichnen.

## 4. Nächste priorisierte Welle: Ressourcen, Produkte, Kontakte

Zuerst die tatsächlichen Lücken in BKP009–BKP012 mit Source/Tests bestätigen.
Pro Thema kleinsten vollständigen nummerierten Unter-Slice im Plan aktivieren,
Tests zuerst und danach einzeln implementieren/pushen. Keine vier Großtickets
in einem Sammelcommit. Die folgenden Dateizuständigkeiten sind Startvorschläge;
vor Vergabe prüfen und explizit festlegen.

### BKP009: Ressourcenverwaltung, Liste zuerst

Lesen: apps/admin/src/ResourcePanel.tsx, ResourceBlocks.tsx, MasterDataPanel.tsx,
packages/core/src/resources.ts, passende Ressourcen-/Sperr-Komponenten- und
Integrationstests, relevante Lastenheft-RE-Regeln und Ticket BKP009 vollständig.

Erster Coding-Auftrag: ausschließlich Ressourcenoberfläche und eigene
Komponententests; gemeinsame styles.css nur demselben UI-Besitzer geben,
falls bestehende Klassen nicht reichen. MiMo besitzt Plan/DESIGN/Handoff.
Ein zweiter Agent darf E2E in einer gesonderten Ressourcendatei übernehmen.

Zuerst normale Bestandsliste mit kompakter Suche/Archiv-/Kategorieauswahl; Anlage und
Bearbeiten bewusst öffnen, seltene Sperrverwaltung gezielt öffnen. Liste und
vorhandene Sperrübersicht müssen weiterhin erreichbar sein. Historische Zuweisungen
und blockierte Zustände erhalten. Sperrverwaltung nur dann in denselben ersten
Unter-Slice aufnehmen, wenn Source und Abnahme das ohne Scopewachstum tragen;
sonst danach eigenständig planen. Editor nicht im
Tabpfad, bevor er geöffnet wurde. Richtige Unterscheidung: kein Bestand vs.
keine Treffer. Aktuelle Filter beim Editieren/Zurückkehren erhalten.

Unverändert: Name/Code/Kategorie/Beschreibung/Bestand/Puffer/Sortierung/Zustand,
Versionsprüfung, Defaultbestand1 und Puffer2/2 sowie physische Einheiten und
Datenbank-Reservierungsschutz. Keine neuen Sets, Bedarfsautomatik oder
Kategorie-/Einheitenmigration. Bookitup-Anlage ist Trial-gesperrt (B26–B28);
den unbekannten Editor nicht als nachgebaut behaupten.

Abnahme: RED für initial verborgenes Formular; Anlegen/Bearbeiten/Abbruch,
Dirtyschutz, Fehler/409, bewusster Reload, Fokus hin/zurück, Doppelklick,
aktive/inaktive/archivierte Einträge, 320/390/1280px und beide Themes.
Sperrzeit-/DST- und Überschneidungstests erhalten; keine realen Sperren anlegen.

### BKP010: Produkte kompakt verwalten

Nach abgeschlossenem BKP009, eigener Slice. Lesen ProductPanel.tsx,
packages/core/src/products.ts, apps/admin/src/decimal.ts, Template-/Angebots-
Produktübernahme und vorhandene Produkttests. UI-Code und zugehörige
Komponententests ein Besitzer, E2E getrennt; kein zweiter styles.css-Besitzer.

Liste zuerst, Anlegen/Bearbeiten/Duplizieren bewusst öffnen; vorhandene Suche,
Zustand und Sortierung erhalten, seltene Aktionen zurücknehmen. Preisbasis
netto/brutto klar anzeigen. Deutscher Dezimaltext über vorhandene exakte Helfer,
kein parseFloat*100 und keine Floats in fachlicher Geldrechnung.
Dokumentänderungen dürfen den Produktstamm nie ändern.

Abnahme: Such-/Filterzustand bleibt, 0/19Prozent und0/maximal sicherer Betrag,
ungültige Dezimalwerte, eigene Kopie statt Überschreiben, Versionskonflikt,
Archivierung ohne historische Dokumentänderung. Bestätigtes Speichern darf
nicht wegen anschließendem GET-Fehler als fehlgeschlagen gelten; kein blinder
erneuter POST nach unklarem Ausgang. Falls dafür ein Backend-Auftragsbeleg
nötig wird, gesonderten nummerierten vertikalen Slice planen, keinen Frontend-Ref
als dauerhafte Idempotenz ausgeben. Bestehende Muster gezielt wiederverwenden,
kein generisches Mutationsframework.

### BKP011: Lesende Kontaktdetails und zugehörige Events

Nach Ressourcen/Produkten. Lesen ContactPanel.tsx, contacts.ts, events.ts,
URL-/Such-/Dirty-Helfer und BKP011. Erst kleinster lesender Detail-Slice:
Kontaktname führt zur normalen Detailansicht; eigene Editieraktion, Zurück mit
Suche/Scroll, vorhandene Route #contact-<id> kompatibel. Name/Firma/Ansprechpartner,
vorhandene Anschrift, Mail/Telefon und bekannte Events; fehlende Werte ehrlich.
Keine funktionslosen Mail-/Datei-Tabs.

Bei API-Erweiterung: tenantgesicherte vorhandene Projektion verwenden, keine
alle-Kunden-Abfrage im Browser, keine N+1-Ereignisanfragen. Datenmodell nicht
für unbekannte Geburtstags-/Gruppen-/Partnerfelder erweitern. Keine Namen an
Leerzeichen zerlegen und keine automatische Dublettenzusammenführung.

Abnahme: kein/mehrere Events, Firma/Ansprechpartner, archiviert, fremder Tenant,
lange fiktive Werte, fehlende Anschrift, Back/Reload/Dirty/409 und korrekt
escaped mailto/tel. Kontaktland bleibt gespeicherter ISO-Code mit verständlicher
Anzeige; keine bestehenden Länder ändern.

### BKP012: Kontakt im Event wählen oder bewusst anlegen

Nach Kontaktgrundlagen, eigener Slice. Lesen EventCreateDialog.tsx,
EventPanel.tsx, ContactPanel.tsx und vorhandene Kontaktsuche. Suchbarer Picker
gemäß B30, bewusste Inline-Anlage über bestehenden Kontaktvalidator. Evententwurf
mit Datum/Art/Angaben bleibt erhalten. Erst tatsächlich bestätigten gespeicherten
Kontakt auswählen; Event nicht heimlich miterstellen. Kontaktlos bleibt erlaubt.
Historische archivierte Zuordnung lesbar, nicht als neue Auswahl anbieten.

Abnahme: vertauschte langsame Suchantworten, kein Treffer, abgebrochene Anlage,
Kontakt-POST-Fehler, bestätigter Kontakt mit GET-Fehler, keine Doppelanlage,
Fokus/Dirty/Zurück. Keine unkontrollierten verschachtelten Dialoge; wenn nötig
eine kontrollierte Dialogebene wechseln und den Evententwurf separat erhalten.

## 5. Danach gesamtes Ersatz-Ziel fortsetzen

Die vollständigen Tickets BKP013–BKP030 sind der fachliche Paritätsbacklog;
umgesetzte Unter-Slices nicht erneut bauen und Gesamt-Tickets nicht pauschal
abhaken. Nach obiger Welle aktuellen Plan und tatsächliche Referenz neu prüfen,
dann genau einen nächsten sinnvollen Unter-Slice aktivieren:
Vorlagenrest, Dateien, kommerzielle Dokumentabläufe, dauerhafter Mailkern,
Postfach/Verfassen/Vorlagen/geplanter Versand, Aufgaben/Verträge/Fragebögen,
editierbare/mehrere Websiteformulare und abschließende Paritätsabnahme.

Keine leeren Tabs oder vorgetäuschten Sendeknöpfe als Umsetzung zählen.
Mailarchitektur und externe Sideeffects benötigen die bestehenden Outbox-/
Job-/Idempotenzgrenzen; echte Versand-, Nummern-, Steuer-, Import- und
Produktiventscheidungen nicht erfinden. Ohne erforderliche Betreiberentscheidung
unabhängige sinnvolle Arbeit fortführen, echten Blocker dokumentieren.
Das Ziel endet erst bei überprüfbaren priorisierten Ergebnissen oder nach
Fortschritt an unabhängigen Aufgaben bei einem tatsächlich verbleibenden Blocker.
Keine vollständige Funktionsgleichheit behaupten, solange Bereiche unbelegt sind.

## 6. Design, Skills und Referenzbeweise

Vor Anwendung aktuelle SKILL.md lesen:
- /Users/gp/.codex/skills/ponytail/SKILL.md: full, kleinste vollständige Lösung.
- /Users/gp/.codex/skills/impeccable/SKILL.md: Operate, incumbent DESIGN.md erhalten,
  passenden Workflow/Craft-Floor, Browser und Finishreview/Dokumentation.
- /Users/gp/.codex/skills/reverse-engineer-anything/SKILL.md: REA für tatsächlich
  belegte Referenzuntersuchung, keine erfundene Capture-/Decompilation-Evidence.
- /Users/gp/.codex/skills/taste-skill/SKILL.md: Tastev2 schließt Adminscreens aus;
  nur innerhalb des tatsächlichen Geltungsbereichs, etwa öffentliche Formulare.
- emil-design-eng/SKILL.md bei passender UI-Politur, animate/SKILL.md nur bei
  echter begründeter Animation. Keine dekorative neue Bewegung.

Dokumentation installiert keine Skills. Bei fehlender Fähigkeit konkret melden.
Impeccable-Kontext nur einmal pro echter neuer Session laden, dessen aktuellen
Anweisungen folgen; aus dem Codex-Vorlauf nicht behaupten, Hermes habe es selbst
geladen. Keine Sidecar-/Konfigurationsreparatur als Nebenwirkung.

apps/admin/DESIGN.md ist die aktuelle Designwelt. Bookitup-Prinzipien:
an den Aufgaben orientierte Bereiche, präzise Ausrichtung, ruhige Menüs,
progressive Offenlegung, kompakte sichtbare Kontrollen mit ausreichenden
Touchflächen. Hell/Dunkel, neutrale Flächen, dezentes Grün erhalten. Kein
Marketing-Redesign, keine neue Schrift-/Karten-/Gradientenwelt. Tastatur,
Barrierefreiheit und verständliche Zustände haben Vorrang.

Beleglage: observations.md und Referenzinventar unterscheiden Beobachtung,
Sourcebefund, Nutzerwunsch und Unbekanntes. B35: Dokumentvorlagen gruppiert,
ruhige Aktionen, kein sichtbarer Filter in dieser Desktopansicht. Kein neuer
REA-MCP-/CLI-Capture im Codex-Vorlauf gelungen; Browser-AX/Screenshots waren die
Belege. Aktuelle Werkzeugverfügbarkeit prüfen. Keine Chrome-Neustarts, neuen
Debugfreigaben oder Sicherheitsreparaturen dafür aus diesem Goal ableiten.
Bookitup nur lesend: nichts speichern/löschen/senden/Trial aktivieren; keine
unread Mail öffnen, wenn das deren Status verändert. Unbekanntes ehrlich markieren.

## 7. Tests, Git, Betrieb und Datenschutz

Node24.15.0 ist lokal verfügbar; Standard-Shell-Node23 ist ungeeignet.
Befehle mit pnpm --use-node-version=24.15.0 ausführen. Lockfile/pnpm10.2.0 erhalten.
Docker-PostgreSQL und Chromium sind vorhanden; keine fremden Container oder
den Docker-Dienst pauschal neu starten.

Pro Slice zuerst tatsächlich fehlender Verhaltenstest. Schnelle Gates:
format:check, lint, typecheck, test:workspace, test:docs; betroffene Unit-,
Komponenten-, Integrations- und E2E-Prüfungen, build und erforderliche Coverage.
test:coverage umfasst alle Unit-/Komponenten-/Integrationstests. Keine parallelen
Coverage-Schreiber, Adminbuilds oder E2E-Server auf demselben dist.
Abschließend Feature-/Fehler-/Leer-/Lade-/Disabled-/Langtextzustände,
320/390/768/1280 oder1440px, beide Themes, Tastatur/Fokus und axe prüfen.
Headless-Breitenersatz nicht als echter200Prozent-Gerätezoom/Touchgeste ausgeben.

Coveragegrenzen aus AGENTS erfüllen, kritische Regeln explizit testen.
Keine Skips/Toleranzvergrößerung/Timeoutverlängerung, um falsches Verhalten
grün zu färben. Ein verspätetes sichtbares Ziel awaiten statt leere Region als
geladen anzusehen. Browser-API-Stubs beweisen UI, keine echte Servermutation;
gegen live ausgelieferte Assets nur lokale fiktive Geschäfts-APIs verwenden.

Pro abgeschlossenem Slice exakt zugehörige Pfade stagen; nie git add .,
git add -A/-f oder Ignore-Regeln erweitern. Vor jedem Commit vollständige
cached Dateiliste und cached Diff lesen (trunkierten Rest nachlesen).
Conventional Commit und sofortiger Push. Keine Force-Pushes/Amends
veröffentlichter Commits. GitHub-Fehler konkret melden. main nicht ungeprüft ändern.

Nur komplett grüne quality+images dürfen durch den bestehenden alleinigen
Auto-Updater in den Testbetrieb. Kein paralleles manuelles Update. Checkpoint
muss App-Dienste pausieren, Dump verifizieren und CT/Host/Betreiberkopie mit
gleichem Hash sichern. Danach drei gesunde gleiche OCI-Revisionen prüfen.
Bei Checkpointfehler stoppen; nach Migration nie alte App automatisch gegen
neues Schema starten. CI-Erfolg, Registry-Image und tatsächlich laufende Version
sind verschiedene Nachweise. Details docs/automatic-updates.md und private
Betreiberanleitung; keine Secrets in diesen Prompt kopieren.

Keine echten Kunden-/Auftragsimporte, automatische Website-Rückstandsübernahme,
Buchungen, Mails, Kündigung, Inhaberpasswortänderung oder Produktions-Cutover.
Reale Daten, Originalbilder/Exporte, Credentials und Backups bleiben außerhalb
des öffentlichen Git und außerhalb Modellprompts/CI-Artefakten. Fiktive Fixtures
müssen sichtbar erfunden sein. Keine zusätzlichen OpenAI-Credits verwenden.

Aktualisiere Plan, relevante Fach-/Design-Dokumentation und datierten Handoff
mit tatsächlichem Stand. Abschluss knapp: gelieferte Slices/Hashes/Branch,
konkrete Tests/Browsernachweise, CI vs. tatsächlich live, offene echte Entscheidungen.
Beginne jetzt mit Standprüfung und erstem DeepSeek-Auftrag im kleinsten
noch offenen Ressourcen-Slice; nicht nochmals BKP001–BKP008 abarbeiten.
