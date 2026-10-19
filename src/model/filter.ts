/**
 * Excel-style column filters: filter by values (checkbox list) and by condition, combined
 * across columns. Values are compared by canonical keys that do not depend on the display
 * notation: numbers as written by JS, dates as ISO, yes/no as true/false, links as node ids.
 */
import { columnsOf, displayValue, instancesOf, linkIds, nodeName, rawValue, typesOf } from "./graph";
import { shownColumn } from "./formula";
import { parseDate, parseNumber } from "./locale";
import type { Column, ColumnFilter, FilterOp, Graph, GraphNode, QuickFilter } from "./types";

export const CONDITIONS: [FilterOp, string, number][] = [
  ["empty", "Is empty", 0],
  ["notEmpty", "Is not empty", 0],
  ["contains", "Text contains", 1],
  ["notContains", "Text does not contain", 1],
  ["startsWith", "Text starts with", 1],
  ["endsWith", "Text ends with", 1],
  ["equals", "Is exactly", 1],
  ["gt", "Greater than", 1],
  ["gte", "Greater than or equal to", 1],
  ["lt", "Less than", 1],
  ["lte", "Less than or equal to", 1],
  ["between", "Is between", 2],
];

/** Canonical keys of a cell: one per linked row for link cells, otherwise one; [""] when blank. */
export function cellKeys(g: Graph, node: GraphNode, col: Column): string[] {
  const { col: shown, value } = shownColumn(g, node, col);
  if (value === undefined || value === "") return [""];
  if (shown.type === "relation") {
    const ids = linkIds(value);
    return ids.length ? ids : [""];
  }
  return [String(value)];
}

/** Text shown in the value list for a key of this column. */
export function keyLabel(g: Graph, col: Column, key: string, sample?: GraphNode): string {
  if (key === "") return "(Blanks)";
  if (g.nodes[key]) return nodeName(g, g.nodes[key]);
  const shown = sample ? shownColumn(g, sample, col).col : col;
  const value = shown.type === "number" ? Number(key) : shown.type === "boolean" ? key === "true" : key;
  return displayValue(g, shown, value);
}

/** Orders a and b numerically, by date or as text, depending on what the cell holds. */
function compareInput(g: Graph, node: GraphNode, col: Column, input: string): number | undefined {
  const { col: shown, value } = shownColumn(g, node, col);
  if (value === undefined || value === "") return undefined;
  if (typeof value === "number") {
    const n = parseNumber(input);
    return n === undefined ? undefined : value - n;
  }
  if (shown.type === "date" && typeof value === "string") {
    const iso = parseDate(input.trim(), shown.format);
    return iso ? value.localeCompare(iso) : undefined;
  }
  return rawValue(g, shown, value).localeCompare(input, undefined, { sensitivity: "accent", numeric: true });
}

function meets(g: Graph, node: GraphNode, col: Column, { op, a = "", b = "" }: NonNullable<ColumnFilter["condition"]>): boolean {
  const blank = cellKeys(g, node, col).every((k) => k === "");
  if (op === "empty") return blank;
  if (op === "notEmpty") return !blank;
  const { col: shown, value } = shownColumn(g, node, col);
  const text = rawValue(g, shown, value).toLowerCase();
  const q = a.trim().toLowerCase();
  switch (op) {
    case "contains":
      return text.includes(q);
    case "notContains":
      return !text.includes(q);
    case "startsWith":
      return text.startsWith(q);
    case "endsWith":
      return text.endsWith(q);
    case "equals":
      return text === q || compareInput(g, node, col, a) === 0;
  }
  const c = compareInput(g, node, col, a);
  if (c === undefined) return false;
  if (op === "gt") return c > 0;
  if (op === "gte") return c >= 0;
  if (op === "lt") return c < 0;
  if (op === "lte") return c <= 0;
  const d = compareInput(g, node, col, b);
  return d !== undefined && c >= 0 && d <= 0;
}

export function passes(g: Graph, node: GraphNode, col: Column, f: ColumnFilter): boolean {
  if (f.values && !cellKeys(g, node, col).some((k) => f.values!.includes(k))) return false;
  return !f.condition || meets(g, node, col, f.condition);
}

export const isActive = (f?: ColumnFilter) => !!f && (!!f.values || !!f.condition);

/** Rows that pass every active filter of the type, optionally ignoring one column (for its value list). */
export function applyFilters(g: Graph, type: GraphNode, columns: Column[], rows: GraphNode[], exceptKey?: string): GraphNode[] {
  const qf = type.quickFilter;
  const qcol = qf && qf.key !== exceptKey ? columns.find((c) => c.key === qf.key) : undefined;
  if (qf && qcol) rows = rows.filter((n) => quickKeys(g, n, qcol, qf.unit).includes(qf.value));
  if (!type.filterOn || !type.filters) return rows;
  const active = columns.filter((c) => c.key !== exceptKey && isActive(type.filters![c.key]));
  return active.length ? rows.filter((n) => active.every((c) => passes(g, n, c, type.filters![c.key]))) : rows;
}

