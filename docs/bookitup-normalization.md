# Privater Importentwurf aus gesicherten Bookitup-Ansichten

E003.4 bereitet ausschließlich einen ungeprüften Offline-Entwurf vor. Es werden
weder Datensätze an die App übertragen noch echte Buchungen bestätigt. E003,
E002 und die fachliche Umschaltfreigabe werden dadurch nicht als vollständig
abgenommen gewertet. Originaldateien, Entwurf, Prüfliste und Quellbezüge bleiben
außerhalb von Git in einem privaten Betreiberverzeichnis (Ordner 700, Dateien 600).

## Quellen und Ableitung

Der Entwurf verwendet den vorhandenen Kontakt-CSV und die gesicherten
Formularwerte/Seitentexte zukünftiger Eventansichten. CSV wird mit einem echten
CSV-Parser einschließlich zitierter mehrzeiliger Felder gelesen; abweichende
Spaltenzahlen werden nicht still repariert. Die Originalquellen werden vor und
nach der Vorbereitung per SHA-256 geprüft. Gleiche Quellen ergeben denselben
Manifestinhalt; die Wiederholungsprobe schreibt nur in ein separates temporäres
Verzeichnis.

Ein nicht ausdrücklich ausgefüllter Eventname darf nur durch die tatsächlich
angezeigte Quellüberschrift ersetzt werden, wenn die dazugehörige Quell-Datumszeile
übereinstimmt. Aus vorhandenen Namen, Daten oder Paketbezeichnungen wird kein
neuer Termin oder Titel erfunden. Datum ohne Uhrzeit bleibt Datum ohne Uhrzeit.
Originalstatus bleibt einer der erlaubten Quellstatus; „Gebucht“ bedeutet weiterhin
[ungeprüfte Bestandszusage](minimal-import.md#zusagen-und-ressourcen).

Ein Kontaktbezug wird ausschließlich bei eindeutigem E-Mail-Treffer als
**zu prüfender Vorschlag** vorbereitet. Das ist kein Namensabgleich, keine
Dublettenfreigabe und keine Bestätigung sämtlicher Ansprechpartner. Aus
verschiedenen Kontakten oder gleichnamigen Locations wird nicht automatisch eine
Entität. Nicht abgebildete Partner-, Gruppen-, Referenz- oder sonstige CSV-Felder
bleiben in den Originalen erhalten und werden im privaten Lückenbericht gezählt.
Eine alternative Telefonnummer wird ohne bestätigte Bedeutung nicht als
Mobilnummer umetikettiert.

## Quellanker und spätere Änderungen

Vendor-Eventkennungen bleiben erhalten. Der Kontakt-CSV enthält keine belastbare
Vendor-Kontaktkennung. Seine ersten Entwurfsanker bestehen deshalb aus
`csv:<SHA-256 des ersten Quellbestands>:row:<Zeile>`. Diese Kennungen bezeichnen
Snapshot-Zeilen, keine nachgewiesenen dauerhaften Bookitup-Kontaktidentitäten.
Sie sind vor einer ersten Übernahme ausdrücklich zu prüfen und zu erhalten.

Ein neuer CSV darf nicht blind neue Kontaktkennungen erzeugen oder Zeilen nach
Namen zusammenführen. Für einen späteren Delta-Lauf muss eine geprüfte private
Zuordnung die bereits freigegebenen Quellanker wiederverwenden. Das Umbenennen
oder Neuzuordnen bestehender Ziel-Mappings ist kein Ersatz: Der Import schützt
bestehende Zuordnungen vor einem solchen Umbinden. Ohne belastbaren Abgleich den
Delta-Lauf stoppen.

Location-Vorschläge sind mangels gesicherter Vendor-Locationkennung zunächst an
das jeweilige Quell-Event gebunden. Nur tatsächlich referenzierte Eventarten und
Paketwerte werden im Entwurf gesammelt; das ist keine vollständige Übernahme des
übrigen Stammdatenkatalogs.

## Dateien und Freigabegrenze

- `IMPORTENTWURF_UNGEPRUEFT.json`: versioniertes Manifest mit unveränderten Quellwerten beziehungsweise dokumentierten Vorschlägen.
- `PRUEFBERICHT_PRIVAT.json`: Mengen, Quellprüfsummen, Lücken, nicht abgebildete Felder und ausdrücklich fehlende Importfreigabe.
- `QUELLBEZUEGE_PRIVAT.json`: Rückverweise auf Originaldatei, Quellzeile und Ableitung.
- `ZUKUNFT_PRUEFLISTE_PRIVAT.csv`: private Arbeitsliste für Termin, Kontakt, Location, Paket und Ressourcenfreigabe; Tabellenformeln werden als Text geschützt.
- `SCHEMAPRUEFUNG_PRIVAT.json`: Ergebnis der bestehenden reinen `previewImport`-Funktion ohne Datenbank oder HTTP-Aufruf.

Leere Namen, unbekanntes Location-Land, fehlende Adresszuordnung oder unbestätigte
Paket-/Kontaktbezüge werden nicht geraten. Fehlerhafte Felder bleiben als solche
sichtbar; ein schematisch ungültiger Entwurf darf nicht übernommen werden.
Auch ein später schemafehlerfreier Stand benötigt weiterhin Quellen-/Mengenabgleich,
Dublettenentscheidungen, korrekte Uhrzeiten und die ausdrückliche Prüfung jeder
zugesagten Ressource. Dieser Entwurf verändert weder Inhaberpasswort noch echte
Aufträge, Nummernkreise, Zahlungen oder Kundenkommunikation.

## Private Feldkorrekturliste (E003.6)

Aus den bekannten `invalid_fields`-Hinweisen entsteht zusätzlich
`FELDKORREKTUREN_PRIVAT.csv`. Sie enthält Abschnitt, ursprüngliche Manifestzeile,
unveränderten Quellanker, Feld, Anzeigename und Ausgangswert. Die beiden letzten
Spalten für geprüften neuen Wert und Entscheidung mit Quellenbeleg bleiben leer.
Referenzfehler ohne eigenes ungültiges Feld werden nicht als weitere
Feldkorrekturen dupliziert. Die Zukunfts-/Ressourcenprüfung bleibt separat nötig.

Die Liste ist ausschließlich eine private Arbeitsunterlage. UTF-8 mit BOM,
Semikolon-Trennung und korrekte CSV-Zitierung erhalten mehrzeilige Werte.
Formelanfänge einschließlich führender Leerzeichen sowie Steuerzeichen am
Zellanfang werden als Text geschützt; ein solches Schutzapostroph ist kein
zusätzlicher Quellwert. Dateien bleiben mit Modus 600 außerhalb von Git.

Der Erzeuger wurde mit fiktiven Formel-/Mehrzeilenwerten, unveränderten Eingaben,
leeren Entscheidungsfeldern und unzulässigen Zeilen geprüft. Für den echten
Entwurf wurden eindeutige Quellanker/Felder, CSV-Rundlauf und reproduzierbare
Ausgabe geprüft; die Eingabeprüfsummen blieben gleich. Es gibt keinen automatischen
Rückimport des Blattes. Fachlich geprüfte Änderungen gehören in einen separaten
neuen Manifestentwurf mit denselben freigegebenen Quellankern, der erneut
vorgeschaut werden muss. Das Blatt erteilt keine Import- oder Buchungsfreigabe.
