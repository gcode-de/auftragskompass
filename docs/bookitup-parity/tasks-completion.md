# Weitere Parität, gezielte Nachbeobachtung und Gesamtprüfung

Alle Pakete **offen**. Diese Bereiche gehören zum neuen umfassenden Ziel, waren im früheren verkürzten MVP aber bewusst verschoben. Kein Folgeagent darf sie allein wegen dieser Liste als bereits freigegebenen Produktivprozess darstellen. [Agentenregeln](agent-playbook.md) gelten. Große Pakete vor Implementierung im Hauptplan in benannte vertikale Slices zerlegen. Bei unbekannter Referenzbedienung zuerst lesend beobachten, danach Vertrag konkretisieren.

## BKP026 — Aufgaben und relative Vorlagen im Eventkontext

**Featurepaket; vorhandene C067–C070 nutzen.** Belege B04/B12/B29 und Lastenheft TD-Anforderungen anhand tatsächlicher IDs nachschlagen. `EventDetails.tsx`, Audit-/Worker-/Datumshilfen und zukünftige Taskdienste lesen. Bookitup zeigt globale Datums-/Gruppenfilter, „fertige Aufgaben“, Eventaufgaben und Vorlagenanwendung; Details des relativen Vorlageneditors wurden hier noch nicht geöffnet.

**Unterfolge:** (a) einzelne allgemeine und eventbezogene Aufgabe mit Titel/Notiz/Fälligkeit/Status offen-erledigt-verworfen; (b) globale Liste mit Datum/Gruppen/Status und Eventbezug plus kompakter Aufgabenbereich im Event; (c) relative Vorlagen mit ausdrücklichem Anker Anfrage/Buchung/Event und Vor-/Nachlauf; (d) kontrollierte Terminänderungsvorschau und Benachrichtigung. Nicht eine universelle Workflowengine bauen.

**Ablauf:** aus Event Aufgabe erstellen, Fälligkeit setzen, erledigen, in globaler Übersicht wiederfinden. Vorlage bewusst anwenden, Duplikate bei erneuter Anwendung vermeiden; neue Eventzeit zeigt Vorschau betroffener noch offener Aufgaben. Erledigte Tasks behalten ihren Abschluss und historischen Termin. Keine automatische Kundenmail aus einem internen Task ableiten.

**Tests pro Slice:** Tenant/Versionskonflikt, Aufgabe ohne Event, archivierter Bezug, überfällig vs heute tenant-lokal, DST/Schaltjahr, doppelte Vorlagenanwendung/Neustart, erledigte unverändert, relative Neuberechnung nur nach Bestätigung, Date-only/undatiertes Event mit ehrlichem fehlendem Anker, Benachrichtigung nicht doppelt. Global und Eventansicht zeigen denselben Datensatz. **Done:** kompletter einfacher Arbeitsablauf, kein eigener Drag-Kanban als Pflicht.

## BKP027 — Verträge und Fragebögen; Freigaben gesondert nachbeobachten

**Großes Paket; C057–C066 beibehalten, nach Dokument-/Dateikern.** Referenznavigation/Karten B04/B05/B14, genaue Vorlagen-/Kundenseiten hier noch nicht umfassend geprüft. Vor Umsetzung eine reine Test-/Voransicht lesen, ohne echte Freigabe/Signatur zu erzeugen. Lastenheft Vertrag/Fragebogen und Gatewaygrenzen lesen.

**Unterfolge:** (a) versionierte Vertragsvorlagen mit erlaubten Feldern/Einwilligungen und Vorschau; (b) individuelle sichere Kundeninstanz mit Ablauf/Widerruf, kontrolliertem Prefill/Autosave; (c) mobile Signatur/Bestätigung und unveränderbarer Nachweis; (d) lokale konfliktgesicherte Bestätigung der konkreten Ressource, fehlertolerante PDF-Bereitstellung; (e) Fragebogenvorlagen, mehrere Feldtypen/Sortierung/Uploadregeln, individueller Link, mobile Abgabe und kontrollierte Übernahme in Eventfelder. Allgemeiner Freigabestatus nicht mit unterschriebenem Vertrag gleichsetzen. Eine eigenständige Freigabefunktion braucht zuerst Referenzaufnahme und einen separat definierten Modell-/UI-Slice; die hier genannten Vertrags-/Fragebogenschritte liefern sie nicht automatisch.

