/**
 * CSV / TSV import, built to cope with real-world files: delimiter detection (comma,
 * semicolon, tab, pipe), quoted cells with "" escapes and line breaks, any line ending,
 * a BOM, Windows-1252 files from Excel, ragged rows, and empty or duplicate headings.
 */
import { addInstance, addType, columnsOf, deleteNodes, guessType, instancesOf, newId, parseValue, rawValue, setProp, typesOf, upsertColumn } from "./graph";
import { guessDateFormat, parseNumber } from "./locale";
import type { Column, ColumnFilter, Graph, GraphNode, QuickFilter, Value } from "./types";

export type Delimiter = "," | ";" | "\t" | "|";
export const DELIMITERS: [Delimiter, string][] = [
  [",", "Comma"],
  [";", "Semicolon"],
  ["\t", "Tab"],
  ["|", "Pipe"],
];

/** Decodes file bytes: UTF-8 (BOM removed), falling back to Windows-1252 when the bytes are not valid UTF-8. */
export function decodeText(bytes: ArrayBuffer): { text: string; encoding: string } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, ""), encoding: "UTF-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "Windows-1252" };
  }
}

/**
 * Splits CSV text into rows of cells. Quotes may wrap cells (with "" for a quote) and contain
 * delimiters and line breaks; a quote that is never closed takes the rest of its line literally.
 */
export function parseCSV(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  const endCell = () => (row.push(cell), (cell = ""));
  const endRow = () => {
    endCell();
    if (row.some((c) => c.trim())) rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' && !cell.trim()) {
      const close = findClosingQuote(text, i + 1);
      if (close < 0) {
        // Unclosed quote: keep the rest of the line as written.
        const eol = text.slice(i).search(/\r\n|\n|\r/);
        cell += text.slice(i, eol < 0 ? text.length : i + eol);
        i = eol < 0 ? text.length : i + eol;
        continue;
      }
      cell = text.slice(i + 1, close).replace(/""/g, '"');
      i = close + 1;
      // Text after the closing quote (e.g. `"a" b`) is kept rather than dropped.
      while (i < text.length && text[i] !== delimiter && text[i] !== "\n" && text[i] !== "\r") cell += text[i++];
    } else if (ch === delimiter) {
      endCell();
      i++;
    } else if (ch === "\n" || ch === "\r") {
      endRow();
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      cell += ch;
      i++;
    }
  }
  if (cell || row.length) endRow();
  return rows.map((r) => r.map((c) => c.trim()));
}

function findClosingQuote(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] !== '"') continue;
    if (text[i + 1] === '"') i++;
    else return i;
  }
  return -1;
}

/**
 * Picks the delimiter that splits the first lines into the most consistent number of columns
 * (more than one). Ties prefer more columns; a file without any delimiter is one column.
 */
export function detectDelimiter(text: string): Delimiter {
  const sample = text.slice(0, 64_000);
  let best: { d: Delimiter; score: number; cols: number } = { d: ",", score: 0, cols: 1 };
  for (const [d] of DELIMITERS) {
    const counts = parseCSV(sample, d).slice(0, 30).map((r) => r.length);
    if (!counts.length) continue;
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    const [cols, hits] = [...freq].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    if (cols < 2) continue;
    const score = hits / counts.length;
    if (score > best.score || (score === best.score && cols > best.cols)) best = { d, score, cols };
  }
  return best.d;
}

export interface CsvTable {
  headers: string[];
  rows: string[][];
  /** Present when the first column holds unique whole numbers headed "ID": used as the rows' IDs. */
  ids?: number[];
}

/** Turns parsed rows into headings and equally long rows; empty or repeated headings get unique names. */
export function toTable(cells: string[][], firstRowIsHeader: boolean): CsvTable {
  const width = Math.max(0, ...cells.map((r) => r.length));
  const raw = firstRowIsHeader ? (cells[0] ?? []) : [];
  const seen = new Map<string, number>();
  let headers = Array.from({ length: width }, (_, i) => {
    const base = raw[i]?.trim() || `Column ${i + 1}`;
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    return n > 1 ? `${base} (${n})` : base;
  });
  let rows = (firstRowIsHeader ? cells.slice(1) : cells).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
  let ids: number[] | undefined;
  const first = rows.map((r) => r[0]);
  if (/^id$/i.test(headers[0] ?? "") && width > 1 && first.every((v) => /^\d+$/.test(v)) && new Set(first).size === first.length) {
    ids = first.map(Number);
    headers = headers.slice(1);
    rows = rows.map((r) => r.slice(1));
  }
  return { headers, rows, ids };
}

