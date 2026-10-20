# Kontakte

C016 unterstützt Privatpersonen und Firmen mit Ansprechpartner, Anschrift, E-Mail, Festnetz und Mobilnummer. Kontakte werden archiviert, nicht gelöscht; IDs bleiben für spätere Event- und E-Mail-Verknüpfungen erhalten. Zugeordnete Events sind ab C018 über „Events anzeigen“ verfügbar; E-Mail-Verknüpfungen folgen mit C042. Es werden keine vorhandenen Kundendaten automatisch importiert.

## Oberfläche

Die Kontaktseite beginnt mit der Suchwerkzeugleiste und zeigt unmittelbar darunter die Liste. Das Anlegen und Bearbeiten liegt in einem modalen Dialog, der über die 44-px-Icon-Aktion „Kontakt anlegen“ beziehungsweise die Bearbeiten-Aktion der Zeile geöffnet wird. Auch „Events anzeigen“ und „Kontakt bearbeiten“ sind ruhige 44-px-Icon-Aktionen ohne sichtbaren Text; ihre zugänglichen Namen nennen weiterhin den Kontakt, die `title` den Zweck. E-Mail-, Telefon- und CSV-Export-Links bleiben Text. Der Dialog folgt dem bestehenden Muster aus dem Event-Anlegen: `aria-modal`, eigener Titel „Kontakt anlegen“/„Kontakt bearbeiten“, initialer Fokus im ersten Bedienelement, Tab-Falle, Schließen per X, Escape oder „Kontakt abbrechen“ mit Fokusrückkehr auf den Auslöser und Rückfall auf die Plus-Aktion.

Die Formularwerte sind kontrolliert und werden beim Wechsel des Ziels neu gesetzt; bestehende Kontakte behalten ihre `version`. Ein geänderter Entwurf verlangt beim Schließen eine ausdrückliche Verwerfen-Bestätigung und ist im kleinen Dirty-Hook registriert, den der Heim- und Suchwechsel auswertet. Andere Navigationslinks und Browser-Zurück bleiben wie bei den Events ungeschützt. Während eines laufenden POST/PUT sind Schließen, Escape und Abbrechen gesperrt; der Dialog bleibt als `aria-busy` gekennzeichnete Fläche fokussiert, Tab und Shift+Tab verlassen ihn auch bei vollständig deaktivierten Bedienelementen nicht, und nach einem Fehlschlag werden Eingaben und Fehlertext (mit Fokus) für den erneuten Versuch behalten. Ein bestätigtes Speichern schließt den Dialog, leert den Entwurf und lädt die Liste neu; scheitert nur dieser GET, bleibt die Meldung „gespeichert, die Liste konnte nicht neu geladen werden“ mit einer reinen Wiederholungsaktion ohne zweite Mutation sichtbar. Ein erfolgreicher Listenabruf – auch über Suche/Filter – entfernt Hinweis und Wiederholungsknopf; ein verspäteter älterer Abruf löscht einen neueren Fehler nicht. Eine erfolgreiche Dublettenprüfung meldet „Keine möglichen Dubletten gefunden.“ als ruhigen Status ohne Fehlerfarbe und wird bei einer Eingabeänderung verworfen; echte Dubletten- oder Speicherfehler bleiben als Alarm mit Feldfehlerfarbe sichtbar. Suchtext und Listeninhalt bleiben beim Öffnen und Schließen erhalten; `#contact-<id>` bleibt als Route nutzbar und die Liste vergibt passende Zeilenanker.

## API v1

Alle Routen benötigen die lokale Admin-Sitzung. Schreibende Routen verlangen zusätzlich Origin und CSRF-Token. Der Mandant kommt ausschließlich aus der Serverkonfiguration.

- `GET /api/v1/contacts?q=Suchtext`: Suche über Name, Ansprechpartner, E-Mail, Telefonnummern und Anschrift; archivierte Kontakte bleiben sichtbar. SQL-Suchzeichen werden wörtlich gesucht.
- `POST /api/v1/contacts`: Kontakt anlegen.
- `PUT /api/v1/contacts/:id`: vollständige Änderung mit aktueller `version`; veraltete Version ergibt 409, fremde oder fehlende ID 404.
- `POST /api/v1/contacts/duplicates`: `email`, `phone`, `mobile`, `country`, optional `excludeId`; schlägt Kontakte desselben Mandanten mit gleicher E-Mail oder Telefonnummer vor, einschließlich Archiv.
- `GET /api/v1/contacts/export.csv`: vollständiger Export als UTF-8-CSV mit BOM, zitierten Feldern und Schutz vor Tabellenformeln. Enthält personenbezogene Daten und ist entsprechend aufzubewahren.

Der vollständige Schreibdatensatz enthält `kind` (`private`/`company`), `name`, `contactPerson`, `street`, `postalCode`, `city`, `country` (zweistelliger Großbuchstabencode), `email`, `phone`, `mobile`, `state` (`active`/`archived`). Leere optionale Felder werden als leere Zeichenketten übertragen. Antworten enthalten zusätzlich `id` und `version`, keine Mandanten- oder Vergleichsschlüssel.

## Normalisierung und Speicherung

Migration `0009_contacts.sql` ergänzt mandantengebundene Kontakte und Suchindizes. E-Mail-Adressen werden getrimmt und kleingeschrieben. Telefonnummern behalten ihre Schreibweise; der Vergleich entfernt Trennzeichen und gleicht internationale `+`-/`00`-Schreibweise sowie die optionale `(0)` an. Für `DE` wird eine nationale führende Null zu `49`. Für andere Länder werden keine Landesvorwahlen geraten. Leere Werte erzeugen keine Dubletten; gemeinsame Firmenanschriften oder Telefonnummern verbieten keine Anlage. Dublettenvorschläge sind Hinweise und führen keine Kontakte automatisch zusammen.

Änderungen prüfen Adminrechte und Version innerhalb derselben Transaktion wie der Audit-Eintrag. Das Audit enthält nur Aktion und interne Referenzen. CSV-Downloads und Suchparameter dürfen vom vorgeschalteten TLS-Proxy nicht protokolliert werden. Direkte E-Mail-/Anruflinks öffnen das lokale Standardprogramm.
