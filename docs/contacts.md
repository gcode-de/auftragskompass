# Kontakte

C016 unterstützt Privatpersonen und Firmen mit Ansprechpartner, Anschrift, E-Mail, Festnetz und Mobilnummer. Kontakte werden archiviert, nicht gelöscht; IDs bleiben für spähere Event- und E-Mail-Verknüpfungen erhalten. Zugeordnete Events sind seit BKP011.1 in der lesenden Kontaktakte sichtbar (Name, Datum bzw. „Ohne Datum“, Status); E-Mail-Verknüpfungen folgen mit C042. Es werden keine vorhandenen Kundendaten automatisch importiert.

## Oberfläche

Die Kontaktseite beginnt mit der Suchwerkzeugleiste und zeigt unmittelbar darunter die Liste. Der Kontaktname ist ein nativer Link auf die lesende Kontaktakte, die inline in der Zeile aufklappt (Zeilenzusammenfassung bleibt verborgen): Kopf mit Typ (Privatperson/Firma), Name und deutlichem Archivzustand; Kontaktweg mit sichtbarem gespeichertem Wert für Ansprechpartner, E-Mail und Telefon(en) sowie korrekt gesetzten `mailto:`/`tel:`-Links; Anschrift aus den gespeicherten Teilen mit Land als verständlicher Bezeichnung (`Intl.DisplayNames`, Fallback auf den gespeicherten ISO-Code); zugehörige Events aus `GET /api/v1/contacts/:id/events` mit Lade-, Leer- und Fehlerzustand samt GET-Wiederholung. Fehlende optionale Werte werden ehrlich als „Nicht angegeben“ bzw. „Keine Anschrift hinterlegt.“ gezeigt; es gibt keine Mail- oder Datei-Tabs (folgen mit ihren Modulen). Genau eine sekundäre Bearbeiten-Aktion öffnet den vorhandenen Dialog, eine tertiäre Schließ-Aktion gibt `#contacts` frei und stellt Suche, Scroll und Fokus wieder her; der Deep Link `#contact-<id>` öffnet die Akte zusätzlich zum Zeilenanker. Das Anlegen und Bearbeiten liegt in einem modalen Dialog, der über die 44-px-Icon-Aktion „Kontakt anlegen“ beziehungsweise die Bearbeiten-Aktion der Zeile geöffnet wird. „Kontakt bearbeiten“ ist eine ruhige 44-px-Icon-Aktion ohne sichtbaren Text; der zugängliche Name nennt weiterhin den Kontakt, die `title` den Zweck. E-Mail-, Telefon- und CSV-Export-Links bleiben Text. Der Dialog folgt dem bestehenden Muster aus dem Event-Anlegen: `aria-modal`, eigener Titel „Kontakt anlegen“/„Kontakt bearbeiten“, initialer Fokus im ersten Bedienelement, Tab-Falle, Schließen per X, Escape oder „Kontakt abbrechen“ mit Fokusrückkehr auf den Auslöser und Rückfall auf die Plus-Aktion.

Die Formularwerte sind kontrolliert und werden beim Wechsel des Ziels neu gesetzt; bestehende Kontakte behalten ihre `version`. Ein geänderter Entwurf verlangt beim Schließen eine ausdrückliche Verwerfen-Bestätigung und ist im kleinen Dirty-Hook registriert, den der Heim- und Suchwechsel auswertet. Andere Navigationslinks und Browser-Zurück bleiben wie bei den Events ungeschützt. Während eines laufenden POST/PUT sind Schließen, Escape und Abbrechen gesperrt; der Dialog bleibt als `aria-busy` gekennzeichnete Fläche fokussiert, Tab und Shift+Tab verlassen ihn auch bei vollständig deaktivierten Bedienelementen nicht, und nach einem Fehlschlag werden Eingaben und Fehlertext (mit Fokus) für den erneuten Versuch behalten. Ein bestätigtes Speichern schließt den Dialog, leert den Entwurf und lädt die Liste neu; scheitert nur dieser GET, bleibt die Meldung „gespeichert, die Liste konnte nicht neu geladen werden“ mit einer reinen Wiederholungsaktion ohne zweite Mutation sichtbar. Ein erfolgreicher Listenabruf – auch über Suche/Filter – entfernt Hinweis und Wiederholungsknopf; ein verspäteter älterer Abruf löscht einen neueren Fehler nicht. Eine erfolgreiche Dublettenprüfung meldet „Keine möglichen Dubletten gefunden.“ als ruhigen Status ohne Fehlerfarbe und wird bei einer Eingabeänderung verworfen; echte Dubletten- oder Speicherfehler bleiben als Alarm mit Feldfehlerfarbe sichtbar. Suchtext und Listeninhalt bleiben beim Öffnen und Schließen erhalten; `#contact-<id>` bleibt als Route nutzbar und die Liste vergibt passende Zeilenanker.

## API v1

Alle Routen benötigen die lokale Admin-Sitzung. Schreibende Routen verlangen zusätzlich Origin und CSRF-Token. Der Mandant kommt ausschließlich aus der Serverkonfiguration.

