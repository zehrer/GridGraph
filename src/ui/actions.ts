import { addInstance, addType, columnsOf, convertColumn, deleteNode, extractType, renumber, typesOf, emptyGraph, guessType, instancesOf, moveColumn, newId, nodeName, parseValue, patchColumn, rawValue, removeColumn, setProp, upsertColumn } from "../model/graph";
import { guessDateFormat, parseNumber } from "../model/locale";
import { cellValue, numberFormat, renameReference, shownColumn } from "../model/formula";
import { download, fromJSON, importText, toGraphML, toJSON } from "../model/io";
import { toHTML as toStandaloneHTML } from "../model/html-export";
import { decodeText } from "../model/csv";
import { sampleGraph } from "../model/sample";
import { deleteDatabase, openNew } from "../model/persist";
import { rangeOf, useStore, type Cell } from "../model/store";
import { parseClipboard, toHTML, toTSV, type Matrix } from "../model/clipboard";
import type { Column, ColumnFilter, Graph, GraphNode, QuickFilter, Summary, Value } from "../model/types";
import { applyFilters, cellKeys, isActive, isListUnit, periodOf, periodsOf, quickValues, stepPeriod } from "../model/filter";
import { applyView, captureView, resetView, sortRows } from "../model/views";

export interface SheetModel {
  type: GraphNode;
  /** Visible columns in display order: grid column c ≥ 1 is columns[c - 1]; column 0 is the ID. */
  columns: Column[];
  /** All columns including hidden ones. */
  all: Column[];
  /** Rows shown: searched, filtered and sorted. */
  rows: GraphNode[];
  /** Rows matching the search box, before column filters. */
  base: GraphNode[];
  /** Number of rows of the type. */
  total: number;
}

export interface SheetView {
  /** key "" sorts by ID. */
  sort: { key: string; asc: boolean } | null;
  filter: string;
}

/** The active type as a sheet: rows are its instances, sorted by ID unless the user sorts otherwise. */
export function sheetModel(g: Graph, typeId: string, { sort, filter }: SheetView): SheetModel {
  const all = columnsOf(g, typeId);
  const columns = all.filter((c) => !c.hidden);
  const q = filter.trim().toLowerCase();
  const type = g.nodes[typeId];
  const total = instancesOf(g, typeId);
  // "base": rows after the search box, before column filters (the filter panel lists their values).
  const base = q ? total.filter((n) => [String(n.no), ...all.map((c) => textOf(g, n, c))].some((v) => v.toLowerCase().includes(q))) : total;
  const rows = sortRows(g, all, applyFilters(g, type, all, base), sort);
  return { type, columns, all, rows, base, total: total.length };
}

export const currentSheet = () => {
  const s = useStore.getState();
  return sheetModel(s.graph, s.activeTypeId, s);
};

/** Raw text of a cell, as shown in the formula bar and the cell editor. */
export function cellText(g: Graph, m: SheetModel, { row, col }: Cell): string {
  const column = m.columns[col - 1];
  if (row === 0) return col === 0 ? "ID" : (column?.label ?? "");
  const node = m.rows[row - 1];
  if (!node) return "";
  return col === 0 ? String(node.no ?? "") : column ? textOf(g, node, column) : "";
}

/** Editable text of a cell value; formula columns give their computed result (or the error). */
export function textOf(g: Graph, node: GraphNode, col: Column): string {
  const { col: shown, value, error } = shownColumn(g, node, col);
  return error ? "#ERROR" : rawValue(g, shown, value);
}

/** IDs and formula results are computed by the app and cannot be typed over. */
export const readOnly = (m: SheetModel, { row, col }: Cell) => col === 0 || (row > 0 && m.columns[col - 1]?.type === "formula");

/**
 * Writes a block of text into the sheet starting at `start`, as one undoable step.
 * Header cells (row 0) name columns; values in empty columns or rows create new
 * properties or instances. New (or still empty) columns get a type guessed from their values. When a
 * table lands on an empty sheet, its first line is taken as the header.
 * Returns where the block was actually written and how many columns it covered.
 */
