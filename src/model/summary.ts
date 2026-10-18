import { displayValue } from "./graph";
import { displayNumber } from "./locale";
import type { Column, Graph, GraphNode, Summary } from "./types";

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
  const values = rows.map((r) => r.props[col.key]).filter((v) => v !== undefined && v !== "");
  if (kind === "count") return `${label} ${values.length}`;
  if (kind === "empty") return `${label} ${rows.length - values.length}`;
  const nums = values.filter((v): v is number => typeof v === "number");
  if ((kind === "min" || kind === "max") && col.type === "date") {
    const dates = values.filter((v): v is string => typeof v === "string").sort();
    const d = kind === "min" ? dates[0] : dates.at(-1);
    return d ? `${label} ${displayValue(g, col, d)}` : label;
  }
  if (!nums.length) return label;
  const sum = nums.reduce((a, b) => a + b, 0);
  const value = { sum, avg: sum / nums.length, min: Math.min(...nums), max: Math.max(...nums) }[kind];
  return `${label} ${displayNumber(Math.round(value * 100) / 100)}`;
}
