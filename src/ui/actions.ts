import { addInstance, addType, columnsOf, deleteNode, emptyGraph, guessType, instancesOf, moveColumn, newId, nodeName, parseValue, patchColumn, rawValue, removeColumn, setProp, upsertColumn } from "../model/graph";
import { parseNumber } from "../model/locale";
import { download, importText, toGraphML, toJSON } from "../model/io";
import { sampleGraph } from "../model/sample";
import { deleteDatabase, openNew } from "../model/persist";
import { rangeOf, useStore, type Cell } from "../model/store";
import { parseClipboard, toHTML, toTSV, type Matrix } from "../model/clipboard";
import type { Column, Graph, GraphNode, Summary } from "../model/types";

export interface SheetModel {
  type: GraphNode;
  /** Visible columns in display order: grid column c ≥ 1 is columns[c - 1]; column 0 is the ID. */
  columns: Column[];
  /** All columns including hidden ones. */
  all: Column[];
  rows: GraphNode[];
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
  let rows = instancesOf(g, typeId);
  if (q) rows = rows.filter((n) => [String(n.no), ...all.map((c) => rawValue(g, c, n.props[c.key]))].some((v) => v.toLowerCase().includes(q)));
  const col = sort && all.find((c) => c.key === sort.key);
  const key = (n: GraphNode) => (col ? (col.type === "relation" ? rawValue(g, col, n.props[col.key]) : n.props[col.key]) : n.no) ?? "";
  const asc = sort?.asc ?? true;
  rows = [...rows].sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return asc ? c : -c;
  });
  return { type: g.nodes[typeId], columns, all, rows };
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
  return col === 0 ? String(node.no ?? "") : column ? rawValue(g, column, node.props[column.key]) : "";
}

/** The ID column and its header are assigned by the app. */
export const readOnly = ({ col }: Cell) => col === 0;

/**
 * Writes a block of text into the sheet starting at `start`, as one undoable step.
 * Header cells (row 0) name columns; values in empty columns or rows create new
 * properties or instances. New columns get a type guessed from their values. When a
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
  let added = 0;

  useStore.getState().edit((g) => {
    for (let j = 0; j < width; j++) {
      const c = start.col + j;
      const label = header === 0 ? matrix[0][j]?.trim() : "";
      const values = matrix.filter((_, i) => i !== header).map((l) => l[j] ?? "");
      let col = m.columns[c - 1];
      if (!col && !label && !values.some((v) => v.trim())) continue;
      col = col ? { ...col, label: label || col.label } : { key: newId("c"), label: label || `Column ${m.all.length + ++added}`, type: guessType(values) };
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
        if (col) setProp(g, id, col.key, parseValue(g, col, text));
      });
    });
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
  useStore.getState().edit((g) => {
    // Relation cells store node ids; convert existing values by name (and back).
    for (const n of instancesOf(g, m.type.id)) {
      setProp(g, n.id, c.key, parseValue(g, { ...c, type, targetTypeId }, rawValue(g, c, n.props[c.key])));
    }
    upsertColumn(g, m.type.id, { ...c, type, targetTypeId });
  });
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

export const nameOf = (id: string) => {
  const g = useStore.getState().graph;
  return g.nodes[id] ? nodeName(g, g.nodes[id]) : "";
};

// --- File menu ---

/** Export file name from the database name, e.g. "Customers 2026-10-18.json". */
const fileName = (ext: string) => `${useStore.getState().db.name.replace(/[\\/:*?"<>|]/g, "_")} ${new Date().toISOString().slice(0, 10)}.${ext}`;
export const exportJSON = () => download(toJSON(useStore.getState().graph), fileName("json"), "application/json");
export const exportGraphML = () => download(toGraphML(useStore.getState().graph), fileName("graphml"), "application/xml");

/** Imports a file as a new database named after the file. */
export function importFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,.xml,.graphml";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await openNew(importText(file.name, await file.text()), file.name.replace(/\.[^.]+$/, ""));
    } catch (e) {
      alert(`Import failed: ${(e as Error).message}`);
    }
  };
  input.click();
}

export const newDatabase = () => openNew(emptyGraph());
export const loadSample = () => openNew(sampleGraph(), "Sample data");

export function deleteCurrentDatabase() {
  const { db, dbs } = useStore.getState();
  if (!dbs.some((d) => d.id === db.id)) return openNew(emptyGraph());
  if (confirm(`Permanently delete database "${db.name}" from this browser?`)) deleteDatabase(db.id);
}
