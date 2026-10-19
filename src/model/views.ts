/**
 * Sorting and named filter views. A view stores a sheet's column filters, which columns are
 * visible and in what order, and the sort; applying it sets all of them back.
 */
import { columnsOf, declareColumns, instancesOf, newId, rawValue } from "./graph";
import { shownColumn } from "./formula";
import { applyFilters } from "./filter";
import type { Column, Graph, GraphNode, SavedView, SortOrder } from "./types";

/** Sorts rows by a column (numbers numerically, text naturally) or, without a sort, by ID. */
export function sortRows(g: Graph, columns: Column[], rows: GraphNode[], sort: SortOrder | null | undefined): GraphNode[] {
  const col = sort && columns.find((c) => c.key === sort.key);
  const key = (n: GraphNode) => {
    if (!col) return n.no ?? "";
    const { col: shown, value } = shownColumn(g, n, col);
    return (shown.type === "relation" ? rawValue(g, shown, value) : Array.isArray(value) ? value.join(", ") : value) ?? "";
  };
  const asc = sort?.asc ?? true;
  return [...rows].sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return asc ? c : -c;
  });
}

/** The sheet's current filters, visible columns and sort as a view. */
export function captureView(g: Graph, typeId: string, name: string, sort: SortOrder | null, id = newId("view")): SavedView {
  const t = g.nodes[typeId];
  return {
    id,
    name,
    columns: columnsOf(g, typeId).filter((c) => !c.hidden).map((c) => c.key),
    filters: t.filterOn ? structuredClone(t.filters ?? {}) : {},
    ...(sort && { sort: { ...sort } }),
    ...(t.quickFilters?.length && { quicks: structuredClone(t.quickFilters) }),
  };
}

/** Sets the sheet's columns (visibility and order) and filters from a view; the caller applies its sort. */
export function applyView(g: Graph, typeId: string, view: SavedView) {
  const t = g.nodes[typeId];
  const cols = declareColumns(g, typeId);
  const shown = view.columns.map((k) => cols.find((c) => c.key === k)).filter((c): c is Column => !!c);
  const rest = cols.filter((c) => !view.columns.includes(c.key));
  t.columns = [...shown.map((c) => ({ ...c, hidden: false })), ...rest.map((c) => ({ ...c, hidden: true }))];
  const filters = Object.fromEntries(Object.entries(view.filters).filter(([k]) => cols.some((c) => c.key === k)));
  t.filters = structuredClone(filters);
  t.filterOn = Object.keys(filters).length > 0;
  const quicks = (view.quicks ?? []).filter((q) => cols.some((c) => c.key === q.key));
  if (quicks.length) t.quickFilters = structuredClone(quicks);
  else delete t.quickFilters;
  t.activeView = view.id;
}

/** "All rows": every column visible, no filters. */
export function resetView(g: Graph, typeId: string) {
  const t = g.nodes[typeId];
  t.columns = declareColumns(g, typeId).map((c) => ({ ...c, hidden: false }));
  delete t.filters;
  t.filterOn = false;
  delete t.quickFilters;
  delete t.activeView;
}

/** Whether the sheet still looks exactly like its active view. */
export function viewModified(g: Graph, typeId: string, sort: SortOrder | null): boolean {
  const t = g.nodes[typeId];
  const view = t.views?.find((v) => v.id === t.activeView);
  if (!view) return false;
  const essence = (v: SavedView) => JSON.stringify([v.columns, v.filters, v.sort ?? null, v.quicks ?? []]);
  return essence(captureView(g, typeId, view.name, sort, view.id)) !== essence(view);
}

/** Columns and rows a view shows, for the HTML export. */
export function viewTable(g: Graph, typeId: string, view: SavedView): { columns: Column[]; rows: GraphNode[] } {
  const all = columnsOf(g, typeId);
  // The HTML export applies quick filters interactively, so view tables are computed without them.
  const t = { ...g.nodes[typeId], filterOn: true, filters: view.filters, quickFilters: undefined };
  const rows = sortRows(g, all, applyFilters(g, t, all, instancesOf(g, typeId)), view.sort);
  return { columns: view.columns.map((k) => all.find((c) => c.key === k)).filter((c): c is Column => !!c), rows };
}
