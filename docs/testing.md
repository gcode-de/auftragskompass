# Testgrundlage (Stand C010)

Voraussetzungen: Node/pnpm gemäß [README](../README.md), Python 3 und laufendes Docker. Einmalig `pnpm install --frozen-lockfile` und `pnpm exec playwright install chromium` ausführen. Unter Linux benötigt Chromium zusätzlich die Systembibliotheken (`pnpm exec playwright install --with-deps chromium`).

| Befehl | Prüfung |
|---|---|
| `pnpm test:unit` | Konfiguration, Healthchecks und Schemametadata |
| `pnpm test:component` | React-Oberfläche mit Testing Library und jsdom |
| `pnpm test:integration` | Migrationen, Mandantentrennung, OIDC, Freigaben, Parallelität und Audit-Rollback |
| `pnpm test:e2e` | Chromium: HTTPS-Anmeldung, Cookie-Schutz, Kontofreigaben, Aussperrschutz und Logout |
| `pnpm test:coverage` | Unit-, Komponenten- und Datenbanktests mit V8-Coverage |
| `pnpm check` | Sämtliche verfügbaren Qualitätsgates und Build |

Testcontainers startet für die Integration eine frische PostgreSQL-17.6-Instanz mit zufälligem Port und entfernt sie anschließend. Es wird niemals eine externe `DATABASE_URL` verwendet. Bei nicht verfügbarem Docker schlägt der Test fehl, statt übersprungen zu werden. Der erste Lauf lädt das Containerimage. Alle Daten sind synthetisch; Google wird durch einen kontrollierten Transport mit signierten Test-Tokens simuliert.

Playwright startet und beendet den Preview-Server selbst auf `127.0.0.1:14873`; ein bereits belegter Port führt zum Fehler. Es wird kein möglicherweise fremder Server wiederverwendet. Trace-Dateien entstehen nur bei Fehlern und bleiben ebenso wie Builds, Coverage und Testresultate durch die bestehenden Git-Regeln ausgeschlossen.

Coverage umfasst alle TypeScript-Anwendungsquellen außer den drei Prozess-Einstiegspunkten (Admin-Mount, API und Worker); diese werden durch Chromium und Compose geprüft. Grenzwerte sind mindestens 90 % Zeilen/Statements/Funktionen und 85 % Branches. C006 prüft zusätzlich geänderte ausführbare Zeilen (85 %) und Branches (80 %) anhand Git-Diff und LCOV. Fehlende Coverage geänderter Quelldateien führt zum Fehler.

Referenzen: [Vitest-Projekte](https://vitest.dev/guide/projects), [PostgreSQL-Testcontainers](https://node.testcontainers.org/modules/postgresql/).

GitHub Actions führt `pnpm check` auf jedem Push und Pull Request unter Ubuntu und Node 24 aus, ohne Produktionssecrets und mit nur lesendem Repository-Token. Coverage-Artefakte werden sieben Tage gespeichert. Actions sind auf Commit-SHAs fixiert. Branch Protection wird durch den Workflow nicht verändert.

Der HTTPS-Browsertest benötigt zusätzlich `openssl` zum Erzeugen eines kurzlebigen Zertifikats im temporären Verzeichnis. Schlüssel, Container und Datenbank werden danach entfernt. Die Freigabe-Integrationstests prüfen auch den Übergang von C009 auf C010, gebundene Google-Subjects, parallele Sperren und den unveränderbaren Auditpfad.