export function writeCells(start: Cell, matrix: Matrix): { start: Cell; width: number } {
  const m = currentSheet();
  // The ID column is read-only: an ID column in pasted data is dropped, everything else shifts right.
  if (start.col === 0) {
    const first = matrix.map((l) => (l[0] ?? "").trim());
    const ids = first.every((v, i) => !v || parseNumber(v) !== undefined || (i === 0 && /^id$/i.test(v)));
    if (ids && Math.max(...matrix.map((l) => l.length)) > 1) matrix = matrix.map((l) => l.slice(1));
    start = { ...start, col: 1 };
  }
  // A table (several columns, text headings) pasted into an empty sheet brings its own header row.
  const looksLikeHeader = matrix.length > 1 && matrix[0].length > 1 && matrix[0].every((h) => h.trim() && parseNumber(h) === undefined);
  if (start.row <= 1 && looksLikeHeader && !m.rows.length && m.all.length <= 1) start = { ...start, row: 0 };
  const header = start.row === 0 ? 0 : -1;
  const width = Math.max(...matrix.map((l) => l.length));
  const cols = new Map<number, Column>();
  const renames: [string, string][] = [];
  let added = 0;

  useStore.getState().edit((g) => {
    for (let j = 0; j < width; j++) {
      const c = start.col + j;
      const label = header === 0 ? matrix[0][j]?.trim() : "";
      const values = matrix.filter((_, i) => i !== header).map((l) => l[j] ?? "");
      let col = m.columns[c - 1];
      if (!col && !label && !values.some((v) => v.trim())) continue;
      if (col && label && label !== col.label) renames.push([col.label, label]);
      // An empty, unformatted text column (e.g. one whose heading was typed first) takes the type of its first values.
      const blank = col?.type === "text" && !col.format && col.key !== m.type.nameKey && !instancesOf(g, m.type.id).some((n) => n.props[col!.key] !== undefined);
      const guessed = (): Partial<Column> => {
        const type = guessType(values);
        return { type, ...(type === "date" && { format: guessDateFormat(values) }) };
      };
      col = col
        ? { ...col, label: label || col.label, ...(blank && guessed()) }
        : { key: newId("c"), label: label || `Column ${m.all.length + ++added}`, type: "text", ...guessed() };
      upsertColumn(g, m.type.id, col);
      cols.set(c, col);
    }
    const newRows = new Map<number, string>();
    matrix.forEach((line, i) => {
      const r = start.row + i;
      if (i === header) return;
      let id = m.rows[r - 1]?.id ?? newRows.get(r);
      if (!id) {
        if (!line.some((v) => v.trim())) return;
        newRows.set(r, (id = addInstance(g, m.type.id)));
      }
      line.forEach((text, j) => {
        const col = cols.get(start.col + j);
        if (col && col.type !== "formula") setProp(g, id, col.key, parseValue(g, col, text));
      });
    });
    // Formulas refer to columns by name: follow renames.
    for (const [from, to] of renames) {
      for (const t of typesOf(g)) for (const c of t.columns ?? []) if (c.formula) c.formula = renameReference(c.formula, from, to);
    }
  });
  return { start, width };
}

export const commitCell = (cell: Cell, text: string) => writeCells(cell, [[text]]);

// --- Clipboard ---

/** Text of the selected range, row by row. */
export function selectionMatrix(): Matrix {
  const s = useStore.getState();
  const m = currentSheet();
  const { r0, r1, c0, c1 } = rangeOf(s.anchor, s.sel);
  return Array.from({ length: r1 - r0 + 1 }, (_, i) => Array.from({ length: c1 - c0 + 1 }, (_, j) => cellText(s.graph, m, { row: r0 + i, col: c0 + j })));
}

/** Stored values of the selected data cells (IDs and the header row excluded), and their common number format. */
export function selectionValues(): { values: (Value | undefined)[]; cells: number; format?: string } {
  const { anchor, sel } = useStore.getState();
  const m = currentSheet();
  const { r0, r1, c0, c1 } = rangeOf(anchor, sel);
  const cols = m.columns.slice(Math.max(c0, 1) - 1, c1);
  const rows = m.rows.slice(Math.max(r0, 1) - 1, r1);
  const values = rows.flatMap((n) => cols.map((c) => cellValue(useStore.getState().graph, n, c)));
  const formats = new Set(cols.map((c) => (c.type === "number" || c.type === "formula" ? (numberFormat(useStore.getState().graph, m.type.id, c) ?? "") : "")));
  return { values, cells: (r1 - r0 + 1) * (c1 - c0 + 1), format: formats.size === 1 ? [...formats][0] || undefined : undefined };
}

