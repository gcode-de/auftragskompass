# AuftragsKompass – commitgenauer Implementierungsplan

**Status:** geprüfter Bauplan; C001–C026 und vorgezogen C076 implementiert; übrige C027–C085 offen. Die CI prüft jeden Push.
**Produktgrundlage:** `Lastenheft_Fotobox-Verwaltung_MVP.md`
**Arbeitsweise:** Jeder nummerierte Eintrag ist ein eigenständiger, grüner Commit mit Tests und wird unmittelbar nach Fertigstellung gepusht.

## 1. Lieferstrategie

**Neue Priorität vom 16.10.2026:** Für einen früheren Bookitup-Ausstieg gilt die
[verkürzte Lieferfolge mit Sicherungs- und Umschaltplan](docs/bookitup-exit.md).
M5/M6 werden verschoben; M2/M3/M4 ebenfalls, sofern die dort beschriebenen
externen Ersatzprozesse vor Umschaltung geprüft sind. Notwendige Migration und
Betriebssicherheit aus M7 werden vorgezogen. Die C-Slices unten bleiben der
vollständige Ausbauplan, nicht die Pflichtliste für den verkürzten Erststart.

- [x] E001: Sicherungsmatrix und verkürzte Lieferfolge dokumentiert
- [ ] E002: gewünschter Exportumfang privat gesichert: historische Übersichten, Zukunftsdetails, Vorlagen, Standarddateien, Stammdaten und erreichbare Finanzstände; fachliche Abnahme und unabhängige Zweitkopie offen
- [x] E003: Minimalimport nach [Sicherheitsvertrag und Schritten E003.1–E003.3](docs/minimal-import.md) implementiert und synthetisch geprüft; echte Übernahme und Ressourcenfreigabe separat offen
- [x] E003.1: versionierte, geschützte Importvorschau mit Feld-, Referenz-, Status- und Zukunftsprüfung; keine Schreiboperationen
- [x] E003.2: atomare Übernahme mit Alt-ID-Mapping, Delta-Versionsschutz, expliziten Dublettenentscheidungen und transaktionalem Dry-run; ungeprüfte Zusagen separat
- [x] E003.3: sichtbare Herkunft, Ressourcen-Prüfliste, Mengen-/Versionsabgleich und privater Bericht; synthetischer Gesamtprobelauf; Buchungssperre bei ungeprüften Altzusagen
- [x] H001 (Testbetrieb vorgezogen): Docker-Hub-Images nach grüner CI, getrennte Runtime-/Admin-Tags je Commit für den geprüften amd64-Host; keine Produktivfreigabe. Abnahme: Registry-Konfiguration, Branch-/PR-Schranken und gepinnte Actions geprüft; bestehende Docker-Builds und Qualitätssuite grün. [Einrichtung](docs/homelab.md)
- [x] H002 (Testbetrieb vorgezogen): isolierte Podman-Quadlets für Datenbank, Worker, API und Admin; Loopback-Zugriff, Startfolge und externe Secrets. Abnahme: Schutzregeln getestet und Quadlet-Generator des Zielhosts akzeptiert alle Einheiten. Installation und Browserabnahme bleiben bis zur Login-Entscheidung offen.
- [x] H003: fester Docker-Hub-Name `auftragskompass` aus den vorhandenen USER-/TOKEN-Secrets; Repository vor Veröffentlichung wie ausdrücklich gewählt öffentlich anlegen, vorhandene Sichtbarkeit erhalten; API- und Workflowtests.
- [x] H004: vorhandenes Backup-/Restore-Werkzeug auf benannte Podman-Container erweitern; atomare Sicherung, Dateirechte, getrenntes leeres Restore-Ziel und Schreibsperre beibehalten. Abnahme: Adapter-/Negativtests, bisheriger Compose-Probelauf und isolierter Podman-Probelauf mit veröffentlichten Images; keine Freigabe realer Daten oder der App-Anmeldung.

- [x] H005: eigener Login per E-Mail oder Benutzername und Passwort gemäß Nutzerentscheidung; einmaliger externer Inhaber-Bootstrap, scrypt, persistente Fehlversuchssperre, sichere bestehende Sitzungen und Loginformular. Abnahme: Mandantentrennung, Neustart/Sperre, CSRF, Fehlerfälle und vollständiger Chromium-Geschäftsablauf; bestehendes Google-OIDC unverändert nutzbar. Der eigene Passwortwechsel folgt in H008 und die Betreiber-Wiederherstellung in H009; zusätzliche Passwortkonten folgen bei Bedarf.

- [x] H004.1: CI-Wartebedingung im Import-Oberflächentest korrigiert; erst nach vollständig geladener Ressourcenprüfung bestätigen. Abnahme: betroffener Test und komplette Komponenten-Suite grün.

