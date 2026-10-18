import { displayValue } from "./graph";
import { cellValue } from "./formula";
import { displayNumber, parseNumber } from "./locale";
import type { Column, Graph, GraphNode, Summary, Value } from "./types";

export const SUMMARIES: [Summary, string][] = [
  ["sum", "Sum"],
  ["avg", "Average"],
  ["min", "Min"],
  ["max", "Max"],
  ["count", "Count"],
  ["empty", "Empty"],
];

/** Footer text for a column over the given rows, e.g. "Sum 235,000"; numbers only for sum/avg, dates also for min/max. */
export function summarize(g: Graph, col: Column, rows: GraphNode[], kind: Summary): string {
  const label = SUMMARIES.find(([k]) => k === kind)![1];
  const values = rows.map((r) => cellValue(g, r, col)).filter((v) => v !== undefined && v !== "");
  if (kind === "count") return `${label} ${values.length}`;
  if (kind === "empty") return `${label} ${rows.length - values.length}`;
  // Numbers typed into a text column still count.
  const nums = values.map((v) => (typeof v === "number" ? v : typeof v === "string" ? parseNumber(v) : undefined)).filter((v): v is number => v !== undefined);
  const isoDates = values.every((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v));
  if ((kind === "min" || kind === "max") && (col.type === "date" || (col.type === "formula" && values.length && isoDates))) {
    const dates = values.filter((v): v is string => typeof v === "string").sort();
    const d = kind === "min" ? dates[0] : dates.at(-1);
    return d ? `${label} ${displayValue(g, { ...col, type: "date" }, d)}` : label;
  }
  if (!nums.length) return label;
  const sum = nums.reduce((a, b) => a + b, 0);
  const value = { sum, avg: sum / nums.length, min: Math.min(...nums), max: Math.max(...nums) }[kind];
  return `${label} ${displayNumber(Math.round(value * 10000) / 10000, col.format)}`;
}

export type SelectionStat = "sum" | "avg" | "min" | "max" | "count" | "countNumbers";

export const SELECTION_STATS: [SelectionStat, string][] = [
  ["sum", "Sum"],
  ["avg", "Average"],
  ["min", "Min"],
  ["max", "Max"],
  ["count", "Count"],
  ["countNumbers", "Count numbers"],
];

/** Figures for the status bar over the non-empty values of a selection; number figures are undefined without numbers. */
export function selectionStats(values: (Value | undefined)[]): Record<SelectionStat, number | undefined> {
  const filled = values.filter((v) => v !== undefined && v !== "");
  const nums = filled.map((v) => (typeof v === "number" ? v : typeof v === "string" ? parseNumber(v) : undefined)).filter((v): v is number => v !== undefined);
  const sum = nums.reduce((a, b) => a + b, 0);
  const has = nums.length > 0;
  return {
    sum: has ? Number(sum.toPrecision(12)) : undefined,
    avg: has ? Number((sum / nums.length).toPrecision(12)) : undefined,
    min: has ? Math.min(...nums) : undefined,
    max: has ? Math.max(...nums) : undefined,
    count: filled.length,
    countNumbers: nums.length,
  };
}
