# GridGraph – Requirements

Living document. It records what GridGraph should do, which product decisions were made and why, and what is still open. Update it together with the code.

Status values: **Done** (implemented and tested), **Partial**, **Planned**, **Idea** (not yet agreed).

## 1. Vision

GridGraph is a local, schemaless graph database that feels like a spreadsheet. People enter and edit data in a familiar grid (like Google Sheets or Numbers) and look at the same data as a graph of typed nodes and relations.

## 2. Principles

| ID | Principle |
|---|---|
| P-1 | **Local first.** Runs entirely in the browser with no server or account. Data stays in the browser unless the user exports it. |
| P-2 | **Spreadsheet first.** The table is the main interface. It should behave like a spreadsheet (keyboard, selection, copy/paste) so it needs no explanation. |
| P-3 | **Schemaless.** Columns are a hint, not a constraint. Instances may have properties no column declares. |
| P-4 | **Simple UI.** Keep the HMI minimal and close to well-known apps (Google Sheets, Numbers). |
| P-5 | **English UI.** All UI text is in English; number and date notation follows the browser locale. |
| P-6 | **Small code base.** Prefer deriving data over storing it twice; keep dependencies few. |

## 3. Data model

| ID | Requirement | Status |
|---|---|---|
| DM-1 | A **database** holds nodes and edges and has a name. | Done |
| DM-2 | A **type** is a node (`isType`) that owns an ordered list of columns (key, label, data type). | Done |
| DM-3 | An **instance** is a node whose `typeId` points to its type. The `typeOf` edge is derived from `typeId`, not stored. | Done |
| DM-4 | Instances hold properties as key → value (text, number, ISO date, boolean, node id). | Done |
| DM-5 | Column data types: Text, Number, Date, Yes/No, **Link to type** (relation). | Done |
| DM-6 | A relation property stores the id of the target node; the edge (labelled with the column name) is derived from it. | Done |
| DM-7 | **Free edges** (any node → any node, with a relation name) are stored separately. | Done |
| DM-8 | Properties that no column declares appear as extra columns, with a data type inferred from the value. | Done |
| DM-9 | Deleting a type deletes its instances; references to deleted nodes are removed; relation columns pointing to a deleted type become text. | Done |
| DM-10 | Every node has an internal, immutable unique id; links refer to it, so renaming never breaks a link. | Done |
| DM-11 | Every instance gets a visible **ID**: a running number per type, assigned on creation and never reused after a delete. | Done |
| DM-12 | Each type has one **name column** (any column except links). Its values name the instances in links, the graph and the inspector. | Done |

## 4. Table view (sheet)

| ID | Requirement | Status |
|---|---|---|
| SH-1 | One **sheet tab per type** at the bottom: add (+), list all (≡), rename (double-click), color, delete. | Done |
| SH-2 | The **header row** (sticky) shows the property names; there are no A/B/C column letters. Typing a name into an empty header cell creates a column. | Done |
| SH-3 | The first column is the read-only **ID**, fixed on the left; it doubles as the row header (there are no separate row numbers). Clicking an ID selects the row. Rows are sorted by ID unless the user sorts by a column. | Done |
| SH-3a | The **name column** is marked (◆, blue header) but can sit anywhere; any column can be made the name column from the column menu. It cannot be deleted. | Done |
| SH-3b | **Renumber IDs** (Edit menu, or right click on the ID header) gives the rows 1…n again, closing gaps left by deletes, after a confirmation. | Done |
| SH-3c | **Settings** (View → Settings…): minimum number of rows and columns shown (default 20 and 5); the sheet always shows the data plus one empty row and column. Stored per browser. | Done |
| SH-4 | Typing into an empty row creates an instance; typing into an empty column creates a property. | Done |
| SH-5 | Editing: start typing, Enter, F2 or double-click; Enter/Tab confirm and move; Esc cancels; Delete/Backspace clears. | Done |
| SH-6 | Arrow keys, Tab and Enter move the active cell. | Done |
| SH-7 | **Range selection** with mouse drag, Shift+click and Shift+arrows. | Done |
| SH-8 | **Formula bar** shows the active cell (column name + row) and its raw value, and can edit it. | Done |
| SH-9 | Relation cells: typing a name links to the matching instance of the target type or creates it; suggestions are offered while typing. | Done |
| SH-10 | Yes/No cells show a checkbox that toggles on click. | Done |
| SH-11 | Toolbar: undo, redo, column data type, sort ascending/descending by the active column, search filter, Table/Graph switch. | Done |
| SH-12 | Changing a column's data type converts existing values (relations by name). | Done |
| SH-13 | **Resize** columns by dragging the header border; widths are saved per column. | Done |
| SH-14 | **Reorder** columns by dragging the header, or Move left/right in the column menu. | Done |
| SH-15 | **Column menu** (▾ on the header, or right click): sort, move, wrap text, use as name column, hide, delete. | Done |
| SH-16 | **Hide / show** columns: hidden columns leave a ⋮ marker in the header to show them again; View → Show hidden columns shows all. | Done |
| SH-17 | **Wrap text** per column; wrapped rows grow in height. | Done |
| SH-18 | **Add row** (toolbar, Insert menu, context menu) appends an instance and selects its name cell; **Delete row(s)** removes the selected rows. Clicking an ID selects the row. | Done |
| SH-19 | **Footer row** (sticky): row count under the ID; per column a choice of None, Sum, Average, Min, Max, Count, Empty (Min/Max also for dates). | Done |
| SH-20 | Context menu (right click) on cells and row numbers: add/delete rows, cut, copy, paste. | Done |
| SH-21 | Reorder rows by drag and drop (manual order instead of ID order). | Idea |