- [x] H006: Podman-Testinstallation mit eigenem Inhaberkonto, externer einmaliger Passwortdatei und gepinnten veröffentlichten Images. Node-Healthchecks als Exec-Array statt fehleranfälliger Shell-Quotes; optionaler LAN-Port nur für Caddy durch eigene Firewall vor DNAT; bestehende Dienste unverändert. Abnahme: nativer Quadlet-/Firewall-Check, erlaubte/verbotene Zugriffe, Login/Logout, Neustart ohne Bootstrap-Secret und Sicherung; anschließend Caddy und Homer auf Testbetrieb umstellen.

- [x] H007: lesbare responsive Grundgestaltung der vorhandenen Testoberfläche ohne neue UI-Abhängigkeit. Abnahme: bedienbare Eingabegrößen, sichtbarer Tastaturfokus und kein Seitenüberlauf bei 390 px; vorhandene Anmelde- und Geschäftsabläufe bleiben grün.

- [x] H008: eigener Passwortwechsel mit Prüfung des aktuellen Passworts, gemeinsamer persistenter Fehlversuchssperre und atomarem Widerruf aller Sitzungen; nur für lokale Konten, CSRF und Audit unverändert verpflichtend. Abnahme: schwache/falsche Passwörter, gesperrte/fremde Konten, paralleler Widerruf, Audit-Rollback und erneute Anmeldung mit dem neuen Passwort in Chromium.

- [x] H009: kontrollierte Passwortwiederherstellung ausschließlich über den bestehenden SSH-/Podman-Betreiberzugriff; externe geschützte Passwortdatei per stdin, bestehendes aktives Konto, keine Reaktivierung und kein HTTP-Endpunkt. Abnahme: Dateirechte/Git-Grenze, neutrale Ausgaben, Mandantentrennung, Sitzungswiderruf, Audit-Rollback und isolierter nativer CLI-Probelauf ohne Änderung des echten Inhaberkontos.

- [x] C026.1: CI-Screenshot nach dem zweiten Ressourcen-/Terminwechsel erst nach der neu geladenen Eventliste und fertigen Zuweisung aufnehmen; keine pauschale Wartezeit oder Retry. Abnahme: kompletter Chromium-Geschäftsablauf mit einem Worker wiederholt grün.

Die Entwicklung beginnt mit einem bewusst kleinen internen MVP. Dieser kann Kontakte und Events verwalten, FB1/FB2 konfliktfrei reservieren, die Belegung im Kalender zeigen und einen ICS-Feed bereitstellen. Erst danach kommen öffentliche Anfragen, E-Mail, Geschäftsdokumente, Verträge, Fragebögen und weitere Komfortfunktionen hinzu.

Es gibt keine lange Integrationsphase am Ende: Jeder Commit liefert einen vertikalen, testbaren Fortschritt. Datenbank, API und Oberfläche werden für ein Feature möglichst gemeinsam erweitert.

C001 wird mit dieser Planprüfung nachgebessert; es wird noch kein Implementierungsschritt vorgezogen. Prüfungen: `python3 -B scripts/check_docs.py` und `python3 -B -m unittest discover -s tests/docs -v`. Die Zuordnung aller Anforderungen steht in [docs/requirements.md](docs/requirements.md), die fachlichen Präzisierungen in [docs/decisions.md](docs/decisions.md).

