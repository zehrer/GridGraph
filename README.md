# GridGraph

**GridGraph** ist eine lokale, schemalose Graph-Datenbank mit einer Tabellen-Oberfläche im Stil einer Tabellenkalkulation und einer interaktiven Graph-Ansicht.

Die App läuft komplett im Browser – ohne Server. Daten werden automatisch in IndexedDB gespeichert.

Live: https://zehrer.github.io/GridGraph/

## Konzept

- **Typen = Blätter**: Jeder Typ (z. B. `Person`, `Unternehmen`) ist ein Basis-Knoten im Graph und erscheint unten als Blatt-Tab.
- **Zeilen = Instanzen**: Jede Zeile ist ein Knoten, der per `typeOf`-Kante mit seinem Typ verbunden ist.
- **Zeile 1 = Eigenschaften**: Ein Name in der Kopfzeile legt eine Spalte (Property) an. Instanzen dürfen zusätzliche Properties haben; sie erscheinen automatisch als Spalte.
- **Datentypen** (Toolbar → Spaltentyp): Text, Zahl, Datum, Ja/Nein und *Verknüpfung zu Typ*. Eine Verknüpfungs-Zelle erzeugt eine Graph-Kante; ein unbekannter Name legt die Ziel-Instanz automatisch an.
- `typeOf`- und Verknüpfungs-Kanten werden aus den Daten abgeleitet. Freie Kanten zieht man in der Graph-Ansicht mit **Shift + Ziehen**.

## Bedienung

| | |
|---|---|
| Zelle bearbeiten | Lostippen, Enter, F2 oder Doppelklick |
| Bestätigen / Abbrechen | Enter, Tab / Esc |
| Navigieren | Pfeiltasten, Tab, Enter |
| Rückgängig / Wiederholen | ⌘Z / ⇧⌘Z |
| Graph | Ziehen = Knoten/Ansicht verschieben, Mausrad = Zoom, Doppelklick = in Tabelle öffnen |

**Datei-Menü**: Import/Export als JSON oder GraphML (Gephi, yEd, Cytoscape), Beispieldaten laden. Der Import liest auch das JSON-Format der ersten Version.

## Entwicklung

Stack: Vite, React, TypeScript, Zustand, Vitest. Benötigt eine aktuelle Node.js-LTS-Version.

```bash
npm install
npm run dev
```

```bash
npm test
```

Ein Push auf `main` baut die App per GitHub Actions und veröffentlicht `dist/` auf dem Branch `gh-pages`.
