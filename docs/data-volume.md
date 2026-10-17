# Begrenzte Mengenprobe von Datenkern und Oberfläche (E005.12/E005.17)

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
Auch der Repository-Durchlauf mit Coverage erfüllt die Zeitgrenze. Die Messung enthält
Datenbank und Repositoryarbeit, nicht TLS-/Netzwerklatenz, Fastify-Authentifizierung,
CSV-Serialisierung oder die Darstellung von 500 Zeilen im Browser. Gleichzeitige
Reservierungen haben eigene Konflikt-/Parallelitätstests. Mail und öffentliches
Widget sind weiterhin verschoben; C081 und die Produktivfreigabe sind hiermit nicht
vollständig abgenommen. Es wurden keine echten Geschäftsdaten verwendet.

Wiederholung:

```sh
pnpm exec vitest run --config tests/vitest.config.ts --project integration tests/integration/events.test.ts --disableConsoleIntercept
```

## Ergänzende Browserprobe (E005.17)

Der bestehende HTTPS-/Chromium-Geschäftsablauf legt ausschließlich in seiner
wegwerfbaren Testdatenbank je 500 weitere fiktive Kontakte und Events an. Beide
Listen werden bei 390 und 1280 CSS-Pixeln mit einer echten Seitennavigation neu
geladen: sichere Sitzung, TLS-Testproxy, PostgreSQL, API-Serialisierung,
Produktionsbuild und DOM-Aufbau bleiben Teil der Probe. Die erste Listenaktion
muss einen echten Playwright-Probeklick empfangen können; sämtliche 500
passenden Aktionen müssen vorhanden und die Liste fertig geladen sein. Nach
zwei Animation-Frames liegt die seit Navigationsbeginn verstrichene Zeit unter
2.000 ms. Zusätzlich darf kein horizontaler Seitenüberlauf entstehen.

Die vier gemessenen Zeiten werden im Playwright-Anhang
`fictional-browser-volume` abgelegt; die CI erhält diese Datei im Artefakt
`chromium-evidence` sieben Tage lang. Es gibt keinen Retry und keine gelockerte
Zeitgrenze für einen langsamen Durchlauf. Das ist eine lokale Desktop-Chromium-
Probe mit emulierten Breiten; weder physische Smartphone-Leistung noch die
Home-Lab-/Cloudflare-Latenz oder ein vollständiger C081-Lasttest sind damit
abgenommen. Der TLS-Proxy verwendet ein lokales synthetisches Zertifikat. Die
500 zusätzlichen Datensätze gelangen nie in die Betreiberinstallation.

Lokale Beobachtung am 17.10.2026 nach vollständiger Navigation je Messpunkt:

| Liste | 390 Pixel | 1280 Pixel |
|---|---:|---:|
| 500 Events | 343 ms | 323 ms |
| 500 Kontakte | 324 ms | 323 ms |

Browser und HTTP-Verbindung dürfen dabei warm sein. Die Werte sind weder ein
Cold-Start-Benchmark noch eine Zusage für andere Hardware.