// --- Quick filter periods ---

/** Period of a cell for the quick filter: "2026" (year), "2026-05" (month), the number or the text; undefined when empty. */
export function periodOf(g: Graph, node: GraphNode, col: Column, unit: QuickFilter["unit"]): string | undefined {
  return quickKeys(g, node, col, unit)[0];
}

/** The quick filter values a cell matches – several for a cell with several links. */
export function quickKeys(g: Graph, node: GraphNode, col: Column, unit: QuickFilter["unit"]): string[] {
  const { col: shown, value } = shownColumn(g, node, col);
  if (value === undefined || value === "") return [];
  if (unit === "link") return shown.type === "relation" ? linkIds(value).filter((id) => g.nodes[id]) : [];
  if (unit === "text") return [rawValue(g, shown, value)];
  if (unit === "number") return typeof value === "number" ? [String(value)] : [];
  if (typeof value !== "string" || !/^\d{4}-\d{2}/.test(value)) return [];
  return [unit === "year" ? value.slice(0, 4) : value.slice(0, 7)];
}

/** Distinct values of a column for a list quick filter (links, text), sorted by name, with counts. */
export function quickValues(g: Graph, col: Column, rows: GraphNode[], unit: QuickFilter["unit"]): { value: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const n of rows) for (const k of new Set(quickKeys(g, n, col, unit))) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts]
    .map(([value, count]) => ({ value, count, label: quickLabel(g, unit, value) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));
}

/** Text of a quick filter value: the linked row's name, the month, or the value itself. */
export function quickLabel(g: Graph, unit: QuickFilter["unit"], value: string): string {
  if (unit === "link") return g.nodes[value] ? nodeName(g, g.nodes[value]) : value;
  return periodLabel(unit, value);
}

/** List quick filters step through the values that exist rather than through a calendar. */
export const isListUnit = (unit: QuickFilter["unit"]) => unit === "link" || unit === "text";

/** The period before or after `value` (‹ ›). */
export function stepPeriod(unit: QuickFilter["unit"], value: string, delta: number): string {
  if (unit !== "month") return String(Number(value) + delta);
  const [y, m] = value.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** Text for the toolbar, e.g. "2026" or "May 2026". */
export function periodLabel(unit: QuickFilter["unit"], value: string): string {
  if (unit !== "month") return value;
  const [y, m] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}

/** Which periods hold rows, latest first – to start a quick filter where the data is. */
export function periodsOf(g: Graph, col: Column, rows: GraphNode[], unit: QuickFilter["unit"]): string[] {
  const set = new Set(rows.map((n) => periodOf(g, n, col, unit)).filter((p): p is string => !!p));
  return [...set].sort((a, b) => (unit === "number" ? Number(b) - Number(a) : b.localeCompare(a)));
}

/** Distinct keys of a column with their counts, blanks first, then sorted like the column. */
export function distinctValues(g: Graph, col: Column, rows: GraphNode[]): { key: string; label: string; count: number }[] {
  const counts = new Map<string, { count: number; sample: GraphNode }>();
  for (const n of rows) {
    for (const k of new Set(cellKeys(g, n, col))) {
      const e = counts.get(k);
      if (e) e.count++;
      else counts.set(k, { count: 1, sample: n });
    }
  }
  const list = [...counts].map(([key, { count, sample }]) => ({ key, count, label: keyLabel(g, col, key, sample), num: Number(key) }));
  const numeric = list.every((x) => x.key === "" || !Number.isNaN(x.num));
  const dates = list.every((x) => x.key === "" || /^\d{4}-\d{2}-\d{2}$/.test(x.key));
  const order = (x: (typeof list)[number], y: (typeof list)[number]) =>
    numeric ? x.num - y.num : dates ? x.key.localeCompare(y.key) : x.label.localeCompare(y.label, undefined, { numeric: true });
  list.sort((x, y) => (x.key === "" ? -1 : y.key === "" ? 1 : order(x, y)));
  return list.map(({ key, label, count }) => ({ key, label, count }));
}

/** Rows hidden by their sheet's column filters, across all types (for the graph view). */
export function filteredOut(g: Graph): Set<string> {
  const out = new Set<string>();
  for (const t of typesOf(g)) {
    if (!t.quickFilter && (!t.filterOn || !Object.keys(t.filters ?? {}).length)) continue;
    const rows = instancesOf(g, t.id);
    const kept = new Set(applyFilters(g, t, columnsOf(g, t.id), rows).map((n) => n.id));
    for (const n of rows) if (!kept.has(n.id)) out.add(n.id);
  }
  return out;
}