- [x] C001: Planungsunterlagen und überprüfbare Anforderungszuordnung
- [x] C002: privater TypeScript-Workspace mit Build und Typecheck
- [x] C003: Format-, Lint- und Commitprüfungen mit Negativtests
- [x] C004: Vitest, React-Komponenten, PostgreSQL-Testcontainer und Chromium-E2E
- [x] C005: Compose-Clean-start, persistente Daten, Backup/Restore geprüft
- [x] C006: Qualitätsworkflow und Changed-Code-Coverage (CI-Abnahme am gepushten Commit)
- [x] C007: validierte Konfiguration, minimale Logs und Liveness/Readiness
- [x] C008: transaktionale Migrationen, Mandanten und isolierte Benutzer-Repositories
- [x] C009: Google-OIDC, PKCE, sichere Sitzungen, CSRF und Logout
- [x] C010: einmaliger Bootstrap, Kontofreigaben, Sitzungswiderruf, Aussperrschutz und Änderungsnachweis
- [x] C011: unveränderbares Auditlog, atomare Sitzungsereignisse und mandantenbegrenzter Lesezugriff
- [x] C012: Eventarten und Paketwerte mit Archivierung/Versionsschutz; fünf bestätigte Startwerte und feste Status
- [x] C013: konfigurierbare Absagegründe mit acht Startwerten und Erhalt historischer Zuordnungen
- [x] C014: Ressourcenstamm mit getrennten Boxen/Zubehör, Bestand, Puffern, Sperre und Archivierung
- [x] C015: Produktkatalog mit exakten Centwerten, Steuerbasis, Duplizieren und Archivierung
- [x] C016: Privat-/Firmenkontakte, Suche, Dublettenvorschläge, Archiv und CSV-Export; Event-/E-Mail-Verknüpfungen folgen mit den Fachmodellen
- [x] C017: wiederverwendbare Locations mit Anschrift, Suche, Archiv und Versionsschutz
- [x] C018: Eventanlage/-bearbeitung mit Terminen, sicheren Notizen, Kontakt-/Stammdatenbezügen und Versionsschutz; Buchung folgt mit C023
- [x] C019: chronologische Eventliste, kombinierbare Suche/Filter, URL-Zustand und gemeinsame Kontaktsuche
- [x] C020: gebündelte Eventakte mit direkter Statusänderung und unveränderbarem fachlichem Logbuch
- [x] C021: physische Einheiten, getrennte Reservierungszeiträume, Kalenderpuffer, idempotente Vormerkungen und Ablaufbereinigung; feste Buchungen bleiben gesperrt
- [x] C022: PostgreSQL-Konfliktschutz für feste Buchungen und Sperren einschließlich Parallelität und Rollback
- [x] C023: Verfügbarkeit und atomare Box-/Zubehörzuweisung in der Eventakte, manuelle Buchung, geprüfte Termin-/Boxwechsel und Logbuch
- [x] C024: zeitweise Sperren ohne Kundenauftrag, genaue Zeiträume und Gründe, idempotente Anlage und Freigabe mit Historie
- [x] C025: interner Tages-/Wochen-/Monatskalender mit physischer Ressourcen-Zeitleiste, Puffern, Sperren und textlich/farblich sichtbaren Vormerkungskonflikten
- [x] C076 (vorgezogen): [manueller Ressourcenabgleich](docs/import-resource-review.md), atomare Übernahme, Wiederholschutz und Ausschluss inzwischen vergangener Zusagen; synthetisch geprüft, echte Ressourcenabnahme offen
- [x] C026: Gesamt- und Ressourcen-ICS mit widerrufbaren, ablaufenden Bearer-Links, datensparsamer Ausgabe und Einstellungen; synthetische HTTPS-/Chromium-Abnahme grün. [Kalender-Abo und noch offener Smartphone-Probelauf](docs/calendar-feeds.md).
- [ ] C027–C075 und C077–C085: noch nicht implementiert oder abgenommen

## 2. Qualitätsregeln

- Jeder Funktionscommit enthält passende Tests.
- Kein Commit darf die vorhandene Suite rot hinterlassen.
- Kritische Buchungs- und Finanzregeln werden zusätzlich mit Parallelitäts- und Negativtests geprüft.
- Milestone-Commits enthalten keine neuen Features, sondern nur Versionierung, Dokumentation und vollständig grüne Abnahmetests.
- Die genauen Coverage-Grenzen und Git-Regeln stehen in `AGENTS.md`.

## 3. Milestones

| Milestone | Ergebnis |
|---|---|
| M0 – Walking Skeleton | Projekt startet lokal reproduzierbar und besitzt CI, Datenbank und Testgrundlage |
| M1 – Minimaler interner MVP | Kontakte, Events, Ressourcen, konfliktfreie Buchung, Kalender und ICS sind produktiv nutzbar |
| M2 – Öffentliche Anfragen | WordPress zeigt anonymisierte Verfügbarkeit und erzeugt lokale Anfragen/Vormerkungen |
| M3 – Kommunikation | Postfach, Zuordnung, Vorlagen, Entwürfe und geplante E-Mails funktionieren |
| M4 – Angebote und Rechnungen | Produkte, Vorlagen, PDFs, Nummernkreise, Angebote, Rechnungen und Zahlungen funktionieren |
| M5 – Verträge und Fragebögen | Kunden können sichere Formulare ausfüllen und Verträge unterschreiben |
| M6 – Aufgaben und Erkenntnisse | Relative To-dos, Absagegründe und einfache Auswertungen sind verfügbar |
| M7 – Migration und Produktionsreife | Relevante Bestandsdaten sind übernommen; Backup, Sicherheit, Leistung und Barrierearmut sind geprüft |

## 4. Commitfolge

### M0 – Walking Skeleton