- `GET /api/v1/contacts?q=Suchtext`: Suche über Name, Ansprechpartner, E-Mail, Telefonnummern und Anschrift; archivierte Kontakte bleiben sichtbar. SQL-Suchzeichen werden wörtlich gesucht.
- `GET /api/v1/contacts/:id`: vollständiger gespeicherter Einzelkontakt mit Version; fehlende oder fremde UUID liefert 404, ungültige UUID 400.
- `POST /api/v1/contacts`: Kontakt anlegen.
- `PUT /api/v1/contacts/:id`: vollständige Änderung mit aktueller `version`; veraltete Version ergibt 409, fremde oder fehlende ID 404.
- `POST /api/v1/contacts/duplicates`: `email`, `phone`, `mobile`, `country`, optional `excludeId`; schlägt Kontakte desselben Mandanten mit gleicher E-Mail oder Telefonnummer vor, einschließlich Archiv.
- `GET /api/v1/contacts/export.csv`: vollständiger Export als UTF-8-CSV mit BOM, zitierten Feldern und Schutz vor Tabellenformeln. Enthält personenbezogene Daten und ist entsprechend aufzubewahren.

Der vollständige Schreibdatensatz enthält `kind` (`private`/`company`), `name`, `contactPerson`, `street`, `postalCode`, `city`, `country` (zweistelliger Großbuchstabencode), `email`, `phone`, `mobile`, `state` (`active`/`archived`). Leere optionale Felder werden als leere Zeichenketten übertragen. Antworten enthalten zusätzlich `id` und `version`, keine Mandanten- oder Vergleichsschlüssel.

## Direkte Feldbearbeitung (EDIT-01)

Bestehende Kontakte sind zusätzlich direkt in ihrer Akte bearbeitbar. Gültige
Änderungen werden beim Verlassen des Felds gespeichert; unveränderte Felder
erzeugen keinen PUT. Escape verwirft ausschließlich die aktuelle noch nicht
abgeschlossene Eingabe und unterdrückt die folgende Blur-Speicherung. Frühere
bereits beim Verlassen freigegebene Änderungen bleiben in der Warteschlange;
laufende Speicherungen werden nicht als abgebrochen dargestellt. Andere
Feldentwürfe bleiben erhalten. IME-Komposition wird dabei nicht unterbrochen.

Die UI sendet vollständige, wie im Dialog getrimmte Kontaktdaten mit der zuletzt
bestätigten Version, jeweils nur einen PUT gleichzeitig. Aktive Entwürfe anderer
Felder gehen nicht in diese Anfrage ein. Gespeicherte Normalisierung und Version
werden direkt aus der geprüften Antwort übernommen; spätere Eingaben können
diese Antwort überleben, auch eine bewusste Rückänderung zum ursprünglichen Wert.
„Wird gespeichert“, offene Eingaben und bestätigter Stand sind unterscheidbar.

Nach Konflikt oder unklarem Ausgang pausiert die Warteschlange. „Aktuellen Stand
laden“ liest den Einzelkontakt, ohne Entwürfe zu ersetzen oder einen PUT zu
wiederholen. Erst nach sichtbarem Vergleich entscheidet der Benutzer ausdrücklich
zwischen Serverstand übernehmen (mit Verwerfbestätigung) und den bereits
abgeschlossenen lokalen Änderungen auf dieser Version anwenden. Aktive, noch
nicht abgeschlossene Feldentwürfe bleiben bei letzterem erhalten.

Lokale Schließ-/Such-/Zeilenwechsel schützen schmutzige Kontakte. Der gemeinsame
Navigationsschutz fängt bei aktiven Feldentwürfen oder ausstehenden Speicherungen
auch andere Bereichslinks und Browser-Zurück vor dem Unmount ab. Ein Neuladen
oder Schließen des Browserfensters verwendet den nativen Browserhinweis. Bei
bestätigtem Verlassen kann eine bereits versandte Speicherung noch abschließen.
Andere, weiterhin montierte Verwaltungsformulare behalten ihr bisheriges
Verhalten und ihre Entwürfe. Ein expliziter Listenabruf überschreibt keinen
aktiven Kontaktentwurf; verspätete Antworten werden verworfen.

Bei aktiver Suche bleibt eine gerade bearbeitete Akte bis zum Verlassen bewusst
geöffnet und weist darauf hin, dass anschließend die Trefferliste erneut
geprüft wird. Der tatsächliche angewandte Filter wird verwendet. Ein Lesefehler
erhält die bestätigte Zeile mit Warnung. Auch der bestehende Dialog übernimmt
die bestätigte Zeile unmittelbar und ist für den Speichererfolg nicht von einem
anschließenden Listen-GET abhängig. Die Kontaktanlage bleibt ein bewusster
Dialogabschluss.

## Normalisierung und Speicherung

Migration `0009_contacts.sql` ergänzt mandantengebundene Kontakte und Suchindizes. E-Mail-Adressen werden getrimmt und kleingeschrieben. Telefonnummern behalten ihre Schreibweise; der Vergleich entfernt Trennzeichen und gleicht internationale `+`-/`00`-Schreibweise sowie die optionale `(0)` an. Für `DE` wird eine nationale führende Null zu `49`. Für andere Länder werden keine Landesvorwahlen geraten. Leere Werte erzeugen keine Dubletten; gemeinsame Firmenanschriften oder Telefonnummern verbieten keine Anlage. Dublettenvorschläge sind Hinweise und führen keine Kontakte automatisch zusammen.

Änderungen prüfen Adminrechte und Version innerhalb derselben Transaktion wie der Audit-Eintrag. Das Audit enthält nur Aktion und interne Referenzen. CSV-Downloads und Suchparameter dürfen vom vorgeschalteten TLS-Proxy nicht protokolliert werden. Direkte E-Mail-/Anruflinks öffnen das lokale Standardprogramm.
