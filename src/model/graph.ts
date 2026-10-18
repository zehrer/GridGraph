import type { Column, ColumnType, DerivedEdge, Graph, GraphNode, Value } from "./types";

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
  g.nodes[id] = { id, label: label ?? `Typ ${n + 1}`, isType: true, color: PALETTE[n % PALETTE.length], columns: [], props: {} };
  return id;
}

export function addInstance(g: Graph, typeId: string, label = ""): string {
  const id = newId("inst");
  g.nodes[id] = { id, label, typeId, props: {} };
  return id;
}

export function setProp(g: Graph, nodeId: string, key: string, value: Value | undefined) {
  const n = g.nodes[nodeId];
  if (!n) return;
  if (value === undefined || value === "") delete n.props[key];
  else n.props[key] = value;
}

export function upsertColumn(g: Graph, typeId: string, col: Column) {
  const t = g.nodes[typeId];
  if (!t) return;
  const cols = (t.columns ??= []);
  const i = cols.findIndex((c) => c.key === col.key);
  if (i >= 0) cols[i] = col;
  else cols.push(col);
}

export function removeColumn(g: Graph, typeId: string, key: string) {
  const t = g.nodes[typeId];
  if (t) t.columns = (t.columns ?? []).filter((c) => c.key !== key);
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

// --- Cell values ---

/** Parses user input for a column; relation input is matched (or created) by label. */
export function parseValue(g: Graph, col: Column, raw: string): Value | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  switch (col.type) {
    case "number": {
      // "1.234,5" (German) or "1234.5"
      const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
      return Number.isFinite(n) ? n : s;
    }
    case "boolean":
      return /^(ja|j|true|wahr|1|x|yes|y)$/i.test(s);
    case "date": {
      const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      return de ? `${de[3]}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}` : s;
    }
    case "relation": {
      if (!col.targetTypeId || !g.nodes[col.targetTypeId]) return s;
      const hit = instancesOf(g, col.targetTypeId).find((n) => n.label.toLowerCase() === s.toLowerCase());
      return hit?.id ?? addInstance(g, col.targetTypeId, s);
    }
    default:
      return s;
  }
}

const NUMBER = /^-?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$|^-?\d+(\.\d+)?$/;
const DATE = /^(\d{1,2}\.\d{1,2}\.\d{4}|\d{4}-\d{2}-\d{2})$/;
const BOOL = /^(ja|nein|true|false|wahr|falsch)$/i;

/** Column type for pasted values: number, date or yes/no when every non-empty value fits. */
export function guessType(values: string[]): ColumnType {
  const vs = values.map((v) => v.trim()).filter(Boolean);
  if (!vs.length) return "text";
  for (const [re, type] of [[NUMBER, "number"], [DATE, "date"], [BOOL, "boolean"]] as const) {
    if (vs.every((v) => re.test(v))) return type;
  }
  return "text";
}

/**
 * Editable text of a value (formula bar, cell editor, clipboard). German notation without
 * thousands separators, so `parseValue` and spreadsheet apps read it back unchanged.
 */
export function rawValue(g: Graph, col: Column, v: Value | undefined): string {
  if (v === undefined) return "";
  if (col.type === "relation" && typeof v === "string") return g.nodes[v]?.label ?? v;
  if (col.type === "boolean") return v ? "Ja" : "Nein";
  if (col.type === "number" && typeof v === "number") return String(v).replace(".", ",");
  const iso = col.type === "date" && typeof v === "string" && v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return iso ? `${iso[3]}.${iso[2]}.${iso[1]}` : String(v);
}

export function displayValue(g: Graph, col: Column, v: Value | undefined): string {
  if (v === undefined) return "";
  if (col.type === "number" && typeof v === "number") return v.toLocaleString("de-DE");
  if (col.type === "date" && typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? v : d.toLocaleDateString("de-DE");
  }
  return rawValue(g, col, v);
}

export const nodeColor = (g: Graph, n: GraphNode) => n.color ?? (n.typeId && g.nodes[n.typeId]?.color) ?? "#5f6368";
