# AuftragsKompass

Lokal betriebene Verwaltungsanwendung für einen Fotobox-Betrieb, mit einer später erweiterbaren Mandantenstruktur.

**Stand:** C001–C026 sowie vorgezogen C076 sind umgesetzt: lokaler Containerbetrieb,
CI, Datenbankmigrationen, Mandanten, eigener Passwortlogin oder Google-OIDC,
Kontofreigaben und Auditlog. Kontakte, Veranstaltungsorte, Produkte, Ressourcen und
Events sind verwaltbar. Ressourcen werden konfliktgeprüft disponiert und im Tages-,
Wochen- und Monatskalender angezeigt. Der Minimalimport bietet Vorschau, Probelauf
und eine gesonderte Ressourcenprüfung für Bestandszusagen. [Widerrufbare Kalender-Abos](docs/calendar-feeds.md) liefern Gesamt- oder Ressourcenfeeds über einen getrennten Token-Endpunkt.
Dieser interne Dispositionsstand ersetzt noch nicht den vollständigen Ablauf;
Mailversand und Geschäftsdokumente folgen separat; die echte Smartphone-Abnahme des Kalender-Abos bleibt offen.
Für einen früheren Bookitup-Ausstieg werden Sicherung, Mindestmigration und
Betriebsabnahme vorgezogen; Mail und Geschäftsdokumente benötigen dann geprüfte
externe Ersatzprozesse. M5/M6 folgen später.

- [Bookitup-Sicherung und verkürzter Livegang](docs/bookitup-exit.md)
- [Projektübergabe: Stand, nächste Schritte und Skills](docs/handoff.md)
- [Fokussiertes Lastenheft](Lastenheft_Fotobox-Verwaltung_MVP.md)
- [Commitgenauer Implementierungsplan](IMPLEMENTATION_PLAN.md)
- [Entwicklungs- und Datenschutzregeln](AGENTS.md)
- [Anforderungszuordnung](docs/requirements.md)
- [Planprüfung und fachliche Präzisierungen](docs/decisions.md)
- [Konkurrenzinventar als Referenz](Bookitup_Funktionsinventar_vollstaendig.md)

Die Anwendung ist als TypeScript-Monolith mit React/Vite, Fastify, PostgreSQL/Drizzle und PostgreSQL-basiertem Worker geplant. Der öffentliche Gateway bleibt von der lokalen Administration getrennt.

Dokumentationsprüfungen ohne zusätzliche Pakete (Python 3):

```sh
python3 -B scripts/check_docs.py
python3 -B -m unittest discover -s tests/docs -v
git diff --check
```

Die Prüfungen kontrollieren lokale Markdown-Dateilinks, eindeutige Anforderungs-/Slice-IDs und vollständige Zuordnung der Anforderungen. Sie ersetzen keine fachliche Abnahme, Anwendungstests oder Prüfung externer Links. Die ausführbaren pnpm-Gates sind unten beschrieben.

Dieses Git-Verzeichnis liegt neben privatem Kundenmaterial. Ausschließlich explizite Anwendungspfade stagen; niemals `git add .` verwenden. Die bestehende Git-Allowlist bleibt erhalten. Im Repository und in Tests dürfen nur synthetische Daten stehen.

## Entwicklung

Node.js 22 ab 22.22.2, 24 ab 24.15 oder 26 (empfohlen: 24 LTS), pnpm 10.2.0 und Python 3 für die Dokumentationsprüfungen. Abhängigkeiten sind im Lockfile fixiert.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:workspace
pnpm test:docs
pnpm build
```

`apps/admin` enthält die React/Vite-Verwaltung, `apps/widget` das entwickelte einbettbare Anfrageformular. `apps/api`, `apps/worker` und `apps/gateway` bilden getrennte Einstiegspunkte; der öffentliche Gateway und dessen automatische lokale Anbindung sind noch nicht im echten Websitebetrieb eingerichtet. `packages/core` enthält den gemeinsamen Anwendungskern. API und Worker besitzen Healthchecks. Den aktuellen Funktions- und Betriebsstand beschreibt die [Projektübergabe](docs/handoff.md).

`pnpm check` führt alle bisher verfügbaren Gates aus. `pnpm format` formatiert ausschließlich die explizit angegebenen Anwendungspfade und Root-Konfigurationen; private Nachbardateien werden nicht durchsucht. Markdown und Python werden separat durch die Dokumentationsprüfungen geprüft.

Commit-Nachrichten verwenden Conventional Commits, zum Beispiel `chore: add tooling`. Prüfung vor dem Commit: `echo 'chore: add tooling' | pnpm commit:check`. Es werden keine bestehenden Git-Hooks überschrieben. Die Negativtests in `pnpm test:workspace` prüfen Format-, Lint- und Commit-Ablehnungen.

Die Testgrundlage und ihre Voraussetzungen stehen in [docs/testing.md](docs/testing.md). Für alle Gates werden Docker und der Playwright-Chromium benötigt. Lokal starten: `pnpm --filter @auftragskompass/admin dev`. Der Entwicklungsserver bindet ausschließlich an Loopback und begrenzt Dateizugriffe auf die Admin-App und ihre Abhängigkeiten.

Lokale Container und Backup/Restore: [Betriebsanleitung](docs/operations.md). Anmeldung und sicherer Erstkonto-Bootstrap: [Einrichtung](docs/authentication.md). Ohne Authentifizierungskonfiguration startet das Grundsystem, geschützte Verwaltungsendpunkte bleiben gesperrt.

Docker-Hub-Veröffentlichung für erste Home-Lab-Tests: [Testbetrieb](docs/homelab.md).

Stammdaten verwalten und bestehende Werte übernehmen: [Stammdaten](docs/master-data.md).

Ressourcen und Standardpuffer: [Ressourcenstamm](docs/resources.md).

Produkte, Preise und Steuersätze: [Produktkatalog](docs/products.md).
Privat- und Firmenkontakte: [Kontaktverwaltung und Export](docs/contacts.md).

Veranstaltungsorte: [Locations](docs/locations.md).

Anfragen und Aufträge erfassen: [Events](docs/events.md).

Events und Kontakte finden: [Suche und Filter](docs/event-search.md).

Eventdaten und Änderungshistorie: [Eventakte und Logbuch](docs/event-details.md).

Dispositionszeiträume, Einheiten und Ablauf: [Reservierungsmodell](docs/reservations.md).

Angebote und Rechnungen als Dokumente: [Entwurf, Nummer und finale PDF](docs/documents.md).