export function clearSelection() {
  const { anchor, sel } = useStore.getState();
  const { r0, r1, c0, c1 } = rangeOf(anchor, sel);
  // Header names and IDs stay; clearing only applies to values.
  const [from, left] = [Math.max(r0, 1), Math.max(c0, 1)];
  if (from <= r1 && left <= c1) writeCells({ row: from, col: left }, Array.from({ length: r1 - from + 1 }, () => Array(c1 - left + 1).fill("")));
}

export function pasteMatrix(matrix: Matrix) {
  const { anchor, sel, select } = useStore.getState();
  const { r0, c0 } = rangeOf(anchor, sel);
  const { start, width } = writeCells({ row: r0, col: c0 }, matrix);
  select(start);
  select({ row: start.row + matrix.length - 1, col: start.col + width - 1 }, true);
}

export async function copySelection(cut = false) {
  const m = selectionMatrix();
  await navigator.clipboard.write([
    new ClipboardItem({ "text/plain": new Blob([toTSV(m)], { type: "text/plain" }), "text/html": new Blob([toHTML(m)], { type: "text/html" }) }),
  ]);
  if (cut) clearSelection();
}

export async function pasteFromClipboard() {
  try {
    const items = await navigator.clipboard.read();
    const read = async (type: string) => {
      const item = items.find((i) => i.types.includes(type));
      return item ? (await item.getType(type)).text() : "";
    };
    pasteMatrix(parseClipboard(await read("text/html"), await read("text/plain")));
  } catch {
    alert("No clipboard access – please use ⌘V / Ctrl+V.");
  }
}

// --- Rows ---

/** Appends an instance and puts the cursor into its name cell. */
export function addRow() {
  let id = "";
  const typeId = useStore.getState().activeTypeId;
  useStore.getState().edit((g) => (id = addInstance(g, typeId)));
  const m = currentSheet();
  const nameCol = m.columns.findIndex((c) => c.key === m.type.nameKey) + 1;
  useStore.getState().select({ row: m.rows.findIndex((r) => r.id === id) + 1, col: nameCol || 1 });
}

/** Deletes the instances in the selected rows. */
export function deleteRows() {
  const { anchor, sel, select, edit } = useStore.getState();
  const { r0, r1 } = rangeOf(anchor, sel);
  const doomed = currentSheet().rows.slice(Math.max(r0, 1) - 1, r1);
  if (!doomed.length) return;
  edit((g) => doomed.forEach((n) => deleteNode(g, n.id)));
  select({ row: Math.max(r0, 1), col: sel.col });
}

// --- Column filters (Excel-style) ---

const editType = (fn: (t: GraphNode) => void) => {
  const typeId = useStore.getState().activeTypeId;
  useStore.getState().edit((g) => fn(g.nodes[typeId]));
};

/** Data → Create a filter / Remove filter. Removing also clears the filters, as in spreadsheets. */
export function toggleFilters() {
  editType((t) => {
    t.filterOn = !t.filterOn;
    if (!t.filterOn) delete t.filters;
  });
}

export function setColumnFilter(key: string, f?: ColumnFilter) {
  editType((t) => {
    t.filterOn = true;
    const filters = { ...t.filters };
    if (isActive(f)) filters[key] = f!;
    else delete filters[key];
    t.filters = filters;
  });
}

export const clearFilters = () => editType((t) => void delete t.filters);

// --- Quick filters (toolbar), at most one per column ---

const quickOf = (key: string) => currentSheet().type.quickFilters?.find((q) => q.key === key);

/** Replaces (or with undefined removes) the quick filter of a column. */
function setQuick(key: string, qf: QuickFilter | undefined) {
  editType((t) => {
    const list = (t.quickFilters ?? []).filter((q) => q.key !== key);
    const i = (t.quickFilters ?? []).findIndex((q) => q.key === key);
    if (qf) list.splice(i < 0 ? list.length : i, 0, qf);
    if (list.length) t.quickFilters = list;
    else delete t.quickFilters;
  });
}