| ID | Commit | Inhalt | Tests/Abnahme |
|---|---|---|---|
| C001 | `docs: define product scope and delivery rules` | Lastenheft, Konkurrenzinventar, AGENTS-Regeln, Commitplan und sichere Git-Allowlist | Links/Markdown prüfen; ausschließlich freigegebene Dateien sind trackbar |
| C002 | `chore: initialize typescript workspace` | pnpm-Workspace, gemeinsame TypeScript-Konfiguration, Verzeichnisstruktur für Admin, API, Worker, Gateway, Widget und Pakete | Typecheck eines Minimalmoduls; Workspace-Install reproduzierbar |
| C003 | `chore: add formatting linting and commit checks` | Prettier, ESLint, Commit-Konvention und lokale Prüfskripte | Absichtlich fehlerhafte Fixture wird von jedem Gate erkannt |
| C004 | `test: establish unit integration and e2e harnesses` | Vitest, disposable PostgreSQL-Testdatenbank, React-Komponententests und Playwright-Grundlage | Je ein grüner Beispieltest pro Ebene |
| C005 | `chore: add local docker compose environment` | PostgreSQL, API, Worker und Admin; persistente Volumes, Healthchecks sowie automatisierbare tägliche Backup-/Restore-Skripte, Loopback-Bindung der Administration und dokumentierte TLS-Terminierung | Clean-start-Test; Container werden healthy; gesicherte Testdaten lassen sich in eine frische Umgebung zurückspielen |
| C006 | `ci: run quality gates on every push` | GitHub Actions für Format, Lint, Typen, Tests, Build und Coverage-Artefakte | CI läuft auf Repository-Branch vollständig grün |
| C007 | `feat: add runtime configuration and health endpoints` | Validierte Umgebungsvariablen, strukturierte, von personenbezogenen Daten und Tokens bereinigte Logs, Readiness/Liveness und Build-Info | Fehlende Konfiguration stoppt sicher; Healthchecks unterscheiden DB/Worker-Zustand |

### M1 – Minimaler interner MVP

| ID | Commit | Inhalt | Tests/Abnahme |
|---|---|---|---|
| C008 | `feat: add tenant and user persistence` | Mandant, Benutzer, Membership und Grundschema mit `tenant_id` und mandantengebundenen Fremdschlüsseln | Migrationstest, Eindeutigkeit, tenant-gefilterte Repositories |
| C009 | `feat: authenticate administrators with google oidc` | Authorization-Code-Flow, sichere Session-Cookies, Logout und Callback, PKCE, CSRF-/Origin-Schutz für schreibende Admin-Routen | OIDC-Adaptertest, State/Nonce/Redirect-Angriffe, Sessionablauf |
| C010 | `feat: restrict login with an administrator allowlist` | Oberfläche und Regel für freigegebene Google-Konten; sicherer Erstkonto-Bootstrap über lokale Konfiguration; Sitzungswiderruf bei Sperre; letzter Admin vor Aussperrung geschützt; deaktivierter Notfallzugang vorbereitet | Nicht erlaubtes Konto abgewiesen; Erstkonto ohne offene Registrierung; Sperre widerruft Sitzungen; Änderung auditiert |
| C011 | `feat: record append-only audit events` | Auditlog für Anmeldung und spätere Fachaktionen | Einträge unveränderbar; Tenantzugriff geprüft |
| C012 | `feat: manage event types packages and statuses` | Konfigurationsoberflächen für Eventarten (fünf bestätigte Startwerte), Paketwerte und feste Status | CRUD-/Archivtests; historische Referenzen bleiben gültig |
| C013 | `feat: manage cancellation reasons` | Konfigurierbare Absagegründe als Stammdaten | Archivierung statt Löschung; tenant-isolierte API/UI |
| C014 | `feat: manage resource master data` | FB1, FB2, Glamour- und Schwarzwald-Paket; Bestand, Kategorien, Sperrstatus und Puffer | CRUD, Bestand ≥ 0, Archivregeln, synthetische Seeds |
| C015 | `feat: manage product catalog` | Produkte, Preise, Steuer, Einheit, Aktivierung und Sortierung | Exakte Geldwerte, Archivierung und Validierung |
| C016 | `feat: manage private and company contacts` | Kontakt-CRUD, Firmen/Ansprechpartner, Suche, Eventbezüge, Archiv und offener Datenexport | Normalisierung, Dublettenvorschlag, Tenantgrenzen, UI-Komponenten |
| C017 | `feat: manage reusable event locations` | Location-CRUD und Suche | Validierung, Archivierung, Eventreferenz bleibt bestehen |
| C018 | `feat: create and edit events` | Eventmodell, Status, Art, Termin, Ort, Paket, Anfragequelle, Haupt-/weitere Kontakte und sanitizierte formatierte Notizen; Versionsprüfung gegen verlorene Änderungen | Zustands- und Validierungstests; vollständiger API/UI-Pfad |
| C019 | `feat: add event list search and filters` | Chronologische Liste, Suchtext, Zeitraum, Status, Art und Events ohne Datum; gemeinsame Suchnavigation zu Kontakten und Events | Filterkombinationen, URL-Zustand, leere/fehlerhafte Ansichten |
| C020 | `feat: add event details and activity log` | Gebündelte Eventakte und fachliches Logbuch | Änderungen erzeugen korrekte unveränderbare Aktivitäten |
| C021 | `feat: model resource holds and bookings` | Reservierungszeitraum getrennt vom Event, Status Vormerkung/Gebucht/Blockiert, Pufferberechnung, Ablauf temporärer Vormerkungen und konsistente Statusübergänge gemäß docs/decisions.md | Randgrenzen, beide DST-Wechsel, Zwei-Tage-Puffer, Storno-Freigabe und Ablauf bei ausgefallenem Worker |
| C022 | `feat: prevent overlapping confirmed reservations` | PostgreSQL-Zeitbereiche und Exclusion Constraint pro physischer Ressourceneinheit/Mandant; Sperren nehmen am selben Konfliktschutz teil | Gleichzeitige Transaktionen; gleiche Box blockiert, FB1/FB2 parallel erlaubt |
| C023 | `feat: show availability and assign resources` | Event-UI für Verfügbarkeit, Konflikte, Wechsel und Zubehör; manuelles Buchen ohne Vertrag; Terminverschiebung mit atomarer Neuprüfung | Komponenten- und API-Tests; atomare Zuweisung; alte Buchung bleibt bei Konflikt erhalten; konkurrierende Änderungen; Auditlog |
| C024 | `feat: add resource blocks for maintenance` | Interne Sperren ohne Kundenauftrag | Sperre kollidiert mit Buchung; Freigabe und Historie geprüft |
| C025 | `feat: add internal event and resource calendar` | Tages-/Wochen-/Monatsansicht und Ressourcen-Zeitleiste | Parallele Boxen, Puffer, Optionen und Konfliktfarben visuell/E2E geprüft |
| C026 | `feat: publish revocable ics calendar feeds` | Gesamtfeed und Feeds pro Ressource; Tokenverwaltung, geschützter TLS-Zugriff aus Kalenderclients ohne Freigabe der Admin-API; optionaler ausgehender Feed-Abgleich zu einem getrennten Token-Endpunkt | RFC-nahe Parser-Tests, Update/Storno, keine ungewollten Datenfelder |
| C027 | `release: mark minimal internal mvp` | Version, Betriebsanleitung und M1-Abnahmetest; tägliche Sicherung und Restore geprüft; reale Nutzung erst nach Ressourcenabgleich, Zugriffsschutz und dokumentierter Datenübernahme | Frische Installation; kompletter Kontakt→Event→FB1/FB2→Kalender→ICS-Pfad |

