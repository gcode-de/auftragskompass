# Abhängigkeitsprüfung im verkürzten Testbetrieb

## E005.6 – source-map-js

Am 17.10.2026 meldete `pnpm audit --prod --json` CVE-2026-93749
(GHSA-68fv-2mgg-jv7q, high) für `source-map-js@1.2.1`. Der Laufzeitpfad ist
Core → sanitize-html → postcss → source-map-js. Der Befund beweist nicht, dass
der problematische Source-Map-Pfad über die derzeitige App-Eingabe erreichbar ist.
Er wird durch Aktualisierung der tatsächlich installierten Abhängigkeit behoben,
nicht durch eine Ausnahme im Audit.

Der [Hersteller-Patch v1.2.2](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)
begrenzt unter anderem übergroße Abschnitts-Offsets. Ein pnpm-Override im
Root-Paket hält sämtliche Laufzeit- und Buildpfade auf 1.2.2; das Lockfile enthält
keine 1.2.1-Kopie mehr. Andere Paketversionen werden nicht mit aktualisiert.

`tests/workspace/source-map-security.test.mjs` lädt die Abhängigkeit über den
wirklichen Laufzeitpfad. Es prüft die sofortige Ablehnung eines übergroßen
Offsets, ohne die Ressourcenverstärkung auszuführen, sowie gültige Maps.
Die vollständige Qualitätssuite prüft zusätzlich HTML-Bereinigung, API,
Browserabläufe, Build und Backup/Restore.

Der Override darf entfallen, sobald ohne ihn alle Lockfile-Pfade auf einer
behobenen Version auflösen und Regressionstest sowie Laufzeit-Audit grün bleiben.
Ein punktuelles Audit ist keine dauerhafte Sicherheitsfreigabe. Wiederholen mit:

```sh
pnpm audit --prod
```

Neue Befunde und fehlgeschlagene Registry-Abfragen sind zu prüfen; diese Notiz
führt keine Ignore-Liste und schwächt keine vorhandenen Prüfungen ab.
