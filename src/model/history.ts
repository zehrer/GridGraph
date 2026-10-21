/**
 * Version history of a database, git-like: edits are open changes until they are checked in;
 * a check-in records them as a numbered version. Only data and the column definitions are
 * versioned – widths, formats, filters and views are not.
 *
 * `head` is the checked-in state; the open changes are the difference between it and the graph.
 */
import { columnsOf, deleteNodes, nodeName, upsertColumn } from "./graph";
import type { Column, Edge, Graph, GraphNode, Value } from "./types";

/** The versioned part of a column. */
export type SnapColumn = Pick<Column, "key" | "label" | "type" | "targetTypeId" | "formula">;
/** The versioned part of a node. */
export interface SnapNode {
  typeId?: string;
  isType?: boolean;
  label?: string;
  no?: number;
  nameKey?: string;
  columns?: SnapColumn[];
  props: Record<string, Value>;
}
export interface Snapshot { nodes: Record<string, SnapNode>; edges: Record<string, Edge> }

export type Change =
  | { k: "add"; id: string; node: SnapNode }
  | { k: "remove"; id: string; node: SnapNode }
  | { k: "cell"; id: string; key: string; before?: Value; after?: Value }
  /** Name, ID or name column of a row or type. */
  | { k: "meta"; id: string; before: Partial<SnapNode>; after: Partial<SnapNode> }
  | { k: "column"; id: string; key: string; before?: SnapColumn; after?: SnapColumn }
  | { k: "edge"; id: string; before?: Edge; after?: Edge };

export interface Commit {
  no: number;
  /** ISO time of the check-in. */
  at: string;
  kind: "initial" | "manual";
  message: string;
  changes: Change[];
}

export interface History { commits: Commit[]; head: Snapshot }

const snapColumn = (c: Column): SnapColumn => {
  const s: SnapColumn = { key: c.key, label: c.label, type: c.type };
  if (c.targetTypeId) s.targetTypeId = c.targetTypeId;
  if (c.formula !== undefined) s.formula = c.formula;
  return s;
};

function snapNode(g: Graph, n: GraphNode): SnapNode {
  const s: SnapNode = { props: structuredClone(n.props) };
  if (n.isType) Object.assign(s, { isType: true, label: n.label, nameKey: n.nameKey, columns: columnsOf(g, n.id).map(snapColumn) });
  else {
    if (n.typeId) s.typeId = n.typeId;
    if (n.no !== undefined) s.no = n.no;
    if (n.label !== undefined) s.label = n.label;
  }
  return s;
}

export function snapshot(g: Graph): Snapshot {
  const nodes: Record<string, SnapNode> = {};
  for (const n of Object.values(g.nodes)) nodes[n.id] = snapNode(g, n);
  return { nodes, edges: structuredClone(g.edges) };
}

/** A new history whose first version is the graph as it is. */
export function startHistory(g: Graph): History {
  return { commits: [{ no: 1, at: new Date().toISOString(), kind: "initial", message: "Start of history", changes: [] }], head: snapshot(g) };
}

const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  return false;
};
const sameColumn = (a: SnapColumn, b: SnapColumn) => a.label === b.label && a.type === b.type && a.targetTypeId === b.targetTypeId && (a.formula ?? "") === (b.formula ?? "");
const META = ["label", "no", "nameKey"] as const;