### M2 – Öffentliche Verfügbarkeit und Anfragen

| ID | Commit | Inhalt | Tests/Abnahme |
|---|---|---|---|
| C028 | `feat: define versioned public gateway protocol` | Signierte Sync-Nachrichten, Idempotenzschlüssel und minimale öffentliche Datenverträge, Schlüsselrotation, Replay-Schutz, Payload-Limits und getrennte Endpunkte für anonymisierte und token-geschützte Daten | Contract-Tests beider Seiten; alte/ungültige Signaturen abgewiesen |
| C029 | `feat: project anonymized availability snapshots` | Lokale Projektion von Ressourcenständen ohne Kundendaten | Datenschutztest; Status-/Pufferänderungen erzeugen korrekte Deltas |
| C030 | `feat: synchronize availability through the outbox` | Ausgehende, wiederholbare Übertragung mit Quittierung; Job-Leases, Crash-Recovery, Backoff und sichtbare endgültige Fehler | Netzfehler, Retry, Duplikat und Reihenfolge getestet |
| C031 | `feat: render the embeddable availability widget` | Responsiver Monatskalender als Web Component | Browser-/Theme-Isolation, Tastatur, Mobilansicht und visuelle Snapshots |
| C032 | `feat: configure widget branding and labels` | Farben, Schrift, Rundungen, Legende und öffentliche Statusregeln, erlaubte Einbettungsdomains sowie widerrufbare Widget-Kennungen (keine Geheimnisse) | Konfiguration wirkt ohne Neubuild; unsichere CSS-/HTML-Werte abgewehrt |
| C033 | `feat: add wordpress shortcode integration` | Minimales WordPress-Plugin, Script-Laden und Shortcode | WordPress-Integrationsfixture; Mehrfacheinbindung; Cache-Versionierung |
| C034 | `feat: collect public availability inquiries` | Datum, Paket, Zubehör, Kontakt, konfigurierbare Formularquellen/Feldzuordnung, Einwilligung und Spam-Schutz; serverseitige Prüfung der Snapshot-Aktualität; getrennte Eingangs- und Übernahmebestätigung | Schema-, Rate-limit-, Honeypot- und Consent-Tests |
| C035 | `feat: import inquiries and create temporary holds` | Ausgehendes Abholen, Dublettenschutz, Eventanlage und lokale Vormerkung mit Ablauf; verschlüsselte Zwischenablage im Gateway, Quittierung und befristete Löschung | At-least-once-Zustellung, doppelte Anfrage, inzwischen belegte Ressource |
| C036 | `feat: degrade safely when availability is stale` | Aktualitätsanzeige, keine Zusage bei Störung, verständliche Alternativen; Versionen verhindern Rücksprünge, Aktualisierung binnen 60 Sekunden im Normalbetrieb | Gateway offline, verspätete Snapshots und Race-Condition E2E |
| C037 | `release: mark public inquiry milestone` | M2-Dokumentation und vollständiger WordPress→lokales Event-Abnahmetest | Öffentlicher Test enthält keinerlei Bestandskundendaten |

