# AuftragsKompass

Lokal betriebene Verwaltungsanwendung für einen Fotobox-Betrieb, mit einer später erweiterbaren Mandantenstruktur.

**Stand:** TypeScript-Workspace mit Qualitätsprüfungen (C003). Noch keine startbare Fachanwendung, Datenbankmigrationen oder CI. Der interne Dispositionsstand M1 ersetzt noch nicht den vollständigen Ablauf; die vollständige Ablösung ist Ziel von M7.

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

Die Prüfungen kontrollieren lokale Markdown-Dateilinks, eindeutige Anforderungs-/Slice-IDs und vollständige Zuordnung der Anforderungen. Sie ersetzen keine fachliche Abnahme, Anwendungstests oder Prüfung externer Links. Die späteren pnpm-Gates werden gemäß Implementierungsplan eingerichtet.

Dieses Git-Verzeichnis liegt neben privatem Kundenmaterial. Ausschließlich explizite Anwendungspfade stagen; niemals `git add .` verwenden. Die bestehende Git-Allowlist bleibt erhalten. Im Repository und in Tests dürfen nur synthetische Daten stehen.

## Entwicklung

Node.js 22 ab 22.13, 24 oder 25, pnpm 10.2.0 und Python 3 für die Dokumentationsprüfungen. Abhängigkeiten sind im Lockfile fixiert.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:workspace
pnpm test:docs
pnpm build
```

`apps/admin` und `apps/widget` sind die künftigen React/Vite-Oberflächen; `apps/api`, `apps/worker` und `apps/gateway` bilden getrennte Einstiegspunkte. `packages/core` enthält den gemeinsamen Anwendungskern. Derzeit sind dies bewusst minimale TypeScript-Module ohne Netzwerkzugriff oder Fachfunktionen.

`pnpm check` führt alle bisher verfügbaren Gates aus. `pnpm format` formatiert ausschließlich die explizit angegebenen Anwendungspfade und Root-Konfigurationen; private Nachbardateien werden nicht durchsucht. Markdown und Python werden separat durch die Dokumentationsprüfungen geprüft.

Commit-Nachrichten verwenden Conventional Commits, zum Beispiel `chore: add tooling`. Prüfung vor dem Commit: `echo 'chore: add tooling' | pnpm commit:check`. Es werden keine bestehenden Git-Hooks überschrieben. Die Negativtests in `pnpm test:workspace` prüfen Format-, Lint- und Commit-Ablehnungen.
