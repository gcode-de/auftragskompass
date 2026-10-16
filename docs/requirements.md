# Zuordnung der Anforderungen

Alle IDs des [Lastenhefts](../Lastenheft_Fotobox-Verwaltung_MVP.md) sind hier einem oder mehreren Schritten des [Plans](../IMPLEMENTATION_PLAN.md) zugeordnet. MUSS/SOLL/KANN und explizite Nicht-Ziele behalten ihre Priorität aus dem Lastenheft. Zuordnung bedeutet geplant, nicht implementiert. Zusammengehörige Anforderungen werden als Gruppe den genannten Schritten zugeordnet; vor jedem Slice sind die einzelnen Kriterien in konkrete Tests zu übersetzen.

Zusätzliche Regeln und offene Freigaben: [Planprüfung](decisions.md). `python3 -B scripts/check_docs.py` erkennt fehlende, doppelte und unbekannte IDs sowie ungültige Slice-Verweise.

| Anforderungen | Schritte | Abnahmeumfang |
|---|---|---|
| SYS-01, SYS-02, SYS-03, SYS-04, SYS-05, SYS-06, SYS-07, SYS-08 | C002, C005, C007, C009, C010, C012, C019, C078, C081, C082, C083 | Navigation, Konfiguration, Zugang und Betrieb |
| EV-01, EV-02, EV-03, EV-04, EV-05, EV-06, EV-07, EV-08 | C018, C019, C023, C025 | Listen, Filter und Kalender; gespeicherte persönliche Filter als SOLL in C019 |
| EA-01, EA-02, EA-03, EA-04, EA-05, EA-06, EA-07, EA-08, EA-09, EA-10, EA-11, EA-12 | C018, C020, C023, C044 | Eventakte; Duplizieren als SOLL in C018; endgültiges Löschen nur mit Bestätigung und Aufbewahrungsprüfung |
| LB-01, LB-02, LB-03, LB-04 | C011, C020, C039, C040, C049, C060 | Unveränderbarer fachlicher Verlauf und Verweise |
| KO-01, KO-02, KO-03, KO-04, KO-05, KO-06, KO-07 | C016, C041, C042 | Kontaktpflege, Kommunikations- und Eventbezüge |
| SA-01, SA-02, SA-03, SA-04, SA-05 | C012, C075 | Konfigurierbare Stammdaten und Übernahme |
| AN-01, AN-02, AN-03, AN-04, AN-05, AN-06, AN-07, AN-08, AN-09 | C034, C035, C036, C039 | Formularquellen, Mapping und genau einmal übernommene Anfragen; Empfangsmail als SOLL nach SMTP |
| EM-01, EM-02, EM-03, EM-04, EM-05, EM-06, EM-07, EM-08, EM-09, EM-10, EM-11, EM-12 | C038, C039, C040, C041, C042, C044, C045, C084 | Postfach, Anhänge und Umschaltgrenze |
| ET-01, ET-02, ET-03, ET-04, ET-05, ET-06 | C043, C044, C075 | Vorlagen einschließlich Migration |
| PR-01, PR-02, PR-03, PR-04, PR-05, PR-06, PR-07 | C015, C047, C051, C075 | Produkte, Duplizieren, individuelle Preise; Positionsbündel als SOLL in C047 |
| RE-01, RE-02, RE-03, RE-04, RE-05, RE-06, RE-07, RE-08, RE-09, RE-10, RE-11, RE-12, RE-13, RE-14, RE-15, RE-16, RE-17, RE-18, RE-19, RE-20 | C014, C021, C022, C023, C024, C025 | Einheiten, Zeitregeln und Konfliktschutz; Sets/Cases bleiben außerhalb des MVP |
| DV-01, DV-02, DV-03, DV-04, DV-05, DV-06, DV-07, DV-08 | C047, C048, C049, C051, C075 | Dokumentvorlagen, Vorschau und Gestaltung |
| AG-01, AG-02, AG-03, AG-04, AG-05, AG-06, AG-07, AG-08, AG-09 | C049, C050, C051, C052, C053, C054 | Angebot, Annahme und Weiterverarbeitung ohne Neuerfassung |
| RG-01, RG-02, RG-03, RG-04, RG-05, RG-06, RG-07, RG-08, RG-09, RG-10, RG-11, RG-12 | C049, C050, C054, C055 | Rechnungen, Zahlungen und unveränderbare Korrekturen |
| NK-01, NK-02, NK-03, NK-04, NK-05, NK-06 | C050, C077 | Nummernkreise, Vorschau und Übernahme |
| DA-01, DA-02, DA-03, DA-04, DA-05, DA-06, DA-07 | C038, C043, C044, C075 | Dateibibliothek, historische Fassungen und Migration |
| ER-01, ER-02, ER-03, ER-04, ER-05 | C045 | Interne Erinnerungen mit Status; kein Workflow-Builder |
| KA-01, KA-02, KA-03, KA-04, KA-05, KA-06, KA-07, KA-08 | C026 | Geschützter abonnierbarer Feed und widerrufbare Tokens |
| VT-01, VT-02, VT-03, VT-04, VT-05, VT-06, VT-07, VT-08, VT-09, VT-10, VT-11, VT-12, VT-13, VT-14, VT-15, VT-16, VT-17, VT-18 | C057, C058, C059, C060, C061, C062, C066 | Optionaler Vertrag, Signatur und sichere lokale Finalisierung |
| FB-01, FB-02, FB-03, FB-04, FB-05, FB-06, FB-07, FB-08, FB-09, FB-10, FB-11 | C063, C064, C065, C066 | Fragebogen, Uploads und kontrollierte Übernahme; relative Erinnerung als SOLL in C064 |
| WK-01, WK-02, WK-03, WK-04, WK-05, WK-06, WK-07, WK-08, WK-09, WK-10, WK-11, WK-12, WK-13, WK-14, WK-15, WK-16, WK-17, WK-18 | C028, C029, C030, C031, C032, C033, C034, C035, C036, C037 | Öffentliche Projektion, Konfiguration und gesicherte Übernahme |
| TD-01, TD-02, TD-03, TD-04, TD-05, TD-06, TD-07, TD-08, TD-09, TD-10, TD-11, TD-12, TD-13 | C067, C068, C069, C070 | Aufgaben und relative Vorlagen ohne Mitarbeiterverwaltung |
| AB-01, AB-02, AB-03, AB-04, AB-05, AB-06, AB-07, AB-08, AB-09 | C013, C071, C072 | Absagegründe und Auswertung |
| MIG-01, MIG-02, MIG-03, MIG-04, MIG-05, MIG-06, MIG-07, MIG-08, MIG-09, MIG-10, MIG-11, MIG-12, MIG-13, MIG-14 | C074, C075, C076, C077, C084 | Vollausbau-Zuordnung; für früheren Start gilt docs/bookitup-exit.md: benötigte historische Originale/E-Mails unabhängig sichern, operative Mindestübernahme und Ressourcenabgleich vorziehen; kein vollständiger Altmailimport in die Anwendung |
| NF-01, NF-02, NF-03, NF-04, NF-05, NF-06, NF-07, NF-08, NF-09, NF-10, NF-11, NF-12, NF-13, NF-14, NF-15, NF-16, NF-17, NF-18, NF-19, NF-20 | C002, C005, C007, C008, C009, C011, C016, C022, C026, C028, C030, C038, C039, C060, C074, C075, C078, C079, C080, C081, C082, C083, C085 | Querschnittsanforderungen ab dem betroffenen Feature, vollständige Nachprüfung vor M7 |
