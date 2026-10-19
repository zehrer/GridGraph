/**
 * CSV / TSV import, built to cope with real-world files: delimiter detection (comma,
 * semicolon, tab, pipe), quoted cells with "" escapes and line breaks, any line ending,
 * a BOM, Windows-1252 files from Excel, ragged rows, and empty or duplicate headings.
 */
import { addInstance, addType, guessType, newId, parseValue, setProp, upsertColumn } from "./graph";
import { guessDateFormat, parseNumber } from "./locale";
import type { Column, Graph } from "./types";

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
 */
export function importTable(g: Graph, name: string, table: CsvTable): string {
  const typeId = addType(g, name);
  const t = g.nodes[typeId];
  const cols: Column[] = table.headers.map((label, i) => {
    const values = table.rows.map((r) => r[i]);
    const type = i === 0 ? "text" : guessType(values);
    return { key: i === 0 ? "name" : newId("c"), label, type, ...(type === "date" && { format: guessDateFormat(values) }) };
  });
  t.columns = [];
  cols.forEach((c) => upsertColumn(g, typeId, c));
  if (!cols.length) upsertColumn(g, typeId, { key: "name", label: "Name", type: "text" });
  t.nameKey = "name";
  table.rows.forEach((r, ri) => {
    const id = addInstance(g, typeId);
    if (table.ids) g.nodes[id].no = table.ids[ri];
    cols.forEach((c, i) => setProp(g, id, c.key, parseValue(g, c, r[i] ?? "")));
  });
  if (table.ids) t.nextNo = Math.max(0, ...table.ids) + 1;
  return typeId;
}

/** Whether a value looks like a number in this file, for the preview's alignment. */
export const looksNumeric = (v: string) => v !== "" && parseNumber(v) !== undefined;