/**
 * Adds the table as a new sheet (type) named `name`: one column per heading with a guessed
 * type (number, date, yes/no or text), the first column as the name column. Returns the type id.
 *
 * With a `template` sheet (an earlier version of the same data), columns with the same heading
 * take over its key, data type (links resolve by name again), format and display options; its
 * formula columns, filters, quick filters and filter views come along too.
 */
export function importTable(g: Graph, name: string, table: CsvTable, templateId?: string): string {
  const typeId = addType(g, name);
  const t = g.nodes[typeId];
  const tpl = templateId ? g.nodes[templateId] : undefined;
  const matched = tpl ? mapColumns(g, tpl.id, table.headers) : [];
  const used = new Set(matched.filter(Boolean).map((c) => c!.key));
  const cols: Column[] = table.headers.map((label, i) => {
    const m = matched[i];
    if (m && m.type !== "formula") return { ...m, label };
    const values = table.rows.map((r) => r[i]);
    const type = i === 0 ? "text" : guessType(values);
    const key = i === 0 && !used.has("name") ? "name" : newId("c");
    return { key, label, type, ...(type === "date" && { format: guessDateFormat(values) }) };
  });
  t.columns = [];
  cols.forEach((c) => upsertColumn(g, typeId, c));
  if (!cols.length) upsertColumn(g, typeId, { key: "name", label: "Name", type: "text" });
  t.nameKey = tpl?.nameKey && cols.some((c) => c.key === tpl.nameKey) ? tpl.nameKey : t.columns[0].key;
  table.rows.forEach((r, ri) => {
    const id = addInstance(g, typeId);
    if (table.ids) g.nodes[id].no = table.ids[ri];
    cols.forEach((c, i) => setProp(g, id, c.key, parseValue(g, c, r[i] ?? "")));
  });
  if (table.ids) t.nextNo = Math.max(0, ...table.ids) + 1;
  if (tpl) takeSettings(t, tpl);
  return typeId;
}

/** Copies formula columns, filters, quick filters and filter views of `tpl` to the new sheet `t`, as far as their columns exist. */
function takeSettings(t: GraphNode, tpl: GraphNode) {
  const labels = new Set(t.columns!.map((c) => c.label.toLowerCase()));
  for (const c of tpl.columns ?? []) if (c.type === "formula" && !labels.has(c.label.toLowerCase())) t.columns!.push({ ...c });
  const keys = new Set(t.columns!.map((c) => c.key));
  const filters = (f?: Record<string, ColumnFilter>) => Object.fromEntries(Object.entries(f ?? {}).filter(([k]) => keys.has(k)));
  const quicks = (q?: QuickFilter[]) => q?.filter((x) => keys.has(x.key)).map((x) => ({ ...x }));
  t.filterOn = tpl.filterOn;
  t.filters = filters(tpl.filters);
  t.quickFilters = quicks(tpl.quickFilters);
  t.views = tpl.views?.map((v) => ({ ...structuredClone(v), columns: v.columns.filter((k) => keys.has(k)), filters: filters(v.filters), quicks: quicks(v.quicks), sort: v.sort && (v.sort.key === "" || keys.has(v.sort.key)) ? { ...v.sort } : undefined }));
  t.activeView = tpl.activeView;
}

/** The sheet's column for each heading (same label, ignoring case), if any. */
export function mapColumns(g: Graph, typeId: string, headers: string[]): (Column | undefined)[] {
  const cols = columnsOf(g, typeId);
  return headers.map((h) => cols.find((c) => c.label.trim().toLowerCase() === h.trim().toLowerCase()));
}

/**
 * The sheet a file most likely is a new state of: one with the file's name whose columns cover
 * at least half of the headings, or any sheet that has at least 80 % of them.
 */
export function matchSheet(g: Graph, table: CsvTable, fileName: string): string | undefined {
  if (!table.headers.length) return undefined;
  const base = fileName.replace(/\.[^.]+$/, "").trim().toLowerCase();
  let best: { id: string; score: number } | undefined;
  for (const t of typesOf(g)) {
    const share = mapColumns(g, t.id, table.headers).filter(Boolean).length / table.headers.length;
    const score = share + (t.label?.trim().toLowerCase() === base ? 0.3 : 0);
    if (score >= 0.8 && (!best || score > best.score)) best = { id: t.id, score };
  }
  return best?.id;
}