/** Column menu → Quick filter: adds one (or retargets the column's); starts at the selected cell's value, else at the latest period / first value. */
export function startQuickFilter(col: number, unit: QuickFilter["unit"]) {
  const { graph, sel } = useStore.getState();
  const m = currentSheet();
  const c = m.columns[col - 1];
  if (!c) return;
  const node = sel.col === col ? m.rows[sel.row - 1] : undefined;
  // Start with a value that still has rows under the other filters.
  const left = applyFilters(graph, m.type, m.all, m.base, c.key);
  const first = isListUnit(unit) ? quickValues(graph, c, left, unit)[0]?.value : periodsOf(graph, c, left, unit)[0];
  const value = (node && periodOf(graph, node, c, unit)) ?? first;
  if (!value) return alert(`"${c.label}" has no values to filter by.`);
  setQuick(c.key, { key: c.key, unit, value });
}

/** Values a list quick filter steps through: those left by all other filters. */
export function quickChoices(key: string) {
  const { graph } = useStore.getState();
  const m = currentSheet();
  const qf = quickOf(key);
  const c = m.all.find((x) => x.key === key);
  return qf && c ? quickValues(graph, c, applyFilters(graph, m.type, m.all, m.base, key), qf.unit) : [];
}

/** ‹ ›: dates and numbers step like a calendar; links and texts move to the previous/next existing value. */
export function stepQuickFilter(key: string, delta: number) {
  const qf = quickOf(key);
  if (!qf) return;
  let value = stepPeriod(qf.unit, qf.value, delta);
  if (isListUnit(qf.unit)) {
    const list = quickChoices(key);
    const next = list[list.findIndex((v) => v.value === qf.value) + delta];
    if (!next) return;
    value = next.value;
  }
  // Stepping switches the quick filter on again.
  setQuick(key, { key, unit: qf.unit, value });
}

export function setQuickValue(key: string, value: string) {
  const qf = quickOf(key);
  if (qf) setQuick(key, { key, unit: qf.unit, value });
}

/** Switches a date quick filter between year and month, staying in the same year. */
export function toggleQuickUnit(key: string) {
  const { graph } = useStore.getState();
  const m = currentSheet();
  const qf = quickOf(key);
  const c = m.all.find((x) => x.key === key);
  if (!qf || !c || (qf.unit !== "year" && qf.unit !== "month")) return;
  setQuick(key, qf.unit === "month"
    ? { ...qf, unit: "year", value: qf.value.slice(0, 4) }
    : { ...qf, unit: "month", value: periodsOf(graph, c, m.base, "month").find((p) => p.startsWith(qf.value)) ?? `${qf.value}-01` });
}

export const clearQuickFilter = (key: string) => setQuick(key, undefined);

/** Switches a quick filter off (all rows) or on again, keeping its column and value. */
export function toggleQuickFilter(key: string) {
  const qf = quickOf(key);
  if (qf) setQuick(key, qf.off ? { key, unit: qf.unit, value: qf.value } : { ...qf, off: true });
}

// --- Filter views ---

/** Applies a saved view of the active sheet, or "All rows" for null. */
export function applyViewById(id: string | null) {
  const { activeTypeId, graph } = useStore.getState();
  const view = graph.nodes[activeTypeId].views?.find((v) => v.id === id);
  useStore.getState().edit((g) => (view ? applyView(g, activeTypeId, view) : resetView(g, activeTypeId)));
  useStore.setState({ sort: view?.sort ?? null });
}

export function saveViewAs() {
  const { activeTypeId, graph, sort } = useStore.getState();
  const t = graph.nodes[activeTypeId];
  const name = prompt("Name of the new filter view:", `View ${(t.views?.length ?? 0) + 1}`)?.trim();
  if (!name) return;
  editType((t) => {
    const view = captureView(useStore.getState().graph, activeTypeId, name, sort);
    t.views = [...(t.views ?? []), view];
    t.activeView = view.id;
  });
}

/** Saves the sheet's current state into the active view. */
export function updateView() {
  const { activeTypeId, graph, sort } = useStore.getState();
  const id = graph.nodes[activeTypeId].activeView;
  if (!id) return;
  editType((t) => {
    t.views = (t.views ?? []).map((v) => (v.id === id ? captureView(useStore.getState().graph, activeTypeId, v.name, sort, id) : v));
  });
}

export function renameView() {
  const t = useStore.getState().graph.nodes[useStore.getState().activeTypeId];
  const view = t.views?.find((v) => v.id === t.activeView);
  const name = view && prompt("Rename filter view:", view.name)?.trim();
  if (view && name) editType((t) => (t.views = (t.views ?? []).map((v) => (v.id === view.id ? { ...v, name } : v))));
}

