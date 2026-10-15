# AuftragsKompass

Lokal betriebene Verwaltungsanwendung für einen Fotobox-Betrieb, mit einer später erweiterbaren Mandantenstruktur.

**Stand:** C001–C013 umgesetzt: lokaler Containerbetrieb, CI, Datenbankmigrationen,
Mandanten, Google-OIDC, Kontofreigaben, Auditlog sowie Eventarten, Paketwerte und Absagegründe.
Fachfunktionen wie Events, Reservierungen und Rechnungen folgen im Implementierungsplan.
Der interne Dispositionsstand M1 ersetzt noch nicht den vollständigen Ablauf;
die vollständige Ablösung ist Ziel von M7.

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

`apps/admin` und `apps/widget` sind die künftigen React/Vite-Oberflächen; `apps/api`, `apps/worker` und `apps/gateway` bilden getrennte Einstiegspunkte. `packages/core` enthält den gemeinsamen Anwendungskern. Die Admin-App enthält Anmeldung und Kontofreigaben; API und Worker besitzen Healthchecks. Gateway und Widget bleiben für spätere öffentliche Funktionen getrennt.

`pnpm check` führt alle bisher verfügbaren Gates aus. `pnpm format` formatiert ausschließlich die explizit angegebenen Anwendungspfade und Root-Konfigurationen; private Nachbardateien werden nicht durchsucht. Markdown und Python werden separat durch die Dokumentationsprüfungen geprüft.

Commit-Nachrichten verwenden Conventional Commits, zum Beispiel `chore: add tooling`. Prüfung vor dem Commit: `echo 'chore: add tooling' | pnpm commit:check`. Es werden keine bestehenden Git-Hooks überschrieben. Die Negativtests in `pnpm test:workspace` prüfen Format-, Lint- und Commit-Ablehnungen.

Die Testgrundlage und ihre Voraussetzungen stehen in [docs/testing.md](docs/testing.md). Für alle Gates werden Docker und der Playwright-Chromium benötigt. Lokal starten: `pnpm --filter @auftragskompass/admin dev`. Der Entwicklungsserver bindet ausschließlich an Loopback und begrenzt Dateizugriffe auf die Admin-App und ihre Abhängigkeiten.

Lokale Container und Backup/Restore: [Betriebsanleitung](docs/operations.md). Google-Anmeldung und sicherer Erstkonto-Bootstrap: [Einrichtung](docs/authentication.md). Ohne OIDC-Konfiguration startet das Grundsystem, geschützte Verwaltungsendpunkte bleiben gesperrt.

Stammdaten verwalten und bestehende Werte übernehmen: [Stammdaten](docs/master-data.md).
