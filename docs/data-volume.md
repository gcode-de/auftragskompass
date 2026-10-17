# Begrenzte Mengenprobe des Datenkerns (E005.12)

Die Integrationssuite legt in einem eigenen Testmandanten 500 ausdrücklich fiktive
Kontakte und 500 Events mit unterschiedlichen IDs und konkreten Hauptkontakten an.
Archivierte Kontakte und annullierte Events bleiben enthalten. Andere Mandanten
im selben Testcontainer behalten ihre eigenen Datensätze.

Geprüft werden vollständige Kontakt-/Eventlisten, eine kombinierte Suche nach
Kontaktname, Zeitraum und Status, alle Namen-/ID-Zuordnungen im Eventexport sowie
der Ausschluss fremder Daten. Kontakte, Events, Suche und Export werden je fünfmal
über die echten PostgreSQL-Repositories gelesen. Jeder gemessene Aufruf muss unter
2.000 ms bleiben; Befunde werden nicht durch Retries verdeckt.

Lokaler Lauf am 17.10.2026 im disponiblen PostgreSQL-Testcontainer:

| Repository-Aufruf | Größte gemessene Dauer aus fünf Durchläufen |
|---|---:|
| Kontakte | 5 ms |
| Events | 13 ms |
| Kombinierte Suche | 5 ms |
| Erweiterter Eventexport | 14 ms |

Die Zahlen sind eine konkrete lokale Beobachtung, keine Zusage für andere Hardware.
Auch der Durchlauf mit Coverage erfüllt die Zeitgrenze. Die Messung enthält
Datenbank und Repositoryarbeit, nicht TLS-/Netzwerklatenz, Fastify-Authentifizierung,
CSV-Serialisierung oder die Darstellung von 500 Zeilen im Browser. Gleichzeitige
Reservierungen haben eigene Konflikt-/Parallelitätstests. Mail und öffentliches
Widget sind weiterhin verschoben; C081 und die Produktivfreigabe sind hiermit nicht
vollständig abgenommen. Es wurden keine echten Geschäftsdaten verwendet.

Wiederholung:

```sh
pnpm exec vitest run --config tests/vitest.config.ts --project integration tests/integration/events.test.ts --disableConsoleIntercept
```
