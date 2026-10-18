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
| DM-6 | A link property stores the id of the target node, or an array of ids for **several targets**; one edge per target (labelled with the column name) is derived from it. | Done |
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
| SH-3 | The first column is the read-only **ID**, fixed on the left; it doubles as the row header (there are no separate row numbers) but selects like any other column. Shift+Space extends the selection to whole rows. Rows are sorted by ID unless the user sorts by a column. | Done |
| SH-3a | The **name column** is marked (◆, blue header) but can sit anywhere; any column can be made the name column from the column menu. It cannot be deleted. | Done |
| SH-3b | **Renumber IDs** (Data menu, or right click on the ID header) gives the rows 1…n again, closing gaps left by deletes, after a confirmation. | Done |
| SH-3c | **Settings** (View → Settings…): minimum number of rows and columns shown (default 20 and 5), and the **number and date notation** (Browser default, German, English US, English UK). Stored per browser. | Done |
| SH-4 | Typing into an empty row creates an instance; typing into an empty column creates a property. | Done |
| SH-5 | Editing: start typing, Enter, F2 or double-click; Enter/Tab confirm and move; Esc cancels; Delete/Backspace clears. | Done |
| SH-6 | Arrow keys, Tab and Enter move the active cell. | Done |
| SH-7 | **Range selection** with mouse drag, Shift+click and Shift+arrows. | Done |
| SH-8 | **Formula bar** shows the active cell (column name + row) and its raw value, and can edit it. | Done |
| SH-9 | Link cells: typing a name links to the matching instance of the target type or creates it; **several names separated by commas** link several (a whole text that matches an existing name, e.g. "Acme, Inc.", stays one link); suggestions are offered while typing. | Done |
| SH-9a | **Double-clicking a link opens its target** (the clicked chip when a cell holds several): the target type's sheet with the linked row selected. A "← Type" button in the toolbar (or ⌘[) returns to where the link was opened. Enter, F2 or typing still edit the link cell. | Done |
| SH-10 | Yes/No cells show a checkbox that toggles on click. | Done |
| SH-11 | Toolbar: undo, redo, column data type, sort ascending/descending by the active column, search filter, Table/Graph switch. | Done |
| SH-12 | Changing a column's data type converts existing values (relations by name). | Done |
| SH-13 | **Resize** columns by dragging the header border; widths are saved per column. | Done |
| SH-14 | **Reorder** columns by dragging the header, or Move left/right in the column menu. | Done |
| SH-15 | **Column menu** (▾ on the header, or right click): sort, move, wrap text, use as name column, hide, delete. | Done |
| SH-16 | **Hide / show** columns: hidden columns leave a ⋮ marker in the header to show them again; View → Show hidden columns shows all. | Done |
| SH-17 | **Wrap text** per column; wrapped rows grow in height. | Done |
| SH-18 | **Add row** (toolbar, Insert menu, context menu) appends an instance and selects its name cell; **Delete row(s)** removes the selected rows. Delete row(s) removes every row the selection touches. | Done |
| SH-19 | **Footer row** (sticky): row count under the ID; per column a choice of None, Sum, Average, Min, Max, Count, Empty (Min/Max also for dates; numbers stored as text are counted too). | Done |
| SH-20 | Context menu (right click) on cells and row numbers: add/delete rows, cut, copy, paste. | Done |
| SH-22 | **Status bar figure** (bottom right, like Google Sheets): for a selection of two or more cells shows the Sum of its numbers; a click lists Sum, Average, Min, Max, Count, Count numbers and keeps the chosen one (per browser). Without numbers it shows Count. IDs are not counted. | Done |
| SH-23 | **Menu bar** order: File, Edit, View, Insert, Format, Data, Help. **Data**: sort A→Z / Z→A by the selected column, sort by ID, Filter… (⌘F, focuses the filter field), filter by selected value, clear filter, Renumber IDs. **View**: Table/Graph, Summary row on/off (per browser), show hidden columns, Settings. | Done |
| SH-21 | Reorder rows by drag and drop (manual order instead of ID order). | Idea |

## 4a. Format menu

| ID | Requirement | Status |
|---|---|---|
| FM-1 | A **Format** menu applies to the selected column(s): data type (Text, Yes/No, Number, Date), number format, date format, wrap text. Examples show how each format looks. | Done |
| FM-2 | Date formats: Automatic (browser locale), **DD.MM.YYYY**, MM/DD/YYYY, YYYY-MM-DD, DD/MM/YYYY, D MMM YYYY. A column's date format is used for display, editing and copy/paste; the stored value stays an ISO date. | Done |
| FM-3 | Dates written with dots are always read as day.month.year, whatever the browser locale. A new date column typed with dots gets DD.MM.YYYY. | Done |
| FM-4 | Number formats: Automatic, Integer, 2 decimals, Euro, Dollar, Percent (edited as "12.5%", stored as 0.125). The footer uses the column's format. | Done |
| FM-5 | Choosing a number or date format on a text column converts it, reading the values with the chosen format. | Done |
| FM-6 | An empty text column (e.g. after typing its heading first) takes the type of the first values typed into it. | Done |
| FM-7 | A **decimal comma** is understood in every notation ("0,5", "12,99", "1.234,56"); with both marks the last one is the decimal mark, and a single mark only counts as thousands grouping when it groups exactly like that and the notation uses the other mark ("1,234" in English, "1.234" in German). | Done |

## 4b. Help

| ID | Requirement | Status |
|---|---|---|
| HL-1 | **Help → About GridGraph** shows the version and build (commit, date) and explains that data is stored only in this browser (IndexedDB), never on a server; that it is not synced and is lost when site data is cleared; and how to back it up (Export as JSON). | Done |
| HL-2 | Link to the documentation on GitHub. | Done |

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
| GR-1 | Canvas with force-directed layout; types drawn as small colored squares, instances as circles in the type color. | Done |
| GR-2 | Pan (drag background), zoom (wheel, buttons), fit to screen; the layout settles before the first frame and the view frames the graph when opened. | Done |
| GR-3 | Drag nodes; Shift + drag from node to node creates a free edge (asks for the relation name). | Done |
| GR-4 | Click a node to open the inspector (properties, incoming/outgoing edges, delete edge/node). | Done |
| GR-5 | Double-click a node (or "Open in table") jumps to its row in the sheet. | Done |
| GR-6 | Layout positions are not saved; the layout is recomputed. | Done (decision) |
| GR-7 | **Hide type nodes** (◆ button): type nodes and `typeOf` edges are left out of drawing and layout, and a legend lists the types with color and count. Remembered per browser. | Done |
| GR-8 | Clicking a legend entry **hides or shows that type's nodes** (and their edges) in the graph; hidden entries are dimmed. Kept while switching views, reset when another database opens. | Done |

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
| 2026-10-18 | Columns carry an optional display format (date/number). Dates with dots are day.month.year in every locale, since no locale writes month first with dots. |
| 2026-10-18 | The notation (decimal mark, date order, currency placement) is a personal setting, defaulting to the browser locale; input accepts a decimal comma regardless. |
| 2026-10-18 | A pasted table only brings its own header row into an empty sheet when it has several columns with text headings, so a pasted list of names keeps its first entry. |

## 10. Open questions

- Should a sheet support several instances with the same name, or should names be unique per type? Link cells match by name; the ID is unique but not used for matching yet (e.g. typing `#12`).
- Should column keys stay internal ids, or follow the column name (affects JSON export readability)?
- Should free edges be editable in the table (e.g. an "edges" sheet)?