export function deleteView() {
  const t = useStore.getState().graph.nodes[useStore.getState().activeTypeId];
  const view = t.views?.find((v) => v.id === t.activeView);
  if (!view || !confirm(`Delete the filter view "${view.name}"? The sheet keeps its current filters.`)) return;
  editType((t) => {
    t.views = (t.views ?? []).filter((v) => v.id !== view.id);
    delete t.activeView;
  });
}

/** Data → Filter by selected value: shows only rows with the active cell's value in its column. */
export function filterBySelectedValue() {
  const { sel, graph } = useStore.getState();
  const m = currentSheet();
  const col = m.columns[sel.col - 1];
  const node = m.rows[sel.row - 1];
  if (col && node) setColumnFilter(col.key, { values: cellKeys(graph, node, col) });
}

/** Data → Filter…: puts the cursor into the toolbar's search field. */
export function focusFilter() {
  useStore.getState().setView("sheet");
  setTimeout(() => (document.getElementById("sheet-filter") as HTMLInputElement | null)?.select());
}

export function renumberIds() {
  const { graph, activeTypeId, edit } = useStore.getState();
  const n = instancesOf(graph, activeTypeId).length;
  if (n && confirm(`Renumber the ${n} rows of "${graph.nodes[activeTypeId].label}" as 1–${n}? IDs that were used elsewhere will no longer match.`)) {
    edit((g) => renumber(g, activeTypeId));
  }
}

// --- Columns (grid column numbers, 1 = first visible column) ---

const column = (col: number) => currentSheet().columns[col - 1];
const editColumn = (col: number, patch: Partial<Column>) => {
  const c = column(col);
  if (c) useStore.getState().edit((g) => patchColumn(g, useStore.getState().activeTypeId, c.key, patch));
};

export function setColumnType(col: number, type: Column["type"], targetTypeId?: string) {
  const m = currentSheet();
  const c = m.columns[col - 1];
  if (!c) return;
  if (type === "formula") return openFormula(c.key);
  useStore.getState().edit((g) => convertColumn(g, m.type.id, c.type === "formula" ? freeze(g, m.type.id, c) : c, type, targetTypeId));
}

/** Moves the selected column's values into a new lookup type and links the rows to it. */
export function convertToType(col: number) {
  const m = currentSheet();
  const c = m.columns[col - 1];
  if (!c) return;
  if (c.key === m.type.nameKey) return alert("The name column cannot become a type of its own. Make another column the name column first.");
  const label = prompt(`Each distinct value of "${c.label}" becomes a row of a new type, and the column links to it.\n\nName of the new type:`, c.label)?.trim();
  if (!label) return;
  useStore.getState().edit((g) => extractType(g, m.type.id, c.type === "formula" ? freeze(g, m.type.id, c) : c, label));
}

/** Turns a formula column into a plain column holding its current results. */
function freeze(g: Graph, typeId: string, c: Column): Column {
  const rows = instancesOf(g, typeId).map((n) => [n, shownColumn(g, n, c)] as const);
  const types = new Set(rows.filter(([, r]) => r.value !== undefined).map(([, r]) => r.col.type));
  const type = types.size === 1 ? [...types][0] : "text";
  for (const [n, r] of rows) setProp(g, n.id, c.key, r.value === undefined ? undefined : type === "text" ? rawValue(g, r.col, r.value) : r.value);
  const plain: Column = { ...c, type: type === "formula" ? "text" : type, formula: undefined };
  upsertColumn(g, typeId, plain);
  return plain;
}

export function convertToValues(col: number) {
  const c = column(col);
  if (c?.type === "formula") useStore.getState().edit((g) => freeze(g, useStore.getState().activeTypeId, c));
}

/** Opens the formula editor for a column of the active sheet. */
export const openFormula = (key: string) => useStore.setState({ formulaEditor: key });

export function setFormula(key: string, formula: string) {
  const typeId = useStore.getState().activeTypeId;
  const c = currentSheet().all.find((x) => x.key === key);
  if (c) useStore.getState().edit((g) => upsertColumn(g, typeId, { ...c, type: "formula", formula, targetTypeId: undefined }));
}

