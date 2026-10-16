# Ressourcenabgleich vor dem Umstieg (C076)

Stand: 16.10.2026. C076 ist technisch mit fiktiven Daten geprüft. Das ist keine
Bestätigung des echten Bookitup-Bestands und keine Produktivfreigabe.

## Bedienung

In **Einstellungen → Importbestand und Ressourcen-Prüfliste** bei jeder offenen
Bestandszusage **Ressourcen prüfen** wählen. Originalauftrag, Kontakt, Paket,
Termin, Zeitzone und Notizen mit der privaten Sicherung abgleichen. Bei Bedarf
fehlende Stammdaten über einen geprüften Deltaimport vervollständigen; Kontakt,
Paket und Datum sind für eine bestätigte importierte Zusage erforderlich.

Die bekannte Ressourcenzuweisung wird wiederverwendet. FB1, FB2 und jedes
benötigte Zubehörteil ausdrücklich auswählen. Es gibt keine automatische
Boxzuordnung aus Namen, Paket oder Freitext. Jede Einheit zeigt Puffer und
bestehende Konflikte; eigene Dispositionszeiträume sind wie im normalen Auftrag
möglich. Fehlende Uhrzeiten werden nicht erfunden. Eine Zusage ohne Eventuhrzeit
braucht einen manuell geprüften vollständigen Dispositionszeitraum je gewählter
Einheit. **Verfügbarkeit prüfen** berücksichtigt bereits bestätigte Aufträge und
Sperren. Weitere noch ungeprüfte Zusagen bleiben in der Liste sichtbar und müssen
anschließend einzeln abgeglichen werden.

Mit **Geprüfte Bestandszusage übernehmen** werden der operative Auftrag, seine
Kontaktzuordnungen, Reservierungen, Importzuordnung und Prüfvermerk gemeinsam
festgeschrieben. Gebucht benötigt mindestens eine tatsächlich verfügbare Fotobox.
Zubehör allein genügt nicht. Die Datenbank schützt weiterhin vor Überschneidungen;
bei einer dritten gleichzeitigen Buchung bleibt die Zusage mit sichtbarem Konflikt
offen, bis eine andere Ressource oder eine fachlich korrekte Lösung gewählt wird.
Ein Fehler lässt weder einen halben Auftrag noch einen erledigten Prüfvermerk
zurück. Nach erfolgreichem Abgleich aktualisieren sich Prüfliste und Kalender.

Wenn sich der tatsächliche Status seit dem Export geändert hat, kann er im
Abgleich bewusst angepasst werden. Annulliert beziehungsweise Nicht verfügbar
dürfen keine Ressourcenzuweisungen erhalten. Der ursprüngliche Quellstatus bleibt
in der Übernahmeherkunft erhalten. Eine manuelle Änderung des aktuellen Status
ist keine automatische Umbenennung einer Altzusage.

Solange noch irgendeine ungeprüfte Zusage offen ist, bleiben gewöhnliche
Buchungsbestätigungen gesperrt und der Kalender zeigt keinen Nachweis freier
Kapazität. Nur der explizite Importabgleich darf in dieser Phase einen geprüften
Bestandsauftrag bestätigen. Ein Fehler darf nicht durch Entfernen einer
Prüflistenzeile umgangen werden. Erst nach vollständigem fachlichem Abgleich
aller Boxen und Zubehörteile ist die Ressourcenabnahme für den echten Bestand
möglich. Betriebsfreigabe und externe Ersatzprozesse sind zusätzlich erforderlich.

## Inzwischen vergangene Zusagen

Ein vormals zukünftiger Auftrag kann vor dem Abgleich vergangen sein. Die
Anwendung bietet dann nach ausdrücklicher Bestätigung **Vergangene Zusage mit
Nachweis ausschließen**. Sie erzeugt keinen operativen Auftrag und keine
Reservierung und bezeichnet ihn nicht fälschlich als annulliert. Der ursprüngliche
Quellstand und der nachvollziehbare Prüfvermerk bleiben erhalten; die Herkunft
zeigt **Nach Zeitablauf ausgeschlossen**.

