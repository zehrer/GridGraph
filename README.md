# GridGraph

**GridGraph** is a local, schemaless graph database with a spreadsheet-style table and an interactive graph view.

It runs entirely in the browser, with no server. Databases are saved automatically in the browser (IndexedDB) and never leave your device unless you export them.

Live: https://zehrer.github.io/GridGraph/

## Concept

- **Types = sheets**: every type (e.g. `Person`, `Company`) is a base node in the graph and appears as a sheet tab at the bottom.
- **Rows = instances**: every row is a node connected to its type by a `typeOf` edge. Each row gets a running **ID** (first column, never reused).
- **Name column**: one column per type (marked ◆) names the rows in links and in the graph; any column can take that role.
- **Header row = properties**: typing a name into the header row creates a column. Instances may have extra properties; they show up as columns automatically.
- **Data types** (toolbar → column type): Text, Number, Date, Yes/No and *Link to type*. A link cell creates graph edges and can hold several targets separated by commas; typing an unknown name creates the target instance.
- **Convert column to type** (Data menu): a column of repeated values (e.g. Country after a CSV import) becomes its own lookup sheet, and the column links to it.
- **Versions** like git: edits stay open changes (marked orange) until you **check in** a version with a note (File → Check in, or the "v3 · 5 changes" button); File → History lists the versions and their changes, Edit → Discard goes back to the checked-in state. Only data and columns are versioned.
- Free edges are drawn in the graph view with **Shift + drag**.
- The graph view switches between **Data** (rows and their links) and **Model** (the meta model: types as cards with all their properties, link columns as edges; Shift + drag between types adds a link column).

## Usage

| | |
|---|---|
| Edit a cell | Start typing, Enter, F2 or double-click |
| Follow a link | Double-click a link cell to open the linked row; “← Back” (or ⌘[) returns |
| Confirm / cancel | Enter, Tab / Esc |
| Select a range | Drag, Shift + click, Shift + arrow keys |
| Copy / cut / paste | ⌘C / ⌘X / ⌘V – works with Numbers, Google Sheets and Excel |
| Sheets | Tab menu: rename, color, hide (e.g. lookup tables – View → Hidden sheets brings them back), delete |
| Columns | ▾ on a header: sort, move, wrap, hide, delete; drag a header to move it, drag its border to resize |
| Rows | ＋ Row / − Row in the toolbar or right click; Shift+Space selects whole rows; Data → Renumber IDs closes gaps |
| Summary row | Click below a column to show Sum, Average, Min, Max, Count or Empty; View → Summary row hides it |
| Status bar | Select cells: bottom right shows their Sum; click it for Average, Min, Max, Count |
| Format | Format menu: data type, number format (€, $, %, decimals) and date format (e.g. DD.MM.YYYY) of the selected columns |
| Settings | View → Settings: rows/columns shown at least; number and date notation (e.g. German 1.234,56 · 25.11.2026) |
| Sort / filter | Data → Create a filter (⇧⌘F): filter button per column with conditions and a value list, like Excel; ⌘F searches rows |
| Quick filter | Column menu → Quick filter by year/month (dates) or by value (numbers, links, text): browse with ‹ › in the toolbar, click the value to pick from a list |
| Filter views | Toolbar view selector: save filters, visible columns, their order and sort under a name; also in the HTML export |
| Undo / redo | ⌘Z / ⇧⌘Z |
| Graph | Drag = move node or view, wheel = zoom, double-click = open in table |

**Formulas** (Insert → Formula column…): computed columns, e.g.

```
AGE([Birthday])
[Deadline] - TODAY()
[Name] & " (" & [City] & ")"
IF([Age] >= 40, "senior", "junior")
[Employer].[City]
SUM([Client].[Employees])
```

Columns are referenced by name; `.[Column]` follows a link. Functions: IF, AND, OR, NOT, ROUND, ABS, SUM, AVERAGE, MIN, MAX, COUNT, TODAY, YEAR, MONTH, DAY, DATEDIF, AGE, LEN, UPPER, LOWER, CONCAT, FIND, SEARCH, LEFT, RIGHT, MID, SUBSTITUTE, TRIM, REGEXEXTRACT, REGEXMATCH, IFERROR. Example: `REGEXEXTRACT([Contact]; "\(([^)]+)\)")` takes the email out of "Doe, Jane (jane.doe@example.com)".

**File menu**: new database, saved databases in this browser, import/export as JSON or GraphML (Gephi, yEd, Cytoscape), **import CSV/TSV** as a new sheet or as an **update of an existing sheet** (rows matched by ID or name; views, formats, formulas and links stay; separator and encoding detected automatically), two sample databases (Projects & people, Le Monde’s 100 books), and **Export as HTML** – a single file anyone can view in a browser, with an “Open in GridGraph” button to edit the data again.

See [docs/requirements.md](docs/requirements.md) for requirements and decisions.

## Development

Stack: Vite, React, TypeScript, Zustand, Vitest. Requires a current Node.js LTS.

```bash
npm install
npm run dev
```

```bash
npm test
```

A push to `main` builds the app with GitHub Actions and publishes `dist/` to the `gh-pages` branch.