**Tests pro Slice:** Tokenhash/Ablauf/Widerruf/Rate, fremder Tenant, unerlaubte Felder/XSS, zwei parallele Abschlüsse/Replay, letzte verfügbare Box zweimal angefragt, Core offline bei Signatur, Rückmeldung ausstehend statt vorschnell gebucht, PDFfehler nach erfolgreichem Abschluss mit Wiederaufnahme, unveränderte Vorlagenversion/Nachweisbytes, Uploadquarantäne, Konflikt Kunde vs intern geänderte Antwort. Gateways dürfen keine reale Ressourcenzusage eigenständig bestätigen.

**UX:** Vertrag/Fragebogen getrennte Karten in Dateien; eine klare aktuelle Fassung und Status, Zusatzaktionen gefaltet. Keine endlose Formularwand im Event. **Done je Unter-Slice:** sicherer echter End-to-End-Prozess mit synthetischen Daten. Rechtliche Texte/Einwilligungen und Produktivfreigabe gesondert abnehmen; keine echten Unterschriften zum Test.

## BKP028 — Websiteformulare bearbeiten und mehrere Formulare verwalten

**Featurepaket nach BKP002–BKP004, vorhandenes Widget/Gateway weiterverwenden.** Benutzer verlangt derzeit alle Felder des bisherigen Formulars; spätere Änderbarkeit und mehrere Formulare ausdrücklich gewünscht. Die bisher erfasste achtfeldrige Definition ist Ausgangspunkt. Lesen `apps/widget`, `WebsiteInquiry.tsx`, `InquiryPreview.tsx`, Formularschemata/Gatewayversionierung über `rg`, `website-inquiry*`-/Widgettests. Keine Feldliste aus dem Gedächtnis neu tippen; tatsächliches Schema und Referenzformular vergleichen.

**Unterfolge:** (a) bestehende Definition sichtbar/read-only korrekt anzeigen; (b) kontrolliert Name, Hilfetext, Reihenfolge, erforderliche/optionale Felder und Datenschutztext bearbeiten; (c) mehrere aktivier-/archivierbare Definitionen mit stabilen Quellen-IDs, eigener Vorschau und Embed-/Direktlink; (d) sichere unterstützte Feldtypen/Mappings ergänzen. Bestehende Formversionen erhalten; bereits angenommene Eingänge nach ihrer ursprünglichen Definition auswerten, nicht rückwirkend nach neuem Pflichtfeld verwerfen.

**Sonderregel:** optionaler Kontakt-/Länderwert hindert keine Optionanlage. DE-Default gilt nur für fehlendes Land eines neuen Website-Kontakts, bekannte Angaben erhalten. Eine gewünschte Feldpflicht im öffentlichen Formular ist von der Robustheit der lokalen Übernahme getrennt. Keine freie JavaScript-/HTML-Ausführung durch Formularbuilder. Pflicht-Datenschutz/Spam-/Origin-/Größen-/Schema-/Signaturgrenzen bleiben serverseitig.

**Tests pro Slice:** alle bisherigen Felder unverändert über Roundtrip, fehlendes/optional gemachtes Feld, alte vs neue Definition, archivierte Quelle, gleichzeitiges Editieren, unmögliches Mapping, mehrere Formularquellen mit gleichen Feldnamen, XSS/Consent/Spam, Widget bei 320/390 und Tastatur, unabhängige idempotente Originaleingänge. Origin-/WordPress-Anschluss und realer Websitewechsel separat, keine unbestätigte Live-Ersetzung. **Done:** Bediener kann unterstützte Inhalte selbst anpassen und getrennte Quellen betreiben, ohne den sicheren Eingang zu umgehen.