Mit vollständigen Zeitpunkten muss das Ende bereits erreicht sein. Bei reinem
Datum muss der Tag in der gespeicherten Zeitzone vor heute liegen. Eine zukünftige
oder zeitlich unklare heutige Zusage lässt sich auf diesem Weg nicht entfernen.
Bereits abgeschlossene Prüfungen werden durch Deltaimporte nicht stillschweigend
wieder geöffnet oder überschrieben. Ein erneut geänderter Quellstand wird
sichtbar blockiert und benötigt gesonderte fachliche Klärung.

## API, Nachweise und Migration

Die geschützten Admin-Endpunkte sind:

| Endpunkt | Bedeutung |
|---|---|
| `GET /api/v1/imports/bookitup/promises/:id` | Quell-Eventdaten mit Quellversion, Zeitzone, Prüfergebnis und zulässigem Ausschluss |
| `GET /api/v1/imports/bookitup/promises/:id/availability` | Ressourcen für den ausdrücklich gewählten Quellauftrag; optional `unitId`, `baseStart`, `baseEnd` gemeinsam für einen manuellen Zeitraum |
| `PUT /api/v1/imports/bookitup/promises/:id` | Vollständige normale Eventfelder mit Zielstatuscode, Quell-`version` und expliziter Liste `assignments`; keine schreibbaren `id`-/`timeZone`-Metadaten |
| `POST /api/v1/imports/bookitup/promises/:id/exclude-past` | Bewusster Ausschluss mit `{ "version": 1 }`, ausschließlich nach Ablauf |

Die Ausgänge enthalten `eventId` und `excluded`. Fremde oder fehlende IDs ergeben
404, fehlende Sitzungen beziehungsweise Rechte 401/403. Ungültige Eingaben oder
Verknüpfungen ergeben 400; veraltete Versionen, bereits anders abgeschlossene
Prüfungen, fehlende Quellzuordnungen, unvollständige Zusagen, geänderte Zeitzonen
und Buchungskonflikte ergeben 409. Eine nachträglich geänderte Mandantenzeitzone
wird vor der Übernahme ausdrücklich zur Klärung blockiert. Unbekannte Fehler
bleiben im allgemeinen inhaltsfreien 500-Vertrag. Keine Kundennachricht entsteht.

Migration `0018_import_review.sql` ergänzt Quellzusagen um Prüfzeitpunkt,
Prüfer, Request-Hash, Ergebnis und gegebenenfalls Zielauftrag. Zusammengesetzte
Fremdschlüssel binden Prüfer und Ziel an den Mandanten; ein Constraint verhindert
halb gefüllte Nachweise. Das Audit enthält `import.reviewed` ohne Quellinhalte.
Die normalen Verfügbarkeits-/Buchungssperren zählen anschließend nur offene
Prüfungen. Eine erfolgreich übernommene Zusage verweist im Alt-ID-Mapping auf
den operativen Auftrag; ein ausgeschlossener Altstand auf seinen Quellnachweis.
`reviewAction` in der Bestandsübersicht unterscheidet diese Fälle.

Prüfung und Übernahme verwenden denselben Tenant-Lock wie Import und normale
Buchung. Ein Retry mit identischem Inhalt einschließlich ursprünglicher
Quellversion liefert nach einem verlorenen Antwortpaket denselben Ausgang und
legt keinen zweiten Auftrag, keine weitere Reservierung und kein weiteres
Audit-Ereignis an. Ein abweichender Retry wird blockiert. Quell- und Zielversion
bleiben getrennt; normale Bearbeitungen des späteren Auftrags werden dadurch
nicht erneut ausgeführt oder zurückgesetzt.

Die Migration ist additiv und löscht keine Quellzusagen. Nach bereits erfolgtem
Abgleich versteht ein älterer Anwendungsstand die Prüfkennzeichen nicht. Eine
Rückkehr auf eine solche Version erfordert daher eine vorher getestete
Wiederherstellung des dazu passenden Datenstands; ein bloßer Imagewechsel ist
kein zugesicherter fachlicher Rollback. Tests verwenden ausschließlich frische,
wegwerfbare PostgreSQL-Instanzen und getrennte Restore-Umgebungen.
