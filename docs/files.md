# Dateibibliothek (BKP020.1)

Die Dateibibliothek ist seit BKP020.1 der eigene, ausdrücklich beschriftete
Teil „Dateibibliothek“ der Dateienansicht (`#files`) neben dem
Geschäftsdokumentindex. Sie speichert hochgeladene Dateien mandantengebunden
im vorhandenen Storage-Adapter; der Geschäftsdokumentindex über `documents`
bleibt unverändert erhalten.

## Datei und Speicherung

Migration `0038_library_files.sql` legt `library_files` an: `display_name`
(bis 200 Zeichen, ausschließlich Daten), `media_type` (`pdf`, `png`, `jpeg`,
`zip`), `size_bytes` (1 bis 10 MiB), `sha256`, `storage_key`, `scan_state`,
`state`, Upload- und Archivzeitpunkte sowie ein Idempotenzbeleg
(`library_file_upload_operations` nach Muster der Vorlagen-Belege). Der
Speicherschlüssel wird ausschließlich aus einer UUID plus abgeleiteter
Endung gebildet – niemals aus dem Dateinamen; `../`, NUL, Steuerzeichen,
sehr lange Namen, Emoji und Rechts-nach-links-Zeichen bleiben reine Daten und
können weder Pfade noch Header beeinflussen.

Der Upload wird als JSON mit Base64-Inhalt übertragen (Name bleibt aus URLs
und Logs). Der Server prüft die deklarierte Art gegen die tatsächliche
Dateisignatur (MIME-Spoofing ergibt 415 ohne Zeile und ohne Ablage), die
Größe (die Grenze von 10 MiB ist selbst erlaubt, ein Byte darüber ergibt
413) und die strenge kanonische Base64-Schreibweise. ZIP-Dateien werden
niemals entpackt. Es gibt bewusst keine Deduplizierung über den Prüfsummen-
Wert: dieselben Bytes zweimal hochgeladen ergeben zwei getrennte Dateien.

## Prüfstatus

Es ist **kein Virenscan eingerichtet**. Jede Datei liegt deshalb im Zustand
`scan_state = not_scanned`; die Oberfläche weist das sichtbar aus („unverprüft“).
Der Zustand ist bewusst offen gehalten: ein späterer Anhangsweg (Mails,
BKP021+) darf Dateien erst nach erfolgreicher Prüfung anhängen – mit dem
heutigen Stand ist das ausgeschlossen. Abgewiesene Uploads werden nicht
persistiert (HTTP-Ergebnis plus Audit); `rejected` bleibt als Datenbankzustand
für die spätere Prüfstrecke reserviert.

## Download und Archiv

Der Download ist autorisiert, liefert ausschließlich als Anhang
(`Content-Disposition: attachment` mit saniertem `filename*`), setzt
`X-Content-Type-Options: nosniff` und gibt niemals HTML oder SVG im
App-Origin aus. Archivieren ist idempotent; archivierte Dateien werden nicht
mehr ausgeliefert, ihre Bytes bleiben im Speicher (kein automatisches
Löschen, keine Retention – dazu ist eine eigene Betreiberentscheidung nötig).
Ersetzen oder Versionieren gibt es nicht; alte in finalen Dokumenten
referenzierte Bytes bleiben unverändert.

## API v1

- `GET /api/v1/library-files`: eigene Dateien als Array (Name, Art, Größe,
  Zeit, Zustand, Prüfstatus).
- `POST /api/v1/library-files`: Upload (`displayName`, `mediaType`,
  `contentBase64`, `requestId`); 201 mit gespeicherter Zeile; 400/413/415 bei
  ungültigen Daten; wiederholte gleiche `requestId` liefert die gespeicherte
  Antwort ohne zweite Datei.
- `GET /api/v1/library-files/:id/content`: Download (404 für fremde,
  unbekannte oder archivierte Dateien).
- `POST /api/v1/library-files/:id/archive`: Archivieren (idempotent).

Alle Routen benötigen die Admin-Sitzung; Schreibrouten zusätzlich Origin und
CSRF-Token. Audit-Einträge (`file.uploaded`, `file.archived`) entstehen in
derselben Transaktion wie die Zeile.

## Offene Bausteine (nicht Teil von BKP020.1)

Eventverknüpfung und Kategorien (Upload/Standard/Mailanhang), Ersetzen/
Versionierung, Mailanhangpicker, die acht Standarddateien (DA-07, braucht
echte Bestandsdateien außerhalb Git), Suche/Filter/Paginierung der Liste bei
großen Beständen sowie Retention/Löschung sind gesonderte Folgeslices.