/** What a row is matched by when a file updates a sheet: its ID, or a column of the sheet that the file has. */
export function updateKeys(g: Graph, typeId: string, table: CsvTable): { key: string; label: string }[] {
  const t = g.nodes[typeId];
  const cols = mapColumns(g, typeId, table.headers).filter((c): c is Column => !!c && c.type !== "formula");
  cols.sort((a, b) => Number(b.key === t.nameKey) - Number(a.key === t.nameKey));
  return [...(table.ids ? [{ key: "", label: "ID" }] : []), ...cols.map((c) => ({ key: c.key, label: c.label }))];
}

export interface UpdateResult {
  /** Rows of the file found in the sheet, and how many of them changed. */
  matched: number;
  changed: number;
  added: number;
  /** Rows of the sheet the file does not have, and whether they were deleted. */
  missing: number;
  removed: boolean;
  newColumns: string[];
}

/**
 * Brings a sheet to the state of a file, keeping its rows (and so links to them), columns,
 * formats, formulas, filters and views. Rows are matched by `key` (a column key, or "" for the
 * ID); matching rows get the file's values, others are added; columns the file lacks are left
 * alone, and new headings become new columns. Sheet rows the file lacks are deleted with `removeMissing`.
 */
export function updateTable(g: Graph, typeId: string, table: CsvTable, key: string, removeMissing: boolean): UpdateResult {
  const t = g.nodes[typeId];
  const mapped = mapColumns(g, typeId, table.headers);
  const newColumns: string[] = [];
  const cols = table.headers.map((label, i) => {
    const m = mapped[i];
    if (m) return m.type === "formula" ? undefined : m;
    const values = table.rows.map((r) => r[i]);
    const type = guessType(values);
    const c: Column = { key: newId("c"), label, type, ...(type === "date" && { format: guessDateFormat(values) }) };
    upsertColumn(g, typeId, c);
    newColumns.push(label);
    return c;
  });
  const keyCol = key ? columnsOf(g, typeId).find((c) => c.key === key) : undefined;
  const at = keyCol ? cols.findIndex((c) => c?.key === keyCol.key) : -1;
  // Comparable text of a key value: values are read and written back, so "1.5" and "1,5" match.
  const norm = (v: Value | undefined) => (keyCol ? rawValue(g, keyCol, v) : "").trim().toLowerCase();
  const cellKey = (r: string[], ri: number) =>
    !keyCol ? String(table.ids?.[ri] ?? "") : keyCol.type === "relation" ? (r[at] ?? "").trim().toLowerCase() : norm(parseValue(g, keyCol, r[at] ?? ""));
  const rows = new Map<string, GraphNode>();
  for (const n of instancesOf(g, typeId)) {
    const k = keyCol ? norm(n.props[keyCol.key]) : String(n.no ?? "");
    if (k && !rows.has(k)) rows.set(k, n);
  }
  const seen = new Set<string>();
  let matched = 0, changed = 0, added = 0;
  table.rows.forEach((r, ri) => {
    const k = cellKey(r, ri);
    let n = k ? rows.get(k) : undefined;
    if (n && !seen.has(n.id)) {
      matched++;
      const before = JSON.stringify(n.props);
      cols.forEach((c, i) => c && setProp(g, n!.id, c.key, parseValue(g, c, r[i] ?? "")));
      if (JSON.stringify(n.props) !== before) changed++;
    } else {
      n = g.nodes[addInstance(g, typeId)];
      if (!keyCol && table.ids && !instancesOf(g, typeId).some((x) => x.no === table.ids![ri])) n.no = table.ids[ri];
      cols.forEach((c, i) => c && setProp(g, n!.id, c.key, parseValue(g, c, r[i] ?? "")));
      added++;
    }
    seen.add(n.id);
  });
  t.nextNo = Math.max(t.nextNo ?? 1, ...instancesOf(g, typeId).map((n) => (n.no ?? 0) + 1));
  const missing = instancesOf(g, typeId).filter((n) => !seen.has(n.id)).map((n) => n.id);
  if (removeMissing && missing.length) deleteNodes(g, missing);
  return { matched, changed, added, missing: missing.length, removed: removeMissing && missing.length > 0, newColumns };
}

/** Whether a value looks like a number in this file, for the preview's alignment. */
export const looksNumeric = (v: string) => v !== "" && parseNumber(v) !== undefined;
