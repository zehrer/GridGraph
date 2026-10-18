import { addInstance, addType, columnsOf, deleteNode, emptyGraph, guessType, instancesOf, newId, parseValue, rawValue, removeColumn, setProp, upsertColumn } from "../model/graph";
import { download, importText, toGraphML, toJSON } from "../model/io";
import { sampleGraph } from "../model/sample";
import { rangeOf, useStore, type Cell } from "../model/store";
import { parseClipboard, toHTML, toTSV, type Matrix } from "../model/clipboard";
import type { Column, Graph, GraphNode } from "../model/types";

export interface SheetModel {
  type: GraphNode;
  columns: Column[];
  rows: GraphNode[];
}

export interface SheetView {
  sort: { key: string; asc: boolean } | null;
  filter: string;
}

/** The active type as a sheet: column 0 is the name, then one column per property; rows are instances. */
export function sheetModel(g: Graph, typeId: string, { sort, filter }: SheetView): SheetModel {
  const columns = columnsOf(g, typeId);
  const q = filter.trim().toLowerCase();
  let rows = instancesOf(g, typeId);
  if (q) rows = rows.filter((n) => [n.label, ...columns.map((c) => rawValue(g, c, n.props[c.key]))].some((v) => v.toLowerCase().includes(q)));
  if (sort) {
    const col = columns.find((c) => c.key === sort.key);
    const key = (n: GraphNode) => (col ? (col.type === "relation" ? rawValue(g, col, n.props[col.key]) : n.props[col.key]) : n.label) ?? "";
    rows = [...rows].sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "de", { numeric: true });
      return sort.asc ? c : -c;
    });
  }
  return { type: g.nodes[typeId], columns, rows };
}

export const currentSheet = () => {
  const s = useStore.getState();
  return sheetModel(s.graph, s.activeTypeId, s);
};

/** Raw text of a cell, as shown in the formula bar and the cell editor. */
export function cellText(g: Graph, m: SheetModel, { row, col }: Cell): string {
  const column = m.columns[col - 1];
  if (row === 0) return col === 0 ? "Name" : (column?.label ?? "");
  const node = m.rows[row - 1];
  if (!node) return "";
  return col === 0 ? node.label : column ? rawValue(g, column, node.props[column.key]) : "";
}

/**
 * Writes a block of text into the sheet starting at `start`, as one undoable step.
 * Header cells (row 0) name columns; values in empty columns or rows create new
 * properties or instances. New columns get a type guessed from their values. When a
 * multi-row block lands on an empty sheet, its first line is taken as the header.
 * Returns the cell the block was actually written to.
 */
export function writeCells(start: Cell, matrix: Matrix): Cell {
  const m = currentSheet();
  if (start.row <= 1 && matrix.length > 1 && !m.columns.length && !m.rows.length) start = { row: 0, col: start.col };
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
      if (c === 0 || (!col && !label && !values.some((v) => v.trim()))) continue;
      col = col ? { ...col, label: label || col.label } : { key: newId("c"), label: label || `Spalte ${m.columns.length + ++added}`, type: guessType(values) };
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
        const c = start.col + j;
        if (c === 0) g.nodes[id].label = text.trim();
        else if (cols.has(c)) setProp(g, id, cols.get(c)!.key, parseValue(g, cols.get(c)!, text));
      });
    });
  });
  return start;
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
  // The header row keeps its names; clearing only applies to values.
  const from = Math.max(r0, 1);
  if (from <= r1) writeCells({ row: from, col: c0 }, Array.from({ length: r1 - from + 1 }, () => Array(c1 - c0 + 1).fill("")));
}

export function pasteMatrix(matrix: Matrix) {
  const { anchor, sel, select } = useStore.getState();
  const { r0, c0 } = rangeOf(anchor, sel);
  const start = writeCells({ row: r0, col: c0 }, matrix);
  select(start);
  select({ row: start.row + matrix.length - 1, col: start.col + Math.max(...matrix.map((l) => l.length)) - 1 }, true);
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
    alert("Kein Zugriff auf die Zwischenablage – bitte ⌘V verwenden.");
  }
}

export function setColumnType(col: number, type: Column["type"], targetTypeId?: string) {
  const m = currentSheet();
  const column = m.columns[col - 1];
  if (!column) return;
  useStore.getState().edit((g) => {
    // Relation cells store node ids; convert existing values by label (and back).
    for (const n of m.rows) {
      const text = rawValue(g, column, n.props[column.key]);
      setProp(g, n.id, column.key, parseValue(g, { ...column, type, targetTypeId }, text));
    }
    upsertColumn(g, m.type.id, { key: column.key, label: column.label, type, ...(targetTypeId && { targetTypeId }) });
  });
}

export function sortBy(col: number, asc: boolean) {
  const column = currentSheet().columns[col - 1];
  useStore.setState({ sort: { key: col === 0 ? "" : (column?.key ?? ""), asc } });
}

export function deleteRow(row: number) {
  const node = currentSheet().rows[row - 1];
  if (node) useStore.getState().edit((g) => deleteNode(g, node.id));
}

export function deleteColumn(col: number) {
  const m = currentSheet();
  const column = m.columns[col - 1];
  if (column && confirm(`Spalte „${column.label}“ und ihre Werte löschen?`)) useStore.getState().edit((g) => removeColumn(g, m.type.id, column.key));
}

export function newSheet() {
  let id = "";
  useStore.getState().edit((g) => (id = addType(g)));
  useStore.getState().setActiveType(id);
}

export function deleteSheet(typeId: string) {
  const g = useStore.getState().graph;
  const t = g.nodes[typeId];
  if (t && confirm(`Typ „${t.label}“ mit ${instancesOf(g, typeId).length} Instanzen löschen?`)) useStore.getState().edit((d) => deleteNode(d, typeId));
}

export function showInSheet(nodeId: string) {
  const s = useStore.getState();
  const n = s.graph.nodes[nodeId];
  if (!n) return;
  s.setActiveType(n.isType ? n.id : n.typeId!);
  useStore.setState({ filter: "", view: "sheet" });
  const idx = currentSheet().rows.findIndex((r) => r.id === nodeId);
  s.select({ row: idx + 1, col: 0 });
}

// --- File menu ---

const stamp = () => new Date().toISOString().slice(0, 10);
export const exportJSON = () => download(toJSON(useStore.getState().graph), `gridgraph-${stamp()}.json`, "application/json");
export const exportGraphML = () => download(toGraphML(useStore.getState().graph), `gridgraph-${stamp()}.graphml`, "application/xml");

export function importFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,.xml,.graphml";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      useStore.getState().load(importText(file.name, await file.text()));
    } catch (e) {
      alert(`Import fehlgeschlagen: ${(e as Error).message}`);
    }
  };
  input.click();
}

export function newDatabase() {
  if (confirm("Neue, leere Datenbank anlegen? (Rückgängig ist möglich.)")) useStore.getState().load(emptyGraph());
}

export const loadSample = () => useStore.getState().load(sampleGraph());