### M3 – E-Mail und Kommunikation

| ID | Commit | Inhalt | Tests/Abnahme |
|---|---|---|---|
| C038 | `feat: add secure local file storage` | Storage-Adapter, Metadaten, Limits, MIME-Prüfung, verpflichtende Quarantäne und Scan-Freigabe, unveränderbare Dateiversionen | Traversal, falscher MIME-Typ, Größe, Tenantzugriff, Ersetzen und Scanner-Ausfall ohne Dateifreigabe |
| C039 | `feat: send email through configurable smtp` | SMTP-Konfiguration, Signatur, Anhänge und Outbox | Fake-SMTP, TLS-Fehler und Retry vor Übergabe; unklarer SMTP-Ausgang wird sichtbar angehalten statt blind erneut gesendet |
| C040 | `feat: synchronize mailbox messages through imap` | IMAP-Polling/Idle, Ordner, UIDVALIDITY/UID-Cursor und Umschaltgrenze ohne historische Nachrichtenimporte | Fake-IMAP, Reconnect, Duplikate, gelöschte/verschobene Nachrichten |
| C041 | `feat: associate messages with contacts and events` | Automatische Vorschläge und manuelle Korrektur | Absender-/Thread-/Referenzfälle und falsche Zuordnung |
| C042 | `feat: add inbox and event conversation views` | Posteingang, unerledigt, gesendet, Entwürfe, geplant, Fehler, Papierkorb | Listen-/Statusaktionen, Tenant- und Berechtigungstests |
| C043 | `feat: manage email templates and placeholders` | Vorlagen, elf Ausgangstypen, Platzhalter und Standardanhänge | Fehlende Werte, Escaping, Vorschau und Archivierung |
| C044 | `feat: compose drafts replies and attachments` | Editor, Antworten, Weiterleiten und Dateibibliothek | Header/Threading, Uploadgrenzen, XSS und Entwurfserhalt |
| C045 | `feat: schedule email delivery and follow ups` | Geplanter Versand und zwei feste Regeln für interne Erinnerungen (offen/erledigt/verworfen); Kunden-Nachfassmails nur ausdrücklich geplant | Uhrzeit/Zeitzone, Reaktion stoppt Erinnerung; keine doppelten Jobs; unklarer Versand wird angehalten |
| C046 | `release: mark communication milestone` | M3-Abnahme und Betriebsdokumentation | Anfrage→Antwort→Zuordnung→Follow-up vollständig E2E |

### M4 – Angebote, Rechnungen und Zahlungen

| ID | Commit | Inhalt | Tests/Abnahme |
|---|---|---|---|
| C047 | `feat: manage document templates` | Vorlagentexte, Produktpositionen, Platzhalter und Versionen | Rendering, Archivierung, alte Version unverändert |
| C048 | `feat: configure branded document layouts` | Logo, Farben, Schrift, Absender, Seitenzahlen und Vorschau | Deterministischer HTML-/Visual-Snapshot |
| C049 | `feat: render immutable pdf documents` | Chromium-PDF, Inhalts-Hash und dauerhafte Artefakte | PDF parsebar, Fonts stabil, Hash ändert sich nur bei Inhalt |
| C050 | `feat: allocate atomic document numbers` | Getrennte Nummernkreise mit Jahr/Monat/Tag/Sequenz und unverbindlicher Nummernvorschau | Parallelität, Rollback, führende Nullen und keine Wiederverwendung |
| C051 | `feat: create and finalize offers` | Positionen, Rabatt, Steuer, konfigurierbare Gültigkeit (Standard 14 Tage) und Status | Geld-/Steuerbranches, Ablauf, finale Version unveränderbar |
| C052 | `feat: record offer acceptance by channel` | E-Mail, Telefon, PDF oder Sonstiges mit Zeitpunkt/Notiz | Zustandsübergänge und optionaler Anhang |
| C053 | `feat: convert offers to order confirmations` | Übernahme ohne Neueingabe | Positions-/Summengleichheit und unabhängige Finalisierung |
| C054 | `feat: create invoices deposits and corrections` | Rechnung, Anzahlung, Schlussrechnung und Korrektur | Pflichtangaben, Steuer, Verrechnung, Storno und Unveränderbarkeit |
| C055 | `feat: record payments and outstanding balances` | Zahlungen, Teilzahlung, bezahlt/überfällig und CSV-Export inklusive Dokumentmetadaten; Schutz vor Tabellenformeln in allen CSV-Exporten | Über-/Teilzahlung, Datum, Korrektur und exakte Salden |
| C056 | `release: mark commercial documents milestone` | M4-Abnahme und Dokumentationsstand | Angebot→Annahme→Anzahlung→Schlussrechnung→Zahlung E2E |