## BKP029 — Auswertungen und weitere Kontextfunktionen gezielt vervollständigen

**Feature-/Beobachtungspaket, hinter Kernflows.** Bookitup-Navigation zeigt Statistiken, Event „Verdienst“/Vermittlungen und Einstellungen zu Feldern/Status/Arten. Diese Detailansichten wurden nicht vollständig vermessen. Das Vollinventar ist Suchhilfe, keine aktuelle Laufzeitbestätigung. Vor Implementierung je Unterfunktion lesende Referenzaufnahme und fachliche Definition ergänzen.

**Unterfolge:** zuerst bereits geplante Absageauswertung (C071–C072) mit explizitem Absagegrund oder bewusst unbekannt, Zeitraum/Art/Quelle/Paket, nachvollziehbarer Basis; danach Umsatz/offene Beträge nur aus wirklich vorhandenen finalen Dokument-/Zahlungsdaten (BKP019), nicht aus Optionswerten; Kontaktgruppen/Partner/Vermittlungsbeziehungen und mehrere Termine/Orte als einzelne Modellslices. Ein freies Feldsystem erst mit Typen/Schema-/Versions-/Archivregeln, keine willkürlichen JSON-Felder ohne Anzeige-/Validierungsvertrag. Produkt-Ressourcenbedarf/Sets/Cases nach zugänglicher Referenzprüfung und bestehender Reservierungslogik modellieren.

**Tests pro Slice:** exakte Zähler/Nenner und Nullfälle, tenant-lokale Monatsgrenzen, Teilzahlungen/Korrekturen ohne doppelte Einnahmen, gleiche Filterbasis zwischen Anzeige/CSV, Archivbezug, CSV-Formelinjektion; mehrere Termine bleiben ein Event, Reservierungszeit bleibt unabhängig, unvollständige Quelle wird nicht als sicherer Finanzwert dargestellt. **Done:** nachvollziehbare kleine Auswertung statt dekorativer KPI-Kacheln; unbekannte Referenzfunktion nicht als implementierte Parität abhaken.

## BKP030 — Referenzlücken schließen und vollständige Parität abnehmen

**Beobachtung kann vor allen abhängigen Features erfolgen; Gesamtabschluss zuletzt.** Kein „vollständig geklont“, solange diese Liste offen ist. Aktueller Vergleich ist umfangreich, aber keine vollständige Ausführung aller Schreib-/Vertrags-/Versandpfade des fremden Systems.

### Noch gezielt lesend aufzunehmen

1. Bookitup bei tatsächlich gemessenen 320/390/768: Kalender Monat/Woche/Tag, Eventauswahl, Filterdrawer mit Abbruch/Anwenden, untere Navigation und Bildschirmtastatur. Aktuelle Auditdateien B03/B21/B22 sind Desktopbilder trotz Dateiname.
2. Ressourcenanlage/-details/-zuordnung und Set/Case/Item nur mit bereits verfügbarem Zugang. Trial nicht aktivieren. Wenn gesperrt, genauen Umfang als unbekannt notieren; bestehendes AK-Ressourcenmodell nicht schwächen.
3. Status-/Artfilter: Einfach-/Mehrfachwahl, gegenseitige Abhängigkeiten, Reset, zeitlicher Bereich, Zählbasis. Erst dann neue API-Semantik festlegen.
4. Kontakt-Anlegedialog (bislang vorhandenen Editordialog gelesen), Firmen-/Partnerbeziehungen, Gruppen und Inline-Anlage in Event; keine echten Einträge speichern.
5. Neues Dokument ohne Vorlagenwahl, Entwurfeditor und Konvertieren/Annahme/Zahlung: nur wenn reine Voransicht sicher möglich. „Übernehmen“ könnte persistieren – nicht zum Beweis anklicken. Stattdessen fiktive isolierte Testumgebung autorisieren lassen, falls nötig. Keine fertige Rechnung wieder öffnen.
6. Globale Mail-Blanko-/Vorlagenanlage, Reply/Forward/Planung/Signatur/Anhänge, ohne echte Mail zu öffnen oder zu senden, wenn dadurch Status verändert wird. Bereits gesehener eventbezogener leerer Composer beweist nicht den gesamten globalen Flow.
7. Layout/Nummernkreise, Dateienbibliothek, Aufgaben-/Workflowvorlagen, Vertrags-/Fragebogeneditor, Freigaben, Statistiken und Verdienst mit jeweils sichtbaren Zuständen. Zugangsdaten-/Finanzwerte nicht im Bericht wiedergeben.

