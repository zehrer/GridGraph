import type { Column, ColumnType, DerivedEdge, Graph, GraphNode, Value } from "./types";
import { displayNumber, formatBoolean, formatDate, formatNumber, isBoolean, parseBoolean, parseDate, parseNumber } from "./locale";

export const PALETTE = ["#1a73e8", "#188038", "#e37400", "#9334e6", "#d01884", "#12b5cb", "#d93025", "#5f6368"];

export const emptyGraph = (): Graph => ({ nodes: {}, edges: {} });

export const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// --- Queries ---

export const typesOf = (g: Graph) => Object.values(g.nodes).filter((n) => n.isType);

export const instancesOf = (g: Graph, typeId: string) =>
  Object.values(g.nodes).filter((n) => n.typeId === typeId && !n.isType);

function inferType(v: Value): ColumnType {
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? "date" : "text";
}

/** Declared columns of a type plus any property keys found only on its instances. */
export function columnsOf(g: Graph, typeId: string): Column[] {
  const cols = [...(g.nodes[typeId]?.columns ?? [])];
  const known = new Set(cols.map((c) => c.key));
  for (const inst of instancesOf(g, typeId)) {
    for (const [key, v] of Object.entries(inst.props)) {
      if (!known.has(key)) {
        known.add(key);
        cols.push({ key, label: key, type: inferType(v) });
      }
    }
  }
  return cols;
}

/** Display name: types use their label, instances the value of their type's name column. */
export function nodeName(g: Graph, n: GraphNode): string {
  const t = n.typeId ? g.nodes[n.typeId] : undefined;
  if (!t?.nameKey) return n.label ?? "";
  const v = n.props[t.nameKey];
  const col = t.columns?.find((c) => c.key === t.nameKey);
  return v === undefined ? "" : col && col.type !== "relation" ? rawValue(g, col, v) : String(v);
}

/** All edges: typeOf (from typeId), relation columns (from props) and free edges. */
export function edgesOf(g: Graph): DerivedEdge[] {
  const out: DerivedEdge[] = [];
  for (const n of Object.values(g.nodes)) {
    if (!n.typeId || !g.nodes[n.typeId]) continue;
    out.push({ id: `${n.id}:typeOf`, source: n.id, target: n.typeId, relation: "typeOf", kind: "typeOf" });
    for (const col of g.nodes[n.typeId].columns ?? []) {
      const target = n.props[col.key];
      if (col.type === "relation" && typeof target === "string" && g.nodes[target]) {
        out.push({ id: `${n.id}:${col.key}`, source: n.id, target, relation: col.label, kind: "column", colKey: col.key });
      }
    }
  }
  for (const e of Object.values(g.edges)) {
    if (g.nodes[e.source] && g.nodes[e.target]) out.push({ ...e, kind: "free" });
  }
  return out;
}

// --- Mutations (operate on a draft; the store clones before calling them) ---

export function addType(g: Graph, label?: string): string {
  const id = newId("type");
  const n = typesOf(g).length;
  g.nodes[id] = {
    id, label: label ?? `Type ${n + 1}`, isType: true, color: PALETTE[n % PALETTE.length],
    columns: [{ key: "name", label: "Name", type: "text" }], nameKey: "name", nextNo: 1, props: {},
  };
  return id;
}

/** Creates an instance with the next ID of its type and, optionally, a name. */
export function addInstance(g: Graph, typeId: string, name = ""): string {
  const t = g.nodes[typeId];
  const id = newId("inst");
  g.nodes[id] = { id, typeId, no: (t.nextNo ??= 1), props: {} };
  t.nextNo++;
  if (name && t.nameKey) g.nodes[id].props[t.nameKey] = name;
  return id;
}

export function setProp(g: Graph, nodeId: string, key: string, value: Value | undefined) {
  const n = g.nodes[nodeId];
  if (!n) return;
  if (value === undefined || value === "") delete n.props[key];
  else n.props[key] = value;
}

/** Makes discovered (undeclared) columns part of the type, so they can be moved, hidden or resized. */
export function declareColumns(g: Graph, typeId: string): Column[] {
  return (g.nodes[typeId].columns = columnsOf(g, typeId));
}

export function upsertColumn(g: Graph, typeId: string, col: Column) {
  const cols = declareColumns(g, typeId);
  const i = cols.findIndex((c) => c.key === col.key);
  if (i >= 0) cols[i] = col;
  else cols.push(col);
}

export function patchColumn(g: Graph, typeId: string, key: string, patch: Partial<Column>) {
  const col = declareColumns(g, typeId).find((c) => c.key === key);
  if (col) Object.assign(col, patch);
}

/** Moves a column in front of `beforeKey` (or to the end). */
export function moveColumn(g: Graph, typeId: string, key: string, beforeKey?: string) {
  const cols = declareColumns(g, typeId);
  const from = cols.findIndex((c) => c.key === key);
  if (from < 0 || key === beforeKey) return;
  const [col] = cols.splice(from, 1);
  const to = beforeKey ? cols.findIndex((c) => c.key === beforeKey) : -1;
  cols.splice(to < 0 ? cols.length : to, 0, col);
}