### M5 – Online-Verträge und Fragebögen

| ID | Commit | Inhalt | Tests/Abnahme |
|---|---|---|---|
| C057 | `feat: manage versioned contract templates` | Vertragsbausteine, Felder, Bestätigungen, Sichtbarkeit und Sperrregeln | Schema-/Versions-/Archivtests; Rich-Text-Sanitizing |
| C058 | `feat: issue secure public contract links` | Gehashte Tokens, Ablauf, Widerruf, Prefill und Autosave; ausgehender Abgleich persönlicher Vertragsinstanzen, befristete Gateway-Aufbewahrung und sichere Offline-Zustände | Token-Raten, fremder Tenant, Ablauf, Replay und Zwischenspeichern |
| C059 | `feat: validate and capture contract signatures` | Pflichtfelder, Einwilligungen und Unterschrift | Fehlende/gefälschte Felder, mobile Eingabe und Abschluss nur einmal |
| C060 | `feat: finalize signed contracts and evidence` | Unveränderbares PDF, Dokumenthash, Nachweisprotokoll und Versand erst nach verbindlichem Abschluss; wiederanlaufbare PDF-Bereitstellung gemäß docs/decisions.md | Manipulationserkennung, Vorlagenversion und deterministische Artefakte |
| C061 | `feat: confirm resources after contract signing` | Lokaler atomarer Abschluss nach ausgehend abgeholtem Signaturauftrag; Gateway meldet bis zur Quittierung nur ausstehend, erneute Ressourcenprüfung, Status Gebucht | Zwei parallele Signaturen auf letzte Box; Offline, Crash, verlorene Quittierung und Replay; sicherer Abbruch ohne Widerspruch |
| C062 | `feat: remind customers about unsigned contracts` | Konfigurierbare Erinnerung und Stop nach Abschluss/Widerruf | Zeitsteuerung, Retry und kein Versand nach Abschluss |
| C063 | `feat: manage questionnaire templates` | Feldtypen, Sortierung, Uploadregeln und Feldmapping | Schema, Archivierung, sichere Konfiguration |
| C064 | `feat: collect fotobox questionnaire responses` | Sicherer Link, Prefill, Autosave, Abgabe und Eventanzeige | Mobil-E2E, Uploadschutz, Tenanttrennung und Logbuch |
| C065 | `feat: map questionnaire answers into event data` | Kontrollierte Übernahme und Korrekturfreigabe | Konflikt mit intern geänderten Daten, Audit und Wiederöffnung |
| C066 | `release: mark customer forms milestone` | M5-Abnahme und rechtliche Prüfliste | Angebot→Vertrag→Signatur→Buchung→Fragebogen vollständig E2E |

### M6 – To-dos und Absagegründe

| ID | Commit | Inhalt | Tests/Abnahme |
|---|---|---|---|
| C067 | `feat: manage event and general tasks` | Offen/erledigt/verworfen, Fälligkeit und Übersichten | Überfällig, Filter, Eventbezug und Audit |
| C068 | `feat: manage relative task templates` | Mehrere Aufgaben, Anker Anfrage/Buchung/Event, Vor-/Nachlauf und Filter | Relative Datumsberechnung über DST/Zeitzonen und Pakete |
| C069 | `feat: instantiate and reschedule relative tasks` | Automatische/manuelle Anwendung und Vorschau bei Datumsänderung | Keine Duplikate, erledigte Tasks bleiben, offene werden korrekt verschoben |
| C070 | `feat: notify about due and overdue tasks` | E-Mail-/Browserhinweise | Debounce, Zeitzone, erledigte/verworfene Aufgaben stoppen Meldung |
| C071 | `feat: capture cancellation reasons on events` | Pflichtauswahl oder bewusst unbekannt; Notiz und Trennung der Absagearten | Statusübergänge, archivierte Gründe und bestehende Events |
| C072 | `feat: report cancellation reasons` | Zeitraum, Anteil, Eventart, Quelle, Paket und CSV | Aggregations-/Tenanttests und nachvollziehbare Prozentwerte |
| C073 | `release: mark operations insight milestone` | M6-Abnahmetests und Dokumentation | Aufgabe relativ verschoben; Absage korrekt ausgewertet |

### M7 – Migration, Sicherheit und Produktionsreife