/** Insert → Formula column: adds a column and opens its formula editor. */
export function addFormulaColumn() {
  const m = currentSheet();
  const key = newId("c");
  const label = `Formula ${m.all.filter((c) => c.type === "formula").length + 1}`;
  useStore.getState().edit((g) => upsertColumn(g, m.type.id, { key, label, type: "formula", formula: "" }));
  useStore.getState().select({ row: 0, col: currentSheet().columns.findIndex((c) => c.key === key) + 1 });
  openFormula(key);
}

/** Columns covered by the selection (the ID column excluded). */
export function selectedColumns(): Column[] {
  const { anchor, sel } = useStore.getState();
  const { c0, c1 } = rangeOf(anchor, sel);
  return currentSheet().columns.slice(Math.max(c0, 1) - 1, c1);
}

/**
 * Format menu: sets the data type and/or display format of all selected columns in one step.
 * A date or number format turns the column into a date or number column first.
 */
export function formatColumns(type: Column["type"], format = "") {
  const cols = selectedColumns();
  const typeId = useStore.getState().activeTypeId;
  if (!cols.length) return;
  useStore.getState().edit((g) => {
    for (const c of cols) {
      // Formula columns keep their formula; only how numbers or dates are shown changes.
      if (c.type === "formula" && type !== "number" && type !== "date") continue;
      if (c.type !== type && c.type !== "formula") convertColumn(g, typeId, c, type, undefined, format || undefined);
      patchColumn(g, typeId, c.key, { format: format || undefined });
    }
  });
}

export function wrapColumns(wrap: boolean) {
  const cols = selectedColumns();
  const typeId = useStore.getState().activeTypeId;
  if (cols.length) useStore.getState().edit((g) => cols.forEach((c) => patchColumn(g, typeId, c.key, { wrap })));
}

export const setColumnWidth = (key: string, width: number) =>
  useStore.getState().edit((g) => patchColumn(g, useStore.getState().activeTypeId, key, { width: Math.round(width) }));
export const toggleWrap = (col: number) => editColumn(col, { wrap: !column(col)?.wrap });
export const hideColumn = (col: number) => editColumn(col, { hidden: true });
export const setSummary = (col: number, summary?: Summary) => editColumn(col, { summary });

export function unhideColumns(keys?: string[]) {
  const { activeTypeId, edit } = useStore.getState();
  const hidden = currentSheet().all.filter((c) => c.hidden && (!keys || keys.includes(c.key)));
  if (hidden.length) edit((g) => hidden.forEach((c) => patchColumn(g, activeTypeId, c.key, { hidden: false })));
}

/** Moves grid column `from` to the position of grid column `to`. */
export function moveColumnTo(from: number, to: number) {
  const cols = currentSheet().columns;
  const c = cols[from - 1];
  if (!c || to < 1 || to > cols.length || from === to) return;
  const before = to > from ? cols[to]?.key : cols[to - 1].key;
  useStore.getState().edit((g) => moveColumn(g, useStore.getState().activeTypeId, c.key, before));
  useStore.getState().select({ row: useStore.getState().sel.row, col: to });
}

export function setNameColumn(col: number) {
  const c = column(col);
  if (c) useStore.getState().edit((g) => (g.nodes[useStore.getState().activeTypeId].nameKey = c.key));
}

export function sortBy(col: number, asc: boolean) {
  useStore.setState({ sort: { key: col === 0 ? "" : (column(col)?.key ?? ""), asc } });
}

export function deleteColumn(col: number) {
  const m = currentSheet();
  const c = m.columns[col - 1];
  if (!c) return;
  if (c.key === m.type.nameKey) return alert(`"${c.label}" is the name column. Choose another name column first.`);
  if (confirm(`Delete column "${c.label}" and its values?`)) useStore.getState().edit((g) => removeColumn(g, m.type.id, c.key));
}

// --- Sheets ---

export function newSheet() {
  let id = "";
  useStore.getState().edit((g) => (id = addType(g)));
  useStore.getState().setActiveType(id);
}

/** Hides or shows a sheet (type). The last visible sheet cannot be hidden. */
export function setSheetHidden(typeId: string, hidden: boolean) {
  const { graph, activeTypeId, setActiveType, edit } = useStore.getState();
  const visible = typesOf(graph).filter((t) => !t.hiddenSheet && t.id !== typeId);
  if (hidden && !visible.length) return alert("At least one sheet has to stay visible.");
  edit((g) => {
    if (hidden) g.nodes[typeId].hiddenSheet = true;
    else delete g.nodes[typeId].hiddenSheet;
  });
  if (hidden && activeTypeId === typeId) setActiveType(visible[0].id);
}