## 5. Copy and paste

| ID | Requirement | Status |
|---|---|---|
| CP-1 | ⌘C / ⌘X / ⌘V (Ctrl on Windows) and Edit menu entries. | Done |
| CP-2 | Clipboard formats: tab-separated text (quoted cells for tabs/newlines) and an HTML `<table>`; compatible with Numbers, Google Sheets and Excel in both directions. | Done |
| CP-3 | Pasting a table into an **empty sheet** takes the first line as the header row. | Done |
| CP-4 | New columns created by a paste get a **guessed data type** (Number, Date, Yes/No, else Text). | Done |
| CP-5 | Values are copied in the browser locale's notation without thousands separators (e.g. `0,15` / `25.11.2026` in German, `0.15` / `11/25/2026` in US English); Yes/No as `TRUE`/`FALSE`. | Done |
| CP-6 | Pasting a block that ends up outside the visible grid extends the grid. | Done |
| CP-7 | Verified manually with a real Numbers and Google Sheets round trip. | Planned |

## 6. Graph view

| ID | Requirement | Status |
|---|---|---|
| GR-1 | Canvas with force-directed layout; types drawn as squares, instances as circles in the type color. | Done |
| GR-2 | Pan (drag background), zoom (wheel, buttons), fit to screen; frames the graph when opened. | Done |
| GR-3 | Drag nodes; Shift + drag from node to node creates a free edge (asks for the relation name). | Done |
| GR-4 | Click a node to open the inspector (properties, incoming/outgoing edges, delete edge/node). | Done |
| GR-5 | Double-click a node (or "Open in table") jumps to its row in the sheet. | Done |
| GR-6 | Layout positions are not saved; the layout is recomputed. | Done (decision) |
| GR-7 | Filter the graph by type; hide `typeOf` edges. | Idea |

## 7. Databases, storage and files

| ID | Requirement | Status |
|---|---|---|
| DB-1 | The page title shows the **database name**; a new database is called "Untitled database". Click the name to rename it. | Done |
| DB-2 | Several databases can be stored in the browser (IndexedDB). The **File** menu lists them (most recently saved first) and opens them. | Done |
| DB-3 | On start, the last opened database is opened. | Done |
| DB-4 | Changes are saved automatically (debounced); the header shows "Saved hh:mm". | Done |
| DB-5 | A new database is only stored once it has content (no empty entries). | Done |
| DB-6 | Delete the current database from the browser (with confirmation). | Done |
| DB-7 | **Undo/redo** (up to 100 steps) per opened database; switching databases clears the history. | Done |
| DB-8 | Export as JSON (full model) and GraphML (for Gephi, yEd, Cytoscape; includes derived edges). File name = database name + date. | Done |
| DB-9 | Import JSON (current and v1 format) and GraphML (also foreign files with generated key ids). An import opens as a new database named after the file. | Done |
| DB-10 | "Open sample data" opens a demo database (Person, Company, Project). | Done |
| DB-11 | Data saved by version 0.2 (single database) is migrated on first start. | Done |
| DB-12 | Save to / open from a local file (File System Access API) in addition to browser storage. | Idea |

## 8. Non-functional

| ID | Requirement | Status |
|---|---|---|
| NF-1 | Static web app (Vite build), hosted on GitHub Pages; a push to `main` deploys. | Done |
| NF-2 | Stack: React, TypeScript (strict), Zustand, idb-keyval; tests with Vitest. | Done |
| NF-3 | Works in current Chrome, Safari and Firefox on desktop. | Partial (tested in Chrome) |
| NF-4 | Usable at phone width (no horizontal page scroll; the grid scrolls). | Partial |
| NF-5 | Smooth with a few thousand rows per sheet. | Planned (needs virtualized rows) |
| NF-6 | Works offline after the first visit (PWA). | Idea |

## 9. Decisions log

| Date | Decision |
|---|---|
| 2026-10-18 | Rebuilt from vanilla JS to Vite + React + TypeScript + Zustand, same stack as web3D. |
| 2026-10-18 | `typeOf` and relation edges are derived from the data instead of being stored twice. |
| 2026-10-18 | HMI modelled on Google Sheets: menu bar, rounded toolbar, formula bar, sheet tabs at the bottom. |
| 2026-10-18 | Property names live in the sticky header row instead of A/B/C column letters. |
| 2026-10-18 | Copy/paste via TSV + HTML table for compatibility with Numbers and Google Sheets. |
| 2026-10-18 | Multiple databases per browser, each with a name; the File menu lists them. |
| 2026-10-18 | UI language is English only; number and date notation follows the browser locale. |
| 2026-10-18 | The ID is built in: every instance gets a running number per type, shown as the first, read-only column (replaces the short-lived "Auto number" column type). |
| 2026-10-18 | The name is a normal column marked as the name column (`nameKey`), not a fixed first column; older data is migrated on load. |
| 2026-10-18 | No separate row numbers: the ID column is the row header. Display settings (minimum rows/columns) are personal and live in the browser, not in the database. |
| 2026-10-18 | A pasted table only brings its own header row into an empty sheet when it has several columns with text headings, so a pasted list of names keeps its first entry. |

## 10. Open questions

- Should a sheet support several instances with the same name, or should names be unique per type? Link cells match by name; the ID is unique but not used for matching yet (e.g. typing `#12`).
- Should column keys stay internal ids, or follow the column name (affects JSON export readability)?
- Should free edges be editable in the table (e.g. an "edges" sheet)?