/** The open changes: what differs between the checked-in state and the graph. */
export function diff(head: Snapshot, g: Graph): Change[] {
  const out: Change[] = [];
  for (const n of Object.values(g.nodes)) {
    const h = head.nodes[n.id];
    if (!h) {
      out.push({ k: "add", id: n.id, node: snapNode(g, n) });
      continue;
    }
    const before: Partial<SnapNode> = {};
    const after: Partial<SnapNode> = {};
    for (const m of META) {
      if (m === "no" && n.isType) continue;
      if (h[m] !== n[m]) Object.assign(before, { [m]: h[m] }), Object.assign(after, { [m]: n[m] });
    }
    if (Object.keys(after).length || Object.keys(before).length) out.push({ k: "meta", id: n.id, before, after });
    for (const key of new Set([...Object.keys(h.props), ...Object.keys(n.props)])) {
      if (!same(h.props[key], n.props[key])) out.push({ k: "cell", id: n.id, key, before: h.props[key], after: n.props[key] });
    }
    if (n.isType) {
      const cols = new Map((h.columns ?? []).map((c) => [c.key, c]));
      for (const c of columnsOf(g, n.id)) {
        const b = cols.get(c.key);
        cols.delete(c.key);
        const a = snapColumn(c);
        if (!b || !sameColumn(b, a)) out.push({ k: "column", id: n.id, key: c.key, before: b, after: a });
      }
      for (const b of cols.values()) out.push({ k: "column", id: n.id, key: b.key, before: b });
    }
  }
  for (const [id, h] of Object.entries(head.nodes)) if (!g.nodes[id]) out.push({ k: "remove", id, node: h });
  for (const e of Object.values(g.edges)) {
    const h = head.edges[e.id];
    if (!h || h.source !== e.source || h.target !== e.target || h.relation !== e.relation) out.push({ k: "edge", id: e.id, before: h, after: { ...e } });
  }
  for (const [id, h] of Object.entries(head.edges)) if (!g.edges[id]) out.push({ k: "edge", id, before: h });
  return out;
}

const cache = new WeakMap<Graph, { head: Snapshot; changes: Change[] }>();
/** `diff`, computed once per graph state. */
export function openChanges(head: Snapshot, g: Graph): Change[] {
  const c = cache.get(g);
  if (c?.head === head) return c.changes;
  const changes = diff(head, g);
  cache.set(g, { head, changes });
  return changes;
}

/** Records the open changes as the next version; returns the history unchanged when there are none. */
export function checkIn(h: History, g: Graph, message: string): History {
  const changes = diff(h.head, g);
  if (!changes.length) return h;
  const no = (h.commits.at(-1)?.no ?? 0) + 1;
  return { commits: [...h.commits, { no, at: new Date().toISOString(), kind: "manual", message: message.trim(), changes }], head: snapshot(g) };
}

/** Changed cells of rows, and rows added since the check-in, for marking them in the sheet. */
export interface Marks { added: Set<string>; cells: Map<string, Map<string, Value | undefined>> }
export function marks(changes: Change[]): Marks {
  const m: Marks = { added: new Set(), cells: new Map() };
  for (const c of changes) {
    if (c.k === "add") m.added.add(c.id);
    else if (c.k === "cell") {
      if (!m.cells.has(c.id)) m.cells.set(c.id, new Map());
      m.cells.get(c.id)!.set(c.key, c.before);
    }
  }
  return m;
}

/** Counts by kind, e.g. for "3 cells, 1 new row". */
export function summarize(changes: Change[]): string {
  let cells = 0, added = 0, removed = 0, columns = 0, types = 0, other = 0;
  for (const c of changes) {
    if (c.k === "cell") cells++;
    else if (c.k === "add") (c.node.isType ? types++ : added++);
    else if (c.k === "remove") (c.node.isType ? types++ : removed++);
    else if (c.k === "column") columns++;
    else other++;
  }
  const part = (n: number, one: string, many = `${one}s`) => (n ? `${n} ${n === 1 ? one : many}` : "");
  return [part(cells, "cell"), part(added, "new row"), part(removed, "removed row"), part(columns, "column"), part(types, "sheet"), part(other, "other change")].filter(Boolean).join(", ") || "no changes";
}

