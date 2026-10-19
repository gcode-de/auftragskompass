# Projektübergabe AuftragsKompass

Stand: **19.10.2026**, nach H018. Einstieg für eine neue Arbeitssession und kompakter Funktionsüberblick. Dieses Dokument ersetzt weder den aktuellen Git-/CI-/Betriebsabgleich noch das Lastenheft. Bei Fortsetzung aktualisieren; keine alten Kontingentwerte oder Chat-Automationen ungeprüft wiederverwenden.

## In der nächsten Session zuerst

1. [AGENTS.md](../AGENTS.md) vollständig lesen; dann diese Übergabe, den relevanten Abschnitt des [Lastenhefts](../Lastenheft_Fotobox-Verwaltung_MVP.md) und den aktuellen Slice im [Implementierungsplan](../IMPLEMENTATION_PLAN.md).
2. `git status`, Branch, Remote und letzte Commits prüfen. Bisheriger Arbeitsbranch: `codex/local-runtime-ci`, Remote: [gcode-de/auftragskompass](https://github.com/gcode-de/auftragskompass). Nicht automatisch zu `main` wechseln oder gepushte Commits umschreiben.
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
| Anmeldung und Oberfläche | Eigener Login mit E-Mail oder Benutzername und Passwort, Passwortwechsel und kontrollierte Betreiber-Wiederherstellung; mobile Navigation, unterteilte Arbeitsbereiche, Hell/Dunkel und eine kleine Build-Version in der Navigation | Weitere lokale Passwortkonten nur bei konkretem Bedarf; Google-OIDC technisch optional, nicht als echter Betreiberlogin eingerichtet |
| Kontakte und Stammdaten | Privat-/Firmenkontakte, Orte, Produkte/Preise, Pakete, Eventarten, Ressourcen und Absagegründe; Suche, Archivierung und Versionsschutz | Fachlicher Abgleich mit echtem Bestand |
| Events und Aufträge | Anlage/Bearbeitung/Duplizieren, Suche/Filter, Monatsgruppen, Eventakte, Status, Notizen und unveränderbares Logbuch | Gesamter kommerzieller Ablauf folgt separat |
| Disposition und Kalender | Physische Boxen/Zubehör, Vormerkungen, feste Buchungen, Datenbank-Konfliktschutz, Puffer, interne Sperren, Tages-/Wochen-/Monatskalender und widerrufbare ICS-Abos | Echter Ressourcenabgleich vor Nutzung; Smartphone-Abnahme des Kalender-Abos |
| Website-Anfragen | Achtfeldrige Definition, öffentliche API, verschlüsselter Gateway-Eingang, signierte/idempotente Übertragung, dauerhafte lokale Ablage, Quittierung, manuelle Prüfung/Übernahme und mobiles einbettbares Formular entwickelt und synthetisch getestet; seit C028 zusätzlich die Gateway-Laufzeit als eigener Prozess und der Pull-/Quittungstakt im Worker als Code vorhanden | Gateway real starten (Kaltstart mit synthetischen Schlüsseln), Podman-Secrets anlegen, erlaubten Website-Origin festlegen, WordPress anschließen und gemeinsam abnehmen |
| E-Mail/Kommunikation (M3) | Geplant | IMAP/SMTP, Zuordnung zu Events/Kontakten, Postfach, Vorlagen, Anhänge, geplanter Versand und Erinnerungen |
| Geschäftsdokumente/Finanzen (M4) | Geplant; LibreOffice als externer Übergangsweg gewählt | Angebote, Annahmen, Auftragsbestätigungen, PDF-Layout, Nummernkreise, Rechnungen/Anzahlungen/Korrekturen und Zahlungen; externer Ablauf noch nicht abgenommen |
| Verträge/Fragebögen (M5) | Bewusst zurückgestellt | Vorlagen, Kundenlinks, Signaturen, Abschlussnachweise, Fragebögen und kontrollierte Übernahme |
| Aufgaben/Auswertungen (M6) | Bewusst zurückgestellt; Absagegründe-Stamm schon vorhanden | To-dos, relative Vorlagen/Fristen, Benachrichtigungen und Absageauswertungen |
| Migration/Betrieb (M7 teilweise vorgezogen) | Minimalimport mit Vorschau/Dry-run/Mapping/Ressourcenprüfung; CSV-Exporte für Kontakte/Events/Produkte; Container, CI, Updates, verschlüsselte Sicherungswerkzeuge und Restore-Proben | Reale Datenübernahme, unabhängiges Sicherungsziel, Aufbewahrung/Timeraktivierung, letzte Delta-Sicherung und fachliche Produktivfreigabe |

C001–C026 sowie C076 sind implementiert; C027–C075 und C077–C085 nicht pauschal als fertig werten. E-/H-Slices ziehen gezielte Teile vor, ohne ganze Milestones als abgeschlossen zu erklären.

## Letzter geprüfter Laufzeitstand

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

### Bestehende Gestaltungsgrundlage und Prüfgrenzen

- [Admin-DESIGN.md](../apps/admin/DESIGN.md) und [Design-Sidecar](../apps/admin/.impeccable/design.json) sind maßgebliche lokale Gestaltungskontexte: ruhige grüne Farbrollen, Systemschrift, mobile Bereiche statt alles gleichzeitig, mindestens 44px Bedienflächen, sichtbarer Fokus, Hell/Dunkel.
- [Widget-Surface-Brief](../apps/widget/.impeccable/surfaces/inquiry-form.md) dokumentiert die schmale Erweiterung der bestehenden Formularsprache. Keine neue Markenwelt, Rasterbilder oder neue Schriftbibliothek nötig.
- E004.18: unabhängiger Finish-Review `ship`, acht Widget-axe-Prüfungen ohne Befund; Hell/Dunkel bei 390/768/1440px sowie Fehler/Erfolg visuell geprüft. Impeccable-Detector `[]`, Taste-Quelllint 0 FAIL/0 WARN.
- Der Taste-Browserinspektor sah nur die Vorschauhülle außerhalb des Shadow DOM. Das ist **kein** automatischer Komponenten-Prüfnachweis. Separate Captures und Chromium/axe decken die Komponente ab. Physische iOS-/Android-Geräte und echte WordPress-Einbettung bleiben offen.
- Der Impeccable-Launcher war nicht direkt ausführbar; Kontext wurde direkt gelesen, spätere Launcher-Aufrufe über `sh` funktionierten. Tatsächlichen Zustand neu prüfen; keinen erfolgreichen automatischen Kontextlauf behaupten. Details im [Formularvertrag](website-inquiry-intake.md).

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
4. Anschließend Angebot/Rechnung als gezielt priorisierten M4-Ausbau besprechen beziehungsweise den LibreOffice-Ersatzablauf konkret abnehmen. Nicht automatisch den gesamten M3/M5/M6-Umfang vorziehen.
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
