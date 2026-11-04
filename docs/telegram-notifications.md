# Telegram-Benachrichtigungen für Website-Anfragen

AuftragsKompass kann nach dem dauerhaften lokalen Empfang einer neuen
Website-Anfrage einen neutralen Hinweis per Telegram senden. Die Nachricht
enthält keine Kundendaten. Die Anfrage wird unabhängig vom Versand gespeichert
und wie bisher verarbeitet. Bereits vor der Aktivierung lokal empfangene
Anfragen werden nicht nachträglich benachrichtigt.

## Einrichtung

API und Worker benötigen denselben separat verwahrten 32-Byte-Schlüssel als
64 hexadezimale Zeichen in einer Datei. `AK_TELEGRAM_ENCRYPTION_KEY_FILE` muss
in beiden Containern auf diese Datei zeigen. Den Schlüssel mit einem sicheren
Zufallsgenerator erzeugen, als schreibgeschütztes Secret bereitstellen und
außerhalb des Git-Repositories zusammen mit den übrigen
Wiederherstellungsschlüsseln sichern. Niemals einen neuen Schlüssel über den
bestehenden schreiben: Ohne den ursprünglichen Schlüssel kann der gespeicherte
Bot-Token nach einer Wiederherstellung nicht entschlüsselt werden.

Unter **Einstellungen → Telegram** können Administratoren den Bot-Token und
die Chat-ID hinterlegen oder die Benachrichtigung wieder deaktivieren. Der
Token wird nach dem Speichern nicht erneut angezeigt. Den Bot zuvor im
gewünschten Chat starten. Nur Personen mit Administratorrechten sollen Zugang
zur Einstellung erhalten.

## Betrieb

Der Versand läuft über eine Datenbankwarteschlange mit Wiederholung bei
Fehlern und einem auf sechs Stunden begrenzten Wiederholungsabstand. Auch
dauerhaft ungültige Zugangsdaten werden weiter versucht; nach Korrektur der
gespeicherten Zugangsdaten setzt ungesperrte, offene Hinweise unmittelbar zur
erneuten Zustellung frei. Ein bereits laufender Versand bleibt gesperrt, bis er
endet oder seine Lease abläuft. Deaktivieren beendet wartende Hinweise.

Worker-Logs unterscheiden Datenbank-, Entschlüsselungs-, Netzwerk-, ungültige
Antwort- und Telegram-Ablehnungsfehler. Bei einer Ablehnung erscheinen nur der
HTTP-Status und ein numerischer Telegram-Fehlercode, falls vorhanden. Antworttexte,
URLs, Tokens, Chat-IDs und Anfragedaten werden nicht protokolliert. Eine
`telegram_rejected`-Meldung mit HTTP-Status und Code ist ein Hinweis für den
Betreiber, die gespeicherten Bot-/Chat-Zugangsdaten und Bot-Berechtigungen zu
prüfen.

Telegram kann eine Nachricht angenommen haben, obwohl die Antwort verloren
geht; beim erneuten Versuch kann dann ein Hinweis doppelt ankommen. Ein Hinweis
belegt den lokalen Eingang, nicht die erfolgreiche Anlage oder Bearbeitung eines
Events. Wenn die lokale App oder ihre Verbindung zum Gateway ausfällt, kann der
Hinweis erst nach Wiederherstellung und lokaler Übernahme eintreffen. Das ersetzt
keine Überwachung des Formulars oder Backups.

Bei Deaktivierung werden wartende Hinweise verworfen; ein bereits gestarteter
Versand kann noch eintreffen. Für eine Ende-zu-Ende-Abnahme eine ausdrücklich
als Test gekennzeichnete Anfrage und
den vorgesehenen Telegram-Chat verwenden; keine echten Kunden anschreiben.
