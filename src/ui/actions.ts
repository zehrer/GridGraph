import { addInstance, addType, columnsOf, deleteNode, emptyGraph, instancesOf, newId, parseValue, rawValue, removeColumn, setProp, upsertColumn } from "../model/graph";
import { download, importText, toGraphML, toJSON } from "../model/io";
import { sampleGraph } from "../model/sample";
import { useStore, type Cell } from "../model/store";
import type { Column, Graph, GraphNode } from "../model/types";

/** Column letters like a spreadsheet: A … Z, AA, AB … */
export function colName(i: number): string {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

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
  if (row === 1) return col === 0 ? "Name" : (column?.label ?? "");
  const node = m.rows[row - 2];
  if (!node) return "";
  return col === 0 ? node.label : column ? rawValue(g, column, node.props[column.key]) : "";
}

/**
 * Writes user input into a cell. Header cells name columns; typing into an empty row
 * creates an instance and typing into an empty column creates a property.
 */
export function commitCell({ row, col }: Cell, text: string) {
  const m = currentSheet();
  const column = m.columns[col - 1];
  const value = text.trim();
  if (row === 1) {
    if (col > 0 && value) useStore.getState().edit((g) => upsertColumn(g, m.type.id, column ? { ...column, label: value } : { key: newId("c"), label: value, type: "text" }));
    return;
  }
  const node = m.rows[row - 2];
  if (!node && !value) return;
  useStore.getState().edit((g) => {
    const id = node?.id ?? addInstance(g, m.type.id);
    if (col === 0) {
      g.nodes[id].label = value;
      return;
    }
    const c = column ?? { key: newId("c"), label: colName(col), type: "text" };
    if (!column) upsertColumn(g, m.type.id, c);
    setProp(g, id, c.key, parseValue(g, c, value));
  });
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
  const node = currentSheet().rows[row - 2];
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
  s.select({ row: idx + 2, col: 0 });
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
