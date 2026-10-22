# Projektübergabe AuftragsKompass

Stand: **21.10.2026**, nach C051.3, H026, H029, H030, H031, H038, H039 (released) sowie H033 (umgesetzt, lokale Abnahme grün; Push/CI/Testbetrieb nach dem Commit). Einstieg für eine neue Arbeitssession und kompakter Funktionsüberblick. Dieses Dokument ersetzt weder den aktuellen Git-/CI-/Betriebsabgleich noch das Lastenheft. Bei Fortsetzung aktualisieren; keine alten Kontingentwerte oder Chat-Automationen ungeprüft wiederverwenden.

## In der nächsten Session zuerst

1. [AGENTS.md](../AGENTS.md) vollständig lesen; dann diese Übergabe, den relevanten Abschnitt des [Lastenhefts](../Lastenheft_Fotobox-Verwaltung_MVP.md) und den aktuellen Slice im [Implementierungsplan](../IMPLEMENTATION_PLAN.md).
2. `git status`, Branch, Remote und letzte Commits prüfen. Arbeitsbranch seit H022: `codex/ux-event-simplification` (Basis `codex/local-runtime-ci`), Remote: [gcode-de/auftragskompass](https://github.com/gcode-de/auftragskompass). Nicht automatisch zu `main` wechseln oder gepushte Commits umschreiben.
3. Angeforderte Skills unten lokalisieren und vor ihrer Anwendung lesen. Der bestehende Entwurf ist eine Verwaltungs-App, keine neue Marketingseite.
4. Für Betriebsarbeit zusätzlich die private Betreiberübergabe lesen: außerhalb Git unter `AuftragsKompass-Sicherung/uebergabe-2026-10-19/README.md` im Dokumente-Verzeichnis des bisherigen Betreiberrechners. Auf einem anderen Rechner ist sie nicht automatisch verfügbar. Keine Secrets in den Chat oder Git übernehmen.
5. Genau einen passenden nummerierten Slice auswählen beziehungsweise im Plan konkretisieren. Tests zuerst bei Verhaltensänderungen; erforderliche Gates, explizites Staging, vollständiger staged Review, ein Conventional Commit, sofortiger Push. Kein automatischer Produktivwechsel.

## Ziel und aktuelle Priorität

AuftragsKompass soll Bookitup für einen Fotobox-Betrieb ersetzen, zunächst lokal im Home Lab. Spätere andere Dienstleister bleiben strukturell möglich; kein vorgezogener SaaS-Ausbau. TypeScript, React/Vite, Fastify, PostgreSQL/Drizzle und ein PostgreSQL-basierter Worker; der öffentliche Gateway bleibt von der lokalen Administration getrennt.

Für den früheren Bookitup-Ausstieg gilt die [verkürzte Lieferfolge](bookitup-exit.md). M5/M6 sind bewusst verschoben; M3/M4 dürfen zunächst über geprüfte externe Prozesse ersetzt werden. Der Benutzer möchte das Website-Anfrageformular jetzt vorziehen und interessiert sich anschließend für Angebote/Rechnungen. Die Empfehlung aus der letzten Session lautet: **Website-Anfrageweg anschließen, danach Geschäftsdokumente angehen**. Das ist keine Freigabe eines ungeprüften Cutovers und kein Auftrag, alle verschobenen Module automatisch zu bauen.

## Funktionsstand auf hoher Ebene

„Umgesetzt“ bedeutet vorhandene, getestete Funktion im Testbetrieb, nicht vollständige Produktivabnahme oder echte Datenmigration.

| Bereich | Stand | Noch offen |
|---|---|---|
| Anmeldung und Oberfläche | Eigener Login mit E-Mail oder Benutzername und Passwort, Passwortwechsel und kontrollierte Betreiber-Wiederherstellung; mobile Navigation, einklappbare Desktop-Icon-Leiste, globale Suche, unterteilte Arbeitsbereiche, Hell/Dunkel und eine kleine Build-Version in der Navigation | Weitere lokale Passwortkonten nur bei konkretem Bedarf; Google-OIDC technisch optional, nicht als echter Betreiberlogin eingerichtet |
| Kontakte und Stammdaten | Privat-/Firmenkontakte, Orte, Produkte/Preise, Pakete, Eventarten, Ressourcen und Absagegründe; Suche, Archivierung und Versionsschutz | Fachlicher Abgleich mit echtem Bestand |
| Events und Aufträge | Anlage über kompakten Datum-zuerst-Dialog (H029), Bearbeiten/Duplizieren, Suche/Filter, Monatsgruppen, Event-Details, Status, Notizen und unveränderbares Logbuch; Terminzeiten werden ohne manuelle UTC-Versatzfelder eingegeben (H022) | Gesamter kommerzieller Ablauf folgt separat |
| Disposition und Kalender | Physische Boxen/Zubehör, Vormerkungen, feste Buchungen, Datenbank-Konfliktschutz, Puffer, interne Sperren, Tages-/Wochen-/Monatskalender und widerrufbare ICS-Abos | Echter Ressourcenabgleich vor Nutzung; Smartphone-Abnahme des Kalender-Abos |
| Website-Anfragen | Achtfeldrige Definition, öffentliche API, verschlüsselter Gateway-Eingang, signierte/idempotente Übertragung, dauerhafte lokale Ablage, Quittierung, manuelle Prüfung/Übernahme und mobiles einbettbares Formular entwickelt und synthetisch getestet; seit C028 zusätzlich die Gateway-Laufzeit als eigener Prozess und der Pull-/Quittungstakt im Worker als Code vorhanden | Gateway real starten (Kaltstart mit synthetischen Schlüsseln), Podman-Secrets anlegen, erlaubten Website-Origin festlegen, WordPress anschließen und gemeinsam abnehmen |
| E-Mail/Kommunikation (M3) | Geplant | IMAP/SMTP, Zuordnung zu Events/Kontakten, Postfach, Vorlagen, Anhänge, geplanter Versand und Erinnerungen |
| Geschäftsdokumente/Finanzen (M4) | Dokumentvorlagen für alle fünf Arten mit Positionen, Platzhaltern, Versionierung und Oberfläche (C047/C047.1); Marken-Layout und exakte Geldrechnung (C048), Logo über den Storage-Adapter (C048.1), Chromium-PDF (C049) mit Download (C049.1), Nummernkreise (C050/C050.1); seit C051 werden Dokumente als Entwurf gespeichert und mit Nummer, Snapshot und inhaltsadressierter PDF finalisiert; seit C051.3 sind sie in den Event-Details bedienbar | Gültigkeitsdatum und Status `sent`/`expired`/`accepted`, Bearbeiten von Entwürfen, Logo-Upload in der Oberfläche, Annahmen, Auftragsbestätigungen, Rechnungen/Anzahlungen/Korrekturen und Zahlungen; LibreOffice bleibt gewählter externer Übergangsweg, Ablauf noch nicht abgenommen |
| Verträge/Fragebögen (M5) | Bewusst zurückgestellt | Vorlagen, Kundenlinks, Signaturen, Abschlussnachweise, Fragebögen und kontrollierte Übernahme |
| Aufgaben/Auswertungen (M6) | Bewusst zurückgestellt; Absagegründe-Stamm schon vorhanden | To-dos, relative Vorlagen/Fristen, Benachrichtigungen und Absageauswertungen |
| Migration/Betrieb (M7 teilweise vorgezogen) | Minimalimport mit Vorschau/Dry-run/Mapping/Ressourcenprüfung; CSV-Exporte für Kontakte/Events/Produkte; Container, CI, Updates, verschlüsselte Sicherungswerkzeuge und Restore-Proben | Reale Datenübernahme, unabhängiges Sicherungsziel, Aufbewahrung/Timeraktivierung, letzte Delta-Sicherung und fachliche Produktivfreigabe |

C001–C026 sowie C076 sind implementiert; C027–C075 und C077–C085 nicht pauschal als fertig werten. E-/H-Slices ziehen gezielte Teile vor, ohne ganze Milestones als abgeschlossen zu erklären.

## Letzter geprüfter Laufzeitstand

### Arbeitsnachtrag 21.10.2026 (H035: Dateien, Phase 1 ohne Commit)

Branch `codex/ux-event-simplification`, Basis `c744fd7`. Neu ist ein eigener Bereich **Dateien** (`#files`) in der Hauptnavigation (Desktop-Icon-Leiste, mobiler Dialog, `aria-current`, Titel/Aria „Dateien“, Einstellungen bleibt eigenständig), der ausschließlich die bestehenden Geschäftsdokumente listet. Grundlage war die Feststellung, dass es **keine** Nutzer-Upload-Bibliothek gibt: `documents` kennt Art, Vorlage, Event, Kontakt, Nummer, Zustand, `issued_at`, `finalized_at`, Hashes und Beträge, aber keinen Dateinamen, keine Originaldatei und kein `created_at`. Die Oberfläche erfindet deshalb weder Dateinamen noch Uploads; die Lücke zu echten Uploads, Standard- und Eventdateien ist ausdrücklich offen.

API-Erweiterung rein additiv an `GET /api/v1/documents`: optionale `from`/`to` (inklusive, tenant-lokale `issued_at`-Tage, Obergrenze als nächster lokaler Mitternachtspunkt, damit DST-Tage exakt bleiben), `limit` 1–100 (Maximum, niemals `limit+1` serverseitig), `offset` und `include=metadata` mit `eventName` (mandantengebundener Left Join), `issuedDate` und `pdfAvailable` — exakt die Bedingung der PDF-Route (`final`, Nummer, pdf-Hash). Ohne diese Parameter bleibt der Abruf unverändert ungepaggt mit exakt den alten Feldern; kein Envelope, keine Gesamtzahl, keine Migration, keine neue Tabelle oder Route, keine Ablageänderung. `withdrawn` wird angezeigt, aber nicht erfunden; `sent`/`expired`/`accepted` bleiben unimplementiert.

Oberfläche: `FilesPanel` filtert serverseitig über Art/Status/Zeitraum im eigenen Query-Namensraum `df_kind`/`df_state`/`df_from`/`df_to`/`df_page` (globale Suche und Eventfilter bleiben erhalten), setzt bei Filterwechsel die Seite zurück, nutzt eine angeforderte Extrazeile nur als `hasMore`, behält bei Fehlern den letzten Stand samt ehrlichem Filterzustand und reinem GET-Retry, verwirft verspätete Antworten über einen Sequence-Guard und aktualisiert bei Rückkehr über den vorhandenen `useAutoRefresh` ohne Polling. Zeilen zeigen Art und Nummer, `issuedDate`, Eventname mit nativem `#event-<id>`-Link nur bei gültiger ID, Status, exakten Betrag und einen PDF-Link nur bei `pdfAvailable` (`noopener` über `rel=noreferrer`, `target=_blank`); es wird nie automatisch finalisiert, nummeriert, versendet oder eine PDF vorab geladen.

Aus der unabhängigen Prüfung und der Integrationsprüfung eingearbeitet: Der Bereich hat **keine** eigene H1 mehr; der Seitenkopf der Werkzeugleiste ist die einzige Seitenüberschrift, `FilesPanel` ist über `aria-label="Dateien"` adressiert. Beträge werden über `exactMinorUnits` aus den ganzzahligen Cent formatiert, weil `grossMinor/100` den größten gültigen Betrag (9007199254740991) um einen Cent auf „…,90“ rundete. Der Event-Link baut sein Ziel über `eventTargetHref`: nur der Event-Filter-Namensraum (`q`, `from`, `to`, `status`, `eventTypeId`, `undated`) wird entfernt, `df_*` und fremder Zustand bleiben, sodass die Details wirklich öffnen. Ein `withdrawn`-Dokument ohne Nummer heißt nicht mehr „Entwurf“, sondern trägt seinen echten Zustand. `updateUrlSearch` verwirft Schlüssel außerhalb eines übergebenen Namensraums, **bevor** es schreibt. Das Panel lädt nur, solange `#files` aktiv ist (`active`-Prop aus `AuthPanel`), sodass ein verborgenes Panel keinen Fokus-Abruf startet und die Rückkehr aus einem Event den aktuellen Stand lädt. Für den neuen Dateien-Eintrag gibt es einen gezielten Dirty-Schutz: Ein regulärer Klick bei registrierten ungespeicherten Eingaben fragt nach; Abbrechen hält Hash, Entwurf, Fokus und das mobile Menü, Strg-/Mittel-/Shift-Klick löst keinen Dialog aus und ändert die aktuelle Ansicht nicht. Die übrigen Navigationslinks bleiben unverändert ungeschützt.

Gefundener und behobener Fehler: Die erste Zeilenprüfung rief `String(entry.issuedDate)` vor der Typverengung auf, sodass eine einzelne fremde Zeilenform die ganze Liste mit einer Ausnahme statt mit einem ehrlichen Fehlerzustand beendete; jetzt werden alle Felder vor ihrer Verwendung geprüft. Ein weiterer Befund: Der DB-CHECK verbietet `final` ohne Nummer, `finalized_at`, Snapshot und pdf-Hash, ein „final ohne Artefakt“ kann also gar nicht existieren — die Bedingung ist trotzdem defensiv als `pdfAvailable` abgebildet und im Test über die Constraint belegt.

Lokal mit Node 24.15.0 (`pnpm --use-node-version=24.15.0`, Shell-Node ist v23.11.0) grün: Format, Lint, Typecheck, Build, Workspace- und Dokumentationsprüfung, 209 Unit-, 300 Komponenten- und 262 Integrationstests sowie 6/6 Chromium-Abläufe inklusive neuem Dateien-Schritt (Navigation, eine H1, Filter-Request mit `limit=26`, 44-px-Ziel, Tastaturfokus, PDF-Link ohne Vorabladen, kein Body-Überlauf bei 1280/390/320, axe-Audit). Coverage und Linux-CI folgen nach dem Commit; der macOS-`RLIMIT_FSIZE`-Backuptest bleibt unverändert lokal rot. **Kein Commit/Push/Deploy in Phase 1.**

### Arbeitsnachtrag 22.10.2026 (H036 Phase 2: Prüfbefunde eingearbeitet)

Die unabhängige Prüfung bestätigte Kontrast (0 Verstöße bei 840 gemessenen Bedienelementen, beide Themes), Fokus 3 px/3 px, 44 px, keine Layout-/Wortlaut-/Funktionsänderung und die H031-Icons. Sie fand eine echte Abdeckungslücke und zwei Testlücken; alle drei sind zuerst fehlschlagend, dann grün repariert:

- `PasswordPanel` hatte gar keine Stufe („Passwort ändern“ ohne Klasse) — jetzt `.primary-action`. Ausdrücklich zu H036 gehören als gewöhnliche Flächen außerdem Import (`ImportPanel`/`ImportOverview`/`ImportPromiseReview`), Dokumentvorlagen und Nummernkreise.
- Ein neuer Test rendert die **echte Hülle** (`AuthPanel`/`Navigation` mit den `[hidden]`-Workspace-Seiten) über alle 13 Routen und verlangt dort 0 oder 1 *sichtbare* primäre Aktion. Er deckte drei gleichzeitige „Speichern“ auf der Einstellungsseite auf: `MasterDataPanel` hat dafür ein optionales `primary`, die Nummernkreise tragen die primary am gerade bearbeiteten Kreis, Zeilen- und Such-Icons sind `tier-quiet-icon`.
- Event-Details behält zwei primaries in getrennten Frames; geprüft wird je Frame ≤ 1 statt „genau 2 offene Frames“.
- Die Zahl der Komponententests wächst auf 346 (17 davon in `action-hierarchy`). Vorbestehend und **nicht** H036: fokussierbare Bedienelemente in `[hidden]`-Seiten und der doppelte „Bearbeiten“-Knopf in Ressourcen — beides als eigene Scheibe führen.

H037 ist mit `c744fd7` released (CI-Lauf 39569637148, quality und images success, CT114 per Auto-Updater auf gleicher Revision, alle drei Container healthy, öffentliche Seite 200). H032 (Website-Option) bleibt offen.


### Arbeitsnachtrag 21.10.2026 (H037: einfachere Kalenderübersicht, wahrheitsgetreue Datum-anzeige)

Branch `codex/ux-event-simplification`, Ausgangspunkt `1a8d805`. Frontend-only: Es gibt **kein** `hasTime`-Feld und keine Backend-/API-/DB-Änderung, weil `GET /api/v1/calendar` die ursprünglichen nullbaren `startsAt`/`endsAt` bereits liefert und `validateSchedule` Zeiten nur paarweise zulässt — fehlende Zeitstempel sind damit die einzige Wahrheitsquelle für „ohne Uhrzeit“.

Umgesetzt: Monatsdefault ohne ausdrückliche URL-Wahl (`calendarViewFromUrl`), eine ruhige Navigationszeile mit den bestehenden 44-px-Icon-Aktionen, sichtbarer Zeitraumspanne und den vorhandenen Ansicht-/Datumsfeldern; Ressourcenbelegung als **natives, unkontrolliertes** `<details>` (Inhalt dauerhaft eingehängt, vom Browser zugeklappt verborgen, kein React-Zustand, kein zusätzlicher Abruf, Fokus bleibt auf dem Summary); Ladefehler-, Bestandswarnung und Legende bleiben außerhalb. Eventchips und Liste entscheiden „Tagesbuchung, ohne Uhrzeit“ ausschließlich über die nullbaren Zeitstempel, behalten echte Mitternachtszeiten und zeigen bei mehrtägigen Buchungen den ursprünglichen Zeitraum in jeder belegten Tageszelle statt sie auf den sichtbaren Tag umzudatieren. Nach einem fehlgeschlagenen Ansichtswechsel bleibt der letzte Stand im eigenen Raster (`data.view` steuert Spalten, Wochentagskopf und Padding), während die Bedienelemente den angeforderten Zustand zeigen. Die Monatsübersicht passt jetzt in den Container (sieben Spalten, kompakter Wochentagskopf, gekürzte Chips mit vollem Titel und 44-px-Linkziel); Woche/Tag behalten ihre innere Scrollung.

Review-Nachtrag: Der statische Review-Befund „programmatisches `details.open` löst kein `toggle` aus, also zeigt der Inhalt nichts“ war für die frühere React-Zustandsvariante korrekt, ist mit dem nativen Element aber kein Fehler mehr — der Browser zeigt den Inhalt ohne Handler. Die Belegung ist deshalb bewusst unkontrolliert; der zugehörige Regressionstest setzt `open` direkt. Die zweite Review-Sorge (Warnung/Legende könnten in die Belegung wandern) ist im Quellstand bereits erfüllt und jetzt zusätzlich mit Alert-, Legenden- und „kein Frei“-Assertions vor und nach dem Aufklappen abgesichert.

Lokal mit Node 24.15.0 grün: 209 Unit-, 290 Komponenten- und 257 Integrationstests (756 gesamt), Format, Lint, Typen, Build, Workspace- und Dokumentationsprüfung, Coverage 97,40 % Zeilen und 93,82 % Zweige (`calendar-range.ts` 100 % Zeilen, `CalendarPanel.tsx` 98,6 % Zeilen) sowie alle sechs Chromium-Abläufe, darunter echte Summary-Interaktion per Klick und Enter, Fokuserhalt, Monatsraster ohne innere oder Body-Scrollung bei 1280/390/320 und 44-px-Navigationsziele. Bekannt und unverändert: Der macOS-`RLIMIT_FSIZE`-Backuptest bleibt lokal rot; Linux-CI ist maßgeblich. H032 (Website-Option) und H035 (Dateien) bleiben offen; H034 ist mit `1a8d805` freigegeben.

### Arbeitsnachtrag 21.10.2026 (H034: Ort/Adresse am Event, Abschluss der Quellumsetzung)

Branch `codex/ux-event-simplification`, Basis `74d636a`. Die unabhängigen Reviews sind eingearbeitet: Der Migrationstest leitet den Sollstand aus den vorhandenen Migrationsdateien ab und prüft zusätzlich Namen, Checksummen, die Spalten `venue`/`venue_override` samt Default und CHECK sowie wiederholtes `migrate`; der alte Hash `#locations` wird nicht nur beim Start, sondern auch bei späterem `hashchange`/`popstate` ohne neuen History-Eintrag, ohne Reload und ohne Query-Verlust auf `#events` normalisiert; ein Duplikat mit archiviertem Bestandsort sendet keine ungültige Fremdreferenz mehr, sondern übernimmt den sichtbaren Ort als Freitext (vorhandener Freitext oder bewusste Leerung bleiben erhalten), während die Serverprüfung für neue Buchungen streng bleibt. `venue` ist im Request-Schema eine Union aus `string`/`null`, damit ein explizites `null` nicht durch die Validierung zu `''` wird; Alt-PUTs ohne beide Eigenschaften, Status-/Ressourcen-Schreibvorgänge und Importe behalten den gespeicherten Stand. Die Oberfläche belegt das Feld mit dem vollständigen Bestandsort vor, sendet es aber nur nach tatsächlicher Bearbeitung, hydriert spät eintreffende Ortsdaten ausschließlich in unberührte Felder und zeigt Zeilenumbrüche auch in der Liste. CSV behält Spaltennamen und -reihenfolge (`locationName` wirksam, `locationId` bei Freitext leer), ICS escaped/faltet weiterhin, finale Dokument-Snapshots bleiben unverändert.

Lokal mit Node 24.15.0 grün: 201 Unit-, 277 Komponenten- und 257 Integrationstests (735 gesamt), Format, Lint, Typen, Workspace- und Dokumentationsprüfung, Build, Coverage 97,40 % Zeilen und 93,84 % Zweige sowie 6/6 Chromium-Abläufe inklusive neuem Ortsablauf, Alt-Hash, Einstellungen, Kontakten, Theme, Favicon, optionalen Zeiten und DST. Bekannt und unverändert: der macOS-`RLIMIT_FSIZE`-Backuptest (`test_child_file_limit_preserves_the_disk_reserve`) scheitert lokal; Linux-CI ist maßgeblich. Commit, Linux-CI, Changed-Code-Coverage und Testbetrieb werden nach dem Push im Scratch-Ergebnis belegt.

Nachtrag H033: Commit `74d636a` wurde am 21.10.2026 gepusht; GitHub-Quality-Lauf `39521013312` meldet success für Quality und Images, damit ist die frühere offene Push-/CI-Notiz zu H033 erledigt.

### Arbeitsnachtrag 21.10.2026 (H034: Ort/Adresse am Event, Phase 1)

Branch `codex/ux-event-simplification`, Ausgangspunkt `74d636a`. Die Nutzerentscheidung vom 21.10.2026 ersetzt die frühere Planannahme „H034 ohne Migration“: Der Ort ist eine optionale Freitextangabe der Buchung, Locations bleiben ausschließlich Bestand. Migration `0032_event_venue.sql` ergänzt additiv `events.venue` (bis 1.000 Zeichen, mehrzeilig) und `events.venue_override` (Default false) ohne Rückfüllung, ohne Destruktion und ohne neue Tabelle. `venue_override` entscheidet die wirksame Quelle: true zeigt nur den Freitext (auch leer = bewusst kein Ort), false die bisherige Bestandsanschrift. Alte Voll-PUTs ohne beide Eigenschaften erhalten den Stand; nur ein tatsächlich geänderter `locationId` setzt `venueOverride` auf false und behält den Freitext. Suche, Kalender, ICS, CSV und `{{location}}` nutzen die wirksame Quelle; die CSV behält Spaltennamen und -reihenfolge, `locationName` ist der wirksame Ort, `locationId` ist bei Freitext leer. Website-Anfragen übernehmen ihren freien Ort als `venue`/`venueOverride` und lassen nur die neue Doppelzeile in der generierten Beschreibung weg; bestehende Beschreibungen bleiben unberührt. Die Oberfläche ersetzt den Location-Select in Event und Anlegen-Dialog durch „Ort / Adresse“ (mehrzeilig, vorbelegt mit dem vollen Bestandsort, aber nur bei tatsächlicher Bearbeitung gesendet), zeigt in den Event-Details nur den wirksamen Ort, hat keinen Locations-Menüpunkt und keine Locations-Einstellungen mehr; `#locations` leitet ohne neuen History-Eintrag und ohne Query-Verlust auf Events um. Locations-API, -Tabelle und Integrationstests bleiben. Kein Commit/Push in Phase 1; die volle Chromium-/Coverage-/CI-Abnahme folgt im Review-Schritt.

### Arbeitsnachtrag 21.10.2026 (H033: Ressourcen und Produkte unter Einstellungen, Abschluss)

Branch `codex/ux-event-simplification`, Ausgangspunkt `065b6faece92eb3fea48da235a2d8d59e1f848fb`. Die Hauptnavigation enthält in der Desktop-Seitenleiste und im mobilen Menü weder „Ressourcen“ noch „Produkte“; beide Verwaltungen liegen als Einstellungsabschnitte `#settings-resources` und `#settings-products` unter dem einzigen Seiten-H1 „Einstellungen“. Die alten Deep Links `#resources` und `#products` bleiben unverändert gültig und werden ohne globalen Router-Umbau auf dieselben Routen abgebildet; Zurück/Vorwärts, Hash-Wechsel und Query bleiben erhalten, ohne Neuladen oder Auth-Reset. Hauptnavigation markiert „Einstellungen“ und die Unternavigation den passenden Abschnitt mit `aria-current` – auch bei den alten Hashes. Beide Panels bleiben wie zuvor dauerhaft eingehängt und werden nur verborgen, sodass Entwürfe beim Wechsel zwischen Ressourcen und Produkten erhalten bleiben und keine zusätzlichen Listenabrufe entstehen. Jeder Abschnitt trägt genau eine H2 („Ressourcen“/„Produkte“); die vorhandene H2 „Zeitweise Ressourcensperren“ bleibt darunter erhalten. Ressourcen-, Sperr-, Kalender-, Eventzuordnungs- und Produktfunktionen samt APIs, Berechtigungen und Deaktivierungszuständen sind unverändert; keine API-, Datenbank-, Migrations- oder Auth-Änderung.

Lokal grün: 190 Unit-, 265 Komponenten- und 237 Integrationstests, Format, Lint, Typen, Build, Workspace- und Dokumentationsprüfung, Coverage 97,40 % Zeilen und 93,80 % Zweige. Die vollständige Chromium-Suite ist mit 6/6 Abläufen grün, darunter beide Anmeldearten mit Ressourcen-, Sperr- und Produktpfaden, echter Zurück-/Vorwärts-Navigation zwischen `#settings-resources`/`#settings-products` und den alten Hashes `#resources`/`#products` ohne Neuladen oder Query-Verlust, erhaltenen Entwürfen und unveränderten Abrufzahlen, Tastatur-Enter/Fokus in der Einstellungs-Unternavigation auf Desktop und im mobilen Drawer sowie 1280/390/320 ohne horizontalen Überlauf; lange Untermenü-Labels brechen bei 320 px um. Die unabhängige Quellprüfung fand keine bestätigten funktionalen Defekte. Offen: Changed-Code-Coverage, Linux-CI und Testbetrieb nach Commit/Push (Scratch-Ergebnis, keine zweite Doku-Pushrunde) sowie H032 (Website-Option) und H034 (Locations).

### Arbeitsnachtrag 21.10.2026 (H039: Kontakte mit Suche und Liste zuerst, Formular hinter Plus, Phase 1)

Branch `codex/ux-event-simplification`, Ausgangspunkt `6f6c304df2578e035bb500e7447590400e904102`. Die Kontaktseite zeigt zuerst die Suchwerkzeugleiste (Suchfeld, Icon-Suche, CSV-Export, Plus) und unmittelbar darunter die Liste; das Anlegeformular ist initial nicht gerendert und nicht tabbar. „Kontakt anlegen“ ist eine 44-px-Plus-Aktion ohne sichtbaren Text mit `aria-label`/`title`; die Zeilenaktionen „Events anzeigen“ und „Kontakt bearbeiten“ sind ebenfalls ruhige, benannte 44-px-Icon-Aktionen, während E-Mail-, Telefon- und CSV-Links Text bleiben; Anlegen und Bearbeiten laufen in einem modalen Dialog mit eigenem Titel „Kontakt anlegen“ beziehungsweise „Kontakt bearbeiten“, `aria-modal`, `aria-labelledby`, initialem Fokus in der Kontaktart, Tab-Falle und Fokusrückkehr auf den Auslöser (Rückfall Plus). X, Escape und „Kontakt abbrechen“ fragen bei einem geänderten Entwurf ausdrücklich nach dem Verwerfen; ein unverändert geöffneter Dialog gilt nicht als schmutzig. Die Werte sind kontrolliert, sodass Neuanlage (Privatperson, aktiv, `country=DE`) und der Wechsel zwischen bestehenden Kontakten keine alten Werte weiterverwenden; Bearbeiten sendet weiterhin die gespeicherte `version`. Während eines laufenden POST sind Schließen, Escape und Abbrechen gesperrt, ein synchroner Ref-Guard verhindert doppelte Mutationen, und ein Fehlschlag behält Dialog und Eingaben. Ein bestätigtes Speichern schließt, leert den Entwurf und lädt die Liste neu; scheitert nur dieser GET, bleibt eine ehrliche Meldung mit reiner GET-Wiederholung sichtbar. Suchtext und Listeninhalt bleiben beim Öffnen und Schließen erhalten; `#contact-<id>` bleibt Route und die Liste vergibt Zeilenanker. Keine API-, Datenbank- oder Migrationsänderung, kein Auto-Refresh und kein Hintergrund-Confirm.

Die unabhängige Phase-1-Prüfung ist eingearbeitet: Ein erfolgreicher Listenabruf entfernt den Neuladehinweis samt Wiederholungsknopf (auch bei Such-/Filterneuladen), ein verspäteter älterer Abruf löscht keinen neueren Fehler, der Dialog hält den Fokus während eines laufenden POST/PUT (programmatisch fokussierbare Dialogwurzel, Tab/Shift+Tab auch bei vollständig deaktivierten Bedienelementen, `aria-busy`, Fehlerfokus nach Fehlschlag), und eine erfolgreiche Dublettenprüfung ist ein ruhiger `role=status` statt eines roten Alarms; echte Fehler bleiben Alarme, der Erfolg wird bei Eingabeänderung verworfen.

Lokal grün: 190 Unit- und 263 Komponententests (21 Kontakttests), Format, Lint, Typen, Build und Dokumentationsprüfung, Coverage 97,39 % Zeilen und 93,79 % Zweige, Changed-Code 164/170 Zeilen und 97/109 Zweige. Die vollständige Chromium-Suite ist mit sechs Abläufen grün, darunter beide Anmeldearten mit Kontakt anlegen/bearbeiten/suchen, Dirty-Abbruch (abgelehnt und bestätigt), tatsächlichem Mutationsfehler mit erhaltenen Eingaben und Fehlerfokus, anschließendem Neuladefehler samt verschwindendem GET-Retry sowie Dialog-/Toolbar-/Bereichsgeometrie bei 1280/390/320 ohne horizontalen Überlauf, 44-px-Plus und -Zeilenaktionen sowie Tab im Dialog. Commit, Linux-CI und Testbetrieb wurden nach dem Push geprüft; der lokale macOS-`RLIMIT_FSIZE`-Backuptest blieb unverändert. H033 folgte als eigener Commit; H032 (Website-Option) bleibt offen.

Release-Nachtrag H039: Commit `065b6faece92eb3fea48da235a2d8d59e1f848fb` wurde gepusht (Remote-Readback identisch); GitHub-Quality-Lauf `39514678870` meldet quality und images success. Der Auto-Updater auf pve1/CT114 hat dieselbe Revision ausgerollt: last-success `065b6fa`, ak-test-api/-worker/-admin healthy, Timer aktiv, kein needs-attention; https://auftragskompass.samuelgesang.de antwortet mit HTTP 200 und den Kontakt-Markern im Bundle. Damit ist H039 released; die frühere Phase-1-Notiz bleibt als zeitlicher Zwischenstand erhalten. H033 folgt als eigener Commit.

### Arbeitsnachtrag 20.10.2026 (H038: UI-Sprache, Seitenhierarchie, Favicon, Phase 1)

Branch `codex/ux-event-simplification`. Die eigene Oberfläche verwendet sichtbar nicht mehr „Eventakte“, sondern „Event“ beziehungsweise „Event-Details“: Bereichsname, Schließen-Aktion, Lade-/Fehler-/Neuladehinweise, Detailtitel („Event: Name“), Bereichsnavigation und Statusfeld. Interne Komponenten-, CSS-, URL-, API- und Datenbankbezeichnungen bleiben unverändert; historische Bookitup-Recherche und datierte Notizen behalten den Begriff als Beleg.

Der App-Ebenen-Hero „AuftragsKompass / Anfragen, Kontakte und Stammdaten verwalten.“ ist entfernt. Die Anmeldung hat genau einen H1 „Anmelden bei AuftragsKompass“ und den Theme-Umschalter; nach der Anmeldung sitzt derselbe Umschalter genau einmal in der Werkzeugleiste. Die Werkzeugleiste enthält den einzigen sichtbaren Seiten-H1 als echten `#events`-Link. Bereichsflächen (Events, Kontakte, Produkte, Ressourcen, Locations, Einstellungen) wiederholen ihn nicht mehr als sichtbares H2; auf der Suchroute bleiben „Events“ und „Kontakte“ als eigene Abschnitts-H2, der Kalender behält seine genauere H2, und „Zeitweise Ressourcensperren“ ist unter der Ressourcen-H1 ein H2. Der Importbericht verwendet H3. Bereichsnamen für Tests und Screenreader bleiben. Ein eigenes geometrisches Kompass-Favicon liegt unter `apps/admin/public/favicon.svg` mit 32px-PNG-Fallback und korrekten `link`-Deklarationen; der Dokumenttitel bleibt „AuftragsKompass“.

Lokal grün: 190 Unit- und 247 Komponententests, Format, Lint, Typen, Build, Dokumentation sowie fünf Chromium-Abläufe (Login-H1/Theme, Favicon-MIME und identische SVG-/PNG-Geometrie mit 16/32-Renderkontrast, Google- und Passwortanmeldung). Die Sichtprüfung der Titelstapel bei 1280/390 wurde im gebauten Bundle mit synthetischen Stub-Antworten durchgeführt; Linux-CI und Testbetrieb werden nach dem Push geprüft. Ebenfalls offen und nur im Plan notiert: H032 (Website-Option) bleibt wegen HTTP 429 vor jeder Quelländerung pausiert; H039 (Kontakte: Suche, Liste, Plus-Formular) und die H033-Erweiterung um Produkte sind nicht implementiert.


### Arbeitsnachtrag 20.10.2026 (H030: automatische Aktualisierung, Phase 1)

Branch `codex/ux-event-simplification`. Die sichtbaren Schaltflächen „Events aktualisieren“, „Eventakte aktualisieren“ und „Kalender aktualisieren“ sind entfernt. Ein gemeinsamer Hook `useAutoRefresh` aktualisiert Eventliste, Eventakte und Kalender beim Sichtbarwerden des Dokuments oder Fokusgewinn, jeweils dedupliziert für dieselbe Rückkehr; laufende Abrufe und verborgene Dokumente lösen keine zusätzliche Abfrage aus, Listener werden beim Unmount entfernt, und es gibt keinen Takt. Ein schmutziger Bearbeiten-/Anlegeentwurf sowie die Eventakte mit ungespeicherter Status- oder Ressourceneingabe bleiben erhalten; die Akte hält Hintergrundladungen zurück und zeigt einen ruhigen Hinweis mit ausdrücklicher Verwerfen-und-Neuladen-Aktion. Ladefehler behalten die letzten guten Daten und bieten eine reine Wiederholungsaktion. Keine Server-, API-, Datenbank- oder Migrationsänderung.

Lokal sind die neuen Regressionstests sowie 187 Unit- und 231 Komponententests, vier Chromium-Abläufe, Format, Lint, Typen, Build und Coverage (97,38 % Zeilen, 93,81 % Zweige; Changed-Code 65/65 Zeilen, 73/77 Zweige) grün. Die unabhängige Prüfung ist eingearbeitet: ein doppelter Aktenabruf bei gleichzeitiger Listenaktualisierung ist durch Id-/Revisions- und In-Flight-Schutz samt Kombinationstest behoben, der verzögerte Hinweis ist präzisiert und als Status angekündigt, der obsolete WebsiteInbox-Text sowie der Fokusverlust im Kalender sind korrigiert. Commit `b2100b4c7df0b05dec81ada119017e13f01ad424` ist gepusht; GitHub-Lauf 39477841511 ist mit Quality und beiden Images grün, der automatische Testupdater hat API, Worker und Admin gesund auf genau diesen SHA übernommen, `last-success.json` stimmt, der Timer ist aktiv und die öffentliche Adresse antwortet 200. Das Admin-Bundle enthält die drei alten Aktualisieren-Texte nicht mehr. Eine echte Tab-Rückkehr ist im headless Chromium nicht abbildbar; der E2E-Ablauf löst dieselbe Sichtbarkeits-/Fokusfolge im gebauten Bundle aus. Die manuelle Sichtprüfung eines echten Tab-Wechsels bleibt als Restrisiko offen. Der bekannte macOS-`RLIMIT_FSIZE`-Backuptest bleibt unverändert und ist nicht Teil dieses Slices.

### Arbeitsnachtrag 20.10.2026 (H031: Heimweg, einklappbare Navigation und ruhige Icon-Aktionen, Phase 2)

Branch `codex/ux-event-simplification`. Desktop-Markenname und mobiler Bereichstitel bleiben echte `#events`-Links; der aktive Heimweg erzeugt keinen zusätzlichen Historieneintrag und fragt nicht. Eventzeilen sind jetzt selbst native Links auf `#event-<id>` mit Fokus-Rückkehr zur Zeile; der separate „Eventakte öffnen“-Knopf ist entfernt. Die Zusammenfassung enthält keine verschachtelten interaktiven Elemente, Textauswahl öffnet nichts, Bearbeiten/Duplizieren bleiben unabhängige Geschwisteraktionen, und ein Klick öffnet die Akte genau einmal. Icon-only-Bedienelemente in Navigation, Kopf, Theme, Abmelden, Dialog, Event, Kalender und Kontaktsuche haben präzise `aria-label` und `title`; der Theme-Knopf beschreibt die nächste Aktion und behält `aria-pressed`.

Die Desktop-Seitenleiste klappt über einen benannten Knopf mit `aria-expanded` auf reine Icons ein und wieder aus. Marke/Home bleibt als „AK“-Link nutzbar, Links behalten `aria-label`, `title` und `aria-current`, Version/Untertitel/Kontozusatz werden kompakt ausgeblendet, die Präferenz liegt unter `ak-sidebar` samt Storage-Sync, und der mobile Dialog bleibt eine unveränderte Textnavigation. Event anlegen/bearbeiten/duplizieren, Kalender-Vor/Zurück/Heute und die Kontaktsuche sind 44-px-Icon-Schaltflächen ohne sichtbaren Text, mit unveränderten Namen, Disabled-/Busy-Regeln und sichtbarem Kalenderkontext.

Die globale Suche startet als Icon, öffnet ein fokussiertes Feld, behält einen nicht abgesendeten Entwurf über Schließen/erneutes Öffnen, schließt per Escape oder Knopf mit Fokusrückkehr und schreibt erst beim Absenden `q` plus `#search` in einem Historieneintrag; die bestehenden Ergebnislisten bleiben. Heim- und Suchwechsel verwenden den kleinen registrierten Dirty-Hook der Eventakte; Abbrechen hält Route und Eingabe, Bestätigen erlaubt den Wechsel. Andere Navigationslinks, „Eventakte schließen“, Browser-Zurück und nicht registrierte Formulare bleiben ungeschützt; keine universelle Dirty-Garantie. Keine API-, Datenbank- oder Migrationsänderung.

Lokal grün: 187 Unit- und 244 Komponententests, Format, Lint, Typen, Build, Dokumentationsprüfung und Changed-Code-Coverage (103/103 Zeilen, 84/87 Zweige). Die vollständige Chromium-Suite (vier Abläufe, Google und Passwort) lief mit synthetischen Daten grün: 1280/390 ohne horizontalen Überlauf, eingeklappte Leiste inklusive Reload-Persistenz und sichtbarem Logout-Fehlerstatus, Suche mit Escape/Entwurf, Tastatur-Enter auf Eventzeilen, 44-px-Ziele und Dirty-Dialoge. Die unabhängige Prüfung ist eingearbeitet (Kontostatus, Modifier-/Mittelklick, Resize-Fokus, Icon für Stammdaten, AK-Titel, zugänglicher Zeilenname ohne Label-Mismatch). Integrationstests und Linux-CI bleiben maßgeblich; Testbetrieb/Deployment folgen nach Commit und CI. **Kein Commit/Push in der Quellphase.**

### Arbeitsnachtrag 20.10.2026 (H029: leichtes Anlegen mit Datum zuerst)

Branch `codex/ux-event-simplification`. „Event anlegen“ öffnet einen modalen Dialog mit nativem Datumsfeld, Kundenauswahl und Eventart; Uhrzeiten, Ort, Notizen und weitere Felder liegen zugeklappt unter „Weitere Angaben“ und behalten ihre Eingaben. Der Name wird deterministisch aus Eventart und Kunde erzeugt, als Platzhalter gezeigt und ist unter „Weitere Angaben“ überschreibbar. Datum ohne Zeiten speichert `eventDate` ohne erfundene Mitternacht, undatiert bleibt möglich. Fokus startet im Datumsfeld, Tab bleibt im Dialog, Escape/Schließen schreiben nichts, und ein laufender POST sperrt Schließen und Escape. Ein offener Bearbeiten-Entwurf sperrt Anlegen/Duplizieren; nach Abbruch oder Speichern kehrt der Fokus auf einen überlebenden Auslöser zurück. Eigene `event-create-*`-IDs verhindern ID-Kollisionen mit dem Editor. Keine Server-, API-, Datenbank- oder Migrationsänderung.

Lokal grün: Format, Lint, Typen, Build, 187 Unit-, 210 Komponenten- und 237 Integrationstests sowie vier Chromium-Abläufe inklusive Desktop-/Mobilgeometrie und Tastaturprüfung des Dialogs; Coverage 97,37 % Zeilen und 93,75 % Zweige (`EventCreateDialog.tsx` 99,1 % Zeilen, 91,7 % Zweige). Der lokale `test:ops`-Lauf scheitert weiterhin nur am bekannten macOS-`RLIMIT_FSIZE`-Backuptest; Linux-CI bleibt maßgeblich. **Kein Merge nach `main`.**

### Arbeitsnachtrag 20.10.2026 (H026: Termin und Ressourcenzuweisung ohne manuelle Versätze)

Branch `codex/ux-event-simplification`. Die Eventakte zeigt Termin, Buchungsstatus und Einheiten in einem Formular mit einer ausdrücklichen Speicherung. Eventbeginn und Eventende werden nur noch lokal eingegeben; `EventTimeField`/`event-time.ts` lösen den Versatz in der Eventzeitzone auf. Doppelte Herbst-Uhrzeiten verlangen eine getrennte Auswahl für Beginn und Ende, Frühjahrslücken einen Feldfehler mit Fokus und ohne Mutation. Ein unveränderter gespeicherter Zeitpunkt bleibt exakt erhalten (auch doppelte Stunde, Sekunden, Millisekunden); eine bewusste andere Auswahl derselben Wanduhrzeit hat Vorrang. Nach einer Datumsänderung wird kein alter Versatz weiterverwendet (Sommer→Winter und Winter→Sommer geprüft). Das Eventdatum folgt dem lokalen Starttag, ist dann schreibgeschützt und nach dem Leeren des Beginns wieder eingebbar; Datum ohne Uhrzeiten und undatiertes Event bleiben möglich. Eigene Dispositionszeiträume je Einheit liegen unter „Erweitert“, nennen ihre gespeicherten Werte schon im zugeklappten Zustand, werden unverändert übernommen und bei einem verborgenen Fehler geöffnet und fokussiert. Speichern-Erfolg und Ladefehler bleiben getrennt, ungespeicherte Eingaben werden vor einem erneuten Laden nur nach Bestätigung verworfen. Keine Server-, API-, Datenbank- oder Migrationsänderung; Pflichtprüfungen zu Quelle, Prüfstatus, Fotobox und Belegung bleiben unverändert.

Ein Nachtrag nach der unabhängigen Prüfung behebt zwei Befunde: Ein korrigiertes Terminfeld löscht seinen Fehler und `aria-invalid` ohne erneutes Speichern; Partnerfehler von Beginn/Ende und je Einheit verschwinden mit der Korrektur des anderen Felds, während eine weiterhin unmögliche lokale Uhrzeit ihren aktuellen Feldfehler behält. Termin-Editor und Eventakte verwenden getrennte Fehler-IDs, sodass `aria-describedby` jeweils den eigenen Text nennt. Alle sechs Feldprüfungen der Akte sind mit Fokus belegt; die Prüfung hatte sie zuvor als unbelegt gemeldet.

Lokal grün: Format, Lint, Typen, Build, 187 Unit-, 197 Komponenten- und 237 Integrationstests, der Chromium-Passwort- und -Google-Ablauf, Coverage 97,68 % Zeilen und 94,57 % Zweige (`ResourceAssignments.tsx` 100 % Zeilen und 93,8 % Zweige, `EventTimeField.tsx` 100 % Zeilen und 89,7 % Zweige). Die tatsächliche DOM-Geometrie wurde mit dem gebauten Admin-Bundle und erfundenen Daten in Chromium gemessen: bei 1280 px stehen Datum, Beginn und Ende in einer Zeile, bei 390 px gestapelt, jeweils ohne horizontalen Überlauf; „Erweitert“ öffnet über den echten Summary-Klick. **Kein Testbetriebs-Update, kein Deployment, kein Merge nach `main`.**

Offen und bewusst nicht in diesem Slice: eine eigene Führung für gleichzeitige 409-Konflikte in der Akte. Die manuellen UTC-Versatzfelder der zeitweisen Ressourcensperren (`ResourceBlocks.tsx`) sind mit H040 erledigt: Der Bereich fragt nur lokale Sperrzeiten ab, löst den Versatz automatisch auf und behält gespeicherte Zeitpunkte exakt.

### Arbeitsnachtrag 20.10.2026 (H025: Härtung des Event-Editors nach der Prüfung)

Branch `codex/ux-event-simplification`. Der Slice behebt ausschließlich bestätigte Befunde der beiden unabhängigen Prüfungen zu H023/H024: „Weitere Angaben“ nutzt die volle Formularbreite mit einem responsiven Feldraster (im echten Chromium-DOM gemessen: 1238 px in einem 1280-px-Gitter, vier Spalten, 21 px Rand beidseitig; mobil 345,8 px, eine Spalte, kein horizontaler Überlauf; vorher 297,5 px in einer Spalte), ein aus dem Beginn abgeleitetes Datum ist schreibgeschützt und erklärt, dass es dem Starttag folgt, weitere Kontakte werden ohne den Hauptkontakt normalisiert statt mit einer unsichtbaren Blockade zu enden, ein erneutes Laden der Akte verlangt bei ungespeicherten Status- oder Ressourceneingaben eine Bestätigung und verwendet danach die frisch geladene Version, jeder erfolgreiche Listenabruf löscht einen alten Neuladehinweis, eine bestätigte Ressourcenspeicherung bleibt bei fehlgeschlagener Listenabfrage im stabilen Elternteil sichtbar, und Hinweistext und Schaltfläche sind getrennt. Keine Server-, API-, Datenbank- oder Migrationsänderung.

Lokal grün: Format, Lint, Typen, Build, 187 Unit-, 187 Komponenten- und 237 Integrationstests, alle vier Chromium-Abläufe, Coverage 97,64 % Zeilen und 94,66 % Zweige. Der Chromium-Ablauf prüft die Schreibsperre des Datums und den Datumswechsel 16.10.→16.11. über den Beginn. **Kein Testbetriebs-Update, kein Deployment, kein Merge nach `main`.**

Offen und bewusst nicht in diesem Slice: die UTC-Versatzfelder der Ressourcen- und Sperrdisposition, die H026/H040 inzwischen ohne Versatzfelder umgesetzt haben (Eventakte und zeitweise Sperren; done in H040), und eine eigene Führung für gleichzeitige 409-Konflikte in der Akte, die heute nur eine Meldung mit Aufforderung zum Neuladen erzeugt.

### Arbeitsnachtrag 20.10.2026 (H022: Zeitumstellung ohne UTC-Versatzfelder)

Branch `codex/ux-event-simplification` (abgezweigt von `origin/codex/local-runtime-ci`). Die Eventoberfläche fragt beim Anlegen, Bearbeiten und Duplizieren nur noch lokales Datum und lokale Uhrzeit ab. Eindeutige Zeiten löst `apps/admin/src/event-time.ts` in der Eventzeitzone auf; doppelte Herbststunden zeigen ausschließlich dort eine Auswahl Sommerzeit/Normalzeit, Frühjahrslücken einen Feldfehler. Unveränderte Zeiten behalten den gespeicherten Zeitpunkt (auch in der doppelten Stunde und mit Millisekunden); geänderte Datums-/Zeitwerte verwenden keinen alten Versatz mehr. Die Versatzfelder der Ressourcen- und Sperrdisposition sind bewusst unverändert. Keine Server-, API-, Datenbank- oder Migrationsänderung.

Lokal grün: Format, Lint, Typen, Build, 184 Unit-, 164 Komponenten-, 237 Integrationstests, Changed-Code-Coverage (`event-time.ts` 97,4 % Zeilen / 100 % Zweige, `EventTimeField.tsx` 100 % Zeilen / 92,9 % Zweige) und die vier Chromium-Abläufe inklusive echtem Datumswechsel 16.10.→16.11. und zurück. **Der Testbetrieb wurde in dieser Sitzung nicht aktualisiert und es wurde nichts ausgeliefert**; Containerstand und CI-Lauf dieses Commits sind beim Fortsetzen zu prüfen.

### Laufzeitnachtrag 20.10.2026 (C051.3: Angebote in der Eventakte)

Geprüfter Stand **`35fa588e6098184db126f37319e9dc1ccad17905`**, [CI-Lauf 39429748089](https://github.com/gcode-de/auftragskompass/actions/runs/39429748089) vollständig grün, einschließlich Changed-Code-Coverage und beiden Images. Die drei Testcontainer `ak-test-api`, `ak-test-worker` und `ak-test-admin` sind gesund auf genau dieser Revision. Im ausgelieferten Admin-Bundle stehen die neuen Texte „Angebote“ und „Entwurf anlegen“; der Abschnitt listet Dokumente des Events, legt Entwürfe aus einer aktiven Angebotsvorlage mit dem Hauptkontakt an, finalisiert und verlinkt die PDF.

Abgesichert durch 159 Komponententests (acht neue), 182 Unit- und 237 Integrationstests; die neue Datei liegt bei 94,3 % Zeilen und 89,7 % Zweigen. Eine echte Browser-/Screenshot- und axe-Abnahme des neuen Abschnitts fand in dieser textbasierten Sitzung nicht statt; Rollen, zugängliche Namen und Zustände sind über die Komponententests geprüft.

Offen: Gültigkeitsdatum und Status `sent`/`expired`/`accepted`, Bearbeiten von Entwürfen, Logo-Upload in der Oberfläche, Rechnungsarten (C054).


### Laufzeitnachtrag 20.10.2026 (C049.1 und C048.1: PDF-Download und Logo)

Geprüfter Stand **`e7c336a249e81f399482be6c0289f6b8547cd432`**, [CI-Lauf 39418950570](https://github.com/gcode-de/auftragskompass/actions/runs/39418950570) vollständig grün, einschließlich Changed-Code-Coverage und beiden Images. Die drei Testcontainer `ak-test-api`, `ak-test-worker` und `ak-test-admin` sind gesund auf genau dieser Revision; der automatische Updater hat sie übernommen. In der Testdatenbank stehen die Anwendungsmigrationen `0030_documents` und `0031_document_logos` mit Prüfsumme (31 Anwendungsmigrationen; dazu kommen drei Gateway-Migrationen in derselben Tabelle). Das Volume `ak-test-documents` bleibt an `/data` gebunden und ist im Container beschreibbar.

Neu in dieser Revision: `GET /api/v1/documents/:id/pdf` liefert die finalisierte PDF über den gespeicherten Hash; `PUT /api/v1/document-layout/logo` nimmt PNG oder JPEG bis 512 KB an, prüft die Signatur gegen den deklarierten Typ, legt die Bytes im Storage-Adapter ab und referenziert sie im Layout; beim Finalisieren wird das Logo als `data:`-URI eingebettet.

Offen: Oberfläche für Angebote, Gültigkeitsdatum und Status `sent`/`expired`/`accepted`, Rechnungsarten (C054).

### Laufzeitnachtrag 20.10.2026 (C051: Angebote persistieren und finalisieren)

Geprüfter Stand **`58469ee8235aafc4fa3b8500f3eb28a999843671`**, [CI-Lauf 39412962126](https://github.com/gcode-de/auftragskompass/actions/runs/39412962126) vollständig grün, einschließlich Changed-Code-Coverage und beiden Images. Die drei Testcontainer `ak-test-api`, `ak-test-worker` und `ak-test-admin` sind gesund auf genau dieser Revision; der automatische Updater hat sie selbstständig übernommen.

Neu in dieser Revision: Migration `0030` (`documents`, `document_lines`), Entwurf und Finalisieren in einer Transaktion mit Nummernvergabe, Snapshot, Chromium-PDF und inhaltsadressierter Ablage, die drei Dokumentrouten sowie die Auditaktionen `document.created`/`document.finalized`. Betrieblich nachgewiesen: Das Host-Quadlet des API-Containers bindet `ak-test-documents.volume` an `/data` (neue Quadlet-Datei `ak-test-documents.volume`), der Container bleibt healthy, und im laufenden Container als Benutzer 1000 schreibt, liest und löscht der Storage-Adapter unter `/data`; Chromium erzeugt dort eine PDF mit `%PDF-`-Kopf und 7.113 Bytes. Ohne das Volume wäre die Ablage im Container-Dateisystem gelandet und bei jedem Update verloren gegangen.

Lokal: 181 Unit-, 231 Integrations- und 151 Komponententests sowie vier Chromium-Abläufe grün, Format, Lint, Typen und Build grün. Der lokale `test:ops`-Lauf meldet auf macOS einen Fehlschlag im Backup-Phasentest, der unverändert schon auf dem Basiscommit auftritt; die Linux-CI ist vollständig grün.

Offen: Oberfläche für Angebote, Gültigkeitsdatum und Status `sent`/`expired`/`accepted`, PDF-Download (C049.1), Logo (C048.1) und die Rechnungsarten (C054).

### Laufzeitnachtrag 19.10.2026 (M4-Grundlagen und Betreiberkorrekturen)

Geprüfter Stand **`cbbb8551e9f2aecf90df3f9ed41c0700abf8b3fe`**, CI-Lauf 39384215640 vollständig grün (Qualität und Images). Darin neu: C049 — Chromium rendert PDFs. Im Container nachgewiesen: eine Probe in `ak-test-api` erzeugt ein PDF mit 13.455 Bytes und korrektem `%PDF-`-Kopf. Preis dafür: das Runtime-Image wächst von 572 MB auf 1,3 GB, weil API und Worker sich ein Image teilen und die öffentlich erreichbare API Chromium damit mitführt, aber nie nutzt. Sinnvolle Abhilfe wäre ein eigenes Worker-Image; das verlangt einen dritten Zielpfad im privaten Updater (`scripts/auto_update.py` kennt bisher nur `runtime` und `admin`). Auf dem Podman-Testhost laufen `ak-test-api`, `ak-test-worker` und `ak-test-admin` gesund auf genau dieser Revision; der automatische Updater hat sie selbstständig übernommen. In dieser Revision enthalten: Vorbelegung `DE` für neue Website-Kontakte, sichtbare Build-Version in der Navigation, Migrationen `0026` (Dokumentvorlagen), `0027` (Nummernkreise), `0028` (Dokumentlayout) und `0029` (Kalender-Abos ohne Ablauf), dazu die Betreiberkorrekturen H021: Kalender-Abos laufen nicht mehr ab, Termine sind echte Ganztagstermine, und „Menü schließen"/„Abmelden"/„Dunkelmodus" sind Icon-Schaltflächen. Betrieblich nachgewiesen: `expires_at` ist in der Testdatenbank nullable ohne Default, der Text „läuft nicht ab" und das `aria-label` „Menü schließen" stehen im ausgelieferten Admin-Bundle, und im Runtime-Image erzeugt `ics.js` einen Ganztagstermin mit `ALLDAY`-Kennzeichen ohne `DURATION`-Eigenschaft. Offen bleiben die PDF-Erzeugung (C048.1 Logo, C049) und die eigentlichen Angebote/Rechnungen (C051/C054).

### Betriebsnachtrag H020 (19.10.2026)

Auf ausdrücklichen Nutzerwunsch wurde das GitHub-Repository öffentlich geschaltet.
Der [automatische Update-Dienst](automatic-updates.md) ist auf dem Proxmox-Host
aktiviert: fünf Minuten nach dem letzten Lauf, nur grüner aktueller Branch-Head,
koordinierte Digest-Pins, pausierter Checkpoint und geprüfte CT-/Hostkopie vor dem
Wechsel. Gemeinsames Schloss mit dem privaten manuellen Updater, dauerhafte
Fehlersperre statt automatischem Schema-Rollback. Kein GitHub-Token installiert.
Der erste echte Lauf aktualisierte auf den grünen Planungscommit
`906a3e0a6eb8298e4193a4fc6c63b3d68d377160`; alle drei App-Container gesund mit exakt
dieser Revision. Gateway und andere Dienste bleiben außerhalb dieses Updaters.
Die folgenden Angaben zu H018 bleiben dessen historischer Feature-Nachweis.

- Feature-Commit **`5281c9d41ffa8db99e10d37c7669fa856d47f8b0`**, `fix: keep authenticated sessions valid for 90 days` (H018), auf `codex/local-runtime-ci` gepusht.
- [GitHub-Lauf 39210100093](https://github.com/gcode-de/auftragskompass/actions/runs/39210100093) vollständig erfolgreich, einschließlich Qualität und Images.
- Lokal: Format, Lint, Typen, Workspace-/Dokumentationsprüfungen, Coverage mit **443 Tests**, **vier Chromium-Abläufe** und Build grün. CI führte zusätzlich ihre vollständigen Gates einschließlich Betriebsproben aus.
- Testinstallation auf genau diesem Commit aktualisiert. API, Worker und Admin waren gesund; alle drei OCI-Revisionslabels stimmten exakt überein. Im gestarteten Runtime-Image waren `7776000` Sekunden Sitzungsdauer geprüft; anonymer `/auth/me`-Abruf blieb 401.
- Vor Update wurden App-Dienste pausiert und eine Sicherung erzeugt; Host- und Betreiberrechner-Kopie hatten verifizierte identische Prüfsummen. Echte Buchungen und Inhaberpasswort wurden nicht geändert.
- Spätere reine Dokumentationscommits können Git-HEAD vor diesen Laufzeitstand setzen. Daraus nicht automatisch ein fehlendes Feature-Deployment ableiten; tatsächlichen Stand neu prüfen.

### Anmeldung seit H018

Neue Passwort- und Google-Sitzungen gelten **90 Tage absolut ab Anmeldung**, Cookie und Datenbank mit gemeinsamer Dauer. Zugriffe verlängern die Frist nicht. Bestehende Sitzungen behalten ihre alte Frist; der Benutzer muss einmal neu anmelden, um 90 Tage zu erhalten. Logout, Passwortwechsel, Betreiber-Reset und Kontosperre widerrufen weiter sofort. Cookies löschen/Privatmodus kann frühere Neuanmeldung verursachen. Details: [Authentifizierung](authentication.md).

## Verbindlich weiterzuverwendende Skills

Die Nutzeranforderung zur Weiterverwendung steht zusätzlich in [AGENTS.md](../AGENTS.md), damit sie beim Sessionstart geladen wird. Vor erster Anwendung die tatsächliche installierte Version lesen und Skill-Einsatz ankündigen; diese Tabelle allein lädt oder installiert keinen Skill. Bei fehlendem Skill Verfügbarkeit klären und nicht behaupten, er sei genutzt worden.

Lokale Basis auf dem bisherigen Rechner: `~/.codex/skills/`.

| Skill | Einsatz und bisheriger Kontext | Lokaler Einstieg |
|---|---|---|
| **Ponytail**, full | Alle Codeaufgaben, Fixes, Refactorings und Reviews. Kleinste vollständige Lösung; vorhandene Muster/Abhängigkeiten bevorzugen. Keine Abstraktionen auf Vorrat, niemals Sicherheit/Tests/Zugänglichkeit kürzen. Vom Nutzer ausdrücklich verlangt. [Genannte Quelle](https://github.com/DietrichGebert/ponytail) | `ponytail/SKILL.md` |
| **Impeccable** von Paul Bakaus | Frontend-Entwurf, Review, responsive Zustände, Kontrast, Fokus, UX-Texte und Designsystem. Aktuellen Workflow einschließlich erforderlichem unabhängigen Finish-Review und Dokumentation vollständig beachten. [Genannte Quelle](https://github.com/pbakaus/impeccable) | `impeccable/SKILL.md` |
| **emil-design-eng** | Emil-Kowalski-Prinzipien für UI-Politur und Bewegung: Zweck, Unterbrechbarkeit, Tastatur und reduzierte Bewegung. Entspricht dem angeforderten Emil-/Motion-Kontext; nicht als zusätzlich installiertes Paket namens „motion“ ausgeben. | `emil-design-eng/SKILL.md` |
| **animate** | Passender lokaler Skill für konkrete neue Animationen/Übergänge, wenn die Aufgabe sie erfordert. Bisherige Bewegungsregeln nicht allein wegen Skill-Verfügbarkeit ausweiten. | `animate/SKILL.md` |
| **design-taste-frontend** (Taste, Leon Lin; aktuell v2) | Für unterstützte öffentliche Seiten und passende Komponenten. Aktuelle Fassung schließt Dashboards/App-Screens aus; bei schmalen Komponentenänderungen bestehende Richtung und Komponenten-Ausnahme beachten. Kein Marketing-Redesign der Verwaltungs-App erzwingen. | `taste-skill/SKILL.md` |
| **design-taste-frontend-v1** | Lokal vorhandene Altversion, kein pauschaler Standard. Nur bei begründetem Bedarf an genau dieser Fassung. | `taste-skill-v1/SKILL.md` |

Keine Skill-Texte unkontrolliert ins Repo kopieren. Auf anderem Rechner müssen diese Installationen gesondert verfügbar gemacht werden. Spezialisierte Review-/Documenter-Rollen waren zuletzt nicht verfügbar; Impeccable-Rollen wurden durch frische generische Ersatzagenten erfüllt und als solche dokumentiert. Agenten nicht grundsätzlich parallel starten, sondern nur gemäß aktuellen Benutzer-/Skill-/Agentenregeln.

### Arbeitsnachtrag 22.10.2026 (H036: eine primäre Aktion je Fläche, Phase 1 ohne Commit)

Branch `codex/ux-event-simplification`, Basis `c52e4ca`. Reine Darstellungs-Hierarchie im Admin-Bundle: kein Layout-, kein Positions-, kein Wortlaut- und kein Funktionswechsel, keine API-/Datenbank-/Auth-Änderung.

`apps/admin/src/styles.css` hat jetzt einen kleinen gemeinsamen Satz statt „alle Knöpfe grün": `--action`/`--action-hover`/`--action-border` für die eine gefüllte Primäraktion, `--quiet-ink`/`--quiet-action-border` für Sekundär und Tertiär, dazu `.primary-action`, `.secondary-action`, `.tertiary-action`, `.nav-action` sowie die Icon-Modifikatoren `.tier-primary-icon` (einziges anlegenden Icon je Bereich) und `.tier-quiet-icon`. Die Stufen unterscheiden sich in Füllung, Rand **und** Schriftgewicht, nie nur in der Farbe; deaktivierte Aktionen haben Deckkraft plus gestrichelten Rand; `:focus-visible` bleibt 3 px bei 3 px Offset, und alle Stufen halten 44 px, auch die ruhigste.

Angewendet auf Anmeldung/Abmelden/Theme, Events-Liste, -Filter und -Editor, Anlegen-Dialog, Event-Details, Ressourcenzuweisung, Sperren, Kalender, Kontakte inkl. Dialog, Dateien, Website-Eingänge, Angebote, Stammdaten, Ressourcen, Produkte, Kalender-Abos und Konto/Zugriff. H031s Icon-Aktionen bleiben unverändert benannt und ruhig; sie werden nur in denselben Satz einsortiert. Die Event-Detailflächen (Übersicht, Angebote, Ressourcen) behalten je eine eigene primäre Aktion, weil sie eigenständige Bereiche sind.

Fail-first belegt: `tests/component/action-hierarchy.test.tsx` (12 Tests) lief zuerst komplett rot und prüft je Fläche genau eine primäre Aktion, benannte Stufen für jede sichtbare Aktion, Icon-Stufen, den Stylesheet-Vertrag (Tokenpaare, 44 px, Fokus, deaktiviert) und WCAG-AA-Kontrast in Hell und Dunkel. `tests/component/ui-language.test.tsx` bekam eine Mount-Reihenfolge-Härtung, weil die Grundlinie der Abrufzähler den abgeschlossenen Erstaufbau voraussetzt — ohne sie war der Test sporadisch rot, auf dem Basisstand nicht.

Lokal mit Node 24.15.0 (`pnpm --use-node-version=24.15.0`, seriell): 227 Unit-, 341 Komponenten- (achtmal hintereinander stabil), Format, Lint, Typen, Build, Workspace- und Dokumentationsprüfung sowie alle sechs Chromium-Abläufe grün. Zusätzlich im echten Chromium gegen das gebaute Bundle mit synthetischen Antworten: 246 sichtbare Aktionen auf sechs angemeldeten Flächen in beiden Themen bei 1280/390/320 px ohne Kontrast- und ohne 44-px-Verstoß, ohne Body-Überlauf; die Anmeldeseite ebenso; Fokusrahmen 3 px/Offset 3 px in beiden Themen. Coverage, Linux-CI und Testbetrieb folgen nach dem Commit; der macOS-`RLIMIT_FSIZE`-Backuptest bleibt unverändert lokal rot. **Kein Commit/Push/Deploy in Phase 1.**

### Bestehende Gestaltungsgrundlage und Prüfgrenzen

- [Admin-DESIGN.md](../apps/admin/DESIGN.md) und [Design-Sidecar](../apps/admin/.impeccable/design.json) sind maßgebliche lokale Gestaltungskontexte: ruhige grüne Farbrollen, Systemschrift, mobile Bereiche statt alles gleichzeitig, mindestens 44px Bedienflächen, sichtbarer Fokus, Hell/Dunkel.
- [Widget-Surface-Brief](../apps/widget/.impeccable/surfaces/inquiry-form.md) dokumentiert die schmale Erweiterung der bestehenden Formularsprache. Keine neue Markenwelt, Rasterbilder oder neue Schriftbibliothek nötig.
- E004.18: unabhängiger Finish-Review `ship`, acht Widget-axe-Prüfungen ohne Befund; Hell/Dunkel bei 390/768/1440px sowie Fehler/Erfolg visuell geprüft. Impeccable-Detector `[]`, Taste-Quelllint 0 FAIL/0 WARN.
- Der Taste-Browserinspektor sah nur die Vorschauhülle außerhalb des Shadow DOM. Das ist **kein** automatischer Komponenten-Prüfnachweis. Separate Captures und Chromium/axe decken die Komponente ab. Physische iOS-/Android-Geräte und echte WordPress-Einbettung bleiben offen.
- Der Impeccable-Launcher war nicht direkt ausführbar; Kontext wurde direkt gelesen, spätere Launcher-Aufrufe über `sh` funktionierten. Tatsächlichen Zustand neu prüfen; keinen erfolgreichen automatischen Kontextlauf behaupten. Details im [Formularvertrag](website-inquiry-intake.md).

### Arbeitsstand 22.10.2026 (H032 Website-Eingänge als Option, Code uncommittet)

Arbeitskopie auf `codex/ux-event-simplification`, Basis-HEAD `9984cbf`. Nicht
committet, nicht gepusht, nicht deployt. Die unabhängige Prüfung bestätigte
genau einen deployment-kritischen Defekt (Bereitschaft hing an einer optionalen
Einstellung); er ist behoben, siehe „Optionale Konfiguration“ unten.

- Gesicherte Website-Eingänge werden automatisch als unverbindliche Option
  angelegt: `receiveWebsiteInquiry` hat einen optionalen Status (Standard
  `inquiry` für bestehende Aufrufe), Automatikpfad und autorisierte manuelle
  Wiederholung erzeugen `option`. Keine Uhrzeiten, keine Reservierung, keine Mail,
  kein Paket; Herkunft, Original-Payload und Logbuch `website_received` bleiben.
- Der Worker startet den Lauf `startWebsiteOptionDrain` über
  `apps/worker/src/worker-start.ts`; fachliche Ausnahmen bleiben sichtbar, nur
  Infrastrukturfehler machen den Worker „nicht bereit“.
- **Optionale Konfiguration:** `AK_INQUIRY_TENANT_ID` und
  `AK_INQUIRY_OPERATOR_ID` sind optional. Fehlen beide, startet kein Takt, der
  Worker protokolliert einmal `website_option_drain_unconfigured` als Warnung
  und bleibt gesund; alle Eingänge bleiben als Ausnahmen sichtbar. Genau eine
  der Kennungen oder eine Nicht-UUID gilt weiterhin als Fehler
  (`website_option_config_invalid`, nicht bereit). Eine kaputte
  Sync-Konfiguration bricht den Start nicht mehr ab
  (`inquiry_sync_config_invalid`, Transport bleibt aus). Bereitschaft:
  `expiry && (!drain || drain.ready()) && (!sync || sync.ready())`.
- **Vor dem nächsten Deployment:** Das Quadlet
  `infrastructure/podman/ak-test-worker.container` setzt Platzhalterwerte für
  Mandant und Betreiber. Die Betreiber-ID ist die Benutzer-ID des
  Bootstrap-Kontos dieser Installation und ändert sich bei Neuinstallation oder
  Wiederherstellung. Der Betreiber muss echte Werte eintragen oder beide Zeilen
  entfernen (dann nur Ausnahmen, Worker bleibt gesund).
- Land für neue Kontakte ist eine Deployment-Einstellung
  (`AK_INQUIRY_DEFAULT_CONTACT_COUNTRY`), kein Domänenwert. Ohne sie bleibt ein
  Eingang mit neuem Kontakt als `contact_review`-Ausnahme stehen. Die
  Vorbelegung DE aus der Entscheidung vom 19.10.2026 wird nur gesetzt, wenn die
  Umgebung sie vorgibt; in `.env.example` ist sie auskommentiert dokumentiert.
- Die Oberfläche heißt „Website-Eingänge (Ausnahmen)“ und listet nur noch nicht
  automatisch angelegte Eingänge.
- Lokal grün: 226 Unit-, 315 Komponenten-, 274 Integrationstests (39 davon
  Website-Eingänge), Chromium-Passwortablauf, Format, Lint, Typen, Build und
  Dokumentationsprüfung. Coverage, vollständige Chromium-Suite, CI und
  Testbetrieb werden nach dem Push belegt; H036 bleibt offen, H035 ist bereits
  released.
- Der Linux-CI-Befund zum lokalen macOS-`RLIMIT_FSIZE`-Backuptest bleibt
  unverändert bestehen; diese Sitzung hat ihn nicht angefasst.

## Wichtige Benutzerentscheidungen

- Eigener Login mit E-Mail/Benutzername und Passwort. Authentik oder Google nicht ungefragt aktivieren; Google-OIDC bleibt optional. Kein Ändern des echten Inhaberpassworts im Rahmen normaler Entwicklungsarbeit.
- Mobile Bedienung priorisieren; Menü, getrennte Arbeitsbereiche und Eventakten-Unterbereiche sowie Hell-/Dunkelumschalter beibehalten. Bookitup-Screenshots waren Strukturreferenz, kein Auftrag zur pixelgleichen Kopie.
- Das Formular von `fotobox-bw.de` zunächst vollständig mit seinen **acht bisherigen Feldern** übernehmen. Später Inhalte konfigurierbar machen und mehrere Formulare ermöglichen. Aktueller Vertrag, Paketwerte und Datenschutztext stehen versioniert in der gemeinsamen Definition; keine Werte neu erfinden.
- Ein Anfrageeingang ist keine feste Buchung. Unklarer Empfang wird mit unverändertem Inhalt und gleicher ID wiederholt. Neue Entscheidung vom 19.10.2026: Deutschland darf für neue Website-Kontakte ausdrücklich vorbelegt werden; bestehende Kontakte nicht ändern. Das ist umgesetzt: das Prüffeld startet mit `DE`, bleibt änderbar, und der Server verlangt das Land weiterhin explizit — wer das Feld leert, erhält wie bisher den Prüf-Fehler.
- Fünf bestätigte Eventarten: Hochzeit, Geburtstag, Firmenfeier, Weihnachtsfeier, sonstiges. Eine ältere Angabe „sieben“ ist kein Anlass, zwei weitere zu erfinden.
- LibreOffice ist als Übergang für Angebote/Rechnungen gewählt, aber Nummernfortführung, offene Posten und vollständiger Ersatzablauf sind nicht abgenommen.
- Bookitup: historische Auftragsübersichten reichen; keine weiteren historischen Detailakten sichern. Zukünftige Aufträge sind relevant. Zusätzlich Vorlagen, Standarddateien, erreichbare Finanzstände, Nummernkreise und Stammdaten erhalten. Relevante versandte Angebote/Rechnungen liegen nach Betreiberangabe im eigenen Mailbestand; keine redundanten Belegdownloads ohne Anlass.
- Bestehende Sicherung ist noch nicht gleich fachlich abgenommen oder unabhängig gesichert. Kunden-/Bankdaten nicht aus Bildschirmtexten erraten. [Bestand und offene Abnahme](bookitup-exit.md), [Normalisierung](bookitup-normalization.md), [Minimalimport](minimal-import.md).
- Jeden fertigen Commit sofort pushen, keine Force-Pushes/Amends gepushter Commits. Docker-Hub-Veröffentlichung automatisiert nach grüner CI. Neue Nutzerentscheidung vom 19.10.2026: [koordinierte automatische Testupdates](automatic-updates.md) mit Sicherung und Digest-Pins aktivieren (H020); nicht durch unabhängige Watchdog-/Registry-Neustarts ersetzen.

## Nächste sinnvolle Arbeit

Noch keine neue E004.19-Implementierung allein durch diese Übergabe beauftragt. Vor Codeänderung den tatsächlichen Einstieg in `apps/gateway` und `apps/worker` lesen; Bibliotheks-/Contract-Tests sind kein Nachweis einer betriebenen Verbindung.

1. ~~Slice für die öffentliche Gateway-Laufzeit festlegen~~ **erledigt als C028** (`2543107`): `apps/gateway` startet als eigener Fastify-Prozess mit validierter Konfiguration, eigenen Migrationen und Opt-in-Compose-Profil; keine neue öffentliche Admin-API.
2. ~~Dauerhaften Abhol-/Quittierungslauf in den Worker einbinden~~ **erledigt als C028** (`7107edb`): `startWebsiteInquirySync` fährt den vorhandenen signierten Transport mit Signaturprüfung und Wiederholschutz und verlangt eine aktive Betreiberberechtigung als handelnde Identität; ohne `AK_GATEWAY_ORIGIN` bleibt der Takt inert, der laufende Testbetrieb ist nicht betroffen.
2a. **Als Nächstes C028.1:** Gateway mit synthetischen Schlüsseln real kalt starten und den Worker dagegen laufen lassen, statt Pull-Antworten im Test zu stubben. Podman-Secrets `ak-test-gateway-storage`/`ak-test-gateway-sync` anlegen und die Platzhalter im Quadlet ersetzen. Der automatische Testupdater fasst nur `api`, `worker` und `admin` an; Gateway bleibt bewusst außerhalb.
3. Gateway-Hosting, öffentliche Zieladresse, WordPress-Einbettung/CSP und tatsächlichen Anfrageweg mit synthetischen Daten abnehmen. Erst danach kontrollierte Website-Umschaltung; bis dahin das alte Formular nicht entfernen.
4. Angebot/Rechnung als gezielt priorisierten M4-Ausbau weiterführen: C051 (Persistenz und Finalisieren) ist umgesetzt, als Nächstes bieten sich Oberfläche, PDF-Download, Logo oder die Rechnungsarten an. Den LibreOffice-Ersatzablauf konkret abnehmen; nicht automatisch den gesamten M3/M5/M6-Umfang vorziehen.
5. Parallel nötige Betreiberentscheidungen: unabhängiges Backupziel und Aufbewahrung, private Importkorrekturen, Länder-/Kontaktzuordnung, reale Zukunftsaufträge und tatsächliche Boxzuweisungen. Erst mit fachlicher Freigabe übernehmen.

## Betrieb und Datenschutz

- Testbetrieb auf Podman/Proxmox hinter bestehendem Reverse Proxy und Cloudflare-Tunnel; genaue Host-/Kontodaten und private Werkzeuge stehen ausschließlich in der privaten Betreiberübergabe. Architektur `linux/amd64`; andere Architekturen nicht als geprüft behaupten.
- [Home-Lab-Anleitung](homelab.md), [Betrieb](operations.md), [Störungen](incidents.md), [verschlüsselte Sicherung](backup-encryption.md), [Backupzeitplan](scheduled-backup.md) und [Kalender-Abos](calendar-feeds.md) lesen, wenn betroffen.
- Nur vollständig grüne CI samt beiden Images deployen. Privater manueller Updater nutzt `scripts/update_checkpoint.py`: App-Dienste vor konsistentem Dump pausieren, vor Image-/Schemaänderung Sicherung prüfen. Host-/Betreiberkopie mit gleicher Prüfsumme bestätigen, danach drei gesunde App-Container und exakte OCI-Revision prüfen. Keine parallelen manuellen Updates.
- Bei Checkpointfehler nicht fortfahren. Nach Migration niemals automatisch alte App gegen neues Schema starten; erforderlichen Restore bewusst und geprüft durchführen.
- Reale Kunden, E-Mails, Adressen, Dateien, Tokens, Exporte, Sicherungen und Zugangsdaten bleiben außerhalb Git. Root-Allowlist nicht erweitern, nie pauschal stagen; in Tests nur sichtbar fiktive Daten.
- Keine echte Buchungsübernahme, Kündigung, Kundennachricht oder Produktivumschaltung ohne entsprechenden konkreten Auftrag/Abnahme.
- Die einmalige Wiederaufnahme-Automation `auftragskompass-nach-reset-fortsetzen` wurde nach Abschluss gelöscht. Nicht erneut anlegen oder alte Kontingentschwellen als aktuellen Dauerauftrag übernehmen. Bei neuer ausdrücklich kontingentgesteuerter Arbeit tatsächliche Fünf-Stunden-/Wochenlimits prüfen; keine manuellen Resets oder Credits-Ausweichlösung aus früheren Anweisungen ableiten.

## Orientierung im Code und in den Dokumenten

| Thema | Einstieg |
|---|---|
| Geschäftsmodell/Anforderungen | [Lastenheft](../Lastenheft_Fotobox-Verwaltung_MVP.md), [Entscheidungen](decisions.md), [Plan](../IMPLEMENTATION_PLAN.md) |
| Authentifizierung/Sitzungen | [Anmeldung](authentication.md), `packages/core/src/auth-config.ts`, `auth.ts`, `access.ts`, `password-access.ts` |
| Website-Pipeline | [Formular-/Übergabevertrag](website-inquiry-intake.md), [Gateway](inquiry-gateway.md), [Gateway-Inbox](inquiry-inbox.md), [lokale Anfragen](website-inquiries.md), [Protokoll](gateway-protocol.md) |
| Öffentliche Komponente | `apps/widget/src/InquiryForm.tsx`, `mount.tsx`, `inquiry-client.ts`, `inquiry-form.css`; gemeinsame Definition `packages/core/src/inquiry-form-definition.ts` |
| Echte Übernahme/Exporte | [Minimalimport](minimal-import.md), [Ressourcenprüfung](import-resource-review.md), [CSV-Exporte](data-exports.md) |
| Qualität | [Testanleitung](testing.md), [Zugänglichkeit](accessibility-audit.md); `pnpm check` führt die vollständige Suite aus |

Node 24 LTS und pnpm 10.2.0 wurden zuletzt verwendet. Wenn der normale Shell-Node abweicht, funktioniert auf dem bisherigen Rechner `npm exec --yes --package=node@24 --call 'pnpm …'`. Für Integration/E2E/Restore werden Docker und Chromium benötigt. Keine gleichzeitig schreibenden Coverage-Läufe starten; bei Docker-Testfehlern nicht pauschal fremde Container oder den gesamten Docker-Dienst neu starten.

## Starttext für eine neue Session

> Arbeite im Repository AuftragsKompass weiter. Lies zuerst AGENTS.md und docs/handoff.md vollständig, danach den aktuellen Implementierungsplan und den relevanten Lastenheft-Abschnitt. Prüfe Git, CI und den tatsächlichen Deploymentstand. Verwende die dort festgehaltenen Skills, insbesondere Ponytail für Code und Impeccable für UI, jeweils mit ihrem aktuellen SKILL.md. Halte dich an einen nummerierten Slice, Tests und sofortigen Push. Der öffentliche Anfrageweg ist noch nicht mit der echten Website verbunden; prüfe die Übergabe, bevor du nächste Schritte auswählst. Keine echten Daten oder Zugangsdaten in Git und kein ungeprüfter Produktivwechsel.
