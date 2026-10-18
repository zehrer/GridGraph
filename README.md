# GridGraph

**GridGraph** is a local, schemaless graph database with a spreadsheet-style table and an interactive graph view.

It runs entirely in the browser, with no server. Databases are saved automatically in the browser (IndexedDB).

Live: https://zehrer.github.io/GridGraph/

## Concept

- **Types = sheets**: every type (e.g. `Person`, `Company`) is a base node in the graph and appears as a sheet tab at the bottom.
- **Rows = instances**: every row is a node connected to its type by a `typeOf` edge.
- **Header row = properties**: typing a name into the header row creates a column. Instances may have extra properties; they show up as columns automatically.
- **Data types** (toolbar → column type): Text, Number, Date, Yes/No and *Link to type*. A link cell creates a graph edge; typing an unknown name creates the target instance.
- Free edges are drawn in the graph view with **Shift + drag**.

## Usage

| | |
|---|---|
| Edit a cell | Start typing, Enter, F2 or double-click |
| Confirm / cancel | Enter, Tab / Esc |
| Select a range | Drag, Shift + click, Shift + arrow keys |
| Copy / cut / paste | ⌘C / ⌘X / ⌘V – works with Numbers, Google Sheets and Excel |
| Undo / redo | ⌘Z / ⇧⌘Z |
| Graph | Drag = move node or view, wheel = zoom, double-click = open in table |

**File menu**: new database, saved databases in this browser, import/export as JSON or GraphML (Gephi, yEd, Cytoscape), sample data.

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
