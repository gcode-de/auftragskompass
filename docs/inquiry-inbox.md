# Verschlüsselter Anfrage-Zwischenspeicher (E004.5)

Der [Zwischenspeicher](../packages/core/src/inquiry-inbox.ts) ergänzt den
[Übergabevertrag](gateway-protocol.md) und die
[acht bestehenden Websitefelder](website-inquiries.md). Er ist eine interne
Bibliothek, noch kein öffentlicher HTTP-Empfang. Website, Bookitup, echte Kontakte,
Events und Inhaberpasswort bleiben unverändert. Es gibt keinen Nachrichtenversand.

## Konfiguration und Daten

Der Aufrufer muss Mandant, Speicher-Schlüsselring, aktive Schlüssel-ID,
Aufbewahrungsdauer und Kapazität explizit vorgeben. Keine laufende Installation
wird still konfiguriert. Erlaubt sind 1–168 Stunden und 1–10.000 gespeicherte
Einträge je Mandant, einschließlich quittierter technischer Belege. Das sind
technische Grenzen, keine fachlich freigegebene Aufbewahrungsentscheidung.
Ein voller Speicher nimmt keine weitere Anfrage scheinbar erfolgreich an.

Neue Eingänge verwenden eine öffentliche zufällige UUID als Wiederholkennung,
getrennt von späteren internen Kontakt-/Event-IDs. Alle Eingaben müssen den
versionierten Feldvertrag erfüllen und als JSON insgesamt maximal 32.768 UTF-8-Bytes
belegen. NUL und nicht wohlgeformte Unicodezeichen werden vor Speicherung
abgewiesen; es werden keine Zeichen durch Ersatzzeichen ausgetauscht. Der aus
getrimmtem Vor-/Nachnamen gebildete Kontaktname darf gemeinsam mit dem Leerzeichen
maximal 200 Unicode-Codepunkte belegen. Die originalen Feldwerte werden erhalten.

Die [separate Migration](../packages/core/gateway-migrations/gateway-0002-inquiries.sql)
speichert ausschließlich Mandant, öffentliche Anfragekennung, Formular-ID/Version,
Schlüssel-ID, einen geschützten Fingerabdruck, Zeitpunkte und Chiffratdaten.
Namen, E-Mail, Ort, Telefon, Kommentar und der zum Empfang gehörende Datenschutztext
liegen ausschließlich im authentifiziert verschlüsselten Inhalt. Die Tabelle
unterstützt bereits weitere sichere Formular-IDs und positive Versionen; der
aktuelle Eingangsvalidator kennt weiterhin ausschließlich das bestätigte erste
Formular. Weitere Formulare und deren Verwaltung sind damit noch nicht fertig.

## Verschlüsselung und Rotation

Jeder Speicherschlüssel besteht aus 32 zufälligen geheimen Bytes. Aus diesem
Master werden mit HKDF-SHA-256 und getrennten Zwecken pro Mandant ein
Verschlüsselungs- und ein Fingerabdruckschlüssel abgeleitet. AES-256-GCM verwendet
je Eintrag einen neuen zufälligen 12-Byte-IV und einen 16-Byte-Tag. Die zusätzlichen
authentifizierten Daten binden Mandant, Kennung, Formular/Version, Schlüssel-ID,
Fingerabdruck sowie Empfang und Ablauf. Kopierte oder veränderte Chiffrate werden
nicht als Klartext ausgegeben. Speicherschlüssel und Übergabe-Signaturschlüssel
getrennt und außerhalb von Git/Datenbank verwahren.

Ein HMAC über die kanonisch geordneten bekannten Formularfelder schützt den
Wiederholvergleich. Unterschiedliche JSON-Schlüsselreihenfolge ändert den Inhalt
nicht. Neue Werte mit derselben Kennung scheitern; ein Retry verlängert keine
Frist und erzeugt keine zweite Anfrage. Ein mandantengebundener transaktionaler
Lock sichert gleichzeitig Kapazität und parallele Wiederholungen ab.

Zur Rotation neue ID und neuen Master hinzufügen und als aktiv wählen. Alte
Schlüssel müssen für noch gespeicherte Einträge und Wiederholbelege verfügbar
bleiben. Nur der aktive Schlüssel schreibt neue Daten; vorhandene Einträge behalten
ihre ursprüngliche Schlüssel-ID. Fehlende/falsche Schlüssel, beschädigte Inhalte
oder DB-Fehler ergeben eine neutrale Störung ohne Inhalte oder Originalfehler.
Schlüssel werden beim Aufbau des Repositories kopiert, nicht vom Aufrufer
nachträglich veränderbar gehalten. Eine neue Konfiguration braucht eine neue Instanz.

## Abholung, Quittierung und Ablauf

`pending` liest nur den eigenen noch nicht quittierten und noch nicht abgelaufenen
Bestand, stabil sortiert und auf 1–100 Einträge begrenzt. Es ist kein öffentlicher
Download. Vor einer HTTP-Anbindung sind weiterhin Signatur, Replay-Schutz,
konkrete Payload-Prüfung und die Begrenzung der signierten Antwortgröße nötig.

Erst nach bestätigtem lokalem Datenbank-Commit darf eine authentifizierte
Quittierung folgen. `acknowledge` entfernt Chiffrat, IV und Tag in einem atomaren
Update und erhält nur den technischen Wiederholbeleg bis zum ursprünglichen
Ablauf. Wiederholtes Quittieren verändert den ersten Quittierungszeitpunkt nicht.
WAL und Sicherungskopien haben eigene Fristen; dies ist keine physische Löschung
aller früheren Speicherstände oder eine rechtliche Löschfreigabe.

Ein abgelaufener Retry meldet `expired`, nicht einen vermeintlichen Eingang.
Die Dauer ist eine exakte UTC-Zeitspanne; Sommer-/Winterzeit ändert sie nicht.
`prune` löscht ausdrücklich nur eigene abgelaufene Einträge und meldet getrennt
die Zahl gelöschter noch nicht quittierter Eingänge. Diese Zahl muss als
Übernahmefehler sichtbar werden. Hier wird weder ein Bereinigungsjob aktiviert
noch ein realer Eingang gelöscht.

Vor öffentlicher Aktivierung sind Aufbewahrung, rechtzeitige Fehlerüberwachung,
Bereinigung, Sicherung der Gateway-Datenbank und separate Schlüsselverwahrung
festzulegen und zu testen. Nicht abgeholte Anfragen dürfen nicht unbemerkt die
Maximalfrist erreichen. Lokale Kontakt-/Eventanlage, fachliche Dublettenprüfung,
WordPress-Einbindung und Website-Umschaltung bleiben separate Schritte.