/** Sets the graph back to the checked-in state, entirely or for one row or cell. Display settings stay. */
export function revert(g: Graph, head: Snapshot, scope?: { id: string; key?: string }) {
  const restore = (id: string, h: SnapNode) => {
    const n = g.nodes[id];
    if (!n) {
      g.nodes[id] = { id, ...structuredClone(h), columns: h.columns?.map((c) => ({ ...c })), props: structuredClone(h.props) };
      return;
    }
    n.props = structuredClone(h.props);
    for (const m of META) if (!(m === "no" && n.isType)) (n as unknown as Record<string, unknown>)[m] = h[m];
    if (n.isType && h.columns) {
      const keep = new Set(h.columns.map((c) => c.key));
      n.columns = (n.columns ?? []).filter((c) => keep.has(c.key));
      for (const c of h.columns) upsertColumn(g, id, { ...(n.columns.find((x) => x.key === c.key) ?? {}), ...c, ...(c.formula === undefined && { formula: undefined }), ...(c.targetTypeId === undefined && { targetTypeId: undefined }) });
    }
  };
  if (scope) {
    const h = head.nodes[scope.id];
    if (!h) return void (g.nodes[scope.id] && deleteNodes(g, [scope.id]));
    if (scope.key === undefined) return restore(scope.id, h);
    if (!g.nodes[scope.id]) return;
    if (h.props[scope.key] === undefined) delete g.nodes[scope.id].props[scope.key];
    else g.nodes[scope.id].props[scope.key] = structuredClone(h.props[scope.key]);
    return;
  }
  // Types first, so restored rows find their type and columns.
  const entries = Object.entries(head.nodes).sort(([, a], [, b]) => Number(!!b.isType) - Number(!!a.isType));
  for (const [id, h] of entries) restore(id, h);
  const extra = Object.keys(g.nodes).filter((id) => !head.nodes[id]);
  if (extra.length) deleteNodes(g, extra);
  g.edges = structuredClone(head.edges);
}

/** Readable lines for a version's changes, e.g. `Person "Alice" · Age: 32 → 33`. */
export function describe(c: Change, g: Graph, head: Snapshot): string {
  const node = (id: string): SnapNode | GraphNode | undefined => g.nodes[id] ?? head.nodes[id];
  const typeOf = (n?: SnapNode | GraphNode) => (n?.isType ? n : n?.typeId ? node(n.typeId) : undefined);
  const name = (id: string) => {
    const n = node(id);
    if (!n) return id;
    if (n.isType) return `sheet "${n.label}"`;
    const live = g.nodes[id];
    const label = live ? nodeName(g, live) : String((n.props[(typeOf(n) as SnapNode | undefined)?.nameKey ?? ""] ?? n.label ?? "") || `#${n.no ?? ""}`);
    return `${typeOf(n)?.label ?? ""} "${label}"`.trim();
  };
  const colLabel = (typeId: string | undefined, key: string) => {
    const t = typeId ? node(typeId) : undefined;
    return (t?.columns as SnapColumn[] | undefined)?.find((c) => c.key === key)?.label ?? key;
  };
  const val = (v: Value | undefined) => {
    if (v === undefined || v === "") return "–";
    const ids = Array.isArray(v) ? v : [v];
    return ids.map((x) => (typeof x === "string" && node(x) && !node(x)!.isType ? name(x).replace(/^.*?"(.*)"$/, "$1") : String(x))).join(", ");
  };
  switch (c.k) {
    case "add":
      return c.node.isType ? `New sheet "${c.node.label}"` : `New row ${name(c.id)}`;
    case "remove":
      return c.node.isType ? `Removed sheet "${c.node.label}"` : `Removed row ${name(c.id)}`;
    case "cell":
      return `${name(c.id)} · ${colLabel(node(c.id)?.typeId, c.key)}: ${val(c.before)} → ${val(c.after)}`;
    case "meta":
      return `${name(c.id)} · ${Object.keys({ ...c.before, ...c.after }).map((k) => `${k === "no" ? "ID" : k === "nameKey" ? "name column" : "name"}: ${String(c.before[k as keyof SnapNode] ?? "–")} → ${String(c.after[k as keyof SnapNode] ?? "–")}`).join(", ")}`;
    case "column":
      return !c.before ? `${name(c.id)} · new column "${c.after!.label}"` : !c.after ? `${name(c.id)} · removed column "${c.before.label}"` : `${name(c.id)} · column "${c.before.label}" changed${c.before.label !== c.after.label ? ` → "${c.after.label}"` : ""}${c.before.type !== c.after.type ? ` (${c.before.type} → ${c.after.type})` : ""}`;
    case "edge":
      return !c.before ? `New edge "${c.after!.relation}"` : !c.after ? `Removed edge "${c.before.relation}"` : `Edge "${c.before.relation}" changed`;
  }
}
