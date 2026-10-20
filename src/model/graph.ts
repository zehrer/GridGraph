import type { Column, ColumnType, DerivedEdge, Graph, GraphNode, QuickFilter, SavedView, Value } from "./types";
import { displayDate, displayNumber, formatBoolean, formatDate, formatNumber, formatPercent, isBoolean, parseBoolean, parseDate, parseNumber } from "./locale";

export const PALETTE = ["#1a73e8", "#188038", "#e37400", "#9334e6", "#d01884", "#12b5cb", "#d93025", "#5f6368"];

export const emptyGraph = (): Graph => ({ nodes: {}, edges: {} });

export const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// --- Queries ---

export const typesOf = (g: Graph) => Object.values(g.nodes).filter((n) => n.isType);

export const instancesOf = (g: Graph, typeId: string) =>
  Object.values(g.nodes).filter((n) => n.typeId === typeId && !n.isType);

/** Node ids held by a link value (one or several). */
export const linkIds = (v: Value | undefined): string[] => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []);

function inferType(v: Value): ColumnType {
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (Array.isArray(v)) return "text";
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
      if (col.type !== "relation") continue;
      for (const target of linkIds(n.props[col.key])) {
        if (g.nodes[target]) out.push({ id: `${n.id}:${col.key}:${target}`, source: n.id, target, relation: col.label, kind: "column", colKey: col.key });
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

/** Gives the instances of a type the IDs 1…n again (in their current ID order), closing gaps left by deletes. */
export function renumber(g: Graph, typeId: string) {
  const insts = instancesOf(g, typeId).sort((a, b) => (a.no ?? 0) - (b.no ?? 0));
  insts.forEach((n, i) => (n.no = i + 1));
  g.nodes[typeId].nextNo = insts.length + 1;
}

export function setProp(g: Graph, nodeId: string, key: string, value: Value | undefined) {
  const n = g.nodes[nodeId];
  if (!n) return;
  if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) delete n.props[key];
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
  if (t?.filters) delete t.filters[key];
  if (t?.quickFilters) t.quickFilters = t.quickFilters.filter((q) => q.key !== key);
  for (const inst of instancesOf(g, typeId)) delete inst.props[key];
}

/** Deletes a node; deleting a type also deletes its instances. Dangling references are cleaned up. */
export function deleteNode(g: Graph, id: string) {
  deleteNodes(g, [id]);
}

/** Deletes several nodes in one pass over the graph. */
export function deleteNodes(g: Graph, ids: string[]) {
  const doomed = new Set(ids.flatMap((id) => [id, ...(g.nodes[id]?.isType ? instancesOf(g, id).map((n) => n.id) : [])]));
  for (const d of doomed) delete g.nodes[d];
  for (const [eid, e] of Object.entries(g.edges)) {
    if (doomed.has(e.source) || doomed.has(e.target)) delete g.edges[eid];
  }
  for (const n of Object.values(g.nodes)) {
    for (const [k, v] of Object.entries(n.props)) {
      if (typeof v === "string" && doomed.has(v)) delete n.props[k];
      else if (Array.isArray(v) && v.some((id) => doomed.has(id))) setProp(g, n.id, k, toLink(v.filter((id) => !doomed.has(id))));
    }
    if (n.columns) n.columns = n.columns.map((c) => (c.targetTypeId && doomed.has(c.targetTypeId) ? { ...c, type: "text", targetTypeId: undefined } : c));
  }
}

/** Stores links as a single id when there is one, as an array when there are several. */
const toLink = (ids: string[]): Value | undefined => (ids.length > 1 ? ids : ids[0]);

export function addEdge(g: Graph, source: string, target: string, relation: string) {
  const id = newId("edge");
  g.edges[id] = { id, source, target, relation };
}

export function deleteEdge(g: Graph, e: DerivedEdge) {
  if (e.kind === "free") delete g.edges[e.id];
  else if (e.kind === "column" && e.colKey) {
    const ids = linkIds(g.nodes[e.source]?.props[e.colKey]).filter((id) => id !== e.target);
    setProp(g, e.source, e.colKey, toLink(ids));
  }
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
    // One quick filter per sheet (v0.6) became a list.
    const legacy = t as GraphNode & { quickFilter?: QuickFilter };
    if (legacy.quickFilter) {
      t.quickFilters = [legacy.quickFilter];
      delete legacy.quickFilter;
    }
    for (const v of (t.views ?? []) as (SavedView & { quick?: QuickFilter })[]) {
      if (v.quick) {
        v.quicks = [v.quick];
        delete v.quick;
      }
    }
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
      return parseDate(s, col.format) ?? s;
    case "relation": {
      const target = col.targetTypeId;
      if (!target || !g.nodes[target]) return s;
      const find = (name: string) => instancesOf(g, target).find((n) => nodeName(g, n).toLowerCase() === name.toLowerCase())?.id;
      // Several names are separated by commas, unless the whole text is one existing name ("Acme, Inc.").
      const names = find(s) ? [s] : s.split(",").map((x) => x.trim()).filter(Boolean);
      return toLink([...new Set(names.map((name) => find(name) ?? addInstance(g, target, name)))]);
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
  if (col.type === "relation") return linkIds(v).map((id) => (g.nodes[id] ? nodeName(g, g.nodes[id]) : id)).join(", ");
  if (col.type === "boolean") return formatBoolean(!!v);
  if (col.type === "number" && typeof v === "number") return col.format === "percent" ? formatPercent(v) : formatNumber(v);
  if (col.type === "date" && typeof v === "string") return formatDate(v, col.format);
  return String(v);
}

export function displayValue(g: Graph, col: Column, v: Value | undefined): string {
  if (col.type === "number" && typeof v === "number") return displayNumber(v, col.format);
  if (col.type === "date" && typeof v === "string") return displayDate(v, col.format);
  return rawValue(g, col, v);
}

/**
 * Changes a column's data type, converting existing values (links by name, and back).
 * `format` is the new column's format; values are read with it, so "25.11.2026" becomes a date in a DD.MM.YYYY column.
 */
export function convertColumn(g: Graph, typeId: string, col: Column, type: ColumnType, targetTypeId?: string, format?: string) {
  const next: Column = { ...col, type, targetTypeId: type === "relation" ? targetTypeId : undefined, format: col.type === type ? col.format : format };
  for (const n of instancesOf(g, typeId)) setProp(g, n.id, col.key, parseValue(g, next, rawValue(g, col, n.props[col.key])));
  upsertColumn(g, typeId, next);
}

/**
 * Turns a column's distinct values into rows of a new lookup type (named `label`) and the column
 * into a link to it – e.g. a "Country" text column into a Country sheet. Comma-separated values
 * become several links. Returns the new type's id.
 */
export function extractType(g: Graph, typeId: string, col: Column, label: string): string {
  const target = addType(g, label);
  convertColumn(g, typeId, col, "relation", target);
  return target;
}

export const nodeColor = (g: Graph, n: GraphNode) => n.color ?? (n.typeId && g.nodes[n.typeId]?.color) ?? "#5f6368";