export function deleteSheet(typeId: string) {
  const g = useStore.getState().graph;
  const t = g.nodes[typeId];
  if (t && confirm(`Delete type "${t.label}" and its ${instancesOf(g, typeId).length} instances?`)) useStore.getState().edit((d) => deleteNode(d, typeId));
}

export function showInSheet(nodeId: string) {
  const s = useStore.getState();
  const n = s.graph.nodes[nodeId];
  if (!n) return;
  s.setActiveType(n.isType ? n.id : n.typeId!);
  useStore.setState({ filter: "", view: "sheet" });
  const m = currentSheet();
  const nameCol = m.columns.findIndex((c) => c.key === m.type.nameKey) + 1;
  s.select({ row: m.rows.findIndex((r) => r.id === nodeId) + 1, col: nameCol || 1 });
}

/** Follows a link cell to its target row, remembering where to come back to. */
export function followLink(targetId: string) {
  const { activeTypeId, sel, graph } = useStore.getState();
  if (!graph.nodes[targetId]) return;
  showInSheet(targetId);
  useStore.setState({ back: { typeId: activeTypeId, sel } });
}

export function goBack() {
  const { back, graph, setActiveType, select } = useStore.getState();
  if (!back || !graph.nodes[back.typeId]) return useStore.setState({ back: null });
  setActiveType(back.typeId);
  useStore.setState({ back: null, view: "sheet" });
  select(back.sel);
}

export const nameOf = (id: string) => {
  const g = useStore.getState().graph;
  return g.nodes[id] ? nodeName(g, g.nodes[id]) : "";
};

// --- File menu ---

/** Export file name from the database name, e.g. "Customers 2026-10-18.json". */
const fileName = (ext: string) => `${useStore.getState().db.name.replace(/[\\/:*?"<>|]/g, "_")} ${new Date().toISOString().slice(0, 10)}.${ext}`;
export const exportJSON = () => download(toJSON(useStore.getState().graph), fileName("json"), "application/json");
export const exportGraphML = () => download(toGraphML(useStore.getState().graph), fileName("graphml"), "application/xml");
/** The app's own address, which the HTML export links back to. */
const appUrl = () => new URL(import.meta.env.BASE_URL, location.href).href;
export const exportHTML = () => {
  const { graph, db } = useStore.getState();
  const { prefs } = useStore.getState();
  download(toStandaloneHTML(graph, db.name, appUrl(), { summaryRow: prefs.summaryRow }), fileName("html"), "text/html");
};

/** Imports a file as a new database named after the file. */
const TABLE_FILE = /\.(csv|tsv|tab|txt)$/i;

/**
 * File → Import: JSON, GraphML or HTML exports open as a new database; CSV/TSV files go to the
 * CSV dialog and become a new sheet of the open database.
 */
export function importFile(accept = ".json,.xml,.graphml,.html,.htm,.csv,.tsv,.tab,.txt") {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (TABLE_FILE.test(file.name) || file.type === "text/csv") {
        const { text, encoding } = decodeText(await file.arrayBuffer());
        useStore.setState({ csvImport: { fileName: file.name, text, encoding } });
      } else {
        await openNew(importText(file.name, await file.text()), file.name.replace(/\.[^.]+$/, ""));
      }
    } catch (e) {
      alert(`Import failed: ${(e as Error).message}`);
    }
  };
  input.click();
}

export const importCSV = () => importFile(".csv,.tsv,.tab,.txt,text/csv,text/tab-separated-values");

export const newDatabase = () => openNew(emptyGraph());
export const loadSample = () => openNew(sampleGraph(), "Sample data");

/** Second demo: Le Monde's "100 books of the century" with authors, first publishers and countries (a hidden lookup sheet). Loaded on demand. */
export async function loadLeMondeSample() {
  const data = (await import("../model/samples/le-monde-100-books.json")).default;
  await openNew(fromJSON(JSON.stringify(data)), "Le Monde – 100 books of the century");
}

export function deleteCurrentDatabase() {
  const { db, dbs } = useStore.getState();
  if (!dbs.some((d) => d.id === db.id)) return openNew(emptyGraph());
  if (confirm(`Permanently delete database "${db.name}" from this browser?`)) deleteDatabase(db.id);
}