### REA sauber fortsetzen

Installiertes `reverse-engineer-anything/SKILL.md` lesen. Die frühere Diagnose ist ein datierter Befund, kein aktueller Verbindungsbeweis. Sind REA-MCP-Tools jetzt verfügbar, echte Schemas nutzen. Browser-Route benötigt einen **ausdrücklich bekannten lokalen** CDP-Endpunkt; keine Portscan-/URL-Raterei, keine neue Debugfreigabe des Nutzerprofils. Alternativ native Beobachtung nur mit sicher ausgewählter exakter PID/Fensterkennung. Fehlende Registrierung: gemäß Skill erst read-only Setupplan, vor Konfigurationsschreiben konkrete Freigabe. Bis dahin CUA-/Source-Belege verwenden und als solche kennzeichnen. Keine erfundenen REA Evidence-IDs.

### Abnahmeprotokoll pro Workflow

Tabelle mit Startort, sichtbarem Ausgangszustand, Aktion, unmittelbarer UI-Rückmeldung, Servermutation/keine Mutation, Fehlerfall, Abbruch-/Zurückverhalten, Tastatur-/Mobilezugang, AK-Entsprechung, Lücke, Testname, SHA. Kennzeichnungen gesehen/quellbewiesen/vorgeschlagen/unbekannt beibehalten. Private Rohbelege mit Datum, echten Pixelmaßen und Prüfsumme; nur anonymisierte Texte und **fiktiv nachgebaute** Referenzbilder ins öffentliche Repo. Rohbilder nicht lediglich mit einem Namen übermalen – weitere PII kann enthalten sein.

### Ende-zu-Ende-Abnahme in eigener synthetischer Installation

- Websiteeingang mit/ohne Kontakt/Land → genau eine Option → Kontakt bewusst ergänzen → Ressource prüfen/vormerken → erst bewusste Bestätigung fest buchen; Konflikt darf nichts halb speichern.
- Event manuell mit Datum/ohne Datum → suchen/filtern → mobile Liste/Kalender → Details/Ressourcen/Dateien/Mails → Zurück mit erhaltenem Zustand.
- Ressource/Produkt/Kontakt anlegen, suchen, bearbeiten, duplizieren wo vorgesehen, archivieren; Historie und Verknüpfungen bleiben; 409 verständlich.
- Angebot mit und ohne Vorlage → editieren/vorschauen/finalisieren → Annahme → Folgedokument → Zahlungen/Korrektur, exakte Beträge und unveränderbare PDFs.
- Mail blanko/aus Vorlage → eigenen Text/Empfänger/Anhang prüfen → Entwurf → synthetischer Versand/Planung/Fehler/Wiederholung → Zuordnung und immutable gesendete Fassung.
- Upload prüfen/ablehnen/downloaden/ersetzen, alte Anhänge erhalten; Vertrag/Fragebogen/Task nur nach ihrer Implementierung vollständig prüfen.
- 320/390/768/1280/1440, Hell/Dunkel, Zoom, Tastatur/Fokus, reduzierte Bewegung, Auth-/Tenant-/Netzwerkfehler, Restart, Restore, keine Kundendaten in Logs/Artefakten.

**Done:** Jede anwendbare Referenzfunktion hat einen belegten AK-Flow oder eine offen benannte Restlücke mit Entscheidung. Kein pauschaler Vollständigkeitsprozentsatz ohne klaren Nenner. Der Produktivwechsel bleibt ein eigener fachlich und betrieblich abzunehmender Schritt.