export function removeColumn(g: Graph, typeId: string, key: string) {
  const t = g.nodes[typeId];
  if (t) t.columns = declareColumns(g, typeId).filter((c) => c.key !== key);
  for (const inst of instancesOf(g, typeId)) delete inst.props[key];
}

/** Deletes a node; deleting a type also deletes its instances. Dangling references are cleaned up. */
export function deleteNode(g: Graph, id: string) {
  const doomed = new Set([id, ...(g.nodes[id]?.isType ? instancesOf(g, id).map((n) => n.id) : [])]);
  for (const d of doomed) delete g.nodes[d];
  for (const [eid, e] of Object.entries(g.edges)) {
    if (doomed.has(e.source) || doomed.has(e.target)) delete g.edges[eid];
  }
  for (const n of Object.values(g.nodes)) {
    for (const [k, v] of Object.entries(n.props)) if (typeof v === "string" && doomed.has(v)) delete n.props[k];
    if (n.columns) n.columns = n.columns.map((c) => (c.targetTypeId && doomed.has(c.targetTypeId) ? { ...c, type: "text", targetTypeId: undefined } : c));
  }
}

export function addEdge(g: Graph, source: string, target: string, relation: string) {
  const id = newId("edge");
  g.edges[id] = { id, source, target, relation };
}

export function deleteEdge(g: Graph, e: DerivedEdge) {
  if (e.kind === "free") delete g.edges[e.id];
  else if (e.kind === "column" && e.colKey) setProp(g, e.source, e.colKey, undefined);
}

/**
 * Brings older data into the current shape (in place): every type gets a name column
 * (instance labels move into it) and every instance a running ID. Idempotent.
 */
export function normalize(g: Graph): Graph {
  for (const t of typesOf(g) as (GraphNode & { nameLabel?: string })[]) {
    // Auto-number columns (v0.4) became the built-in ID; keep their values as plain numbers.
    t.columns = ((t.columns ?? []) as (Column & { next?: number })[]).map(({ next: _, ...c }) =>
      (c.type as string) === "autonumber" ? { ...c, type: "number" as const } : c,
    );
    const insts = instancesOf(g, t.id);
    if (!t.nameKey) {
      const taken = t.columns.some((c) => c.key === "name") || insts.some((i) => "name" in i.props);
      const key = taken ? newId("c") : "name";
      t.columns.unshift({ key, label: t.nameLabel || "Name", type: "text" });
      t.nameKey = key;
      for (const i of insts) {
        if (i.label) i.props[key] = i.label;
        delete i.label;
      }
    }
    delete t.nameLabel;
    let next = Math.max(t.nextNo ?? 1, ...insts.map((i) => (i.no ?? 0) + 1));
    for (const i of insts) i.no ??= next++;
    t.nextNo = next;
  }
  return g;
}

// --- Cell values ---

/** Parses user input for a column; relation input is matched (or created) by name. */
export function parseValue(g: Graph, col: Column, raw: string): Value | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  switch (col.type) {
    case "number":
      return parseNumber(s) ?? s;
    case "boolean":
      return parseBoolean(s);
    case "date":
      return parseDate(s) ?? s;
    case "relation": {
      if (!col.targetTypeId || !g.nodes[col.targetTypeId]) return s;
      const hit = instancesOf(g, col.targetTypeId).find((n) => nodeName(g, n).toLowerCase() === s.toLowerCase());
      return hit?.id ?? addInstance(g, col.targetTypeId, s);
    }
    default:
      return s;
  }
}

/** Column type for pasted values: number, date or yes/no when every non-empty value fits. */
export function guessType(values: string[]): ColumnType {
  const vs = values.map((v) => v.trim()).filter(Boolean);
  if (!vs.length) return "text";
  if (vs.every((v) => parseNumber(v) !== undefined)) return "number";
  if (vs.every((v) => parseDate(v))) return "date";
  if (vs.every(isBoolean)) return "boolean";
  return "text";
}

/**
 * Editable text of a value (formula bar, cell editor, clipboard), in the browser locale's
 * notation without thousands separators, so `parseValue` and spreadsheet apps read it back.
 */
export function rawValue(g: Graph, col: Column, v: Value | undefined): string {
  if (v === undefined) return "";
  if (col.type === "relation" && typeof v === "string") return g.nodes[v] ? nodeName(g, g.nodes[v]) : v;
  if (col.type === "boolean") return formatBoolean(!!v);
  if (col.type === "number" && typeof v === "number") return formatNumber(v);
  if (col.type === "date" && typeof v === "string") return formatDate(v);
  return String(v);
}

export function displayValue(g: Graph, col: Column, v: Value | undefined): string {
  if (col.type === "number" && typeof v === "number") return displayNumber(v);
  return rawValue(g, col, v);
}

export const nodeColor = (g: Graph, n: GraphNode) => n.color ?? (n.typeId && g.nodes[n.typeId]?.color) ?? "#5f6368";