| ID | Commit | Inhalt | Tests/Abnahme |
|---|---|---|---|
| C074 | `feat: import contacts with duplicate reporting` | Bookitup-Import, Dry-run und Fehlerbericht; Auskunftsexport und dokumentierte Lösch-/Anonymisierungsvorgänge mit Aufbewahrungssperren | Zeichensätze, Firmen, Dubletten, Wiederholung und Rollback |
| C075 | `feat: import events and master data` | Aktive/zukünftige Events, Arten, Pakete, Produkte, Locations und Notizen; Export von Events/Produkten; Übernahme von E-Mail-/Dokumentvorlagen, Logo, Gestaltung, Signatur und acht Standarddateien über die vorhandenen Module | Referenzintegrität, Statusmapping und Wiederanlauf |
| C076 | `feat: reconcile resource assignments before cutover` | Manuelle Prüfliste für FB1/FB2 und Zubehör | Jeder gebuchte Zukunftstermin konfliktfrei oder explizit blockiert |
| C077 | `feat: import open commercial balances and counters` | Offene Vorgänge und nächste Nummern; keine Altarchive/E-Mails; Originalnummern und unveränderbare Originalbelege offener Vorgänge erhalten, keine Neuausstellung | Summenkontrolle, Nummernüberschneidung und Dry-run-Bericht |
| C078 | `ops: automate encrypted backup and restore` | PostgreSQL- und Dateisicherung, Rotation und Restore-Befehl | Vollständiger Restore in frische Umgebung mit Prüfsummen |
| C079 | `security: harden public and administrative endpoints` | Modulübergreifende Nachprüfung der bereits bei Einführung verpflichtenden Security Header, CSRF, Rate-Limits, Uploadscan, Tokenrotation und Dependency Audits | Automatisierte Missbrauchs-/Autorisierungsfälle und Security-Scan |
| C080 | `test: verify tenant isolation across all modules` | Systematische Negativsuite für späteren Mehrmandantenbetrieb | Kein Zugriff über IDs, Suche, Dateien, Jobs, Exporte oder öffentliche Tokens |
| C081 | `perf: validate production data volumes and concurrency` | Lasttests für Listen, Mail, Widget und gleichzeitige Reservierung | Definierte Antwortzeiten und keine Doppelbuchung unter Last |
| C082 | `a11y: audit administrative and public workflows` | Tastatur, Fokus, Kontrast, Labels und Screenreader-Grundlagen | Automatisierte axe-Prüfung plus dokumentierte manuelle Checks |
| C083 | `ops: document update rollback and incident procedures` | Betriebshandbuch, Updates, Rollback nur bei kompatiblem Schema, sonst getestete Wiederherstellung; OAuth-/Mail-/Gateway-Ausfall | Dry-run der Verfahren auf Testinstallation |
| C084 | `test: rehearse migration and production cutover` | Vollständiger Probelauf mit synthetischem Export und Delta-Verfahren; echte Exporte ausschließlich lokal und ignoriert | Mengen-/Summen-/Ressourcenabgleich vollständig grün |
| C085 | `release: publish the first production-ready version` | Changelog, versionierte Images, Prüfsummen und finale Abnahme | Gesamte Suite, Clean install, Restore und Kernprozess vollständig grün |

## 5. Definition des minimalen MVP nach C027

Der erste bewusst minimale Nutzwert ist erreicht, wenn:

1. der Inhaber sich mit dem gewählten Anmeldeverfahren anmelden kann,
2. Eventarten, Pakete, Produkte und Ressourcen konfigurierbar sind,
3. Kontakte und Events manuell verwaltet werden können,
4. FB1 und FB2 sowie einmaliges Zubehör mit zwei Tagen Puffer disponiert werden,
5. die Datenbank gleichzeitige Doppelbuchungen verhindert,
6. Kalender und Ressourcenansicht die Belegung verständlich zeigen,
7. ein widerrufbarer ICS-Feed auf dem Smartphone funktioniert,
8. Auditlog, Backup-Grundlage und automatisierte Tests vorhanden sind.

Dieser Stand ersetzt noch nicht bookitup vollständig, ist aber bereits als verlässliche interne Disposition nutzbar. Für die frühere Ablösung sind zusätzlich die vorgezogenen Archiv-, Migrations-, Ersatzprozess- und Betriebsabnahmen aus dem [Ausstiegsplan](docs/bookitup-exit.md) erforderlich. Jede spätere Phase fügt einen fachlichen Bereich hinzu.

## 6. Release- und Push-Regel

- Nach jedem Commit: vollständige relevante Tests, explizite Staging-Prüfung, Commit und sofortiger Push.
- Nach jedem Milestone: komplette Testsuite, E2E-Abnahme, aktualisierte Dokumentation und ein versionierter Tag.
- Kein Milestone wird durch Überspringen eines fehlgeschlagenen Tests abgeschlossen.
- Der konfigurierte Remote ist `https://github.com/gcode-de/auftragskompass.git`; Sichtbarkeit und Repository-Einstellungen werden nicht beiläufig geändert.
