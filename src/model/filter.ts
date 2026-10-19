/**
 * Excel-style column filters: filter by values (checkbox list) and by condition, combined
 * across columns. Values are compared by canonical keys that do not depend on the display
 * notation: numbers as written by JS, dates as ISO, yes/no as true/false, links as node ids.
 */
import { displayValue, linkIds, nodeName, rawValue } from "./graph";
import { shownColumn } from "./formula";
import { parseDate, parseNumber } from "./locale";
import type { Column, ColumnFilter, FilterOp, Graph, GraphNode } from "./types";

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
  if (!type.filterOn || !type.filters) return rows;
  const active = columns.filter((c) => c.key !== exceptKey && isActive(type.filters![c.key]));
  return active.length ? rows.filter((n) => active.every((c) => passes(g, n, c, type.filters![c.key]))) : rows;
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
