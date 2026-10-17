# Datenexport im Testbetrieb

Unter **Einstellungen → Datenexport** (`#settings-export`) stehen native Downloads
für Kontakte, Events und den Produktkatalog bereit. Eine aktive Administratorsitzung
ist erforderlich. Es werden immer alle eigenen Datensätze des Bereichs ausgegeben,
auch archivierte, inaktive, undatierte und annullierte Einträge soweit vorhanden.
Die Filter der Event- oder Kontaktliste schränken diese Downloads nicht ein.

| Datei | Inhalt | Formatdetails |
|---|---|---|
| `contacts.csv` | Namen, Anschriften, Kommunikationsdaten und Archivzustand | [Kontaktvertrag](contacts.md) |
| `events.csv` | Termine, Status, Referenz-IDs und Namen, Beschreibung und Notizen | [Eventvertrag](events.md#eventexport-e0053) |
| `products.csv` | Produktstamm mit exakten Preis-/Steuereinheiten und Zustand | [Produktvertrag](products.md#offener-export-e0054) |

CSV-Dateien verwenden UTF-8 mit BOM, CRLF und maskierten Sonderzeichen. Der
Formelschutz ergänzt bei riskanten Textanfängen einen Apostroph. IDs, Centwerte
und Steuerwerte bei der Weiterverarbeitung als exakte Daten importieren; die
Interpretation im Tabellenprogramm separat prüfen. Dies ist kein definierter
Rückimportvertrag.

Die Dateien gehören in eine private, zugriffsgeschützte Ablage außerhalb von Git.
Sie sind keine vollständige Datensicherung: Reservierungen, Logbuch,
Importherkunft und weitere Verknüpfungen bleiben Bestandteil der vollständigen
Datenbanksicherung. Für Wiederherstellung gelten die geprüften
[Backup-/Restore-Verfahren](scheduled-backup.md). Diese Oberfläche aktiviert
weder einen Sicherungstimer noch eine unabhängige Zweitkopie und bestätigt keine
Produktivfreigabe.

Abnahme erfolgt ausschließlich mit synthetischen Daten: drei Downloads mit
geprüftem Dateinamen/Inhalt im HTTPS-Chromium-Geschäftsablauf, aktiver Menüpunkt,
getrennte Arbeitsbereiche, vollständige Desktop-/Mobilaufnahmen in beiden
Farbmodi und kein Seitenüberlauf bei 390px. Es werden keine echten Daten zu
Testzwecken heruntergeladen.
