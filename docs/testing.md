# Testgrundlage (C004)

Voraussetzungen: Node/pnpm gemäß [README](../README.md), Python 3 und laufendes Docker. Einmalig `pnpm install --frozen-lockfile` und `pnpm exec playwright install chromium` ausführen. Unter Linux benötigt Chromium zusätzlich die Systembibliotheken (`pnpm exec playwright install --with-deps chromium`).

| Befehl | Prüfung |
|---|---|
| `pnpm test:unit` | Vitest-Test des gemeinsamen Minimalmoduls |
| `pnpm test:component` | React-Oberfläche mit Testing Library und jsdom |
| `pnpm test:integration` | Echte temporäre PostgreSQL-Instanz mit Rollback und Unique Constraint |
| `pnpm test:e2e` | Produktionsbuild der React-Hülle in Chromium, sichtbare Inhalte und Laufzeitfehler |
| `pnpm test:coverage` | Unit-/Komponententests mit V8-Coverage |
| `pnpm check` | Sämtliche verfügbaren Qualitätsgates und Build |

Testcontainers startet für die Integration eine frische PostgreSQL-17.6-Instanz mit zufälligem Port und entfernt sie anschließend. Es wird niemals eine externe `DATABASE_URL` verwendet. Bei nicht verfügbarem Docker schlägt der Test fehl, statt übersprungen zu werden. Der erste Lauf lädt das Containerimage. Alle Daten sind synthetisch; es gibt noch kein fachliches Datenbankschema.

Playwright startet und beendet den Preview-Server selbst auf `127.0.0.1:14873`; ein bereits belegter Port führt zum Fehler. Es wird kein möglicherweise fremder Server wiederverwendet. Trace-Dateien entstehen nur bei Fehlern und bleiben ebenso wie Builds, Coverage und Testresultate durch die bestehenden Git-Regeln ausgeschlossen.

Coverage umfasst alle TypeScript-Anwendungsquellen; allein die DOM-Montage in `apps/admin/src/main.tsx` wird durch den Browsertest statt durch V8-Unit-Coverage geprüft. Grenzwerte sind mindestens 90 % Zeilen/Statements/Funktionen und 85 % Branches. Fachregeln sind noch nicht implementiert. C006 prüft zusätzlich geänderte ausführbare Zeilen (85 %) und Branches (80 %) anhand Git-Diff und LCOV. Fehlende Coverage geänderter Quelldateien führt zum Fehler.

Referenzen: [Vitest-Projekte](https://vitest.dev/guide/projects), [PostgreSQL-Testcontainers](https://node.testcontainers.org/modules/postgresql/).

GitHub Actions führt `pnpm check` auf jedem Push und Pull Request unter Ubuntu und Node 24 aus, ohne Produktionssecrets und mit nur lesendem Repository-Token. Coverage-Artefakte werden sieben Tage gespeichert. Actions sind auf Commit-SHAs fixiert. Branch Protection wird durch den Workflow nicht verändert.

Ab C008 bezieht der Coverage-Lauf auch die echten PostgreSQL-Integrationstests ein. Nur die drei Prozess-Einstiegspunkte (Admin-Mount, API und Worker) sind ausgenommen; ihr Start wird durch Chromium und Compose geprüft.
