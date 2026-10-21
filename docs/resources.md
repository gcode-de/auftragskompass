# Ressourcenstamm (C014)

Der angemeldete Administrationsbereich verwaltet Ressourcen mit Bezeichnung,
eindeutigem internem Code, frei benennbarer Kategorie, Beschreibung, Bestand,
Vor-/Nachpuffer in ganzen Tagen, Sperrkennzeichen, Sortierung und Zustand
(aktiv/inaktiv/archiviert). Bestände sind ganze Zahlen von 0 bis 10000, Puffer
0 bis 365 Tage. Codes werden pro Mandant ohne Beachtung von Großschreibung und
äußeren Leerzeichen auf Eindeutigkeit geprüft.

Die additive Migration `0007_resources.sql` legt für bestehende und neue Mandanten
FB1 und FB2 als getrennte Fotoboxen mit Bestand eins und jeweils zwei Tagen Puffer
vorher/nachher an. Glamour-Paket und Schwarzwald-Paket beginnen als Zubehör mit
Bestand eins und ohne Standardpuffer. Alle Werte sind danach konfigurierbar;
Neustarts setzen Änderungen nicht zurück. Kategorie ist eine freie Bezeichnung.

`GET /api/v1/resources` liefert alle Ressourcen einschließlich archivierter Werte.
POST auf denselben Pfad legt eine Ressource an; PUT `/api/v1/resources/:id` ersetzt
ihre bearbeitbaren Werte und verlangt zusätzlich die zuletzt gelesene `version`.
Felder: `name`, `code`, `category`, `description`, `quantity`, `beforeDays`,
`afterDays`, `blocked`, `position`, `state`. Erfolg: 201 bzw. 200; veraltete Version
oder doppelter Code: 409; unbekannte oder fremde ID: 404; ungültige Eingabe: 400.
Session, Origin und CSRF-Schutz gelten auch hier. Schreibberechtigung wird unter
Mandantensperre innerhalb der Transaktion erneut geprüft. Änderungen und Audit
(`resource.created`/`resource.updated`) sind atomar; Audit enthält nur interne IDs.

Die Verwaltung liegt seit H033 unter Einstellungen (`#settings-resources`) und
nicht mehr in der Hauptnavigation. Der alte Deep Link `#resources` öffnet
denselben Abschnitt ohne Neuladen; Ressourcenzuweisung in Event-Details und
Kalender bleibt unverändert erreichbar.

Archivierung erhält die Ressourcen-ID; ein Löschendpunkt existiert nicht. Historische
Verweise können den zusammengesetzten Fremdschlüssel `(tenant_id, id)` verwenden.
Die Oberfläche hält Eingaben bei Fehlern vor und meldet Versionskonflikte.

Dies ist der Ressourcenstamm. Reservierungen, Doppelbuchungsschutz und zeitlich
begrenzte Wartungsblockierungen folgen in C021–C024. Das Sperrkennzeichen erfasst
den Stammdatenzustand; C014 prüft noch keine tatsächlichen Buchungsüberschneidungen.

Ab C021 erhalten Bestände stabile physische Einheiten. Künftige aktive Belegungen schützen betroffene Einheiten vor Bestandsreduktion und Archivierung; siehe [Reservierungsmodell](reservations.md).
